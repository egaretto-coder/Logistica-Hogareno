// ════════════════════════════════════════════════════════════════════════
// ═════════════ SISTEMA DE AUTENTICACIÓN Y ROLES ═════════════════════
// ════════════════════════════════════════════════════════════════════════

// Permisos por rol: qué páginas puede ver cada uno.
// El ANALISTA siempre ve todo (esta lista define además el universo de
// pantallas configurables). Los demás roles usan estos valores como DEFAULT,
// pero si hay permisos guardados en la nube (panel "Gestión de permisos" →
// tabla rol_permisos), mandan los de la nube. Ver paginasDeRol().
const ROL_PERMISOS = {
  analista: {
    label: 'Analista — acceso total',
    color: '#059669',
    paginas: [
      'dashboard', 'upload', 'liquidaciones', 'conductores',
      'reporte-zona', 'reporte-conductor',
      'panel-conductores', 'config-tarifas', 'config-supersla',
      'dimensiones-especiales', 'descuento-conductores',
      'gestion-permisos'
    ]
  },
  administrativo: {
    label: 'Administrativo — acceso limitado',
    color: '#f59e0b',
    paginas: [
      'liquidaciones', 'upload', 'conductores',
      'panel-conductores', 'config-tarifas', 'config-supersla',
      'dimensiones-especiales', 'descuento-conductores'
    ]
  }
};

// Pantallas configurables desde "Gestión de permisos" (todas menos el propio panel,
// que es exclusivo del analista para no auto-bloquearse).
function paginasConfigurables() {
  return ROL_PERMISOS.analista.paginas.filter(p => p !== 'gestion-permisos');
}

// Páginas visibles para un rol, con los permisos dinámicos de la nube.
// Funciona también para roles creados desde el panel (sin default en el código).
function paginasDeRol(rol) {
  if (rol === 'analista') return ROL_PERMISOS.analista.paginas; // acceso total siempre
  const dyn = AppData.rolPermisos && AppData.rolPermisos[rol];
  if (dyn) return paginasConfigurables().filter(p => dyn[p] === true);
  const base = ROL_PERMISOS[rol];
  return base ? base.paginas : []; // rol nuevo sin permisos aún: nada visible
}

// Datos visuales de un rol (label/color/emoji): primero los de la nube
// (roles creados desde el panel), después los defaults del código.
function rolInfo(rol) {
  const dyn = (AppData.roles || []).find(r => r.rol === rol);
  if (dyn) {
    return {
      label: dyn.label + (rol === 'analista' ? ' — acceso total' : ''),
      color: dyn.color || '#6366f1',
      emoji: dyn.emoji || '👥'
    };
  }
  const base = ROL_PERMISOS[rol];
  if (base) return { label: base.label, color: base.color, emoji: '👥' };
  return { label: rol, color: '#6366f1', emoji: '👥' };
}

let currentUser = null;

// Normaliza lo que se escribe en el campo usuario a un email.
// Permite escribir solo "rodri" (→ rodri@logisticahogar.com) o el email completo.
function normalizarEmail(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return '';
  return v.includes('@') ? v : v + '@logisticahogar.com';
}

