// ===== CONFIG TARIFAS =====
// El tarifario por zona se actualiza (aprox. cada 30 días) descargando una
// plantilla Excel, completando los valores y volviéndola a subir. Ya NO se
// edita a mano desde el panel.

const TARIFAS_CATEGORIAS = ['Muy cerca', 'Cerca', 'Intermedio', 'Lejos', 'Muy Lejos'];
const PLANTILLA_TARIFAS_HEADERS = ['Zona', 'Categoría', 'S/ Colecta', 'C/ Colecta', 'SLA Cumplido'];

function renderTarifas() {
  if (typeof invalidarIndiceTarifas === 'function') invalidarIndiceTarifas(); // por si se editaron tarifas
  actualizarBotonSuperposiciones('tarifas');
  const cont = document.getElementById('tarifas-rows');
  if (!cont) return;

  // Buscador por zona o categoría.
  const q = (document.getElementById('tarifas-search')?.value || '').toLowerCase().trim();
  const lista = q
    ? AppData.tarifas.filter(t =>
        String(t.zona).toLowerCase().includes(q) ||
        String(t.categoria || '').toLowerCase().includes(q))
    : AppData.tarifas;

  const countEl = document.getElementById('tarifas-count');
  if (countEl) countEl.textContent = lista.length + ' de ' + AppData.tarifas.length + ' zonas';

  const filas = lista.map(t => `
    <div style="display:grid;grid-template-columns:2fr 1fr 110px 110px 110px;gap:0;padding:9px 16px;border-bottom:1px solid var(--border);align-items:center;font-size:13px">
      <span style="font-weight:500">${t.zona}</span>
      <span style="font-size:12px;color:var(--text-secondary)">${t.categoria || '—'}</span>
      <span style="text-align:right">${fmtPeso(t.s_colecta)}</span>
      <span style="text-align:right">${fmtPeso(t.c_colecta)}</span>
      <span style="text-align:right">${fmtPeso(t.sla)}</span>
    </div>`).join('');

  cont.innerHTML = filas || (q
    ? '<div style="padding:28px;text-align:center;color:var(--text-muted)"><i class="ic ic-search"></i> Ninguna zona coincide con “' + q + '”.</div>'
    : '<div style="padding:28px;text-align:center;color:var(--text-muted)">Sin tarifas cargadas. Descargá la plantilla, completala y subila.</div>');
}

function saveTarifas() {
  localStorage.setItem('liq_tarifas', JSON.stringify(AppData.tarifas));
  dbPush('tarifas');
}

