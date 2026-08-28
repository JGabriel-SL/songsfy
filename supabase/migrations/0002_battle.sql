-- ═══════════════════════════════════════════════════════════════════
-- Songsfy — migração 0002: modo Batalha (multiplayer em tempo real, estilo Kahoot)
-- Aplicar no SQL Editor do Supabase (ou via `supabase db push`) após a 0001.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Tabelas ───

-- Sala: criada pelo anfitrião, encontrada pelo código de 6 letras.
-- status: lobby → round ⇄ reveal → finished
-- settings: {"rounds": 10, "roundSeconds": 15, "category": null | "pop" | ...}
-- playlist: [{"options": [4 song ids], "preview": "<url da prévia>"}, ...]
--           (sem o id da resposta — ele fica em room_secrets)
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','round','reveal','finished')),
  settings jsonb not null default '{"rounds":10,"roundSeconds":15,"category":null}',
  playlist jsonb not null default '[]',
  round_index int not null default -1,
  round_started_at timestamptz,        -- início da rodada (já inclui a contagem regressiva de 3s)
  revealed_answer text,                -- id da resposta da rodada atual, preenchido ao entrar em 'reveal'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Respostas de cada rodada: só as RPCs (security definer) leem — sem policy de select.
create table public.room_secrets (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  answers text[] not null
);

create table public.room_players (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  score int not null default 0,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.room_answers (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  round_index int not null,
  song_id text not null,
  correct boolean not null,
  elapsed_ms int not null,
  points int not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, round_index)
);

create index rooms_code_idx on public.rooms (code) where status <> 'finished';
create index room_answers_round_idx on public.room_answers (room_id, round_index);

-- ─── RLS ───

alter table public.rooms enable row level security;
alter table public.room_secrets enable row level security;
alter table public.room_players enable row level security;
alter table public.room_answers enable row level security;

create policy "salas visíveis a logados" on public.rooms for select to authenticated using (true);
create policy "jogadores visíveis a logados" on public.room_players for select to authenticated using (true);
create policy "respostas visíveis a logados" on public.room_answers for select to authenticated using (true);
-- room_secrets: nenhuma policy → invisível ao cliente. Escrita em tudo: só via RPCs.

-- ─── Realtime: os clientes assinam mudanças nestas tabelas ───

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.room_answers;

-- ─── Helpers ───

create function public.battle_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_touch before update on public.rooms
for each row execute function public.battle_touch();

-- Relógio do servidor, para o cliente compensar o desvio do relógio local.
create function public.battle_server_time()
returns timestamptz
language sql
stable
as $$ select now() $$;

-- Código sem letras ambíguas (0/O, 1/I/L)
create function public.battle_gen_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms where rooms.code = v_code and status <> 'finished');
  end loop;
  return v_code;
end;
$$;

-- ─── RPC: criar sala ───

