-- Arreglo "no se pudo crear el link": crea las tablas de Mercado Libre si faltan
-- y le da permiso al servidor (service_role) sobre las tablas. Se puede correr varias veces.

create table if not exists public.ml_estados (
  estado text primary key,
  verificador text not null,
  chofer uuid not null references auth.users (id) on delete cascade,
  creado timestamptz not null default now()
);
create table if not exists public.ml_vendedores (
  ml_user_id bigint primary key,
  apodo text,
  access_token text not null,
  refresh_token text,
  vence timestamptz not null,
  actualizado timestamptz not null default now()
);
create table if not exists public.ml_vinculos (
  chofer uuid not null references auth.users (id) on delete cascade,
  ml_user_id bigint not null references public.ml_vendedores (ml_user_id) on delete cascade,
  creado timestamptz not null default now(),
  primary key (chofer, ml_user_id)
);
alter table public.ml_estados enable row level security;
alter table public.ml_vendedores enable row level security;
alter table public.ml_vinculos enable row level security;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

select 'ok' as resultado,
  (select count(*) from public.ml_estados) as estados,
  (select count(*) from public.perfiles) as perfiles;
