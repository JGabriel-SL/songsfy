// Songsfy — envio de Web Push a partir das linhas de `notifications`.
//
// Chamada por public.push_notify / push_notify_flush (migração 0008) via pg_net:
//   { notification_id: 123 }            → um aviso
//   { notification_ids: [1, 2, 3] }     → lote (lembrete diário)
// Proteção: header `x-cron-secret` igual ao secret CRON_SECRET do projeto.
//
// O texto do aviso vem pronto do banco — aqui não se decide nada sobre conteúdo,
// só para quem mandar e o que fazer com assinatura morta.
//
// Segredos necessários (supabase secrets set ...):
//   CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

interface Body {
  notification_id?: number
  notification_ids?: number[]
}

interface Notification {
  id: number
  user_id: string
  kind: string
  title: string
  body: string
  url: string
}

interface Subscription {
  id: number
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  failures: number
}

const MAX_FAILURES = 5
const MAX_BATCH = 500

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ error: 'não autorizado' }, 401)
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@songsfy.app'
  if (!publicKey || !privateKey) {
    return json({ error: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configurados' }, 500)
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const body = (await req.json().catch(() => ({}))) as Body
  const ids = (body.notification_ids ?? (body.notification_id ? [body.notification_id] : []))
    .filter((id) => Number.isInteger(id))
    .slice(0, MAX_BATCH)
  if (ids.length === 0) {
    return json({ error: 'body inválido: informe notification_id ou notification_ids' }, 400)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id,user_id,kind,title,body,url')
    .in('id', ids)
    .returns<Notification[]>()
  if (!notifications || notifications.length === 0) {
    return json({ error: 'nenhum aviso encontrado' }, 404)
  }

  // Uma consulta só de assinaturas para todos os destinatários do lote
  const recipients = [...new Set(notifications.map((n) => n.user_id))]
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth,failures')
    .in('user_id', recipients)
    .returns<Subscription[]>()

  const byUser = new Map<string, Subscription[]>()
  for (const sub of subs ?? []) {
    const list = byUser.get(sub.user_id)
    if (list) list.push(sub)
    else byUser.set(sub.user_id, [sub])
  }

  const summary = { sent: 0, removed: 0, failed: 0, notifications: notifications.length }

  for (const notification of notifications) {
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: notification.url || '/',
      // uma notificação por tipo na bandeja: a nova substitui a anterior
      tag: `songsfy-${notification.kind}`,
      id: notification.id,
    })

    for (const sub of byUser.get(notification.user_id) ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'normal' },
        )
        summary.sent++
        await supabase.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failures: 0 }).eq('id', sub.id)
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0
        // 404/410: assinatura expirou ou o usuário revogou → apaga
        if (status === 404 || status === 410 || sub.failures + 1 >= MAX_FAILURES) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          summary.removed++
        } else {
          await supabase.from('push_subscriptions').update({ failures: sub.failures + 1 }).eq('id', sub.id)
          summary.failed++
        }
      }
    }
  }

  return json(summary)
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
