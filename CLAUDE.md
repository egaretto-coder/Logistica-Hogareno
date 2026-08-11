# Logística Hogareño — Sistema de Liquidaciones

App web para calcular las **liquidaciones** (pagos) de los conductores/cadetes de Logística Hogareño a partir de los recorridos importados de un Excel, aplicando tarifas por zona, categorías, Super SLA, dimensiones especiales y descuentos.

## Stack y despliegue
- **Estático, sin build**: HTML + CSS + JS vanilla. No hay bundler, framework ni paso de compilación. No agregar uno.
- **PWA**: `manifest.webmanifest` + `sw.js` (service worker). Cache versionado `liq-cache-vNN`.
- **Backend**: Supabase (proyecto `rsglddbierwejiusrpvd`). Auth por email + RLS `for all to authenticated`.
- **Hosting**: Vercel, auto-deploy al pushear a `main`. Producción: `logistica-hogareno.vercel.app`.
- **Repo**: GitHub `egaretto-coder/Logistica-Hogareno`.

## Cómo carga la app (arquitectura)
- `index.html` es el shell: monta `#login-overlay`, `#app-layout`, `#modales` y carga todos los `<script defer>`.
- `app/main.js` **bootstrap** (en `DOMContentLoaded`): hace `fetch` de los parciales HTML (`pantallas/*.html`, `components/*.html`) y los **inyecta en runtime**. Por eso cualquier listener que dependa de un elemento del modal debe usar **delegación de eventos** (no `addEventListener` al parsear el script, que corre antes de que exista el DOM).
- **Router**: `showPage(id)` en `app/main.js` muestra la página y llama al `render*()` correspondiente.
- **Estado global**: todo vive en `AppData` (memoria), definido en `src/core.js`. Se hidrata desde Supabase + caché `localStorage`. Las pantallas **recalculan desde `AppData` en cada render** (no hay estado duplicado).

## Pantallas (todas)
Nav en `components/sidebar.html`; títulos en `PAGE_TITLES` (`src/core.js`).

| Pantalla (id) | Nav | HTML | JS | Qué hace |
|---|---|---|---|---|
| `login` | — | `pantallas/login.html` | `src/auth.js` | Login por email; roles y permisos por pantalla. |
| `dashboard` | Dashboard | `pantallas/dashboard.html` | `src/dashboard.js`, `src/reportes.js` | Resumen general (KPIs, distribución por categorización, ranking de facturación) por período. **Integra los reportes Por zona y Por conductor** (tablas + búsqueda + export PDF `exportReporteZonaPDF`/`exportReporteConductorPDF`), que respetan el período del Dashboard. |
| `upload` | Importar datos | `pantallas/importar-datos.html` | `src/importar.js` | Importar Excel de recorridos (hoja "BD") con mapeo de columnas; también Km y Adelantos. **Historial de importaciones** (`importaciones`): registra archivo · día/hora de carga · fechas cubiertas, **bloquea reimportar el mismo documento** (hash de contenido) y **avisa días hábiles (Lun–Sáb) sin registros**. Panel **Archivo**: consultar recorridos archivados por rango de fechas (`selectHistoricoRango`) + archivar viejos (RPC `archivar_registros`). |
| `liquidaciones` | Liquidaciones | `pantallas/liquidaciones.html` | `src/liquidaciones.js`, `src/liquidaciones-pdf.js` | Cálculo por conductor y período; genera el PDF de liquidación (bruto − descuentos = neto). |
| `conductores` | Conductores | `pantallas/conductores.html` | `src/conductores.js` | **Detalle/editor por conductor**: corregir a mano tracking, zona (confirmación en 2 pasos), precio y estado. Autosave a la nube. |
| `panel-conductores` | Panel de conductores | `pantallas/panel-conductores.html` | `src/panel-conductores.js` | Alta/edición de conductores: **condición** (día de pago) y **categorización** (precio). Vincular grafías de recorrido vía **alias**. Filtro "Sin asignar". |
| `config-tarifas` | Tarifas | `pantallas/tarifas.html` | `src/config-tarifas.js` | Precios por zona y categoría (s_colecta / c_colecta / sla). |
| `config-supersla` | Super SLA | `pantallas/super-sla.html` | `src/config-supersla.js` | Tarifa especial por conductor + zona (solo conductores categoría `super_sla`). **Eliminar** conductor (pasa a `sla` y borra sus zonas) + **import/export Excel** (Conductor · ID · Zona · Precio; el import marca `super_sla`, crea faltantes y reemplaza zonas). |
| `dimensiones-especiales` | Dimensiones Especiales | `pantallas/dimensiones-especiales.html` | `src/dimensiones-especiales.js` | Trackings con valor especial que **reemplaza** la tarifa de zona. |
| `extraviados` | Extraviados / Rotos | `pantallas/extraviados.html` | `src/descuentos-items.js` | Envíos extraviados/rotos por conductor (valor real, cuoteables). **Régimen de autorización** (ver dominio). |
| `beneficios` | Beneficios | `pantallas/beneficios.html` | `src/descuentos-items.js`, `src/descuento-conductores.js` | Sub-solapas **Combustible** + **Servicio Proveedores** (`switchBeneficioTab`); descuentos por fecha, creación directa. |
| `km-desvio` | Km de desvío | `pantallas/km-desvio.html` | `src/descuento-conductores.js` | Adicional por km de desvío (tarifa vigente a la fecha; suma al neto). Solo analista cambia el valor por km. Creación directa. |
| `adelantos` | Adelantos | `pantallas/adelantos.html` | `src/adelantos.js` | Préstamos en cuotas + **resumen de deuda** (total y por conductor, solo autorizados). **Régimen de autorización**. |
| `clientes` | Clientes | `pantallas/clientes.html` | `src/clientes.js` | Facturación por cliente: ABM de clientes + **tarifario de venta por zona** (`cliente_tarifas`, con import Excel) y **liquidación semanal Vie→Jue** (envíos entregados × tarifa) descargable en PDF. |
| `comisiones` | Comisiones | `pantallas/comisiones.html` | `src/comisiones.js` | Comisiones de **vendedores** por **clientes nuevos**: ABM vendedores, **supervisor único** (% configurable), **escala de categorización** (import Excel), asignación cliente→vendedor con **evaluación de las 4 primeras liquidaciones**, y **cierre mensual** (pago + PDF). |
| `gestion-permisos` | Gestión de permisos | `pantallas/gestion-permisos.html` | `src/gestion-permisos.js` | Qué pantallas ve cada rol y usuarios asignados; alta/baja de roles. |

