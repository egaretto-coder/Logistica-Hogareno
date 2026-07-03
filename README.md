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

```
index.html              → la aplicación completa (UI + lógica)
supabase-config.js      → cliente Supabase + capa de datos (DB.loadAll / DB.replaceAll)
manifest.webmanifest    → manifiesto PWA
sw.js                   → service worker (caché offline)
assets/icons/           → iconos PWA
data/registros_seed.json→ set inicial de registros (opcional, para sembrar)
supabase/schema.sql     → esquema de la base de datos (referencia)
```

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

Por el service worker y las llamadas a Supabase, servila por **http(s)** (no `file://`):

```bash
# con Python
python -m http.server 5173
# luego abrir http://localhost:5173
```

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
