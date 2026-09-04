// Modo Batalha: salas multiplayer em tempo real (estilo Kahoot).
// Toda a lógica de jogo (sorteio, pontuação, avanço de rodada) roda nas RPCs do
// Supabase; o cliente só reflete o estado da sala e envia respostas.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { CategoryId } from '../types'

export type RoomStatus = 'lobby' | 'round' | 'reveal' | 'finished'

export interface RoomSettings {
  rounds: number
  roundSeconds: number
  category: CategoryId | null
}

export interface Room {
  id: string
  code: string
  host_id: string
  status: RoomStatus
  settings: RoomSettings
  playlist: { options: string[]; preview: string }[]
  round_index: number
  round_started_at: string | null
  revealed_answer: string | null
  updated_at: string
}

export interface RoomPlayer {
  user_id: string
  score: number
  nickname: string | null
  avatar_emoji: string
}

export interface RoomAnswer {
  user_id: string
  round_index: number
  song_id: string
  correct: boolean
  elapsed_ms: number
  points: number
}

export interface RoomState {
  room: Room
  players: RoomPlayer[]
  answers: RoomAnswer[] // apenas da rodada atual
}

const POLL_MS = 4000

function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('sala não encontrada')) return 'Sala não encontrada. Confira o código.'
  if (m.includes('já começou')) return 'Essa partida já começou.'
  if (m.includes('sala cheia')) return 'A sala está cheia (30 jogadores).'
  if (m.includes('não autenticado')) return 'Entre com um apelido para jogar.'
  if (m.includes('catálogo insuficiente')) return 'Não há músicas suficientes com prévia nessa categoria.'
  if (m.includes('rodada encerrada') || m.includes('tempo esgotado')) return 'A rodada já acabou.'
  if (m.includes('já respondeu')) return 'Você já respondeu esta rodada.'
  return message
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Modo online não configurado.' }
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { data: null, error: friendly(error.message) }
  return { data: data as T, error: null }
}

export const battleApi = {
  createRoom: (settings: RoomSettings) =>
    rpc<string>('battle_create_room', {
      p_rounds: settings.rounds,
      p_round_seconds: settings.roundSeconds,
      p_category: settings.category,
    }),
  joinRoom: (code: string) => rpc<string>('battle_join_room', { p_code: code.trim().toUpperCase() }),
  leave: (roomId: string) => rpc<null>('battle_leave', { p_room: roomId }),
  start: (roomId: string) => rpc<null>('battle_start', { p_room: roomId }),
  answer: (roomId: string, round: number, songId: string) =>
    rpc<number>('battle_answer', { p_room: roomId, p_round: round, p_song: songId }),
  advance: (roomId: string) => rpc<null>('battle_advance', { p_room: roomId }),
  /** Convida um amigo para a sala (vira notificação + push do lado dele). */
  invite: (roomId: string, friendId: string) => rpc<null>('battle_invite', { p_room: roomId, p_friend: friendId }),
}

/** Diferença (ms) entre o relógio do servidor e o local: serverNow ≈ Date.now() + offset */
export async function fetchClockOffset(): Promise<number> {
  if (!supabase) return 0
  const t0 = Date.now()
  const { data } = await supabase.rpc('battle_server_time')
  const t1 = Date.now()
  if (!data) return 0
  const server = new Date(data as string).getTime()
  return server - (t0 + t1) / 2
}

async function fetchState(roomId: string): Promise<RoomState | null> {
  if (!supabase) return null
  const { data: room } = await supabase.from('rooms').select('*').eq('id', roomId).maybeSingle()
  if (!room) return null
  const r = room as Room
  const [playersRes, answersRes] = await Promise.all([
    supabase.from('room_players').select('user_id,score,joined_at,profiles(nickname,avatar_emoji)').eq('room_id', roomId).order('joined_at'),
    r.round_index >= 0
      ? supabase.from('room_answers').select('user_id,round_index,song_id,correct,elapsed_ms,points').eq('room_id', roomId).eq('round_index', r.round_index)
      : Promise.resolve({ data: [] as RoomAnswer[] }),
  ])
  const players: RoomPlayer[] = ((playersRes.data ?? []) as unknown as {
    user_id: string
    score: number
    profiles: { nickname: string | null; avatar_emoji: string } | null
  }[]).map((p) => ({
    user_id: p.user_id,
    score: p.score,
    nickname: p.profiles?.nickname ?? null,
    avatar_emoji: p.profiles?.avatar_emoji ?? '🎧',
  }))
  return { room: r, players, answers: (answersRes.data ?? []) as RoomAnswer[] }
}

/**
 * Estado ao vivo de uma sala: Realtime (postgres_changes) + refetch, com polling
 * de segurança para o caso do canal cair. Qualquer evento dispara um refetch
 * completo — simples e imune a eventos perdidos/fora de ordem.
 */
export function useBattleRoom(roomId: string | null) {
  const [state, setState] = useState<RoomState | null>(null)
  const [lost, setLost] = useState(false)
  const inflight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (!roomId) return
    if (inflight.current) return inflight.current
    inflight.current = fetchState(roomId)
      .then((s) => {
        if (s) setState(s)
        else setLost(true)
      })
      .catch(() => {})
      .finally(() => {
        inflight.current = null
      })
    return inflight.current
  }, [roomId])

  useEffect(() => {
    if (!roomId || !supabase) return
    setState(null)
    setLost(false)
    void refresh()

    const channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_answers', filter: `room_id=eq.${roomId}` }, () => void refresh())
      .subscribe()

    const poll = setInterval(() => void refresh(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase?.removeChannel(channel)
    }
  }, [roomId, refresh])

  return { state, lost, refresh }
}

// ─── Link de convite ───

export function inviteUrl(code: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', code)
  return url.toString()
}

/** Lê e remove `?room=CODE` da URL (deep link de convite). */
export function consumeInviteCode(): string | null {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('room')
  if (!code) return null
  url.searchParams.delete('room')
  window.history.replaceState({}, '', url.toString())
  return code.toUpperCase()
}
