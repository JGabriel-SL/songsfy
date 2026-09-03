// Songsfy — envio de Web Push para eventos de amizade.
//
// Chamada pelo trigger friendships_notify (migração 0007) via pg_net com
// body { event: 'friend_request' | 'friend_accepted', friendship_id }.
// Proteção: header `x-cron-secret` igual ao secret CRON_SECRET do projeto.
//
// Segredos necessários (supabase secrets set ...):
//   CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// Gere o par VAPID uma vez com `npx web-push generate-vapid-keys`.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

type PushEvent = 'friend_request' | 'friend_accepted'

interface Body {
  event?: PushEvent
  friendship_id?: number
}

interface Friendship {
  id: number
  requester_id: string
  addressee_id: string
  status: string
}

interface Subscription {
  id: number
  endpoint: string
  p256dh: string
  auth: string
  failures: number
}

const MAX_FAILURES = 5

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
  if (!body.event || !body.friendship_id) {
    return json({ error: 'body inválido' }, 400)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: friendship } = await supabase
    .from('friendships')
    .select('id,requester_id,addressee_id,status')
    .eq('id', body.friendship_id)
    .maybeSingle<Friendship>()
  if (!friendship) return json({ error: 'amizade não encontrada' }, 404)

  // Pedido → avisa quem recebeu. Aceite → avisa quem pediu.
  const recipientId = body.event === 'friend_request' ? friendship.addressee_id : friendship.requester_id
  const actorId = body.event === 'friend_request' ? friendship.requester_id : friendship.addressee_id

  const { data: actor } = await supabase.from('profiles').select('nickname,avatar_emoji').eq('id', actorId).maybeSingle()
  const name = (actor?.nickname as string | null) ?? 'Alguém'
  const emoji = (actor?.avatar_emoji as string | null) ?? '🎧'

  const payload =
    body.event === 'friend_request'
      ? { title: 'Pedido de amizade', body: `${emoji} ${name} quer comparar pontos com você`, url: '/?screen=friends', tag: 'songsfy-friends' }
      : { title: 'Pedido aceito!', body: `${emoji} ${name} aceitou — veja o placar de amigos`, url: '/?screen=friends', tag: 'songsfy-friends' }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth,failures')
    .eq('user_id', recipientId)
    .returns<Subscription[]>()

  const summary = { sent: 0, removed: 0, failed: 0 }
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
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

  return json(summary)
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