async function attemptLogin() {
  const email = normalizarEmail(document.getElementById('login-user').value);
  const password = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.querySelector('#login-overlay button[onclick*="attemptLogin"]');

  if (!email || !password) {
    errorEl.classList.add('visible');
    errorEl.textContent = 'Ingresá usuario y contraseña';
    return;
  }

  if (!sb) {
    errorEl.classList.add('visible');
    errorEl.textContent = 'Sin conexión con el servidor. Revisá tu internet e intentá de nuevo.';
    return;
  }

  const textoOriginal = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data?.user) {
      errorEl.classList.add('visible');
      errorEl.textContent = 'Usuario o contraseña incorrectos';
      document.getElementById('login-pass').value = '';
      return;
    }
    errorEl.classList.remove('visible');
    await entrarConUsuario(data.user);
  } catch (e) {
    errorEl.classList.add('visible');
    errorEl.textContent = 'Error al iniciar sesión: ' + (e.message || e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

// Carga el perfil (rol/nombre/icono) del usuario autenticado, hidrata los datos
// desde Supabase y muestra la app.
async function entrarConUsuario(user) {
  let perfil = null;
  try {
    const { data } = await sb.from('perfiles').select('*').eq('id', user.id).single();
    perfil = data;
  } catch (e) { console.warn('No se pudo leer el perfil:', e); }

  currentUser = {
    id: user.id,
    usuario: user.email,
    rol: perfil?.rol || 'administrativo',
    nombre: perfil?.nombre || (user.email || '').split('@')[0],
    icono: perfil?.icono || '👤'
  };

  await hydrateFromSupabase();
  showApp();
}

function showApp() {
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('app-layout').style.display = 'flex';

  // Actualizar badge de usuario
  const badge = document.getElementById('user-badge');
  const nameTxt = document.getElementById('user-name-txt');
  const roleTxt = document.getElementById('user-role-txt');
  const iconEl = document.getElementById('user-icon');
  const logoutBtn = document.getElementById('logout-btn');
  const perms = rolInfo(currentUser.rol);

  if (badge) badge.style.display = 'block';
  if (logoutBtn) logoutBtn.style.display = 'block';
  if (nameTxt) nameTxt.textContent = currentUser.nombre;
  if (iconEl) iconEl.textContent = currentUser.icono || '👤';
  if (roleTxt) {
    roleTxt.textContent = perms.label;
    roleTxt.style.color = perms.color;
  }

  aplicarPermisos();

  // Redirigir a la primera página permitida
  const primeraPagina = paginasDeRol(currentUser.rol)[0] || 'liquidaciones';
  showPage(primeraPagina);
}

function aplicarPermisos() {
  if (!currentUser) return;
  const permitidas = paginasDeRol(currentUser.rol);

  // Ocultar/mostrar items del sidebar
  document.querySelectorAll('.nav-item').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    const match = onclick.match(/showPage\(['"]([^'"]+)['"]\)/);
    if (match) {
      const page = match[1];
      btn.style.display = permitidas.includes(page) ? '' : 'none';
    }
  });

  // Ocultar/mostrar secciones del sidebar según si tienen items visibles
  document.querySelectorAll('.nav-section').forEach(sec => {
    let next = sec.nextElementSibling;
    let algunoVisible = false;
    while (next && next.classList.contains('nav-item')) {
      if (next.style.display !== 'none') { algunoVisible = true; break; }
      next = next.nextElementSibling;
    }
    sec.style.display = algunoVisible ? '' : 'none';
  });

  // Ocultar botón "Exportar PDFs" del topbar si no tiene acceso a liquidaciones
  const btnExport = document.querySelector('.topbar-actions button[onclick*="exportAllPDFs"]');
  if (btnExport) btnExport.style.display = permitidas.includes('liquidaciones') ? '' : 'none';
  const btnImport = document.querySelector('.topbar-actions button[onclick*="upload"]');
  if (btnImport) btnImport.style.display = permitidas.includes('upload') ? '' : 'none';
}

function puedeVer(pagina) {
  if (!currentUser) return false;
  return paginasDeRol(currentUser.rol).includes(pagina);
}

// ¿El usuario actual es analista? (permiso para editar tarifas sensibles, ej. km).
function esAnalista() {
  return !!currentUser && currentUser.rol === 'analista';
}

async function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  try { if (sb) await sb.auth.signOut(); } catch(e) {}
  currentUser = null;
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('app-layout').style.display = 'none';
}

// Restaurar sesión de Supabase si existe (token persistido en localStorage).
async function restoreSession() {
  if (!sb) return false;
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      await entrarConUsuario(data.session.user);
      return true;
    }
  } catch(e) { console.warn('restoreSession:', e); }
  return false;
}

// ════════════════════════════════════════════════════════════════════════

// ===== ESTADOS BD =====
