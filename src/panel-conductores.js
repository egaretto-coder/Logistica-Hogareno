const CONDICION_INFO = {
  'Titular':     { dia: 'viernes', clase: 'cond-titular',  emoji: '🔵' },
  'Semi Titular':{ dia: 'lunes',   clase: 'cond-semitit',  emoji: '🟡' },
  'Suplente':    { dia: 'martes',  clase: 'cond-suplente', emoji: '🟣' },
};

const CATEGORIA_INFO = {
  's_colecta': { label: 'S/ Colecta',   clase: 'cat-scolecta' },
  'c_colecta': { label: 'C/ Colecta',   clase: 'cat-ccolecta' },
  'sla':       { label: 'SLA Cumplido', clase: 'cat-sla'      },
  'super_sla': { label: 'Super SLA',    clase: 'cat-supersla' },
};

let panelFiltroActivo = 'all';
let conductorEditIdx = -1;

// ── Aviso de conductores nuevos reconocidos ─────────────────────────────────
// Conductores que aparecen en los recorridos importados pero todavía NO están
// cargados en el panel (comparación por nombre normalizado). El operador los ve
// en un aviso arriba del panel y los agrega uno por uno.
let _nuevosReconocidos = [];
function conductoresNuevosReconocidos() {
  const vistos = new Set();
  const nuevos = [];
  AppData.records.forEach(r => {
    const nombre = String(r.cadete || '').trim();
    if (!nombre) return;
    const key = normNombre(nombre);
    if (!key || vistos.has(key)) return;
    vistos.add(key);
    // Ya está en el panel (por nombre O por alias) → no es "nuevo".
    if (panelConductorDe(nombre)) return;
    nuevos.push(nombre);
  });
  return nuevos.sort((a, b) => a.localeCompare(b));
}

function renderNuevosReconocidos() {
  const cont = document.getElementById('panel-nuevos-aviso');
  if (!cont) return;
  _nuevosReconocidos = conductoresNuevosReconocidos();
  if (!_nuevosReconocidos.length) { cont.innerHTML = ''; return; }
  const n = _nuevosReconocidos.length;
  const plural = n !== 1;
  const chips = _nuevosReconocidos.map((nombre, i) =>
    '<span style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #f0d98a;border-radius:8px;padding:4px 6px 4px 10px;font-size:12px">' +
      '<span style="display:inline-flex;align-items:center;gap:6px"><span class="conductor-avatar" style="background:' + avatarColor(nombre) + ';width:22px;height:22px;font-size:9px">' + initials(nombre) + '</span>' + nombre + '</span>' +
      '<button class="btn btn-sm" style="padding:2px 8px;font-size:11px" title="Vincular a un conductor que ya está en el panel con otro nombre" onclick="vincularReconocido(' + i + ')"><i class="ic ic-clip"></i> Vincular</button>' +
      '<button class="btn btn-sm" style="padding:2px 8px;font-size:11px" title="Cargar como conductor nuevo" onclick="agregarConductorReconocido(' + i + ')"><i class="ic ic-plus"></i> Agregar</button>' +
    '</span>').join('');
  cont.innerHTML =
    '<div class="alert" style="background:#fff8e1;border:1px solid #f5d97a;color:#7a5c00;margin-bottom:16px;padding:12px 16px">' +
      '<div style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:4px"><i class="ic ic-alert"></i> ' + n + ' conductor' + (plural ? 'es' : '') + ' reconocido' + (plural ? 's' : '') + ' en los recorridos ' + (plural ? 'no están' : 'no está') + ' en el panel</div>' +
      '<div style="font-size:12px;margin-bottom:10px;color:#8a6d00"><strong>Vincular</strong>: si ya está cargado con otro nombre (apodo, typo). <strong>Agregar</strong>: si es un conductor nuevo. Así se le aplica la condición (día de pago) y la categorización de precios.</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;max-height:180px;overflow-y:auto">' + chips + '</div>' +
    '</div>';
}

// Abre el modal de alta con el nombre ya cargado (el operador elige condición/categoría).
function agregarConductorReconocido(i) {
  const nombre = _nuevosReconocidos[i];
  if (!nombre) return;
  openAddConductorModal();
  document.getElementById('mc-nombre').value = String(nombre).toUpperCase();
}

