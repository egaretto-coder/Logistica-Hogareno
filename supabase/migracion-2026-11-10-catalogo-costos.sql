-- ============================================================================
--  EL CATÁLOGO DE COSTOS PASA A SER UNA TABLA
--  ---------------------------------------------------------------------------
--  Pegar en Supabase → SQL Editor → Run. Es idempotente.
--
--  POR QUÉ: el negocio pidió poder CREAR una categoría o un detalle desde el
--  panel. Un catálogo editable no puede vivir en una constante del código —
--  es el mismo criterio que `proveedores`, que es tabla justamente porque se
--  da de alta desde la pantalla.
--
--  LO QUE NO CAMBIA: el TIPO sigue saliendo del PAR categoría+detalle, y hay
--  UNA sola fila por par, así que dos personas no pueden clasificar distinto
--  el mismo gasto. Lo que cambia es dónde vive esa fila.
-- ============================================================================

-- 1) Los tres campos que el negocio sacó del alta: la descripción ya los
--    cubre. La tabla está vacía (verificado: 0 filas), así que no se pierde
--    nada — y una columna muerta que nadie llena es peor que no tenerla.
alter table public.costos drop column if exists proveedor;
alter table public.costos drop column if exists comprobante;
alter table public.costos drop column if exists obs;

-- 2) El catálogo. UNA fila por par: eso es lo que hace que el tipo sea del
--    par y no de quien carga.
create table if not exists public.costos_catalogo (
  id bigint generated always as identity primary key,
  categoria text not null,
  detalle text not null,
  tipo text not null check (tipo in ('Fijos','Variables','Varios')),
  -- Baja LÓGICA, como los proveedores: deja de ofrecerse para cargas nuevas
  -- pero los costos ya cargados con ese par se conservan y se siguen
  -- clasificando igual. Borrarlo los dejaría "fuera del catálogo" de golpe.
  activo boolean not null default true,
  creado_por text not null default '',
  created_at timestamptz not null default now(),
  sucursal text not null default coalesce(public.sucursal_pedida(), 'BA')
    references public.sucursales(codigo)
);
-- La clave lleva la SUCURSAL, como toda clave única del proyecto: cada boca
-- puede tener su propio catálogo sin chocar con la otra.
create unique index if not exists costos_catalogo_par_uq
  on public.costos_catalogo (sucursal, categoria, detalle);
create index if not exists idx_costos_catalogo_cat
  on public.costos_catalogo (sucursal, categoria);

alter table public.costos_catalogo enable row level security;
-- es_usuario_activo() NO mira la fila: va en subselect escalar (InitPlan).
drop policy if exists costos_catalogo_sucursal_all on public.costos_catalogo;
create policy costos_catalogo_sucursal_all on public.costos_catalogo
  for all to authenticated
  using ((select public.es_usuario_activo()) and public.es_de_sucursal(sucursal))
  with check ((select public.es_usuario_activo()) and public.es_de_sucursal(sucursal));

-- Sin Realtime, una categoría que crea uno no le aparece al otro hasta que
-- recargue, y el segundo la vuelve a crear con otra redacción.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costos_catalogo'
  ) then
    alter publication supabase_realtime add table public.costos_catalogo;
  end if;
end $$;

