let descEditIdx = -1;

function saveDescuentos() {
  try {
    localStorage.setItem('liq_descuentos_conductores', JSON.stringify(AppData.descuentosConductores));
  } catch(e) { console.warn('No se pudo guardar descuentos:', e); }
  dbPush('descuentos_conductores');
}

function findDescuentoConductor(conductor) {
  if (!conductor || !AppData.descuentosConductores.length) return null;
  const key = conductor.toUpperCase().trim();
  return AppData.descuentosConductores.find(d =>
    String(d.conductor || '').toUpperCase().trim() === key
  ) || null;
}

function renderDescuentosConductores() {
  const search = (document.getElementById('desc-search')?.value || '').toLowerCase();
  const list = AppData.descuentosConductores.filter(d => {
    if (!search) return true;
    return String(d.conductor||'').toLowerCase().includes(search);
  });

  const countEl = document.getElementById('desc-count');
  if (countEl) {
    countEl.textContent = list.length + ' de ' + AppData.descuentosConductores.length + ' conductores con descuento';
  }

  const body = document.getElementById('desc-table-body');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🎫</div><div class="empty-title">Sin resultados</div><div class="empty-sub">' +
      (AppData.descuentosConductores.length ? 'Ajustá el buscador' : 'Importá un Excel o agregá manualmente') +
      '</div></div></td></tr>';
    return;
  }

  body.innerHTML = list.map(d => {
    const realIdx = AppData.descuentosConductores.indexOf(d);
    const total = (d.combustible||0) + (d.extraviados||0) + (d.adelantos||0) + (d.proveedores||0);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(d.conductor) + '">' + initials(d.conductor) + '</div><strong>' + d.conductor + '</strong></div></td>' +
      '<td class="mono" style="text-align:right;color:' + ((d.combustible||0) > 0 ? '#b91c1c' : '#9ca3af') + '">' + fmtPeso(d.combustible||0) + '</td>' +
      '<td class="mono" style="text-align:right;color:' + ((d.extraviados||0) > 0 ? '#b91c1c' : '#9ca3af') + '">' + fmtPeso(d.extraviados||0) + '</td>' +
      '<td class="mono" style="text-align:right;color:' + ((d.adelantos||0) > 0 ? '#b91c1c' : '#9ca3af') + '">' + fmtPeso(d.adelantos||0) + '</td>' +
      '<td class="mono" style="text-align:right;color:' + ((d.proveedores||0) > 0 ? '#b91c1c' : '#9ca3af') + '">' + fmtPeso(d.proveedores||0) + '</td>' +
      '<td class="mono" style="text-align:right"><strong>' + fmtPeso(total) + '</strong></td>' +
      '<td class="muted" style="font-size:11px;max-width:200px">' + (d.obs || '—') + '</td>' +
      '<td>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editDescuento(' + realIdx + ')">✎</button>' +
          '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDescuento(' + realIdx + ')">🗑</button>' +
        '</div>' +
      '</td>' +
      '</tr>';
  }).join('');
}

function poblarConductoresDatalist() {
  const dl = document.getElementById('mdesc-conductores-list');
  if (!dl) return;
  const nombres = AppData.panelConductores.map(c => c.nombre)
    .concat(Object.keys(calcLiquidaciones()));
  const uniques = Array.from(new Set(nombres)).sort();
  dl.innerHTML = uniques.map(n => '<option value="' + n + '">').join('');
}

function openAddDescuentoModal() {
  descEditIdx = -1;
  document.getElementById('modal-desc-title').textContent = 'Agregar descuento';
  document.getElementById('mdesc-conductor').value = '';
  document.getElementById('mdesc-combustible').value = '';
  document.getElementById('mdesc-extraviados').value = '';
  document.getElementById('mdesc-adelantos').value = '';
  document.getElementById('mdesc-proveedores').value = '';
  document.getElementById('mdesc-obs').value = '';
  poblarConductoresDatalist();
  document.getElementById('modal-desc-backdrop').style.display = 'flex';
}

