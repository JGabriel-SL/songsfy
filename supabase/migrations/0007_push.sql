-- ═══════════════════════════════════════════════════════════════════
-- Songsfy — migração 0007: notificações Web Push para pedidos de amizade
-- Aplicar após a 0006. Requer a Edge Function `send-push` publicada e os
-- segredos project_url / cron_secret no Vault (os mesmos da migração 0005).
-- Sem eles o trigger só ignora — o app segue avisando via Realtime.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Assinaturas (um usuário pode ter vários dispositivos) ───

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures int not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "assinaturas visíveis ao dono" on public.push_subscriptions
  for select using (auth.uid() = user_id);
-- Escrita só via RPCs; a Edge Function usa service role.

-- ─── RPC: registrar/atualizar assinatura do dispositivo atual ───
-- Upsert por endpoint: num dispositivo compartilhado, a assinatura passa para
-- a conta que está logada agora.

create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'não autenticado';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2048 then
    raise exception 'endpoint inválido';
  end if;
  if coalesce(length(p_p256dh), 0) = 0 or coalesce(length(p_auth), 0) = 0 then
    raise exception 'chaves inválidas';
  end if;
  insert into push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        failures = 0;
end;
$$;

create function public.push_unsubscribe(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

grant execute on function public.push_subscribe to authenticated;
grant execute on function public.push_unsubscribe to authenticated;

-- ─── Trigger: pedido enviado / aceito → chama a Edge Function send-push ───
-- net.http_post é assíncrono: a RPC de amizade não espera o envio.

create or replace function public.friendships_notify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
  v_event text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    v_event := 'friend_request';
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    v_event := 'friend_accepted';
  else
    return new;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then
    return new; -- sem segredos: fica só o aviso dentro do app (Realtime)
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('event', v_event, 'friendship_id', new.id),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;

drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify
after insert or update on public.friendships
for each row execute function public.friendships_notify();
