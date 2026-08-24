// ════════════════════════════════════════════════════════════════════════
//  Service Worker — Liquidaciones (Logística Hogareño)
//  Cachea el "app shell" para uso offline. NUNCA cachea llamadas a la API de
//  Supabase (datos/auth), que siempre van a la red para no servir datos viejos.
// ════════════════════════════════════════════════════════════════════════

const CACHE = 'liq-cache-v105';

// Archivos locales (rutas relativas al scope del SW).
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './css/icons.css',
  './manifest.webmanifest',
  // Backend / núcleo
  './src/supabase.js',
  './src/core.js',
  './src/auth.js',
  './src/datos.js',
  // Pantallas (JS)
  './src/dashboard.js',
  './src/liquidaciones.js',
  './src/liquidaciones-pdf.js',
  './src/conductores.js',
  './src/reportes.js',
  './src/importar.js',
  './src/config-tarifas.js',
  './src/config-supersla.js',
  './src/panel-conductores.js',
  './src/dimensiones-especiales.js',
  './src/descuento-conductores.js',
  './src/descuentos-items.js',
  './src/adelantos.js',
  './src/clientes.js',
  './src/detalle-cliente.js',
  './src/comisiones.js',
  './src/empleados.js',
  './src/rendiciones.js',
  './src/gestion-permisos.js',
  './src/realtime.js',
  // Orquestación
  './app/main.js',
  // Componentes (HTML)
  './components/sidebar.html',
  './components/header.html',
  './components/modales.html',
  // Pantallas (HTML)
  './pantallas/login.html',
  './pantallas/dashboard.html',
  './pantallas/importar-datos.html',
  './pantallas/liquidaciones.html',
  './pantallas/conductores.html',
  './pantallas/tarifas.html',
  './pantallas/super-sla.html',
  './pantallas/panel-conductores.html',
  './pantallas/dimensiones-especiales.html',
  './pantallas/extraviados.html',
  './pantallas/beneficios.html',
  './pantallas/km-desvio.html',
  './pantallas/adelantos.html',
  './pantallas/clientes.html',
  './pantallas/detalle-cliente.html',
  './pantallas/comisiones.html',
  './pantallas/empleados.html',
  './pantallas/rendiciones.html',
  './pantallas/gestion-permisos.html',
  // Iconos
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  // Tipografía (Inter auto-hospedada)
  './assets/fonts/inter-var.woff2',
];

// Librerías externas (CDN) que la app necesita para funcionar offline.
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // CDNs (librerías versionadas, varios MB): si ya están en un caché anterior,
    // se copian en lugar de re-descargarse — instala en segundos, no en minutos.
    // Pueden fallar por CORS; no bloqueamos la instalación por eso.
    await Promise.allSettled(CDN_ASSETS.map(async (url) => {
      const previa = await caches.match(url);
      if (previa) { await cache.put(url, previa); return; }
      await cache.add(new Request(url, { mode: 'no-cors' }));
    }));
    // OJO: NO llamamos self.skipWaiting() acá. Queremos que la versión nueva
    // quede EN ESPERA hasta que el operador toque "Actualizar" (banner en la app).
    // Al tocarlo, la app manda el mensaje SKIP_WAITING (ver más abajo).
  })());
});

// La app pide activar la versión nueva cuando el operador toca "Actualizar".
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // La recarga la dispara la app (evento controllerchange) tras aceptar la
    // actualización, así no interrumpimos al operador a mitad de una edición.
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // No interceptar métodos que no sean GET.
  if (req.method !== 'GET') return;

  // Nunca cachear llamadas a Supabase (REST/Auth/Realtime): siempre a la red.
  if (url.hostname.endsWith('supabase.co')) return;

  const sameOrigin = url.origin === self.location.origin;

  // Código propio de la app (mismo origen: HTML, JS, CSS, parciales) →
  // CACHE-FIRST con revalidación en segundo plano (stale-while-revalidate).
  // El caché está versionado por CACHE (liq-cache-vNN): al desplegar una versión
  // nueva, el SW nuevo la descarga entera y el banner "Actualizar" la activa. Es
  // seguro y evita que abrir la app dependa de ~40 idas a la red (lo que hacía
  // el arranque lento con conexión mala).
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) {
        // Servimos ya desde el caché y actualizamos por detrás, sin bloquear.
        event.waitUntil((async () => {
          try {
            const fresca = await fetch(req);
            if (fresca && fresca.ok) await cache.put(req, fresca.clone());
          } catch (e) { /* sin conexión: se queda la copia cacheada */ }
        })());
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached2 = await cache.match(req);
        if (cached2) return cached2;
        if (req.mode === 'navigate') {
          return (await cache.match('./index.html')) || Response.error();
        }
        return Response.error();
      }
    })());
    return;
  }

  // Terceros (CDN de librerías, versionados y estables) → CACHE-FIRST.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
