// ════════════════════════════════════════════════════════════════════════
//  Orquestación de la app: carga de pantallas/componentes (parciales),
//  router de páginas e inicialización.
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
//  MEDICIÓN DE PERFORMANCE (diagnóstico en producción)
//  Registra cuánto tarda cada navegación/hidratación. Para ver el resumen,
//  escribir  perf()  en la consola del navegador (F12).
// ════════════════════════════════════════════════════════════════════════
window.__perfDatos = [];
window.__perfLog = function (etiqueta, t0) {
  const ms = Math.round(((window.performance && performance.now()) || 0) - t0);
  window.__perfDatos.push({ etiqueta, ms, hora: new Date().toLocaleTimeString('es-AR') });
  if (window.__perfDatos.length > 200) window.__perfDatos.shift();
  if (ms >= 400) console.warn('[perf] ' + etiqueta + ': ' + ms + ' ms');
  return ms;
};
window.perf = function () {
  const porEtiqueta = {};
  window.__perfDatos.forEach(d => {
    const e = porEtiqueta[d.etiqueta] || (porEtiqueta[d.etiqueta] = { n: 0, total: 0, max: 0 });
    e.n++; e.total += d.ms; if (d.ms > e.max) e.max = d.ms;
  });
  const filas = Object.keys(porEtiqueta).map(k => ({
    accion: k, veces: porEtiqueta[k].n,
    promedio_ms: Math.round(porEtiqueta[k].total / porEtiqueta[k].n),
    peor_ms: porEtiqueta[k].max
  })).sort((a, b) => b.peor_ms - a.peor_ms);
  console.table(filas);
  return filas;
};

// ===== ROUTER =====
function showPage(id) {
  const _t0 = (window.performance && performance.now()) || 0;
  // Verificar permisos: si el usuario no puede ver esta página, redirigir a la primera permitida
  if (currentUser && !puedeVer(id)) {
    const primera = paginasDeRol(currentUser.rol)[0] || 'liquidaciones';
    if (id !== primera) {
      showToast('⛔ Sin acceso a esa sección');
      return showPage(primera);
    }
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('page-' + id);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.getAttribute('onclick')?.includes("'" + id + "'")) btn.classList.add('active');
  });
  const titles = PAGE_TITLES[id] || [id, ''];
  document.getElementById('topbar-title').textContent = titles[0];
  document.getElementById('topbar-sub').textContent = titles[1];

  // Render page
  if (id === 'dashboard') renderDashboard();
  if (id === 'liquidaciones') renderLiquidaciones();
  if (id === 'dimensiones-especiales') renderDimensionesEspeciales();
  if (id === 'descuento-conductores') switchDescTab('combustible');
  if (id === 'conductores') renderConductorSelect();
  if (id === 'extraviados' && typeof renderDescItems === 'function') renderDescItems('extraviados');
  if (id === 'beneficios' && typeof switchBeneficioTab === 'function') switchBeneficioTab('combustible');
  if (id === 'km-desvio' && typeof renderKmDesvio === 'function') renderKmDesvio();
  if (id === 'adelantos' && typeof renderAdelantos === 'function') renderAdelantos();
  if (id === 'config-tarifas') renderTarifas();
  if (id === 'config-supersla') renderSuperSLA();
  if (id === 'panel-conductores') renderPanelConductores();
  if (id === 'monotributos' && typeof renderMonotributosPagina === 'function') renderMonotributosPagina();
  if (id === 'clientes' && typeof switchClientesTab === 'function') switchClientesTab('activos');
  if (id === 'detalle-cliente' && typeof renderDetalleClientePagina === 'function') renderDetalleClientePagina();
  if (id === 'cliente-liquidaciones' && typeof renderClienteLiquidacionesPagina === 'function') renderClienteLiquidacionesPagina();
  if (id === 'comisiones' && typeof switchComisionesTab === 'function') switchComisionesTab('vend');
  if (id === 'empleados' && typeof switchEmpleadosTab === 'function') switchEmpleadosTab('plantel');
  if (id === 'vacaciones' && typeof renderVacacionesPagina === 'function') renderVacacionesPagina();
  if (id === 'rendiciones' && typeof renderRendiciones === 'function') renderRendiciones();
  if (id === 'gestion-permisos') renderGestionPermisos();
  if (id === 'upload') { renderArchivoPanel(); if (typeof renderHistorialImportaciones === 'function') renderHistorialImportaciones(); }
  window.__perfLog('pantalla: ' + id, _t0);
}

