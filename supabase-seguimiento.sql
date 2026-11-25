-- Ruta Escáner: seguimiento en vivo del chofer (link que recibe el cliente por WhatsApp).
-- Pegar en Supabase > SQL Editor y tocar «Run». Se puede correr más de una vez.
--
-- Cómo funciona:
-- * Cada parada a la que el chofer le manda el WhatsApp tiene un «token» aleatorio (el link seguir.html#t=TOKEN).
-- * El chofer manda su posición cada 3 s por Supabase Realtime (canal secreto, no toca la base) y
--   cada ~15 s la guarda acá, para que el que abre el link vea al auto enseguida.
-- * Nadie puede listar la tabla: el cliente solo ve SU parada con la función seguir_ver(token).
-- * Al marcar la parada como entregada (o borrarla / armar ruta nueva) el link deja de mostrar al chofer.
--   Igual vence solo a las 12 horas.

create table if not exists public.seguimientos (
  token text primary key check (length(token) >= 20),
  chofer uuid not null default auth.uid() references auth.users (id) on delete cascade,
  canal text not null check (length(canal) >= 20),
  etiqueta text,                       -- código del paquete (A1, B3…), nada de nombre ni dirección
  dest_lat double precision,
  dest_lng double precision,
  lat double precision,
  lng double precision,
  rumbo real,
  actualizado timestamptz,
  terminado boolean not null default false,
  creado timestamptz not null default now(),
  expira timestamptz not null default now() + interval '12 hours'
);
create index if not exists seguimientos_chofer on public.seguimientos (chofer) where not terminado;

alter table public.seguimientos enable row level security;

-- el chofer solo crea, ve y cambia sus propias filas (y tiene que tener la cuenta activa)
drop policy if exists "chofer crea" on public.seguimientos;
create policy "chofer crea" on public.seguimientos for insert to authenticated
  with check (chofer = auth.uid() and exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo));
drop policy if exists "chofer ve" on public.seguimientos;
create policy "chofer ve" on public.seguimientos for select to authenticated using (chofer = auth.uid());
drop policy if exists "chofer cambia" on public.seguimientos;
create policy "chofer cambia" on public.seguimientos for update to authenticated
  using (chofer = auth.uid()) with check (chofer = auth.uid());

revoke all on public.seguimientos from anon;
grant select, insert, update on public.seguimientos to authenticated;

-- Lo que ve el cliente con su token: solo su parada. Si ya se entregó o venció, no se manda la posición.
create or replace function public.seguir_ver(t text) returns json
language sql stable security definer set search_path = public as $$
  select case
    when s.token is null then json_build_object('estado', 'no_existe')
    when s.terminado then json_build_object('estado', 'entregado', 'etiqueta', s.etiqueta)
    when s.expira < now() then json_build_object('estado', 'vencido', 'etiqueta', s.etiqueta)
    else json_build_object('estado', 'en_camino', 'etiqueta', s.etiqueta, 'canal', s.canal,
      'dest_lat', s.dest_lat, 'dest_lng', s.dest_lng,
      'lat', s.lat, 'lng', s.lng, 'rumbo', s.rumbo, 'actualizado', s.actualizado)
  end
  from (select 1) x left join public.seguimientos s on s.token = t;
$$;
revoke all on function public.seguir_ver(text) from public;
grant execute on function public.seguir_ver(text) to anon, authenticated;