// Descarga una plantilla Excel prellenada con las zonas y valores actuales,
// para que el usuario solo actualice los precios.
function descargarPlantillaTarifas() {
  const zonas = [...AppData.tarifas].sort((a, b) =>
    String(a.zona).localeCompare(String(b.zona)));
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Actualizá solo los valores (S/ Colecta, C/ Colecta, SLA) a partir de la fila 3. Podés cambiar la Categoría si corresponde. No borres la columna Zona ni dejes filas vacías entre datos.'],
    PLANTILLA_TARIFAS_HEADERS,
    ...zonas.map(t => [
      t.zona,
      t.categoria || '',
      Number(t.s_colecta) || 0,
      Number(t.c_colecta) || 0,
      Number(t.sla) || 0,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  ws['!rows'] = [{ hpx: 42 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  // Fija la fila de encabezados al desplazarse.
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tarifas');
  XLSX.writeFile(wb, 'Plantilla_Tarifas_Zonas.xlsx');
  showToast('📥 Plantilla descargada — actualizá los valores y volvé a subirla');
}

// Interpreta un valor de precio (soporta números o texto con separadores es-AR).
// Devuelve null si la celda está vacía (para no pisar el valor actual).
function parseTarifaMoneda(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s === '') return null;
  if (s.includes(',')) {
    // Coma decimal (es-AR): los puntos son separadores de miles.
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = s.split('.');
    // Sólo puntos y el último grupo tiene 3 dígitos → separador de miles.
    if (parts.length > 1 && parts[parts.length - 1].length === 3) s = parts.join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Lee la plantilla completada y actualiza el tarifario (por nombre de zona).
function importTarifas(event) {
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

      // Ubicar la fila de encabezados: una celda debe SER exactamente "Zona".
      // (La fila de instrucciones menciona la palabra "zona", así que buscar por
      //  "incluye" la confundía con el encabezado real. Exigimos igualdad exacta.)
      const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
      let hIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 8); r++) {
        if (rows[r].map(norm).includes('zona')) { hIdx = r; break; }
      }
      if (hIdx < 0) {
        alert('No se encontró la fila de encabezados (debe existir una columna llamada exactamente "Zona").\n\nDescargá la plantilla oficial para usar la estructura correcta.');
        return;
      }

      const header = rows[hIdx].map(norm);
      const col = {
        zona:      header.findIndex(h => h.includes('zona')),
        categoria: header.findIndex(h => h.includes('categor')),
        s:         header.findIndex(h => h.includes('scolecta') || h.includes('sincolecta')),
        c:         header.findIndex(h => h.includes('ccolecta') || h.includes('concolecta')),
        sla:       header.findIndex(h => h.includes('sla')),
      };
      if (col.zona < 0) { alert('No se encontró la columna "Zona" en los encabezados.'); return; }

      const validCat = c => TARIFAS_CATEGORIAS.find(
        x => x.toLowerCase() === String(c).toLowerCase().trim()) || null;

      const mapExist = {};
      AppData.tarifas.forEach((t, i) => { mapExist[String(t.zona).toUpperCase().trim()] = i; });

      const resumenTarifa = t =>
        (t.categoria || '—') + ' · S/C ' + fmtPeso(t.s_colecta) + ' · C/C ' + fmtPeso(t.c_colecta) + ' · SLA ' + fmtPeso(t.sla);

      let actualizados = 0, agregados = 0;
      const sup = []; // zonas cuyos valores fueron reemplazados por la carga
      for (let i = hIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const zona = String(r[col.zona] || '').trim().toUpperCase();
        // 'ZONA' y compañía son el encabezado repetido, no una zona.
        if (!zona || !esZonaValida(zona)) continue;
        const s   = col.s   >= 0 ? parseTarifaMoneda(r[col.s])   : null;
        const c   = col.c   >= 0 ? parseTarifaMoneda(r[col.c])   : null;
        const sla = col.sla >= 0 ? parseTarifaMoneda(r[col.sla]) : null;
        const cat = col.categoria >= 0 ? validCat(r[col.categoria]) : null;

        if (mapExist[zona] !== undefined) {
          const t = AppData.tarifas[mapExist[zona]];
          const antes = resumenTarifa(t);
          if (s   != null) t.s_colecta = s;
          if (c   != null) t.c_colecta = c;
          if (sla != null) t.sla = sla;
          if (cat) t.categoria = cat;
          const despues = resumenTarifa(t);
          if (antes !== despues) sup.push({ clave: zona, antes, despues });
          actualizados++;
        } else {
          AppData.tarifas.push({
            zona, categoria: cat || 'Intermedio',
            s_colecta: s || 0, c_colecta: c || 0, sla: sla || 0,
          });
          agregados++;
        }
      }

      if (!actualizados && !agregados) { alert('No se encontraron zonas válidas para importar.'); return; }

      registrarSuperposiciones('tarifas', isoToDMY(hoyISO()), sup);
      AppData.tarifas.sort((a, b) => String(a.zona).localeCompare(String(b.zona)));
      saveTarifas();
      renderTarifas();
      showToast('✅ Tarifario actualizado: ' + sup.length + ' zonas cambiaron de valor · ' + agregados + ' nuevas' +
        (sup.length ? ' — revisá el botón ⚠' : ''));
    } catch (err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULADOR DE AJUSTE DE TARIFAS
// ═══════════════════════════════════════════════════════════════════════════
// Trasladar un aumento al tarifario es la decisión de plata más grande que se
// toma en la app: mueve las 73 zonas, los dos tarifarios (el general y el Super
// SLA) y se paga todas las semanas. El circuito era bajar la planilla, escribir
// los precios nuevos y subirla — o sea que el costo recién se veía en la
// liquidación siguiente, con el aumento YA aplicado y nada que hacer al
// respecto. El simulador contesta antes la única pregunta que importa: cuánto
// más se va a pagar.
//
// Dos decisiones que lo sostienen:
//
// 1) **Se mide con la MISMA cuenta que paga** (`calcLiquidaciones`): se le pone
//    delante un tarifario hipotético, se mide y se vuelve atrás. Reimplementar
//    el cálculo acá habría dado un número parecido al de la liquidación sin ser
//    el mismo, que es exactamente cómo estos dos números terminan discrepando.
//    Por eso el Super SLA entra solo: la cuenta que paga ya lo contempla.
//
// 2) **La banda de distancia NO se inventa**: es la `categoria` que cada zona ya
//    tiene en el tarifario (Muy cerca · Cerca · Intermedio · Lejos · Muy Lejos).
//    Una segunda clasificación de lo mismo se desincroniza con la primera.

const SIM_SIN_CAT = 'Sin categoría';
const SIM_GRUPOS = TARIFAS_CATEGORIAS.concat([SIM_SIN_CAT]);
const SIM_CAMPOS_TARIFA = ['s_colecta', 'c_colecta', 'sla'];
const SIM_CAMPOS_LABEL = { s_colecta: 'S/ Colecta', c_colecta: 'C/ Colecta', sla: 'SLA Cumpl.' };
const SIM_REDONDEOS = [1, 10, 50, 100];
const SIM_MES_ID = 'tarsim';          // id del navegador de mes compartido

let _simTar = null;       // estado del simulador (sobrevive al cierre del modal)
let _simBase = null;      // medición del período con las tarifas de HOY (caché)
let _simDebounce = null;

function _simKey(z) {
  return typeof normNombre === 'function' ? normNombre(z) : String(z || '').toUpperCase().trim();
}
function _simCanon(z) {
  return _simKey(typeof zonaCanonica === 'function' ? zonaCanonica(z) : z);
}

// La categoría cargada en el tarifario, normalizada contra la lista oficial.
// Lo que no coincide con ninguna cae en "Sin categoría", que NO se esconde: son
// zonas que se pagan igual y tienen que poder entrar en el ajuste.
function _simGrupoDeCat(cat) {
  const c = String(cat || '').trim().toLowerCase();
  return TARIFAS_CATEGORIAS.find(g => g.toLowerCase() === c) || SIM_SIN_CAT;
}

// zona (normalizada y canónica) → banda de distancia. Se guardan las DOS claves
// —la del tarifario tal cual y la canónica— porque el envío resuelve su zona por
// alias antes de buscar la tarifa, igual que getPrecio.
function _simMapaGrupos() {
  const m = new Map();
  (AppData.tarifas || []).forEach(t => {
    const g = _simGrupoDeCat(t.categoria);
    m.set(_simKey(t.zona), g);
    const c = _simCanon(t.zona);
    if (!m.has(c)) m.set(c, g);
  });
  return m;
}

function _simZonasPorGrupo() {
  const m = new Map();
  SIM_GRUPOS.forEach(g => m.set(g, []));
  (AppData.tarifas || []).forEach(t => {
    const z = String(t.zona || '').trim().toUpperCase();
    if (!z) return;
    if (typeof esZonaValida === 'function' && !esZonaValida(z)) return;
    m.get(_simGrupoDeCat(t.categoria)).push(t);
  });
  m.forEach(arr => arr.sort((a, b) => String(a.zona).localeCompare(String(b.zona))));
  return m;
}

function _simReglasSLA() {
  return (AppData.superSLA || []).filter(r => String(r.zona || '').trim());
}
function _simConductoresSLA() {
  return Array.from(new Set(_simReglasSLA().map(r => String(r.conductor || '').toUpperCase().trim())))
    .filter(Boolean).sort();
}

// ── Estado ────────────────────────────────────────────────────────────────
// Vive fuera del DOM: el modal se re-dibuja entero en cada cambio. Entre dos
// aperturas el tarifario puede haber cambiado, así que las zonas que ya no
// existen salen de la selección (si no quedarían tildadas en el aire) y las
// nuevas entran tildadas como el resto.
function _simEstado() {
  const vivas = new Set();
  _simZonasPorGrupo().forEach(arr => arr.forEach(t => vivas.add(_simKey(t.zona))));
  const condSLA = new Set(_simConductoresSLA().map(_simKey));

  if (_simTar) {
    vivas.forEach(k => { if (!_simTar.conocidas.has(k)) _simTar.zonas.add(k); });
    _simTar.zonas = new Set(Array.from(_simTar.zonas).filter(k => vivas.has(k)));
    _simTar.conocidas = vivas;
    condSLA.forEach(k => { if (!_simTar.condConocidos.has(k)) _simTar.slaCond.add(k); });
    _simTar.slaCond = new Set(Array.from(_simTar.slaCond).filter(k => condSLA.has(k)));
    _simTar.condConocidos = condSLA;
    return _simTar;
  }

  const porGrupo = {};
  SIM_GRUPOS.forEach(g => { porGrupo[g] = 0; });
  // Todo tildado y todos los valores en CERO: abrir el simulador no propone
  // ningún aumento, así que no hay forma de aplicar algo sin haberlo escrito.
  _simTar = {
    modo: 'pct',
    porGrupo,
    redondeo: 10,
    zonas: new Set(vivas),
    conocidas: vivas,
    ajustarSLA: true,
    slaCond: new Set(condSLA),
    condConocidos: condSLA,
    abiertos: new Set(),
    verSLA: false,
  };
  return _simTar;
}

// ── La cuenta ─────────────────────────────────────────────────────────────
// Un precio en $0 NO es una tarifa: es la zona que todavía no tiene valor
// cargado. Sumarle un monto fijo le inventaría un precio que nadie acordó, así
// que se deja como está — mismo criterio que `dimensionAsignada` con las filas
// en $0 del catálogo.
function _simPrecioNuevo(precio, grupo, st) {
  const p = _num(precio);
  if (!(p > 0)) return p;
  const v = _num(st.porGrupo[grupo]);
  if (!v) return p;
  const bruto = st.modo === 'pct' ? p * (1 + v / 100) : p + v;
  return Math.max(0, _simRedondear(bruto, st.redondeo));
}

// El redondeo es parte de la SIMULACIÓN, no un detalle de presentación: si se
// simulara con $3.118,50 y se aplicara $3.120, lo medido y lo pagado no serían
// el mismo número.
function _simRedondear(n, paso) {
  const p = _num(paso) || 1;
  return p <= 1 ? Math.round(n) : Math.round(n / p) * p;
}

function _simTarifasSimuladas(st) {
  return (AppData.tarifas || []).map(t => {
    if (!st.zonas.has(_simKey(t.zona))) return t;
    const g = _simGrupoDeCat(t.categoria);
    const n = Object.assign({}, t);
    SIM_CAMPOS_TARIFA.forEach(k => { n[k] = _simPrecioNuevo(t[k], g, st); });
    return n;
  });
}

// El precio Super SLA se mueve con la banda de SU zona —es la misma distancia—
// pero lo gobierna el tilde del CONDUCTOR, no el de la zona: son dos tarifarios
// distintos y acoplarlos escondería que uno se movió y el otro no.
function _simSuperSLASimulado(st, mapa) {
  const base = AppData.superSLA || [];
  if (!st.ajustarSLA) return base;
  return base.map(r => {
    if (!st.slaCond.has(_simKey(r.conductor))) return r;
    const g = mapa.get(_simCanon(r.zona)) || mapa.get(_simKey(r.zona)) || SIM_SIN_CAT;
    const actual = _num(r.precio != null ? r.precio : r.sla);
    const n = Object.assign({}, r);
    n.precio = _simPrecioNuevo(actual, g, st);
    return n;
  });
}

// Mide un tarifario hipotético con la cuenta que paga. El swap vive dentro de
// una función SÍNCRONA y se deshace en el `finally`; la sincronización en vivo
// no corre con un modal abierto y el índice de precios se invalida a la ida y a
// la vuelta, así que nada de esto puede llegar a la nube ni quedar en pantalla.
function _simMedir(records, tarifas, superSLA) {
  const prevT = AppData.tarifas, prevS = AppData.superSLA;
  try {
    AppData.tarifas = tarifas;
    AppData.superSLA = superSLA;
    if (typeof invalidarIndiceTarifas === 'function') invalidarIndiceTarifas();
    return _simResumen(calcLiquidaciones(records));
  } finally {
    AppData.tarifas = prevT;
    AppData.superSLA = prevS;
    if (typeof invalidarIndiceTarifas === 'function') invalidarIndiceTarifas();
  }
}

function _simResumen(liq) {
  const out = {
    total: 0, envios: 0, porZona: new Map(), porCond: new Map(),
    fijosEnvios: 0, fijosTotal: 0,     // precio a mano o dimensión: el tarifario no los toca
    superEnvios: 0, superTotal: 0,     // cobran por una regla Super SLA
    sinTarifa: 0,
  };
  Object.keys(liq).forEach(cond => {
    const d = liq[cond];
    let tot = 0;
    d.filas.forEach(f => {
      const p = _num(f.subtotal);
      out.total += p; out.envios++; tot += p;
      const zk = _simCanon(f.zona);
      let z = out.porZona.get(zk);
      if (!z) { z = { zona: String(f.zona || '').trim() || '(sin zona)', envios: 0, total: 0, fijos: 0, fijosTotal: 0 }; out.porZona.set(zk, z); }
      z.envios++; z.total += p;
      if (f.tipo === 'manual' || f.es_dim_especial) {
        out.fijosEnvios++; out.fijosTotal += p;
        z.fijos++; z.fijosTotal += p;
      }
      if (f.es_super) { out.superEnvios++; out.superTotal += p; }
      if (f.sin_tarifa) out.sinTarifa++;
    });
    out.porCond.set(cond, { cond, envios: d.filas.length, total: tot });
  });
  return out;
}

function _simComparar(base, sim, mapa) {
  const keys = new Set();
  base.porZona.forEach((_, k) => keys.add(k));
  sim.porZona.forEach((_, k) => keys.add(k));
  const filas = [];
  const porGrupo = new Map();
  SIM_GRUPOS.forEach(g => porGrupo.set(g, { envios: 0, hoy: 0, nuevo: 0, fijos: 0, fijosTotal: 0 }));
  keys.forEach(k => {
    const b = base.porZona.get(k) || { zona: '', envios: 0, total: 0, fijos: 0, fijosTotal: 0 };
    const s = sim.porZona.get(k) || { zona: b.zona, envios: 0, total: 0 };
    const g = mapa.get(k) || SIM_SIN_CAT;
    filas.push({ zona: b.zona || s.zona, grupo: g, envios: b.envios, hoy: b.total, nuevo: s.total,
                 delta: s.total - b.total, fijos: b.fijos || 0, fijosTotal: b.fijosTotal || 0 });
    const acc = porGrupo.get(g);
    acc.envios += b.envios; acc.hoy += b.total; acc.nuevo += s.total;
    acc.fijos += (b.fijos || 0); acc.fijosTotal += (b.fijosTotal || 0);
  });
  filas.sort((a, b2) => (b2.delta - a.delta) || (b2.hoy - a.hoy));

  const conds = [];
  base.porCond.forEach((b, k) => {
    const s = sim.porCond.get(k);
    const nuevo = s ? s.total : b.total;
    if (nuevo !== b.total) conds.push({ cond: b.cond, envios: b.envios, hoy: b.total, nuevo, delta: nuevo - b.total });
  });
  conds.sort((a, b2) => b2.delta - a.delta);
  return { filas, porGrupo, conds };
}

// ── Período medido ────────────────────────────────────────────────────────
function _simRecordsDelMes(mes) {
  const base = AppData.records || [];
  if (!mes) return base;
  return base.filter(r => String(dmyToISO(r.fecha) || '').slice(0, 7) === mes);
}
function _simRangoFechas(records) {
  let min = '', max = '';
  records.forEach(r => {
    if (!contabilizaRegistro(r)) return;
    const iso = dmyToISO(r.fecha);
    if (!iso) return;
    if (!min || iso < min) min = iso;
    if (!max || iso > max) max = iso;
  });
  return { min, max };
}

// ── Abrir / cerrar ────────────────────────────────────────────────────────
function abrirSimuladorTarifas() {
  const fresco = !_simTar;
  _simEstado();
  _simBase = null;
  const cont = document.getElementById('modal-content');
  if (cont) cont.classList.add('modal-ancho');
  const tit = document.getElementById('modal-title');
  if (tit) tit.textContent = 'Simulador de ajuste de tarifas';
  const body = document.getElementById('modal-body');
  if (body) body.innerHTML = '<div id="simtar-wrap"></div>';
  document.getElementById('modal-backdrop').classList.add('open');
  // El mes arranca en el CORRIENTE y no en el último cerrado: la app carga por
  // defecto los últimos 14 días, así que un mes anterior daría casi cero envíos
  // y el simulador parecería roto. Lo que se mide se rotula abajo, con fechas.
  if (fresco) panelElegirMes(SIM_MES_ID, _simMesDefecto());
  else renderSimTarifas();
}
function _simMesDefecto() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── Render ────────────────────────────────────────────────────────────────
function renderSimTarifas() {
  const wrap = document.getElementById('simtar-wrap');
  if (!wrap) return;                       // el modal no está abierto
  const caja = document.getElementById('modal-content');
  const scrollPrevio = caja ? caja.scrollTop : 0;
  const st = _simEstado();
  const mes = _panelMesActivo(SIM_MES_ID) || _simMesDefecto();
  const porGrupo = _simZonasPorGrupo();
  const totalZonas = Array.from(porGrupo.values()).reduce((s, a) => s + a.length, 0);
  const puedeSLA = typeof puedeEditarSuperSLA === 'function' ? puedeEditarSuperSLA() : true;
  const reglas = _simReglasSLA();
  const marcadasTot = Array.from(porGrupo.values())
    .reduce((s, arr) => s + arr.filter(t => st.zonas.has(_simKey(t.zona))).length, 0);

  const unidad = st.modo === 'pct' ? '%' : '$';
  const btn = (on, label, fn, extra) =>
    '<button class="btn btn-sm' + (on ? ' active' : '') + '" onclick="' + fn + '"' +
    (extra ? ' ' + extra : '') + '>' + label + '</button>';

  wrap.innerHTML =
    // 1 · Qué período se mide
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
      '<span style="font-size:13px;font-weight:600;color:var(--text-secondary)"><i class="ic ic-calendar"></i> Medir sobre</span>' +
      '<div class="date-range" id="' + SIM_MES_ID + '-mes-nav">' +
        '<button class="btn btn-sm" onclick="panelMoverMes(\'' + SIM_MES_ID + '\',-1)" title="Mes anterior" aria-label="Mes anterior">&lsaquo;</button>' +
        '<input type="month" id="' + SIM_MES_ID + '-mes" onchange="panelElegirMes(\'' + SIM_MES_ID + '\',this.value)" aria-label="Mes a medir">' +
        '<button class="btn btn-sm" onclick="panelMoverMes(\'' + SIM_MES_ID + '\',1)" title="Mes siguiente" aria-label="Mes siguiente">&rsaquo;</button>' +
      '</div>' +
      '<span style="font-size:12px;color:var(--text-muted)">los envíos ya pagados de ese mes, con la misma cuenta que arma las liquidaciones</span>' +
    '</div>' +

    // 2 · El resultado, arriba: es la respuesta
    '<div id="simtar-resultado"></div>' +

    // 3 · Los controles
    '<div class="card" id="simtar-ancla" style="margin-top:16px">' +
      '<div class="card-header"><span class="card-title"><i class="ic ic-sliders"></i> El ajuste</span>' +
        '<span style="font-size:11px;color:var(--text-muted)">' + marcadasTot + ' de ' + totalZonas + ' zonas tildadas</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<span style="font-size:12px;color:var(--text-muted)">Ajustar por</span>' +
            btn(st.modo === 'pct', 'Porcentaje', 'simSetModo(\'pct\')') +
            btn(st.modo === 'monto', 'Monto fijo', 'simSetModo(\'monto\')') +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<span style="font-size:12px;color:var(--text-muted)">Redondear a</span>' +
            SIM_REDONDEOS.map(p => btn(_num(st.redondeo) === p, '$' + p, 'simSetRedondeo(' + p + ')')).join('') +
          '</div>' +
          '<div style="margin-left:auto;display:flex;gap:6px">' +
            '<button class="btn btn-sm" onclick="simTildarTodas(true)">Tildar todas</button>' +
            '<button class="btn btn-sm" onclick="simTildarTodas(false)">Ninguna</button>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:12px">' +
          'La banda de distancia de cada zona es la <strong>categoría que ya tiene en el tarifario</strong>. ' +
          'El ajuste se aplica a las <strong>tres columnas</strong> de la zona (S/ Colecta, C/ Colecta y SLA Cumplido), ' +
          'y una zona en $0 no se toca: todavía no tiene precio acordado.' +
        '</div>' +
        '<div data-simgrupos>' + _simBloqueGrupos(st, porGrupo, unidad) + '</div>' +
      '</div>' +
    '</div>' +

    // 4 · Super SLA
    _simBloqueSuperSLA(st, reglas, puedeSLA) +

    // 5 · Aplicar
    '<div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">' +
      '<span id="simtar-aplicar-nota" style="font-size:12px;color:var(--text-muted);margin-right:auto"></span>' +
      '<button class="btn" onclick="closeModal()">Cerrar</button>' +
      '<button class="btn btn-primary" onclick="simAplicarTarifas()"><i class="ic ic-save"></i> Aplicar al tarifario</button>' +
    '</div>';

  _pintarPanelMes(SIM_MES_ID);
  const inp = document.getElementById(SIM_MES_ID + '-mes');
  if (inp && !inp.value) inp.value = mes;
  _simPintarResultado();
  if (caja && scrollPrevio) caja.scrollTop = scrollPrevio;
}

function _simFilaZona(st, g, t) {
  const k = _simKey(t.zona);
  const on = st.zonas.has(k);
  const celdas = SIM_CAMPOS_TARIFA.map(c => {
    const antes = _num(t[c]);
    const desp = on ? _simPrecioNuevo(antes, g, st) : antes;
    return '<span style="text-align:right;font-variant-numeric:tabular-nums">' + fmtPeso(antes) +
      (desp !== antes ? '<br><b style="color:var(--success,#15803d);font-size:11px">' + fmtPeso(desp) + '</b>' : '') +
      '</span>';
  }).join('');
  return '<div style="display:grid;grid-template-columns:24px 1fr 92px 92px 92px;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid var(--border);font-size:12.5px">' +
    '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="simToggleZona(\'' + jsAttr(k) + '\',this.checked)" aria-label="' + jsAttr(t.zona) + '">' +
    '<span style="' + (on ? '' : 'opacity:.5') + '">' + t.zona + '</span>' + celdas +
  '</div>';
}

function _simBloqueGrupos(st, porGrupo, unidad) {
  return SIM_GRUPOS.map(g => {
    const zonas = porGrupo.get(g) || [];
    if (!zonas.length) return '';
    const marcadas = zonas.filter(t => st.zonas.has(_simKey(t.zona))).length;
    const abierto = st.abiertos.has(g);
    const val = _num(st.porGrupo[g]);
    const ga = jsAttr(g);
    const filas = abierto ? zonas.map(t => _simFilaZona(st, g, t)).join('') : '';

    return '<div style="border:1px solid var(--border);border-radius:9px;margin-bottom:8px;overflow:hidden">' +
      '<div style="display:flex;gap:10px;align-items:center;padding:9px 10px;background:var(--surface-0);flex-wrap:wrap">' +
        '<button class="btn btn-sm" style="padding:2px 8px" onclick="simToggleGrupo(\'' + ga + '\')" title="Ver las zonas">' + (abierto ? '▾' : '▸') + '</button>' +
        '<span style="font-size:13px;font-weight:600;min-width:112px">' + g + '</span>' +
        '<span style="font-size:11px;color:var(--text-muted)">' + marcadas + ' de ' + zonas.length + ' zonas</span>' +
        '<div style="display:flex;gap:4px;align-items:center;margin-left:auto">' +
          '<input type="number" step="any" value="' + (val || '') + '" placeholder="0" ' +
            'oninput="simSetGrupo(\'' + ga + '\',this.value)" ' +
            'style="width:78px;padding:5px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;text-align:right;font-variant-numeric:tabular-nums">' +
          '<span style="font-size:12px;color:var(--text-muted);width:14px">' + unidad + '</span>' +
          '<button class="btn btn-sm" style="padding:2px 7px;font-size:11px" onclick="simTildarGrupo(\'' + ga + '\',true)">Todos</button>' +
          '<button class="btn btn-sm" style="padding:2px 7px;font-size:11px" onclick="simTildarGrupo(\'' + ga + '\',false)">Ninguno</button>' +
        '</div>' +
      '</div>' +
      '<div id="simtar-filas-' + SIM_GRUPOS.indexOf(g) + '">' +
        (abierto ? '<div style="display:grid;grid-template-columns:24px 1fr 92px 92px 92px;gap:8px;padding:5px 10px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;border-top:1px solid var(--border)">' +
          '<span></span><span>Zona</span>' + SIM_CAMPOS_TARIFA.map(c => '<span style="text-align:right">' + SIM_CAMPOS_LABEL[c] + '</span>').join('') +
        '</div>' : '') +
        filas +
      '</div>' +
    '</div>';
  }).join('');
}

// Las filas de UNA banda, sin su cabecera. Es lo único que cambia al tipear.
function _simFilasGrupo(st, g, zonas) {
  if (!st.abiertos.has(g)) return '';
  const encabezado = '<div style="display:grid;grid-template-columns:24px 1fr 92px 92px 92px;gap:8px;padding:5px 10px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;border-top:1px solid var(--border)">' +
    '<span></span><span>Zona</span>' + SIM_CAMPOS_TARIFA.map(c => '<span style="text-align:right">' + SIM_CAMPOS_LABEL[c] + '</span>').join('') +
  '</div>';
  return encabezado + zonas.map(t => _simFilaZona(st, g, t)).join('');
}

function _simBloqueSuperSLA(st, reglas, puedeSLA) {
  if (!reglas.length) {
    return '<div class="card" style="margin-top:14px"><div class="card-body" style="font-size:12.5px;color:var(--text-secondary)">' +
      '<i class="ic ic-star"></i> No hay reglas de <strong>Super SLA</strong> cargadas, así que el ajuste solo mueve el tarifario general.' +
      '</div></div>';
  }
  const porCond = new Map();
  reglas.forEach(r => {
    const k = _simKey(r.conductor);
    if (!porCond.has(k)) porCond.set(k, { nombre: String(r.conductor || '').toUpperCase().trim(), reglas: [] });
    porCond.get(k).reglas.push(r);
  });
  const marcados = Array.from(porCond.keys()).filter(k => st.slaCond.has(k)).length;

  const lista = st.verSLA ? Array.from(porCond.entries()).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre)).map(([k, c]) => {
    const on = st.slaCond.has(k);
    return '<div style="display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid var(--border);font-size:12.5px">' +
      '<input type="checkbox" ' + (on ? 'checked' : '') + (st.ajustarSLA && puedeSLA ? '' : ' disabled') +
        ' onchange="simToggleSLACond(\'' + jsAttr(k) + '\',this.checked)" aria-label="' + jsAttr(c.nombre) + '">' +
      '<span style="' + (on && st.ajustarSLA ? '' : 'opacity:.5') + '">' + c.nombre + '</span>' +
      '<span style="font-size:11px;color:var(--text-muted)">' + c.reglas.length + ' zona' + (c.reglas.length === 1 ? '' : 's') + '</span>' +
    '</div>';
  }).join('') : '';

  return '<div class="card" style="margin-top:14px">' +
    '<div class="card-header"><span class="card-title"><i class="ic ic-star"></i> Tarifas Super SLA</span>' +
      '<span style="font-size:11px;color:var(--text-muted)">' + marcados + ' de ' + porCond.size + ' conductores</span>' +
    '</div>' +
    '<div class="card-body">' +
      (puedeSLA ? '' :
        '<div class="alert" style="background:#fef9c3;border:1px solid #f5d97a;color:#854d0e;font-size:12.5px;margin-bottom:10px">' +
        '<div><i class="ic ic-lock"></i> El precio de Super SLA está <strong>bloqueado</strong> para tu rol: se puede <strong>simular</strong>, pero al aplicar solo se escribe el tarifario general. ' +
        'Un supervisor o analista tiene que aplicar esta parte, o los conductores Super SLA se quedan sin el aumento.</div></div>') +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;margin-bottom:8px">' +
        '<input type="checkbox" ' + (st.ajustarSLA ? 'checked' : '') + ' onchange="simToggleSLA(this.checked)">' +
        '<span>Ajustar también las tarifas Super SLA</span>' +
      '</label>' +
      '<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px">' +
        'Cada precio especial se mueve con la banda de <strong>su</strong> zona. Si se deja sin ajustar, esos conductores cobran lo mismo que hoy en sus zonas especiales mientras el resto sube — a veces es lo que se quiere (el acuerdo ya está cerrado aparte) y a veces es un olvido, por eso está a la vista.' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" onclick="simVerSLA()">' + (st.verSLA ? 'Ocultar conductores' : 'Ver conductores') + '</button>' +
        (st.verSLA ? '<button class="btn btn-sm" onclick="simTildarSLA(true)">Tildar todos</button>' +
                     '<button class="btn btn-sm" onclick="simTildarSLA(false)">Ninguno</button>' : '') +
      '</div>' +
      (st.verSLA ? '<div style="margin-top:8px;border:1px solid var(--border);border-radius:9px;overflow:hidden">' + lista + '</div>' : '') +
    '</div>' +
  '</div>';
}

// ── El resultado ──────────────────────────────────────────────────────────
function _simPintarResultado(anclar) {
  const cont = document.getElementById('simtar-resultado');
  if (!cont) return;
  const caja = document.getElementById('modal-content');
  const ancla = document.getElementById('simtar-ancla');
  const topAntes = (anclar && caja && ancla) ? ancla.getBoundingClientRect().top : null;
  const pintar = h => {
    cont.innerHTML = h;
    _simNotaAplicar();
    if (topAntes != null) {
      const d = ancla.getBoundingClientRect().top - topAntes;
      if (d) caja.scrollTop += d;
    }
  };
  const st = _simEstado();
  const mes = _panelMesActivo(SIM_MES_ID) || _simMesDefecto();
  const records = _simRecordsDelMes(mes);
  const mapa = _simMapaGrupos();

  // La medición con las tarifas de HOY no cambia mientras se mueven las perillas:
  // se calcula una vez por mes y se reusa, así cada tecleo paga una sola pasada.
  if (!_simBase || _simBase.mes !== mes || _simBase.n !== records.length) {
    _simBase = { mes, n: records.length, res: _simMedir(records, AppData.tarifas || [], AppData.superSLA || []),
                 rango: _simRangoFechas(records) };
  }
  const base = _simBase.res;
  const sim = _simMedir(records, _simTarifasSimuladas(st), _simSuperSLASimulado(st, mapa));
  const cmp = _simComparar(base, sim, mapa);

  const delta = sim.total - base.total;
  const pct = base.total > 0 ? (delta / base.total * 100) : 0;
  const unitario = base.envios > 0 ? delta / base.envios : 0;
  const rango = _simBase.rango;
  const fmtF = iso => iso ? isoToDMY(iso).slice(0, 5) : '—';
  const completo = !!AppData.historialCompleto;

  const card = (cls, icono, etq, valor, sub) =>
    '<div class="metric-card' + (cls ? ' ' + cls : '') + '"><div class="metric-ic"><i class="ic ' + icono + '"></i></div>' +
    '<div class="metric-label">' + etq + '</div><div class="metric-value">' + valor + '</div>' +
    '<div class="metric-sub">' + sub + '</div></div>';

  let html = '';

  if (!base.envios) {
    html += '<div class="alert" style="background:var(--surface-0);border:1px solid var(--border);font-size:13px">' +
      '<div>Sin envíos pagados en <strong>' + _simMesTexto(mes) + '</strong>, así que no hay sobre qué medir el impacto. ' +
      'Elegí otro mes' + (completo ? '.' : ' — la app tiene cargados los últimos ' +
        (typeof VENTANA_DIAS_REGISTROS !== 'undefined' ? VENTANA_DIAS_REGISTROS : 14) + ' días. ' +
        '<button class="btn btn-sm" style="padding:1px 7px;font-size:10px" onclick="cargarHistorialCompleto(this)">Cargar historial completo</button>') +
      '</div></div>';
    pintar(html);
    return;
  }

  html +=
    '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">' +
      card('', 'ic-dollar', 'Se paga hoy', fmtPeso(base.total),
        base.envios.toLocaleString('es-AR') + ' envíos pagados · del ' + fmtF(rango.min) + ' al ' + fmtF(rango.max)) +
      card('', 'ic-truck', 'Se pagaría', fmtPeso(sim.total), 'con el ajuste simulado') +
      card(delta ? 'accent' : '', 'ic-trend', 'Impacto',
        (delta >= 0 ? '+' : '−') + fmtPeso(Math.abs(delta)),
        (delta >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1).replace('.', ',') + '% · ' +
        (unitario >= 0 ? '+' : '−') + fmtPeso(Math.abs(unitario)) + ' por envío') +
    '</div>';

  if (!completo) {
    html += '<div style="font-size:11.5px;color:var(--text-muted);margin:-4px 0 12px">' +
      'La app tiene cargados los últimos ' + (typeof VENTANA_DIAS_REGISTROS !== 'undefined' ? VENTANA_DIAS_REGISTROS : 14) +
      ' días, así que el mes puede venir incompleto: lo medido son los envíos de arriba, no el mes entero. ' +
      '<button class="btn btn-sm" style="padding:1px 7px;font-size:10px" onclick="cargarHistorialCompleto(this)">Cargar historial completo</button></div>';
  }

  // Lo que el tarifario NO mueve. Es la parte del pago que un aumento de tarifas
  // no alcanza, y si no se dijera el operador leería el impacto como si cubriera
  // todo lo que se paga.
  if (base.fijosEnvios) {
    html += '<div class="alert" style="background:#fff8e1;border:1px solid #f5d97a;color:#7a5c00;font-size:12.5px;margin-bottom:12px"><div>' +
      '<strong>' + base.fijosEnvios.toLocaleString('es-AR') + ' envíos (' + fmtPeso(base.fijosTotal) + ') no se mueven</strong>: ' +
      'tienen el precio pisado a mano o una condición especial asignada, y esas dos cosas ganan sobre el tarifario. ' +
      'El impacto de arriba ya los deja afuera.' +
      '</div></div>';
  }

  // Por banda de distancia: es el corte con el que se decide el ajuste.
  const filasGrupo = SIM_GRUPOS.map(g => {
    const a = cmp.porGrupo.get(g);
    if (!a || (!a.envios && !a.hoy)) return '';
    const d = a.nuevo - a.hoy;
    const p = a.hoy > 0 ? d / a.hoy * 100 : 0;
    const v = _num(st.porGrupo[g]);
    return '<tr>' +
      '<td>' + g +
        (a.fijos ? '<div style="font-size:10.5px;color:var(--text-muted);font-weight:400">' + a.fijos +
          ' a precio fijo (' + fmtPeso(a.fijosTotal) + '), que el ajuste no mueve</div>' : '') +
      '</td>' +
      '<td class="mono" style="text-align:right">' + (v ? (st.modo === 'pct' ? v + '%' : fmtPeso(v)) : '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + a.envios.toLocaleString('es-AR') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(a.hoy) + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(a.nuevo) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700;color:' + (d ? 'var(--accent)' : 'var(--text-muted)') + '">' +
        (d ? (d >= 0 ? '+' : '−') + fmtPeso(Math.abs(d)) + ' <span style="font-weight:600;font-size:11px;color:var(--text-muted)">' +
             (d >= 0 ? '+' : '−') + Math.abs(p).toFixed(1).replace('.', ',') + '%</span>' : '—') +
      '</td></tr>';
  }).join('');

  html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">' +
    '<i class="ic ic-route"></i> Por banda de distancia</span></div><div class="table-wrap"><table>' +
    '<thead><tr><th>Banda</th><th style="text-align:right">Ajuste</th><th style="text-align:right">Envíos</th>' +
    '<th style="text-align:right">Hoy</th><th style="text-align:right">Simulado</th><th style="text-align:right">Impacto</th></tr></thead>' +
    '<tbody>' + filasGrupo +
    '<tr style="font-weight:700;border-top:2px solid var(--border)"><td>TOTAL</td><td></td>' +
      '<td class="mono" style="text-align:right">' + base.envios.toLocaleString('es-AR') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(base.total) + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(sim.total) + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--accent)">' + (delta >= 0 ? '+' : '−') + fmtPeso(Math.abs(delta)) + '</td>' +
    '</tr></tbody></table></div></div>';

  // Super SLA: cuánto del pago pasa por una regla especial y cuánto se movió.
  const dSuper = sim.superTotal - base.superTotal;
  html += '<div class="card" style="margin-bottom:12px"><div class="card-body" style="font-size:12.5px;color:var(--text-secondary);line-height:1.6">' +
    '<i class="ic ic-star"></i> <strong>Super SLA</strong>: ' +
    (base.superEnvios
      ? base.superEnvios.toLocaleString('es-AR') + ' de los envíos medidos (' + fmtPeso(base.superTotal) + ') se pagan con un precio especial. ' +
        (st.ajustarSLA
          ? (dSuper ? 'El ajuste les suma <strong>' + fmtPeso(dSuper) + '</strong>.' : 'Con este ajuste no se mueven.')
          : '<strong>Quedan sin ajustar</strong>: esos envíos siguen pagándose igual que hoy.')
      : 'ningún envío del período se pagó con un precio especial, así que el ajuste de Super SLA no cambia este número.') +
    '</div></div>';

  // Las zonas que más mueven, y a quién le llega.
  const conPlata = cmp.filas.filter(f => f.delta !== 0);
  if (conPlata.length) {
    const top = conPlata.slice(0, 14);
    html += '<div class="card" style="margin-bottom:12px"><div class="card-header"><span class="card-title">' +
      '<i class="ic ic-pin"></i> Las zonas que más mueven</span>' +
      '<span style="font-size:11px;color:var(--text-muted)">' + conPlata.length + ' zona(s) con impacto' +
      (conPlata.length > top.length ? ' · se muestran las ' + top.length + ' mayores' : '') + '</span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Zona</th><th>Banda</th><th style="text-align:right">Envíos</th>' +
      '<th style="text-align:right">Hoy</th><th style="text-align:right">Simulado</th><th style="text-align:right">Impacto</th></tr></thead><tbody>' +
      top.map(f => '<tr><td>' + f.zona + '</td><td style="font-size:11.5px;color:var(--text-muted)">' + f.grupo + '</td>' +
        '<td class="mono" style="text-align:right">' + f.envios.toLocaleString('es-AR') + '</td>' +
        '<td class="mono" style="text-align:right">' + fmtPeso(f.hoy) + '</td>' +
        '<td class="mono" style="text-align:right">' + fmtPeso(f.nuevo) + '</td>' +
        '<td class="mono" style="text-align:right;font-weight:700;color:var(--accent)">' + (f.delta >= 0 ? '+' : '−') + fmtPeso(Math.abs(f.delta)) + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  if (cmp.conds.length) {
    const topc = cmp.conds.slice(0, 10);
    html += '<div class="card" style="margin-bottom:4px"><div class="card-header"><span class="card-title">' +
      '<i class="ic ic-users"></i> A quién le llega</span>' +
      '<span style="font-size:11px;color:var(--text-muted)">' + cmp.conds.length + ' conductor(es)' +
      (cmp.conds.length > topc.length ? ' · los ' + topc.length + ' que más suben' : '') + '</span></div>' +
      '<div class="card-body">' + topc.map(c => {
        const p = c.hoy > 0 ? c.delta / c.hoy * 100 : 0;
        return '<div class="dash-rank-row"><span class="nom">' + c.cond + '</span>' +
          '<span class="amt" style="color:var(--accent)">' + (c.delta >= 0 ? '+' : '−') + fmtPeso(Math.abs(c.delta)) +
          '<span>' + c.envios.toLocaleString('es-AR') + ' env · ' + (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1).replace('.', ',') + '%</span></span></div>';
      }).join('') + '</div></div>';
  }

  pintar(html);
}

const _SIM_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function _simMesTexto(yyyymm) {
  const n = _SIM_MESES[(+String(yyyymm).slice(5, 7)) - 1];
  if (!n) return String(yyyymm || '');
  return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + String(yyyymm).slice(0, 4);
}

function _simNotaAplicar() {
  const el = document.getElementById('simtar-aplicar-nota');
  if (!el) return;
  const c = _simCambios(_simEstado());
  el.textContent = (c.tarifas.length || c.sla.length)
    ? 'Se escribirían ' + c.tarifas.length + ' zona(s) del tarifario' +
      (c.sla.length ? ' y ' + c.sla.length + ' precio(s) Super SLA' : '') + '.'
    : 'Todavía no hay ningún cambio cargado.';
}

// ── Qué cambiaría de verdad ───────────────────────────────────────────────
function _simCambios(st) {
  const mapa = _simMapaGrupos();
  const nt = _simTarifasSimuladas(st);
  const ns = _simSuperSLASimulado(st, mapa);
  const tarifas = [], sla = [];
  (AppData.tarifas || []).forEach((t, i) => {
    const n = nt[i];
    if (SIM_CAMPOS_TARIFA.some(k => _num(t[k]) !== _num(n[k]))) tarifas.push({ i, t, n });
  });
  (AppData.superSLA || []).forEach((r, i) => {
    const n = ns[i];
    if (_num(r.precio != null ? r.precio : r.sla) !== _num(n.precio)) sla.push({ i, r, n });
  });
  return { tarifas, sla };
}

// ── Perillas ──────────────────────────────────────────────────────────────
function simSetModo(m) { _simEstado().modo = (m === 'monto' ? 'monto' : 'pct'); renderSimTarifas(); }
function simSetRedondeo(p) { _simEstado().redondeo = _num(p) || 1; renderSimTarifas(); }
// El valor se escribe mientras se tipea, así que solo se repinta el RESULTADO
// (repintar el modal entero le sacaría el foco al campo a cada tecla).
function simSetGrupo(g, v) {
  const st = _simEstado();
  st.porGrupo[g] = v === '' ? 0 : _num(v);
  clearTimeout(_simDebounce);
  _simDebounce = setTimeout(() => { _simPintarResultado(true); _simRefrescarPrecios(); }, 220);
}
function simToggleGrupo(g) {
  const st = _simEstado();
  if (st.abiertos.has(g)) st.abiertos.delete(g); else st.abiertos.add(g);
  renderSimTarifas();
}
function simToggleZona(k, on) {
  const st = _simEstado();
  if (on) st.zonas.add(k); else st.zonas.delete(k);
  renderSimTarifas();
}
function simTildarGrupo(g, on) {
  const st = _simEstado();
  (_simZonasPorGrupo().get(g) || []).forEach(t => { if (on) st.zonas.add(_simKey(t.zona)); else st.zonas.delete(_simKey(t.zona)); });
  renderSimTarifas();
}
function simTildarTodas(on) {
  const st = _simEstado();
  st.zonas = new Set();
  if (on) _simZonasPorGrupo().forEach(arr => arr.forEach(t => st.zonas.add(_simKey(t.zona))));
  renderSimTarifas();
}
function simToggleSLA(on) { _simEstado().ajustarSLA = !!on; renderSimTarifas(); }
function simVerSLA() { const st = _simEstado(); st.verSLA = !st.verSLA; renderSimTarifas(); }
function simToggleSLACond(k, on) {
  const st = _simEstado();
  if (on) st.slaCond.add(k); else st.slaCond.delete(k);
  renderSimTarifas();
}
function simTildarSLA(on) {
  const st = _simEstado();
  st.slaCond = on ? new Set(_simConductoresSLA().map(_simKey)) : new Set();
  renderSimTarifas();
}

// Al tipear un porcentaje, los precios de abajo (los de las zonas desplegadas)
// tienen que seguirlo sin re-dibujar el modal: se reescriben en el lugar.
function _simRefrescarPrecios() {
  const st = _simEstado();
  if (!st.abiertos.size) return;
  const porGrupo = _simZonasPorGrupo();
  st.abiertos.forEach(g => {
    const caja = document.getElementById('simtar-filas-' + SIM_GRUPOS.indexOf(g));
    if (caja) caja.innerHTML = _simFilasGrupo(st, g, porGrupo.get(g) || []);
  });
}

// ── Aplicar ───────────────────────────────────────────────────────────────
function simAplicarTarifas() {
  const st = _simEstado();
  const c = _simCambios(st);
  const puedeSLA = typeof puedeEditarSuperSLA === 'function' ? puedeEditarSuperSLA() : true;
  const slaAplicables = puedeSLA ? c.sla : [];

  if (!c.tarifas.length && !slaAplicables.length) {
    alert(c.sla.length
      ? 'El único cambio cargado es sobre las tarifas Super SLA, y tu rol no puede escribirlas.\n\nPedile a un supervisor o analista que lo aplique.'
      : 'No hay ningún cambio cargado: escribí un porcentaje o un monto en alguna banda de distancia.');
    return;
  }

  // El impacto que se confirma es EL MEDIDO, no uno recalculado al vuelo: tiene
  // que ser el mismo número que el operador estuvo mirando.
  const mes = _panelMesActivo(SIM_MES_ID) || _simMesDefecto();
  const records = _simRecordsDelMes(mes);
  const mapa = _simMapaGrupos();
  const base = (_simBase && _simBase.mes === mes) ? _simBase.res : _simMedir(records, AppData.tarifas || [], AppData.superSLA || []);
  const sim = _simMedir(records, _simTarifasSimuladas(st), _simSuperSLASimulado(st, mapa));
  const delta = sim.total - base.total;
  const pct = base.total > 0 ? (delta / base.total * 100) : 0;

  const nl = String.fromCharCode(10);
  let msg = 'Se van a reescribir ' + c.tarifas.length + ' zona(s) del tarifario';
  msg += slaAplicables.length ? ' y ' + slaAplicables.length + ' precio(s) Super SLA.' : '.';
  msg += nl + nl + 'Medido sobre ' + base.envios.toLocaleString('es-AR') + ' envíos de ' + _simMesTexto(mes) + ': ' +
    'se pagan ' + fmtPeso(base.total) + ' y pasarían a ' + fmtPeso(sim.total) +
    ' (' + (delta >= 0 ? '+' : '−') + fmtPeso(Math.abs(delta)) + ', ' +
    (delta >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1).replace('.', ',') + '%).';
  if (c.sla.length && !puedeSLA) {
    msg += nl + nl + 'OJO: los ' + c.sla.length + ' precios Super SLA NO se van a escribir (tu rol no puede editarlos), ' +
      'así que esos conductores quedan sin el aumento hasta que lo aplique un supervisor.';
  }
  msg += nl + nl + 'El tarifario nuevo rige desde ya para TODO lo que se liquide, incluidas las semanas abiertas. ¿Aplicar?';
  if (!confirm(msg)) return;

  const resumen = t => (t.categoria || '—') + ' · S/C ' + fmtPeso(t.s_colecta) + ' · C/C ' + fmtPeso(t.c_colecta) + ' · SLA ' + fmtPeso(t.sla);
  const sup = c.tarifas.map(x => ({ clave: x.t.zona, antes: resumen(x.t), despues: resumen(x.n) }));

  c.tarifas.forEach(x => { SIM_CAMPOS_TARIFA.forEach(k => { AppData.tarifas[x.i][k] = _num(x.n[k]); }); });
  if (slaAplicables.length) {
    slaAplicables.forEach(x => { AppData.superSLA[x.i].precio = _num(x.n.precio); });
    sup.push(...slaAplicables.map(x => ({
      clave: 'Super SLA · ' + x.r.conductor + ' · ' + x.r.zona,
      antes: fmtPeso(_num(x.r.precio != null ? x.r.precio : x.r.sla)),
      despues: fmtPeso(_num(x.n.precio)),
    })));
  }

  if (typeof invalidarIndiceTarifas === 'function') invalidarIndiceTarifas();
  if (typeof registrarSuperposiciones === 'function') registrarSuperposiciones('tarifas', isoToDMY(hoyISO()), sup);
  if (c.tarifas.length) saveTarifas();
  if (slaAplicables.length && typeof saveSuperSLA === 'function') saveSuperSLA();

  // Los valores vuelven a CERO: dejarlos puestos invita a apretar "Aplicar" dos
  // veces y aumentar dos veces lo mismo, que es un error que no se ve.
  SIM_GRUPOS.forEach(g => { st.porGrupo[g] = 0; });
  _simBase = null;

  if (typeof renderTarifas === 'function' && document.getElementById('tarifas-rows')) renderTarifas();
  if (typeof renderSuperSLA === 'function' && document.getElementById('supersla-conductor-bloques')) renderSuperSLA();
  renderSimTarifas();
  showToast('✅ Tarifario actualizado: ' + c.tarifas.length + ' zona(s)' +
    (slaAplicables.length ? ' y ' + slaAplicables.length + ' precio(s) Super SLA' : '') +
    ' — ' + (delta >= 0 ? '+' : '−') + fmtPeso(Math.abs(delta)) + ' sobre ' + _simMesTexto(mes));
}

// ===== CONFIG SUPER SLA =====
