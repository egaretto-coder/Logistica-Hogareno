-- ============================================================================
--  LA SUCURSAL SE RESUELVE UNA VEZ POR CÓDIGO, NO UNA POR ENVÍO
--  ---------------------------------------------------------------------------
--  Pegar en Supabase → SQL Editor → Run. Es idempotente.
--
--  EL INCIDENTE (12/11/2026). La carga de los días 10 y 11 —4.591 envíos—
--  murió con `canceling statement due to statement timeout` y la transacción
--  se deshizo ENTERA: no entró una sola fila. El operador trabajó media hora
--  sobre los envíos que tenía en memoria hasta que la primera re-hidratación
--  se los llevó de los dos paneles a la vez.
--
--  LA CAUSA. El rol `authenticated` tiene `statement_timeout = 8 s`, y
--  `reemplazar_registros` llamaba a `sucursal_de_cliente` UNA VEZ POR FILA
--  —dos veces por carga, en el borrado y en el insert—: con 4.591 envíos son
--  ~9.000 llamadas. Y no es una llamada barata: es `SECURITY DEFINER` con
--  `SET search_path`, así que Postgres NO puede inlinearla ni memoizarla
--  (inlineada a mano el mismo trabajo son 21 ms gracias al Memoize; como
--  llamada a función se paga una por fila), y además escanea `clientes`
--  entera porque el único índice que hay es sobre `upper(btrim(codigo))` y la
--  función compara `codigo` pelado.
--
--  EL ARREGLO. Los envíos de una carga traen MUY POCOS códigos distintos
--  —medido sobre 4.591 envíos reales: 124—, así que la sucursal se resuelve
--  una sola vez por código y queda en un mapa que las dos pasadas consultan.
--  De ~9.000 llamadas a ~124.
--
--  La app ya guarda en lotes de 800 (v324), así que esto no es lo que evita el
--  timeout: es sacarle a cada carga un trabajo que nunca hizo falta. Las dos
--  cosas juntas son las que hacen que no vuelva.
-- ============================================================================

-- 1) Un índice que `sucursal_de_cliente` pueda usar de verdad. El que había
--    es sobre `upper(btrim(codigo))` y la función compara `codigo` pelado, así
--    que no lo tocaba: cada llamada escaneaba la tabla. `clientes` es chica,
--    pero una comparación que no usa índice crece con el padrón.
create index if not exists idx_clientes_codigo_plano
  on public.clientes (codigo);

-- 2) La función, con el mapa.
create or replace function public.reemplazar_registros(claves text[], filas jsonb)
returns bigint[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare ids bigint[]; suc_activa text; mapa jsonb;
begin
  if not public.es_usuario_activo() then
    raise exception 'Usuario sin acceso';
  end if;
  suc_activa := coalesce(public.sucursal_pedida(), 'BA');

  -- EL MAPA: una entrada por CÓDIGO DISTINTO de la carga, no una por envío.
  -- La normalización tiene que ser la MISMA que la de sucursal_de_cliente
  -- (btrim + nullif), si no un código con un espacio al final caería en la
  -- sucursal activa en vez de en la suya.
  select coalesce(jsonb_object_agg(t.cod, t.suc), '{}'::jsonb) into mapa
    from (
      select c.cod, coalesce(public.sucursal_de_cliente(c.cod), suc_activa) suc
        from (
          select distinct pg_catalog.btrim(coalesce(x.cliente_cod, '')) cod
            from jsonb_to_recordset(filas) as x(cliente_cod text)
        ) c
       where c.cod <> ''
    ) t;

  if claves is not null and array_length(claves, 1) > 0 then
    with entra as (
      select coalesce(x.clave, '') clave,
             coalesce(mapa ->> pg_catalog.btrim(coalesce(x.cliente_cod, '')), suc_activa) suc
        from jsonb_to_recordset(filas) as x(clave text, cliente_cod text)
    ), por_clave as (
      select clave, count(*) k from entra group by 1
    ), bocas as (
      select distinct suc from entra
      union select suc_activa
    ), objetivo as (
      select r.id,
             row_number() over (partition by r.clave order by r.id) rn,
             coalesce(p.k, 0) k,
             (p.clave is null) borrar_todas
        from public.registros r
        left join por_clave p on p.clave = r.clave
       where r.clave = any(claves)
         and r.sucursal in (select suc from bocas)
    )
    delete from public.registros d
     using objetivo o
     where d.id = o.id and (o.borrar_todas or o.rn <= o.k);
  end if;

  with nuevas as (
    insert into public.registros
      (sucursal, cadete, tracking, fecha, fecha_date, localidad, zona, zona_precio, direccion, destinatario,
       cliente, cliente_cod, dim_especial, dim_cliente, cobro_destino, estado, precio_bd,
       carga_fecha, clave, manual, zona_manual, contabiliza_manual, motivo_contab,
       anulado_cliente, motivo_anulacion, factura_semana, precio_manual)
    select
      coalesce(mapa ->> pg_catalog.btrim(coalesce(x.cliente_cod, '')), suc_activa),
      coalesce(x.cadete,''), coalesce(x.tracking,''), coalesce(x.fecha,''), x.fecha_date,
      coalesce(x.localidad,''), coalesce(x.zona,''), coalesce(x.zona_precio,''),
      coalesce(x.direccion,''), coalesce(x.destinatario,''), coalesce(x.cliente,''),
      coalesce(x.cliente_cod,''), coalesce(x.dim_especial,''), coalesce(x.dim_cliente,''),
      coalesce(x.cobro_destino,0), coalesce(x.estado,''), coalesce(x.precio_bd,0),
      coalesce(x.carga_fecha,''), coalesce(x.clave,''), coalesce(x.manual,false),
      coalesce(x.zona_manual,false), coalesce(x.contabiliza_manual,false),
      coalesce(x.motivo_contab,''), coalesce(x.anulado_cliente,false),
      coalesce(x.motivo_anulacion,''), x.factura_semana, x.precio_manual
    from jsonb_to_recordset(filas) as x(
      cadete text, tracking text, fecha text, fecha_date date, localidad text, zona text,
      zona_precio text, direccion text, destinatario text, cliente text, cliente_cod text,
      dim_especial text, dim_cliente text, cobro_destino numeric, estado text, precio_bd numeric,
      carga_fecha text, clave text, manual boolean, zona_manual boolean, contabiliza_manual boolean,
      motivo_contab text, anulado_cliente boolean, motivo_anulacion text, factura_semana date,
      precio_manual numeric)
    returning id
  )
  select array_agg(id order by id) into ids from nuevas;

  return coalesce(ids, '{}'::bigint[]);
end $function$;

-- 3) Los permisos, como estaban: la llama la app con el usuario logueado.
revoke all on function public.reemplazar_registros(text[], jsonb) from public, anon;
grant execute on function public.reemplazar_registros(text[], jsonb) to authenticated;

-- ── CONTROL ─────────────────────────────────────────────────────────────────
-- Tiene que decir: mapa_una_vez = true, sin_llamada_por_fila = true.
select
  (select count(*) from pg_proc
    where proname = 'reemplazar_registros'
      and pg_get_functiondef(oid) like '%jsonb_object_agg%') > 0 as mapa_una_vez,
  (select count(*) from pg_proc
    where proname = 'reemplazar_registros'
      and pg_get_functiondef(oid) like '%sucursal_de_cliente(x.cliente_cod)%') = 0 as sin_llamada_por_fila,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'idx_clientes_codigo_plano') as indice;
