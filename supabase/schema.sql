begin;

create extension if not exists pgcrypto;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  player_name varchar(24) not null check (char_length(btrim(player_name)) between 2 and 24),
  score integer not null check (score between -250000 and 250000),
  right_answers smallint not null check (right_answers between 0 and 40),
  cards smallint not null check (cards between 1 and 40),
  topics text[] not null check (cardinality(topics) between 1 and 50),
  formats text[] not null default array['normal']::text[],
  question_format text not null check (question_format in ('normal', 'reverse', 'difference', 'mixed')),
  leaderboard_key text not null default 'normal',
  scoring_version smallint not null default 2,
  original_score integer,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  check (right_answers <= cards)
);

-- Additive migration: old rows start at v1, while new inserts default to v2.
alter table public.scores add column if not exists formats text[];
alter table public.scores add column if not exists leaderboard_key text;
alter table public.scores add column if not exists scoring_version smallint;
alter table public.scores add column if not exists original_score integer;
alter table public.scores add column if not exists is_current boolean;

update public.scores
set formats = case when question_format = 'mixed' then array['mixed']::text[] else array[question_format]::text[] end
where formats is null;
update public.scores set scoring_version = 1 where scoring_version is null;

-- A previous schema revision may have constrained exact mixed combinations.
-- Remove those database objects before folding them into one Mixed category.
alter table public.scores drop constraint if exists scores_leaderboard_key_check;
drop index if exists public.scores_player_name_unique_idx;
drop index if exists public.scores_player_leaderboard_unique_idx;

update public.scores
set leaderboard_key = case
  when cardinality(formats) > 1 or 'mixed' = any(formats) then 'mixed'
  else formats[1]
end;
update public.scores set is_current = true where is_current is null;

alter table public.scores alter column formats set default array['normal']::text[];
alter table public.scores alter column formats set not null;
alter table public.scores alter column leaderboard_key set default 'normal';
alter table public.scores alter column leaderboard_key set not null;
alter table public.scores alter column scoring_version set default 2;
alter table public.scores alter column scoring_version set not null;
alter table public.scores alter column is_current set default true;
alter table public.scores alter column is_current set not null;

alter table public.scores drop constraint if exists scores_score_check;
alter table public.scores add constraint scores_score_check check (score between -250000 and 250000);
alter table public.scores drop constraint if exists scores_formats_check;
alter table public.scores add constraint scores_formats_check check (
  cardinality(formats) between 1 and 3
  and formats <@ array['normal', 'reverse', 'difference', 'mixed']::text[]);
alter table public.scores add constraint scores_leaderboard_key_check
  check (leaderboard_key in ('normal', 'reverse', 'difference', 'mixed'));
alter table public.scores drop constraint if exists scores_scoring_version_check;
alter table public.scores add constraint scores_scoring_version_check check (scoring_version between 1 and 2);

-- Convert every old total once. original_score keeps the exact pre-migration
-- value, making the adjustment auditable and reversible without a backup.
with coefficients as (
  select id, greatest(cardinality(topics), 1) as topic_count,
    case when 'mixed' = any(formats) then 1 else greatest(cardinality(formats), 1) end as format_count
  from public.scores where scoring_version = 1
), converted as (
  select id,
    1 + case format_count when 2 then 0.05 when 3 then 0.10 else 0 end
      + greatest(topic_count - 1, 0) * case format_count when 2 then 0.30 when 3 then 0.35 else 0.25 end
      as old_coefficient,
    1 + 0.15 * sqrt(greatest(topic_count - 1, 0)) as new_coefficient
  from coefficients
)
update public.scores as scores
set original_score = coalesce(scores.original_score, scores.score),
    score = round(scores.score::numeric / converted.old_coefficient * converted.new_coefficient)::integer,
    scoring_version = 2
from converted where scores.id = converted.id;

-- Replace the former global one-row-per-name rule with one best per name and
-- format family. If this follows an earlier exact-combination migration, keep
-- every row but expose only the strongest one in the combined Mixed ranking.
with ranked as (
  select id, row_number() over (
    partition by lower(btrim(player_name)), leaderboard_key, scoring_version
    order by score desc, created_at asc, id
  ) as position
  from public.scores
  where is_current
)
update public.scores as scores
set is_current = false
from ranked
where scores.id = ranked.id and ranked.position > 1;
create unique index if not exists scores_player_leaderboard_unique_idx
  on public.scores (lower(btrim(player_name)), leaderboard_key, scoring_version)
  where is_current;
drop index if exists public.scores_leaderboard_idx;
create index if not exists scores_leaderboard_idx
  on public.scores (leaderboard_key, scoring_version, score desc, created_at asc);

