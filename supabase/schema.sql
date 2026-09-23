create extension if not exists pgcrypto;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  player_name varchar(24) not null
    check (char_length(btrim(player_name)) between 2 and 24),
  score integer not null check (score between -250000 and 250000),
  right_answers smallint not null check (right_answers between 0 and 40),
  cards smallint not null check (cards between 1 and 40),
  topics text[] not null check (cardinality(topics) between 1 and 50),
  question_format text not null
    check (question_format in ('normal', 'reverse', 'difference', 'mixed')),
  created_at timestamptz not null default now(),
  check (right_answers <= cards)
);

create index if not exists scores_leaderboard_idx
  on public.scores (score desc, created_at asc);

-- Keep an already-created leaderboard compatible with larger coefficients.
alter table public.scores drop constraint if exists scores_score_check;
alter table public.scores add constraint scores_score_check
  check (score between -250000 and 250000);

alter table public.scores enable row level security;

revoke all on table public.scores from anon, authenticated;
grant select, insert on table public.scores to anon;

drop policy if exists "Public leaderboard is readable" on public.scores;
create policy "Public leaderboard is readable"
  on public.scores for select
  to anon
  using (true);

drop policy if exists "Visitors can submit scores" on public.scores;
create policy "Visitors can submit scores"
  on public.scores for insert
  to anon
  with check (
    char_length(btrim(player_name)) between 2 and 24
    and score between -250000 and 250000
    and right_answers between 0 and cards
    and cards between 1 and 40
    and cardinality(topics) between 1 and 50
    and question_format in ('normal', 'reverse', 'difference', 'mixed')
  );
