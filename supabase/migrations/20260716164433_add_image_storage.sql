alter table "public"."class_performances" add column "image_path" text;

alter table "public"."gym_performances" add column "description" text;

alter table "public"."gym_performances" add column "image_path" text;


-- 1. 本番環境にバケットを自動作成する
insert into storage.buckets (id, name, public)
values ('performance-images', 'performance-images', true)
on conflict (id) do nothing;

-- 2. 誰でも画像を閲覧（ダウンロード）できるようにするポリシー（参照許可）
create policy "誰でも画像の閲覧が可能"
on storage.objects for select
to public
using (bucket_id = 'performance-images');

-- 3. 認証された管理者やユーザーが画像をアップロード・変更できるようにするポリシー（任意）
create policy "認証ユーザーのみアップロード可能"
on storage.objects for insert
to authenticated
with check (bucket_id = 'performance-images');


