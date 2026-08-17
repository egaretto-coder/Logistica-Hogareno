// ════════════════════════════════════════════════════════════════════════
//  GESTIÓN DE PERMISOS Y ROLES
//  - Matriz de pantallas × roles con toggles (tabla rol_permisos)
//  - Crear / eliminar roles desde el panel (tabla roles)
//  - Asignar el rol de cada usuario (tabla perfiles)
//  Todo editable SOLO por analistas (UI + RLS en Supabase).
// ════════════════════════════════════════════════════════════════════════

// Defaults si la nube todavía no cargó (mismos datos que el seed de la tabla roles)
const GP_ROLES_DEFAULT = [
  { rol: 'analista',       label: 'Analistas',       emoji: '👑', color: '#059669', es_sistema: true },
  { rol: 'administrativo', label: 'Administrativos', emoji: '👤', color: '#f59e0b', es_sistema: true },
];

function gpRoles() {
  return (AppData.roles && AppData.roles.length) ? AppData.roles : GP_ROLES_DEFAULT;
}

function gpDescRol(rol) {
  if (rol === 'analista') return 'Acceso total a toda la app + gestión de permisos y roles.';
  return 'Ve solo las pantallas habilitadas en la matriz de arriba.';
}

// Íconos por pantalla (los mismos del sidebar)
const GP_ICONOS = {
  'dashboard': '📊', 'upload': '📂', 'liquidaciones': '💰', 'conductores': '🚗',
  'reporte-zona': '📍', 'reporte-conductor': '👤', 'panel-conductores': '🚗',
  'config-tarifas': '💲', 'config-supersla': '⭐', 'dimensiones-especiales': '📦',
  'descuento-conductores': '🎫',
};

let gpPerfilesCache = []; // último listado de perfiles cargado (para los selects)
let gpBloqueosCache = {}; // email → { intentos, bloqueado_hasta } (control de accesos)

function renderGestionPermisos() {
  renderGpCrearRol();
  renderGpMatriz();
  renderGpGrupos();
}

