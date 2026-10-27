-- Ruta Escáner: espacio para las grabaciones del modo pánico.
-- Pegar en Supabase > SQL Editor > Run (se puede correr más de una vez).
-- Cada chofer sube y ve solo sus videos (carpeta con su id). Nadie los puede borrar desde la app;
-- el dueño los ve todos en Storage > grabaciones.

insert into storage.buckets (id, name, public, file_size_limit)
values ('grabaciones', 'grabaciones', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "subir mis grabaciones" on storage.objects;
create policy "subir mis grabaciones" on storage.objects for insert to authenticated
  with check (bucket_id = 'grabaciones' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ver mis grabaciones" on storage.objects;
create policy "ver mis grabaciones" on storage.objects for select to authenticated
  using (bucket_id = 'grabaciones' and (storage.foldername(name))[1] = auth.uid()::text);
