-- ============================================================================
--  UN TRACKING IDENTIFICA UN ENVÍO SOLO DENTRO DE QUIEN LO EMITIÓ
--  ---------------------------------------------------------------------------
--  Pegar en Supabase → SQL Editor → Run. Es idempotente.
--
--  EL BUG (reportado el 13/11/2026). El operador vio 4 envíos de DEVANA TUS
--  SUEÑOS donde su sistema tenía 5. El que faltaba era el `12112026`, de TRES
--  DE FEBRERO.
--
--  LA CAUSA. DEVANA numera sus envíos POR FECHA —10112026, 11112026,
--  12112026— y SANITARIOS GARCIA numera igual. Los dos tuvieron un `12112026`
--  el 12/11, los dos vinieron en el mismo archivo, y como `trackingValido`
--  pedía 8+ dígitos esos números pasaban por tracking de transporte y recibían
--  la clave `T:12112026`, que es GLOBAL: no lleva el cliente adentro. El import
--  los tomó por "el mismo envío repetido", se quedó con el último y tiró el de
--  DEVANA.
--
--  Es el bug de DISDEC un escalón más arriba: ahí el dato que faltaba en la
--  clave era la REFERENCIA, acá es el CLIENTE.
--
--  EL ARREGLO. Un tracking de transporte (Mercado Libre, 11 dígitos) es único
--  en el mundo y conserva su clave `T:`. Un número INTERNO (8 a 10 dígitos)
--  vale solo dentro de su cliente, así que su clave pasa a ser
--  `I:<cliente normalizado>|<número>`.
--
--  POR QUÉ EL CORTE VA EN 11: lo dicen los datos, no una corazonada. Los
--  117.776 envíos con tracking de transporte tienen 11 dígitos; de 8 a 10 no
--  hay ninguno — es todo numeración de clientes.
--
--  POR QUÉ EL CLIENTE NO ENTRA EN LAS CLAVES `T:`: un envío de Mercado Libre
--  viene a veces SIN cliente en un archivo y CON cliente en el siguiente. Si el
--  cliente entrara en su clave, ese envío cambiaría de clave y se DUPLICARÍA.
--  En la base ya se ven esos pares. Por eso el cliente entra solo donde hace
--  falta: en los números internos, que es donde el cliente SIEMPRE está porque
--  es quien los emite.
--
--  MEDIDO ANTES DE APLICAR (sobre los datos reales):
--    · 155 claves a migrar en `registros` (30 clientes) y 18 en el archivo.
--    · El normalizador de SQL reproduce EXACTAMENTE las 4.272 claves `D:` que
--      escribió JavaScript (y las 1.480 del archivo): 0 discrepancias. Esa es
--      la única forma de saber que las dos puntas piensan igual, con los
--      acentos y las eñes reales adentro — `DEVANA TUS SUEÑOS` tiene que dar
--      `devana tus suenos` de los dos lados.
--    · Choques: de 12 grupos repetidos se baja a 4, y no se crea ninguno
--      nuevo. Las 155 filas pasan de 143 claves distintas a 151.
--    · Los 4 que quedan son OTRO problema, ya conocido: el mismo cliente con
--      el mismo número dos veces, siempre "uno del import + uno cargado a
--      mano" (DEVANA 27102026; DISDEC 500012554, 500012646 y 500012669). Eso
--      lo previene `_enviosYaCargados`, no la clave.
-- ============================================================================

-- 1) RESPALDO de la columna, antes de tocar nada. Nace con RLS y sin policy:
--    invisible por la API, intacto desde SQL. Un respaldo nuevo que queda
--    abierto es como siete tablas de este proyecto quedaron legibles por
--    internet (relevamiento del 24/10/2026).
create table if not exists public.registros_clave_bkp_20261113 as
  select id, clave from public.registros where clave ~ '^T:[0-9]{8,10}$';
alter table public.registros_clave_bkp_20261113 enable row level security;

create table if not exists public.registros_hist_clave_bkp_20261113 as
  select id, clave from public.registros_historico where clave ~ '^T:[0-9]{8,10}$';
alter table public.registros_hist_clave_bkp_20261113 enable row level security;

-- 2) EL NORMALIZADOR, gemelo de `_normTxt` de src/core.js:
--      lower → NFD → sacar los diacríticos → lo que no es [a-z0-9] pasa a
--      espacio → trim.
--    El ORDEN importa: si los diacríticos no se sacan ANTES, el paso siguiente
--    los convierte en un ESPACIO y "SUEÑOS" daría "suen os" en vez de
--    "suenos" — o sea una clave que la app no reconocería nunca.
create or replace function public.norm_txt_clave(s text)
returns text language sql immutable
set search_path to 'public'
as $$
  select pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(
               -- `normalize(x, NFD)` es SINTAXIS del parser, no una llamada común:
               -- NFD es una palabra clave, no un valor. Calificada como
               -- `pg_catalog.normalize` deja de ser esa sintaxis y NFD se parsea
               -- como una COLUMNA — `ERROR: 42703: column nfd does not exist`,
               -- que es lo que tiró el primer intento. Va sin calificar, y
               -- resuelve igual de seguro: pg_catalog se busca SIEMPRE primero,
               -- esté o no en el search_path.
               normalize(pg_catalog.lower(coalesce(s, '')), NFD),
               U&'[\0300-\036F]', '', 'g'),
             '[^a-z0-9]+', ' ', 'g'))
$$;

-- 3) LA MIGRACIÓN. El número se toma de la CLAVE y no de la columna
--    `tracking`: la clave guarda el texto exacto con el que se armó, así que
--    un espacio de más en la columna no puede desalinear las dos puntas.
update public.registros
   set clave = 'I:' || public.norm_txt_clave(cliente_cod) || '|' || substring(clave from 3)
 where clave ~ '^T:[0-9]{8,10}$';

update public.registros_historico
   set clave = 'I:' || public.norm_txt_clave(cliente_cod) || '|' || substring(clave from 3)
 where clave ~ '^T:[0-9]{8,10}$';

-- ── CONTROL ─────────────────────────────────────────────────────────────────
-- Tiene que decir: sin_migrar = 0, y claves_I ≈ 155 / 18.
select
  (select count(*) from public.registros          where clave ~ '^T:[0-9]{8,10}$') as sin_migrar_vivos,
  (select count(*) from public.registros_historico where clave ~ '^T:[0-9]{8,10}$') as sin_migrar_archivo,
  (select count(*) from public.registros          where clave like 'I:%')           as claves_I_vivos,
  (select count(*) from public.registros_historico where clave like 'I:%')          as claves_I_archivo,
  (select count(*) from public.registros          where clave is null or clave = '') as sin_clave,
  public.norm_txt_clave('DEVANA TUS SUEÑOS')                                        as prueba_enie;

-- ── CÓMO VOLVER ATRÁS, si hiciera falta ─────────────────────────────────────
-- update public.registros r set clave = b.clave
--   from public.registros_clave_bkp_20261113 b where b.id = r.id;
-- update public.registros_historico h set clave = b.clave
--   from public.registros_hist_clave_bkp_20261113 b where b.id = h.id;