// ─── Crear rol ──────────────────────────────────────────────────────────
function renderGpCrearRol() {
  const cont = document.getElementById('gp-crear-rol');
  if (!cont) return;
  if (!esAnalista()) { cont.innerHTML = ''; return; }
  cont.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-body" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span style="font-size:13px;font-weight:600">➕ Crear rol nuevo</span>
        <input type="text" id="gp-nuevo-rol-nombre" placeholder="Ej: Coordinador" maxlength="30"
          style="width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px">
        <input type="text" id="gp-nuevo-rol-emoji" placeholder="📋" maxlength="4" title="Emoji del rol (opcional)"
          style="width:56px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;text-align:center">
        <input type="color" id="gp-nuevo-rol-color" value="#6366f1" title="Color del rol"
          style="width:42px;height:36px;padding:2px;border:1px solid var(--border);border-radius:8px;cursor:pointer">
        <button class="btn btn-sm btn-primary" onclick="crearRolNuevo()">Crear rol</button>
        <span style="font-size:11px;color:var(--text-muted)">Arranca sin pantallas: prendé las que corresponda en la matriz y asignale usuarios abajo.</span>
      </div>
    </div>`;
}

async function crearRolNuevo() {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede crear roles'); return; }
  const nombre = (document.getElementById('gp-nuevo-rol-nombre')?.value || '').trim();
  if (!nombre) { showToast('Escribí el nombre del rol'); return; }
  const slug = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // sin acentos
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) { showToast('Nombre de rol inválido'); return; }
  if (gpRoles().some(r => r.rol === slug)) { showToast('Ya existe un rol "' + nombre + '"'); return; }

  const emoji = (document.getElementById('gp-nuevo-rol-emoji')?.value || '').trim() || '👥';
  const color = document.getElementById('gp-nuevo-rol-color')?.value || '#6366f1';
  const nuevo = { rol: slug, label: nombre, emoji, color, es_sistema: false };

  try {
    await DB.insertRow('roles', nuevo);
    // Permisos iniciales: todo apagado, salvo Liquidaciones (pantalla de aterrizaje)
    if (!AppData.rolPermisos) AppData.rolPermisos = {};
    AppData.rolPermisos[slug] = {};
    for (const p of paginasConfigurables()) {
      const permitido = p === 'liquidaciones';
      AppData.rolPermisos[slug][p] = permitido;
      await DB.upsertRow('rol_permisos', { rol: slug, pagina: p, permitido });
    }
    AppData.roles = gpRoles().concat([nuevo]);
    try {
      localStorage.setItem('liq_roles', JSON.stringify(AppData.roles));
      localStorage.setItem('liq_rol_permisos', JSON.stringify(AppData.rolPermisos));
    } catch(e) {}
    renderGestionPermisos();
    showToast('✅ Rol "' + nombre + '" creado — configurale las pantallas en la matriz');
  } catch (e) {
    console.warn('crearRolNuevo:', e);
    showToast('⛔ No se pudo crear el rol (¿ya existe o sin permiso?)');
  }
}

async function eliminarRol(rol) {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede eliminar roles'); return; }
  const info = gpRoles().find(r => r.rol === rol);
  if (!info || info.es_sistema) { showToast('Los roles de sistema no se pueden eliminar'); return; }
  const usuarios = gpPerfilesCache.filter(u => u.rol === rol);
  if (usuarios.length) { showToast('⛔ Reasigná primero a los ' + usuarios.length + ' usuarios de este rol'); return; }
  if (!confirm('¿Eliminar el rol "' + info.label + '"? Sus permisos de pantalla también se borran.')) return;

  try {
    await DB.deleteWhere('rol_permisos', 'rol', rol);
    await DB.deleteWhere('roles', 'rol', rol);
    AppData.roles = gpRoles().filter(r => r.rol !== rol);
    if (AppData.rolPermisos) delete AppData.rolPermisos[rol];
    try {
      localStorage.setItem('liq_roles', JSON.stringify(AppData.roles));
      localStorage.setItem('liq_rol_permisos', JSON.stringify(AppData.rolPermisos));
    } catch(e) {}
    renderGestionPermisos();
    showToast('🗑 Rol "' + info.label + '" eliminado');
  } catch (e) {
    console.warn('eliminarRol:', e);
    showToast('⛔ No se pudo eliminar el rol');
  }
}

// ─── Matriz de permisos por pantalla ────────────────────────────────────
function renderGpMatriz() {
  const cont = document.getElementById('gp-matriz');
  if (!cont) return;
  const analista = esAnalista();
  const paginas = paginasConfigurables();
  const roles = gpRoles();
  const cols = '1fr ' + roles.map(() => '130px').join(' ');

  const header = `
    <div style="display:grid;grid-template-columns:${cols};gap:0;padding:10px 18px;background:var(--surface-0);border-bottom:1px solid var(--border);font-size:10.5px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">
      <span>Pantalla</span>
      ${roles.map(r => `<span style="text-align:center;color:${r.color}">${r.emoji} ${r.label}</span>`).join('')}
    </div>`;

  const filas = paginas.map(p => {
    const titulo = (PAGE_TITLES[p] && PAGE_TITLES[p][0]) || p;
    const celdas = roles.map(r => {
      if (r.rol === 'analista') {
        return `<div style="text-align:center">
          <label class="switch" title="El analista siempre ve todas las pantallas">
            <input type="checkbox" checked disabled><span class="slider"></span>
          </label></div>`;
      }
      const on = paginasDeRol(r.rol).includes(p);
      return `<div style="text-align:center">
        <label class="switch" title="${analista ? 'Prender/apagar esta pantalla para ' + r.label : 'Solo un analista puede modificar los permisos'}">
          <input type="checkbox" ${on ? 'checked' : ''} ${analista ? '' : 'disabled'}
            onchange="togglePermiso('${r.rol}','${p}',this.checked,this)">
          <span class="slider"></span>
        </label></div>`;
    }).join('');
    return `
      <div style="display:grid;grid-template-columns:${cols};gap:0;padding:10px 18px;border-bottom:1px solid var(--border);align-items:center">
        <div style="font-size:13px;font-weight:500">${GP_ICONOS[p] || '📄'} ${titulo}</div>
        ${celdas}
      </div>`;
  }).join('');

  cont.innerHTML = header + filas + `
    <div style="padding:10px 18px;font-size:11px;color:var(--text-muted)">
      🔒 La pantalla <strong>Gestión de permisos</strong> es exclusiva de los analistas y no aparece en la matriz.
    </div>`;
}

// Prende/apaga una pantalla para un rol: memoria + nube + aplicar al instante.
async function togglePermiso(rol, pagina, permitido, el) {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede modificar los permisos'); renderGpMatriz(); return; }

  // Estado en memoria (si no había mapa dinámico, arrancar desde los defaults)
  if (!AppData.rolPermisos) AppData.rolPermisos = {};
  if (!AppData.rolPermisos[rol]) {
    AppData.rolPermisos[rol] = {};
    paginasConfigurables().forEach(p => {
      AppData.rolPermisos[rol][p] = (ROL_PERMISOS[rol] ? ROL_PERMISOS[rol].paginas.includes(p) : false);
    });
  }
  AppData.rolPermisos[rol][pagina] = !!permitido;
  try { localStorage.setItem('liq_rol_permisos', JSON.stringify(AppData.rolPermisos)); } catch(e) {}

  const estadoEl = document.getElementById('gp-estado');
  if (estadoEl) estadoEl.textContent = '☁️ Guardando…';
  if (el) el.disabled = true;

  try {
    await DB.upsertRow('rol_permisos', { rol, pagina, permitido: !!permitido });
    const titulo = (PAGE_TITLES[pagina] && PAGE_TITLES[pagina][0]) || pagina;
    const rInfo = gpRoles().find(r => r.rol === rol);
    showToast((permitido ? '✅ ' : '🚫 ') + titulo + ' → ' + (rInfo ? rInfo.label : rol) + (permitido ? ' puede verla' : ' ya no la ve'));
    if (estadoEl) {
      const h = new Date();
      estadoEl.textContent = '✓ Guardado ' + String(h.getHours()).padStart(2,'0') + ':' + String(h.getMinutes()).padStart(2,'0');
    }
  } catch (e) {
    console.warn('togglePermiso:', e);
    AppData.rolPermisos[rol][pagina] = !permitido; // revertir
    try { localStorage.setItem('liq_rol_permisos', JSON.stringify(AppData.rolPermisos)); } catch(err) {}
    showToast('⛔ No se pudo guardar el permiso (conexión o permisos)');
    if (estadoEl) estadoEl.textContent = '⚠️ Error al guardar';
  } finally {
    if (el) el.disabled = false;
    renderGpMatriz();
    if (typeof aplicarPermisos === 'function') aplicarPermisos();
  }
}

// ─── Grupos por rol: usuarios asignados (con cambio de rol) ─────────────
async function renderGpGrupos() {
  const cont = document.getElementById('gp-grupos');
  if (!cont) return;
  cont.innerHTML = '<div class="muted" style="padding:12px;font-size:12px">Cargando usuarios…</div>';

  try {
    if (!window.sb) throw new Error('offline');
    const { data, error } = await sb.from('perfiles').select('id,email,nombre,rol,icono,activo').order('nombre');
    if (error) throw error;
    gpPerfilesCache = data || [];
    // Estado de bloqueo por intentos fallidos (solo lo ve un analista).
    gpBloqueosCache = {};
    if (esAnalista()) {
      try {
        const { data: bl } = await sb.from('acceso_control').select('email,intentos,bloqueado_hasta');
        (bl || []).forEach(b => { gpBloqueosCache[String(b.email).toLowerCase()] = b; });
      } catch (e) { /* sin permiso o sin conexión: seguimos sin el dato */ }
    }
  } catch (e) {
    console.warn('renderGpGrupos:', e);
    cont.innerHTML = '<div class="alert alert-info"><i class="ic ic-alert"></i> No se pudieron cargar los usuarios (sin conexión).</div>';
    return;
  }

  const analista = esAnalista();
  const roles = gpRoles();
  const totalAnalistas = gpPerfilesCache.filter(u => u.rol === 'analista').length;

  cont.innerHTML = roles.map(info => {
    const usuarios = gpPerfilesCache.filter(u => u.rol === info.rol);
    const filas = usuarios.length ? usuarios.map(u => {
      // Guard: el último analista no puede degradarse (nadie quedaría a cargo)
      const esUltimoAnalista = info.rol === 'analista' && totalAnalistas === 1;
      const selector = analista ? `
        <select onchange="cambiarRolUsuario('${u.id}', this.value, this)" ${esUltimoAnalista ? 'disabled title="Es el único analista: asigná otro antes de cambiarlo"' : ''}
          style="margin-left:auto;flex-shrink:0;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--surface-1)">
          ${roles.map(r => `<option value="${r.rol}" ${r.rol === u.rol ? 'selected' : ''}>${r.emoji} ${r.label}</option>`).join('')}
        </select>`
        : `<span class="tag" style="margin-left:auto;flex-shrink:0;background:${info.color}18;color:${info.color};border:1px solid ${info.color}40;text-transform:uppercase;font-size:9.5px;font-weight:700">${info.rol}</span>`;
      // Estado de acceso: deshabilitado y/o bloqueado por intentos fallidos.
      const deshabilitado = u.activo === false;
      const bl = gpBloqueosCache[String(u.email || '').toLowerCase()];
      const bloqueado = !!(bl && bl.bloqueado_hasta && new Date(bl.bloqueado_hasta) > new Date());
      const minRest = bloqueado ? Math.max(1, Math.ceil((new Date(bl.bloqueado_hasta) - new Date()) / 60000)) : 0;
      const chips =
        (deshabilitado ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;font-size:9px">Deshabilitado</span>' : '') +
        (bloqueado ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-size:9px" title="Por intentos fallidos">🔒 Bloqueado ' + minRest + ' min</span>' : '');
      const accesoBtns = analista ? (
        (bloqueado ? '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" title="Destrabar ahora" onclick="desbloquearUsuario(\'' + String(u.email).replace(/'/g, "\\'") + '\')">Destrabar</button>' : '') +
        (deshabilitado
          ? '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px;border-color:#86efac;color:#166534" onclick="setUsuarioActivo(\'' + u.id + '\',true)">Habilitar</button>'
          : '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px;border-color:#fca5a5;color:#b91c1c" onclick="setUsuarioActivo(\'' + u.id + '\',false)" title="Le corta el acceso a la app y a los datos">Deshabilitar</button>')
      ) : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border)${deshabilitado ? ';opacity:.6' : ''}">
          <div class="conductor-avatar" style="background:${avatarColor(u.nombre || u.email)};width:30px;height:30px;font-size:11px;flex-shrink:0">${u.icono || initials(u.nombre || u.email)}</div>
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.nombre || '—'}</div>
            <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.email || ''}</div>
            ${chips ? '<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap">' + chips + '</div>' : ''}
          </div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">${accesoBtns}${selector}</div>
        </div>`;
    }).join('')
      : '<div class="muted" style="padding:18px;text-align:center;font-size:12px">Nadie en esta sección.</div>';

    const btnEliminar = (analista && !info.es_sistema && !usuarios.length)
      ? `<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c;font-size:10.5px;padding:3px 8px" onclick="eliminarRol('${info.rol}')"><i class="ic ic-trash"></i> Eliminar rol</button>`
      : '';

    return `
      <div class="card" style="overflow:hidden;border-top:3px solid ${info.color}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <span style="font-size:14px;font-weight:700">${info.emoji} ${info.label}</span>
          <div style="display:flex;align-items:center;gap:8px">
            ${btnEliminar}
            <span style="font-size:15px;font-weight:700;color:${info.color}">${usuarios.length}</span>
          </div>
        </div>
        <div style="padding:6px 14px 2px;font-size:11px;color:var(--text-muted)">${gpDescRol(info.rol)}</div>
        <div>${filas}</div>
        <div style="padding:8px 14px;font-size:10.5px;color:var(--text-muted);border-top:1px solid var(--border)">
          ${analista ? 'Cambiá el rol de un usuario con el desplegable — se aplica en su próximo ingreso.' : 'Solo un analista puede reasignar roles.'}
        </div>
      </div>`;
  }).join('');
}