// ── Vincular un nombre de recorrido a un conductor YA cargado en el panel ────
// Guarda el nombre del recorrido como "alias" del conductor elegido, así se le
// aplica su categoría/condición aunque en los recorridos figure con otro nombre.
let _vincPendiente = '';

function vincularReconocido(i) {
  const nombre = _nuevosReconocidos[i];
  if (!nombre) return;
  _vincPendiente = nombre;
  document.getElementById('vinc-cadete').textContent = nombre;
  const sel = document.getElementById('vinc-select');
  const opts = AppData.panelConductores
    .slice()
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
    .map(c => '<option value="' + c.id + '">' + c.nombre +
              ' — ' + (CATEGORIA_INFO[c.categoria]?.label || c.categoria || 'sin categoría') + '</option>')
    .join('');
  sel.innerHTML = '<option value="">Elegí un conductor…</option>' + opts;
  sel.value = '';
  document.getElementById('modal-vincular-backdrop').style.display = 'flex';
}

function confirmarVincular() {
  const id = document.getElementById('vinc-select').value;
  if (!id) { alert('Elegí a qué conductor del panel vincularlo.'); return; }
  const c = AppData.panelConductores.find(x => String(x.id) === String(id));
  if (!c) { alert('No se encontró el conductor.'); return; }
  const nombre = _vincPendiente;
  const aliasActuales = String(c.alias || '').split(';').map(a => a.trim()).filter(Boolean);
  const yaEsta = normNombre(c.nombre) === normNombre(nombre) ||
                 aliasActuales.some(a => normNombre(a) === normNombre(nombre));
  if (!yaEsta) aliasActuales.push(nombre);
  c.alias = aliasActuales.join(';');
  invalidarIndicePanel();   // cambió un alias → el índice nombre→panel quedó viejo
  localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
  dbPush('panel_conductores');
  document.getElementById('modal-vincular-backdrop').style.display = 'none';
  _vincPendiente = '';
  renderPanelConductores();
  showToast('🔗 "' + nombre + '" vinculado a ' + c.nombre);
}

function closeVincularModal(e) {
  if (!e || e.target.id === 'modal-vincular-backdrop') {
    document.getElementById('modal-vincular-backdrop').style.display = 'none';
  }
}

function setPanelFiltro(filtro) {
  panelFiltroActivo = filtro;
  // Actualizar botones de filtro
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.className = 'filter-tab';
    const txt = btn.textContent;
    if (filtro === 'all' && txt.includes('Todos')) btn.classList.add('active-all');
    if (filtro === 'Titular' && txt.includes('Titular') && !txt.includes('Semi')) btn.classList.add('active-titular');
    if (filtro === 'Semi Titular' && txt.includes('Semi')) btn.classList.add('active-semitit');
    if (filtro === 'Suplente' && txt.includes('Suplente')) btn.classList.add('active-suplente');
    if (filtro === 'sin_asignar' && txt.includes('Sin asignar')) btn.classList.add('active-sin-asignar');
  });
  renderPanelConductores();
}

// ¿Al conductor le falta condición o categorización?
function panelSinAsignar(c) {
  return !String(c && c.condicion || '').trim() || !String(c && c.categoria || '').trim();
}

