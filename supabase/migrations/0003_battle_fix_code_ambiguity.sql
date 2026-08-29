-- ═══════════════════════════════════════════════════════════════════
-- Songsfy — migração 0003: corrige "column reference "code" is ambiguous"
-- ao criar sala. Reaplica battle_gen_code / battle_create_room com
-- `create or replace` (a versão no banco divergia da 0002) e força
-- `#variable_conflict use_column` como proteção extra.
-- Aplicar no SQL Editor do Supabase (ou via `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.battle_gen_code()
returns text
language plpgsql
as $$
#variable_conflict use_column
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.rooms r where r.code = v_code and r.status <> 'finished'
    );
  end loop;
  return v_code;
end;
$$;

create or replace function public.battle_create_room(p_rounds int, p_round_seconds int, p_category text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
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

  update rooms set status = 'finished' where host_id = v_user and status <> 'finished';

  insert into rooms (code, host_id, settings)
  values (battle_gen_code(), v_user,
          jsonb_build_object('rounds', p_rounds, 'roundSeconds', p_round_seconds, 'category', p_category))
  returning id into v_id;

  insert into room_players (room_id, user_id) values (v_id, v_user);
  return v_id;
end;
$$;

create or replace function public.battle_join_room(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_room rooms%rowtype;
begin
  if v_user is null then raise exception 'não autenticado'; end if;

  select * into v_room from rooms r
  where r.code = upper(trim(p_code)) and r.status <> 'finished'
  order by r.created_at desc limit 1;

  if not found then raise exception 'sala não encontrada'; end if;

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

grant execute on function public.battle_create_room to authenticated;
grant execute on function public.battle_join_room to authenticated;