// Reasigna el rol de un usuario (tabla perfiles). Solo analista (UI + RLS).
// ─── Control de acceso: habilitar/deshabilitar y destrabar bloqueos ─────
// Deshabilitar corta el acceso de inmediato: la app no lo deja entrar y la base
// le niega los datos (policies con es_usuario_activo). El usuario y su historial
// se conservan; se puede volver a habilitar cuando haga falta.
async function setUsuarioActivo(userId, activo) {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede cambiar el acceso'); return; }
  const u = gpPerfilesCache.find(x => String(x.id) === String(userId));
  const quien = u ? (u.nombre || u.email) : 'este usuario';
  if (!activo && !confirm('¿Deshabilitar el acceso de ' + quien + '?\n\nNo va a poder entrar ni ver datos hasta que lo habilites de nuevo. No se borra nada.')) return;
  if (currentUser && String(currentUser.id) === String(userId) && !activo) {
    alert('No podés deshabilitar tu propio usuario.');
    return;
  }
  try {
    const { error } = await sb.from('perfiles').update({ activo: !!activo }).eq('id', userId);
    if (error) throw error;
    if (u) u.activo = !!activo;
    renderGpGrupos();
    showToast(activo ? '✅ Acceso habilitado' : '🚫 Acceso deshabilitado');
  } catch (e) { console.warn('setUsuarioActivo:', e); alert('No se pudo cambiar el acceso: ' + (e.message || e)); }
}

