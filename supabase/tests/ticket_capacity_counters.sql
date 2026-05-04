BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(21);

INSERT INTO public.configs (
  id,
  event_year,
  is_active,
  admin_password,
  show_length,
  junior_release_open,
  max_tickets_per_user,
  max_tickets_per_junior_user
)
VALUES (1, 2026, true, 'test-password', 60, false, 20, 2)
ON CONFLICT (id) DO UPDATE
SET
  junior_release_open = false,
  is_active = true,
  max_tickets_per_user = 20,
  max_tickets_per_junior_user = 2;

INSERT INTO public.relationships (id, name, is_accepting)
VALUES (1, '本人', true)
ON CONFLICT (id) DO UPDATE
SET is_accepting = true;

INSERT INTO public.ticket_types (id, name, type)
VALUES
  (1, 'クラス公演(当日)', '招待券'),
  (3, '体育館公演', '招待券'),
  (5, 'クラス公演', '中学生券'),
  (8, 'クラス公演', '当日券')
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  type = EXCLUDED.type;

INSERT INTO public.users (
  id,
  email,
  affiliation,
  role,
  clubs,
  junior_usage_type
)
VALUES
  (
    '00000000-0000-0000-0000-00000000c001'::uuid,
    'capacity-class@example.test',
    30001,
    'student',
    ARRAY[]::text[],
    NULL
  ),
  (
    '00000000-0000-0000-0000-00000000c002'::uuid,
    'capacity-gym@example.test',
    30002,
    'student',
    ARRAY['capacity-test-gym']::text[],
    NULL
  )
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  affiliation = EXCLUDED.affiliation,
  role = EXCLUDED.role,
  clubs = EXCLUDED.clubs,
  junior_usage_type = EXCLUDED.junior_usage_type;

INSERT INTO public.performances_schedule (
  id,
  round_name,
  start_at,
  is_active
)
VALUES
  (31001, 'capacity test round', now(), true),
  (31002, 'rollback test round', now(), true)
ON CONFLICT (id) DO UPDATE
SET
  round_name = EXCLUDED.round_name,
  start_at = EXCLUDED.start_at,
  is_active = true;

INSERT INTO public.class_performances (
  id,
  year,
  class_name,
  title,
  description,
  total_capacity,
  junior_capacity,
  is_accepting
)
VALUES (
  31001,
  2026,
  'capacity-test-class',
  'capacity test',
  'capacity test',
  2,
  0,
  true
)
,
(
  31002,
  2026,
  'rollback-test-class',
  'rollback test',
  'rollback test',
  2,
  0,
  true
)
ON CONFLICT (id) DO UPDATE
SET
  total_capacity = 2,
  junior_capacity = 0,
  is_accepting = true;

INSERT INTO public.gym_performances (
  id,
  group_name,
  round_name,
  start_at,
  end_at,
  capacity,
  year,
  is_accepting
)
VALUES (
  31001,
  'capacity-test-gym',
  'capacity test round',
  now(),
  now() + interval '30 minutes',
  2,
  2026,
  true
)
,
(
  31002,
  'rollback-test-gym',
  'rollback test round',
  now(),
  now() + interval '30 minutes',
  2,
  2026,
  true
)
ON CONFLICT (id) DO UPDATE
SET
  capacity = 2,
  is_accepting = true;

SELECT throws_like(
  $$
    SELECT *
    FROM public.issue_class_tickets_with_codes(
      '00000000-0000-0000-0000-00000000c099'::uuid,
      1,
      1,
      31002,
      31002,
      1,
      ARRAY['CLASS-ROLLBACK-AFTER-COUNTER'],
      ARRAY['SIG-CLASS-ROLLBACK-AFTER-COUNTER'],
      1
    );
  $$,
  '%tickets_user_id_fkey%',
  'class issue failure after counter update is raised'
);

SELECT is(
  (
    SELECT coalesce(sum(issued_general), 0)::integer
    FROM public.class_ticket_counters
    WHERE class_id = 31002
      AND round_id = 31002
  ),
  0,
  'failed class insert rolls back the capacity counter update'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.tickets
    WHERE code = 'CLASS-ROLLBACK-AFTER-COUNTER'
  ),
  0::bigint,
  'failed class insert leaves no ticket row'
);

SELECT is(
  (
    SELECT cp.total_capacity
      - cp.junior_capacity
      - coalesce(ctc.issued_general, 0)
      - coalesce(ctc.issued_other, 0)
    FROM public.class_performances cp
    LEFT JOIN public.class_ticket_counters ctc
      ON ctc.class_id = cp.id
      AND ctc.round_id = 31002
    WHERE cp.id = 31002
  ),
  2,
  'failed class insert leaves remaining seats unchanged'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.issue_gym_tickets_with_codes(
      '00000000-0000-0000-0000-00000000c099'::uuid,
      3::smallint,
      1::smallint,
      31002::smallint,
      0::smallint,
      1::smallint,
      ARRAY['GYM-ROLLBACK-AFTER-COUNTER'],
      ARRAY['SIG-GYM-ROLLBACK-AFTER-COUNTER'],
      1::smallint
    );
  $$,
  '%tickets_user_id_fkey%',
  'gym issue failure after counter update is raised'
);

