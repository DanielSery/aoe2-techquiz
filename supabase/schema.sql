create extension if not exists pgcrypto;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  player_name varchar(24) not null
    check (char_length(btrim(player_name)) between 2 and 24),
  score integer not null check (score between -250000 and 250000),
  right_answers smallint not null check (right_answers between 0 and 40),
  cards smallint not null check (cards between 1 and 40),
  topics text[] not null check (cardinality(topics) between 1 and 50),
  formats text[] not null default array['normal']::text[],
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

alter table public.scores add column if not exists formats text[];
update public.scores
set formats = case
  when question_format = 'mixed' then array['mixed']::text[]
  else array[question_format]::text[]
end
where formats is null;
alter table public.scores alter column formats set default array['normal']::text[];
alter table public.scores alter column formats set not null;
alter table public.scores drop constraint if exists scores_formats_check;
alter table public.scores add constraint scores_formats_check check (
  cardinality(formats) between 1 and 3
  and formats <@ array['normal', 'reverse', 'difference', 'mixed']::text[]
);

-- Keep the highest existing row for each case-insensitive player name before
-- enforcing one leaderboard entry per name.
with ranked as (
  select id, row_number() over (
    partition by lower(btrim(player_name))
    order by score desc, created_at asc, id
  ) as position
  from public.scores
)
delete from public.scores
using ranked
where public.scores.id = ranked.id and ranked.position > 1;

create unique index if not exists scores_player_name_unique_idx
  on public.scores (lower(btrim(player_name)));

alter table public.scores enable row level security;

revoke all on table public.scores from anon, authenticated;
grant select on table public.scores to anon;

drop policy if exists "Public leaderboard is readable" on public.scores;
create policy "Public leaderboard is readable"
  on public.scores for select
  to anon
  using (true);

drop policy if exists "Visitors can submit scores" on public.scores;

create or replace function public.submit_best_score(
  p_player_name text,
  p_score integer,
  p_right_answers integer,
  p_cards integer,
  p_topics text[],
  p_formats text[]
)
returns table (
  score_id uuid,
  saved boolean,
  attempt_rank bigint,
  best_rank bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := regexp_replace(btrim(p_player_name), '[[:space:]]+', ' ', 'g');
  v_existing public.scores%rowtype;
  v_id uuid;
  v_saved boolean := false;
  v_best_score integer;
  v_best_created_at timestamptz;
begin
  if char_length(v_name) not between 2 and 24
    or p_score not between -250000 and 250000
    or p_cards not between 1 and 40
    or p_right_answers not between 0 and p_cards
    or cardinality(p_topics) not between 1 and 50
    or cardinality(p_formats) not between 1 and 3
    or not (p_formats <@ array['normal', 'reverse', 'difference']::text[])
  then
    raise exception 'Invalid leaderboard score';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(v_name), 0));

  select * into v_existing
  from public.scores
  where lower(btrim(player_name)) = lower(v_name)
  for update;

  if not found then
    insert into public.scores (
      player_name, score, right_answers, cards, topics, formats, question_format
    ) values (
      v_name, p_score, p_right_answers, p_cards, p_topics, p_formats,
      case when cardinality(p_formats) > 1 then 'mixed' else p_formats[1] end
    )
    returning id, public.scores.score, created_at into v_id, v_best_score, v_best_created_at;
    v_saved := true;
  elsif p_score > v_existing.score then
    update public.scores
    set player_name = v_name,
        score = p_score,
        right_answers = p_right_answers,
        cards = p_cards,
        topics = p_topics,
        formats = p_formats,
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

  return query
  select
    v_id,
    v_saved,
    case when v_saved then
      (select count(*) + 1 from public.scores
       where id <> v_id and (
         score > v_best_score
         or (score = v_best_score and created_at < v_best_created_at)
         or (score = v_best_score and created_at = v_best_created_at and id < v_id)
       ))
    else
      (select count(*) + 1 from public.scores
       where id <> v_id and score >= p_score)
    end,
    (select count(*) + 1 from public.scores
     where id <> v_id and (
       score > v_best_score
       or (score = v_best_score and created_at < v_best_created_at)
       or (score = v_best_score and created_at = v_best_created_at and id < v_id)
     ));
end;
$$;

revoke all on function public.submit_best_score(text, integer, integer, integer, text[], text[]) from public;
grant execute on function public.submit_best_score(text, integer, integer, integer, text[], text[]) to anon;

create or replace function public.get_player_rank(p_player_name text)
returns table (player_rank bigint, best_score integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select ranked.position, ranked.score
  from (
    select
      lower(btrim(player_name)) as player_key,
      score,
      row_number() over (order by score desc, created_at asc, id) as position
    from public.scores
  ) as ranked
  where ranked.player_key = lower(btrim(p_player_name))
  limit 1;
$$;

revoke all on function public.get_player_rank(text) from public;
grant execute on function public.get_player_rank(text) to anon;
