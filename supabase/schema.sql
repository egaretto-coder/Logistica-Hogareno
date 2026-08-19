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
  rol text not null default 'administrativo',   -- sin check: los roles son dinámicos (tabla roles)
  icono text default '👤',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Crea el perfil automáticamente al aparecer un usuario en auth.users.
-- OJO: la versión VIGENTE está al final, en "ALTA DE USUARIOS" — el rol dejó de
-- salir de raw_user_meta_data (era escalada de privilegios) y el perfil nace
-- deshabilitado. Este bloque queda solo como referencia histórica.

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
  -- Nombres tal como aparecen en los recorridos (cadete), separados por ";".
  -- Vinculan al conductor cuando en la base figura con otro nombre (apodo, typo,
  -- 2° nombre). Ver getPrecio()/panelConductorDe() en src/core.js.
  alias text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------- DIMENSIONES ESPECIALES ----------
-- (DEPRECADA) Modelo viejo por tracking (valor único que reemplazaba la tarifa).
-- Reemplazada por dimensiones_catalogo (catálogo por cliente, precio por zona) +
-- la asignación manual desde Conductores (registros.dim_especial/dim_cliente).
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

-- ---------- DIMENSIONES ESPECIALES: CATÁLOGO (por cliente, precio por zona) ----------
-- Base de datos de dimensiones especiales. Cada (cliente, dimensión) tiene un
-- precio por zona. La asignación a un envío se guarda en registros
-- (dim_especial + dim_cliente) y el precio aplicado sale de la zona de entrega.
create table if not exists public.dimensiones_catalogo (
  id bigint generated always as identity primary key,
  cliente text not null,
  nombre text not null,           -- nombre de la dimensión (ej. "Heladera")
  zona text not null,
  precio numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (cliente, nombre, zona)
);
create index if not exists idx_dim_catalogo_cliente on public.dimensiones_catalogo (cliente);
-- Asignación en registros: columnas dim_especial (nombre) + dim_cliente.

-- ---------- DESCUENTOS CONDUCTORES (DEPRECADA) ----------
-- Modelo viejo: una fila-resumen por conductor con 4 montos sueltos, sin fecha
-- ni historial. Reemplazada por descuentos_items (registros con fecha, imputados
-- por período) + el sistema de adelantos y km_desvio. Se deja por compatibilidad
-- pero la app ya no la usa.
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

-- ---------- DESCUENTOS ITEMS (registros por fecha: combustible / extraviados / proveedores) ----------
-- Cada renglón es un descuento con fecha, que se imputa a la liquidación del
-- período en que cae (igual que km_desvio / adelanto_cuotas). Una sola tabla con
-- discriminador 'tipo'; la UI muestra una solapa por tipo. 'referencia' guarda el
-- tracking (extraviados) o el proveedor (proveedores); vacío en combustible.
create table if not exists public.descuentos_items (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('combustible','extraviados','proveedores')),
  conductor text not null,
  fecha text default '',
  fecha_date date,
  monto numeric not null default 0,
  referencia text default '',
  detalle text default '',
  cuotas_total int not null default 1,   -- 1 = pago único; >1 = extravío cuoteado (monto = total)
  monto_cuota numeric not null default 0,
  imputar boolean not null default true, -- false = excluido a mano de las liquidaciones
                                         -- (se decide desde el panel del registro
                                         --  o desde el modal de Liquidaciones)
  created_at timestamptz not null default now()
);
create index if not exists idx_desc_items_tipo_cond on public.descuentos_items (tipo, conductor);
create index if not exists idx_desc_items_fecha on public.descuentos_items (fecha_date);

-- ---------- DESCUENTO CUOTAS (cuotas de un extravío cuoteado) ----------
-- Solo para descuentos_items con cuotas_total>1 (por ahora, extravíos caros). Cada
-- cuota se imputa a la liquidación del período de su fecha. Cascade con el item.
create table if not exists public.descuento_cuotas (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.descuentos_items(id) on delete cascade,
  nro int not null,
  monto numeric not null default 0,
  fecha text default '',
  fecha_date date,
  created_at timestamptz not null default now(),
  unique (item_id, nro)
);
create index if not exists idx_descuento_cuotas_item on public.descuento_cuotas (item_id);
create index if not exists idx_descuento_cuotas_fecha on public.descuento_cuotas (fecha_date);

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

