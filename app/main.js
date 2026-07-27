// ════════════════════════════════════════════════════════════════════════
//  Orquestación de la app: carga de pantallas/componentes (parciales),
//  router de páginas e inicialización.
// ════════════════════════════════════════════════════════════════════════

// ===== ROUTER =====
function showPage(id) {
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
  if (id === 'reporte-zona') renderZonaReport();
  if (id === 'reporte-conductor') renderConductorReport();
  if (id === 'config-tarifas') renderTarifas();
  if (id === 'config-supersla') renderSuperSLA();
  if (id === 'panel-conductores') renderPanelConductores();
  if (id === 'gestion-permisos') renderGestionPermisos();
  if (id === 'upload') renderArchivoPanel();
}

// ════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP: inyecta los parciales HTML y arranca la aplicación.
// ════════════════════════════════════════════════════════════════════════
const PANTALLAS = [
  'dashboard', 'importar-datos', 'liquidaciones', 'conductores',
  'reporte-zona', 'reporte-conductor', 'tarifas', 'super-sla',
  'panel-conductores', 'dimensiones-especiales', 'descuento-conductores',
  'gestion-permisos'
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

  // 1) Caché local (arranque instantáneo / offline)
  loadSavedConfig();

  // 2) Restaurar sesión de Supabase (hidrata datos frescos en entrarConUsuario)
  restoreSession().then(ok => {
    if (!ok) setTimeout(() => document.getElementById('login-user')?.focus(), 100);
  });
}

document.addEventListener('DOMContentLoaded', bootstrap);

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
