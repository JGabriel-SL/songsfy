-- ═══════════════════════════════════════════════════════════════════
-- Songsfy — migração 0008: central de notificações
--
-- Antes, cada aviso era um trigger falando direto com a Edge Function e um
-- payload montado dentro dela (só sabia de amizade). Aqui o caminho passa a ser
-- sempre o mesmo: alguém chama push_notify(), que grava uma linha em
-- `notifications` (histórico + sino dentro do app) e só então dispara o push.
-- Evento novo = mais uma chamada de push_notify, sem tocar no envio.
--
-- Aplicar depois da 0007. Requer a Edge Function `send-push` republicada (ela
-- passou a receber notification_id) e os segredos project_url / cron_secret no
-- Vault — os mesmos da 0005. Sem eles nada quebra: a linha é gravada e o aviso
-- fica só dentro do app.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Histórico de avisos ───

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'friend_request', 'friend_accepted', 'battle_invite', 'battle_finished', 'friend_beat', 'daily_reminder'
  )),
  title text not null,
  body text not null,
  url text not null default '/',
  actor_id uuid references public.profiles (id) on delete set null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Anti-repetição: quem passa `dedupe` no data só recebe aquele aviso uma vez.
-- É o que segura "fulano te ultrapassou" em um por dia/modo e o lembrete diário
-- em um por dia, mesmo se o gatilho rodar várias vezes.
create unique index notifications_dedupe_idx on public.notifications (user_id, kind, (data ->> 'dedupe'))
  where (data ->> 'dedupe') is not null;

alter table public.notifications enable row level security;

create policy "avisos visíveis ao dono" on public.notifications
  for select using (auth.uid() = user_id);
-- Escrita só via push_notify / RPCs abaixo; a Edge Function usa service role.

-- Realtime: o sino acende sem esperar o próximo refetch
alter publication supabase_realtime add table public.notifications;

-- ─── Preferências (linha ausente = tudo ligado) ───

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  friends boolean not null default true,  -- pedido e aceite de amizade
  battle boolean not null default true,   -- convite e fim de batalha
  beaten boolean not null default true,   -- um amigo passou sua pontuação
  daily boolean not null default true,    -- lembrete de que os desafios saíram
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

create policy "preferências visíveis ao dono" on public.notification_prefs
  for select using (auth.uid() = user_id);

create function public.notification_prefs_set(
  p_friends boolean,
  p_battle boolean,
  p_beaten boolean,
  p_daily boolean
) returns void
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
  insert into notification_prefs as np (user_id, friends, battle, beaten, daily)
  values (v_user, coalesce(p_friends, true), coalesce(p_battle, true), coalesce(p_beaten, true), coalesce(p_daily, true))
  on conflict (user_id) do update
    set friends = excluded.friends,
        battle = excluded.battle,
        beaten = excluded.beaten,
        daily = excluded.daily,
        updated_at = now();
end;
$$;

grant execute on function public.notification_prefs_set to authenticated;

-- ─── Marcar como lido (p_id nulo = todas) ───

create function public.notifications_mark_read(p_id bigint default null)
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
  update notifications
     set read_at = now()
   where user_id = v_user
     and read_at is null
     and (p_id is null or id = p_id);
end;
$$;

grant execute on function public.notifications_mark_read to authenticated;

-- ═══ O caminho único de todo aviso ═══
--
-- Grava a linha e, se o dedupe deixou passar, pede o push. `p_send = false`
-- serve para quem manda em lote (o lembrete diário): grava agora, dispara uma
-- chamada HTTP só no fim em vez de uma por pessoa.

create function public.push_notify(
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_url text default '/',
  p_actor uuid default null,
  p_data jsonb default '{}',
  p_send boolean default true
) returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_id bigint;
  v_allowed boolean;
  v_url text;
  v_secret text;
begin
  if p_user is null or p_kind is null then
    return null;
  end if;

  -- Preferência do destinatário. Sem linha em notification_prefs, tudo ligado.
  select coalesce(
           case
             when p_kind in ('friend_request', 'friend_accepted') then np.friends
             when p_kind in ('battle_invite', 'battle_finished') then np.battle
             when p_kind = 'friend_beat' then np.beaten
             when p_kind = 'daily_reminder' then np.daily
             else true
           end, true)
    into v_allowed
    from (select p_user as uid) alvo
    left join notification_prefs np on np.user_id = alvo.uid;

  if not v_allowed then
    return null;
  end if;

  insert into notifications (user_id, kind, title, body, url, actor_id, data)
  values (p_user, p_kind, p_title, p_body, coalesce(p_url, '/'), p_actor, coalesce(p_data, '{}'::jsonb))
  on conflict do nothing
  returning id into v_id;

  -- dedupe pegou: já avisamos isso antes, não repete o push
  if v_id is null then
    return null;
  end if;

  if not p_send then
    return v_id;
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then
    return v_id; -- sem segredos: o aviso existe no app, só não vira push
  end if;

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('notification_id', v_id),
    timeout_milliseconds := 10000
  );
  return v_id;
