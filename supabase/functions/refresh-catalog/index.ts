// Songsfy — job diário do catálogo.
// 1) Preenche/revalida preview_url e artwork das músicas (throttled, respeitando o rate limit da Apple).
// 2) Importa novidades dos charts brasileiros da Apple (RSS) mapeando gênero → categoria do jogo.
// 3) Gera os desafios diários (hoje + amanhã) compartilhados por todos os jogadores.
//
// Proteção: exige o header `x-cron-secret` igual ao secret CRON_SECRET do projeto.
// Agende via Supabase Cron (ou pg_cron + pg_net) com esse header.

import { createClient } from 'npm:@supabase/supabase-js@2'

type Category = 'pop' | 'rock' | 'brasil' | 'sertanejo' | 'eletronica' | 'hiphop'

const CATEGORIES: Category[] = ['pop', 'rock', 'brasil', 'sertanejo', 'eletronica', 'hiphop']
const SET_TARGETS = 6
const SET_OPTIONS = 9
const MAX_PREVIEW_CHECKS = 60 // por execução
const MAX_CHART_INSERTS = 15 // por execução
const THROTTLE_MS = 700

// Gêneros da Apple → categorias do jogo (sem correspondência = ignorado)
const GENRE_MAP: Record<string, Category> = {
  'Pop': 'pop',
  'K-Pop': 'pop',
  'Pop Latino': 'pop',
  'R&B/Soul': 'pop',
  'Rock': 'rock',
  'Metal': 'rock',
  'Alternative': 'rock',
  'Alternativa': 'rock',
  'Punk': 'rock',
  'Sertanejo': 'sertanejo',
  'MPB': 'brasil',
  'Samba': 'brasil',
  'Pagode': 'brasil',
  'Bossa Nova': 'brasil',
  'Axé': 'brasil',
  'Forró': 'brasil',
  'Funk': 'brasil',
  'Brazilian Funk': 'brasil',
  'Dance': 'eletronica',
  'Electronic': 'eletronica',
  'Eletrônica': 'eletronica',
  'House': 'eletronica',
  'Hip-Hop/Rap': 'hiphop',
  'Hip Hop/Rap': 'hiphop',
  'Rap': 'hiphop',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function todayInSaoPaulo(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now) // YYYY-MM-DD
}

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

interface ItunesResult {
  trackId?: number
  trackName?: string
  artistName?: string
  collectionName?: string
  previewUrl?: string
  artworkUrl100?: string
  releaseDate?: string
  primaryGenreName?: string
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

async function itunesSearch(term: string): Promise<ItunesResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=25&country=BR`
  const res = await fetch(url)
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  return (json?.results as ItunesResult[]) ?? []
}

async function itunesLookup(trackId: number): Promise<ItunesResult | null> {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${trackId}&country=BR`)
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  const r = (json?.results as ItunesResult[])?.find((x) => x.previewUrl)
  return r ?? null
}

