// ════════════════════════════════════════════════════════════════════════
//  Service Worker — Liquidaciones (Logística Hogareño)
//  Cachea el "app shell" para uso offline. NUNCA cachea llamadas a la API de
//  Supabase (datos/auth), que siempre van a la red para no servir datos viejos.
// ════════════════════════════════════════════════════════════════════════

const CACHE = 'liq-cache-v1';

// Archivos locales (rutas relativas al scope del SW).
const APP_SHELL = [
  './',
  './index.html',
  './supabase-config.js',
  './manifest.webmanifest',
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
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // No interceptar métodos que no sean GET.
  if (req.method !== 'GET') return;

  // Nunca cachear llamadas a Supabase (REST/Auth/Realtime): siempre a la red.
  if (url.hostname.endsWith('supabase.co')) return;

  // Navegación: network-first, con index.html cacheado como respaldo offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Resto (estáticos + CDN): cache-first con actualización en segundo plano.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) {
      // Revalida en segundo plano sin bloquear la respuesta.
      fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
