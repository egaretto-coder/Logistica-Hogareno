// ════════════════════════════════════════════════════════════════════════
//  Service Worker — Liquidaciones (Logística Hogareño)
//  Cachea el "app shell" para uso offline. NUNCA cachea llamadas a la API de
//  Supabase (datos/auth), que siempre van a la red para no servir datos viejos.
// ════════════════════════════════════════════════════════════════════════

const CACHE = 'liq-cache-v8';

// Archivos locales (rutas relativas al scope del SW).
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
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
  './pantallas/reporte-zona.html',
  './pantallas/reporte-conductor.html',
  './pantallas/tarifas.html',
  './pantallas/super-sla.html',
  './pantallas/panel-conductores.html',
  './pantallas/dimensiones-especiales.html',
  './pantallas/descuento-conductores.html',
  // Iconos
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
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
    // Los CDN pueden fallar por CORS; no bloqueamos la instalación por eso.
    await Promise.allSettled(
      CDN_ASSETS.map((url) => cache.add(new Request(url, { mode: 'no-cors' })))
    );
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Rescatar pestañas abiertas: recargarlas para que tomen la versión nueva
    // (network-first). Así una actualización nunca queda "pegada" a la versión
    // vieja cacheada, sin que el usuario tenga que limpiar nada a mano.
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const c of windows) {
      try { await c.navigate(c.url); } catch (e) { /* algunos navegadores lo restringen */ }
    }
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
  // NETWORK-FIRST: siempre la última versión si hay conexión; el caché es sólo
  // respaldo offline. Así una actualización se ve al instante, sin quedar pegado
  // a una versión vieja cacheada.
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = await cache.match(req);
        if (cached) return cached;
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
