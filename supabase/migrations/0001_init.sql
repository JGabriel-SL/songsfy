-- ═══════════════════════════════════════════════════════════════════
-- Songsfy — migração inicial: catálogo, desafios diários, contas e placares
-- Aplicar no SQL Editor do Supabase (ou via `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════

-- ─── Tabelas ───

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text unique check (nickname is null or char_length(nickname) between 2 and 20),
  avatar_emoji text not null default '🎧' check (char_length(avatar_emoji) <= 8),
  created_at timestamptz not null default now()
);

create table public.songs (
  id text primary key,
  title text not null,
  artist text not null,
  year int,
  genre text,
  category text not null check (category in ('pop','rock','brasil','sertanejo','eletronica','hiphop')),
  search_term text,          -- termo alternativo p/ busca no iTunes quando título+artista retorna covers
  preview_url text,          -- preenchido pela função refresh-catalog
  artwork_url text,
  album text,
  itunes_track_id bigint,
  active boolean not null default true,
  source text not null default 'curated' check (source in ('curated','chart')),
  added_at timestamptz not null default now(),
  last_checked_at timestamptz
);

-- Desafios do dia gerados pelo cron: todos os jogadores veem o mesmo.
-- mode: 'single' | 'cover' | 'set:pop' | 'set:rock' | ...
-- payload: single/cover → {"answer": "<song_id>"}
--          set          → {"targets": [6 ids], "options": [9 ids]}
create table public.daily_challenges (
  date date not null,
  mode text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (date, mode)
);

create table public.results (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  mode text not null,
  won boolean not null,
  attempts int check (attempts is null or attempts between 0 and 10),
  score int check (score is null or score between 0 and 1000),
  squares text check (squares is null or char_length(squares) <= 24),
  created_at timestamptz not null default now(),
  unique (user_id, date, mode)
);

create table public.arcade_scores (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('marathon','blitz')),
  best_score int not null check (best_score between 0 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

create table public.user_stats (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null,
  played int not null default 0,
  wins int not null default 0,
  streak int not null default 0,
  max_streak int not null default 0,
  last_win_day date,
  distribution jsonb not null default '[0,0,0,0,0,0]',
  primary key (user_id, mode)
);

create index results_leaderboard_idx on public.results (date, mode);
create index songs_category_idx on public.songs (category) where active;

-- ─── Perfil criado automaticamente para cada usuário novo ───

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ─── RLS ───

alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.results enable row level security;
alter table public.arcade_scores enable row level security;
alter table public.user_stats enable row level security;

create policy "perfis são públicos" on public.profiles for select using (true);
create policy "editar o próprio perfil" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "catálogo é público" on public.songs for select using (true);
create policy "desafios são públicos" on public.daily_challenges for select using (true);
create policy "resultados são públicos" on public.results for select using (true);
create policy "placares arcade são públicos" on public.arcade_scores for select using (true);
create policy "stats visíveis ao dono" on public.user_stats for select using (auth.uid() = user_id);

-- Escrita em songs/daily_challenges: somente service role (nenhuma policy de insert/update).
-- Escrita em results/arcade_scores/user_stats: somente via RPCs abaixo.

-- ─── RPC: registrar resultado diário (e atualizar stats na mesma transação) ───

create function public.submit_result(
  p_date date,
  p_mode text,
  p_won boolean,
  p_attempts int,
  p_score int,
  p_squares text
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
  if p_date > current_date or p_date < current_date - 1 then
    raise exception 'data fora da janela permitida';
  end if;
  if p_attempts is not null and p_attempts not between 0 and 10 then
    raise exception 'tentativas inválidas';
  end if;
  if p_score is not null and p_score not between 0 and 1000 then
    raise exception 'pontuação inválida';
  end if;

  insert into results (user_id, date, mode, won, attempts, score, squares)
  values (v_user, p_date, p_mode, p_won, p_attempts, p_score, left(p_squares, 24))
  on conflict (user_id, date, mode) do nothing;

  -- já havia resultado para este dia/modo: não conta stats duas vezes
  if not found then
    return;
  end if;

  insert into user_stats as us (user_id, mode, played, wins, streak, max_streak, last_win_day, distribution)
  values (
    v_user, p_mode, 1,
    case when p_won then 1 else 0 end,
    case when p_won then 1 else 0 end,
    case when p_won then 1 else 0 end,
    case when p_won then p_date end,
    case when p_won and p_attempts between 1 and 6
      then jsonb_set('[0,0,0,0,0,0]'::jsonb, array[(p_attempts - 1)::text], to_jsonb(1))
      else '[0,0,0,0,0,0]'::jsonb end
  )
  on conflict (user_id, mode) do update set
    played = us.played + 1,
    wins = us.wins + case when p_won then 1 else 0 end,
    streak = case when p_won
      then case when us.last_win_day >= p_date - 1 then us.streak + 1 else 1 end
      else 0 end,
    max_streak = greatest(us.max_streak, case when p_won
      then case when us.last_win_day >= p_date - 1 then us.streak + 1 else 1 end
      else 0 end),
    last_win_day = case when p_won then p_date else us.last_win_day end,
    distribution = case when p_won and p_attempts between 1 and 6
      then jsonb_set(us.distribution, array[(p_attempts - 1)::text],
        to_jsonb(coalesce((us.distribution ->> (p_attempts - 1))::int, 0) + 1))
      else us.distribution end;
end;
$$;

-- ─── RPC: registrar recorde arcade ───

create function public.submit_arcade(p_mode text, p_score int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if p_mode not in ('marathon', 'blitz') then
    raise exception 'modo inválido';
  end if;
  if p_score not between 0 and 1000000 then
    raise exception 'pontuação inválida';
  end if;

  insert into arcade_scores as a (user_id, mode, best_score)
  values (auth.uid(), p_mode, p_score)
  on conflict (user_id, mode) do update
    set best_score = greatest(a.best_score, excluded.best_score), updated_at = now();
end;
$$;

-- ─── RPC: importação única das estatísticas locais (ao criar a conta) ───

create function public.import_stats(
  p_mode text,
  p_played int,
  p_wins int,
  p_streak int,
  p_max_streak int,
  p_last_win_day date,
  p_distribution jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;

  -- só importa se ainda não há stats deste modo (nunca sobrescreve progresso online)
  insert into user_stats (user_id, mode, played, wins, streak, max_streak, last_win_day, distribution)
  values (
    auth.uid(), p_mode,
    least(greatest(coalesce(p_played, 0), 0), 10000),
    least(greatest(coalesce(p_wins, 0), 0), 10000),
    least(greatest(coalesce(p_streak, 0), 0), 10000),
    least(greatest(coalesce(p_max_streak, 0), 0), 10000),
    p_last_win_day,
    case when jsonb_typeof(p_distribution) = 'array' and jsonb_array_length(p_distribution) = 6
      then p_distribution else '[0,0,0,0,0,0]'::jsonb end
  )
  on conflict (user_id, mode) do nothing;
end;
$$;

grant execute on function public.submit_result to authenticated;
grant execute on function public.submit_arcade to authenticated;
grant execute on function public.import_stats to authenticated;

-- ─── Views de ranking (respeitam o RLS das tabelas-base) ───

create view public.daily_leaderboard
with (security_invoker = true) as
select r.date, r.mode, r.won, r.attempts, r.score, r.squares, r.created_at,
       r.user_id, p.nickname, p.avatar_emoji
from public.results r
join public.profiles p on p.id = r.user_id;

create view public.arcade_leaderboard
with (security_invoker = true) as
select a.mode, a.best_score, a.updated_at, a.user_id, p.nickname, p.avatar_emoji
from public.arcade_scores a
join public.profiles p on p.id = a.user_id;

-- ─── Seed: catálogo curado (prévias/capas são preenchidas pela função refresh-catalog) ───

insert into public.songs (id, title, artist, year, genre, category, search_term, source) values
  ('blinding-lights', 'Blinding Lights', 'The Weeknd', 2019, 'Synth-pop', 'pop', null, 'curated'),
  ('shape-of-you', 'Shape of You', 'Ed Sheeran', 2017, 'Pop', 'pop', null, 'curated'),
  ('bad-guy', 'bad guy', 'Billie Eilish', 2019, 'Electropop', 'pop', null, 'curated'),
  ('levitating', 'Levitating', 'Dua Lipa', 2020, 'Disco-pop', 'pop', null, 'curated'),
  ('rolling-in-the-deep', 'Rolling in the Deep', 'Adele', 2010, 'Soul-pop', 'pop', null, 'curated'),
  ('shake-it-off', 'Shake It Off', 'Taylor Swift', 2014, 'Pop', 'pop', null, 'curated'),
  ('uptown-funk', 'Uptown Funk', 'Mark Ronson & Bruno Mars', 2014, 'Funk-pop', 'pop', null, 'curated'),
  ('happy', 'Happy', 'Pharrell Williams', 2013, 'Pop-soul', 'pop', null, 'curated'),
  ('as-it-was', 'As It Was', 'Harry Styles', 2022, 'Synth-pop', 'pop', null, 'curated'),
  ('flowers', 'Flowers', 'Miley Cyrus', 2023, 'Pop', 'pop', null, 'curated'),
  ('firework', 'Firework', 'Katy Perry', 2010, 'Dance-pop', 'pop', null, 'curated'),
  ('poker-face', 'Poker Face', 'Lady Gaga', 2008, 'Electropop', 'pop', null, 'curated'),
  ('cant-stop-the-feeling', 'Can''t Stop the Feeling!', 'Justin Timberlake', 2016, 'Disco-pop', 'pop', null, 'curated'),
  ('senorita', 'Señorita', 'Shawn Mendes & Camila Cabello', 2019, 'Pop latino', 'pop', null, 'curated'),
  ('stay-laroi', 'STAY', 'The Kid LAROI & Justin Bieber', 2021, 'Pop', 'pop', null, 'curated'),
  ('espresso', 'Espresso', 'Sabrina Carpenter', 2024, 'Pop', 'pop', null, 'curated'),
  ('bohemian-rhapsody', 'Bohemian Rhapsody', 'Queen', 1975, 'Rock progressivo', 'rock', null, 'curated'),
  ('smells-like-teen-spirit', 'Smells Like Teen Spirit', 'Nirvana', 1991, 'Grunge', 'rock', null, 'curated'),
  ('sweet-child-o-mine', 'Sweet Child O'' Mine', 'Guns N'' Roses', 1987, 'Hard rock', 'rock', null, 'curated'),
  ('back-in-black', 'Back in Black', 'AC/DC', 1980, 'Hard rock', 'rock', null, 'curated'),
  ('hotel-california', 'Hotel California', 'Eagles', 1976, 'Rock', 'rock', null, 'curated'),
  ('wonderwall', 'Wonderwall', 'Oasis', 1995, 'Britpop', 'rock', null, 'curated'),
  ('seven-nation-army', 'Seven Nation Army', 'The White Stripes', 2003, 'Garage rock', 'rock', null, 'curated'),
  ('in-the-end', 'In the End', 'Linkin Park', 2000, 'Nu metal', 'rock', null, 'curated'),
  ('basket-case', 'Basket Case', 'Green Day', 1994, 'Punk rock', 'rock', null, 'curated'),
  ('enter-sandman', 'Enter Sandman', 'Metallica', 1991, 'Heavy metal', 'rock', null, 'curated'),
  ('zombie', 'Zombie', 'The Cranberries', 1994, 'Rock alternativo', 'rock', null, 'curated'),
  ('creep', 'Creep', 'Radiohead', 1992, 'Rock alternativo', 'rock', null, 'curated'),
  ('livin-on-a-prayer', 'Livin'' on a Prayer', 'Bon Jovi', 1986, 'Hard rock', 'rock', null, 'curated'),
  ('do-i-wanna-know', 'Do I Wanna Know?', 'Arctic Monkeys', 2013, 'Indie rock', 'rock', null, 'curated'),
  ('everlong', 'Everlong', 'Foo Fighters', 1997, 'Rock alternativo', 'rock', null, 'curated'),
  ('believer', 'Believer', 'Imagine Dragons', 2017, 'Pop rock', 'rock', null, 'curated'),
  ('garota-de-ipanema', 'Garota de Ipanema', 'Tom Jobim & Vinícius de Moraes', 1962, 'Bossa nova', 'brasil', 'Garota de Ipanema Antonio Carlos Jobim', 'curated'),
  ('tempo-perdido', 'Tempo Perdido', 'Legião Urbana', 1986, 'Rock nacional', 'brasil', null, 'curated'),
  ('anna-julia', 'Anna Júlia', 'Los Hermanos', 1999, 'Rock nacional', 'brasil', null, 'curated'),
  ('exagerado', 'Exagerado', 'Cazuza', 1985, 'Rock nacional', 'brasil', null, 'curated'),
  ('envolver', 'Envolver', 'Anitta', 2021, 'Pop/Funk', 'brasil', null, 'curated'),
  ('trem-bala', 'Trem-Bala', 'Ana Vilela', 2016, 'Pop nacional', 'brasil', null, 'curated'),
  ('aquarela', 'Aquarela', 'Toquinho', 1983, 'MPB', 'brasil', null, 'curated'),
  ('pais-tropical', 'País Tropical', 'Jorge Ben Jor', 1969, 'MPB', 'brasil', null, 'curated'),
  ('velha-infancia', 'Velha Infância', 'Tribalistas', 2002, 'MPB', 'brasil', null, 'curated'),
  ('amor-i-love-you', 'Amor I Love You', 'Marisa Monte', 2000, 'MPB', 'brasil', null, 'curated'),
  ('lanterna-dos-afogados', 'Lanterna dos Afogados', 'Os Paralamas do Sucesso', 1989, 'Rock nacional', 'brasil', null, 'curated'),
  ('deixa-acontecer', 'Deixa Acontecer', 'Grupo Revelação', 2002, 'Pagode', 'brasil', null, 'curated'),
  ('fico-assim-sem-voce', 'Fico Assim Sem Você', 'Claudinho & Buchecha', 2002, 'Funk melody', 'brasil', null, 'curated'),
  ('sorri-sou-rei', 'Sorri, Sou Rei', 'Natiruts', 2006, 'Reggae', 'brasil', null, 'curated'),
  ('evidencias', 'Evidências', 'Chitãozinho & Xororó', 1990, 'Sertanejo raiz', 'sertanejo', null, 'curated'),
  ('ai-se-eu-te-pego', 'Ai Se Eu Te Pego', 'Michel Teló', 2011, 'Sertanejo universitário', 'sertanejo', null, 'curated'),
  ('e-o-amor', 'É o Amor', 'Zezé Di Camargo & Luciano', 1991, 'Sertanejo romântico', 'sertanejo', null, 'curated'),
  ('meteoro', 'Meteoro', 'Luan Santana', 2009, 'Sertanejo universitário', 'sertanejo', null, 'curated'),
  ('balada', 'Balada', 'Gusttavo Lima', 2011, 'Sertanejo universitário', 'sertanejo', null, 'curated'),
  ('camaro-amarelo', 'Camaro Amarelo', 'Munhoz & Mariano', 2012, 'Sertanejo universitário', 'sertanejo', null, 'curated'),
  ('amo-noite-e-dia', 'Amo Noite e Dia', 'Jorge & Mateus', 2011, 'Sertanejo universitário', 'sertanejo', null, 'curated'),
  ('medo-bobo', 'Medo Bobo', 'Maiara & Maraisa', 2016, 'Sofrência', 'sertanejo', null, 'curated'),
  ('infiel', 'Infiel', 'Marília Mendonça', 2015, 'Sofrência', 'sertanejo', null, 'curated'),
  ('notificacao-preferida', 'Notificação Preferida', 'Zé Neto & Cristiano', 2019, 'Sertanejo universitário', 'sertanejo', null, 'curated'),
  ('regime-fechado', 'Regime Fechado', 'Simone & Simaria', 2018, 'Sofrência', 'sertanejo', null, 'curated'),
  ('jenifer', 'Jenifer', 'Gabriel Diniz', 2018, 'Forró', 'sertanejo', null, 'curated'),
  ('wake-me-up', 'Wake Me Up', 'Avicii', 2013, 'EDM', 'eletronica', null, 'curated'),
  ('titanium', 'Titanium', 'David Guetta & Sia', 2011, 'EDM', 'eletronica', null, 'curated'),
  ('animals', 'Animals', 'Martin Garrix', 2013, 'Big room', 'eletronica', null, 'curated'),
  ('lean-on', 'Lean On', 'Major Lazer & DJ Snake', 2015, 'Moombahton', 'eletronica', null, 'curated'),
  ('faded', 'Faded', 'Alan Walker', 2015, 'Electro house', 'eletronica', null, 'curated'),
  ('dont-you-worry-child', 'Don''t You Worry Child', 'Swedish House Mafia', 2012, 'Progressive house', 'eletronica', null, 'curated'),
  ('closer', 'Closer', 'The Chainsmokers', 2016, 'Future bass', 'eletronica', null, 'curated'),
  ('get-lucky', 'Get Lucky', 'Daft Punk', 2013, 'Disco/Electro', 'eletronica', null, 'curated'),
  ('clarity', 'Clarity', 'Zedd', 2012, 'Electro house', 'eletronica', null, 'curated'),
  ('summer', 'Summer', 'Calvin Harris', 2014, 'EDM', 'eletronica', null, 'curated'),
  ('where-are-u-now', 'Where Are Ü Now', 'Skrillex & Diplo (Justin Bieber)', 2015, 'Future bass', 'eletronica', 'Where Are U Now Skrillex Diplo Justin Bieber', 'curated'),
  ('cold-heart', 'Cold Heart (PNAU Remix)', 'Elton John & Dua Lipa', 2021, 'Dance', 'eletronica', 'Cold Heart PNAU Elton John Dua Lipa', 'curated'),
  ('lose-yourself', 'Lose Yourself', 'Eminem', 2002, 'Rap', 'hiphop', null, 'curated'),
  ('in-da-club', 'In Da Club', '50 Cent', 2003, 'Rap', 'hiphop', null, 'curated'),
  ('humble', 'HUMBLE.', 'Kendrick Lamar', 2017, 'Rap', 'hiphop', null, 'curated'),
  ('gods-plan', 'God''s Plan', 'Drake', 2018, 'Rap', 'hiphop', null, 'curated'),
  ('sicko-mode', 'SICKO MODE', 'Travis Scott', 2018, 'Trap', 'hiphop', null, 'curated'),
  ('old-town-road', 'Old Town Road', 'Lil Nas X', 2019, 'Country rap', 'hiphop', null, 'curated'),
  ('empire-state-of-mind', 'Empire State of Mind', 'JAY-Z & Alicia Keys', 2009, 'Hip-hop', 'hiphop', null, 'curated'),
  ('stronger', 'Stronger', 'Kanye West', 2007, 'Hip-hop', 'hiphop', null, 'curated'),
  ('gangstas-paradise', 'Gangsta''s Paradise', 'Coolio', 1995, 'Gangsta rap', 'hiphop', null, 'curated'),
  ('still-dre', 'Still D.R.E.', 'Dr. Dre & Snoop Dogg', 1999, 'West coast', 'hiphop', null, 'curated'),
  ('juicy', 'Juicy', 'The Notorious B.I.G.', 1994, 'East coast', 'hiphop', null, 'curated'),
  ('super-bass', 'Super Bass', 'Nicki Minaj', 2010, 'Pop rap', 'hiphop', null, 'curated')
on conflict (id) do nothing;

