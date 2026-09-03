// Camada de dados do jogo: catálogo e desafios diários vindos do Supabase,
// com fallback completo para o modo local (catálogo estático + sorteio por seed
// + busca na iTunes API) quando o backend não está configurado ou está fora do ar.

import { CATALOG } from '../data/catalog'
import { dailyRng, seededShuffle, todayKey } from './daily'
import { fetchAlbumTrack, fetchTrack, isSingleRelease } from './itunes'
import { supabase } from './supabase'
import type { CategoryId, Song, TrackInfo } from '../types'

const SET_TARGETS = 6
const SET_OPTIONS = 9
const SONGS_CACHE_KEY = 'songsfy:remote:songs:v1'
const SONGS_CACHE_TTL = 6 * 3_600_000 // 6h
const CHALLENGES_CACHE_PREFIX = 'songsfy:remote:challenges:v1:'
const INIT_TIMEOUT_MS = 3500

interface DbSong {
  id: string
  title: string
  artist: string
  year: number | null
  genre: string | null
  category: CategoryId
  search_term: string | null
  preview_url: string | null
  artwork_url: string | null
  album: string | null
}

interface SetPayload {
  targets: string[]
  options: string[]
}

interface Challenges {
  single?: string
  cover?: string
  sets: Partial<Record<CategoryId, SetPayload>>
}

interface RemoteData {
  songs: Song[]
  tracks: Map<string, TrackInfo>
  challenges: Challenges
}

let remote: RemoteData | null = null

function toSong(row: DbSong): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    year: row.year ?? 0,
    genre: row.genre ?? 'Música',
    category: row.category,
    searchTerm: row.search_term ?? undefined,
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // sem espaço: segue sem cache
  }
}

function buildRemote(rows: DbSong[], challenges: Challenges): RemoteData {
  const songs = rows.map(toSong)
  const tracks = new Map<string, TrackInfo>()
  for (const row of rows) {
    if (row.preview_url) {
      tracks.set(row.id, { previewUrl: row.preview_url, artworkUrl: row.artwork_url ?? '', album: row.album ?? '' })
    }
  }
  return { songs, tracks, challenges }
}

async function fetchRemote(): Promise<RemoteData | null> {
  if (!supabase) return null
  const today = todayKey()

  const [songsRes, challengesRes] = await Promise.all([
    supabase.from('songs').select('id,title,artist,year,genre,category,search_term,preview_url,artwork_url,album').eq('active', true),
    supabase.from('daily_challenges').select('mode,payload').eq('date', today),
  ])
  if (songsRes.error || !songsRes.data || songsRes.data.length === 0) return null

  const challenges: Challenges = { sets: {} }
  for (const row of challengesRes.data ?? []) {
    if (row.mode === 'single') challenges.single = (row.payload as { answer: string }).answer
    else if (row.mode === 'cover') challenges.cover = (row.payload as { answer: string }).answer
    else if (row.mode.startsWith('set:')) challenges.sets[row.mode.slice(4) as CategoryId] = row.payload as SetPayload
  }

  writeJson(SONGS_CACHE_KEY, { at: Date.now(), rows: songsRes.data })
  writeJson(CHALLENGES_CACHE_PREFIX + today, challenges)
  return buildRemote(songsRes.data as DbSong[], challenges)
}

function loadFromCache(): RemoteData | null {
  const cached = readJson<{ at: number; rows: DbSong[] }>(SONGS_CACHE_KEY)
  if (!cached || Date.now() - cached.at > SONGS_CACHE_TTL) return null
  const challenges = readJson<Challenges>(CHALLENGES_CACHE_PREFIX + todayKey()) ?? { sets: {} }
  return buildRemote(cached.rows, challenges)
}

/** Carrega catálogo + desafios do backend (com timeout e cache). Nunca rejeita. */
export async function initRemoteData(): Promise<void> {
  if (!supabase) return
  const fromCache = loadFromCache()
  if (fromCache) {
    remote = fromCache
    // atualiza em segundo plano
    void fetchRemote().then((fresh) => {
      if (fresh) remote = fresh
    })
    return
  }
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), INIT_TIMEOUT_MS))
  remote = (await Promise.race([fetchRemote().catch(() => null), timeout])) ?? null
}