async function desbloquearUsuario(email) {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede desbloquear'); return; }
  try {
    const { error } = await sb.rpc('desbloquear_acceso', { p_email: email });
    if (error) throw error;
    delete gpBloqueosCache[String(email).toLowerCase()];
    renderGpGrupos();
    showToast('🔓 Acceso destrabado — ya puede volver a intentar');
  } catch (e) { console.warn('desbloquearUsuario:', e); alert('No se pudo destrabar: ' + (e.message || e)); }
}

async function cambiarRolUsuario(userId, nuevoRol, el) {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede reasignar roles'); renderGpGrupos(); return; }
  const u = gpPerfilesCache.find(x => x.id === userId);
  if (!u || u.rol === nuevoRol) return;

  // Guard extra: no dejar el sistema sin analistas
  const analistas = gpPerfilesCache.filter(x => x.rol === 'analista');
  if (u.rol === 'analista' && analistas.length === 1) {
    showToast('⛔ Es el único analista — asigná otro analista antes de cambiarlo');
    renderGpGrupos();
    return;
  }

  const rInfo = gpRoles().find(r => r.rol === nuevoRol);
  if (el) el.disabled = true;
  try {
    await DB.updateWhere('perfiles', 'id', userId, { rol: nuevoRol });
    showToast('✅ ' + (u.nombre || u.email) + ' → ' + (rInfo ? rInfo.emoji + ' ' + rInfo.label : nuevoRol));
  } catch (e) {
    console.warn('cambiarRolUsuario:', e);
    showToast('⛔ No se pudo cambiar el rol');
  } finally {
    renderGpGrupos();
  }
}
