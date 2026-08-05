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
  const enPanel = new Set(AppData.panelConductores.map(c => String(c.nombre || '').toUpperCase().trim()));
  const vistos = new Set();
  const nuevos = [];
  AppData.records.forEach(r => {
    const nombre = String(r.cadete || '').trim();
    if (!nombre) return;
    const key = nombre.toUpperCase();
    if (enPanel.has(key) || vistos.has(key)) return;
    vistos.add(key);
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
    '<span style="display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #f0d98a;border-radius:8px;padding:4px 6px 4px 10px;font-size:12px">' +
      '<span style="display:inline-flex;align-items:center;gap:6px"><span class="conductor-avatar" style="background:' + avatarColor(nombre) + ';width:22px;height:22px;font-size:9px">' + initials(nombre) + '</span>' + nombre + '</span>' +
      '<button class="btn btn-sm" style="padding:2px 8px;font-size:11px" onclick="agregarConductorReconocido(' + i + ')"><i class="ic ic-plus"></i> Agregar</button>' +
    '</span>').join('');
  cont.innerHTML =
    '<div class="alert" style="background:#fff8e1;border:1px solid #f5d97a;color:#7a5c00;margin-bottom:16px;padding:12px 16px">' +
      '<div style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:4px"><i class="ic ic-alert"></i> ' + n + ' conductor' + (plural ? 'es' : '') + ' reconocido' + (plural ? 's' : '') + ' en los recorridos ' + (plural ? 'no están' : 'no está') + ' en el panel</div>' +
      '<div style="font-size:12px;margin-bottom:10px;color:#8a6d00">Aparecen en los recorridos importados pero no los cargaste acá. Agregalos para asignarles condición (día de pago) y categorización.</div>' +
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
  });
  renderPanelConductores();
}

function renderPanelConductores() {
  // Filtro por condición (pestañas) + buscador por nombre o ID.
  let lista = panelFiltroActivo === 'all'
    ? AppData.panelConductores
    : AppData.panelConductores.filter(c => c.condicion === panelFiltroActivo);

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
      <div class="empty-title">${q ? 'Sin resultados para “' + q + '”' : 'Sin conductores' + (panelFiltroActivo !== 'all' ? ' con condición "' + panelFiltroActivo + '"' : '')}</div>
      <div class="empty-sub">${q ? 'Probá con otro nombre o ID' : 'Usá el botón "+ Agregar conductor" para cargar el primero'}</div>
    </div>`;
  } else {
    body.innerHTML = lista.map((c, i) => {
      const realIdx = AppData.panelConductores.indexOf(c);
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
          <button class="btn btn-sm" title="Editar conductor" style="padding:4px 8px;font-size:11px" onclick="editarConductorPanel(${realIdx})"><i class="ic ic-edit"></i></button>
          <button class="btn btn-sm" title="Eliminar conductor" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5;background:#fef2f2" onclick="eliminarConductorPanel(${realIdx})"><i class="ic ic-trash"></i></button>
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

function autoGenerarId() {
  // Solo genera ID automático cuando es un conductor nuevo (no edición)
  if (conductorEditIdx >= 0) return;
  const siguiente = AppData.panelConductores.length + 1;
  document.getElementById('mc-id').value = 'LH' + String(siguiente).padStart(5, '0');
}

function openAddConductorModal() {
  conductorEditIdx = -1;
  document.getElementById('modal-conductor-title').textContent = 'Agregar conductor';
  document.getElementById('mc-id').value = 'LH' + String(AppData.panelConductores.length + 1).padStart(5, '0');
  document.getElementById('mc-nombre').value = '';
  document.getElementById('mc-condicion').value = '';
  document.getElementById('mc-categoria').value = '';
  document.getElementById('mc-info-condicion').textContent = '';
  document.getElementById('modal-conductor-backdrop').style.display = 'flex';
}

function editarConductorPanel(idx) {
  conductorEditIdx = idx;
  const c = AppData.panelConductores[idx];
  document.getElementById('modal-conductor-title').textContent = 'Editar conductor';
  document.getElementById('mc-id').value = c.id || '';
  document.getElementById('mc-nombre').value = c.nombre;
  document.getElementById('mc-condicion').value = c.condicion;
  document.getElementById('mc-categoria').value = c.categoria;
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

    if (!id) { alert('El ID es requerido (ej: LH00001).'); return; }
    if (!nombre) { alert('Ingresá el nombre del conductor.'); return; }
    if (!categoria) { alert('Seleccioná una categorización.'); return; }

    const esEdicion = conductorEditIdx >= 0;

    // Verificar ID duplicado (solo en alta)
    if (!esEdicion && AppData.panelConductores.some(c => c.id === id)) {
      alert('El ID "' + id + '" ya está en uso. Verificá o editá el número.'); return;
    }

    const entrada = { id, nombre, condicion, categoria };

    if (esEdicion) {
      AppData.panelConductores[conductorEditIdx] = entrada;
    } else {
      if (AppData.panelConductores.some(c => c.nombre === nombre)) {
        if (!confirm('Ya existe un conductor llamado "' + nombre + '". ¿Querés agregarlo de todas formas?')) return;
      }
      AppData.panelConductores.push(entrada);
    }

    // Guardar automáticamente en localStorage + nube
    try {
      localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
    } catch(lsErr) {
      console.warn('No se pudo guardar en localStorage:', lsErr);
    }
    dbPush('panel_conductores');

    const msg = esEdicion ? '✅ Conductor actualizado y guardado' : '✅ Conductor agregado y guardado';
    conductorEditIdx = -1;
    document.getElementById('modal-conductor-backdrop').style.display = 'none';
    renderPanelConductores();
    showToast(msg);

  } catch(err) {
    console.error('Error en guardarConductorModal:', err);
    alert('Ocurrió un error al guardar: ' + err.message);
  }
}

function eliminarConductorPanel(idx) {
  const nombre = AppData.panelConductores[idx].nombre;
  if (!confirm(`¿Eliminar a ${nombre} del panel de conductores?\n\nSe borra su condición (día de pago) y categorización. Sus recorridos y liquidaciones NO se tocan; si vuelve a aparecer en los recorridos, podés recargarlo desde el aviso de "conductores reconocidos".`)) return;
  AppData.panelConductores.splice(idx, 1);
  localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
  dbPush('panel_conductores');
  renderPanelConductores();
  showToast('🗑️ Conductor eliminado y guardado');
}

function closeConductorModal(e) {
  if (!e || e.target.id === 'modal-conductor-backdrop') {
    document.getElementById('modal-conductor-backdrop').style.display = 'none';
  }
}

function savePanelConductores() {
  localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
  dbPush('panel_conductores');
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