export function isRemoteActive(): boolean {
  return remote !== null
}

/** Catálogo em uso: remoto quando disponível, senão o estático embarcado. */
export function gameCatalog(): Song[] {
  return remote?.songs ?? CATALOG
}

export function gameSongById(id: string): Song | undefined {
  return gameCatalog().find((s) => s.id === id)
}

/** Prévia/capa: instantânea quando veio do banco; senão busca na iTunes API (fallback). */
export async function getTrack(song: Song): Promise<TrackInfo | null> {
  const fromDb = remote?.tracks.get(song.id)
  if (fromDb) return fromDb
  return fetchTrack(song)
}

/**
 * Como `getTrack`, mas garantindo capa de álbum: quando o que está no banco é um
 * lançamento avulso ("… - Single"/"… - EP"), busca na iTunes a versão em álbum.
 */
export async function getAlbumTrack(song: Song): Promise<TrackInfo | null> {
  const fromDb = remote?.tracks.get(song.id)
  if (fromDb && fromDb.artworkUrl && fromDb.album && !isSingleRelease(fromDb.album)) return fromDb
  return (await fetchAlbumTrack(song)) ?? fromDb ?? null
}

/**
 * Músicas-isca da Capa do Dia: cada uma rende um álbum para as opções de palpite.
 * Determinístico por dia, uma por artista e priorizando a mesma categoria da resposta.
 */
export function dailyCoverDecoys(answer: Song, count: number): Song[] {
  const rng = dailyRng('cover:options')
  const pool = seededShuffle(
    playableSongs().filter((s) => s.id !== answer.id && s.artist !== answer.artist),
    rng,
  )
  const byArtist = new Map<string, Song>()
  for (const s of pool) if (!byArtist.has(s.artist)) byArtist.set(s.artist, s)
  const unique = [...byArtist.values()]
  return [
    ...unique.filter((s) => s.category === answer.category),
    ...unique.filter((s) => s.category !== answer.category),
  ].slice(0, count)
}

// ─── Desafios do dia (remoto → fallback: sorteio determinístico local) ───

function playableSongs(): Song[] {
  // no modo remoto, só entram músicas com prévia; no local, o catálogo curado inteiro
  if (!remote) return CATALOG
  return remote.songs.filter((s) => remote!.tracks.has(s.id))
}

export function dailySingleAnswer(): Song {
  if (remote?.challenges.single) {
    const song = gameSongById(remote.challenges.single)
    if (song) return song
  }
  const rng = dailyRng('single')
  return CATALOG[Math.floor(rng() * CATALOG.length)]
}

export function dailyCoverAnswer(): Song {
  if (remote?.challenges.cover) {
    const song = gameSongById(remote.challenges.cover)
    if (song) return song
  }
  const singleIdx = Math.floor(dailyRng('single')() * CATALOG.length)
  const idx = Math.floor(dailyRng('cover')() * CATALOG.length)
  return CATALOG[idx === singleIdx ? (idx + 1) % CATALOG.length : idx]
}

export function dailySetPuzzle(category: CategoryId): { targets: Song[]; options: Song[] } {
  const payload = remote?.challenges.sets[category]
  if (payload) {
    const targets = payload.targets.map(gameSongById).filter((s): s is Song => !!s)
    const options = payload.options.map(gameSongById).filter((s): s is Song => !!s)
    if (targets.length === SET_TARGETS && options.length === SET_OPTIONS) return { targets, options }
  }
  // fallback local determinístico (mesma lógica original)
  const rng = dailyRng(`set:${category}`)
  let pool = seededShuffle(playableSongs().filter((s) => s.category === category), rng)
  if (pool.length < SET_OPTIONS) pool = seededShuffle(CATALOG.filter((s) => s.category === category), rng)
  const targets = pool.slice(0, SET_TARGETS)
  const decoys = pool.slice(SET_TARGETS, SET_OPTIONS)
  return { targets, options: seededShuffle([...targets, ...decoys], rng) }
}
