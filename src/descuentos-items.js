// ════════════════════════════════════════════════════════════════════════
//  DESCUENTOS POR ÍTEM CON FECHA — combustible / extraviados / proveedores
//  Cada renglón es un descuento con fecha; se imputa automáticamente a la
//  liquidación del período en que cae (ver liquidaciones-pdf.js). Una sola
//  tabla (descuentos_items) con discriminador 'tipo'; la UI muestra una solapa
//  por tipo, todas manejadas por este módulo parametrizado.
// ════════════════════════════════════════════════════════════════════════

// Config por tipo: rótulo, ícono, color, campo de referencia y encabezados de
// la plantilla Excel. 'refLabel' null = el tipo no tiene campo de referencia.
const DESC_ITEMS = {
  combustible: {
    label: 'Combustible', emoji: '⛽', color: '#b45309', refLabel: null,
    headers: ['Conductor', 'Fecha', 'Monto', 'Detalle'],
    ejemplos: [
      ['ALEJO BRIEND', '15/07/2026', 15000, 'Carga de nafta ruta larga'],
      ['EMILIANO VENTURA', '16/07/2026', 8000, 'Combustible zona LA PLATA'],
    ],
  },
  extraviados: {
    label: 'Extraviados / Rotos', emoji: '📦', color: '#b91c1c', refLabel: 'Tracking / Envío',
    headers: ['Conductor', 'Fecha', 'Monto', 'Tracking / Envío', 'Detalle'],
    ejemplos: [
      ['EMILIANO VENTURA', '16/07/2026', 4500, '9410811899223344556677', 'Envío roto en reparto'],
      ['SERGIO MOLINA', '17/07/2026', 12000, '9410811899000011112222', 'Paquete extraviado'],
    ],
  },
  proveedores: {
    label: 'Servicio Proveedores', emoji: '🧾', color: '#4f46e5', refLabel: 'Proveedor',
    headers: ['Conductor', 'Fecha', 'Monto', 'Proveedor', 'Detalle'],
    ejemplos: [
      ['SERGIO MOLINA', '17/07/2026', 12000, 'Gomería El Rayo', 'Cambio de cubierta'],
      ['FEDERICO LABIGNAN', '18/07/2026', 9000, 'Taller Norte', 'Service preventivo'],
    ],
  },
};

let descItemModalTipo = null;   // tipo del ítem que se está creando/editando
let descItemEditId = null;      // id del registro en edición (null = alta)
let descItemCandidatos = [];    // recorridos sugeridos para autocompletar el tracking (extravíos)

function tFecha(f) { const d = parseFechaReg(f); return d ? d.getTime() : 0; }

