// Amigos: pedidos, aceite e placar por modo restrito ao círculo.
// Toda a escrita passa pelas RPCs do Supabase (migração 0006); o cliente só lê
// a visão geral (friends_overview) e a lista de pedidos, e reage a mudanças
// via Realtime + refetch (mesmo padrão do modo Batalha).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { todayKey } from './daily'
import { useAuth } from './auth'

// ─── Tipos ───

export interface TodayEntry {
  won: boolean
  attempts: number | null
  score: number | null
  squares: string | null
}

export interface WeekEntry {
  points: number
  days: number
  avg_attempts: number | null
}

export interface StatsEntry {
  played: number
  wins: number
  streak: number
  max_streak: number
}

export interface FriendOverview {
  user_id: string
  nickname: string | null
  avatar_emoji: string
  is_me: boolean
  friendship_id: number | null
  today: Record<string, TodayEntry>
  week: Record<string, WeekEntry>
  arcade: { marathon?: number; blitz?: number }
  stats: Record<string, StatsEntry>
}

export interface FriendRequest {
  id: number
  direction: 'incoming' | 'outgoing'
  user_id: string
  nickname: string | null
  avatar_emoji: string
  created_at: string
}

// ─── API ───

function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('não autenticado')) return 'Entre com uma conta para adicionar amigos.'
  if (m.includes('não encontrado')) return 'Não achei ninguém com esse apelido ou código.'
  if (m.includes('você mesmo')) return 'Esse é você! Compartilhe seu código com outra pessoa.'
  if (m.includes('já são amigos')) return 'Vocês já são amigos.'
  if (m.includes('pedido já enviado')) return 'Você já enviou um pedido para essa pessoa.'
  if (m.includes('limite de amigos')) return 'Limite de 100 amigos atingido.'
  if (m.includes('muitos pedidos')) return 'Você tem muitos pedidos pendentes — aguarde respostas antes de enviar mais.'
  if (m.includes('informe um apelido')) return 'Digite um apelido ou um código de amigo.'
  return message
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Modo online não configurado.' }
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { data: null, error: friendly(error.message) }
  return { data: data as T, error: null }
}

const CODE_RE = /^[A-Z0-9]{6}$/

export const friendsApi = {
  /** Aceita apelido ou código (6 letras). */
  request: (query: string) => {
    const q = query.trim()
    const asCode = q.toUpperCase()
    return CODE_RE.test(asCode) ? rpc<number>('friend_request', { p_code: asCode }) : rpc<number>('friend_request', { p_nickname: q })
  },
  accept: (id: number) => rpc<null>('friend_accept', { p_id: id }),
  remove: (id: number) => rpc<null>('friend_remove', { p_id: id }),
  overview: () => rpc<FriendOverview[]>('friends_overview', { p_today: todayKey() }),
}

interface RequestRow {
  id: number
  requester_id: string
  addressee_id: string
  created_at: string
  requester: { nickname: string | null; avatar_emoji: string } | null
  addressee: { nickname: string | null; avatar_emoji: string } | null
}

