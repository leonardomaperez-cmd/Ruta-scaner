-- Ruta Escáner: cuentas. Pegar en Supabase > SQL Editor y tocar «Run».
-- Cada usuario nuevo recibe una fila en «perfiles» con activo = false.
-- Para activar a alguien (cuando pagó): Table Editor > perfiles > activo = true.

create table if not exists public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  activo boolean not null default false,
  creado timestamptz not null default now()
);

alter table public.perfiles enable row level security;

-- cada usuario solo puede leer su propia fila; nadie puede activarse solo desde la app
drop policy if exists "cada uno ve su perfil" on public.perfiles;
create policy "cada uno ve su perfil" on public.perfiles for select using (auth.uid() = id);

create or replace function public.nuevo_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.nuevo_perfil();
