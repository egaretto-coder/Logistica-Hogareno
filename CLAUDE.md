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
| `dashboard` | Dashboard | `pantallas/dashboard.html` | `src/dashboard.js` | Resumen general; totales y exportación de PDFs por día de pago. |
| `upload` | Importar datos | `pantallas/importar-datos.html` | `src/importar.js` | Importar Excel de recorridos (hoja "BD") con mapeo de columnas; también Km y Adelantos. |
| `liquidaciones` | Liquidaciones | `pantallas/liquidaciones.html` | `src/liquidaciones.js`, `src/liquidaciones-pdf.js` | Cálculo por conductor y período; genera el PDF de liquidación (bruto − descuentos = neto). |
| `conductores` | Conductores | `pantallas/conductores.html` | `src/conductores.js` | **Detalle/editor por conductor**: corregir a mano tracking, zona (confirmación en 2 pasos), precio y estado. Autosave a la nube. |
| `reporte-zona` | Por zona | `pantallas/reporte-zona.html` | `src/reportes.js` | Análisis geográfico: recorridos, conductores y total por zona. |
| `reporte-conductor` | Por conductor | `pantallas/reporte-conductor.html` | `src/reportes.js` | Resumen ejecutivo por conductor (categoría, zonas, total). |
| `panel-conductores` | Panel de conductores | `pantallas/panel-conductores.html` | `src/panel-conductores.js` | Alta/edición de conductores: **condición** (día de pago) y **categorización** (precio). Vincular grafías de recorrido vía **alias**. |
| `config-tarifas` | Tarifas | `pantallas/tarifas.html` | `src/config-tarifas.js` | Precios por zona y categoría (s_colecta / c_colecta / sla). |
| `config-supersla` | Super SLA | `pantallas/super-sla.html` | `src/config-supersla.js` | Tarifa especial por conductor + zona (solo conductores categoría `super_sla`). |
| `dimensiones-especiales` | Dimensiones Especiales | `pantallas/dimensiones-especiales.html` | `src/dimensiones-especiales.js` | Trackings con valor especial que **reemplaza** la tarifa de zona. |
| `descuento-conductores` | Descuento Conductores | `pantallas/descuento-conductores.html` | `src/descuento-conductores.js`, `src/descuentos-items.js`, `src/adelantos.js` | Combustible, extraviados/rotos (cuoteables), adelantos y servicio proveedores por conductor; imputados por fecha. |
| `gestion-permisos` | Gestión de permisos | `pantallas/gestion-permisos.html` | `src/gestion-permisos.js` | Qué pantallas ve cada rol y usuarios asignados. |

**Módulos núcleo (no son pantallas):** `src/supabase.js` (cliente + helpers DB), `src/core.js` (estado `AppData`, cálculo de precios, seed, `PAGE_TITLES`), `src/auth.js` (roles/permisos), `src/datos.js` (hidratación + persistencia), `app/main.js` (router + bootstrap + SW). Componentes: `components/{sidebar,header,modales}.html`.

## Modelo de dominio
- **Conductor**: se identifica por nombre. Los recorridos traen `cadete` (texto). El **Panel de conductores** le asigna condición y categoría.
  - **Condición → día de pago**: Titular=viernes · Semi Titular=lunes · Suplente=martes.
  - **Categorización → tier de precio**: `s_colecta` (S/ Colecta) · `c_colecta` (C/ Colecta) · `sla` (SLA Cumplido) · `super_sla` (Super SLA).
- **Identidad canónica / alias**: el nombre del recorrido puede diferir del panel (apodos, typos). Se vinculan con **alias** y se unifican con `conductorCanonico()`. Ver `identidad-conductor-canonica` en memoria. **Invariante**: agrupar recorridos SIEMPRE por `conductorCanonico(r.cadete)`, e invalidar el índice (`invalidarIndicePanel()`) al mutar el panel.
- **Precio** (`getPrecio` en `src/core.js`): 1) Super SLA para esa zona → precio especial; 2) tiene Super SLA en otra zona → SLA Cumplido estándar; 3) tipo fijo del panel. Las **dimensiones especiales** (por tracking) pisan todo; el **precio_manual** del operador pisa el cálculo.
- **Correcciones a mano** (localizables con filtro "Solo corregidos"): `precio_manual` (precio pisado), `manual` (envío cargado a mano), `zona_manual` (zona definida a mano).
- **Descuentos**: `descuentos_items` (combustible/extraviados/proveedores, imputados por fecha; extravíos cuoteables → `descuento_cuotas`), `adelantos`/`adelanto_cuotas`, km de desvío.
- **Registros**: viven en `registros`; los viejos se archivan a `registros_historico` (solo lectura) vía RPC `archivar_registros`.

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
