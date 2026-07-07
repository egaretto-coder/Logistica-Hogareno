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

// Cambia la tarifa por km (SOLO analista): registra una nueva tarifa en el
// historial vigente desde ahora. NO recalcula los montos ya cargados: cada
// desvío conserva la tarifa con la que se calculó.
async function guardarKmValor(el) {
  if (!esAnalista()) {
    showToast('⛔ Solo un analista puede modificar la tarifa por km');
    el.value = kmValorActual() || '';
    return;
  }
  const valor = parseFloat(el.value) || 0;
  if (valor <= 0) { showToast('Ingresá un valor mayor a 0'); el.value = kmValorActual() || ''; return; }
  if (valor === kmValorActual()) { renderKmDesvio(); return; } // sin cambios

  el.disabled = true;
  try {
    await agregarTarifaKm(valor);
    renderKmDesvio();
    showToast('💵 Nueva tarifa ' + fmtPeso(valor) + '/km vigente desde hoy. Los km ya cargados no cambian.');
  } catch (e) {
    renderKmDesvio();
    showToast('⛔ No se pudo guardar la tarifa (revisá tu conexión o permisos).');
  } finally {
    el.disabled = false;
  }
}

// Fecha de hoy en formato ISO (YYYY-MM-DD, hora local) para los <input type=date>.
function hoyISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function isoToDMY(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
}
function dmyToISO(dmy) {
  if (!dmy) return '';
  const p = String(dmy).split('/');
  return p.length === 3 ? p[2] + '-' + String(p[1]).padStart(2,'0') + '-' + String(p[0]).padStart(2,'0') : '';
}

// Recalcula el monto del modal según los km y la FECHA (toma la tarifa vigente
// a esa fecha). Devuelve { valor, monto } para reutilizarlo al guardar.
function autoCalcKmMonto() {
  const km = parseFloat(document.getElementById('mkm-km').value) || 0;
  const iso = document.getElementById('mkm-fecha').value;
  const valor = iso ? tarifaKmEnFecha(new Date(iso + 'T12:00:00')) : kmValorActual();
  const monto = Math.round(km * valor);
  const calcEl = document.getElementById('mkm-monto-calc');
  if (calcEl) calcEl.textContent = fmtPeso(monto);
  const hint = document.getElementById('mkm-monto-hint');
  if (hint) {
    hint.textContent = valor > 0
      ? km + ' km × ' + fmtPeso(valor) + '/km (tarifa vigente al ' + (isoToDMY(iso) || 'día') + ')'
      : 'No hay tarifa configurada para esa fecha — el monto sería $0';
  }
  return { valor, monto };
}

function renderKmDesvio() {
  const analista = esAnalista();
  const valorActual = kmValorActual();

  // Campo de tarifa: reflejar valor vigente y habilitar solo para analistas.
  const valorInput = document.getElementById('km-valor-input');
  if (valorInput && document.activeElement !== valorInput) {
    valorInput.value = valorActual || '';
  }
  if (valorInput) {
    valorInput.disabled = !analista;
    valorInput.title = analista ? '' : 'Solo un analista puede modificar la tarifa por km';
    valorInput.style.opacity = analista ? '1' : '0.6';
    valorInput.style.cursor = analista ? '' : 'not-allowed';
  }
  const estadoEl = document.getElementById('km-valor-estado');
  if (estadoEl) {
    if (valorActual > 0) {
      estadoEl.textContent = 'Tarifa vigente: ' + fmtPeso(valorActual) + '/km. '
        + (analista
            ? 'Si la cambiás, aplica desde hoy — los km ya cargados conservan su valor.'
            : 'Solo un analista puede modificarla.');
    } else {
      estadoEl.textContent = analista
        ? 'Sin tarifa configurada: cargá el valor por km para calcular los montos.'
        : 'Sin tarifa configurada. Solo un analista puede definirla.';
    }
  }

  const search = (document.getElementById('kmdesvio-search')?.value || '').toLowerCase();
  const list = AppData.kmDesvio.filter(d => {
    if (!search) return true;
    return String(d.conductor||'').toLowerCase().includes(search);
  });

  const countEl = document.getElementById('kmdesvio-count');
  if (countEl) {
    countEl.textContent = list.length + ' de ' + AppData.kmDesvio.length + ' registros de km de desvío';
  }

  const body = document.getElementById('kmdesvio-table-body');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🛣</div><div class="empty-title">Sin resultados</div><div class="empty-sub">' +
      (AppData.kmDesvio.length ? 'Ajustá el buscador' : 'Agregá un registro con "+ Agregar manual"') +
      '</div></div></td></tr>';
    return;
  }

  body.innerHTML = list.map(d => {
    const realIdx = AppData.kmDesvio.indexOf(d);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(d.conductor) + '">' + initials(d.conductor) + '</div><strong>' + d.conductor + '</strong></div></td>' +
      '<td class="mono">' + (d.fecha || '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + (d.km || 0) + ' km</td>' +
      '<td class="mono muted" style="text-align:right">' + (d.valor_km ? fmtPeso(d.valor_km) + '/km' : '—') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:600;color:' + ((d.monto||0) > 0 ? '#166534' : '#9ca3af') + '">' + fmtPeso(d.monto||0) + '</td>' +
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
  document.getElementById('mkm-fecha').value = hoyISO();
  poblarConductoresKmDesvioDatalist();
  autoCalcKmMonto();
  document.getElementById('modal-kmdesvio-backdrop').style.display = 'flex';
}

function editKmDesvio(idx) {
  const d = AppData.kmDesvio[idx];
  if (!d) return;
  kmEditIdx = idx;
  document.getElementById('modal-kmdesvio-title').textContent = 'Editar km de desvío — ' + d.conductor;
  document.getElementById('mkm-conductor').value = d.conductor || '';
  document.getElementById('mkm-km').value = d.km || '';
  document.getElementById('mkm-fecha').value = dmyToISO(d.fecha) || hoyISO();
  poblarConductoresKmDesvioDatalist();
  autoCalcKmMonto();
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
    const iso = document.getElementById('mkm-fecha').value;

    if (!conductor) { alert('El conductor es obligatorio.'); return; }
    if (!iso) { alert('La fecha del desvío es obligatoria.'); return; }
    if (km <= 0) { alert('Ingresá los km de desvío (mayor a 0).'); return; }

    const fecha = isoToDMY(iso);
    // Tarifa vigente A LA FECHA del desvío (no la de hoy): así, si el precio
    // sube más adelante, este registro conserva la tarifa de su fecha.
    const valor_km = tarifaKmEnFecha(new Date(iso + 'T12:00:00'));
    const monto = Math.round(km * valor_km);

    if (valor_km <= 0) {
      if (!confirm('No hay tarifa de km configurada para el ' + fecha + ', el monto será $0. ¿Guardar igual?')) return;
    }

    const entry = { conductor, km, fecha, valor_km, monto, obs: '' };

    if (kmEditIdx >= 0) {
      AppData.kmDesvio[kmEditIdx] = entry;
    } else {
      AppData.kmDesvio.push(entry);
    }

    saveKmDesvio();
    kmEditIdx = -1;
    document.getElementById('modal-kmdesvio-backdrop').style.display = 'none';
    renderKmDesvio();
    showToast('✅ Km de desvío guardado: ' + fmtPeso(monto) + ' (' + km + ' km al ' + fecha + ')');
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