function pickBest(results: ItunesResult[], title: string, artist: string): ItunesResult | null {
  const withPreview = results.filter((r) => r.previewUrl)
  if (withPreview.length === 0) return null
  const wantTitle = norm(title)
  const wantArtist = norm(artist).split(' ')[0]
  return (
    withPreview.find((r) => norm(r.trackName ?? '').includes(wantTitle) && norm(r.artistName ?? '').includes(wantArtist)) ??
    withPreview.find((r) => norm(r.trackName ?? '').includes(wantTitle)) ??
    withPreview[0]
  )
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const summary = { previewsUpdated: 0, previewsMissing: 0, chartAdded: 0, challengesCreated: 0, errors: [] as string[] }

  // ── 1) Preenche prévias faltantes e revalida as mais antigas ──
  try {
    const staleBefore = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data: pending } = await supabase
      .from('songs')
      .select('id, title, artist, search_term')
      .eq('active', true)
      .or(`preview_url.is.null,last_checked_at.is.null,last_checked_at.lt.${staleBefore}`)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(MAX_PREVIEW_CHECKS)

    for (const s of pending ?? []) {
      const results = await itunesSearch(s.search_term ?? `${s.title} ${s.artist}`)
      const best = pickBest(results, s.title, s.artist)
      if (best) {
        await supabase
          .from('songs')
          .update({
            preview_url: best.previewUrl,
            artwork_url: (best.artworkUrl100 ?? '').replace('100x100', '600x600'),
            album: best.collectionName ?? null,
            itunes_track_id: best.trackId ?? null,
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', s.id)
        summary.previewsUpdated++
      } else {
        // sem prévia disponível: registra a checagem; a música fica fora dos desafios
        await supabase.from('songs').update({ last_checked_at: new Date().toISOString() }).eq('id', s.id)
        summary.previewsMissing++
      }
      await sleep(THROTTLE_MS)
    }
  } catch (e) {
    summary.errors.push(`previas: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 2) Importa os charts brasileiros da Apple ──
  try {
    const res = await fetch('https://rss.marketingtools.apple.com/api/v2/br/music/most-played/100/songs.json')
    if (res.ok) {
      const feed = await res.json()
      const items = (feed?.feed?.results ?? []) as {
        id: string
        name: string
        artistName: string
        genres?: { name: string }[]
      }[]

      let added = 0
      for (const item of items) {
        if (added >= MAX_CHART_INSERTS) break
        const category = item.genres?.map((g) => GENRE_MAP[g.name]).find(Boolean)
        if (!category) continue

        const id = `itunes-${item.id}`
        const { data: exists } = await supabase.from('songs').select('id').eq('id', id).maybeSingle()
        if (exists) continue
        // evita duplicar música curada equivalente
        const { data: dup } = await supabase.from('songs').select('id').ilike('title', item.name).ilike('artist', `%${item.artistName}%`).maybeSingle()
        if (dup) continue

        const info = await itunesLookup(Number(item.id))
        await sleep(THROTTLE_MS)
        if (!info?.previewUrl) continue

        await supabase.from('songs').insert({
          id,
          title: item.name,
          artist: item.artistName,
          year: info.releaseDate ? new Date(info.releaseDate).getFullYear() : null,
          genre: info.primaryGenreName ?? item.genres?.[0]?.name ?? null,
          category,
          preview_url: info.previewUrl,
          artwork_url: (info.artworkUrl100 ?? '').replace('100x100', '600x600'),
          album: info.collectionName ?? null,
          itunes_track_id: Number(item.id),
          source: 'chart',
          last_checked_at: new Date().toISOString(),
        })
        added++
      }
      summary.chartAdded = added
    }
  } catch (e) {
    summary.errors.push(`charts: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 3) Gera os desafios diários (hoje e amanhã; não sobrescreve existentes) ──
  try {
    const { data: playable } = await supabase
      .from('songs')
      .select('id, category')
      .eq('active', true)
      .not('preview_url', 'is', null)

    const all = playable ?? []
    for (const dateStr of [todayInSaoPaulo(0), todayInSaoPaulo(1)]) {
      const rows: { date: string; mode: string; payload: unknown }[] = []

      const singleAnswer = shuffle(all)[0]
      if (singleAnswer) rows.push({ date: dateStr, mode: 'single', payload: { answer: singleAnswer.id } })

      const coverPool = all.filter((s) => s.id !== singleAnswer?.id)
      const coverAnswer = shuffle(coverPool)[0]
      if (coverAnswer) rows.push({ date: dateStr, mode: 'cover', payload: { answer: coverAnswer.id } })

      for (const cat of CATEGORIES) {
        const pool = shuffle(all.filter((s) => s.category === cat))
        if (pool.length < SET_OPTIONS) continue
        const targets = pool.slice(0, SET_TARGETS).map((s) => s.id)
        const decoys = pool.slice(SET_TARGETS, SET_OPTIONS).map((s) => s.id)
        rows.push({ date: dateStr, mode: `set:${cat}`, payload: { targets, options: shuffle([...targets, ...decoys]) } })
      }

      if (rows.length > 0) {
        const { count } = await supabase
          .from('daily_challenges')
          .upsert(rows, { onConflict: 'date,mode', ignoreDuplicates: true, count: 'exact' })
        summary.challengesCreated += count ?? 0
      }
    }
  } catch (e) {
    summary.errors.push(`desafios: ${e instanceof Error ? e.message : String(e)}`)
  }

  return new Response(JSON.stringify(summary, null, 2), { headers: { 'content-type': 'application/json' } })
})