-- ---------- ADELANTOS (préstamos a conductores, devueltos en cuotas) ----------
-- monto_cuota = monto_total / cuotas_total (sin interés). Cada cuota efectivamente
-- descontada se registra en adelanto_cuotas con su fecha de imputación: esa cuota
-- aparece como deducción en la liquidación de la semana correspondiente.
create table if not exists public.adelantos (
  id bigint generated always as identity primary key,
  conductor text not null,
  monto_total numeric not null default 0,
  cuotas_total int not null default 1,
  monto_cuota numeric not null default 0,
  fecha text default '',           -- fecha del adelanto (DD/MM/YYYY)
  obs text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_adelantos_conductor on public.adelantos (conductor);

-- ---------- ADELANTO CUOTAS (cuotas ya descontadas de un adelanto) ----------
-- fecha: semana a la que se imputa la cuota (DD/MM/YYYY). fecha_date: misma fecha
-- normalizada, para filtrar por período. Se borran en cascada con el adelanto.
create table if not exists public.adelanto_cuotas (
  id bigint generated always as identity primary key,
  adelanto_id bigint not null references public.adelantos(id) on delete cascade,
  nro int not null,
  monto numeric not null default 0,
  fecha text default '',
  fecha_date date,
  created_at timestamptz not null default now(),
  unique (adelanto_id, nro)
);
create index if not exists idx_adelanto_cuotas_adelanto on public.adelanto_cuotas (adelanto_id);
create index if not exists idx_adelanto_cuotas_fecha on public.adelanto_cuotas (fecha_date);

-- ---------- CLIENTES (facturación) ----------
-- Maestro de clientes que factura la empresa. El nombre matchea (normalizado)
-- con la columna 'cliente' de registros (que viene del Excel de recorridos).
create table if not exists public.clientes (
  id bigint generated always as identity primary key,
  nombre text not null,
  razon_social text default '',
  cuit text default '',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_clientes_nombre on public.clientes (upper(btrim(nombre)));

-- Tarifario de VENTA por cliente y zona: lo que se le cobra al cliente por cada
-- envío entregado en esa zona (distinto del costo que se paga al conductor).
create table if not exists public.cliente_tarifas (
  id bigint generated always as identity primary key,
  cliente text not null,
  zona text not null,
  precio numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (cliente, zona)
);
create index if not exists idx_cliente_tarifas_cliente on public.cliente_tarifas (cliente);

-- ---------- COMISIONES (de vendedores por clientes nuevos) ----------
-- Vendedores que comisionan.
create table if not exists public.vendedores (
  id bigint generated always as identity primary key,
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_vendedores_nombre on public.vendedores (upper(btrim(nombre)));

-- Escala de categorización (importada): mapea la facturación evaluada (4 primeras
-- liquidaciones del cliente) a una categoría y su monto fijo mensual.
-- fact_hasta null = sin tope superior.
create table if not exists public.comision_categorias (
  id bigint generated always as identity primary key,
  categoria text not null,
  fact_desde numeric not null default 0,
  fact_hasta numeric,
  monto numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_comision_categorias_desde on public.comision_categorias (fact_desde);

-- Cliente nuevo asignado a un vendedor. La evaluación (categoría/facturación/monto)
-- se calcula en la app y se congela al confirmar (bloqueado=true). mes_inicio =
-- primer mes de los 5 de pago.
create table if not exists public.comision_clientes (
  id bigint generated always as identity primary key,
  cliente text not null,
  vendedor text not null,
  fecha_alta text default '',
  mes_inicio text default '',
  categoria text default '',
  facturacion_eval numeric default 0,
  monto numeric default 0,
  bloqueado boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_comision_clientes_cliente on public.comision_clientes (upper(btrim(cliente)));
create index if not exists idx_comision_clientes_vendedor on public.comision_clientes (vendedor);

-- Registro de cierre mensual: (periodo, beneficiario) abonado. Habilita el PDF.
create table if not exists public.comision_pagos (
  id bigint generated always as identity primary key,
  periodo text not null,          -- YYYY-MM
  beneficiario text not null,     -- vendedor o supervisor
  tipo text not null default 'vendedor', -- 'vendedor' | 'supervisor'
  monto numeric not null default 0,
  detalle text default '',
  pagado_en timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (periodo, beneficiario)
);
create index if not exists idx_comision_pagos_periodo on public.comision_pagos (periodo);
-- Config del supervisor único (clave/valor en la tabla config):
--   comision_supervisor      = nombre del supervisor que cobra el %
--   comision_supervisor_pct  = porcentaje del total del equipo (default 30)

-- ---------- IMPORTACIONES (historial de cargas de recorridos) ----------
-- Cada carga de un documento queda registrada (visibilidad + dedup por hash de
-- contenido, que bloquea reimportar el mismo archivo).
create table if not exists public.importaciones (
  id bigint generated always as identity primary key,
  archivo text not null default '',
  hash text not null,                 -- SHA-256 del contenido (dedup)
  fecha_carga text default '',        -- día de carga elegido (DD/MM/YYYY)
  filas int not null default 0,
  agregados int not null default 0,
  reemplazados int not null default 0,
  fecha_desde text default '',        -- 1ra fecha de recorrido del documento
  fecha_hasta text default '',        -- última fecha de recorrido del documento
  usuario text default '',
  created_at timestamptz not null default now()
);
create unique index if not exists idx_importaciones_hash on public.importaciones (hash);
create index if not exists idx_importaciones_created on public.importaciones (created_at desc);

-- ---------- SUPER SLA: solicitudes de cambio de precio (maker-checker) ----------
-- Un rol no autorizado propone un precio nuevo para (conductor, zona); queda
-- 'pendiente' y NO cambia el precio real hasta que un supervisor/analista la
-- autorice (recién ahí se aplica a super_sla).
create table if not exists public.supersla_solicitudes (
  id bigint generated always as identity primary key,
  conductor text not null,
  zona text not null,
  precio_anterior numeric not null default 0,
  precio_propuesto numeric not null default 0,
  motivo text default '',
  solicitante text default '',
  estado text not null default 'pendiente',  -- pendiente | autorizado | rechazado
  resuelto_por text default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_supersla_sol_estado on public.supersla_solicitudes (estado);

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
  direccion text default '',   -- dirección de entrega (col R del Excel)
  destinatario text default '',-- nombre del destinatario (col M del Excel)
  clave text,                  -- clave de deduplicación (la calcula la app): T:tracking real, D:dirección+destinatario (tracking basura), F:huella
  manual boolean not null default false, -- true = envío cargado a mano desde el editor de Conductores (chip "Manual")
  zona_manual boolean not null default false, -- true = la zona fue definida/corregida a mano (para localizar correcciones)
  cliente text default '',     -- empresa/cliente de facturación (viene del Excel; se factura por su tarifario de venta)
  dim_especial text default '', -- dimensión especial asignada a mano (nombre); '' = ninguna
  dim_cliente text default '',  -- cliente de esa dimensión (para resolver el precio por zona)
  created_at timestamptz not null default now()
);
create index if not exists idx_registros_fecha_date on public.registros (fecha_date);
create index if not exists idx_registros_clave on public.registros (clave);

-- ---------- REGISTROS_HISTORICO (archivo de registros ya liquidados) ----------
-- Mantiene liviana la tabla principal. Los mueve la función archivar_registros
-- (transaccional, solo analistas). La app los lee como solo lectura.
create table if not exists public.registros_historico (
  id bigint generated always as identity primary key,
  id_original bigint,
  cadete text default '',
  tracking text default '',
  fecha text default '',
  localidad text default '',
  zona text default '',
  zona_precio text default '',
  estado text default '',
  precio_bd numeric default 0,
  carga_fecha text default '',
  fecha_date date,
  precio_manual numeric,
  zona_manual boolean not null default false,
  cliente text default '',
  dim_especial text default '',
  dim_cliente text default '',
  created_at timestamptz,
  archivado_en timestamptz not null default now()
);
create index if not exists idx_reg_hist_fecha_date on public.registros_historico (fecha_date);
create index if not exists idx_reg_hist_tracking on public.registros_historico (tracking);

-- Mueve a histórico los registros con fecha anterior al corte (delete+insert
-- en una sola transacción). Solo analistas. Devuelve la cantidad movida.
create or replace function public.archivar_registros(antes_de date)
returns integer language plpgsql security definer set search_path = public as $$
declare movidos integer;
begin
  if not public.es_analista() then raise exception 'Solo un analista puede archivar registros'; end if;
  with mov as (
    delete from public.registros r where r.fecha_date is not null and r.fecha_date < antes_de returning r.*
  )
  insert into public.registros_historico
    (id_original, cadete, tracking, fecha, localidad, zona, zona_precio, estado, precio_bd, carga_fecha, fecha_date, precio_manual, zona_manual, cliente, dim_especial, dim_cliente, created_at)
  select id, cadete, tracking, fecha, localidad, zona, zona_precio, estado, precio_bd, carga_fecha, fecha_date, precio_manual, zona_manual, cliente, dim_especial, dim_cliente, created_at from mov;
  get diagnostics movidos = row_count;
  return movidos;
end $$;

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

-- dimensiones_catalogo: acceso completo para autenticados.
alter table public.dimensiones_catalogo enable row level security;
create policy dim_catalogo_all on public.dimensiones_catalogo for all to authenticated using (true) with check (true);
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

-- registros_historico: solo lectura desde la app (lo escribe archivar_registros).
alter table public.registros_historico enable row level security;
create policy reg_hist_select on public.registros_historico for select to authenticated using (true);

-- adelantos / adelanto_cuotas: acceso completo para autenticados (igual que los
-- demás descuentos; el control por rol se aplica en la UI).
alter table public.adelantos       enable row level security;
alter table public.adelanto_cuotas enable row level security;
create policy adelantos_all      on public.adelantos       for all to authenticated using (true) with check (true);
create policy adelanto_cuotas_all on public.adelanto_cuotas for all to authenticated using (true) with check (true);

-- descuentos_items: acceso completo para autenticados (igual que los demás descuentos).
alter table public.descuentos_items enable row level security;
create policy desc_items_all on public.descuentos_items for all to authenticated using (true) with check (true);

-- descuento_cuotas: acceso completo para autenticados.
alter table public.descuento_cuotas enable row level security;
create policy descuento_cuotas_all on public.descuento_cuotas for all to authenticated using (true) with check (true);

-- clientes / cliente_tarifas: acceso completo para autenticados (facturación;
-- el control por rol se aplica en la UI vía rol_permisos).
alter table public.clientes        enable row level security;
alter table public.cliente_tarifas enable row level security;
create policy clientes_all        on public.clientes        for all to authenticated using (true) with check (true);
create policy cliente_tarifas_all on public.cliente_tarifas for all to authenticated using (true) with check (true);

-- comisiones: acceso completo para autenticados (el control por rol se aplica en la UI).
alter table public.vendedores          enable row level security;
alter table public.comision_categorias enable row level security;
alter table public.comision_clientes   enable row level security;
alter table public.comision_pagos      enable row level security;
create policy vendedores_all          on public.vendedores          for all to authenticated using (true) with check (true);
create policy comision_categorias_all on public.comision_categorias for all to authenticated using (true) with check (true);
create policy comision_clientes_all   on public.comision_clientes   for all to authenticated using (true) with check (true);
create policy comision_pagos_all      on public.comision_pagos      for all to authenticated using (true) with check (true);

-- importaciones: historial de cargas; acceso completo para autenticados.
alter table public.importaciones enable row level security;
create policy importaciones_all on public.importaciones for all to authenticated using (true) with check (true);

-- supersla_solicitudes: acceso completo para autenticados (el control de quién
-- puede autorizar/editar el precio se aplica en la UI: solo supervisor/analista).
alter table public.supersla_solicitudes enable row level security;
create policy supersla_solicitudes_all on public.supersla_solicitudes for all to authenticated using (true) with check (true);

-- ---------- RECURSOS HUMANOS: EMPLEADOS ----------
-- Personal de la empresa (distinto de los cadetes). "registrado" = en blanco.
-- El ajuste de sueldo corre cada 3 MESES contados desde la fecha_ingreso de
-- cada uno, por eso a cada empleado le toca en un mes distinto.
create table if not exists public.empleados (
  id bigint generated always as identity primary key,
  nombre text not null,
  dni text default '', telefono text default '', email text default '',
  direccion text default '', puesto text default '',
  registrado boolean not null default true,
  fecha_ingreso date,
  sueldo numeric not null default 0,
  pct_transferencia numeric not null default 100,  -- resto = efectivo
  activo boolean not null default true,
  obs text default '',
  created_at timestamptz not null default now()
);

-- Historial de aumentos (uno por empleado y ajuste aplicado).
create table if not exists public.empleado_ajustes (
  id bigint generated always as identity primary key,
  empleado_id bigint not null references public.empleados(id) on delete cascade,
  fecha date not null default current_date,
  periodo text default '',
  pct numeric not null default 0,
  sueldo_anterior numeric not null default 0,
  sueldo_nuevo numeric not null default 0,
  motivo text default '', aplicado_por text default '',
  created_at timestamptz not null default now()
);

-- Liquidación mensual del sueldo, con el corte transferencia/efectivo.
create table if not exists public.empleado_sueldos (
  id bigint generated always as identity primary key,
  empleado_id bigint not null references public.empleados(id) on delete cascade,
  periodo text not null,                       -- YYYY-MM
  sueldo_base numeric not null default 0,
  horas_extra numeric not null default 0,
  valor_hora_extra numeric not null default 0,
  monto_horas_extra numeric not null default 0,
  bono_eficiencia numeric not null default 0,
  descuenta_adelanto boolean not null default false,
  monto_adelanto numeric not null default 0,
  total numeric not null default 0,
  pct_transferencia numeric not null default 100,
  monto_transferencia numeric not null default 0,
  monto_efectivo numeric not null default 0,
  pagado boolean not null default false,
  pagado_en timestamptz,
  obs text default '',
  created_at timestamptz not null default now(),
  unique (empleado_id, periodo)
);

alter table public.empleados        enable row level security;
alter table public.empleado_ajustes enable row level security;
alter table public.empleado_sueldos enable row level security;
create policy empleados_all        on public.empleados        for all to authenticated using (true) with check (true);
create policy empleado_ajustes_all on public.empleado_ajustes for all to authenticated using (true) with check (true);
create policy empleado_sueldos_all on public.empleado_sueldos for all to authenticated using (true) with check (true);

-- ---------- RENDICIÓN DE ENVÍOS (cobros en destino) ----------
-- Envíos que se cobran al destinatario: el conductor cobra y debe RENDIR ese
-- dinero al día siguiente de la entrega (fecha_limite). Lo vencido se reclama.
-- Los pendientes se cargan a mano o se generan desde los recorridos entregados
-- con cobro_destino > 0 (columna "Total a cobrar" del listado importado).
create table if not exists public.rendiciones (
  id bigint generated always as identity primary key,
  tracking text default '',
  conductor text not null,
  cliente text default '',
  monto numeric not null default 0,
  fecha_entrega text default '',
  fecha_entrega_date date,
  fecha_limite date,
  estado text not null default 'pendiente',   -- pendiente | rendido | anulado
  fecha_rendicion text default '',
  fecha_rendicion_date date,
  medio text default '',                      -- efectivo | transferencia
  obs text default '',
  origen text default 'manual',               -- manual | envios
  registrado_por text default '', recibido_por text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_rendiciones_estado on public.rendiciones (estado);
create index if not exists idx_rendiciones_conductor on public.rendiciones (conductor);
-- Evita duplicar el mismo cobro al generarlo desde los envíos.
create unique index if not exists idx_rendiciones_trk on public.rendiciones (tracking) where tracking <> '';
alter table public.rendiciones enable row level security;
create policy rendiciones_all on public.rendiciones for all to authenticated using (true) with check (true);
-- registros/registros_historico: columna cobro_destino (monto a cobrar en destino).

-- ---------- BARRERA DE SEGURIDAD DE ACCESO ----------
-- Dos controles, ambos en la BASE (no en el navegador): borrar los datos del
-- sitio o cambiar de equipo no los saltea.
--   1) Bloqueo por intentos fallidos: 5 intentos → 15 minutos de bloqueo.
--   2) Alta/baja de usuarios: perfiles.activo=false deja al usuario sin datos.

alter table public.perfiles add column if not exists activo boolean not null default true;

create table if not exists public.acceso_control (
  email text primary key,
  intentos int not null default 0,
  ultimo_intento timestamptz,
  bloqueado_hasta timestamptz,
  bloqueos_total int not null default 0,
  ultimo_ok timestamptz
);
alter table public.acceso_control enable row level security;
-- Nadie escribe esta tabla desde el cliente: se toca solo por las RPC de abajo
-- (security definer). Los analistas la LEEN para mostrar el estado en el panel.
create policy acceso_control_select on public.acceso_control
  for select to authenticated using (public.es_analista());

-- Parámetros de la política de bloqueo (cambiar acá afecta a toda la app).
create or replace function public.acceso_max_intentos()    returns int language sql immutable as $$ select 5 $$;
create or replace function public.acceso_minutos_bloqueo() returns int language sql immutable as $$ select 15 $$;

-- Estado de un email. La app la llama ANTES de intentar la contraseña.
create or replace function public.estado_acceso(p_email text)
returns table(bloqueado boolean, segundos_restantes int, intentos int, max_intentos int)
language sql security definer set search_path = public as $$
  select
    coalesce(a.bloqueado_hasta > now(), false),
    greatest(0, coalesce(extract(epoch from (a.bloqueado_hasta - now()))::int, 0)),
    coalesce(a.intentos, 0),
    public.acceso_max_intentos()
  from (select lower(btrim(p_email)) as e) k
  left join public.acceso_control a on a.email = k.e;
$$;

-- Registra el resultado del intento. Éxito → limpia el contador.
-- OJO: los nombres de las columnas de RETURNS TABLE son variables PL/pgSQL, así
-- que las columnas de la tabla van calificadas con el alias `ac.` (si no, da
-- "column reference is ambiguous").
create or replace function public.registrar_intento_login(p_email text, p_exito boolean)
returns table(bloqueado boolean, segundos_restantes int, intentos int, max_intentos int)
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_max int := public.acceso_max_intentos();
  v_min int := public.acceso_minutos_bloqueo();
begin
  if v_email is null or v_email = '' then
    return query select false, 0, 0, v_max; return;
  end if;

  insert into public.acceso_control (email, intentos, ultimo_intento)
  values (v_email, 0, now())
  on conflict (email) do nothing;

  if p_exito then
    update public.acceso_control ac
       set intentos = 0, bloqueado_hasta = null, ultimo_ok = now(), ultimo_intento = now()
     where ac.email = v_email;
  else
    -- Ya bloqueado: no sigue sumando. Si no, suma uno.
    update public.acceso_control ac
       set intentos = case when coalesce(ac.bloqueado_hasta, now()) > now() then ac.intentos else ac.intentos + 1 end,
           ultimo_intento = now()
     where ac.email = v_email;
    -- Al llegar al máximo bloquea y reinicia el contador.
    update public.acceso_control ac
       set bloqueado_hasta = now() + (v_min || ' minutes')::interval,
           bloqueos_total  = ac.bloqueos_total + 1,
           intentos = 0
     where ac.email = v_email
       and ac.intentos >= v_max
       and coalesce(ac.bloqueado_hasta, to_timestamp(0)) <= now();
  end if;

  return query select * from public.estado_acceso(v_email);
end $$;

-- Destrabe manual antes de que venza el tiempo (solo analista).
create or replace function public.desbloquear_acceso(p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.es_analista() then raise exception 'Solo un analista puede desbloquear accesos'; end if;
  update public.acceso_control
     set intentos = 0, bloqueado_hasta = null
   where email = lower(btrim(p_email));
  return true;
end $$;

-- Estas dos se llaman ANTES de iniciar sesión → tienen que correr como anon.
grant execute on function public.estado_acceso(text)                  to anon, authenticated;
grant execute on function public.registrar_intento_login(text, boolean) to anon, authenticated;
grant execute on function public.desbloquear_acceso(text)             to authenticated;

-- ¿El usuario de la sesión está habilitado? Permisiva a propósito: si todavía no
-- tiene fila en perfiles devuelve true, así nadie queda afuera por falta de dato.
create or replace function public.es_usuario_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.activo from public.perfiles p where p.id = auth.uid()), true);
$$;

-- La baja se aplica en la BASE: todas las policies `for all` de las tablas de
-- datos pasaron de `using (true)` a `using (public.es_usuario_activo())` (25
-- tablas). Se dejaron afuera a propósito:
--   · perfiles       → el usuario tiene que poder leer su propio estado.
--   · acceso_control → ya tiene su propia policy de solo-lectura para analistas.
-- Un usuario deshabilitado autentica pero no lee ni escribe una sola fila.
-- (Migraciones: seguridad_acceso, seguridad_acceso_fix_ambiguedad, rls_usuario_activo.)

-- ---------- ALTA DE USUARIOS ----------
-- El perfil se crea solo cuando aparece un usuario en auth.users, PERO el rol
-- no puede salir de raw_user_meta_data: quien pueda registrarse elegiría su
-- propio rol (incluido analista). Queda fijo en 'administrativo' y activo=false;
-- el rol y la habilitación los pone un analista desde "Gestión de permisos".
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.perfiles (id, email, nombre, rol, icono, activo)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'nombre'), ''), split_part(new.email, '@', 1)),
    'administrativo',   -- fijo a propósito: NUNCA del metadata (sería escalada)
    coalesce(nullif(btrim(new.raw_user_meta_data->>'icono'), ''), '👤'),
    false               -- nace SIN acceso; se habilita desde el panel
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
-- (trigger on_auth_user_created after insert on auth.users, ya existente)