alter table public.scores enable row level security;
revoke all on table public.scores from anon, authenticated;
grant select on table public.scores to anon;
drop policy if exists "Public leaderboard is readable" on public.scores;
create policy "Public leaderboard is readable" on public.scores for select to anon using (true);
drop policy if exists "Visitors can submit scores" on public.scores;

drop function if exists public.submit_best_score(text, integer, integer, integer, text[], text[]);
create or replace function public.submit_best_score(
  p_player_name text, p_score integer, p_right_answers integer, p_cards integer,
  p_topics text[], p_formats text[], p_scoring_version integer
)
returns table (score_id uuid, saved boolean, attempt_rank bigint, best_rank bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text := regexp_replace(btrim(p_player_name), '[[:space:]]+', ' ', 'g');
  v_key text;
  v_existing public.scores%rowtype;
  v_id uuid;
  v_saved boolean := false;
  v_best_score integer;
  v_best_created_at timestamptz;
begin
  v_key := case when cardinality(p_formats) > 1 then 'mixed' else p_formats[1] end;

  if char_length(v_name) not between 2 and 24 or p_score not between -250000 and 250000
    or p_cards not between 1 and 40 or p_right_answers not between 0 and p_cards
    or cardinality(p_topics) not between 1 and 50 or cardinality(p_formats) not between 1 and 3
    or not (p_formats <@ array['normal', 'reverse', 'difference']::text[])
    or v_key = '' or p_scoring_version <> 2 then
    raise exception 'Invalid leaderboard score';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(v_name) || '|' || v_key || '|2', 0));
  select * into v_existing from public.scores
  where lower(btrim(player_name)) = lower(v_name) and leaderboard_key = v_key
    and scoring_version = p_scoring_version and is_current for update;

  if not found then
    insert into public.scores (player_name, score, right_answers, cards, topics, formats,
      question_format, leaderboard_key, scoring_version)
    values (v_name, p_score, p_right_answers, p_cards, p_topics, p_formats,
      case when cardinality(p_formats) > 1 then 'mixed' else p_formats[1] end,
      v_key, p_scoring_version)
    returning id, public.scores.score, created_at into v_id, v_best_score, v_best_created_at;
    v_saved := true;
  elsif p_score > v_existing.score then
    update public.scores set player_name = v_name, score = p_score,
      right_answers = p_right_answers, cards = p_cards, topics = p_topics, formats = p_formats,
      question_format = case when cardinality(p_formats) > 1 then 'mixed' else p_formats[1] end,
      created_at = now()
    where id = v_existing.id
    returning id, public.scores.score, created_at into v_id, v_best_score, v_best_created_at;
    v_saved := true;
  else
    v_id := v_existing.id;
    v_best_score := v_existing.score;
    v_best_created_at := v_existing.created_at;
  end if;

  return query select v_id, v_saved,
    case when v_saved then
      (select count(*) + 1 from public.scores where id <> v_id and leaderboard_key = v_key
        and scoring_version = p_scoring_version and is_current and (score > v_best_score
          or (score = v_best_score and created_at < v_best_created_at)
          or (score = v_best_score and created_at = v_best_created_at and id < v_id)))
    else
      (select count(*) + 1 from public.scores where id <> v_id and leaderboard_key = v_key
        and scoring_version = p_scoring_version and is_current and score >= p_score)
    end,
    (select count(*) + 1 from public.scores where id <> v_id and leaderboard_key = v_key
      and scoring_version = p_scoring_version and is_current and (score > v_best_score
        or (score = v_best_score and created_at < v_best_created_at)
        or (score = v_best_score and created_at = v_best_created_at and id < v_id)));
end;
$$;
revoke all on function public.submit_best_score(text, integer, integer, integer, text[], text[], integer) from public;
grant execute on function public.submit_best_score(text, integer, integer, integer, text[], text[], integer) to anon;

drop function if exists public.get_player_rank(text);
create or replace function public.get_player_rank(
  p_player_name text, p_leaderboard_key text, p_scoring_version integer
)
returns table (player_rank bigint, best_score integer)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select ranked.position, ranked.score from (
    select lower(btrim(player_name)) as player_key, score,
      row_number() over (order by score desc, created_at asc, id) as position
    from public.scores where leaderboard_key = p_leaderboard_key
      and scoring_version = p_scoring_version and is_current
  ) as ranked
  where ranked.player_key = lower(btrim(p_player_name)) limit 1;
$$;
revoke all on function public.get_player_rank(text, text, integer) from public;
grant execute on function public.get_player_rank(text, text, integer) to anon;

commit;