function editDescuento(idx) {
  const d = AppData.descuentosConductores[idx];
  if (!d) return;
  descEditIdx = idx;
  document.getElementById('modal-desc-title').textContent = 'Editar descuento — ' + d.conductor;
  document.getElementById('mdesc-conductor').value = d.conductor || '';
  document.getElementById('mdesc-combustible').value = d.combustible || '';
  document.getElementById('mdesc-extraviados').value = d.extraviados || '';
  document.getElementById('mdesc-adelantos').value = d.adelantos || '';
  document.getElementById('mdesc-proveedores').value = d.proveedores || '';
  document.getElementById('mdesc-obs').value = d.obs || '';
  poblarConductoresDatalist();
  document.getElementById('modal-desc-backdrop').style.display = 'flex';
}

function closeDescModal(e) {
  if (!e || e.target.id === 'modal-desc-backdrop') {
    document.getElementById('modal-desc-backdrop').style.display = 'none';
  }
}

function guardarDescuentoModal() {
  try {
    const conductor = document.getElementById('mdesc-conductor').value.trim().toUpperCase();
    const combustible = parseFloat(document.getElementById('mdesc-combustible').value) || 0;
    const extraviados = parseFloat(document.getElementById('mdesc-extraviados').value) || 0;
    const adelantos = parseFloat(document.getElementById('mdesc-adelantos').value) || 0;
    const proveedores = parseFloat(document.getElementById('mdesc-proveedores').value) || 0;
    const obs = document.getElementById('mdesc-obs').value.trim();

    if (!conductor) { alert('El conductor es obligatorio.'); return; }
    if (combustible === 0 && extraviados === 0 && adelantos === 0 && proveedores === 0) {
      if (!confirm('Todos los montos son 0. ¿Guardar de todas formas?')) return;
    }

    const entry = { conductor, combustible, extraviados, adelantos, proveedores, obs };

    if (descEditIdx >= 0) {
      AppData.descuentosConductores[descEditIdx] = entry;
    } else {
      // Buscar duplicado por conductor
      const dup = AppData.descuentosConductores.findIndex(x =>
        String(x.conductor).toUpperCase().trim() === conductor
      );
      if (dup >= 0) {
        if (!confirm('Ya existe descuento para ' + conductor + '. ¿Reemplazarlo?')) return;
        AppData.descuentosConductores[dup] = entry;
      } else {
        AppData.descuentosConductores.push(entry);
      }
    }

    saveDescuentos();
    descEditIdx = -1;
    document.getElementById('modal-desc-backdrop').style.display = 'none';
    renderDescuentosConductores();
    showToast('✅ Descuento guardado');
  } catch(err) {
    console.error(err);
    alert('Error al guardar: ' + err.message);
  }
}

function eliminarDescuento(idx) {
  const d = AppData.descuentosConductores[idx];
  if (!d) return;
  if (!confirm('¿Eliminar el descuento de ' + d.conductor + '?')) return;
  AppData.descuentosConductores.splice(idx, 1);
  saveDescuentos();
  renderDescuentosConductores();
  showToast('🗑 Descuento eliminado');
}

function limpiarDescuentos() {
  if (!AppData.descuentosConductores.length) { showToast('No hay descuentos para limpiar'); return; }
  if (!confirm('¿Eliminar TODOS los descuentos cargados? (' + AppData.descuentosConductores.length + ' registros)')) return;
  AppData.descuentosConductores = [];
  saveDescuentos();
  renderDescuentosConductores();
  showToast('🗑 Todos los descuentos eliminados');
}

// ===== SOLAPAS: DESCUENTOS / KM DE DESVÍO =====
function switchDescTab(tab) {
  const isDesc = tab === 'descuentos';
  document.getElementById('desc-tab-descuentos').style.display = isDesc ? '' : 'none';
  document.getElementById('desc-tab-kmdesvio').style.display = isDesc ? 'none' : '';
  document.getElementById('tab-btn-descuentos').classList.toggle('active', isDesc);
  document.getElementById('tab-btn-kmdesvio').classList.toggle('active', !isDesc);
  if (!isDesc) renderKmDesvio();
}

// ===== KM DE DESVÍO =====
let kmEditIdx = -1;

function saveKmDesvio() {
  localStorage.setItem('liq_km_desvio', JSON.stringify(AppData.kmDesvio));
  dbPush('km_desvio');
}

// Guarda la tarifa fija por km desviado (compartida con todos los usuarios)
// y recalcula el monto de TODOS los registros cargados con el valor nuevo.
function guardarKmValor(el) {
  const valor = parseFloat(el.value) || 0;
  AppData.config.km_valor = valor;
  saveConfigApp();

  if (valor > 0 && AppData.kmDesvio.length) {
    AppData.kmDesvio.forEach(d => { d.monto = Math.round((d.km || 0) * valor); });
    saveKmDesvio();
  }
  renderKmDesvio();
  showToast('💵 Valor por km guardado: ' + fmtPeso(valor) + (AppData.kmDesvio.length ? ' — montos recalculados' : ''));
}