-- El alta en sí la hace la Edge Function `crear-usuario`
-- (supabase/functions/crear-usuario/index.ts): necesita la clave service_role,
-- que no puede vivir en un sitio estático. Verifica contra el JWT que quien
-- llama sea analista activo, invita por mail (el usuario elige su contraseña) y
-- deja el perfil con el rol elegido y activo=true.

-- dimensiones_catalogo.detalle: nota del acuerdo con el cliente (ej. "LAS
-- CARRETILLAS VALEN $10000"). No entra en el cálculo, pero se guarda porque la
-- planilla se descarga desde la app, se le agregan las dimensiones nuevas y se
-- vuelve a subir: si no se guardara, cada vuelta borraría las notas.
alter table public.dimensiones_catalogo add column if not exists detalle text not null default '';

-- km_desvio.imputar: mismo criterio que descuentos_items.imputar. El operador
-- decide desde el panel o desde el modal de Liquidaciones si ese km entra.
-- Los km no se cuotean: se imputan enteros o no se imputan.
alter table public.km_desvio add column if not exists imputar boolean not null default true;

-- registros.contabiliza_manual / motivo_contab: visita hecha sin entrega. El
-- conductor fue al domicilio y no pudo entregar por causa ajena (rechazo o
-- cancelación en la puerta, nadie tras reintentos, dirección inexistente). Se
-- paga, pero el ESTADO del envío no se toca: sigue diciendo la verdad. Ver
-- contabilizaRegistro() en src/core.js. Las mismas columnas van en
-- registros_historico porque archivar_registros copia fila a fila.
alter table public.registros
  add column if not exists contabiliza_manual boolean not null default false,
  add column if not exists motivo_contab text not null default '';
alter table public.registros_historico
  add column if not exists contabiliza_manual boolean not null default false,
  add column if not exists motivo_contab text not null default '';
create index if not exists idx_registros_contab_manual
  on public.registros (contabiliza_manual) where contabiliza_manual;

-- empleados.area: área de la empresa (Gerencia / Administracion / Coordinacion /
-- Logistica / Asesoria Comercial / Ventas). Texto libre a propósito: la lista
-- vive en RRHH_AREAS (src/empleados.js), así sumar un área no exige migrar.
alter table public.empleados add column if not exists area text not null default '';
create index if not exists idx_empleados_area on public.empleados (area);