// ── Render de una solapa de ítem ────────────────────────────────────────────
function renderDescItems(tipo) {
  const cfg = DESC_ITEMS[tipo];
  const cont = document.getElementById('descitem-' + tipo + '-rows');
  if (!cfg || !cont) return;
  const conRef = !!cfg.refLabel;
  const conCuotas = (tipo === 'extraviados'); // columna de cuotas/progreso
  const ncols = 5 + (conRef ? 1 : 0) + (conCuotas ? 1 : 0);

  const fInput = document.getElementById('descitem-' + tipo + '-fecha-nuevo');
  if (fInput && !fInput.value) fInput.value = hoyISO();
  if (tipo === 'extraviados') {
    const semEl = document.getElementById('extravios-fecha');
    if (semEl && !semEl.value) semEl.value = hoyISO();
  }

  const todos = AppData.descItems.filter(x => x.tipo === tipo);
  const search = (document.getElementById('descitem-' + tipo + '-search')?.value || '').toLowerCase().trim();
  const lista = todos
    .filter(x => !search
      || String(x.conductor || '').toLowerCase().includes(search)
      || String(x.referencia || '').toLowerCase().includes(search))
    .sort((a, b) => tFecha(b.fecha) - tFecha(a.fecha));

  const totalAll = todos.reduce((s, x) => s + _num(x.monto), 0);
  const countEl = document.getElementById('descitem-' + tipo + '-count');
  if (countEl) countEl.textContent = todos.length + ' registros · Total ' + fmtPeso(totalAll);

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="' + ncols + '"><div class="empty-state"><div class="empty-icon">' + cfg.emoji + '</div><div class="empty-title">Sin registros</div><div class="empty-sub">' +
      (todos.length ? 'Ajustá el buscador' : 'Agregá uno manual o importá un Excel') + '</div></div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(x => {
    const cuoteado = _num(x.cuotas_total) > 1;
    const refCell = conRef
      ? '<td class="mono muted" style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">' + (x.referencia || '—') + '</td>'
      : '';

    // Columna de cuotas/progreso (solo extravíos)
    let cuotasCell = '';
    if (conCuotas) {
      if (cuoteado) {
        const pagadas = descItemCuotasPagadas(x.id);
        const pct = x.cuotas_total ? Math.round(pagadas / x.cuotas_total * 100) : 0;
        const saldado = pagadas >= x.cuotas_total;
        cuotasCell = '<td style="min-width:150px"><div style="display:flex;align-items:center;gap:8px">' +
          '<div style="flex:1;height:7px;background:var(--surface-0);border-radius:99px;overflow:hidden;border:1px solid var(--border)"><div style="height:100%;width:' + pct + '%;background:' + (saldado ? '#166534' : '#b45309') + '"></div></div>' +
          '<span style="font-size:11px;font-weight:600;white-space:nowrap">' + pagadas + '/' + x.cuotas_total + '</span>' +
          '</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + (saldado ? '✓ Saldado' : 'Saldo ' + fmtPeso(descItemSaldo(x)) + ' · cuota ' + fmtPeso(_num(x.monto_cuota))) + '</div></td>';
      } else {
        cuotasCell = '<td class="muted" style="font-size:11px">Pago único</td>';
      }
    }

    // Acciones: para cuoteados no saldados, botones de cuota
    let acciones = '';
    if (cuoteado) {
      const saldado = descItemSaldado(x);
      acciones += saldado ? '' : '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="descontarCuotaExtravio(' + x.id + ')" title="Registrar la próxima cuota en la semana elegida arriba">− Cuota</button>';
      acciones += '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="verHistorialExtravio(' + x.id + ')" title="Ver cuotas">📋</button>';
    } else {
      acciones += '<button class="btn btn-sm" onclick="editDescItem(\'' + tipo + '\',' + x.id + ')">✎</button>';
    }
    acciones += '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDescItem(\'' + tipo + '\',' + x.id + ')">🗑</button>';

    return '<tr' + (cuoteado && descItemSaldado(x) ? ' style="opacity:0.6"' : '') + '>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.conductor) + ';width:28px;height:28px;font-size:10px">' + initials(x.conductor) + '</div><strong>' + x.conductor + '</strong></div></td>' +
      '<td class="mono muted">' + (x.fecha || '—') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:600;color:' + (_num(x.monto) > 0 ? '#b91c1c' : '#9ca3af') + '">' + fmtPeso(_num(x.monto)) + (cuoteado ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400">en ' + x.cuotas_total + ' cuotas</div>' : '') + '</td>' +
      cuotasCell +
      refCell +
      '<td class="muted" style="font-size:11px;max-width:220px">' + (x.detalle || '—') + '</td>' +
      '<td><div style="display:flex;gap:4px">' + acciones + '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Modal alta / edición ────────────────────────────────────────────────────
function poblarConductoresDescItemDatalist() {
  const dl = document.getElementById('mditem-conductores-list');
  if (!dl) return;
  const nombres = AppData.panelConductores.map(c => c.nombre)
    .concat(Object.keys(calcLiquidaciones()));
  dl.innerHTML = Array.from(new Set(nombres)).sort().map(n => '<option value="' + n + '">').join('');
}

function configDescItemModal(tipo) {
  const cfg = DESC_ITEMS[tipo];
  document.getElementById('mditem-tipo-emoji').textContent = cfg.emoji;
  const refWrap = document.getElementById('mditem-ref-wrap');
  if (cfg.refLabel) {
    refWrap.style.display = '';
    document.getElementById('mditem-ref-label').textContent = cfg.refLabel;
    document.getElementById('mditem-ref').placeholder = cfg.refLabel;
  } else {
    refWrap.style.display = 'none';
  }
  // Secciones extra solo para extravíos (cliente + buscar tracking arriba, cuotear abajo)
  const esExtravio = (tipo === 'extraviados');
  const extra = document.getElementById('mditem-extravio-extra');
  if (extra) extra.style.display = esExtravio ? 'flex' : 'none';
  const cuoteBlock = document.getElementById('mditem-cuotear-block');
  if (cuoteBlock) cuoteBlock.style.display = esExtravio ? '' : 'none';
}

function openAddDescItemModal(tipo) {
  descItemModalTipo = tipo;
  descItemEditId = null;
  const cfg = DESC_ITEMS[tipo];
  document.getElementById('modal-descitem-title').textContent = 'Agregar ' + cfg.label.toLowerCase();
  document.getElementById('mditem-conductor').value = '';
  document.getElementById('mditem-fecha').value = hoyISO();
  document.getElementById('mditem-monto').value = '';
  document.getElementById('mditem-ref').value = '';
  document.getElementById('mditem-detalle').value = '';
  resetExtravioModalExtra();
  configDescItemModal(tipo);
  poblarConductoresDescItemDatalist();
  if (tipo === 'extraviados') buscarTrackingsExtravio();
  document.getElementById('modal-descitem-backdrop').style.display = 'flex';
}

// Resetea los campos extra de extravíos (cliente, sugerencias, cuotear).
function resetExtravioModalExtra() {
  descItemCandidatos = [];
  const cli = document.getElementById('mditem-cliente'); if (cli) cli.value = '';
  const sug = document.getElementById('mditem-sugerencias'); if (sug) sug.innerHTML = '';
  const chk = document.getElementById('mditem-cuotear'); if (chk) { chk.checked = false; chk.disabled = false; }
  const cuotasInput = document.getElementById('mditem-cuotas'); if (cuotasInput) { cuotasInput.value = ''; cuotasInput.disabled = false; }
  const wrap = document.getElementById('mditem-cuotas-wrap'); if (wrap) wrap.style.display = 'none';
  const prev = document.getElementById('mditem-cuota-preview'); if (prev) prev.textContent = '';
}

function editDescItem(tipo, id) {
  const x = AppData.descItems.find(r => r.id === id && r.tipo === tipo);
  if (!x) return;
  descItemModalTipo = tipo;
  descItemEditId = id;
  const cfg = DESC_ITEMS[tipo];
  document.getElementById('modal-descitem-title').textContent = 'Editar ' + cfg.label.toLowerCase() + ' — ' + x.conductor;
  document.getElementById('mditem-conductor').value = x.conductor || '';
  document.getElementById('mditem-fecha').value = dmyToISO(x.fecha) || hoyISO();
  document.getElementById('mditem-monto').value = x.monto || '';
  document.getElementById('mditem-ref').value = x.referencia || '';
  document.getElementById('mditem-detalle').value = x.detalle || '';
  resetExtravioModalExtra(); // los cuoteados no se editan por acá (pago único)
  configDescItemModal(tipo);
  poblarConductoresDescItemDatalist();
  document.getElementById('modal-descitem-backdrop').style.display = 'flex';
}

function closeDescItemModal(e) {
  if (!e || e.target.id === 'modal-descitem-backdrop') {
    document.getElementById('modal-descitem-backdrop').style.display = 'none';
  }
}

async function guardarDescItemModal() {
  const tipo = descItemModalTipo;
  const cfg = DESC_ITEMS[tipo];
  if (!cfg) return;
  const conductor = document.getElementById('mditem-conductor').value.trim().toUpperCase();
  const iso = document.getElementById('mditem-fecha').value;
  const monto = parseFloat(document.getElementById('mditem-monto').value) || 0;
  const referencia = cfg.refLabel ? document.getElementById('mditem-ref').value.trim() : '';
  const detalle = document.getElementById('mditem-detalle').value.trim();

  if (!conductor) { alert('El conductor es obligatorio.'); return; }
  if (!iso) { alert('La fecha es obligatoria (define a qué liquidación se imputa).'); return; }
  if (monto <= 0) { alert('Ingresá un monto mayor a 0.'); return; }

  // Cuotear: solo extravíos y solo en el alta (los cuoteados no se editan por acá).
  let cuotas_total = 1, monto_cuota = 0;
  if (tipo === 'extraviados' && descItemEditId == null) {
    const chk = document.getElementById('mditem-cuotear');
    if (chk && chk.checked) {
      cuotas_total = parseInt(document.getElementById('mditem-cuotas').value) || 0;
      if (cuotas_total < 2) { alert('Para cuotear, ingresá 2 o más cuotas (o destildá "Cuotear").'); return; }
      monto_cuota = Math.round(monto / cuotas_total);
    }
  }

  const fecha = isoToDMY(iso);
  const fila = { tipo, conductor, fecha, fecha_date: fechaISOde(fecha), monto, referencia, detalle, cuotas_total, monto_cuota };

  try {
    if (descItemEditId != null) {
      await DB.updateWhere('descuentos_items', 'id', descItemEditId, fila);
      const i = AppData.descItems.findIndex(r => r.id === descItemEditId);
      if (i >= 0) AppData.descItems[i] = { id: descItemEditId, ...fila };
    } else {
      const row = await DB.insertRow('descuentos_items', fila);
      AppData.descItems.push({ id: row.id, ...fila });
    }
    descItemEditId = null;
    document.getElementById('modal-descitem-backdrop').style.display = 'none';
    renderDescItems(tipo);
    showToast(cuotas_total > 1
      ? '✅ Extravío cuoteado: ' + fmtPeso(monto) + ' en ' + cuotas_total + ' cuotas de ' + fmtPeso(monto_cuota) + ' (' + conductor + ')'
      : '✅ ' + cfg.label + ' guardado: ' + fmtPeso(monto) + ' (' + conductor + ', ' + fecha + ')');
  } catch (e) {
    console.warn('guardarDescItemModal:', e);
    alert('No se pudo guardar: ' + (e.message || e));
  }
}

// ── Extravíos: autocompletado de tracking desde recorridos ──────────────────
// Al elegir conductor (+ fecha + cliente), busca en AppData.records los envíos
// de ese conductor y ofrece los trackings; el operador selecciona el correcto.
function buscarTrackingsExtravio() {
  const cont = document.getElementById('mditem-sugerencias');
  if (!cont) return;
  const conductor = document.getElementById('mditem-conductor').value.trim().toUpperCase();
  const cliente = document.getElementById('mditem-cliente').value.trim().toLowerCase();
  const iso = document.getElementById('mditem-fecha').value;
  const fechaDMY = iso ? isoToDMY(iso) : '';
  if (!conductor) {
    descItemCandidatos = [];
    cont.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:6px">Ingresá el conductor para ver sus envíos.</div>';
    return;
  }
  const cands = AppData.records.filter(r => {
    if (String(r.cadete || '').toUpperCase().trim() !== conductor) return false;
    if (fechaDMY && String(r.fecha || '').trim() !== fechaDMY) return false;
    if (cliente && !String(r.destinatario || '').toLowerCase().includes(cliente)) return false;
    return !!(r.tracking || r.direccion);
  }).slice(0, 20);
  descItemCandidatos = cands;
  if (!cands.length) {
    cont.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:6px">Sin envíos que coincidan' +
      (fechaDMY ? ' para esa fecha (probá sin fecha, o revisá que los recorridos estén cargados)' : '') +
      '. Podés escribir el tracking a mano abajo.</div>';
    return;
  }
  cont.innerHTML = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">' + cands.length + ' envío(s) — tocá el correcto:</div>' +
    cands.map((r, i) =>
    '<div onclick="seleccionarTrackingExtravio(' + i + ')" style="cursor:pointer;padding:6px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;font-size:11px" onmouseover="this.style.background=\'var(--surface-0)\'" onmouseout="this.style.background=\'transparent\'">' +
      '<div style="font-family:monospace;font-weight:600">' + (r.tracking || '(sin tracking)') + '</div>' +
      '<div style="color:var(--text-muted)">' + (r.destinatario || '—') + (r.direccion ? ' · ' + r.direccion : '') + (r.estado ? ' · ' + r.estado : '') + '</div>' +
    '</div>').join('');
}

function seleccionarTrackingExtravio(i) {
  const r = descItemCandidatos[i];
  if (!r) return;
  document.getElementById('mditem-ref').value = r.tracking || '';
  const det = document.getElementById('mditem-detalle');
  if (det && !det.value.trim()) det.value = [r.destinatario, r.direccion].filter(Boolean).join(' · ');
  // El monto queda en blanco a propósito: lo escribe el operador con el valor real del paquete.
  const mEl = document.getElementById('mditem-monto');
  if (mEl) mEl.focus();
}

// ── Extravíos: cuotear ──────────────────────────────────────────────────────
function toggleCuotearExtravio() {
  const chk = document.getElementById('mditem-cuotear');
  const wrap = document.getElementById('mditem-cuotas-wrap');
  if (wrap) wrap.style.display = (chk && chk.checked) ? 'flex' : 'none';
  actualizarPreviewCuotaExtravio();
}

function actualizarPreviewCuotaExtravio() {
  const chk = document.getElementById('mditem-cuotear');
  const prev = document.getElementById('mditem-cuota-preview');
  if (!prev) return;
  const monto = parseFloat(document.getElementById('mditem-monto').value) || 0;
  const cuotas = parseInt(document.getElementById('mditem-cuotas').value) || 0;
  prev.textContent = (chk && chk.checked && monto > 0 && cuotas >= 2)
    ? 'Cada cuota: ' + fmtPeso(Math.round(monto / cuotas)) + '  ×  ' + cuotas + ' cuotas'
    : '';
}

// ── Extravíos: registro de cuotas (imputadas a la liquidación de su semana) ──
function fechaSemanaExtravio() {
  const iso = document.getElementById('extravios-fecha')?.value || hoyISO();
  return isoToDMY(iso);
}

async function descontarCuotaExtravio(itemId) {
  const it = AppData.descItems.find(x => x.id === itemId && x.tipo === 'extraviados');
  if (!it) return;
  if (descItemSaldado(it)) { showToast('Ese extravío ya está saldado'); return; }
  const nro = descItemCuotasPagadas(it.id) + 1;
  const fecha = fechaSemanaExtravio();
  if (!confirm('¿Descontar la cuota ' + nro + '/' + it.cuotas_total + ' (' + fmtPeso(it.monto_cuota) + ') de ' + it.conductor + ' en la semana del ' + fecha + '?\nAparecerá en su liquidación de esa fecha.')) return;
  try {
    const row = await DB.insertRow('descuento_cuotas', { item_id: itemId, nro, monto: it.monto_cuota, fecha, fecha_date: fechaISOde(fecha) });
    AppData.descItemCuotas.push({ id: row.id, item_id: itemId, nro, monto: it.monto_cuota, fecha });
    renderDescItems('extraviados');
    showToast('✅ Cuota ' + nro + '/' + it.cuotas_total + ' de ' + it.conductor + ' descontada (' + fecha + ')');
  } catch (e) { console.warn('descontarCuotaExtravio:', e); showToast('⛔ No se pudo registrar la cuota'); }
}

async function descontarCuotaSemanalExtravios() {
  const activos = AppData.descItems.filter(x => x.tipo === 'extraviados' && _num(x.cuotas_total) > 1 && !descItemSaldado(x));
  if (!activos.length) { showToast('No hay extravíos cuoteados activos'); return; }
  const fecha = fechaSemanaExtravio();
  if (!confirm('¿Descontar una cuota a los ' + activos.length + ' extravíos cuoteados activos en la semana del ' + fecha + '?')) return;
  let ok = 0;
  for (const it of activos) {
    const nro = descItemCuotasPagadas(it.id) + 1;
    try {
      const row = await DB.insertRow('descuento_cuotas', { item_id: it.id, nro, monto: it.monto_cuota, fecha, fecha_date: fechaISOde(fecha) });
      AppData.descItemCuotas.push({ id: row.id, item_id: it.id, nro, monto: it.monto_cuota, fecha });
      ok++;
    } catch (e) { console.warn('cuota masiva extravío', it.conductor, e); }
  }
  renderDescItems('extraviados');
  showToast('✅ ' + ok + ' cuota(s) descontadas para la semana del ' + fecha);
}

async function deshacerUltimaCuotaExtravio(itemId) {
  const cuotas = descItemCuotasDe(itemId).sort((a, b) => b.nro - a.nro);
  if (!cuotas.length) { showToast('No hay cuotas para deshacer'); return; }
  const ult = cuotas[0];
  if (!confirm('¿Deshacer la cuota ' + ult.nro + ' (' + fmtPeso(ult.monto) + ', semana del ' + ult.fecha + ')?')) return;
  try {
    await DB.deleteWhere('descuento_cuotas', 'id', ult.id);
    AppData.descItemCuotas = AppData.descItemCuotas.filter(c => c.id !== ult.id);
    verHistorialExtravio(itemId);
    renderDescItems('extraviados');
    showToast('↩ Cuota deshecha');
  } catch (e) { console.warn('deshacerUltimaCuotaExtravio:', e); showToast('⛔ No se pudo deshacer'); }
}

function verHistorialExtravio(itemId) {
  const it = AppData.descItems.find(x => x.id === itemId);
  if (!it) return;
  const cuotas = descItemCuotasDe(itemId);
  document.getElementById('modal-title').textContent = 'Extravío cuoteado · ' + it.conductor;
  const filas = [];
  for (let i = 1; i <= it.cuotas_total; i++) {
    const c = cuotas.find(x => x.nro === i);
    filas.push('<tr><td class="mono">' + i + '/' + it.cuotas_total + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(c ? c.monto : it.monto_cuota) + '</td>' +
      '<td>' + (c ? '<span class="badge badge-green">✓ Descontada</span>' : '<span class="badge badge-gray">Pendiente</span>') + '</td>' +
      '<td class="mono muted">' + (c ? c.fecha : '—') + '</td></tr>');
  }
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">' +
      '<div>Tracking: <strong>' + (it.referencia || '—') + '</strong></div>' +
      '<div>Total: <strong>' + fmtPeso(it.monto) + '</strong></div>' +
      '<div>Cuota: <strong>' + fmtPeso(it.monto_cuota) + '</strong></div>' +
      '<div>Pagadas: <strong>' + descItemCuotasPagadas(itemId) + '/' + it.cuotas_total + '</strong></div>' +
      '<div>Saldo: <strong style="color:' + (descItemSaldo(it) > 0 ? '#b45309' : '#166534') + '">' + fmtPeso(descItemSaldo(it)) + '</strong></div>' +
    '</div>' +
    (it.detalle ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">📝 ' + it.detalle + '</div>' : '') +
    '<div class="table-wrap" style="max-height:46vh;overflow:auto"><table><thead><tr><th>Cuota</th><th style="text-align:right">Monto</th><th>Estado</th><th>Semana</th></tr></thead><tbody>' + filas.join('') + '</tbody></table></div>' +
    (descItemCuotasPagadas(itemId) ? '<div style="margin-top:10px;text-align:right"><button class="btn btn-sm" style="color:#b91c1c;border-color:#fca5a5" onclick="deshacerUltimaCuotaExtravio(' + itemId + ')">↩ Deshacer última cuota</button></div>' : '');
  document.getElementById('modal-backdrop').classList.add('open');
}

async function eliminarDescItem(tipo, id) {
  const x = AppData.descItems.find(r => r.id === id && r.tipo === tipo);
  if (!x) return;
  if (!confirm('¿Eliminar este descuento de ' + x.conductor + ' (' + fmtPeso(_num(x.monto)) + ', ' + x.fecha + ')?')) return;
  try {
    await DB.deleteWhere('descuentos_items', 'id', id);
    AppData.descItems = AppData.descItems.filter(r => r.id !== id);
    renderDescItems(tipo);
    showToast('🗑 Registro eliminado');
  } catch (e) { console.warn('eliminarDescItem:', e); showToast('⛔ No se pudo eliminar'); }
}

async function limpiarDescItems(tipo) {
  const cfg = DESC_ITEMS[tipo];
  const ids = AppData.descItems.filter(x => x.tipo === tipo).map(x => x.id);
  if (!ids.length) { showToast('No hay registros para limpiar'); return; }
  if (!confirm('¿Eliminar TODOS los registros de ' + cfg.label + '? (' + ids.length + ' registros)')) return;
  try {
    await DB.deleteIn('descuentos_items', 'id', ids);
    AppData.descItems = AppData.descItems.filter(x => x.tipo !== tipo);
    renderDescItems(tipo);
    showToast('🗑 Todos los registros de ' + cfg.label + ' eliminados');
  } catch (e) { console.warn('limpiarDescItems:', e); showToast('⛔ No se pudo limpiar'); }
}

// ── Plantilla Excel + importación (append) ──────────────────────────────────
function descargarPlantillaDescItems(tipo) {
  const cfg = DESC_ITEMS[tipo];
  const ncol = cfg.headers.length;
  const placeholder = Array(ncol).fill('');
  placeholder[0] = 'NOMBRE APELLIDO';
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Completá los datos a partir de la fila 3 (una fila por descuento). Fecha en formato DD/MM/AAAA — define a qué liquidación se imputa.'],
    cfg.headers,
    ...cfg.ejemplos,
    placeholder.slice(), placeholder.slice(), placeholder.slice(), placeholder.slice(), placeholder.slice(),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cfg.headers.map((h, i) => ({ wch: i === 0 ? 26 : (h.length > 12 ? 22 : 14) }));
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ncol - 1 } }];
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 28));
  XLSX.writeFile(wb, 'Plantilla_' + cfg.label.replace(/[^A-Za-z]/g, '_') + '.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importDescItems(tipo, event) {
  const cfg = DESC_ITEMS[tipo];
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío o no tiene datos suficientes.'); return; }

      // Detectar la fila de encabezados (exige la columna "Conductor").
      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('conductor') || cells.includes('cadete') || cells.includes('nombre')) { headerRowIdx = r; break; }
      }
      if (headerRowIdx < 0) { alert('No se encontró una fila de encabezados válida (falta la columna "Conductor").\nDescargá la plantilla oficial.'); return; }

      const header = rows[headerRowIdx].map(h => String(h).toLowerCase().trim());
      const idx = {
        conductor: header.findIndex(h => h.includes('conductor') || h.includes('cadete') || h.includes('nombre')),
        fecha:     header.findIndex(h => h.includes('fecha')),
        monto:     header.findIndex(h => h.includes('monto') || h.includes('importe') || h.includes('valor')),
        ref:       cfg.refLabel ? header.findIndex(h => h.includes('tracking') || h.includes('envio') || h.includes('envío') || h.includes('proveedor')) : -1,
        detalle:   header.findIndex(h => h.includes('detalle') || h.includes('observ') || h.includes('nota') || h.includes('comentar')),
      };
      if (idx.conductor < 0) { alert('No se encontró la columna "Conductor".'); return; }

      const parseNum = v => {
        if (v === '' || v == null) return 0;
        if (typeof v === 'number') return v;
        const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? 0 : n;
      };
      const parseFechaCell = v => {
        if (v instanceof Date) {
          return String(v.getDate()).padStart(2, '0') + '/' + String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear();
        }
        const s = String(v || '').trim();
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + y; }
        return '';
      };

      // Índice de duplicados exactos ya existentes (conductor|fecha|monto|ref).
      const claveDup = r => [r.conductor, r.fecha, _num(r.monto), r.referencia || ''].join('|');
      const yaExisten = new Set(AppData.descItems.filter(x => x.tipo === tipo).map(claveDup));

      const nuevos = [];
      let salteados = 0;
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const conductor = String(r[idx.conductor] || '').trim().toUpperCase();
        if (!conductor || conductor === 'NOMBRE APELLIDO') continue;
        const monto = idx.monto >= 0 ? parseNum(r[idx.monto]) : 0;
        if (monto <= 0) continue;
        const fecha = idx.fecha >= 0 ? parseFechaCell(r[idx.fecha]) : '';
        const referencia = idx.ref >= 0 ? String(r[idx.ref] || '').trim() : '';
        const detalle = idx.detalle >= 0 ? String(r[idx.detalle] || '').trim() : '';
        const fila = { tipo, conductor, fecha, fecha_date: fechaISOde(fecha), monto, referencia, detalle };
        if (yaExisten.has(claveDup(fila))) { salteados++; continue; }
        yaExisten.add(claveDup(fila));
        nuevos.push(fila);
      }

      if (!nuevos.length) {
        alert('No se importó ningún registro nuevo' + (salteados ? ' (' + salteados + ' duplicados exactos salteados).' : ' válido.'));
        return;
      }

      const ids = await DB.insertRows('descuentos_items', nuevos);
      nuevos.forEach((n, k) => AppData.descItems.push({
        id: ids[k], tipo: n.tipo, conductor: n.conductor, fecha: n.fecha,
        monto: n.monto, referencia: n.referencia, detalle: n.detalle
      }));
      renderDescItems(tipo);
      showToast('✅ Importados ' + nuevos.length + ' registros de ' + cfg.label +
        (salteados ? ' · ' + salteados + ' duplicados salteados' : ''));
    } catch (err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}