end;
$$;

revoke all on function public.push_notify(uuid, text, text, text, text, uuid, jsonb, boolean) from public, anon, authenticated;

-- Dispara o envio de uma lista de avisos já gravados (uma chamada HTTP só).
create function public.push_notify_flush(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('notification_ids', to_jsonb(p_ids)),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.push_notify_flush(bigint[]) from public, anon, authenticated;

-- Nome legível do modo, para o corpo dos avisos
create function public.mode_label(p_mode text)
returns text
language sql
immutable
as $$
  select case p_mode
    when 'single' then 'Música do Dia'
    when 'cover' then 'Capa do Dia'
    when 'set' then 'Músicas do Dia'
    when 'marathon' then 'Maratona'
    when 'blitz' then 'Relâmpago'
    else p_mode
  end;
$$;

-- ═══ Evento 1: amizade (substitui o trigger da 0007) ═══
-- O texto do aviso sai daqui agora; a Edge Function virou só a carteira.

create or replace function public.friendships_notify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_kind text;
  v_actor uuid;
  v_target uuid;
  v_nick text;
  v_emoji text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    v_kind := 'friend_request';
    v_actor := new.requester_id;
    v_target := new.addressee_id;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    v_kind := 'friend_accepted';
    v_actor := new.addressee_id;
    v_target := new.requester_id;
  else
    return new;
  end if;

  select coalesce(nickname, 'Alguém'), coalesce(avatar_emoji, '🎧')
    into v_nick, v_emoji
    from profiles where id = v_actor;
  v_nick := coalesce(v_nick, 'Alguém');
  v_emoji := coalesce(v_emoji, '🎧');

  perform push_notify(
    v_target,
    v_kind,
    case when v_kind = 'friend_request' then 'Pedido de amizade' else 'Pedido aceito!' end,
    v_emoji || ' ' || v_nick ||
      case when v_kind = 'friend_request' then ' quer comparar pontos com você' else ' aceitou — veja o placar de amigos' end,
    '/?screen=friends',
    v_actor,
    jsonb_build_object('friendship_id', new.id)
  );
  return new;
end;
$$;

-- ═══ Evento 2: convite de batalha ═══
-- A sala só entrava por código; agora dá para chamar um amigo direto do lobby.
-- O dedupe por (sala, quem convidou) impede insistir no mesmo convite.

create function public.battle_invite(p_room uuid, p_friend uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_user uuid := auth.uid();
  v_room rooms%rowtype;
  v_nick text;
  v_emoji text;
begin
  if v_user is null then
    raise exception 'não autenticado';
  end if;
  if not are_friends(v_user, p_friend) then
    raise exception 'só dá para convidar amigos';
  end if;

  select * into v_room from rooms where id = p_room;
  if not found then
    raise exception 'sala não encontrada';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'a batalha já começou';
  end if;
  if not exists (select 1 from room_players where room_id = p_room and user_id = v_user) then
    raise exception 'você não está nesta sala';
  end if;
  if exists (select 1 from room_players where room_id = p_room and user_id = p_friend) then
    raise exception 'essa pessoa já está na sala';
  end if;

  select coalesce(nickname, 'Alguém'), coalesce(avatar_emoji, '🎧')
    into v_nick, v_emoji
    from profiles where id = v_user;
  v_nick := coalesce(v_nick, 'Alguém');
  v_emoji := coalesce(v_emoji, '🎧');

  perform push_notify(
    p_friend,
    'battle_invite',
    'Convite para batalha ⚔️',
    v_emoji || ' ' || v_nick || ' te chamou para a sala ' || v_room.code,
    '/?room=' || v_room.code,
    v_user,
    jsonb_build_object('room', v_room.code, 'dedupe', 'battle:' || p_room::text || ':' || v_user::text)
  );
end;
$$;

grant execute on function public.battle_invite to authenticated;

-- ═══ Evento 3: fim da batalha ═══
-- Só avisa quem NÃO respondeu a última rodada. Quem respondeu está com a tela
-- aberta olhando o resultado — mandar push para essa pessoa é puro barulho.

create function public.rooms_notify_finished()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_last int;
  v_winner uuid;
  v_top int;
  r record;
begin
  if not (old.status is distinct from 'finished' and new.status = 'finished') then
    return new;
  end if;

  v_last := new.round_index;

  select user_id, score into v_winner, v_top
    from room_players where room_id = new.id
    order by score desc, joined_at asc limit 1;

  for r in
    select rp.user_id, rp.score
      from room_players rp
     where rp.room_id = new.id
       and not exists (
         select 1 from room_answers ra
          where ra.room_id = new.id and ra.user_id = rp.user_id and ra.round_index = v_last
       )
  loop
    perform push_notify(
      r.user_id,
      'battle_finished',
      case when r.user_id = v_winner then 'Você venceu a batalha! 🏆' else 'A batalha acabou ⚔️' end,
      case when r.user_id = v_winner
        then 'Você fechou com ' || r.score || ' pontos.'
        else 'Você fez ' || r.score || ' — o topo ficou com ' || coalesce(v_top, 0) || '.' end,
      '/',
      null,
      jsonb_build_object('room', new.code, 'dedupe', 'battlefim:' || new.id::text)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists rooms_notify_finished on public.rooms;
create trigger rooms_notify_finished
after update on public.rooms
for each row execute function public.rooms_notify_finished();

-- ═══ Evento 4: um amigo passou sua pontuação ═══
-- No máximo um aviso por dia/modo por pessoa (dedupe), e no máximo 30 amigos por
-- resultado — um desafio do dia não pode virar tempestade de HTTP.

create function public.results_notify_beat()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_nick text;
  v_emoji text;
  r record;
begin
  if new.score is null then
    return new;
  end if;

  select coalesce(nickname, 'Alguém'), coalesce(avatar_emoji, '🎧')
    into v_nick, v_emoji
    from profiles where id = new.user_id;
  v_nick := coalesce(v_nick, 'Alguém');
  v_emoji := coalesce(v_emoji, '🎧');

  for r in
    select res.user_id as friend_id, res.score
      from friendships f
      join results res
        on res.user_id = case when f.requester_id = new.user_id then f.addressee_id else f.requester_id end
       and res.date = new.date
       and res.mode = new.mode
     where f.status = 'accepted'
       and new.user_id in (f.requester_id, f.addressee_id)
       and res.score < new.score
     limit 30
  loop
    perform push_notify(
      r.friend_id,
      'friend_beat',
      'Te ultrapassaram 😬',
      v_emoji || ' ' || v_nick || ' fez ' || new.score || ' no ' || mode_label(new.mode) ||
        ' — você fez ' || r.score || '.',
      '/?screen=friends',
      new.user_id,
      jsonb_build_object('day', new.date, 'mode', new.mode, 'dedupe', 'passou:' || new.date::text || ':' || new.mode)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists results_notify_beat on public.results;
create trigger results_notify_beat
after insert on public.results
for each row execute function public.results_notify_beat();

-- ═══ Evento 5: lembrete diário ═══
-- Só quem tem dispositivo assinado, deixou o lembrete ligado e ainda não jogou
-- nada hoje. Grava tudo primeiro e faz UMA chamada HTTP com a lista.

create function public.notify_daily_reminder()
returns int
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ids bigint[] := '{}';
  v_id bigint;
  r record;
begin
  for r in
    select distinct ps.user_id
      from push_subscriptions ps
      left join notification_prefs np on np.user_id = ps.user_id
     where coalesce(np.daily, true)
       and not exists (
         select 1 from results res where res.user_id = ps.user_id and res.date = v_today
       )
     limit 500
  loop
    v_id := push_notify(
      r.user_id,
      'daily_reminder',
      'Os desafios de hoje saíram 🎵',
      'Música, Capa e Músicas do Dia esperando você.',
      '/',
      null,
      jsonb_build_object('dedupe', 'diario:' || v_today::text),
      false -- envia em lote logo abaixo
    );
    if v_id is not null then
      v_ids := v_ids || v_id;
    end if;
  end loop;

  perform push_notify_flush(v_ids);
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

revoke all on function public.notify_daily_reminder() from public, anon, authenticated;

-- 15:00 UTC = 12:00 em São Paulo
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'songsfy-daily-reminder';
end;
$$;

select cron.schedule(
  'songsfy-daily-reminder',
  '0 15 * * *',
  $$ select public.notify_daily_reminder(); $$
);

-- Para inspecionar:
--   select kind, count(*) from notifications group by 1;
--   select id, status_code, error_msg from net._http_response order by id desc limit 10;
--   select public.notify_daily_reminder();  -- dispara na mão
