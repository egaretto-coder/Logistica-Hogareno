# Liquidaciones — Logística Hogareño

Sistema web / **PWA** de gestión de finanzas y liquidaciones de logística.
Dashboard, importación de recorridos (Excel/CSV), cálculo de liquidaciones por
conductor, reportes por zona/conductor y configuración de tarifas, todo
respaldado en **Supabase** (PostgreSQL + Auth).

## Características

- 📊 **Dashboard** con métricas por período y por conductor.
- 📥 **Importación** de bases de recorridos (`.xlsx`, `.xls`, `.csv`) con mapeo de columnas.
- 💰 **Liquidaciones** con lógica de tarifas por zona, Super SLA, dimensiones especiales, descuentos y km de desvío.
- 📄 **Exportación a PDF** de liquidaciones por conductor.
- 👥 **Roles**: `analista` (acceso total) y `administrativo` (acceso limitado).
- ☁️ **Datos en la nube** (Supabase) — compartidos entre usuarios y dispositivos.
- 📱 **PWA** instalable, con caché offline del "app shell".

## Arquitectura

Sitio **estático** (HTML/CSS/JS, sin build) que usa el SDK de Supabase por CDN.
La interfaz se arma en tiempo de ejecución cargando parciales HTML por `fetch`
(no hay framework ni compilación).

```
index.html                → shell: <head>, puntos de montaje y carga de scripts
css/
  styles.css              → todos los estilos
components/               → parciales de UI reutilizables
  sidebar.html            → barra lateral / navegación
  header.html             → barra superior
  modales.html            → todos los modales
pantallas/               → una pantalla por archivo (HTML)
  login.html
  dashboard.html
  importar-datos.html
  liquidaciones.html
  conductores.html
  reporte-zona.html
  reporte-conductor.html
  tarifas.html
  super-sla.html
  panel-conductores.html
  dimensiones-especiales.html
  descuento-conductores.html
src/                     → lógica por responsabilidad (JS)
  supabase.js             → cliente Supabase + capa de datos (DB.loadAll / replaceAll)
  core.js                 → estado (AppData), helpers, cálculo de liquidaciones
  auth.js                 → login, sesión y permisos por rol
  datos.js                → hidratación/sincronización con Supabase + seed
  dashboard.js, liquidaciones.js, liquidaciones-pdf.js, conductores.js,
  reportes.js, importar.js, config-tarifas.js, config-supersla.js,
  panel-conductores.js, dimensiones-especiales.js, descuento-conductores.js
app/
  main.js                 → router (showPage) + bootstrap (carga parciales) + init
manifest.webmanifest      → manifiesto PWA
sw.js                     → service worker (caché offline)
assets/icons/             → iconos PWA
data/registros_seed.json  → set inicial de registros (opcional, para sembrar)
supabase/schema.sql       → esquema de la base de datos (referencia)
```

> Como la UI se carga con `fetch`, la app **debe** servirse por http(s), no con
> `file://` (ver “Uso local”).

### Base de datos (Supabase)

Proyecto: `rsglddbierwejiusrpvd` · URL: `https://rsglddbierwejiusrpvd.supabase.co`

Tablas: `perfiles`, `tarifas`, `super_sla`, `panel_conductores`,
`dimensiones_especiales`, `descuentos_conductores`, `km_desvio`, `registros`.

Todas con **RLS** activada: sólo usuarios **autenticados** leen/escriben. El
control por rol (analista/administrativo) se aplica en la interfaz.

## Usuarios iniciales

| Usuario                          | Contraseña   | Rol            |
|----------------------------------|--------------|----------------|
| `e.garetto@logisticahogar.com`   | `logistica1` | analista       |
| `rodri@logisticahogar.com`       | `rodri1`     | administrativo |

> En el login se puede escribir sólo `rodri` (se completa `@logisticahogar.com`).
> **Recomendado:** cambiar estas contraseñas desde Supabase → Authentication → Users.

## Uso local

Requiere **Node.js ≥ 16** (sin dependencias que instalar). Desde la raíz del proyecto:

```bash
npm run dev
```

Levanta `http://localhost:5173` y abre el navegador automáticamente.
`npm start` hace lo mismo sin abrir el navegador. Para otro puerto: `PORT=5174 npm run dev`.

> Servila siempre por **http(s)** (lo hace `npm run dev`), no con `file://`: el
> service worker y la carga de pantallas por `fetch` no funcionan desde el sistema de archivos.

Primer arranque: al loguearte, si las tablas base están vacías se **siembran
automáticamente** las tarifas, el Super SLA y el panel de conductores desde los
valores por defecto del código. Para cargar registros de ejemplo, entrá a
**Importar → “Cargar registros de ejemplo”** y luego **“☁️ Guardar en la nube”**.

## Despliegue (GitHub Pages)

1. Subí el repo a GitHub (ver más abajo).
2. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch: `main` / carpeta `/root`. Guardar.
4. La app queda en `https://<usuario>.github.io/Logistica-Hogareno/`.

Las rutas son **relativas**, así que funciona igual en la raíz del dominio,
en un subpath de Pages o en local.

## Agregar usuarios nuevos

Desde Supabase → **Authentication → Users → Add user** (email + contraseña).
El perfil se crea solo; para hacerlo `analista`, en el **SQL Editor**:

```sql
update public.perfiles set rol = 'analista'
where email = 'nuevo@logisticahogar.com';
```

## Notas de seguridad

- La *publishable key* de Supabase va en el cliente (es su diseño normal); la
  protección real la da **RLS + Auth**.
- No hay claves de servicio ni secretos en el repositorio.