create function public.battle_create_room(p_rounds int, p_round_seconds int, p_category text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  if p_rounds not between 3 and 20 then raise exception 'número de rodadas inválido'; end if;
  if p_round_seconds not between 8 and 30 then raise exception 'tempo de rodada inválido'; end if;
  if p_category is not null and p_category not in ('pop','rock','brasil','sertanejo','eletronica','hiphop') then
    raise exception 'categoria inválida';
  end if;

  -- salas antigas do mesmo anfitrião ainda abertas são encerradas
  update rooms set status = 'finished' where host_id = v_user and status <> 'finished';

  insert into rooms (code, host_id, settings)
  values (battle_gen_code(), v_user,
          jsonb_build_object('rounds', p_rounds, 'roundSeconds', p_round_seconds, 'category', p_category))
  returning id into v_id;

  insert into room_players (room_id, user_id) values (v_id, v_user);
  return v_id;
end;
$$;

-- ─── RPC: entrar numa sala pelo código ───

create function public.battle_join_room(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room rooms%rowtype;
begin
  if v_user is null then raise exception 'não autenticado'; end if;

  select * into v_room from rooms
  where code = upper(trim(p_code)) and status <> 'finished'
  order by created_at desc limit 1;

  if not found then raise exception 'sala não encontrada'; end if;

  -- quem já está na sala pode voltar a qualquer momento; novatos só no lobby
  if not exists (select 1 from room_players where room_id = v_room.id and user_id = v_user) then
    if v_room.status <> 'lobby' then raise exception 'a partida já começou'; end if;
    if (select count(*) from room_players where room_id = v_room.id) >= 30 then
      raise exception 'sala cheia';
    end if;
    insert into room_players (room_id, user_id) values (v_room.id, v_user);
  end if;

  return v_room.id;
end;
$$;

-- ─── RPC: sair da sala (no lobby). Se o anfitrião sai, a sala fecha. ───

create function public.battle_leave(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room rooms%rowtype;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select * into v_room from rooms where id = p_room;
  if not found then return; end if;

  if v_room.host_id = v_user then
    update rooms set status = 'finished' where id = p_room;
  elsif v_room.status = 'lobby' then
    delete from room_players where room_id = p_room and user_id = v_user;
  end if;
end;
$$;

-- ─── RPC: iniciar a partida (anfitrião) — sorteia a playlist no servidor ───

create function public.battle_start(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room rooms%rowtype;
  v_rounds int;
  v_category text;
  v_playlist jsonb := '[]'::jsonb;
  v_answers text[] := '{}';
  v_song record;
  v_options text[];
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select * into v_room from rooms where id = p_room for update;
  if not found then raise exception 'sala não encontrada'; end if;
  if v_room.host_id <> v_user then raise exception 'só o anfitrião pode iniciar'; end if;
  if v_room.status <> 'lobby' then raise exception 'a partida já começou'; end if;

  v_rounds := (v_room.settings ->> 'rounds')::int;
  v_category := v_room.settings ->> 'category';

  for v_song in
    select id, category, preview_url from songs
    where active and preview_url is not null
      and (v_category is null or category = v_category)
    order by random()
    limit v_rounds
  loop
    -- 3 distratores da mesma categoria, embaralhados junto com a resposta
    select array_agg(id order by random()) into v_options
    from (
      select v_song.id as id
      union all
      (select id from songs
       where active and preview_url is not null and category = v_song.category and id <> v_song.id
       order by random() limit 3)
    ) o;

    v_playlist := v_playlist || jsonb_build_object('options', to_jsonb(v_options), 'preview', v_song.preview_url);
    v_answers := v_answers || v_song.id;
  end loop;

  if jsonb_array_length(v_playlist) < 3 then
    raise exception 'catálogo insuficiente para essa categoria';
  end if;

  insert into room_secrets (room_id, answers) values (p_room, v_answers)
  on conflict (room_id) do update set answers = excluded.answers;

  update rooms set
    playlist = v_playlist,
    settings = settings || jsonb_build_object('rounds', jsonb_array_length(v_playlist)),
    round_index = 0,
    status = 'round',
    revealed_answer = null,
    round_started_at = now() + interval '3 seconds'
  where id = p_room;
end;
$$;

-- ─── RPC: responder a rodada atual — pontua pela velocidade (estilo Kahoot) ───
-- Retorna os pontos ganhos (0 se errou).

create function public.battle_answer(p_room uuid, p_round int, p_song text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room rooms%rowtype;
  v_answer text;
  v_seconds int;
  v_elapsed_ms int;
  v_correct boolean;
  v_points int := 0;
  v_players int;
  v_answered int;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select * into v_room from rooms where id = p_room for update;
  if not found then raise exception 'sala não encontrada'; end if;
  if v_room.status <> 'round' or v_room.round_index <> p_round then
    raise exception 'rodada encerrada';
  end if;
  if not exists (select 1 from room_players where room_id = p_room and user_id = v_user) then
    raise exception 'você não está nesta sala';
  end if;

  v_seconds := (v_room.settings ->> 'roundSeconds')::int;
  v_elapsed_ms := greatest(0, (extract(epoch from (now() - v_room.round_started_at)) * 1000)::int);
  if v_elapsed_ms > v_seconds * 1000 + 1500 then
    raise exception 'tempo esgotado';
  end if;

  select answers[p_round + 1] into v_answer from room_secrets where room_id = p_room;
  v_correct := (p_song = v_answer);
  if v_correct then
    v_points := 500 + round(500 * greatest(0, 1 - v_elapsed_ms::numeric / (v_seconds * 1000)))::int;
  end if;

  insert into room_answers (room_id, user_id, round_index, song_id, correct, elapsed_ms, points)
  values (p_room, v_user, p_round, p_song, v_correct, v_elapsed_ms, v_points)
  on conflict do nothing;
  if not found then raise exception 'você já respondeu'; end if;

  update room_players set score = score + v_points where room_id = p_room and user_id = v_user;

  -- todo mundo respondeu: revela sem esperar o relógio
  select count(*) into v_players from room_players where room_id = p_room;
  select count(*) into v_answered from room_answers where room_id = p_room and round_index = p_round;
  if v_answered >= v_players then
    update rooms set status = 'reveal', revealed_answer = v_answer where id = p_room;
  end if;

  return v_points;
end;
$$;

-- ─── RPC: avançar (round → reveal → próxima rodada / fim) ───
-- Anfitrião sempre pode; qualquer jogador pode quando o tempo da rodada já estourou
-- (assim a partida não trava se o anfitrião cair).

create function public.battle_advance(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room rooms%rowtype;
  v_seconds int;
  v_expired boolean;
begin
  if v_user is null then raise exception 'não autenticado'; end if;
  select * into v_room from rooms where id = p_room for update;
  if not found then raise exception 'sala não encontrada'; end if;
  if not exists (select 1 from room_players where room_id = p_room and user_id = v_user) then
    raise exception 'você não está nesta sala';
  end if;

  v_seconds := (v_room.settings ->> 'roundSeconds')::int;
  v_expired := v_room.round_started_at is not null
    and now() > v_room.round_started_at + make_interval(secs => v_seconds + 2);

  if v_room.host_id <> v_user and not (v_room.status = 'round' and v_expired)
     and not (v_room.status = 'reveal' and now() > v_room.updated_at + interval '20 seconds') then
    raise exception 'aguarde o anfitrião';
  end if;

  if v_room.status = 'round' then
    update rooms set
      status = 'reveal',
      revealed_answer = (select answers[v_room.round_index + 1] from room_secrets where room_id = p_room)
    where id = p_room;
  elsif v_room.status = 'reveal' then
    if v_room.round_index + 1 >= jsonb_array_length(v_room.playlist) then
      update rooms set status = 'finished' where id = p_room;
    else
      update rooms set
        status = 'round',
        round_index = round_index + 1,
        revealed_answer = null,
        round_started_at = now() + interval '3 seconds'
      where id = p_room;
    end if;
  end if;
end;
$$;

grant execute on function public.battle_server_time to authenticated;
grant execute on function public.battle_create_room to authenticated;
grant execute on function public.battle_join_room to authenticated;
grant execute on function public.battle_leave to authenticated;
grant execute on function public.battle_start to authenticated;
grant execute on function public.battle_answer to authenticated;
grant execute on function public.battle_advance to authenticated;

-- ─── Limpeza: salas com mais de 1 dia somem (chame via pg_cron ou junto do refresh-catalog) ───

create function public.battle_cleanup()
returns void
language sql
security definer
set search_path = public
as $$ delete from rooms where created_at < now() - interval '1 day' $$;
