-- Public bucket for coach profile photos. Each coach may only write inside
-- a folder named after their own user id: coach-photos/<auth uid>/photo.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-photos', 'coach-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "coach photos: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'coach-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "coach photos: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'coach-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "coach photos: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'coach-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
