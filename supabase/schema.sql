begin;
create extension if not exists pgcrypto;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
  player_name varchar(24) not null check (char_length(btrim(player_name)) between 2 and 24),
  avatar_url text, provider text not null default 'legacy',
  score integer not null check (score between -250000 and 250000),
  right_answers smallint not null check (right_answers between 0 and 40),
  cards smallint not null check (cards between 1 and 40),
  topics text[] not null check (cardinality(topics) between 1 and 50),
  formats text[] not null default array['normal']::text[],
  question_format text not null check (question_format in ('normal','reverse','difference','mixed')),
  leaderboard_key text not null default 'normal', scoring_version smallint not null default 2,
  original_score integer, is_current boolean not null default true,
  created_at timestamptz not null default now(), check (right_answers <= cards)
);

-- Additive migration. Historical rows deliberately remain unowned and recoverable.
alter table public.scores add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.scores add column if not exists avatar_url text;
alter table public.scores add column if not exists provider text;
alter table public.scores add column if not exists formats text[];
alter table public.scores add column if not exists leaderboard_key text;
alter table public.scores add column if not exists scoring_version smallint;
alter table public.scores add column if not exists original_score integer;
alter table public.scores add column if not exists is_current boolean;
update public.scores set formats = case when question_format='mixed' then array['mixed'] else array[question_format] end where formats is null;
update public.scores set scoring_version=1 where scoring_version is null;
update public.scores set provider='legacy' where provider is null;
update public.scores set leaderboard_key = case when cardinality(formats)>1 or 'mixed'=any(formats) then 'mixed' else formats[1] end;
update public.scores set is_current=true where is_current is null;

alter table public.scores alter column formats set default array['normal']::text[];
alter table public.scores alter column formats set not null;
alter table public.scores alter column leaderboard_key set default 'normal';
alter table public.scores alter column leaderboard_key set not null;
alter table public.scores alter column scoring_version set default 2;
alter table public.scores alter column scoring_version set not null;
alter table public.scores alter column provider set default 'legacy';
alter table public.scores alter column provider set not null;
alter table public.scores alter column is_current set default true;
alter table public.scores alter column is_current set not null;
alter table public.scores drop constraint if exists scores_score_check;
alter table public.scores add constraint scores_score_check check (score between -250000 and 250000);
alter table public.scores drop constraint if exists scores_formats_check;
alter table public.scores add constraint scores_formats_check check (cardinality(formats) between 1 and 3 and formats <@ array['normal','reverse','difference','mixed']::text[]);
alter table public.scores drop constraint if exists scores_leaderboard_key_check;
alter table public.scores add constraint scores_leaderboard_key_check check (leaderboard_key in ('normal','reverse','difference','mixed'));
alter table public.scores drop constraint if exists scores_provider_check;
alter table public.scores add constraint scores_provider_check check (provider in ('legacy','guest','discord'));
alter table public.scores drop constraint if exists scores_scoring_version_check;
alter table public.scores add constraint scores_scoring_version_check check (scoring_version between 1 and 2);

-- Convert every old total once; original_score preserves its exact prior value.
with coefficients as (
  select id, greatest(cardinality(topics),1) topic_count,
    case when 'mixed'=any(formats) then 1 else greatest(cardinality(formats),1) end format_count
  from public.scores where scoring_version=1
), converted as (
  select id,
    1 + case format_count when 2 then .05 when 3 then .10 else 0 end
      + greatest(topic_count-1,0)*case format_count when 2 then .30 when 3 then .35 else .25 end old_coefficient,
    1 + .15*sqrt(greatest(topic_count-1,0)) new_coefficient from coefficients
)
update public.scores s set original_score=coalesce(s.original_score,s.score),
  score=round(s.score::numeric/c.old_coefficient*c.new_coefficient)::integer, scoring_version=2
from converted c where s.id=c.id;

drop index if exists public.scores_player_name_unique_idx;
drop index if exists public.scores_player_leaderboard_unique_idx;
drop index if exists public.scores_user_leaderboard_unique_idx;
with ranked as (
  select id,row_number() over (partition by user_id,leaderboard_key,scoring_version order by score desc,created_at,id) position
  from public.scores where is_current and user_id is not null
)
update public.scores s set is_current=false from ranked r where s.id=r.id and r.position>1;
create unique index scores_user_leaderboard_unique_idx on public.scores(user_id,leaderboard_key,scoring_version)
  where is_current and user_id is not null;
drop index if exists public.scores_leaderboard_idx;
create index scores_leaderboard_idx on public.scores(leaderboard_key,scoring_version,score desc,created_at);

alter table public.scores enable row level security;
revoke all on table public.scores from anon,authenticated;
grant select on table public.scores to anon,authenticated;
drop policy if exists "Public leaderboard is readable" on public.scores;
create policy "Public leaderboard is readable" on public.scores for select to anon,authenticated using (true);
drop policy if exists "Visitors can submit scores" on public.scores;

