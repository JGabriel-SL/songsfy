-- ═══════════════════════════════════════════════════════════════════
-- Songsfy — migração 0006: Amigos (pedidos, aceite, placar por modo)
-- Aplicar no SQL Editor do Supabase (ou via `supabase db push`) após a 0005.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Código de amigo no perfil (6 letras sem ambiguidade, como o da Batalha) ───

alter table public.profiles
  add column if not exists friend_code text unique
  check (friend_code is null or friend_code ~ '^[A-Z0-9]{6}$');

create or replace function public.profile_gen_code()
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
    exit when not exists (select 1 from profiles where profiles.friend_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Perfis novos já nascem com código
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, friend_code)
  values (new.id, public.profile_gen_code())
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill dos perfis existentes, um por vez (evita colisão dentro de um único UPDATE)
do $$
declare
  r record;
begin
  for r in select id from public.profiles where friend_code is null loop
    update public.profiles set friend_code = public.profile_gen_code() where id = r.id;
  end loop;
end;
$$;

-- ─── Amizades ───
-- status: pending (requester pediu, addressee ainda não respondeu) → accepted
-- Recusar, cancelar e desfazer = apagar a linha.

create table public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_id <> addressee_id)
);

-- um par só pode ter uma linha, independente da direção
create unique index friendships_pair_idx on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index friendships_requester_idx on public.friendships (requester_id, status);

create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))
  );
$$;

-- ─── RLS ───

alter table public.friendships enable row level security;

create policy "amizades visíveis aos envolvidos" on public.friendships
  for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
-- Sem policy de insert/update/delete: escrita só via RPCs abaixo.

-- Amigos aceitos podem ver as estatísticas acumuladas uns dos outros
drop policy if exists "stats visíveis ao dono" on public.user_stats;
create policy "stats visíveis ao dono e aos amigos" on public.user_stats
  for select
  using (auth.uid() = user_id or public.are_friends(auth.uid(), user_id));

-- Realtime: badge de pedidos e toast ao vivo
alter publication supabase_realtime add table public.friendships;

-- ─── RPC: enviar pedido (por apelido OU por código) ───
-- Se a outra pessoa já tinha pedido para você, aceita direto.
-- Retorna o id da amizade.

