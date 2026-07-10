-- ============================================================
-- Esquema de base de datos — Sistema de Liquidaciones
-- Logística Hogareño (Supabase / PostgreSQL)
--
-- Aplicado al proyecto: rsglddbierwejiusrpvd
-- Este archivo documenta el esquema para reproducirlo o versionarlo.
-- ============================================================

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ---------- PERFILES (1:1 con auth.users) ----------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nombre text not null default '',
  rol text not null default 'administrativo' check (rol in ('analista','administrativo')),
  icono text default '👤',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Crea el perfil automáticamente al registrarse un usuario.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, nombre, rol, icono)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'rol', 'administrativo'),
    coalesce(new.raw_user_meta_data->>'icono', '👤')
  ) on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- TARIFAS ----------
create table if not exists public.tarifas (
  id bigint generated always as identity primary key,
  zona text not null unique,
  categoria text default '',
  s_colecta numeric default 0,
  c_colecta numeric default 0,
  sla numeric default 0,
  updated_at timestamptz not null default now()
);

-- ---------- SUPER SLA ----------
create table if not exists public.super_sla (
  id bigint generated always as identity primary key,
  conductor text not null,
  zona text not null,
  precio numeric default 0,
  updated_at timestamptz not null default now(),
  unique (conductor, zona)
);

-- ---------- PANEL DE CONDUCTORES ----------
create table if not exists public.panel_conductores (
  id text primary key,
  nombre text not null,
  condicion text default '',
  categoria text default 'super_sla',
  updated_at timestamptz not null default now()
);

-- ---------- DIMENSIONES ESPECIALES ----------
create table if not exists public.dimensiones_especiales (
  id bigint generated always as identity primary key,
  fecha text default '',
  tracking text not null,
  cliente text default '',
  zona text default '',
  valor numeric default 0,
  condicion text default '',
  updated_at timestamptz not null default now()
);

-- ---------- DESCUENTOS CONDUCTORES ----------
create table if not exists public.descuentos_conductores (
  id bigint generated always as identity primary key,
  conductor text not null unique,
  combustible numeric default 0,
  extraviados numeric default 0,
  adelantos numeric default 0,
  proveedores numeric default 0,
  obs text default '',
  updated_at timestamptz not null default now()
);

-- ---------- KM DESVÍO ----------
-- fecha: día del desvío (DD/MM/YYYY). valor_km: tarifa aplicada (snapshot, no se
-- recalcula si la tarifa cambia después). monto = km × valor_km.
create table if not exists public.km_desvio (
  id bigint generated always as identity primary key,
  conductor text not null,
  km numeric default 0,
  fecha text default '',
  valor_km numeric default 0,
  monto numeric default 0,
  obs text default '',
  updated_at timestamptz not null default now()
);

-- ---------- KM TARIFAS (historial de precio por km, vigencia por fecha) ----------
-- Cada cambio de precio queda registrado. La tarifa de un desvío es la última
-- cuya vigencia empezó en o antes de la fecha del desvío. Solo analista edita.
create table if not exists public.km_tarifas (
  id bigint generated always as identity primary key,
  valor numeric not null default 0,
  vigente_desde timestamptz not null default now(),
  creado_por text,
  created_at timestamptz not null default now()
);

-- Helper de rol: ¿el usuario actual es analista?
create or replace function public.es_analista()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'analista');
$$;

