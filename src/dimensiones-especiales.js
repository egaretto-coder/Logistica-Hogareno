// ════════════════════════════════════════════════════════════════════════
//  DIMENSIONES ESPECIALES — CATÁLOGO (base de datos por cliente)
//  El panel es SOLO un catálogo: cada dimensión de un cliente tiene un precio
//  por zona. La asignación a un envío se hace a mano desde el panel Conductores
//  (botón "Dimensión"), y el precio aplicado sale de la zona de entrega.
// ════════════════════════════════════════════════════════════════════════
let dimEditIdx = -1;

function saveDimCatalogo() {
  try { localStorage.setItem('liq_dim_catalogo', JSON.stringify(AppData.dimCatalogo)); } catch (e) {}
  dbPush('dimensiones_catalogo');
}

function renderDimensionesEspeciales() {
  const search = (document.getElementById('dim-search')?.value || '').toLowerCase().trim();
  const cat = AppData.dimCatalogo || [];
  const list = cat.filter(d => !search ||
    String(d.cliente || '').toLowerCase().includes(search) ||
    String(d.nombre || '').toLowerCase().includes(search) ||
    String(d.zona || '').toLowerCase().includes(search));

  const countEl = document.getElementById('dim-count');
  if (countEl) {
    const nClientes = new Set(cat.map(d => normNombre(d.cliente))).size;
    const nDims = new Set(cat.map(d => normNombre(d.cliente) + '|' + normNombre(d.nombre))).size;
    countEl.textContent = cat.length + ' precio(s) · ' + nDims + ' dimensión(es) · ' + nClientes + ' cliente(s)';
  }

  const body = document.getElementById('dim-table-body');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon"><i class="ic ic-box"></i></div><div class="empty-title">Sin dimensiones en el catálogo</div><div class="empty-sub">' +
      (cat.length ? 'Ajustá el buscador' : 'Agregá una con "+ Nueva dimensión" o importá el Excel (Cliente · Dimensión · Zona · Precio)') +
      '</div></div></td></tr>';
    return;
  }

  // Orden: cliente, dimensión, zona.
  const ordenada = list.slice().sort((a, b) =>
    String(a.cliente).localeCompare(String(b.cliente)) ||
    String(a.nombre).localeCompare(String(b.nombre)) ||
    String(a.zona).localeCompare(String(b.zona)));

  body.innerHTML = ordenada.map(d => {
    const realIdx = AppData.dimCatalogo.indexOf(d);
    return '<tr>' +
      '<td><strong>' + (d.cliente || '—') + '</strong></td>' +
      '<td><span class="tag" style="background:#fef3c7;color:#92400e"><i class="ic ic-box"></i> ' + (d.nombre || '—') + '</span></td>' +
      '<td>' + (d.zona || '—') + '</td>' +
      '<td class="mono" style="text-align:right"><strong>' + fmtPeso(_num(d.precio)) + '</strong></td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="editDimension(' + realIdx + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDimension(' + realIdx + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// Datalists del modal: clientes (catálogo + recorridos), dimensiones y zonas (tarifario).
function _dimDatalists() {
  const cli = document.getElementById('md-clientes-list');
  if (cli) {
    const set = new Map();
    AppData.dimCatalogo.forEach(d => { const k = normNombre(d.cliente); if (k && !set.has(k)) set.set(k, d.cliente); });
    AppData.records.forEach(r => { const k = normNombre(r.cliente); if (k && !set.has(k)) set.set(k, r.cliente); });
    cli.innerHTML = Array.from(set.values()).sort().map(c => '<option value="' + String(c).replace(/"/g, '&quot;') + '">').join('');
  }
  const nom = document.getElementById('md-nombres-list');
  if (nom) {
    const set = new Set(AppData.dimCatalogo.map(d => d.nombre).filter(Boolean));
    nom.innerHTML = Array.from(set).sort().map(n => '<option value="' + String(n).replace(/"/g, '&quot;') + '">').join('');
  }
  const zon = document.getElementById('md-zonas-list');
  if (zon) {
    const set = new Set(AppData.tarifas.map(t => String(t.zona || '').toUpperCase().trim()).filter(Boolean));
    zon.innerHTML = Array.from(set).sort().map(z => '<option value="' + z.replace(/"/g, '&quot;') + '">').join('');
  }
}

function openAddDimensionModal() {
  dimEditIdx = -1;
  document.getElementById('modal-dim-title').textContent = 'Nueva dimensión (catálogo)';
  document.getElementById('md-cliente').value = '';
  document.getElementById('md-nombre').value = '';
  document.getElementById('md-zona').value = '';
  document.getElementById('md-precio').value = '';
  _dimDatalists();
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function editDimension(idx) {
  const d = AppData.dimCatalogo[idx];
  if (!d) return;
  dimEditIdx = idx;
  document.getElementById('modal-dim-title').textContent = 'Editar dimensión (catálogo)';
  document.getElementById('md-cliente').value = d.cliente || '';
  document.getElementById('md-nombre').value = d.nombre || '';
  document.getElementById('md-zona').value = d.zona || '';
  document.getElementById('md-precio').value = _num(d.precio) || '';
  _dimDatalists();
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function closeDimModal(e) {
  if (!e || e.target.id === 'modal-dim-backdrop') document.getElementById('modal-dim-backdrop').style.display = 'none';
}

function guardarDimensionModal() {
  try {
    const cliente = document.getElementById('md-cliente').value.trim().toUpperCase();
    const nombre = document.getElementById('md-nombre').value.trim().toUpperCase();
    const zona = document.getElementById('md-zona').value.trim().toUpperCase();
    const precio = parseFloat(document.getElementById('md-precio').value);
    if (!cliente) { alert('Elegí el cliente.'); return; }
    if (!nombre) { alert('Ingresá el nombre de la dimensión.'); return; }
    if (!zona) { alert('Elegí la zona.'); return; }
    if (isNaN(precio) || precio < 0) { alert('Ingresá un precio válido.'); return; }

    const entry = { cliente, nombre, zona, precio };
    const dupIdx = AppData.dimCatalogo.findIndex((x, i) => i !== dimEditIdx &&
      normNombre(x.cliente) === normNombre(cliente) && normNombre(x.nombre) === normNombre(nombre) && normNombre(x.zona) === normNombre(zona));

    if (dimEditIdx >= 0) {
      if (dupIdx >= 0) { alert('Ya existe ese cliente + dimensión + zona.'); return; }
      AppData.dimCatalogo[dimEditIdx] = Object.assign({}, AppData.dimCatalogo[dimEditIdx], entry);
    } else if (dupIdx >= 0) {
      if (!confirm('Ya existe "' + nombre + '" de ' + cliente + ' en ' + zona + '. ¿Actualizar su precio?')) return;
      AppData.dimCatalogo[dupIdx].precio = precio;
    } else {
      AppData.dimCatalogo.push(entry);
    }

    saveDimCatalogo();
    dimEditIdx = -1;
    document.getElementById('modal-dim-backdrop').style.display = 'none';
    renderDimensionesEspeciales();
    showToast('✅ Dimensión guardada en el catálogo');
  } catch (err) { console.error(err); alert('Error al guardar: ' + err.message); }
}

function eliminarDimension(idx) {
  const d = AppData.dimCatalogo[idx];
  if (!d) return;
  if (!confirm('Eliminar del catálogo: ' + d.nombre + ' de ' + d.cliente + ' en ' + d.zona + '?')) return;
  AppData.dimCatalogo.splice(idx, 1);
  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('🗑 Dimensión eliminada del catálogo');
}

function limpiarDimensiones() {
  if (!AppData.dimCatalogo.length) { showToast('El catálogo ya está vacío'); return; }
  if (!confirm('¿Vaciar TODO el catálogo de dimensiones? (' + AppData.dimCatalogo.length + ' filas)')) return;
  AppData.dimCatalogo = [];
  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('🗑 Catálogo vaciado');
}

function descargarPlantillaDimensiones() {
  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por Cliente + Dimensión + Zona. El precio es lo que vale ESA dimensión en ESA zona.'],
    ['Cliente', 'Dimension', 'Zona', 'Precio'],
    ['MERCADO LIBRE', 'HELADERA', 'LA PLATA', 6500],
    ['MERCADO LIBRE', 'HELADERA', 'CABA', 5200],
    ['MERCADO LIBRE', 'COLCHON KING', 'LA PLATA', 4800],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, { wch: 22 }, { wch: 20 }, { wch: 12 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dimensiones');
  XLSX.writeFile(wb, 'Plantilla_Dimensiones_Catalogo.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importDimensionesEspeciales(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }

      let h = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(x => String(x).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('cliente') && cells.some(c => c.includes('dimension') || c.includes('dimensin') || c.includes('nombre')) && cells.some(c => c.includes('zona'))) { h = r; break; }
      }
      if (h < 0) { alert('No se encontraron las columnas "Cliente", "Dimension" y "Zona". Descargá la plantilla oficial.'); return; }
      const header = rows[h].map(x => String(x).toLowerCase().trim());
      const iCli = header.findIndex(x => x.includes('cliente') || x.includes('empresa'));
      const iNom = header.findIndex(x => x.includes('dimension') || x.includes('dimensión') || x.includes('nombre') || x.includes('condicion') || x.includes('condición'));
      const iZona = header.findIndex(x => x.includes('zona') || x.includes('localidad'));
      const iPrecio = header.findIndex(x => x.includes('precio') || x.includes('valor') || x.includes('monto') || x.includes('tarifa'));
      if (iCli < 0 || iNom < 0 || iZona < 0 || iPrecio < 0) { alert('Faltan columnas Cliente / Dimension / Zona / Precio.'); return; }

      const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
      let nuevas = 0, actualizadas = 0;
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i];
        const cliente = String(r[iCli] || '').trim().toUpperCase();
        const nombre = String(r[iNom] || '').trim().toUpperCase();
        const zona = String(r[iZona] || '').trim().toUpperCase();
        const precio = parseNum(r[iPrecio]);
        if (!cliente || !nombre || !zona) continue;
        const idx = AppData.dimCatalogo.findIndex(x => normNombre(x.cliente) === normNombre(cliente) && normNombre(x.nombre) === normNombre(nombre) && normNombre(x.zona) === normNombre(zona));
        if (idx >= 0) { AppData.dimCatalogo[idx].precio = precio; actualizadas++; }
        else { AppData.dimCatalogo.push({ cliente, nombre, zona, precio }); nuevas++; }
      }
      if (!nuevas && !actualizadas) { alert('No se importó ninguna dimensión válida (Cliente, Dimension, Zona).'); return; }

      saveDimCatalogo();
      renderDimensionesEspeciales();
      showToast('✅ Catálogo importado: ' + nuevas + ' nueva(s), ' + actualizadas + ' actualizada(s)');
    } catch (err) { console.error(err); alert('Error al importar: ' + err.message); }
    finally { event.target.value = ''; }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ═════════════════ MÓDULO DESCUENTO CONDUCTORES ══════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