async function fetchRequests(myId: string): Promise<FriendRequest[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('friendships')
    .select(
      'id,requester_id,addressee_id,created_at,requester:profiles!friendships_requester_id_fkey(nickname,avatar_emoji),addressee:profiles!friendships_addressee_id_fkey(nickname,avatar_emoji)',
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  return ((data ?? []) as unknown as RequestRow[]).map((r) => {
    const incoming = r.addressee_id === myId
    const other = incoming ? r.requester : r.addressee
    return {
      id: r.id,
      direction: incoming ? 'incoming' : 'outgoing',
      user_id: incoming ? r.requester_id : r.addressee_id,
      nickname: other?.nickname ?? null,
      avatar_emoji: other?.avatar_emoji ?? '🎧',
      created_at: r.created_at,
    }
  })
}

// ─── Link de convite (?friend=CODE) ───

const INVITE_KEY = 'songsfy:friends:invite:v1'

export function inviteFriendUrl(code: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('friend', code)
  return url.toString()
}

/** Lê e remove `?friend=CODE` da URL, guardando o código até haver sessão. */
export function consumeFriendInvite(): string | null {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('friend')
  if (code) {
    url.searchParams.delete('friend')
    window.history.replaceState({}, '', url.toString())
    try {
      sessionStorage.setItem(INVITE_KEY, code.toUpperCase())
    } catch {
      // sem espaço
    }
    return code.toUpperCase()
  }
  try {
    return sessionStorage.getItem(INVITE_KEY)
  } catch {
    return null
  }
}

function clearInvite(): void {
  try {
    sessionStorage.removeItem(INVITE_KEY)
  } catch {
    // ignore
  }
}

export function nickOf(p: { nickname: string | null }): string {
  return p.nickname ?? 'Anônimo'
}

// ─── Contexto ───

interface FriendsContextValue {
  friends: FriendOverview[] // sem o próprio usuário
  me: FriendOverview | null
  requests: FriendRequest[]
  pendingCount: number // pedidos recebidos
  friendIds: string[]
  loading: boolean
  error: string | null
  inviteCode: string | null
  inviteNotice: string | null
  refresh: () => Promise<void>
  sendRequest: (query: string) => Promise<string | null>
  accept: (id: number) => Promise<string | null>
  remove: (id: number) => Promise<string | null>
}

const FriendsContext = createContext<FriendsContextValue | null>(null)

const POLL_MS = 30_000

export function FriendsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const myId = auth.user?.id ?? null

  const [overview, setOverview] = useState<FriendOverview[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(() => consumeFriendInvite())
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const inflight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (!supabase || !myId) return
    if (inflight.current) return inflight.current
    inflight.current = (async () => {
      const [ov, reqs] = await Promise.all([friendsApi.overview(), fetchRequests(myId)])
      if (ov.error) {
        setError(ov.error)
      } else {
        setError(null)
        const rows = ov.data ?? []
        setOverview(rows)
        setRequests(reqs)
      }
    })()
      .catch(() => setError('Não consegui carregar seus amigos.'))
      .finally(() => {
        inflight.current = null
        setLoading(false)
      })
    return inflight.current
  }, [myId])

  // Carga inicial + Realtime + polling de segurança + refetch ao voltar para a aba
  useEffect(() => {
    if (!supabase || !myId) {
      setOverview([])
      setRequests([])
      return
    }
    setLoading(true)
    void refresh()

    const channel = supabase
      .channel(`friends:${myId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${myId}` }, () => void refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${myId}` }, () => void refresh())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships', filter: `requester_id=eq.${myId}` }, () => void refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships', filter: `requester_id=eq.${myId}` }, () => void refresh())
      // DELETE só traz a chave primária (sem filtro por coluna): refaz a leitura e pronto
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friendships' }, () => void refresh())
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
  }, [myId, refresh])

  // Convite pendente (?friend=CODE) + sessão → envia o pedido uma única vez
  useEffect(() => {
    if (!myId || !inviteCode) return
    const code = inviteCode
    setInviteCode(null)
    clearInvite()
    void friendsApi.request(code).then(({ error: err }) => {
      setInviteNotice(err ? `Convite ${code}: ${err}` : `Pedido enviado para o dono do código ${code}! ✓`)
      void refresh()
    })
  }, [myId, inviteCode, refresh])

  // Badge da aba Amigos
  const pendingCount = requests.filter((r) => r.direction === 'incoming').length

  const mutate = useCallback(
    async (fn: () => Promise<{ error: string | null }>): Promise<string | null> => {
      const { error: err } = await fn()
      if (!err) await refresh()
      return err
    },
    [refresh],
  )

  const value = useMemo<FriendsContextValue>(() => {
    const me = overview.find((r) => r.is_me) ?? null
    const friends = overview.filter((r) => !r.is_me)
    return {
      friends,
      me,
      requests,
      pendingCount,
      friendIds: friends.map((f) => f.user_id),
      loading,
      error,
      inviteCode,
      inviteNotice,
      refresh,
      sendRequest: (q) => mutate(() => friendsApi.request(q)),
      accept: (id) => mutate(() => friendsApi.accept(id)),
      remove: (id) => mutate(() => friendsApi.remove(id)),
    }
  }, [overview, requests, pendingCount, loading, error, inviteCode, inviteNotice, refresh, mutate])

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>
}

export function useFriends(): FriendsContextValue {
  const ctx = useContext(FriendsContext)
  if (!ctx) throw new Error('useFriends precisa estar dentro de <FriendsProvider>')
  return ctx
}

// ─── Semana corrente (segunda-feira), no fuso local — casa com date_trunc('week') no servidor ───

export function weekStartKey(): string {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7 // segunda = 0
  d.setDate(d.getDate() - dow)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
