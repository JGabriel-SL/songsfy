// Songsfy — seed do catálogo por artista (roda uma vez, localmente).
//
// Lê scripts/artists.json, consulta a iTunes Search API e insere as faixas mais
// populares de cada artista em public.songs (com prévia, capa, álbum e ano já
// preenchidos). Músicas que já existem são ignoradas (upsert ignoreDuplicates).
//
// Uso:
//   node --env-file=.env.local scripts/seed-catalog.mjs            # insere no banco
//   node --env-file=.env.local scripts/seed-catalog.mjs --dry-run  # só mostra o que faria
//   node --env-file=.env.local scripts/seed-catalog.mjs --per-artist=4 --only=rock,hiphop
//
// Variáveis necessárias em .env.local:
//   VITE_SUPABASE_URL           (já existe)
//   SUPABASE_SERVICE_ROLE_KEY   (Settings → API → service_role; NÃO commitar)

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const DRY_RUN = !!args['dry-run']
const PER_ARTIST = Number(args['per-artist'] ?? 5)
const ONLY = args.only ? String(args.only).split(',') : null
const THROTTLE_MS = 700

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!DRY_RUN && (!url || !key)) {
  console.error('Faltam VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY em .env.local')
  process.exit(1)
}
const supabase = DRY_RUN ? null : createClient(url, key)

const artists = JSON.parse(readFileSync(new URL('./artists.json', import.meta.url), 'utf8'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Versões que não servem para o jogo (o jogador espera a gravação original)
const BAD_TITLE =
  /\b(live|ao vivo|remix|acoustic|acustico|karaoke|instrumental|remaster(ed)?|version|versao|edit(ed)?|clean|demo|cover|speed ?up|slowed|sped up|mix|medley|christmas|natal|santa claus|wonderland)\b|\(feat\.?[^)]*\)\s*$/i
// Título base para dedupe: remove parênteses/colchetes e " - algo"
const baseTitle = (t) => norm(t.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''))

async function searchArtist(name) {
  const q = new URLSearchParams({ term: name, media: 'music', entity: 'song', country: 'BR', limit: '50' })
  const res = await fetch(`https://itunes.apple.com/search?${q}`)
  if (!res.ok) throw new Error(`iTunes ${res.status} para "${name}"`)
  const json = await res.json()
  return json.results ?? []
}

function pickTracks(results, artistName, category) {
  const want = norm(artistName)
  const seen = new Set()
  const out = []
  for (const r of results) {
    if (!r.previewUrl || !r.trackName || !r.artistName) continue
    // artista principal precisa bater (aceita "Artista & Fulano", "Artista feat. X")
    if (!norm(r.artistName).startsWith(want)) continue
    if (BAD_TITLE.test(r.trackName)) continue
    const base = baseTitle(r.trackName)
    // faixa homônima ao artista (intro/skit) ou duplicada
    if (!base || base === want || seen.has(base)) continue
    seen.add(base)
    out.push({
      id: `itunes-${r.trackId}`,
      title: r.trackName.replace(/\s*\(feat\.[^)]*\)\s*$/i, '').trim(),
      artist: artistName,
      year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : null,
      genre: r.primaryGenreName ?? null,
      category,
      preview_url: r.previewUrl,
      artwork_url: (r.artworkUrl100 ?? '').replace('100x100', '600x600'),
      album: r.collectionName ?? null,
      itunes_track_id: r.trackId,
      source: 'curated',
      active: true,
      last_checked_at: new Date().toISOString(),
    })
    if (out.length >= PER_ARTIST) break
  }
  return out
}

const totals = {}
let inserted = 0
let skipped = 0

for (const [category, names] of Object.entries(artists)) {
  if (ONLY && !ONLY.includes(category)) continue
  totals[category] = 0
  for (const name of names) {
    let tracks = []
    try {
      tracks = pickTracks(await searchArtist(name), name, category)
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`)
      continue
    }
    if (tracks.length === 0) {
      console.warn(`  ! ${name}: nenhuma faixa encontrada (confira a grafia)`)
    } else if (DRY_RUN) {
      console.log(`[${category}] ${name}: ${tracks.map((t) => t.title).join(' · ')}`)
    } else {
      const { data, error } = await supabase
        .from('songs')
        .upsert(tracks, { onConflict: 'id', ignoreDuplicates: true })
        .select('id')
      if (error) console.error(`  ✗ ${name}: ${error.message}`)
      else {
        inserted += data.length
        skipped += tracks.length - data.length
        console.log(`[${category}] ${name}: +${data.length}${data.length < tracks.length ? ` (${tracks.length - data.length} já existiam)` : ''}`)
      }
    }
    totals[category] += tracks.length
    await sleep(THROTTLE_MS)
  }
}

console.log('\nPor categoria:', totals)
if (!DRY_RUN) console.log(`Inseridas: ${inserted} · já existiam: ${skipped}`)
