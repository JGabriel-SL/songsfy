-- Agendamento versionado dos jobs diários via pg_cron + pg_net.
--
--  • refresh-catalog  → todo dia às 03:00 (America/Sao_Paulo = 06:00 UTC).
--                       Revalida prévias, importa charts e gera os desafios de hoje/amanhã.
--  • battle_cleanup   → de hora em hora, apaga salas de Batalha com mais de 1 dia.
--
-- Pré-requisito (uma vez, fora da migration — são segredos, não vão para o git):
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<valor de CRON_SECRET>',   'cron_secret');
--
-- O mesmo CRON_SECRET deve estar configurado como secret da Edge Function
-- (supabase secrets set CRON_SECRET=...). Sem os dois segredos no Vault a função
-- refresh_catalog_http() apenas registra um aviso e não faz a chamada.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron to postgres;

-- ─── Dispara a Edge Function refresh-catalog ───────────────────────────────

create or replace function public.refresh_catalog_http()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_secret text;
  v_req_id bigint;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;

  if v_url is null or v_secret is null then
    raise warning 'refresh_catalog_http: segredos project_url/cron_secret ausentes no Vault — chamada ignorada';
    return null;
  end if;

  select net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/refresh-catalog',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    -- a função percorre até 60 músicas com 700 ms de throttle + charts: dá tempo de sobra
    timeout_milliseconds := 120000
  ) into v_req_id;

  return v_req_id;
end;
$$;

revoke all on function public.refresh_catalog_http() from public, anon, authenticated;

-- ─── Agendamentos (idempotentes: remove o job anterior de mesmo nome antes) ───

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('songsfy-refresh-catalog', 'songsfy-battle-cleanup');
end;
$$;

-- 06:00 UTC = 03:00 em São Paulo (BRT, sem horário de verão desde 2019)
select cron.schedule(
  'songsfy-refresh-catalog',
  '0 6 * * *',
  $$ select public.refresh_catalog_http(); $$
);

select cron.schedule(
  'songsfy-battle-cleanup',
  '15 * * * *',
  $$ select public.battle_cleanup(); $$
);

-- Para inspecionar:
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, content from net._http_response order by id desc limit 5;