**Módulos núcleo (no son pantallas):** `src/supabase.js` (cliente + helpers DB), `src/core.js` (estado `AppData`, cálculo de precios, seed, `PAGE_TITLES`), `src/auth.js` (roles/permisos), `src/datos.js` (hidratación + persistencia), `src/realtime.js` (sincronización en tiempo real), `app/main.js` (router + bootstrap + SW). Componentes: `components/{sidebar,header,modales}.html`.

## Modelo de dominio
- **Conductor**: se identifica por nombre. Los recorridos traen `cadete` (texto). El **Panel de conductores** le asigna condición y categoría.
  - **Condición → día de pago**: Titular=viernes · Semi Titular=lunes · Suplente=martes.
  - **Categorización → tier de precio**: `s_colecta` (S/ Colecta) · `c_colecta` (C/ Colecta) · `sla` (SLA Cumplido) · `super_sla` (Super SLA).
- **Identidad canónica / alias**: el nombre del recorrido puede diferir del panel (apodos, typos). Se vinculan con **alias** y se unifican con `conductorCanonico()`. Ver `identidad-conductor-canonica` en memoria. **Invariante**: agrupar recorridos SIEMPRE por `conductorCanonico(r.cadete)`, e invalidar el índice (`invalidarIndicePanel()`) al mutar el panel.
- **Precio** (`getPrecio` en `src/core.js`): 1) Super SLA para esa zona → precio especial; 2) tiene Super SLA en otra zona → SLA Cumplido estándar; 3) tipo fijo del panel. Las **dimensiones especiales** (por tracking) pisan todo; el **precio_manual** del operador pisa el cálculo.
- **Correcciones a mano** (localizables con filtro "Solo corregidos"): `precio_manual` (precio pisado), `manual` (envío cargado a mano), `zona_manual` (zona definida a mano).
- **Descuentos / movimientos** (4 paneles independientes, ex "Descuento Conductores"): **Extraviados/Rotos** y **Beneficios** (Combustible + Proveedores) → `descuentos_items` (imputados por fecha; extravíos cuoteables → `descuento_cuotas`); **Adelantos** → `adelantos`/`adelanto_cuotas`; **Km de desvío** → `km_desvio`. El operador elige en Liquidaciones imputar o no cada cuota/descuento.
- **Régimen de superposiciones (maker-checker)**: los **adelantos** y **extravíos** cargados por un operador quedan `estado='pendiente'` y **NO impactan la liquidación** hasta que un supervisor/analista los autorice. Km y beneficios se crean directos (`autorizado`). Filas viejas (sin estado) = autorizadas. Helpers en `src/core.js`: `puedeAutorizar()` (supervisor/analista), `esAutorizado(x)`, `estadoNuevaOperacion()`. La imputación (`adelantoDescuentoConductor`, `extravioCuotaDescuento`, `descItemDescuentoConductor`) **excluye lo pendiente/rechazado**. Botones Autorizar/Rechazar en los paneles (solo autorizadores); el operador puede cancelar su solicitud pendiente.
- **Roles** (`ROL_PERMISOS` en `src/auth.js` + tabla `rol_permisos` editable en Gestión de permisos): `analista` (acceso total, autoriza), `administrativo` (operador/preparador), `supervisor` (autoriza plata), `tesorero` (plata, no autoriza). `paginasDeRol()` resuelve permisos; los roles nuevos viven en la tabla `roles`.
- **Registros**: viven en `registros`; los viejos se archivan a `registros_historico` (solo lectura) vía RPC `archivar_registros`.
- **Clientes (facturación)**: cada recorrido trae su **cliente** (empresa que factura) en el Excel → columna `cliente` de `registros`. El panel **Clientes** administra el maestro `clientes` y su **tarifario de venta por zona** (`cliente_tarifas`: lo que se le cobra al cliente por envío entregado, distinto del costo que se paga al conductor). La **liquidación de cliente** es semanal **Viernes→Jueves** (jueves = corte): envíos entregados (`ESTADOS_CONTABILIZAN`) × tarifa de venta por zona, agrupados y descargables en PDF. Matcheo cliente↔recorrido por nombre normalizado (`normNombre`). El tarifario se puede cargar a mano o por **import Excel** (Cliente · Zona · Precio, que auto-crea clientes).
- **Comisiones (de vendedores)**: los **vendedores** (`vendedores`) comisionan un **monto fijo mensual** por cada **cliente nuevo** que se les asigna (`comision_clientes`), **durante 5 meses**. El monto surge de **evaluar las primeras 4 liquidaciones** del cliente (semanas Vie→Jue desde su primer envío contabilizable): su facturación de venta acumulada se ubica en la **escala de categorización importada** (`comision_categorias`: rango `fact_desde`–`fact_hasta` → categoría → `monto`). La evaluación se calcula en vivo y se **congela al confirmar** (`bloqueado=true`, guarda `categoria`/`facturacion_eval`/`monto`/`mes_inicio`); solo las filas confirmadas entran al cierre mensual. Los **5 meses de pago** arrancan en `mes_inicio` (default = mes siguiente al fin de la evaluación, editable). El **supervisor único** (config `comision_supervisor` + `comision_supervisor_pct`, default 30%) cobra ese % del total comisionado por todo el equipo. El **cierre mensual** (`calcComisionesMes`) lista por vendedor + supervisor, se **marca como pagado** (`comision_pagos`, único por `periodo`+`beneficiario`) y se descarga en PDF. Toda la lógica en `src/comisiones.js` (reusa `calcLiquidacionCliente`/`semanaClienteRango` de `src/clientes.js`).

