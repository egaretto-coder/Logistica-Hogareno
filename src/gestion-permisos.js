// ════════════════════════════════════════════════════════════════════════
//  GESTIÓN DE PERMISOS
//  Matriz de pantallas × roles con toggles: define qué pantallas ve cada rol
//  (tabla rol_permisos en Supabase, editable solo por analistas — UI + RLS).
//  Abajo, tarjetas por rol con los usuarios asignados (tabla perfiles).
// ════════════════════════════════════════════════════════════════════════

const GP_ROLES_INFO = {
  analista:       { label: 'Analistas',       emoji: '👑', color: '#059669', desc: 'Acceso total a toda la app + gestión de permisos.' },
  administrativo: { label: 'Administrativos', emoji: '👤', color: '#f59e0b', desc: 'Ven solo las pantallas habilitadas en la matriz de arriba.' },
};

// Íconos por pantalla (los mismos del sidebar)
const GP_ICONOS = {
  'dashboard': '📊', 'upload': '📂', 'liquidaciones': '💰', 'conductores': '🚗',
  'reporte-zona': '📍', 'reporte-conductor': '👤', 'panel-conductores': '🚗',
  'config-tarifas': '💲', 'config-supersla': '⭐', 'dimensiones-especiales': '📦',
  'descuento-conductores': '🎫',
};

function renderGestionPermisos() {
  renderGpMatriz();
  renderGpGrupos();
}

// ─── Matriz de permisos por pantalla ────────────────────────────────────
function renderGpMatriz() {
  const cont = document.getElementById('gp-matriz');
  if (!cont) return;
  const analista = esAnalista();
  const paginas = paginasConfigurables();
  const permAdm = paginasDeRol('administrativo');

  const filas = paginas.map(p => {
    const titulo = (PAGE_TITLES[p] && PAGE_TITLES[p][0]) || p;
    const admOn = permAdm.includes(p);
    return `
      <div style="display:grid;grid-template-columns:1fr 140px 140px;gap:0;padding:10px 18px;border-bottom:1px solid var(--border);align-items:center">
        <div style="font-size:13px;font-weight:500">${GP_ICONOS[p] || '📄'} ${titulo}</div>
        <div style="text-align:center">
          <label class="switch" title="El analista siempre ve todas las pantallas">
            <input type="checkbox" checked disabled>
            <span class="slider"></span>
          </label>
        </div>
        <div style="text-align:center">
          <label class="switch" title="${analista ? 'Prender/apagar esta pantalla para el rol administrativo' : 'Solo un analista puede modificar los permisos'}">
            <input type="checkbox" ${admOn ? 'checked' : ''} ${analista ? '' : 'disabled'}
              onchange="togglePermiso('administrativo','${p}',this.checked,this)">
            <span class="slider"></span>
          </label>
        </div>
      </div>`;
  }).join('');

  cont.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 140px 140px;gap:0;padding:10px 18px;background:var(--surface-0);border-bottom:1px solid var(--border);font-size:10.5px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">
      <span>Pantalla</span>
      <span style="text-align:center">👑 Analista</span>
      <span style="text-align:center">👤 Administrativo</span>
    </div>
    ${filas}
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
    showToast((permitido ? '✅ ' : '🚫 ') + titulo + ' → ' + (GP_ROLES_INFO[rol]?.label || rol) + (permitido ? ' puede verla' : ' ya no la ve'));
    if (estadoEl) {
      const h = new Date();
      estadoEl.textContent = '✓ Guardado ' + String(h.getHours()).padStart(2,'0') + ':' + String(h.getMinutes()).padStart(2,'0');
    }
  } catch (e) {
    console.warn('togglePermiso:', e);
    // revertir en memoria
    AppData.rolPermisos[rol][pagina] = !permitido;
    try { localStorage.setItem('liq_rol_permisos', JSON.stringify(AppData.rolPermisos)); } catch(err) {}
    showToast('⛔ No se pudo guardar el permiso (conexión o permisos)');
    if (estadoEl) estadoEl.textContent = '⚠️ Error al guardar';
  } finally {
    if (el) el.disabled = false;
    renderGpMatriz();
    // Aplicar al instante en esta sesión (por si el propio rol editado está a la vista)
    if (typeof aplicarPermisos === 'function') aplicarPermisos();
  }
}

// ─── Grupos por rol: usuarios asignados ─────────────────────────────────
async function renderGpGrupos() {
  const cont = document.getElementById('gp-grupos');
  if (!cont) return;
  cont.innerHTML = '<div class="muted" style="padding:12px;font-size:12px">Cargando usuarios…</div>';

  let perfiles = [];
  try {
    if (window.sb) {
      const { data, error } = await sb.from('perfiles').select('email,nombre,rol,icono').order('nombre');
      if (error) throw error;
      perfiles = data || [];
    }
  } catch (e) {
    console.warn('renderGpGrupos:', e);
    cont.innerHTML = '<div class="alert alert-info">⚠️ No se pudieron cargar los usuarios (sin conexión).</div>';
    return;
  }

  cont.innerHTML = Object.keys(GP_ROLES_INFO).map(rol => {
    const info = GP_ROLES_INFO[rol];
    const usuarios = perfiles.filter(u => u.rol === rol);
    const filas = usuarios.length ? usuarios.map(u => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border)">
        <div class="conductor-avatar" style="background:${avatarColor(u.nombre || u.email)};width:30px;height:30px;font-size:11px;flex-shrink:0">${u.icono || initials(u.nombre || u.email)}</div>
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.nombre || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.email || ''}</div>
        </div>
        <span class="tag" style="margin-left:auto;flex-shrink:0;background:${info.color}18;color:${info.color};border:1px solid ${info.color}40;text-transform:uppercase;font-size:9.5px;font-weight:700">${rol}</span>
      </div>`).join('')
      : '<div class="muted" style="padding:18px;text-align:center;font-size:12px">Nadie en esta sección.</div>';

    return `
      <div class="card" style="overflow:hidden;border-top:3px solid ${info.color}">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border)">
          <span style="font-size:14px;font-weight:700">${info.emoji} ${info.label}</span>
          <span style="font-size:15px;font-weight:700;color:${info.color}">${usuarios.length}</span>
        </div>
        <div style="padding:6px 14px 2px;font-size:11px;color:var(--text-muted)">${info.desc}</div>
        <div>${filas}</div>
        <div style="padding:8px 14px;font-size:10.5px;color:var(--text-muted);border-top:1px solid var(--border)">
          Los usuarios se dan de alta en Supabase → Authentication. El rol se asigna en la tabla <span class="mono">perfiles</span>.
        </div>
      </div>`;
  }).join('');
}
