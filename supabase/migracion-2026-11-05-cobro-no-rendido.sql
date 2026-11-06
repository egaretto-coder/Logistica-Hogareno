-- ============================================================================
--  COBRO NO RENDIDO: el conductor DEBE el cobro que no trajo
--  ---------------------------------------------------------------------------
--  Pegar en Supabase → SQL Editor → Run. Es idempotente: correrla dos veces
--  no hace nada distinto.
--
--  POR QUÉ UN TIPO PROPIO Y NO "extraviados" O "proveedores": el conductor
--  firma el PDF de su liquidación, y ahí el descuento tiene que decir de qué
--  es. Metido dentro de otro concepto, el papel diría que se le descontó un
--  extravío que no existió.
-- ============================================================================

-- 1) El tipo nuevo. La columna tiene un CHECK, así que sin esto el insert
--    falla con "violates check constraint".
alter table public.descuentos_items drop constraint if exists descuentos_items_tipo_check;
alter table public.descuentos_items add constraint descuentos_items_tipo_check
  check (tipo in ('combustible','extraviados','proveedores','cobros'));

-- 2) Lo ata al cobro que lo originó. Sin este vínculo no hay forma de saber
--    si un cobro ya se imputó, y se le descontaría dos veces al conductor —
--    es el mismo patrón que cliente_cargos.origen_item_id con los extravíos.
alter table public.descuentos_items
  add column if not exists origen_rendicion_id bigint;
-- El FK va con NOMBRE propio: `add column ... references` lo nombraria solo,
-- y entonces schema.sql no lo reconoceria y agregaria un segundo FK sobre la
-- misma columna. Los dos archivos tienen que llamarlo igual.
do $$ begin
  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.descuentos_items'::regclass
      and c.contype = 'f' and a.attname = 'origen_rendicion_id'
  ) then
    alter table public.descuentos_items add constraint descuentos_items_origen_rendicion_fk
      foreign key (origen_rendicion_id) references public.rendiciones(id) on delete cascade;
  end if;
end $$;

-- 3) UN cobro, UN descuento. El índice único lo impide en la base y no solo
--    en el navegador: dos pestañas abiertas son dos operadores.
--    SIN sucursal a propósito, al revés que el resto de las claves únicas:
--    rendiciones.id lo numera la base y es único en todo el proyecto, así que
--    incluirla permitiría dos descuentos del mismo cobro en bocas distintas,
--    que es exactamente lo que hay que impedir.
create unique index if not exists descuentos_items_origen_rendicion_uq
  on public.descuentos_items(origen_rendicion_id)
  where origen_rendicion_id is not null;

-- 4) El estado nuevo del cobro: se saldó descontándolo de la factura del
--    cliente en vez de devolverle la plata. La columna es texto libre, así que
--    esto es solo el comentario que lo documenta.
comment on column public.rendiciones.estado is
  'pendiente | recibido | rendido | descontado | anulado. "descontado" = se le tomó al cliente como parte de pago en su liquidación; NO toca su factura, solo registra cómo se saldó.';