-- 3) LA SEMILLA: los 52 pares derivados de la planilla de septiembre de 2026,
--    cuyos totales por tipo dan exactamente los de sus tablas dinámicas.
--    `do nothing` para que volver a correr esto NO pise un tipo que el
--    negocio haya corregido después desde el panel.
insert into public.costos_catalogo (categoria, detalle, tipo, creado_por) values
  ('Conductor', 'Titular', 'Variables', 'planilla septiembre 2026'),
  ('Conductor', 'Suplente', 'Variables', 'planilla septiembre 2026'),
  ('Conductor', 'Semititular', 'Variables', 'planilla septiembre 2026'),
  ('Conductor', 'Beneficios', 'Variables', 'planilla septiembre 2026'),
  ('Conductor', 'Prestamos', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Salario', 'Fijos', 'planilla septiembre 2026'),
  ('Personal', 'Comisiones', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Cargas sociales', 'Fijos', 'planilla septiembre 2026'),
  ('Personal', 'Indemnizaciones', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Ropa de trabajo', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Horas Extras', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Bono', 'Fijos', 'planilla septiembre 2026'),
  ('Personal', 'Vacaciones', 'Fijos', 'planilla septiembre 2026'),
  ('Personal', 'Beneficios', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Viatico', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Autonomo', 'Variables', 'planilla septiembre 2026'),
  ('Personal', 'Farmacia', 'Variables', 'planilla septiembre 2026'),
  ('Impuestos', 'Iva', 'Variables', 'planilla septiembre 2026'),
  ('Impuestos', 'Iva YPF', 'Variables', 'planilla septiembre 2026'),
  ('Impuestos', 'Iva Pancho', 'Variables', 'planilla septiembre 2026'),
  ('Impuestos', 'Ley 25413', 'Variables', 'planilla septiembre 2026'),
  ('Impuestos', 'Iva German', 'Variables', 'planilla septiembre 2026'),
  ('Impuestos', 'IIBB', 'Varios', 'planilla septiembre 2026'),
  ('Impuestos', 'Ganancias', 'Varios', 'planilla septiembre 2026'),
  ('Colecta', 'Colecta Maxi', 'Variables', 'planilla septiembre 2026'),
  ('Colecta', 'Particulares', 'Variables', 'planilla septiembre 2026'),
  ('Servicios generales', 'Lighdata', 'Fijos', 'planilla septiembre 2026'),
  ('Servicios generales', 'Alquiler', 'Fijos', 'planilla septiembre 2026'),
  ('Servicios generales', 'Publicidad', 'Variables', 'planilla septiembre 2026'),
  ('Servicios generales', 'Edenor', 'Fijos', 'planilla septiembre 2026'),
  ('Servicios generales', 'Aysa', 'Fijos', 'planilla septiembre 2026'),
  ('Servicios generales', 'Internet', 'Fijos', 'planilla septiembre 2026'),
  ('Servicios generales', 'TGS Moron', 'Fijos', 'planilla septiembre 2026'),
  ('Servicios generales', 'Arba', 'Fijos', 'planilla septiembre 2026'),
  ('Mantenimiento', 'Reparaciones', 'Varios', 'planilla septiembre 2026'),
  ('Mantenimiento', 'Limpieza', 'Fijos', 'planilla septiembre 2026'),
  ('Honorarios', 'Contador', 'Variables', 'planilla septiembre 2026'),
  ('Honorarios', 'Abogado', 'Variables', 'planilla septiembre 2026'),
  ('Operaciones y oficina', 'Alquiler', 'Fijos', 'planilla septiembre 2026'),
  ('Operaciones y oficina', 'Insumos refrigerio', 'Varios', 'planilla septiembre 2026'),
  ('Operaciones y oficina', 'Agua', 'Fijos', 'planilla septiembre 2026'),
  ('Operaciones y oficina', 'Librería', 'Varios', 'planilla septiembre 2026'),
  ('Operaciones y oficina', 'Reparaciones', 'Varios', 'planilla septiembre 2026'),
  ('Operaciones y oficina', 'Articulos de higiene', 'Varios', 'planilla septiembre 2026'),
  ('Operaciones y oficina', 'Farmacia', 'Varios', 'planilla septiembre 2026'),
  ('Marketing', 'Publicidad', 'Fijos', 'planilla septiembre 2026'),
  ('Seguros', 'Auto', 'Fijos', 'planilla septiembre 2026'),
  ('Seguros', 'Local', 'Fijos', 'planilla septiembre 2026'),
  ('Seguros', 'Moto', 'Fijos', 'planilla septiembre 2026'),
  ('Gastos generales', 'Ferreteria', 'Varios', 'planilla septiembre 2026'),
  ('Gastos generales', 'Reparaciones', 'Varios', 'planilla septiembre 2026'),
  ('Gastos generales', 'Equipamiento', 'Varios', 'planilla septiembre 2026')
on conflict (sucursal, categoria, detalle) do nothing;