drop function if exists public.submit_best_score(text,integer,integer,integer,text[],text[]);
drop function if exists public.submit_best_score(text,integer,integer,integer,text[],text[],integer);
drop function if exists public.submit_best_score(text,integer,integer,integer,text[],text[],integer,text);
create function public.submit_best_score(
  p_player_name text,p_score integer,p_right_answers integer,p_cards integer,
  p_topics text[],p_formats text[],p_scoring_version integer,p_avatar_url text
) returns table(score_id uuid,saved boolean,attempt_rank bigint,best_rank bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_user_id uuid:=auth.uid(); v_name text:=regexp_replace(btrim(p_player_name),'[[:space:]]+',' ','g');
  v_key text; v_provider text:=case when coalesce(auth.jwt()->'app_metadata'->'providers','[]'::jsonb) ? 'discord' then 'discord' else 'guest' end;
  v_existing public.scores%rowtype; v_id uuid; v_saved boolean:=false;
  v_best_score integer; v_best_created_at timestamptz;
begin
  v_key:=case when cardinality(p_formats)>1 then 'mixed' else p_formats[1] end;
  if v_user_id is null or char_length(v_name) not between 2 and 24 or p_score not between -250000 and 250000
    or p_cards not between 1 and 40 or p_right_answers not between 0 and p_cards
    or cardinality(p_topics) not between 1 and 50 or cardinality(p_formats) not between 1 and 3
    or not(p_formats <@ array['normal','reverse','difference']::text[]) or v_key='' or p_scoring_version<>2
    or (p_avatar_url is not null and p_avatar_url !~ '^https://(cdn\.discordapp\.com|media\.discordapp\.net)/')
  then raise exception 'Invalid leaderboard score'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text||'|'||v_key||'|2',0));
  select * into v_existing from public.scores where user_id=v_user_id and leaderboard_key=v_key
    and scoring_version=p_scoring_version and is_current for update;
  if not found then
    insert into public.scores(user_id,player_name,avatar_url,provider,score,right_answers,cards,topics,formats,question_format,leaderboard_key,scoring_version)
    values(v_user_id,v_name,p_avatar_url,v_provider,p_score,p_right_answers,p_cards,p_topics,p_formats,
      case when cardinality(p_formats)>1 then 'mixed' else p_formats[1] end,v_key,p_scoring_version)
    returning id,public.scores.score,created_at into v_id,v_best_score,v_best_created_at;
    v_saved:=true;
  elsif p_score>v_existing.score then
    update public.scores set player_name=v_name,avatar_url=p_avatar_url,provider=v_provider,score=p_score,
      right_answers=p_right_answers,cards=p_cards,topics=p_topics,formats=p_formats,
      question_format=case when cardinality(p_formats)>1 then 'mixed' else p_formats[1] end,created_at=now()
    where id=v_existing.id returning id,public.scores.score,created_at into v_id,v_best_score,v_best_created_at;
    v_saved:=true;
  else
    update public.scores set player_name=v_name,avatar_url=p_avatar_url,provider=v_provider where id=v_existing.id;
    v_id:=v_existing.id; v_best_score:=v_existing.score; v_best_created_at:=v_existing.created_at;
  end if;
  return query select v_id,v_saved,
    case when v_saved then (select count(*)+1 from public.scores where id<>v_id and leaderboard_key=v_key and scoring_version=p_scoring_version and is_current and (score>v_best_score or (score=v_best_score and created_at<v_best_created_at) or (score=v_best_score and created_at=v_best_created_at and id<v_id)))
    else (select count(*)+1 from public.scores where id<>v_id and leaderboard_key=v_key and scoring_version=p_scoring_version and is_current and score>=p_score) end,
    (select count(*)+1 from public.scores where id<>v_id and leaderboard_key=v_key and scoring_version=p_scoring_version and is_current and (score>v_best_score or (score=v_best_score and created_at<v_best_created_at) or (score=v_best_score and created_at=v_best_created_at and id<v_id)));
end $$;
revoke all on function public.submit_best_score(text,integer,integer,integer,text[],text[],integer,text) from public;
grant execute on function public.submit_best_score(text,integer,integer,integer,text[],text[],integer,text) to authenticated;

drop function if exists public.get_player_rank(text);
drop function if exists public.get_player_rank(text,text,integer);
drop function if exists public.get_player_rank(text,integer);
create function public.get_player_rank(p_leaderboard_key text,p_scoring_version integer)
returns table(player_rank bigint,best_score integer)
language sql stable security invoker set search_path=public,pg_temp as $$
  select r.position,r.score from (
    select user_id,score,row_number() over(order by score desc,created_at,id) position
    from public.scores where leaderboard_key=p_leaderboard_key and scoring_version=p_scoring_version and is_current
  ) r where r.user_id=auth.uid() limit 1
$$;
revoke all on function public.get_player_rank(text,integer) from public;
grant execute on function public.get_player_rank(text,integer) to authenticated;
commit;