// Autocalcula el monto en el modal a partir de los km y la tarifa configurada.
function autoCalcKmMonto() {
  const valor = AppData.config.km_valor || 0;
  if (valor <= 0) return; // sin tarifa configurada, el monto se carga a mano
  const km = parseFloat(document.getElementById('mkm-km').value) || 0;
  document.getElementById('mkm-monto').value = Math.round(km * valor);
  actualizarHintKmMonto();
}

function actualizarHintKmMonto() {
  const hint = document.getElementById('mkm-monto-hint');
  if (!hint) return;
  const valor = AppData.config.km_valor || 0;
  hint.textContent = valor > 0
    ? 'Calculado automáticamente: km × ' + fmtPeso(valor) + ' por km (podés ajustarlo)'
    : 'Configurá el "Valor por km" en el panel para que se calcule solo';
}

function renderKmDesvio() {
  // Reflejar la tarifa configurada
  const valorInput = document.getElementById('km-valor-input');
  if (valorInput && document.activeElement !== valorInput) {
    valorInput.value = AppData.config.km_valor || '';
  }
  const estadoEl = document.getElementById('km-valor-estado');
  if (estadoEl) {
    estadoEl.textContent = (AppData.config.km_valor || 0) > 0
      ? 'Cada km desviado se paga ' + fmtPeso(AppData.config.km_valor) + ' — el monto se calcula solo al cargar los km.'
      : 'Sin tarifa configurada: el monto se carga a mano en cada registro.';
  }
  const search = (document.getElementById('kmdesvio-search')?.value || '').toLowerCase();
  const list = AppData.kmDesvio.filter(d => {
    if (!search) return true;
    return String(d.conductor||'').toLowerCase().includes(search);
  });

  const countEl = document.getElementById('kmdesvio-count');
  if (countEl) {
    countEl.textContent = list.length + ' de ' + AppData.kmDesvio.length + ' conductores con km de desvío';
  }

  const body = document.getElementById('kmdesvio-table-body');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🛣</div><div class="empty-title">Sin resultados</div><div class="empty-sub">' +
      (AppData.kmDesvio.length ? 'Ajustá el buscador' : 'Agregá un registro manualmente') +
      '</div></div></td></tr>';
    return;
  }

  body.innerHTML = list.map(d => {
    const realIdx = AppData.kmDesvio.indexOf(d);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(d.conductor) + '">' + initials(d.conductor) + '</div><strong>' + d.conductor + '</strong></div></td>' +
      '<td class="mono" style="text-align:right">' + (d.km || 0) + ' km</td>' +
      '<td class="mono" style="text-align:right;color:' + ((d.monto||0) > 0 ? '#166534' : '#9ca3af') + '">' + fmtPeso(d.monto||0) + '</td>' +
      '<td class="muted" style="font-size:11px;max-width:200px">' + (d.obs || '—') + '</td>' +
      '<td>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editKmDesvio(' + realIdx + ')">✎</button>' +
          '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarKmDesvio(' + realIdx + ')">🗑</button>' +
        '</div>' +
      '</td>' +
      '</tr>';
  }).join('');
}

function poblarConductoresKmDesvioDatalist() {
  const dl = document.getElementById('mkm-conductores-list');
  if (!dl) return;
  const nombres = AppData.panelConductores.map(c => c.nombre)
    .concat(Object.keys(calcLiquidaciones()));
  const uniques = Array.from(new Set(nombres)).sort();
  dl.innerHTML = uniques.map(n => '<option value="' + n + '">').join('');
}

function openAddKmDesvioModal() {
  kmEditIdx = -1;
  document.getElementById('modal-kmdesvio-title').textContent = 'Agregar km de desvío';
  document.getElementById('mkm-conductor').value = '';
  document.getElementById('mkm-km').value = '';
  document.getElementById('mkm-monto').value = '';
  document.getElementById('mkm-obs').value = '';
  poblarConductoresKmDesvioDatalist();
  actualizarHintKmMonto();
  document.getElementById('modal-kmdesvio-backdrop').style.display = 'flex';
}