-- ---------- ROLES (dinámicos, creados desde el panel) ----------
-- 'analista' y 'administrativo' son de sistema (es_sistema=true, no borrables).
-- perfiles.rol referencia esta tabla por FK. Solo analista crea/edita/borra.
create table if not exists public.roles (
  rol text primary key,
  label text not null default '',
  emoji text default '👥',
  color text default '#6366f1',
  es_sistema boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- ROL PERMISOS (panel "Gestión de permisos") ----------
-- Qué pantallas ve cada rol (el analista siempre ve todo, no se persiste).
create table if not exists public.rol_permisos (
  rol text not null,
  pagina text not null,
  permitido boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (rol, pagina)
);

-- ---------- CONFIG (clave/valor compartida) ----------
-- 'km_valor': tarifa fija en $ por km de desvío (el monto se calcula km × valor)
create table if not exists public.config (
  clave text primary key,
  valor text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------- REGISTROS (entregas importadas) ----------
create table if not exists public.registros (
  id bigint generated always as identity primary key,
  cadete text default '',
  tracking text default '',
  fecha text default '',
  localidad text default '',
  zona text default '',
  zona_precio text default '',
  estado text default '',
  precio_bd numeric default 0,
  carga_fecha text default '', -- día (DD/MM/YYYY) en que se importó el registro
  precio_manual numeric,       -- corrección manual del operador; pisa el precio calculado
  fecha_date date,             -- fecha real (la calcula la app desde 'fecha'); permite cargar por ventana en el servidor
  created_at timestamptz not null default now()
);
create index if not exists idx_registros_fecha_date on public.registros (fecha_date);

-- ============================================================
-- RLS: acceso completo para usuarios autenticados.
-- (El control por rol analista/administrativo se aplica en la UI.)
-- ============================================================
alter table public.perfiles                enable row level security;
alter table public.tarifas                 enable row level security;
alter table public.super_sla               enable row level security;
alter table public.panel_conductores       enable row level security;
alter table public.dimensiones_especiales  enable row level security;
alter table public.descuentos_conductores  enable row level security;
alter table public.km_desvio               enable row level security;
alter table public.registros               enable row level security;

create policy perfiles_select on public.perfiles for select to authenticated using (true);
-- OJO: no crear una policy de "editar el propio perfil": permitiría que un
-- usuario se cambie su propio rol (escalada de privilegios). Los perfiles
-- solo los modifica un analista (perfiles_update_analista, más abajo).

create policy tarifas_all   on public.tarifas                for all to authenticated using (true) with check (true);
create policy super_sla_all on public.super_sla              for all to authenticated using (true) with check (true);
create policy panel_all     on public.panel_conductores      for all to authenticated using (true) with check (true);
create policy dim_all       on public.dimensiones_especiales for all to authenticated using (true) with check (true);
create policy desc_all      on public.descuentos_conductores for all to authenticated using (true) with check (true);
create policy km_all        on public.km_desvio              for all to authenticated using (true) with check (true);
create policy config_all    on public.config                 for all to authenticated using (true) with check (true);

-- roles: todos leen; solo analista modifica (los de sistema no se borran).
alter table public.roles enable row level security;
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_insert on public.roles for insert to authenticated with check (public.es_analista());
create policy roles_update on public.roles for update to authenticated using (public.es_analista()) with check (public.es_analista());
create policy roles_delete on public.roles for delete to authenticated using (public.es_analista() and es_sistema = false);

-- perfiles: un analista puede actualizar cualquier perfil (asignar roles desde el panel)
create policy perfiles_update_analista on public.perfiles for update to authenticated using (public.es_analista()) with check (public.es_analista());

-- rol_permisos: todos leen; solo analista modifica.
alter table public.rol_permisos enable row level security;
create policy rol_permisos_select on public.rol_permisos for select to authenticated using (true);
create policy rol_permisos_insert on public.rol_permisos for insert to authenticated with check (public.es_analista());
create policy rol_permisos_update on public.rol_permisos for update to authenticated using (public.es_analista()) with check (public.es_analista());
create policy rol_permisos_delete on public.rol_permisos for delete to authenticated using (public.es_analista());

-- km_tarifas: todos leen; solo analista crea/edita/borra tarifas.
alter table public.km_tarifas enable row level security;
create policy km_tarifas_select on public.km_tarifas for select to authenticated using (true);
create policy km_tarifas_insert on public.km_tarifas for insert to authenticated with check (public.es_analista());
create policy km_tarifas_update on public.km_tarifas for update to authenticated using (public.es_analista()) with check (public.es_analista());
create policy km_tarifas_delete on public.km_tarifas for delete to authenticated using (public.es_analista());
create policy registros_all on public.registros              for all to authenticated using (true) with check (true);
