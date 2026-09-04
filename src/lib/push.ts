// Web Push: assinatura do dispositivo para avisos de amizade.
// O envio acontece no servidor (Edge Function send-push, disparada por trigger);
// aqui só cuidamos da permissão, da assinatura e de registrá-la no Supabase.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || undefined

export type PushStatus =
  | 'unconfigured' // sem chave VAPID no build
  | 'unsupported' // navegador sem Push API
  | 'ios-not-installed' // iOS só aceita push com o PWA instalado na tela inicial
  | 'denied' // usuário negou a permissão
  | 'off' // suportado, ainda não assinado
  | 'on' // assinado neste dispositivo

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  // O SW é registrado pelo vite-plugin-pwa; em dev (sem build) não existe.
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (!pushSupported()) return 'unsupported'
  // No iOS a Push API existe no Safari desde a 16.4, mas o subscribe só funciona com o
  // PWA instalado na tela inicial. Sem essa checagem antes, o botão "Ativar" aparece e
  // estoura na cara do usuário — melhor já explicar o que falta.
  if (isIos() && !isStandalone()) return 'ios-not-installed'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await currentSubscription().catch(() => null)
  return sub ? 'on' : 'off'
}

function subscriptionPayload(sub: PushSubscription): { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent: string } | null {
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
  return { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_user_agent: navigator.userAgent.slice(0, 200) }
}

/** Pede permissão, assina e registra no servidor. Retorna mensagem de erro ou null. */
export async function enablePush(): Promise<string | null> {
  if (!supabase) return 'Modo online não configurado.'
  if (!VAPID_PUBLIC_KEY) return 'Notificações não configuradas neste build.'
  if (!pushSupported()) return isIos() ? 'No iPhone, instale o Songsfy na tela inicial para receber avisos.' : 'Este navegador não suporta notificações.'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'Permissão de notificações negada.'

  const reg = await getRegistration()
  if (!reg) return 'Service worker indisponível (rode o build de produção).'

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY) })
    } catch (e) {
      return `Não consegui assinar as notificações: ${(e as Error).message}`
    }
  }
  const payload = subscriptionPayload(sub)
  if (!payload) return 'Assinatura inválida.'
  const { error } = await supabase.rpc('push_subscribe', payload)
  return error ? error.message : null
}

/** Cancela a assinatura deste dispositivo (local + servidor). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null)
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => false)
  if (supabase) await supabase.rpc('push_unsubscribe', { p_endpoint: endpoint })
}

/** Ao logar: garante que a assinatura existente deste dispositivo pertence à conta atual. */
export async function syncPushSubscription(): Promise<void> {
  if (!supabase || !VAPID_PUBLIC_KEY || !pushSupported()) return
  if (Notification.permission !== 'granted') return
  const sub = await currentSubscription().catch(() => null)
  if (!sub) return
  const payload = subscriptionPayload(sub)
  if (payload) await supabase.rpc('push_subscribe', payload)
}

/** Antes de sair da conta: o dispositivo não deve continuar recebendo avisos dela. */
export async function unsubscribePushOnSignOut(): Promise<void> {
  if (!supabase || !pushSupported()) return
  const sub = await currentSubscription().catch(() => null)
  if (!sub) return
  await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint })
  // mantém a assinatura local: se outra conta logar, syncPushSubscription a reatribui
}

// ─── Estado compartilhado ───
// Quem liga/desliga (PushSettings) e quem só observa (o toast do App, que se cala
// quando o aviso do sistema já vai chegar) precisam enxergar o mesmo status.

let cachedStatus: PushStatus | null = null
const statusListeners = new Set<(s: PushStatus) => void>()

/** Relê o status e avisa todos os componentes montados. */
export async function refreshPushStatus(): Promise<PushStatus> {
  const status = await getPushStatus()
  cachedStatus = status
  for (const listener of statusListeners) listener(status)
  return status
}

/** `null` enquanto a primeira leitura não termina. */
export function usePushStatus(): PushStatus | null {
  const [status, setStatus] = useState<PushStatus | null>(cachedStatus)
  useEffect(() => {
    statusListeners.add(setStatus)
    if (cachedStatus === null) void refreshPushStatus()
    else setStatus(cachedStatus)
    return () => {
      statusListeners.delete(setStatus)
    }
  }, [])
  return status
}

// ─── Badge no ícone do app (Android/desktop; iOS ainda ignora) ───

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/** Mostra (ou limpa) o contador na tela inicial — pedidos de amizade pendentes. */
export function setAppBadge(count: number): void {
  const nav = navigator as BadgeNavigator
  const call = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.()
  void call?.catch(() => {}) // sem permissão / sem suporte: silencioso de propósito
}
