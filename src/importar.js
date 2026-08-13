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

// Muestra/actualiza el panel de archivo histórico (solo para analistas).
async function renderArchivoPanel() {
  const panel = document.getElementById('archivo-panel');
  if (!panel) return;
  if (!esAnalista()) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  // Fecha por defecto: hace 6 meses (si el campo está vacío)
  const fInput = document.getElementById('arch-fecha');
  if (fInput && !fInput.value) {
    const d = new Date(); d.setMonth(d.getMonth() - 6);
    fInput.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  if (window.DB && DB.ready) {
    try {
      const [activos, hist] = await Promise.all([
        DB.count('registros'), DB.count('registros_historico')
      ]);
      const a = document.getElementById('arch-count-activos');
      const h = document.getElementById('arch-count-historico');
      if (a) a.textContent = activos.toLocaleString('es-AR');
      if (h) h.textContent = hist.toLocaleString('es-AR');
    } catch (e) { console.warn('renderArchivoPanel:', e); }
  }
}

// Ejecuta el archivado de registros anteriores a la fecha elegida.
async function ejecutarArchivado() {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede archivar'); return; }
  const iso = document.getElementById('arch-fecha')?.value;
  if (!iso) { showToast('Elegí una fecha de corte'); return; }
  const est = document.getElementById('arch-estado');
  if (!confirm('¿Archivar todos los registros ANTERIORES al ' + iso + '?\n\nSe mueven a la tabla histórica (no se borran) y dejan de cargarse en el día a día.')) return;
  if (est) est.textContent = '⏳ Archivando…';
  const movidos = await archivarRegistrosAntesDe(iso);
  if (est) est.textContent = movidos > 0 ? ('✓ ' + movidos + ' archivados') : (movidos === 0 ? 'Sin registros anteriores a esa fecha' : '⚠️ Error');
  renderArchivoPanel();
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

async function processFile(file) {
  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e) { alert('No se pudo leer el archivo.'); return; }

  // Hash del CONTENIDO para bloquear la doble carga del mismo documento.
  const hash = await hashArchivo(buf);
  const dup = (AppData.importaciones || []).find(i => i.hash === hash);
  if (dup) {
    alert('⛔ Este documento ya fue importado.\n\n' +
      'Archivo: ' + (dup.archivo || '—') + '\n' +
      'Cargado el: ' + (dup.fecha_carga || '—') + '\n' +
      'Filas: ' + dup.filas + '\n\n' +
      'No se vuelve a cargar para evitar duplicados. Si necesitás reimportarlo ' +
      '(p. ej. una versión corregida), borralo primero del "Historial de importaciones".');
    const inp = document.getElementById('file-input'); if (inp) inp.value = '';
    return;
  }
  AppData._importPend = { archivo: file.name || 'documento', hash };

  const data = new Uint8Array(buf);
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (json.length < 2) { alert('El archivo no tiene datos suficientes.'); return; }

  AppData.rawHeaders = json[0].map(h => String(h).trim());
  AppData.rawRows = json.slice(1).filter(row => row.some(c => c !== ''));

  showColumnMapper();
}

// SHA-256 del contenido del archivo (hex). Fallback djb2 si no hay crypto.subtle.
async function hashArchivo(buffer) {
  try {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const h = await crypto.subtle.digest('SHA-256', buffer);
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { console.warn('hash subtle falló, uso fallback:', e); }
  const bytes = new Uint8Array(buffer);
  let h = 5381;
  for (let i = 0; i < bytes.length; i++) h = ((h << 5) + h + bytes[i]) >>> 0;
  return 'fb' + bytes.length.toString(16) + '-' + h.toString(16);
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
  { key: 'destinatario', label: 'Destinatario (nombre)', expectedCol: 'M', required: false, keywords: ['destinatario', 'nombre destinatario', 'comprador', 'cliente'] },
  { key: 'direccion', label: 'Dirección (distingue envíos con tracking inválido)', expectedCol: 'R', required: false, keywords: ['direccion', 'dirección', 'domicilio', 'direccion de entrega'] },
  { key: 'fecha', label: 'Fecha', expectedCol: 'G', required: true, keywords: ['fecha'] },
  { key: 'localidad', label: 'Localidad (respaldo si Zona está vacía)', expectedCol: 'T', required: false, keywords: ['localidad'] },
  { key: 'estado', label: 'Estado', expectedCol: 'X', required: true, keywords: ['estado'] },
  { key: 'zona', label: 'Zona', expectedCol: 'AA', required: true, keywords: ['zona'] },
  { key: 'cadete', label: 'Cadete', expectedCol: 'AD', required: true, keywords: ['cadete', 'conductor', 'chofer'] },
  { key: 'cliente', label: 'Cliente (empresa que factura)', expectedCol: 'BZ', required: false, keywords: ['empresa', 'remitente', 'vendedor', 'seller', 'tienda', 'razon social', 'razón social'] },
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

  const parsed = AppData.rawRows.map(row => {
    const rec = {};
    Object.entries(mapping).forEach(([field, colIdx]) => {
      rec[field] = String(row[colIdx] !== undefined ? row[colIdx] : '').trim();
    });
    rec.fecha = normalizaFecha(row[mapping.fecha]);
    rec.carga_fecha = fechaCarga;
    rec.clave = claveRegistro(rec);
    return rec;
  }).filter(r => r.cadete && (r.tracking || r.direccion));

  // Deduplicación DENTRO del archivo por clave: si dos filas comparten clave
  // (ej. 1ra y 2da visita del mismo envío en la misma carga), gana la última.
  const nuevoPorClave = {};
  parsed.forEach(n => { nuevoPorClave[n.clave] = n; });
  const nuevos = Object.values(nuevoPorClave);
  const enArchivoColapsadas = parsed.length - nuevos.length;

  // FUSIÓN con lo ya cargado, por CLAVE (no por tracking a secas):
  //   - Tracking real -> reemplaza por tracking.
  //   - Tracking basura -> reemplaza solo si coincide dirección+destinatario
  //     (misma entrega, ej. 1ra/2da visita); direcciones distintas = envíos
  //     distintos, se conservan los dos.
  // Cada reemplazo queda registrado para auditar con el botón ⚠.
  const resumenReg = (r, carga) =>
    (r.fecha || '—') + ' · ' + (r.estado || '—') + ' · ' + (r.cadete || '—') +
    (r.direccion ? ' · ' + r.direccion : '') +
    (carga ? ' — cargado el ' + carga : '');
  const tipoClave = c => c.startsWith('T:') ? 'tracking real' : c.startsWith('D:') ? 'dirección' : 'huella';
  const clavesExist = new Set(AppData.records.map(claveRegistro));

  const sup = [];
  const restantes = AppData.records.filter(r => {
    const ck = claveRegistro(r);
    const n = nuevoPorClave[ck];
    if (!n) return true;                 // no lo toca esta carga: se conserva
    sup.push({
      clave: (r.tracking || '(sin tracking)') + ' · por ' + tipoClave(ck),
      antes: resumenReg(r, r.carga_fecha),
      despues: resumenReg(n, fechaCarga)
    });
    return false;                        // se reemplaza
  });
  const agregados = nuevos.filter(n => !clavesExist.has(n.clave)).length;
  AppData.records = restantes.concat(nuevos);
  if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
  registrarSuperposiciones('registros', fechaCarga, sup);

  // Registrar esta importación en el historial (solo si vino de un archivo real).
  if (AppData._importPend) {
    const fechasD = nuevos.map(r => parseFechaReg(r.fecha)).filter(Boolean).sort((a, b) => a - b);
    registrarImportacion({
      archivo: AppData._importPend.archivo,
      hash: AppData._importPend.hash,
      fecha_carga: fechaCarga,
      filas: nuevos.length,
      agregados: agregados,
      reemplazados: sup.length,
      fecha_desde: fechasD.length ? dmyDe(fechasD[0]) : '',
      fecha_hasta: fechasD.length ? dmyDe(fechasD[fechasD.length - 1]) : '',
      usuario: (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.nombre || currentUser.usuario || '') : ''
    });
    AppData._importPend = null;
  }

  // Días hábiles (Lun–Sáb) sin registros dentro del rango cargado.
  const faltantesDias = diasFaltantesRecorridos();

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
    (enArchivoColapsadas ? `<br>ℹ️ ${enArchivoColapsadas} fila(s) del archivo eran el mismo envío repetido (mismo tracking o misma dirección) y se unificaron. ` : '') +
    `<strong>${entregados} entregados</strong> (contabilizan) y <strong>${noEntregados} en otros estados</strong>.` +
    `${diasFueraDeRango ? `<br><i class="ic ic-alert"></i> ${diasFueraDeRango} registros con fecha de domingo — la liquidación es de lunes a sábado, revisá si corresponde excluirlos.` : ''}` +
    `${faltantesDias.length ? `<br><i class="ic ic-alert"></i> <strong>Ojo:</strong> ${faltantesDias.length} día(s) hábil(es) sin registros dentro del rango cargado (${faltantesDias.slice(0, 6).map(diaLabel).join(' · ')}${faltantesDias.length > 6 ? '…' : ''}). ¿Te faltó cargar alguna fecha?` : ''}` +
    ` La base total queda en <strong>${AppData.records.length}</strong> registros. <span id="upload-nube-estado">☁️ Guardando en la nube…</span>`;

  renderDashboard();
  renderHistorialImportaciones();

  // Guardado automático QUIRÚRGICO: solo se borran/insertan en la nube los
  // trackings de ESTA carga (no se reescribe la base entera — con ~2.000
  // registros diarios eso no escala). El banner refleja el resultado.
  guardarImportacionEnNube(nuevos).then(ok => {
    const est = document.getElementById('upload-nube-estado');
    if (est) est.innerHTML = ok
      ? '<strong style="color:#166534">☁️✅ Guardado en la nube.</strong>'
      : '<strong style="color:#b91c1c"><i class="ic ic-alert"></i> No se pudo guardar en la nube — usá el botón "Reintentar".</strong>';
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

// ════════════════════════════════════════════════════════════════════════
//  HISTORIAL DE IMPORTACIONES + DÍAS FALTANTES + CONSULTA DE ARCHIVADOS
// ════════════════════════════════════════════════════════════════════════
const DIAS_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function dmyDe(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }
function diaLabel(d) { return DIAS_SEM[d.getDay()] + ' ' + dmyDe(d); }

// Días hábiles (Lun–Sáb) SIN registros dentro del rango de fechas de recorrido
// cargado. La liquidación es de lunes a sábado, así que los domingos no cuentan.
function diasFaltantesRecorridos() {
  let min = null, max = null;
  const set = new Set();
  AppData.records.forEach(r => {
    const f = parseFechaReg(r.fecha);
    if (!f) return;
    set.add(f.getFullYear() + '-' + f.getMonth() + '-' + f.getDate());
    if (!min || f < min) min = f;
    if (!max || f > max) max = f;
  });
  if (!min || !max) return [];
  const faltan = [];
  const d = new Date(min.getFullYear(), min.getMonth(), min.getDate());
  const end = new Date(max.getFullYear(), max.getMonth(), max.getDate());
  for (; d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue; // domingo
    if (!set.has(d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate())) faltan.push(new Date(d));
  }
  return faltan;
}

function persistirImportacionesLocal() {
  try { localStorage.setItem('liq_importaciones', JSON.stringify(AppData.importaciones)); } catch (e) {}
}

// Registra una importación (optimista en memoria + insert en la nube).
async function registrarImportacion(meta) {
  const local = Object.assign({ id: 'tmp-' + Date.now(), created_at: new Date().toISOString() }, meta);
  AppData.importaciones = (AppData.importaciones || []).concat(local);
  persistirImportacionesLocal();
  renderHistorialImportaciones();
  try {
    if (window.DB && DB.ready) {
      const row = await DB.insertRow('importaciones', meta);
      if (row && row.id) { local.id = row.id; local.created_at = row.created_at || local.created_at; persistirImportacionesLocal(); renderHistorialImportaciones(); }
    }
  } catch (e) { console.warn('registrarImportacion nube:', e); }
}

// Etiqueta "día de semana + fecha de carga + hora".
function fmtCargadoLabel(i) {
  let dow = '', hora = '';
  const m = String(i.fecha_carga || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) dow = DIAS_SEM[new Date(+m[3], +m[2] - 1, +m[1]).getDay()] + ' ';
  if (i.created_at) { const dt = new Date(i.created_at); if (!isNaN(dt)) hora = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'); }
  return '<strong>' + dow + (i.fecha_carga || '—') + '</strong>' + (hora ? ' <span class="muted" style="font-size:10px">' + hora + '</span>' : '');
}

function renderHistorialImportaciones() {
  const cont = document.getElementById('hist-imp-rows');
  if (!cont) return;

  // Banner de días faltantes (Lun–Sáb sin registros).
  const banner = document.getElementById('hist-imp-faltantes');
  if (banner) {
    const faltan = diasFaltantesRecorridos();
    if (faltan.length) {
      banner.style.display = '';
      banner.innerHTML = '<i class="ic ic-alert"></i> <strong>' + faltan.length + ' día(s) hábil(es) sin registros</strong> (Lun–Sáb) dentro del rango cargado: ' +
        faltan.slice(0, 14).map(diaLabel).join(' · ') + (faltan.length > 14 ? ' … y ' + (faltan.length - 14) + ' más' : '') +
        '. Revisá si te faltó cargar alguna fecha.';
    } else { banner.style.display = 'none'; }
  }

  const imps = (AppData.importaciones || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const cEl = document.getElementById('hist-imp-count');
  if (cEl) cEl.textContent = imps.length + (imps.length === 1 ? ' importación' : ' importaciones');

  if (!imps.length) {
    cont.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-folder"></i></div><div class="empty-title">Sin importaciones registradas</div><div class="empty-sub">Cargá un documento para verlo acá</div></div></td></tr>';
    return;
  }
  cont.innerHTML = imps.slice(0, 60).map(i => {
    const cubre = (i.fecha_desde && i.fecha_hasta)
      ? (i.fecha_desde === i.fecha_hasta ? i.fecha_desde : i.fecha_desde + ' → ' + i.fecha_hasta) : '—';
    return '<tr>' +
      '<td style="font-size:12px">' + fmtCargadoLabel(i) + '</td>' +
      '<td><strong style="font-size:12px">' + (i.archivo || '—') + '</strong>' + (i.usuario ? '<div class="muted" style="font-size:10px">por ' + i.usuario + '</div>' : '') + '</td>' +
      '<td class="mono" style="text-align:right">' + i.filas + '</td>' +
      '<td class="mono" style="text-align:right;color:#166534">+' + i.agregados + '</td>' +
      '<td class="mono" style="text-align:right;color:#92400e">' + i.reemplazados + '</td>' +
      '<td style="font-size:11px">' + cubre + '</td>' +
      '<td style="text-align:right"><button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c;padding:3px 7px" title="Quitar del historial (no borra registros; libera el bloqueo para reimportar)" onclick="eliminarImportacion(\'' + i.id + '\')"><i class="ic ic-trash"></i></button></td>' +
    '</tr>';
  }).join('');
}

// Quita una importación del historial: NO borra los registros ya cargados,
// solo libera el bloqueo (hash) para poder volver a importar ese documento.
async function eliminarImportacion(id) {
  const imp = (AppData.importaciones || []).find(x => String(x.id) === String(id));
  if (!imp) return;
  if (!confirm('¿Borrar del historial la importación "' + (imp.archivo || '') + '" (' + (imp.fecha_carga || '') + ')?\n\n' +
    'OJO: NO borra los registros ya cargados. Solo quita esta fila del historial y libera el bloqueo para poder reimportar ese documento.')) return;
  try {
    if (window.DB && DB.ready && typeof imp.id === 'number') await DB.deleteWhere('importaciones', 'id', imp.id);
    AppData.importaciones = AppData.importaciones.filter(x => String(x.id) !== String(id));
    persistirImportacionesLocal();
    renderHistorialImportaciones();
    showToast('🗑 Importación quitada del historial');
  } catch (e) { console.warn('eliminarImportacion', e); showToast('⛔ No se pudo borrar'); }
}

// ── Consulta de registros archivados por fecha (panel Archivo) ──────────────
async function consultarArchivados() {
  if (!(window.DB && DB.ready)) { showToast('Sin conexión con la nube'); return; }
  const desde = document.getElementById('arch-desde')?.value || '';
  const hasta = document.getElementById('arch-hasta')?.value || '';
  const cont = document.getElementById('arch-consulta-result');
  if (cont) cont.innerHTML = '<div class="muted" style="padding:10px">⏳ Buscando en el archivo…</div>';
  try {
    const rows = await DB.selectHistoricoRango(desde || null, hasta || null);
    renderArchivadosResult(rows);
  } catch (e) {
    console.warn('consultarArchivados', e);
    if (cont) cont.innerHTML = '<div style="color:#b91c1c;padding:10px">No se pudo consultar: ' + (e.message || e) + '</div>';
  }
}
function renderArchivadosResult(rows) {
  const cont = document.getElementById('arch-consulta-result');
  if (!cont) return;
  if (!rows.length) { cont.innerHTML = '<div class="muted" style="padding:10px">No hay registros archivados en ese rango.</div>'; return; }
  const body = rows.slice(0, 200).map(r =>
    '<tr><td class="mono muted">' + (r.tracking || '') + '</td><td class="muted">' + (r.fecha || '—') + '</td><td>' + (r.zona || r.localidad || '—') + '</td><td>' + (r.estado || '—') + '</td><td><strong>' + (r.cadete || '') + '</strong></td></tr>').join('');
  cont.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Tracking</th><th>Fecha</th><th>Zona</th><th>Estado</th><th>Cadete</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
    (rows.length > 200 ? '<div class="muted" style="text-align:center;padding:8px">…y ' + (rows.length - 200) + ' más (' + rows.length + ' archivados en el rango)</div>' : '<div class="muted" style="padding:6px">' + rows.length + ' registros archivados en el rango</div>');
}

// ===== CONFIG TARIFAS =====
