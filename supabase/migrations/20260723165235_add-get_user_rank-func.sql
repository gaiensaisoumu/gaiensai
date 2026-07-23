set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_user_rank(target_id uuid)
 RETURNS TABLE(player_rank bigint)
 LANGUAGE plpgsql
AS $function$
begin
  return query
  with ranked_leaderboard as (
    select 
      id,
      rank() over (order by score desc) as rk
    from flappy_leaderboard
  )
  select rk
  from ranked_leaderboard 
  where id = target_id;
end;
$function$
;


