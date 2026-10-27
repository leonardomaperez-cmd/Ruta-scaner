-- Ruta Escáner: servicios de búsqueda de direcciones y su uso por día.
-- Pegar en Supabase > SQL Editor y tocar «Run» (se puede correr más de una vez).
-- En «api_servicios» se cambia el orden, el cupo diario o se apaga un servicio (activo = false).
-- En «api_uso» se ve cuánto se usó cada servicio cada día.

create table if not exists public.api_servicios (
  servicio text primary key,
  orden int not null,
  limite_dia int not null,
  activo boolean not null default true
);
insert into public.api_servicios (servicio, orden, limite_dia) values
  ('tomtom', 1, 2400),      -- gratis: unos 2.500 por día
  ('here', 2, 900),         -- gratis: unos 30.000 por mes
  ('geoapify', 3, 2900),    -- gratis: unos 3.000 por día
  ('locationiq', 4, 4900)   -- gratis: unos 5.000 por día
on conflict (servicio) do nothing;

create table if not exists public.api_uso (
  servicio text not null references public.api_servicios (servicio) on delete cascade,
  dia date not null default current_date,
  usados int not null default 0,
  agotado boolean not null default false,
  primary key (servicio, dia)
);

-- nadie lo lee ni lo cambia desde la app: solo la función «buscar-direccion»
alter table public.api_servicios enable row level security;
alter table public.api_uso enable row level security;

-- suma 1 al uso de hoy si no pasó el cupo; devuelve false si ya no quedan
create or replace function public.usar_api(p text) returns boolean
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  select limite_dia into lim from api_servicios where servicio = p and activo;
  if lim is null then return false; end if;
  insert into api_uso (servicio, dia, usados) values (p, current_date, 1)
  on conflict (servicio, dia) do update set usados = api_uso.usados + 1
    where not api_uso.agotado and api_uso.usados < lim
  returning usados into n;
  return n is not null;
end;
$$;

-- el servicio dijo que no (cupo o clave): no se lo usa más por hoy
create or replace function public.agotar_api(p text) returns void
language sql security definer set search_path = public as $$
  update api_uso set agotado = true where servicio = p and dia = current_date;
$$;

revoke execute on function public.usar_api(text) from public, anon, authenticated;
revoke execute on function public.agotar_api(text) from public, anon, authenticated;
grant execute on function public.usar_api(text) to service_role;
grant execute on function public.agotar_api(text) to service_role;