create function public.friend_request(p_nickname text default null, p_code text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target uuid;
  v_existing friendships%rowtype;
  v_id bigint;
begin
  if v_user is null then
    raise exception 'não autenticado';
  end if;

  if p_code is not null and length(trim(p_code)) > 0 then
    select id into v_target from profiles where friend_code = upper(trim(p_code));
  elsif p_nickname is not null and length(trim(p_nickname)) > 0 then
    select id into v_target from profiles where nickname = trim(p_nickname) limit 1;
    if v_target is null then
      select id into v_target from profiles where lower(nickname) = lower(trim(p_nickname)) limit 1;
    end if;
  else
    raise exception 'informe um apelido ou um código';
  end if;

  if v_target is null then
    raise exception 'jogador não encontrado';
  end if;
  if v_target = v_user then
    raise exception 'não dá para adicionar você mesmo';
  end if;

  select * into v_existing from friendships
  where (requester_id = v_user and addressee_id = v_target)
     or (requester_id = v_target and addressee_id = v_user);

  if found then
    if v_existing.status = 'accepted' then
      raise exception 'vocês já são amigos';
    end if;
    if v_existing.requester_id = v_user then
      raise exception 'pedido já enviado';
    end if;
    -- pedido cruzado: a outra pessoa já tinha pedido → aceita
    update friendships set status = 'accepted', accepted_at = now() where id = v_existing.id;
    return v_existing.id;
  end if;

  if (select count(*) from friendships where status = 'accepted' and v_user in (requester_id, addressee_id)) >= 100 then
    raise exception 'limite de amigos atingido';
  end if;
  if (select count(*) from friendships where status = 'accepted' and v_target in (requester_id, addressee_id)) >= 100 then
    raise exception 'essa pessoa já atingiu o limite de amigos';
  end if;
  if (select count(*) from friendships where status = 'pending' and requester_id = v_user) >= 30 then
    raise exception 'muitos pedidos pendentes';
  end if;

  insert into friendships (requester_id, addressee_id) values (v_user, v_target) returning id into v_id;
  return v_id;
end;
$$;

-- ─── RPC: aceitar pedido (só quem recebeu) ───

create function public.friend_accept(p_id bigint)
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
  update friendships
     set status = 'accepted', accepted_at = now()
   where id = p_id and addressee_id = v_user and status = 'pending';
  if not found then
    raise exception 'pedido não encontrado';
  end if;
end;
$$;

-- ─── RPC: remover (recusar, cancelar ou desfazer amizade) ───

create function public.friend_remove(p_id bigint)
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
  delete from friendships where id = p_id and v_user in (requester_id, addressee_id);
  if not found then
    raise exception 'amizade não encontrada';
  end if;
end;
$$;

grant execute on function public.friend_request to authenticated;
grant execute on function public.friend_accept to authenticated;
grant execute on function public.friend_remove to authenticated;

-- ─── View: pontos semanais por modo (nunca somados entre modos) ───
-- single/cover: vitória vale (7 - tentativas) × 10; derrota 0.
-- set:<categoria>: acertos × 10.
-- Semana ISO (segunda a domingo).

create view public.weekly_mode_points
with (security_invoker = true) as
select r.user_id,
       r.mode,
       date_trunc('week', r.date::timestamp)::date as week_start,
       sum(case
             when r.mode in ('single', 'cover') and r.won then (7 - coalesce(r.attempts, 7)) * 10
             when r.mode like 'set:%' then coalesce(r.score, 0) * 10
             else 0
           end)::int as points,
       count(*)::int as days_played,
       avg(r.attempts) filter (where r.won) as avg_attempts,
       p.nickname,
       p.avatar_emoji
from public.results r
join public.profiles p on p.id = r.user_id
group by r.user_id, r.mode, week_start, p.nickname, p.avatar_emoji;

-- ─── RPC: visão geral dos amigos (uma linha por amigo aceito + o próprio usuário) ───
-- today / week / arcade / stats são mapas por modo:
--   today  → { "<mode>": { won, attempts, score, squares } }
--   week   → { "<mode>": { points, days, avg_attempts } }
--   arcade → { "marathon": best, "blitz": best }
--   stats  → { "<mode>": { played, wins, streak, max_streak } }
-- p_today: data do cliente (fuso local); sem ela usa a data em São Paulo.

create function public.friends_overview(p_today date default null)
returns table (
  user_id uuid,
  nickname text,
  avatar_emoji text,
  is_me boolean,
  friendship_id bigint,
  today jsonb,
  week jsonb,
  arcade jsonb,
  stats jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as id
  ),
  d as (
    select coalesce(p_today, (now() at time zone 'America/Sao_Paulo')::date) as today,
           date_trunc('week', coalesce(p_today, (now() at time zone 'America/Sao_Paulo')::date)::timestamp)::date as week_start
  ),
  people as (
    select me.id as uid, true as is_me, null::bigint as fid from me where me.id is not null
    union all
    select case when f.requester_id = me.id then f.addressee_id else f.requester_id end, false, f.id
    from friendships f, me
    where f.status = 'accepted' and me.id in (f.requester_id, f.addressee_id)
  )
  select p.id,
         p.nickname,
         p.avatar_emoji,
         pe.is_me,
         pe.fid,
         coalesce((
           select jsonb_object_agg(r.mode, jsonb_build_object('won', r.won, 'attempts', r.attempts, 'score', r.score, 'squares', r.squares))
           from results r, d where r.user_id = p.id and r.date = d.today
         ), '{}'::jsonb),
         coalesce((
           select jsonb_object_agg(w.mode, jsonb_build_object('points', w.points, 'days', w.days_played, 'avg_attempts', w.avg_attempts))
           from weekly_mode_points w, d where w.user_id = p.id and w.week_start = d.week_start
         ), '{}'::jsonb),
         coalesce((
           select jsonb_object_agg(a.mode, a.best_score)
           from arcade_scores a where a.user_id = p.id
         ), '{}'::jsonb),
         coalesce((
           select jsonb_object_agg(s.mode, jsonb_build_object('played', s.played, 'wins', s.wins, 'streak', s.streak, 'max_streak', s.max_streak))
           from user_stats s where s.user_id = p.id
         ), '{}'::jsonb)
  from people pe
  join profiles p on p.id = pe.uid
  order by pe.is_me desc, p.nickname nulls last;
$$;

grant execute on function public.friends_overview to authenticated;