function renderPanelConductores() {
  // Contador de "sin asignar" para el badge del filtro (siempre, sobre el total).
  const sinAsignarCount = AppData.panelConductores.filter(panelSinAsignar).length;
  const saBadge = document.getElementById('panel-sinasignar-count');
  if (saBadge) saBadge.textContent = sinAsignarCount ? (' · ' + sinAsignarCount) : '';

  // Filtro por condición (pestañas) + buscador por nombre o ID.
  let lista;
  if (panelFiltroActivo === 'all') lista = AppData.panelConductores;
  else if (panelFiltroActivo === 'sin_asignar') lista = AppData.panelConductores.filter(panelSinAsignar);
  else lista = AppData.panelConductores.filter(c => c.condicion === panelFiltroActivo);

  const q = (document.getElementById('panel-search')?.value || '').toLowerCase().trim();
  if (q) {
    lista = lista.filter(c =>
      String(c.nombre).toLowerCase().includes(q) ||
      String(c.id).toLowerCase().includes(q));
  }

  const countEl = document.getElementById('panel-count');
  if (countEl) countEl.textContent = lista.length + ' de ' + AppData.panelConductores.length + ' conductores';

  const body = document.getElementById('panel-conductores-rows');

  if (!lista.length) {
    body.innerHTML = `<div class="empty-state" style="padding:40px">
      <div class="empty-icon" style="font-size:36px;opacity:0.3">${q ? '🔍' : '🚗'}</div>
      <div class="empty-title">${q ? 'Sin resultados para “' + q + '”' : (panelFiltroActivo === 'all' ? 'Sin conductores' : panelFiltroActivo === 'sin_asignar' ? '✅ Todos los conductores tienen condición y categorización' : 'Sin conductores con condición "' + panelFiltroActivo + '"')}</div>
      <div class="empty-sub">${q ? 'Probá con otro nombre o ID' : 'Usá el botón "+ Agregar conductor" para cargar el primero'}</div>
    </div>`;
  } else {
    body.innerHTML = lista.map((c, i) => {
      const cinfo = (c.condicion && CONDICION_INFO[c.condicion]) ? CONDICION_INFO[c.condicion] : { dia: 'Sin asignar', clase: 'badge-gray', emoji: '⚪' };
      const catinfo = CATEGORIA_INFO[c.categoria] || { label: c.categoria || '—', clase: 'cat-sla' };
      return `
      <div class="conductor-panel-row" style="grid-template-columns:100px 2fr 1fr 1fr 90px">
        <div>
          <span style="font-family:monospace;font-size:12px;font-weight:600;color:var(--text-secondary);background:var(--surface-0);padding:3px 7px;border-radius:4px;border:1px solid var(--border)">${c.id || '—'}</span>
        </div>
        <div class="conductor-cell">
          <div class="conductor-avatar" style="background:${avatarColor(c.nombre)};width:28px;height:28px;font-size:10px">${initials(c.nombre)}</div>
          <span style="font-weight:500;font-size:13px">${c.nombre}</span>
        </div>
        <div>
          <span class="cond-badge ${cinfo.clase}">${cinfo.emoji} ${c.condicion || 'Sin asignar'}</span>
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${c.condicion ? 'Pago los ' + cinfo.dia : 'Condición no asignada'}</div>
        </div>
        <div>
          <span class="cat-badge ${catinfo.clase}">${catinfo.label}</span>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" title="Editar conductor" style="padding:4px 8px;font-size:11px" onclick='editarConductorPanel(${JSON.stringify(String(c.id))})'><i class="ic ic-edit"></i></button>
          <button class="btn btn-sm" title="Eliminar conductor" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5;background:#fef2f2" onclick='eliminarConductorPanel(${JSON.stringify(String(c.id))})'><i class="ic ic-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }

  // Resumen por condición
  const resumen = document.getElementById('panel-resumen');
  const condiciones = ['Titular', 'Semi Titular', 'Suplente'];
  resumen.innerHTML = condiciones.map(cond => {
    const grupo = AppData.panelConductores.filter(c => c.condicion === cond);
    const info = CONDICION_INFO[cond];
    return `
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <span class="cond-badge ${info.clase}">${info.emoji} ${cond}</span>
          <span style="font-size:20px;font-weight:600">${grupo.length}</span>
        </div>
        <div style="padding:10px 16px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Pago los ${info.dia} · ${grupo.length} conductor${grupo.length !== 1 ? 'es' : ''}</div>
          <button class="btn btn-sm" style="width:100%;justify-content:center;font-size:11px" onclick="exportPDFsporCondicion('${cond}')">
            <i class="ic ic-download"></i> Exportar PDFs de ${cond}s
          </button>
        </div>
      </div>`;
  }).join('');

  // Aviso de conductores reconocidos en los recorridos que faltan en el panel.
  renderNuevosReconocidos();
}

// El conductor que se está editando, por ID. Ver el comentario del bloque.
let conductorEditId = null;
function _conductorEditando() {
  if (conductorEditId == null) return null;
  return AppData.panelConductores.find(c => String(c.id) === String(conductorEditId)) || null;
}

// Primer ID libre. "cantidad + 1" chocaba apenas se borraba un conductor:
// con LH00001..LH00003, al borrar el 2 la próxima alta proponía LH00003, que ya
// existía, y el operador tenía que corregirlo a mano.
function _proximoIdPanel() {
  const usados = new Set((AppData.panelConductores || []).map(c => String(c.id || '').toUpperCase()));
  for (let n = 1; n <= usados.size + 1; n++) {
    const id = 'LH' + String(n).padStart(5, '0');
    if (!usados.has(id)) return id;
  }
  return 'LH' + String(usados.size + 1).padStart(5, '0');
}

function autoGenerarId() {
  // Solo genera ID automático cuando es un conductor nuevo (no edición)
  if (conductorEditId != null) return;
  document.getElementById('mc-id').value = _proximoIdPanel();
}

function openAddConductorModal() {
  conductorEditIdx = -1; conductorEditId = null;
  document.getElementById('modal-conductor-title').textContent = 'Agregar conductor';
  document.getElementById('mc-id').value = _proximoIdPanel();
  document.getElementById('mc-nombre').value = '';
  document.getElementById('mc-condicion').value = '';
  document.getElementById('mc-categoria').value = '';
  document.getElementById('mc-alias').value = '';
  document.getElementById('mc-info-condicion').textContent = '';
  document.getElementById('modal-conductor-backdrop').style.display = 'flex';
}

function editarConductorPanel(id) {
  const c = (AppData.panelConductores || []).find(x => String(x.id) === String(id));
  if (!c) { showToast('Ese conductor ya no está en el panel'); renderPanelConductores(); return; }
  conductorEditId = c.id;
  conductorEditIdx = AppData.panelConductores.indexOf(c);
  document.getElementById('modal-conductor-title').textContent = 'Editar conductor';
  document.getElementById('mc-id').value = c.id || '';
  document.getElementById('mc-nombre').value = c.nombre;
  document.getElementById('mc-condicion').value = c.condicion;
  document.getElementById('mc-categoria').value = c.categoria;
  document.getElementById('mc-alias').value = (c.alias || '').split(';').filter(Boolean).join('\n');
  updateMcInfoCondicion();
  document.getElementById('modal-conductor-backdrop').style.display = 'flex';
}

function updateMcInfoCondicion() {
  const cond = document.getElementById('mc-condicion').value;
  const info = CONDICION_INFO[cond];
  const el = document.getElementById('mc-info-condicion');
  if (info) {
    el.innerHTML = `${info.emoji} Los conductores con condición <strong>${cond}</strong> cobran sus liquidaciones los días <strong>${info.dia}</strong>.`;
  } else {
    el.textContent = '';
  }
}

// El modal (#mc-condicion) se inyecta en runtime desde bootstrap(), así que este
// script —que corre al parsear— todavía no lo ve. Delegamos el evento en document
// (que siempre existe) para no depender del orden de carga.
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'mc-condicion') updateMcInfoCondicion();
});

function guardarConductorModal() {
  try {
    const id = document.getElementById('mc-id').value.trim().toUpperCase();
    const nombre = document.getElementById('mc-nombre').value.trim().toUpperCase();
    const condicion = document.getElementById('mc-condicion').value;
    const categoria = document.getElementById('mc-categoria').value;
    // Alias: nombres tal como figuran en los recorridos (uno por línea o ";").
    const alias = (document.getElementById('mc-alias')?.value || '')
      .split(/[;\n]/).map(a => a.trim()).filter(Boolean).join(';');

    if (!id) { alert('El ID es requerido (ej: LH00001).'); return; }
    if (!nombre) { alert('Ingresá el nombre del conductor.'); return; }
    if (!categoria) { alert('Seleccioná una categorización.'); return; }

    const editando = _conductorEditando();
    const esEdicion = !!editando;
    if (conductorEditId != null && !editando) {
      alert('Ese conductor ya no está en el panel (lo pudo haber borrado otro usuario). Volvé a abrirlo.');
      conductorEditId = null; conductorEditIdx = -1;
      document.getElementById('modal-conductor-backdrop').style.display = 'none';
      renderPanelConductores();
      return;
    }

    // ID y nombre únicos, TAMBIÉN al editar (antes solo se validaba en el alta).
    // Dos conductores con el mismo nombre son uno solo para el índice canónico:
    // el segundo deja de liquidarse y nadie se entera. Se compara contra los
    // demás, excluyendo al que se está editando.
    const otros = (AppData.panelConductores || []).filter(c => c !== editando);
    if (otros.some(c => String(c.id).toUpperCase() === id)) {
      alert('El ID "' + id + '" ya está en uso por otro conductor.'); return;
    }
    if (otros.some(c => normNombre(c.nombre) === normNombre(nombre))) {
      alert('Ya existe un conductor llamado "' + nombre + '". ' +
        (esEdicion ? 'Dos conductores con el mismo nombre se liquidan como uno solo: usá los alias.'
                   : 'Editá ese en vez de duplicarlo.'));
      return;
    }

    const entrada = { id, nombre, condicion, categoria, alias };

    if (esEdicion) {
      // Se muta la fila que se estaba editando —no se pisa una posición— para
      // que un re-render intermedio no le cambie los datos a otro conductor.
      Object.assign(editando, entrada);
    } else {
      AppData.panelConductores.push(entrada);
    }
    invalidarIndicePanel();   // cambió nombre/alias/set → reconstruir el índice

    // Guardar automáticamente en localStorage + nube
    try {
      localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
    } catch(lsErr) {
      console.warn('No se pudo guardar en localStorage:', lsErr);
    }
    dbPush('panel_conductores');

    const msg = esEdicion ? '✅ Conductor actualizado y guardado' : '✅ Conductor agregado y guardado';
    conductorEditIdx = -1; conductorEditId = null;
    document.getElementById('modal-conductor-backdrop').style.display = 'none';
    renderPanelConductores();
    showToast(msg);

  } catch(err) {
    console.error('Error en guardarConductorModal:', err);
    alert('Ocurrió un error al guardar: ' + err.message);
  }
}

function eliminarConductorPanel(id) {
  const c = (AppData.panelConductores || []).find(x => String(x.id) === String(id));
  if (!c) { showToast('Ese conductor ya no está en el panel'); renderPanelConductores(); return; }
  const nombre = c.nombre;
  if (!confirm(`¿Eliminar a ${nombre} del panel de conductores?\n\nSe borra su condición (día de pago) y categorización. Sus recorridos y liquidaciones NO se tocan; si vuelve a aparecer en los recorridos, podés recargarlo desde el aviso de "conductores reconocidos".`)) return;
  AppData.panelConductores.splice(AppData.panelConductores.indexOf(c), 1);
  invalidarIndicePanel();   // se eliminó un conductor → reconstruir el índice
  localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
  dbPush('panel_conductores');
  renderPanelConductores();
  showToast('🗑️ Conductor eliminado y guardado');
}

function closeConductorModal(e) {
  if (!e || e.target.id === 'modal-conductor-backdrop') {
    document.getElementById('modal-conductor-backdrop').style.display = 'none';
    conductorEditIdx = -1; conductorEditId = null;
  }
}

function savePanelConductores() {
  // Limpia duplicados (por nombre / ID repetido) antes de guardar.
  AppData.panelConductores = dedupePanelConductores(AppData.panelConductores);
  invalidarIndicePanel();
  localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
  dbPush('panel_conductores');
  renderPanelConductores();
  showToast('Panel de conductores guardado');
}

function exportPDFsporCondicion(condicion) {
  // Respeta el período filtrado en el panel Liquidaciones y aplica los
  // descuentos cargados en el panel (exportPDF los toma por defecto).
  const liq = calcLiquidacionesFiltradas();
  const rangoFechas = getLiqRangoFechasLabel();
  const grupo = AppData.panelConductores.filter(c => c.condicion === condicion);
  if (!grupo.length) { alert(`No hay conductores con condición "${condicion}" en el panel.`); return; }

  const info = CONDICION_INFO[condicion];
  let exportados = 0;

  grupo.forEach(c => {
    // Buscar el cadete en las liquidaciones (comparación flexible)
    const key = Object.keys(liq).find(k => k.toUpperCase() === c.nombre.toUpperCase());
    if (key && liq[key].filas.length > 0) {
      exportPDF(key, { rangoFechas, liqData: liq });
      exportados++;
    }
  });

  if (exportados === 0) {
    alert(`No hay liquidaciones generadas para conductores ${condicion}s. Importá una base de datos primero.`);
  } else {
    showToast(`${exportados} PDF${exportados > 1 ? 's' : ''} exportado${exportados > 1 ? 's' : ''} — ${condicion}s (pago ${info.dia})`);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// ═════════════ MODAL "GENERAR LIQUIDACIÓN" CON DESCUENTOS ══════════════════
// ═══════════════════════════════════════════════════════════════════════════

