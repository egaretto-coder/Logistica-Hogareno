// ════════════════════════════════════════════════════════════════════════
//  DESCUENTO CONDUCTORES — solapas: combustible / extraviados / proveedores
//  (módulo descuentos-items.js) + adelantos (adelantos.js) + km de desvío (acá).
// ════════════════════════════════════════════════════════════════════════

function switchDescTab(tab) {
  const tabs = ['combustible', 'extraviados', 'proveedores', 'adelantos', 'kmdesvio'];
  tabs.forEach(t => {
    const panel = document.getElementById('desc-tab-' + t);
    const btn = document.getElementById('tab-btn-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'kmdesvio') renderKmDesvio();
  else if (tab === 'adelantos') { if (typeof renderAdelantos === 'function') renderAdelantos(); }
  else if (typeof renderDescItems === 'function') renderDescItems(tab); // combustible / extraviados / proveedores
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

// Convierte una celda de fecha de Excel (Date de xlsx, o texto DD/MM/AAAA) a DD/MM/YYYY.
function fechaCeldaExcel(v) {
  if (v instanceof Date) {
    return String(v.getDate()).padStart(2, '0') + '/' + String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear();
  }
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + y; }
  return '';
}

// ── Km de desvío: plantilla + importación de Excel ──────────────────────────
function descargarPlantillaKm() {
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Completá desde la fila 3 (una fila por desvío). Fecha DD/MM/AAAA — la tarifa por km se aplica según esa fecha; el monto se calcula solo.'],
    ['Conductor', 'Fecha', 'Km de desvío'],
    ['ALEJO BRIEND', '15/07/2026', 12],
    ['EMILIANO VENTURA', '16/07/2026', 8],
    ['NOMBRE APELLIDO', '', ''],
    ['NOMBRE APELLIDO', '', ''],
    ['NOMBRE APELLIDO', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Km de desvio');
  XLSX.writeFile(wb, 'Plantilla_Km_Desvio.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importKmDesvio(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío o no tiene datos suficientes.'); return; }

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
        km:        header.findIndex(h => h.includes('km') || h.includes('kilomet') || h.includes('kilómet')),
      };
      if (idx.conductor < 0) { alert('No se encontró la columna "Conductor".'); return; }

      const parseNum = v => {
        if (v === '' || v == null) return 0;
        if (typeof v === 'number') return v;
        const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? 0 : n;
      };
      const yaExisten = new Set(AppData.kmDesvio.map(d => [String(d.conductor).toUpperCase(), d.fecha, _num(d.km)].join('|')));

      let agregados = 0, salteados = 0;
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const conductor = String(r[idx.conductor] || '').trim().toUpperCase();
        if (!conductor || conductor === 'NOMBRE APELLIDO') continue;
        const km = idx.km >= 0 ? parseNum(r[idx.km]) : 0;
        if (km <= 0) continue;
        const fecha = idx.fecha >= 0 ? fechaCeldaExcel(r[idx.fecha]) : '';
        const clave = [conductor, fecha, km].join('|');
        if (yaExisten.has(clave)) { salteados++; continue; }
        yaExisten.add(clave);
        const valor_km = fecha ? tarifaKmEnFecha(new Date(dmyToISO(fecha) + 'T12:00:00')) : kmValorActual();
        const monto = Math.round(km * valor_km);
        AppData.kmDesvio.push({ conductor, km, fecha, valor_km, monto, obs: '' });
        agregados++;
      }

      if (!agregados) { alert('No se importó ningún registro nuevo' + (salteados ? ' (' + salteados + ' duplicados salteados).' : ' válido.')); return; }
      saveKmDesvio();
      renderKmDesvio();
      showToast('✅ Importados ' + agregados + ' km de desvío' + (salteados ? ' · ' + salteados + ' duplicados salteados' : ''));
    } catch (err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}
