
  create table "public"."flappy_leaderboard" (
    "id" uuid not null default gen_random_uuid(),
    "player_name" text not null,
    "score" integer not null,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now())
      );


alter table "public"."flappy_leaderboard" enable row level security;

CREATE UNIQUE INDEX flappy_leaderboard_pkey ON public.flappy_leaderboard USING btree (id);

alter table "public"."flappy_leaderboard" add constraint "flappy_leaderboard_pkey" PRIMARY KEY using index "flappy_leaderboard_pkey";

grant delete on table "public"."flappy_leaderboard" to "anon";

grant insert on table "public"."flappy_leaderboard" to "anon";

grant references on table "public"."flappy_leaderboard" to "anon";

grant select on table "public"."flappy_leaderboard" to "anon";

grant trigger on table "public"."flappy_leaderboard" to "anon";

grant truncate on table "public"."flappy_leaderboard" to "anon";

grant update on table "public"."flappy_leaderboard" to "anon";

grant delete on table "public"."flappy_leaderboard" to "authenticated";

grant insert on table "public"."flappy_leaderboard" to "authenticated";

grant references on table "public"."flappy_leaderboard" to "authenticated";

grant select on table "public"."flappy_leaderboard" to "authenticated";

grant trigger on table "public"."flappy_leaderboard" to "authenticated";

grant truncate on table "public"."flappy_leaderboard" to "authenticated";

grant update on table "public"."flappy_leaderboard" to "authenticated";

grant delete on table "public"."flappy_leaderboard" to "service_role";

grant insert on table "public"."flappy_leaderboard" to "service_role";

grant references on table "public"."flappy_leaderboard" to "service_role";

grant select on table "public"."flappy_leaderboard" to "service_role";

grant trigger on table "public"."flappy_leaderboard" to "service_role";

grant truncate on table "public"."flappy_leaderboard" to "service_role";

grant update on table "public"."flappy_leaderboard" to "service_role";


  create policy "Allow public insert access"
  on "public"."flappy_leaderboard"
  as permissive
  for insert
  to public
with check (true);



  create policy "Allow public read access"
  on "public"."flappy_leaderboard"
  as permissive
  for select
  to public
using (true);