function editKmDesvio(idx) {
  const d = AppData.kmDesvio[idx];
  if (!d) return;
  kmEditIdx = idx;
  document.getElementById('modal-kmdesvio-title').textContent = 'Editar km de desvío — ' + d.conductor;
  document.getElementById('mkm-conductor').value = d.conductor || '';
  document.getElementById('mkm-km').value = d.km || '';
  document.getElementById('mkm-monto').value = d.monto || '';
  document.getElementById('mkm-obs').value = d.obs || '';
  poblarConductoresKmDesvioDatalist();
  actualizarHintKmMonto();
  document.getElementById('modal-kmdesvio-backdrop').style.display = 'flex';
}

function closeKmDesvioModal(e) {
  if (!e || e.target.id === 'modal-kmdesvio-backdrop') {
    document.getElementById('modal-kmdesvio-backdrop').style.display = 'none';
  }
}

function guardarKmDesvioModal() {
  try {
    const conductor = document.getElementById('mkm-conductor').value.trim().toUpperCase();
    const km = parseFloat(document.getElementById('mkm-km').value) || 0;
    const monto = parseFloat(document.getElementById('mkm-monto').value) || 0;
    const obs = document.getElementById('mkm-obs').value.trim();

    if (!conductor) { alert('El conductor es obligatorio.'); return; }
    if (km === 0 && monto === 0) {
      if (!confirm('El km y el monto son 0. ¿Guardar de todas formas?')) return;
    }

    const entry = { conductor, km, monto, obs };

    if (kmEditIdx >= 0) {
      AppData.kmDesvio[kmEditIdx] = entry;
    } else {
      const dup = AppData.kmDesvio.findIndex(x =>
        String(x.conductor).toUpperCase().trim() === conductor
      );
      if (dup >= 0) {
        if (!confirm('Ya existe un registro de km de desvío para ' + conductor + '. ¿Reemplazarlo?')) return;
        AppData.kmDesvio[dup] = entry;
      } else {
        AppData.kmDesvio.push(entry);
      }
    }

    saveKmDesvio();
    kmEditIdx = -1;
    document.getElementById('modal-kmdesvio-backdrop').style.display = 'none';
    renderKmDesvio();
    showToast('✅ Km de desvío guardado');
  } catch(err) {
    console.error(err);
    alert('Error al guardar: ' + err.message);
  }
}

function eliminarKmDesvio(idx) {
  const d = AppData.kmDesvio[idx];
  if (!d) return;
  if (!confirm('¿Eliminar el registro de km de desvío de ' + d.conductor + '?')) return;
  AppData.kmDesvio.splice(idx, 1);
  saveKmDesvio();
  renderKmDesvio();
  showToast('🗑 Registro eliminado');
}

function limpiarKmDesvio() {
  if (!AppData.kmDesvio.length) { showToast('No hay registros para limpiar'); return; }
  if (!confirm('¿Eliminar TODOS los registros de km de desvío? (' + AppData.kmDesvio.length + ' registros)')) return;
  AppData.kmDesvio = [];
  saveKmDesvio();
  renderKmDesvio();
  showToast('🗑 Todos los registros eliminados');
}

// Encabezados canónicos de la plantilla. El orden y los nombres definen la
// estructura oficial: no cambiarlos evita que la importación falle o
// tome datos de la columna equivocada.
const PLANTILLA_DESC_HEADERS = ['Conductor', 'Combustible', 'Extraviados / Rotos', 'Adelantos', 'Servicio Proveedores', 'Observaciones'];
const PLANTILLA_DESC_PLACEHOLDER = 'NOMBRE APELLIDO';

