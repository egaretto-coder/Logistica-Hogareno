-- ============================================================================
--  TABLA DE COSTOS: cada costo de la empresa, con su categoría y su aprobación
--  ---------------------------------------------------------------------------
--  Pegar en Supabase → SQL Editor → Run. Es idempotente: correrla dos veces
--  no hace nada distinto.
--
--  QUÉ NO SE GUARDA, Y POR QUÉ:
--   · el TIPO (Fijo / Variable / Gastos varios) NO es una columna: sale de la
--     categoría (`costoTipoDe` en src/costos.js). Dos personas no pueden
--     clasificar distinto el mismo gasto, y los meses quedan comparables —
--     que es justo para lo que se usa esta tabla.
--   · el MES tampoco: se deriva de `fecha`. Guardar el resultado además del
--     factor es la forma de que queden en desacuerdo (misma lección que el
--     mes de una compra y la edad de un empleado).
-- ============================================================================

create table if not exists public.costos (
  id bigint generated always as identity primary key,
  -- El día AL QUE CORRESPONDE el costo, no el día en que se tipeó. De acá
  -- sale el mes, y de ahí todos los reportes.
  fecha date not null,
  -- El PAR categoria+detalle es lo que decide el TIPO. Son dos niveles de un
  -- catálogo cerrado: la planilla real tiene "Operaciones y oficina" con
  -- Alquiler (Fijos) y Librería (Varios) adentro, así que la categoría sola
  -- no alcanza — 7 de las 11 tienen más de un tipo.
  categoria text not null,
  detalle text not null,
  -- Texto libre: a quién o a qué (lo que la planilla llama "DETALLES B":
  -- "Contadora Gabriela", "Suplencias", "Bidones").
  descripcion text not null default '',
  proveedor text not null default '',
  comprobante text not null default '',
  monto numeric not null default 0,
  -- Maker-checker, igual que adelantos y extravíos: lo carga uno y lo aprueba
  -- otro. Lo PENDIENTE no suma en ningún total —no se puede dar por buena una
  -- plata que nadie verificó— pero se avisa, porque esconderla sería peor.
  estado text not null default 'pendiente'
    check (estado in ('pendiente','autorizado','rechazado')),
  motivo text not null default '',          -- obligatorio al rechazar
  cargado_por text not null default '',
  decidido_por text not null default '',
  decidido_en timestamptz,
  obs text not null default '',
  created_at timestamptz not null default now(),
  sucursal text not null default coalesce(public.sucursal_pedida(), 'BA')
    references public.sucursales(codigo)
);

-- El filtro de todos los días es sucursal + mes, y el segundo es sucursal +
-- categoría (el ranking que arma los reportes).
create index if not exists idx_costos_fecha on public.costos (sucursal, fecha);
create index if not exists idx_costos_categoria on public.costos (sucursal, categoria, detalle);
-- Lo que espera decisión se busca de TODOS los meses: es el trabajo pendiente
-- del supervisor y esconderlo detrás de un filtro es como se pasa de largo.
create index if not exists idx_costos_estado on public.costos (sucursal, estado)
  where estado = 'pendiente';

alter table public.costos enable row level security;

-- OJO con la forma de la policy: `es_usuario_activo()` NO mira la fila, así
-- que va en un SUBSELECT ESCALAR para que Postgres la resuelva como InitPlan
-- —una vez por consulta— en vez de una vez por fila. Suelta, el 04/11/2026
-- tiró la app entera: las consultas pasaban el statement timeout y los
-- paneles quedaban vacíos. `es_de_sucursal(sucursal)` SÍ depende de la fila
-- y por eso va pelada.
drop policy if exists costos_sucursal_all on public.costos;
create policy costos_sucursal_all on public.costos
  for all to authenticated
  using ((select public.es_usuario_activo()) and public.es_de_sucursal(sucursal))
  with check ((select public.es_usuario_activo()) and public.es_de_sucursal(sucursal));

-- Sin esto, lo que aprueba un supervisor no le llega al operador hasta que
-- recargue — y los dos seguirían viendo totales distintos.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costos'
  ) then
    alter publication supabase_realtime add table public.costos;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
--  PERMISOS: supervisor y tesorero TIENEN filas en rol_permisos, y ahí el
--  default de ROL_PERMISOS (el del código) deja de aplicar por completo.
--  Sumar la pantalla al código NO ALCANZA: hace falta la fila.
--  (El analista no la necesita: paginasDeRol le devuelve todo desde el código.)
-- ─────────────────────────────────────────────────────────────────────────
--  Y OJO AL REVÉS: insertarle una fila a un rol que NO tiene ninguna le saca
--  TODO lo demás —el default del código deja de aplicar y solo ve lo marcado
--  true—. Por eso se inserta SOLO para los roles que ya tienen filas; al que
--  no las tiene lo sigue resolviendo el código, que ya lo contempla.
insert into public.rol_permisos (rol, pagina, permitido)
select r.rol, 'costos', true
from (select distinct rol from public.rol_permisos) r
where r.rol in ('supervisor','tesorero','administrativo','analista')
on conflict (rol, pagina) do update set permitido = true;