SELECT is(
  (
    SELECT coalesce(sum(issued_count), 0)::integer
    FROM public.gym_ticket_counters
    WHERE performance_id = 31002
  ),
  0,
  'failed gym insert rolls back the capacity counter update'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.tickets
    WHERE code = 'GYM-ROLLBACK-AFTER-COUNTER'
  ),
  0::bigint,
  'failed gym insert leaves no ticket row'
);

SELECT is(
  (
    SELECT coalesce(gp.capacity - gtc.issued_count, gp.capacity)
    FROM public.gym_performances gp
    LEFT JOIN public.gym_ticket_counters gtc
      ON gtc.performance_id = gp.id
    WHERE gp.id = 31002
  ),
  2,
  'failed gym insert leaves remaining seats unchanged'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.issue_class_tickets_with_codes(
      '00000000-0000-0000-0000-00000000c001'::uuid,
      1,
      1,
      31001,
      31001,
      2,
      ARRAY['CLASS-CAPACITY-1', 'CLASS-CAPACITY-2'],
      ARRAY['SIG-CLASS-CAPACITY-1', 'SIG-CLASS-CAPACITY-2'],
      1
    );
  $$,
  'class tickets can be issued up to the remaining capacity'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.tickets t
    JOIN public.class_tickets ct ON ct.id = t.id
    WHERE ct.class_id = 31001
      AND ct.round_id = 31001
      AND t.status = 'valid'
  ),
  2::bigint,
  'class capacity setup issued exactly two valid tickets'
);

SELECT is(
  (
    SELECT issued_general
    FROM public.class_ticket_counters
    WHERE class_id = 31001
      AND round_id = 31001
  ),
  2,
  'class capacity counter records the issued seats'
);

SELECT is(
  (
    SELECT cp.total_capacity
      - cp.junior_capacity
      - coalesce(ctc.issued_general, 0)
      - coalesce(ctc.issued_other, 0)
    FROM public.class_performances cp
    LEFT JOIN public.class_ticket_counters ctc
      ON ctc.class_id = cp.id
      AND ctc.round_id = 31001
    WHERE cp.id = 31001
  ),
  0,
  'class remaining seats are zero at capacity'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.issue_class_tickets_with_codes(
      '00000000-0000-0000-0000-00000000c001'::uuid,
      1,
      1,
      31001,
      31001,
      1,
      ARRAY['CLASS-CAPACITY-OVER'],
      ARRAY['SIG-CLASS-CAPACITY-OVER'],
      1
    );
  $$,
  '%残席%',
  'class tickets cannot be issued beyond remaining capacity'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.tickets t
    JOIN public.class_tickets ct ON ct.id = t.id
    WHERE ct.class_id = 31001
      AND ct.round_id = 31001
      AND t.status = 'valid'
  ),
  2::bigint,
  'failed class over-issue does not insert another ticket'
);

SELECT is(
  (
    SELECT issued_general
    FROM public.class_ticket_counters
    WHERE class_id = 31001
      AND round_id = 31001
  ),
  2,
  'failed class over-issue does not increment the counter'
);

SELECT lives_ok(
  $$
    SELECT *
    FROM public.issue_gym_tickets_with_codes(
      '00000000-0000-0000-0000-00000000c002'::uuid,
      3::smallint,
      1::smallint,
      31001::smallint,
      0::smallint,
      2::smallint,
      ARRAY['GYM-CAPACITY-1', 'GYM-CAPACITY-2'],
      ARRAY['SIG-GYM-CAPACITY-1', 'SIG-GYM-CAPACITY-2'],
      1::smallint
    );
  $$,
  'gym tickets can be issued up to the remaining capacity'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.tickets t
    JOIN public.gym_tickets gt ON gt.id = t.id
    WHERE gt.performance_id = 31001
      AND t.status = 'valid'
  ),
  2::bigint,
  'gym capacity setup issued exactly two valid tickets'
);

SELECT is(
  (
    SELECT issued_count
    FROM public.gym_ticket_counters
    WHERE performance_id = 31001
  ),
  2,
  'gym capacity counter records the issued seats'
);

SELECT throws_like(
  $$
    SELECT *
    FROM public.issue_gym_tickets_with_codes(
      '00000000-0000-0000-0000-00000000c002'::uuid,
      3::smallint,
      1::smallint,
      31001::smallint,
      0::smallint,
      1::smallint,
      ARRAY['GYM-CAPACITY-OVER'],
      ARRAY['SIG-GYM-CAPACITY-OVER'],
      1::smallint
    );
  $$,
  '%定員%',
  'gym tickets cannot be issued beyond remaining capacity'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.tickets t
    JOIN public.gym_tickets gt ON gt.id = t.id
    WHERE gt.performance_id = 31001
      AND t.status = 'valid'
  ),
  2::bigint,
  'failed gym over-issue does not insert another ticket'
);

SELECT is(
  (
    SELECT issued_count
    FROM public.gym_ticket_counters
    WHERE performance_id = 31001
  ),
  2,
  'failed gym over-issue does not increment the counter'
);

SELECT finish();

ROLLBACK;