// Id de la página actualmente visible (deriva del <div class="page active">).
function paginaActivaId() {
  const el = document.querySelector('.page.active');
  return el ? el.id.replace(/^page-/, '') : null;
}

// Re-renderiza la pantalla activa (la usa la sincronización en tiempo real para
// reflejar cambios sin recargar). No hace nada si no hay página activa.
function rerenderPaginaActiva() {
  const id = paginaActivaId();
  if (id) showPage(id);
}

// ════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP: inyecta los parciales HTML y arranca la aplicación.
// ════════════════════════════════════════════════════════════════════════
const PANTALLAS = [
  'dashboard', 'importar-datos', 'liquidaciones', 'conductores',
  'tarifas', 'super-sla',
  'panel-conductores', 'monotributos', 'dimensiones-especiales',
  'extraviados', 'beneficios', 'km-desvio', 'adelantos',
  'clientes', 'detalle-cliente', 'cliente-liquidaciones', 'comisiones', 'empleados', 'vacaciones', 'rendiciones', 'gestion-permisos'
];

async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
  return r.text();
}

async function bootstrap() {
  try {
    const [login, sidebar, header, modales] = await Promise.all([
      fetchText('pantallas/login.html'),
      fetchText('components/sidebar.html'),
      fetchText('components/header.html'),
      fetchText('components/modales.html'),
    ]);
    const pages = await Promise.all(PANTALLAS.map(n => fetchText('pantallas/' + n + '.html')));

    document.getElementById('login-overlay').innerHTML = login;
    document.getElementById('app-layout').innerHTML =
      sidebar +
      '<div class="main">' + header +
        '<div class="content">' + pages.join('\n') + '</div>' +
      '</div>';
    document.getElementById('modales').innerHTML = modales;
  } catch (e) {
    console.error('Error cargando la interfaz:', e);
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="padding:20px;font-family:sans-serif;color:#b00">' +
      'No se pudo cargar la interfaz (' + e.message + '). ' +
      'Serví la app por http(s), no con file://.</div>');
    return;
  }

  // Interacciones que dependen del DOM ya inyectado
  initImportar();
  initSidebarMini();

  // 1) Caché local (arranque instantáneo / offline)
  loadSavedConfig();

  // 2) ¿Volvemos del mail de "olvidé mi contraseña"? Entonces no se restaura la
  //    sesión: primero tiene que elegir la contraseña nueva.
  detectarRecoveryEnURL().then(async (esRecovery) => {
    if (esRecovery) return;
    const ok = await restoreSession();
    if (!ok) setTimeout(() => document.getElementById('login-user')?.focus(), 100);
  });
}

document.addEventListener('DOMContentLoaded', bootstrap);

// ── Menú lateral contraído ────────────────────────────────────────────────
// Deja una banda de íconos de 62px y le devuelve 158px de ancho al contenido,
// que es lo que necesitan las tablas anchas. La preferencia se persiste igual
// que el tema. Se corre después de inyectar el sidebar (no antes de pintar,
// como el tema) porque en ese momento la pantalla está tapada por el login.
function initSidebarMini() {
  // Contraído no se lee ninguna etiqueta: el nombre pasa al tooltip ANTES de
  // apagar el texto, así el título sale del propio botón y no de una lista
  // paralela que habría que mantener sincronizada con el sidebar.
  document.querySelectorAll('.sidebar .nav-item').forEach(b => {
    if (!b.title) b.title = (b.textContent || '').trim();
  });
  let mini = false;
  try { mini = localStorage.getItem('liq_menu') === 'mini'; } catch (e) {}
  _aplicarSidebarMini(mini);
}

