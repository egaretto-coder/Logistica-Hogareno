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
// La recarga tras una actualización la fuerza el propio SW (evento activate),
// que recarga las pestañas abiertas. Acá sólo registramos y pedimos update.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => reg.update())
      .catch(err => console.warn('No se pudo registrar el Service Worker:', err));
  });
}