function descargarPlantillaDescuentos() {
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Completá los datos a partir de la fila 3 (una fila por conductor). No dejes filas ni columnas vacías entre datos.'],
    PLANTILLA_DESC_HEADERS,
    ['ALEJO BRIEND', 15000, 0, 20000, 0, 'Descuento por combustible y adelanto'],
    ['EMILIANO VENTURA', 8000, 4500, 0, 0, 'Envío roto en zona LA PLATA'],
    ['FEDERICO LABIGNAN', 0, 0, 30000, 0, 'Adelanto quincenal'],
    ['SERGIO MOLINA', 0, 0, 0, 12000, 'Servicio de gomería contratado a proveedor externo'],
    [PLANTILLA_DESC_PLACEHOLDER, '', '', '', '', ''],
    [PLANTILLA_DESC_PLACEHOLDER, '', '', '', '', ''],
    [PLANTILLA_DESC_PLACEHOLDER, '', '', '', '', ''],
    [PLANTILLA_DESC_PLACEHOLDER, '', '', '', '', ''],
    [PLANTILLA_DESC_PLACEHOLDER, '', '', '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:26},{wch:14},{wch:18},{wch:14},{wch:20},{wch:38}];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:5} }];
  // Fijamos la fila del encabezado en pantalla para que no se pierda de vista al completar.
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Descuentos');
  XLSX.writeFile(wb, 'Plantilla_Descuento_Conductores.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importDescuentosConductores(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío o no tiene datos suficientes.'); return; }

      // La plantilla oficial tiene:
      //   fila 0 → instrucciones (puede estar o no)
      //   fila 1 → encabezados canónicos
      //   fila 2+ → datos
      // Pero el usuario podría también subir un Excel sin la fila de instrucciones
      // (encabezados en fila 0).  Intentamos detectar dónde están los headers.

      // La celda debe SER exactamente "Conductor" (o "Cadete"/"Nombre"): la fila
      // de instrucciones menciona la palabra "conductor", así que buscar por
      // "incluye" la confundía con el encabezado real. Exigimos igualdad exacta.
      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('conductor') || cells.includes('cadete') || cells.includes('nombre')) {
          headerRowIdx = r;
          break;
        }
      }

      if (headerRowIdx < 0) {
        alert('No se encontró una fila de encabezados válida.\n\nLa estructura del Excel debe contener al menos la columna "Conductor".\n\nDescargá la plantilla oficial para asegurarte de usar la estructura correcta.');
        return;
      }

      const header = rows[headerRowIdx].map(h => String(h).toLowerCase().trim());
      const idx = {
        conductor:   header.findIndex(h => h.includes('conductor') || h.includes('cadete') || h.includes('nombre')),
        combustible: header.findIndex(h => h.includes('combustible') || h.includes('nafta') || h.includes('gasolina')),
        extraviados: header.findIndex(h => h.includes('extravi') || h.includes('roto') || h.includes('perdid')),
        adelantos:   header.findIndex(h => h.includes('adelanto') || h.includes('anticipo')),
        proveedores: header.findIndex(h => h.includes('proveedor') || h.includes('servicio prov')),
        obs:         header.findIndex(h => h.includes('observ') || h.includes('nota') || h.includes('comentar')),
      };

      if (idx.conductor < 0) {
        alert('No se encontró la columna "Conductor" en los encabezados.\n\nAsegurate de no haber cambiado la estructura de la plantilla.');
        return;
      }

      const parseNum = v => {
        if (v === '' || v === null || v === undefined) return 0;
        if (typeof v === 'number') return v;
        const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? 0 : n;
      };

      const nuevos = [];
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const conductor = String(r[idx.conductor] || '').trim().toUpperCase();
        if (!conductor || conductor === PLANTILLA_DESC_PLACEHOLDER) continue;
        nuevos.push({
          conductor,
          combustible: idx.combustible >= 0 ? parseNum(r[idx.combustible]) : 0,
          extraviados: idx.extraviados >= 0 ? parseNum(r[idx.extraviados]) : 0,
          adelantos:   idx.adelantos   >= 0 ? parseNum(r[idx.adelantos])   : 0,
          proveedores: idx.proveedores >= 0 ? parseNum(r[idx.proveedores]) : 0,
          obs:         idx.obs         >= 0 ? String(r[idx.obs] || '').trim() : ''
        });
      }

      if (!nuevos.length) { alert('No se pudo importar ningún descuento válido.'); return; }

      // Fusionar con los existentes (reemplazar por conductor)
      const mapExist = {};
      AppData.descuentosConductores.forEach((d, i) => {
        mapExist[String(d.conductor).toUpperCase().trim()] = i;
      });
      let agregados = 0, actualizados = 0;
      nuevos.forEach(n => {
        const key = n.conductor;
        if (mapExist[key] !== undefined) {
          AppData.descuentosConductores[mapExist[key]] = n;
          actualizados++;
        } else {
          AppData.descuentosConductores.push(n);
          agregados++;
        }
      });

      saveDescuentos();
      renderDescuentosConductores();
      showToast('✅ Importado: ' + agregados + ' nuevos · ' + actualizados + ' actualizados');
    } catch(err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════════════════════

