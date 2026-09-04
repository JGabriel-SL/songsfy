// Central de notificações: o mesmo aviso que vira push também fica gravado em
// `notifications` (migração 0008). Aqui só lemos — quem escreve é o banco, via
// push_notify. O sino, o badge no ícone do app e o toast de tela aberta bebem
// todos desta fonte, então um evento novo no SQL aparece no app sem mudar nada.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { setAppBadge } from './push'
import { isScreen, type Screen } from './screens'

export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'battle_invite'
  | 'battle_finished'
  | 'friend_beat'
  | 'daily_reminder'

export interface AppNotification {
  id: number
  kind: NotificationKind
  title: string
  body: string
  url: string
  read_at: string | null
  created_at: string
}

export interface NotificationPrefs {
  friends: boolean
  battle: boolean
  beaten: boolean
  daily: boolean
}

export const DEFAULT_PREFS: NotificationPrefs = { friends: true, battle: true, beaten: true, daily: true }

export const KIND_EMOJI: Record<NotificationKind, string> = {
  friend_request: '👋',
  friend_accepted: '🎉',
  battle_invite: '⚔️',
  battle_finished: '🏁',
  friend_beat: '😬',
  daily_reminder: '🎵',
}

interface NotificationsContextValue {
  items: AppNotification[]
  unreadCount: number
  loading: boolean
  /** Aviso recém-chegado com o app aberto — some sozinho. */
  toast: AppNotification | null
  dismissToast: () => void
  prefs: NotificationPrefs
  refresh: () => Promise<void>
  markRead: (id?: number) => Promise<void>
  savePrefs: (prefs: NotificationPrefs) => Promise<string | null>
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications fora do NotificationsProvider')
  return ctx
}

const LIMIT = 30
const POLL_MS = 60_000
const TOAST_MS = 6000

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const myId = auth.user?.id ?? null

  const [items, setItems] = useState<AppNotification[]>([])
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<AppNotification | null>(null)

  // Só o que chegou depois da primeira carga vira toast — abrir o app não pode
  // disparar um toast para cada aviso antigo que estava lá.
  const knownIds = useRef<Set<number> | null>(null)

  const refresh = useCallback(async () => {
    if (!supabase || !myId) return
    const { data, error } = await supabase
      .from('notifications')
      .select('id,kind,title,body,url,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(LIMIT)
    if (error || !data) return

    const rows = data as AppNotification[]
    setItems(rows)

    if (knownIds.current) {
      const fresh = rows.find((n) => !knownIds.current!.has(n.id) && !n.read_at)
      if (fresh) setToast(fresh)
    }
    knownIds.current = new Set(rows.map((n) => n.id))
  }, [myId])

  const loadPrefs = useCallback(async () => {
    if (!supabase || !myId) return
    const { data } = await supabase.from('notification_prefs').select('friends,battle,beaten,daily').maybeSingle()
    setPrefs((data as NotificationPrefs | null) ?? DEFAULT_PREFS)
  }, [myId])

  // Carga + Realtime + polling de segurança + refetch ao voltar para a aba
  useEffect(() => {
    if (!supabase || !myId) {
      setItems([])
      setPrefs(DEFAULT_PREFS)
      knownIds.current = null
      return
    }
    setLoading(true)
    void Promise.all([refresh(), loadPrefs()]).finally(() => setLoading(false))

    const channel = supabase
      .channel(`notifications:${myId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId}` }, () => void refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId}` }, () => void refresh())
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
  }, [myId, refresh, loadPrefs])

  // O service worker avisa a aba quando alguém toca na notificação do sistema
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'push-received' || e.data?.type === 'push-resubscribed') void refresh()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [refresh])

  const unreadCount = items.filter((n) => !n.read_at).length

  // Contador no ícone da tela inicial (Android/desktop; iOS ignora)
  useEffect(() => {
    setAppBadge(myId ? unreadCount : 0)
  }, [myId, unreadCount])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  const markRead = useCallback(
    async (id?: number) => {
      if (!supabase || !myId) return
      // otimista: o sino apaga na hora, o servidor confirma depois
      const now = new Date().toISOString()
      setItems((prev) => prev.map((n) => (id === undefined || n.id === id ? { ...n, read_at: n.read_at ?? now } : n)))
      await supabase.rpc('notifications_mark_read', { p_id: id ?? null })
    },
    [myId],
  )

  const savePrefs = useCallback(
    async (next: NotificationPrefs): Promise<string | null> => {
      if (!supabase || !myId) return 'Entre na sua conta para mudar os avisos.'
      const previous = prefs
      setPrefs(next)
      const { error } = await supabase.rpc('notification_prefs_set', {
        p_friends: next.friends,
        p_battle: next.battle,
        p_beaten: next.beaten,
        p_daily: next.daily,
      })
      if (error) {
        setPrefs(previous)
        return error.message
      }
      return null
    },
    [myId, prefs],
  )

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      unreadCount,
      loading,
      toast,
      dismissToast: () => setToast(null),
      prefs,
      refresh,
      markRead,
      savePrefs,
    }),
    [items, unreadCount, loading, toast, prefs, refresh, markRead, savePrefs],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

/**
 * Para onde um aviso leva. `screen` navega sem recarregar; `href` é o convite de
 * batalha, que precisa do ?room=CODE na URL para a sala ser lida na abertura.
 */
export function notificationTarget(url: string): { screen: Screen } | { href: string } {
  const parsed = new URL(url || '/', window.location.origin)
  const screen = parsed.searchParams.get('screen')
  if (isScreen(screen)) return { screen }
  if (parsed.searchParams.has('room')) return { href: parsed.toString() }
  return { screen: 'home' }
}

/** "agora", "há 5 min", "há 3 h", "ontem", "12/03" */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `há ${hours} h`
  if (hours < 48) return 'ontem'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
