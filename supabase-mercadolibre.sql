-- Ruta Escáner: vendedores de Mercado Libre vinculados. Pegar en Supabase > SQL Editor y tocar «Run».
-- Las tablas solo las usa la función «mercadolibre» con la llave de servicio: desde el teléfono nadie las lee
-- (RLS activado y sin reglas), así los tokens de los vendedores no salen nunca del servidor.

-- pedidos de vinculación en curso (el link que el chofer le manda al vendedor); duran 7 días
create table if not exists public.ml_estados (
  estado text primary key,
  verificador text not null,
  chofer uuid not null references auth.users (id) on delete cascade,
  creado timestamptz not null default now()
);

-- cada vendedor que tocó «Vincular» y aceptó
create table if not exists public.ml_vendedores (
  ml_user_id bigint primary key,
  apodo text,
  access_token text not null,
  refresh_token text,
  vence timestamptz not null,
  actualizado timestamptz not null default now()
);

-- qué chofer puede ver los envíos de qué vendedor
create table if not exists public.ml_vinculos (
  chofer uuid not null references auth.users (id) on delete cascade,
  ml_user_id bigint not null references public.ml_vendedores (ml_user_id) on delete cascade,
  creado timestamptz not null default now(),
  primary key (chofer, ml_user_id)
);

alter table public.ml_estados enable row level security;
alter table public.ml_vendedores enable row level security;
alter table public.ml_vinculos enable row level security;