function _aplicarSidebarMini(mini) {
  document.body.classList.toggle('nav-mini', !!mini);
  const btn = document.getElementById('nav-toggle');
  if (btn) {
    const txt = mini ? 'Desplegar el menú' : 'Contraer el menú';
    btn.title = txt;
    btn.setAttribute('aria-label', txt);
  }
}

function toggleSidebar() {
  const mini = !document.body.classList.contains('nav-mini');
  _aplicarSidebarMini(mini);
  try { localStorage.setItem('liq_menu', mini ? 'mini' : 'full'); } catch (e) {}
}

// Alterna el tema claro/oscuro y lo persiste. El tema inicial se aplica antes de
// pintar (script inline en index.html) para evitar el flash.
function toggleTema() {
  const nuevo = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nuevo);
  try { localStorage.setItem('liq_tema', nuevo); } catch (e) {}
}

// 3) Service Worker (PWA) — sólo por http(s)
// Detecta cuando hay una versión nueva desplegada y le muestra al operador un
// banner "Actualizar". Al tocarlo, activa la versión nueva y recarga.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  let swRecargando = false;
  // Cuando el SW nuevo toma control (tras aceptar la actualización), recargamos
  // UNA sola vez para traer el código nuevo.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRecargando) return;
    swRecargando = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // ¿Ya había una versión esperando de una sesión anterior?
      if (reg.waiting && navigator.serviceWorker.controller) mostrarBannerActualizacion(reg.waiting);

      // Se descargó una versión nueva mientras la app está abierta.
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          // 'installed' + ya había un SW controlando = es una ACTUALIZACIÓN
          // (no la primera instalación).
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            mostrarBannerActualizacion(nuevo);
          }
        });
      });

      // Chequear si hay versión nueva: al volver a la pestaña y cada 5 minutos,
      // así el operador se entera aunque deje la app abierta horas.
      const chequear = () => { reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) chequear(); });
      setInterval(chequear, 5 * 60 * 1000);
    }).catch(err => console.warn('No se pudo registrar el Service Worker:', err));
  });
}

// Banner "tipo push": aparece abajo cuando hay una versión nueva lista para instalar.
let _swWorkerPendiente = null;
function mostrarBannerActualizacion(worker) {
  _swWorkerPendiente = worker;
  if (document.getElementById('update-banner')) return; // ya visible
  if (!document.getElementById('update-banner-style')) {
    const st = document.createElement('style');
    st.id = 'update-banner-style';
    st.textContent = '@keyframes updbanner-in{from{opacity:0;transform:translateX(-50%) translateY(14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(st);
  }
  const b = document.createElement('div');
  b.id = 'update-banner';
  b.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;background:#1a2744;color:#fff;padding:12px 14px 12px 18px;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.4);display:flex;align-items:center;gap:14px;font-size:14px;max-width:92vw;animation:updbanner-in .35s ease';
  b.innerHTML =
    '<span style="display:flex;align-items:center;gap:8px">🔄 <span>Hay una nueva versión de la app</span></span>' +
    '<button id="update-banner-btn" style="background:#e11d48;color:#fff;border:0;border-radius:9px;padding:8px 16px;font-weight:700;cursor:pointer;font-size:13px">Actualizar</button>' +
    '<button id="update-banner-close" title="Ahora no" style="background:transparent;color:#cbd5e1;border:0;cursor:pointer;font-size:18px;line-height:1;padding:0 4px">✕</button>';
  document.body.appendChild(b);
  document.getElementById('update-banner-btn').onclick = aplicarActualizacion;
  document.getElementById('update-banner-close').onclick = () => b.remove();
}

function aplicarActualizacion() {
  const btn = document.getElementById('update-banner-btn');
  if (btn) { btn.textContent = 'Actualizando…'; btn.disabled = true; btn.style.opacity = '0.8'; }
  if (_swWorkerPendiente) {
    // Pedimos al SW en espera que se active; el controllerchange dispara la recarga.
    _swWorkerPendiente.postMessage({ type: 'SKIP_WAITING' });
    // Respaldo por si el evento no llega (navegadores viejos): recargar igual.
    setTimeout(() => window.location.reload(), 3000);
  } else {
    window.location.reload();
  }
}
