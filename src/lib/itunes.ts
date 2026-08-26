import type { Song, TrackInfo } from '../types'

// iTunes Search API: gratuita, sem chave, com CORS liberado e prévias de ~30s.
// https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/

const CACHE_PREFIX = 'songsfy:itunes:v1:'
const CACHE_TTL = 30 * 86_400_000 // 30 dias

interface ItunesResult {
  trackName?: string
  artistName?: string
  collectionName?: string
  previewUrl?: string
  artworkUrl100?: string
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readCache(id: string): TrackInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { exp: number; data: TrackInfo }
    if (parsed.exp < Date.now()) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(id: string, data: TrackInfo): void {
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ exp: Date.now() + CACHE_TTL, data }))
  } catch {
    // localStorage cheio — segue sem cache
  }
}

// Diagnóstico da última busca que falhou (exibido na tela de erro para depuração remota)
export let lastDiag = ''

async function searchAt(url: string): Promise<{ list: ItunesResult[]; tag: string }> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { list: [], tag: `http${res.status}` }
    const json = (await res.json().catch(() => null)) as { results?: ItunesResult[] } | null
    if (!json || !Array.isArray(json.results)) return { list: [], tag: 'resposta-invalida' }
    return { list: json.results, tag: `${json.results.length}res` }
  } catch (e) {
    return { list: [], tag: `rede:${e instanceof Error ? e.name : '?'}` }
  }
}

export async function fetchTrack(song: Song): Promise<TrackInfo | null> {
  const cached = readCache(song.id)
  if (cached) return cached

  const term = encodeURIComponent(song.searchTerm ?? `${song.title} ${song.artist}`)
  const query = (params: string) => `search?term=${term}&media=music&entity=song&limit=25&${params}`

  // A CDN da Apple às vezes serve resposta vazia em alguns nós de borda (bug conhecido).
  // Fallback em camadas: BR → BR furando o cache com parâmetro descartável → loja US →
  // proxy same-origin (dev/preview), que faz a busca sair pelo servidor em vez do cliente.
  const layers: [string, string][] = [
    ['BR', `https://itunes.apple.com/${query('country=BR')}`],
    ['BRcb', `https://itunes.apple.com/${query(`country=BR&cb=${Date.now()}`)}`],
    ['UScb', `https://itunes.apple.com/${query(`country=US&cb=${Date.now()}`)}`],
    ['proxy', `/itunes/${query(`country=BR&cb=${Date.now()}`)}`],
  ]
  let results: ItunesResult[] = []
  const diag: string[] = []
  for (let i = 0; i < layers.length; i++) {
    const [name, url] = layers[i]
    const { list, tag } = await searchAt(url)
    diag.push(`${name}=${tag}`)
    results = list
    if (results.some((r) => r.previewUrl)) break
    // Falha de rede/CORS nas chamadas diretas: a rede deste cliente não fala com a
    // Apple — pula as demais tentativas diretas e vai direto para o proxy
    if (name !== 'proxy' && tag.startsWith('rede:')) i = layers.length - 2
  }

  const withPreview = results.filter((r) => r.previewUrl)
  if (withPreview.length === 0) {
    lastDiag = diag.join(' ')
    return null
  }

  const wantTitle = normalize(song.title)
  const wantArtist = normalize(song.artist).split(' ')[0]
  const best =
    withPreview.find(
      (r) => normalize(r.trackName ?? '').includes(wantTitle) && normalize(r.artistName ?? '').includes(wantArtist),
    ) ??
    withPreview.find((r) => normalize(r.trackName ?? '').includes(wantTitle)) ??
    withPreview[0]

  const info: TrackInfo = {
    previewUrl: best.previewUrl!,
    artworkUrl: (best.artworkUrl100 ?? '').replace('100x100', '600x600'),
    album: best.collectionName ?? '',
  }
  writeCache(song.id, info)
  return info
}