## Datos en tiempo real / sincronización
- `AppData` es la fuente única en memoria. Arranque instantáneo/offline desde `localStorage`; datos frescos desde Supabase (`DB.loadAll`) al iniciar sesión / `restoreSession`.
- Persistencia: `dbPush('tabla')` (reemplaza la tabla) para configuración; `DB.updateWhere` por-fila para ediciones de recorridos (**autosave ~2.5s** en Conductores).
- Las vistas **recalculan desde `AppData` en cada render**, así que un cambio se refleja al instante en todas las pantallas que se vuelven a renderizar.
- **Sincronización en tiempo real** (`src/realtime.js`, Supabase Realtime): al iniciar sesión la app se suscribe a los cambios de las tablas clave. Ante cualquier cambio (otro usuario/dispositivo o un import) → re-hidrata `AppData` con `hydrateFromSupabase()` y re-renderiza la pantalla activa (`rerenderPaginaActiva`), sin recargar. Con **debounce** (agrupa ráfagas), **guarda de edición en curso** (no pisa al operador con cambios sin guardar / modal abierto) y **mute de escritura local** (`marcarEscrituraLocal()` en `dbPush`/autosave/import, para no recargar por el propio eco). Las tablas deben estar en la publicación `supabase_realtime`.
- SW **network-first** para mismo-origen: con conexión siempre sirve la última versión del código; el caché es respaldo offline.

## Convenciones al editar
- **No** introducir build tools, frameworks ni dependencias nuevas. Mantener JS vanilla.
- **Iconos**: `css/icons.css` (CSS mask), usar `<i class="ic ic-NOMBRE"></i>`. **No** agregar emojis nuevos en la UI (los toasts/textos existentes sí los usan). Los iconos se generan con el script `gen_icons.js` del scratchpad.
- **Cada despliegue**: subir `CACHE` en `sw.js` (`liq-cache-vNN`) para disparar el banner "Actualizar". Si se agrega un archivo servido, sumarlo a `APP_SHELL`.
- **Modo oscuro**: tokens en `:root[data-theme="dark"]` (`css/styles.css`), toggle en el sidebar, preferencia en `localStorage.liq_tema`, script anti-flash en `index.html`. Los colores hardcodeados inline no se pueden tematizar; preferir clases/tokens.
- **PDF de liquidación**: es **cara al conductor** — no exponer info interna (tipo de tarifa, marcadores de corrección).

## Flujo de despliegue (IMPORTANTE)
1. Implementar el cambio.
2. Verificar en el preview local (`preview_start` "static") + `node --check` de los JS.
3. **Pedir aprobación al usuario antes de desplegar a producción.**
4. Commit + push a `main` (Vercel auto-deploya).
5. Verificar producción con cache-buster (`curl ".../sw.js?cb=..."`) y confirmar que `CACHE` subió.
- Migraciones de DB: aplicar con la tool de Supabase y documentar en `supabase/schema.sql`.
- Si un push no dispara deploy (webhook perdido), un commit nuevo (o `git commit --allow-empty`) lo re-dispara.
