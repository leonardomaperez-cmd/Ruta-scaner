-- Ruta Escáner: espacio para las grabaciones del modo pánico.
-- Pegar en Supabase > SQL Editor > Run (se puede correr más de una vez).
-- Cada chofer sube y ve solo sus videos (carpeta con su id). El dueño los ve todos en Storage > grabaciones.
-- Desde la app solo se pueden borrar las grabaciones automáticas (carpeta auto_...) de más de 12 horas;
-- las del botón de pánico y las que el chofer guarda con 📌 no se borran.

insert into storage.buckets (id, name, public, file_size_limit)
values ('grabaciones', 'grabaciones', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "subir mis grabaciones" on storage.objects;
create policy "subir mis grabaciones" on storage.objects for insert to authenticated
  with check (bucket_id = 'grabaciones' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ver mis grabaciones" on storage.objects;
create policy "ver mis grabaciones" on storage.objects for select to authenticated
  using (bucket_id = 'grabaciones' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "borrar mis automaticas viejas" on storage.objects;
create policy "borrar mis automaticas viejas" on storage.objects for delete to authenticated
  using (bucket_id = 'grabaciones' and (storage.foldername(name))[1] = auth.uid()::text
         and (storage.foldername(name))[2] like 'auto\_%' and created_at < now() - interval '12 hours');
