// Importación de recorridos (Excel/CSV) + mapeo de columnas.

// Configura drag & drop de la zona de carga. Se llama tras inyectar las pantallas.
function initImportar() {
  // Calendario de fecha de carga: por defecto, hoy.
  const fc = document.getElementById('upload-fecha-carga');
  if (fc && !fc.value) fc.value = hoyISO();

  const dz = document.getElementById('drop-zone');
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (json.length < 2) { alert('El archivo no tiene datos suficientes.'); return; }

    AppData.rawHeaders = json[0].map(h => String(h).trim());
    AppData.rawRows = json.slice(1).filter(row => row.some(c => c !== ''));

    showColumnMapper();
  };
  reader.readAsArrayBuffer(file);
}

// Convierte índice de columna (0-based) a letra de Excel (A, B, ... AA, AD...)
function colIndexToLetter(idx) {
  let letter = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function colLetterToIndex(letter) {
  let n = 0;
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
}

// Campos esperados de la hoja "BD", con su columna de referencia esperada
// y palabras clave para intentar un automatch por nombre de encabezado.
const BD_FIELDS = [
  { key: 'tracking', label: 'N° Tracking', expectedCol: 'B', required: true, keywords: ['tracking', 'n° tracking', 'numero tracking', 'nro tracking'] },
  { key: 'fecha', label: 'Fecha', expectedCol: 'G', required: true, keywords: ['fecha'] },
  { key: 'localidad', label: 'Localidad (respaldo si Zona está vacía)', expectedCol: 'T', required: false, keywords: ['localidad'] },
  { key: 'estado', label: 'Estado', expectedCol: 'X', required: true, keywords: ['estado'] },
  { key: 'zona', label: 'Zona', expectedCol: 'AA', required: true, keywords: ['zona'] },
  { key: 'cadete', label: 'Cadete', expectedCol: 'AD', required: true, keywords: ['cadete', 'conductor', 'chofer'] },
];

function showColumnMapper() {
  const headers = AppData.rawHeaders;

  document.getElementById('mapper-rows').innerHTML = BD_FIELDS.map(f => {
    // Prioridad de automatch: 1) la columna esperada (B, G, T, X, AA, AD) si existe en el archivo,
    // 2) coincidencia por nombre de encabezado.
    const expectedIdx = colLetterToIndex(f.expectedCol);
    let autoIdx = (expectedIdx < headers.length) ? expectedIdx : -1;
    if (autoIdx === -1) {
      autoIdx = headers.findIndex(h => f.keywords.some(k => h.toLowerCase().includes(k)));
    }

    return `
    <div class="column-map-row">
      <div>
        <div class="map-label">${f.label}</div>
        <span style="font-size:10px;color:var(--text-muted)">Columna ${f.expectedCol} en tu hoja "BD"</span>
        ${f.required ? '<span style="font-size:10px;color:var(--accent);margin-left:6px">Requerido</span>' : ''}
      </div>
      <div class="map-arrow">→</div>
      <select class="mapper-select" data-field="${f.key}">
        <option value="">${f.required ? 'Seleccionar columna...' : 'No incluido'}</option>
        ${headers.map((h, i) => `<option value="${i}" ${i === autoIdx ? 'selected' : ''}>${colIndexToLetter(i)} — ${h}</option>`).join('')}
      </select>
    </div>
  `;
  }).join('');

  document.getElementById('column-mapper').style.display = 'block';
  document.getElementById('upload-preview').style.display = 'none';
}

// Intenta normalizar distintos formatos de fecha de Excel/CSV a dd/mm/yyyy
function normalizaFecha(val) {
  if (val === '' || val === undefined || val === null) return '';
  if (typeof val === 'number') {
    // Fecha serial de Excel
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${String(d.d).padStart(2,'0')}/${String(d.m).padStart(2,'0')}/${d.y}`;
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${yyyy}`;
  }
  return s;
}

// Devuelve el día de la semana (0=lunes ... 5=sábado, 6=domingo) a partir de dd/mm/yyyy
function diaSemana(fechaStr) {
  const m = fechaStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  const js = d.getDay(); // 0=domingo
  return js === 0 ? 6 : js - 1; // 0=lunes ... 6=domingo
}

function processUpload() {
  const selects = document.querySelectorAll('.mapper-select');
  const mapping = {};
  selects.forEach(sel => {
    if (sel.value !== '') mapping[sel.dataset.field] = parseInt(sel.value);
  });

  const faltantes = BD_FIELDS.filter(f => f.required && mapping[f.key] === undefined);
  if (faltantes.length) {
    alert('Faltan columnas requeridas: ' + faltantes.map(f => f.label).join(', '));
    return;
  }

  // No fusionar contra una base a medio cargar: se detectarían mal las
  // superposiciones. (La nube igual queda protegida por el guardado quirúrgico.)
  if (AppData._hidratando) {
    alert('La base todavía se está cargando desde la nube. Esperá unos segundos y volvé a presionar "Procesar datos".');
    return;
  }

  AppData.mappings = mapping;

  // Fecha de carga elegida en el calendario (default: hoy). Cada registro
  // importado queda marcado con este día para poder visualizarlo después.
  const fechaCargaISO = document.getElementById('upload-fecha-carga')?.value || '';
  const fechaCarga = fechaCargaISO ? isoToDMY(fechaCargaISO) : isoToDMY(hoyISO());

  const nuevos = AppData.rawRows.map(row => {
    const rec = {};
    Object.entries(mapping).forEach(([field, colIdx]) => {
      rec[field] = String(row[colIdx] !== undefined ? row[colIdx] : '').trim();
    });
    rec.fecha = normalizaFecha(row[mapping.fecha]);
    rec.carga_fecha = fechaCarga;
    return rec;
  }).filter(r => r.tracking && r.cadete);

  // FUSIÓN con lo ya cargado: si un tracking ya existía, la información nueva
  // REEMPLAZA a la anterior — se eliminan TODAS sus filas previas (un tracking
  // puede aparecer en más de una fila, ej. segundas visitas) y entran las de
  // esta carga. Cada reemplazo queda registrado para auditar con el botón ⚠.
  // Los trackings nuevos se agregan; el resto de los datos previos se conserva.
  const resumenReg = (r, carga) =>
    (r.fecha || '—') + ' · ' + (r.estado || '—') + ' · ' + (r.cadete || '—') +
    (carga ? ' — cargado el ' + carga : '');
  const nuevoPorTracking = {};
  nuevos.forEach(n => { nuevoPorTracking[String(n.tracking).trim()] = n; });

  const sup = [];
  const restantes = [];
  AppData.records.forEach(r => {
    const k = String(r.tracking || '').trim();
    const n = k && nuevoPorTracking[k];
    if (n) {
      sup.push({
        clave: k,
        antes: resumenReg(r, r.carga_fecha),
        despues: resumenReg(n, fechaCarga)
      });
    } else {
      restantes.push(r);
    }
  });
  const clavesReemplazadas = new Set(sup.map(s => s.clave));
  const agregados = nuevos.filter(n => !clavesReemplazadas.has(String(n.tracking).trim())).length;
  AppData.records = restantes.concat(nuevos);
  registrarSuperposiciones('registros', fechaCarga, sup);

  // Detectar si hay fechas fuera del rango lunes-sábado (posible domingo cargado)
  const diasFueraDeRango = nuevos.filter(r => diaSemana(r.fecha) === 6).length;

  document.getElementById('column-mapper').style.display = 'none';
  document.getElementById('upload-preview').style.display = 'block';

  const verFecha = document.getElementById('upload-ver-fecha');
  if (verFecha) verFecha.value = fechaCargaISO || hoyISO();
  renderPreviewRegistros(nuevos, 'Vista previa · carga del ' + fechaCarga);

  const entregados = nuevos.filter(r => esEstadoEntregado(r.estado)).length;
  const noEntregados = nuevos.length - entregados;

  document.getElementById('upload-success-msg').innerHTML =
    `✅ Carga del <strong>${fechaCarga}</strong>: ${nuevos.length} registros procesados — ` +
    `<strong>${agregados} nuevos</strong> y <strong>${sup.length} reemplazaron información anterior</strong>` +
    (sup.length ? ' (revisalas con el botón ⚠)' : '') + `. ` +
    `<strong>${entregados} entregados</strong> (contabilizan) y <strong>${noEntregados} en otros estados</strong>.` +
    `${diasFueraDeRango ? `<br>⚠️ ${diasFueraDeRango} registros con fecha de domingo — la liquidación es de lunes a sábado, revisá si corresponde excluirlos.` : ''}` +
    ` La base total queda en <strong>${AppData.records.length}</strong> registros. <span id="upload-nube-estado">☁️ Guardando en la nube…</span>`;

  renderDashboard();

  // Guardado automático QUIRÚRGICO: solo se borran/insertan en la nube los
  // trackings de ESTA carga (no se reescribe la base entera — con ~2.000
  // registros diarios eso no escala). El banner refleja el resultado.
  guardarImportacionEnNube(nuevos).then(ok => {
    const est = document.getElementById('upload-nube-estado');
    if (est) est.innerHTML = ok
      ? '<strong style="color:#166534">☁️✅ Guardado en la nube.</strong>'
      : '<strong style="color:#b91c1c">⚠️ No se pudo guardar en la nube — usá el botón "Reintentar".</strong>';
  });
}

// Dibuja la tabla de vista previa para una lista de registros.
function renderPreviewRegistros(lista, titulo) {
  document.getElementById('preview-title').textContent = titulo;
  document.getElementById('preview-table-wrap').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Tracking</th><th>Fecha</th><th>Zona</th><th>Localidad</th><th>Estado</th><th>Cadete</th><th>Cargado el</th>
        </tr>
      </thead>
      <tbody>
        ${lista.slice(0, 20).map(r => `
          <tr>
            <td class="mono muted">${r.tracking}</td>
            <td class="muted">${r.fecha || '—'}</td>
            <td>${r.zona || '<span class="muted">vacía</span>'}</td>
            <td class="muted">${r.localidad || '—'}</td>
            <td><span class="badge ${esEstadoEntregado(r.estado) ? 'badge-green' : 'badge-gray'}">${r.estado || '—'}</span></td>
            <td><strong>${r.cadete}</strong></td>
            <td class="muted mono" style="font-size:11px">${r.carga_fecha || '—'}</td>
          </tr>
        `).join('')}
        ${lista.length > 20 ? `<tr><td colspan="7" class="muted" style="text-align:center;padding:12px">...y ${lista.length - 20} registros más</td></tr>` : ''}
        ${!lista.length ? `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">Sin registros cargados ese día</td></tr>` : ''}
      </tbody>
    </table>`;
}

// Calendario "ver información del día": filtra la base por fecha de carga.
function verRegistrosDelDia() {
  const iso = document.getElementById('upload-ver-fecha')?.value;
  document.getElementById('upload-preview').style.display = 'block';
  if (!iso) {
    renderPreviewRegistros(AppData.records, 'Vista previa · toda la base (' + AppData.records.length + ' registros)');
    return;
  }
  const dia = isoToDMY(iso);
  const lista = AppData.records.filter(r => r.carga_fecha === dia);
  renderPreviewRegistros(lista, 'Información cargada el ' + dia + ' · ' + lista.length + ' registros');
}

async function clearData() {
  if (!confirm('¿Eliminar todos los datos cargados? Esto también borra los registros guardados en la nube.')) return;
  AppData.records = [];
  AppData.rawHeaders = [];
  AppData.rawRows = [];
  AppData.historialCompleto = false;
  importPendiente = null;
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('file-input').value = '';
  if (window.DB && DB.ready) {
    try { await DB.replaceAll('registros', []); showToast('🗑️ Registros eliminados de la nube'); }
    catch(e) { console.warn('clearData nube:', e); }
  }
  renderDashboard();
}

// ===== CONFIG TARIFAS =====
