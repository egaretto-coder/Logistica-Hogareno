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

function tFecha(f) { const d = parseFechaReg(f); return d ? d.getTime() : 0; }

// ── Render de una solapa de ítem ────────────────────────────────────────────
function renderDescItems(tipo) {
  const cfg = DESC_ITEMS[tipo];
  const cont = document.getElementById('descitem-' + tipo + '-rows');
  if (!cfg || !cont) return;
  const conRef = !!cfg.refLabel;
  const ncols = conRef ? 6 : 5;

  const fInput = document.getElementById('descitem-' + tipo + '-fecha-nuevo');
  if (fInput && !fInput.value) fInput.value = hoyISO();

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
    const refCell = conRef
      ? '<td class="mono muted" style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">' + (x.referencia || '—') + '</td>'
      : '';
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.conductor) + ';width:28px;height:28px;font-size:10px">' + initials(x.conductor) + '</div><strong>' + x.conductor + '</strong></div></td>' +
      '<td class="mono muted">' + (x.fecha || '—') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:600;color:' + (_num(x.monto) > 0 ? '#b91c1c' : '#9ca3af') + '">' + fmtPeso(_num(x.monto)) + '</td>' +
      refCell +
      '<td class="muted" style="font-size:11px;max-width:220px">' + (x.detalle || '—') + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<button class="btn btn-sm" onclick="editDescItem(\'' + tipo + '\',' + x.id + ')">✎</button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDescItem(\'' + tipo + '\',' + x.id + ')">🗑</button>' +
      '</div></td>' +
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
  configDescItemModal(tipo);
  poblarConductoresDescItemDatalist();
  document.getElementById('modal-descitem-backdrop').style.display = 'flex';
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

  const fecha = isoToDMY(iso);
  const fila = { tipo, conductor, fecha, fecha_date: fechaISOde(fecha), monto, referencia, detalle };

  try {
    if (descItemEditId != null) {
      await DB.updateWhere('descuentos_items', 'id', descItemEditId, fila);
      const i = AppData.descItems.findIndex(r => r.id === descItemEditId);
      if (i >= 0) AppData.descItems[i] = { id: descItemEditId, tipo, conductor, fecha, monto, referencia, detalle };
    } else {
      const row = await DB.insertRow('descuentos_items', fila);
      AppData.descItems.push({ id: row.id, tipo, conductor, fecha, monto, referencia, detalle });
    }
    descItemEditId = null;
    document.getElementById('modal-descitem-backdrop').style.display = 'none';
    renderDescItems(tipo);
    showToast('✅ ' + cfg.label + ' guardado: ' + fmtPeso(monto) + ' (' + conductor + ', ' + fecha + ')');
  } catch (e) {
    console.warn('guardarDescItemModal:', e);
    alert('No se pudo guardar: ' + (e.message || e));
  }
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
