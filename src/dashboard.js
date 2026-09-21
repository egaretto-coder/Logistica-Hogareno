function getZonaEfectiva(r) {
  return (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
}

// ── Filtro por condición ────────────────────────────────────────────────────
// El filtro existía pero solo repintaba la tarjeta "Conductores por condición":
// los KPIs de arriba, el reporte por conductor y el de zonas seguían mostrando
// a TODOS. Filtrar Titulares y ver "Total liquidado" con la plata de todo el
// mundo es peor que no tener el filtro, porque el número parece el del filtro y
// no lo es. Ahora filtra los ENVÍOS, y todo lo que cuelga de ahí lo sigue.
let dashCondFilter = '';
const DASH_COND_PLURAL = { 'Titular': 'Titulares', 'Semi Titular': 'Semi Titulares', 'Suplente': 'Suplentes' };
function dashCondLabel() { return dashCondFilter ? (DASH_COND_PLURAL[dashCondFilter] || dashCondFilter) : ''; }

// Los botones se pintan contra el FILTRO, no contra el que se tocó: el mismo
// grupo está en Conductores y en Zonas, y marcando solo el clickeado el otro
// grupo quedaba mostrando "Todos" mientras el panel filtraba por Titulares.
function _pintarBotonesCond() {
  document.querySelectorAll('.dash-cond-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.cond || '') === dashCondFilter));
}
function setDashCondFilter(btn, cond) {
  dashCondFilter = cond;
  _pintarBotonesCond();
  renderDashboard(); // re-renderiza respetando el filtro de fechas activo
}

function renderDashConductoresPanel(liqParam) {
  // liqParam viene de renderDashboard ya filtrado por fecha
  // Si se llama directo (ej: desde setDashCondFilter), recalcula completo
  const liq = liqParam || calcLiquidaciones();
  const total = AppData.panelConductores.length;
  const filtrados = dashCondFilter
    ? AppData.panelConductores.filter(c => c.condicion === dashCondFilter)
    : AppData.panelConductores;
  const cantidad = filtrados.length;
  // Anillo conductores: cuando es Todos → conductores con liq / conductores panel
  // cuando es por condición → filtrados / total panel
  const totalConLiq = Object.keys(liq).length;
  const pct = dashCondFilter
    ? (total ? Math.round(cantidad / total * 100) : 0)
    : (totalConLiq > 0 ? 100 : 0); // Todos siempre es 100% del universo

  const CAT_INFO = {
    's_colecta': { label: 'S/ Colecta', color: '#3b82f6' },
    'c_colecta': { label: 'C/ Colecta', color: '#10b981' },
    'sla':       { label: 'SLA Cumplido', color: '#8b5cf6' },
    'super_sla': { label: 'Super SLA', color: '#f59e0b' },
    'sin_cat':   { label: 'Sin categorizar', color: '#9ca3af' }
  };

  const condLabel = dashCondFilter || 'Todos';
  const condEmoji = dashCondFilter === 'Titular' ? '🔵' : dashCondFilter === 'Semi Titular' ? '🟡' : dashCondFilter === 'Suplente' ? '🟣' : '⚪';

  const body = document.getElementById('dash-conductores-panel-body');
  if (!total) {
    body.innerHTML = '<div class="empty-state"><div class="empty-sub">Sin conductores en el panel</div></div>';
    return;
  }

  // ── Distribución por categorización (headcount) ──────────────────────────
  // El universo depende del filtro:
  // - Con condición → solo conductores del panel con esa condición (filtrados)
  // - Sin filtro (Todos) → todos los conductores que tienen liquidación en el XLS;
  //   los que no están en el panel se cuentan como "Sin categorizar"
  const catCount = {};

  if (dashCondFilter) {
    // Filtro por condición: solo los del panel filtrados
    filtrados.forEach(c => {
      const cat = c.categoria || 'sin_cat';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
  } else {
    // Todos: usar los conductores reales del XLS (los que tienen liquidación)
    // Armar mapa nombre→categoría desde el panel
    const panelMap = {};
    AppData.panelConductores.forEach(c => {
      panelMap[c.nombre.toUpperCase().trim()] = c.categoria || 'sin_cat';
    });
    // Recorrer todos los conductores con liquidación
    Object.keys(liq).forEach(nombre => {
      const nNorm = nombre.toUpperCase().trim();
      const cat = panelMap[nNorm] || 'sin_cat';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
  }

  // Total real para los porcentajes: conductores únicos con liquidación (filtro Todos)
  // o cantidad de filtrados (filtro por condición)
  const totalParaPct = dashCondFilter ? cantidad : Object.keys(liq).length;

  // ── Facturación ──────────────────────────────────────────────────────────
  // Monto total general = TODOS los conductores con liquidación (base real)
  const totalMontoGeneral = Object.values(liq).reduce((s, d) => s + d.total, 0);

  let montoGrupo = 0;
  const liqPorConductor = []; // { nombre, monto }

  if (!dashCondFilter) {
    // Filtro "Todos": monto grupo = total general, incluir todos los conductores con liq
    montoGrupo = totalMontoGeneral;
    Object.entries(liq).forEach(([nombre, d]) => {
      liqPorConductor.push({ nombre, monto: d.total });
    });
  } else {
    // Filtro por condición: solo conductores del panel con esa condición
    const nombresFilterSet = new Set(filtrados.map(c => c.nombre.toUpperCase().trim()));
    Object.entries(liq).forEach(([nombre, d]) => {
      if (nombresFilterSet.has(nombre.toUpperCase().trim())) {
        montoGrupo += d.total;
        liqPorConductor.push({ nombre, monto: d.total });
      }
    });
  }

  const pctFacturacion = totalMontoGeneral > 0 ? Math.round(montoGrupo / totalMontoGeneral * 100) : 0;
  liqPorConductor.sort((a, b) => b.monto - a.monto);
  const maxMonto = liqPorConductor.length ? liqPorConductor[0].monto : 1;
  const top8 = liqPorConductor.slice(0, 8);

  // ── Distribución por categorización (barras) ─────────────────────────────
  const catRows = Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, cnt]) => {
      const info = CAT_INFO[cat] || { label: cat, color: '#9ca3af' };
      const catPct = totalParaPct ? Math.round(cnt / totalParaPct * 100) : 0;
      return `<div class="dash-bar-row">
        <span class="lbl"><span class="dot" style="background:${info.color}"></span>${info.label}</span>
        <span class="dash-bar-track"><span class="dash-bar-fill" style="width:${catPct}%;background:${info.color}"></span></span>
        <span class="meta"><b style="color:${info.color}">${catPct}%</b><span>${cnt}</span></span>
      </div>`;
    }).join('');

  // ── Participación en facturación por conductor (ranking) ─────────────────
  const factRows = top8.length ? top8.map(({ nombre, monto }) => {
    const partPct = montoGrupo > 0 ? Math.round(monto / montoGrupo * 100) : 0;
    return `<div class="dash-rank-row">
      <div class="conductor-avatar" style="background:${avatarColor(nombre)};width:26px;height:26px;font-size:9px;flex-shrink:0">${initials(nombre)}</div>
      <span class="nom">${nombre}</span>
      <span class="amt">${fmtPeso(monto)}<span>${partPct}%</span></span>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:var(--text-muted);padding:10px 0">Sin liquidaciones para esta condición</div>';

  body.innerHTML = `
    <div class="dash-cond-grid">
      <div>
        <div class="dash-subtitle">Distribución por categorización · <b style="color:var(--text-secondary)">${dashCondFilter ? cantidad : totalConLiq} conductores</b></div>
        ${catRows || '<div style="color:var(--text-muted);font-size:12px">Sin conductores</div>'}
      </div>
      <div>
        <div class="dash-subtitle">Participación en facturación${dashCondFilter ? ' · ' + condLabel : ''} · <b style="color:var(--text-secondary)">${fmtPeso(montoGrupo)}</b></div>
        ${factRows}
        ${liqPorConductor.length > 8 ? '<div style="font-size:11px;color:var(--text-muted);margin-top:10px;text-align:center">+ ' + (liqPorConductor.length - 8) + ' conductores más</div>' : ''}
      </div>
    </div>`;
}

// ── Estado filtro de fechas del dashboard ───────────────────────────────────
let dashFechaPreset = 'todo'; // 'todo' | 'hoy' | 'semana' | 'mes' | 'personalizado'

// Convierte DD/MM/YYYY → objeto Date (mediodia para evitar problemas de TZ)
function parseFechaReg(fechaStr) {
  if (!fechaStr) return null;
  try {
    if (String(fechaStr).includes('/')) {
      const parts = String(fechaStr).split('/');
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d, 12, 0, 0);
      }
    }
    // YYYY-MM-DD (desde input date nativo)
    if (String(fechaStr).match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [y, m, d] = fechaStr.split('-').map(Number);
      return new Date(y, m - 1, d, 12, 0, 0);
    }
    const parsed = new Date(fechaStr);
    return isNaN(parsed) ? null : parsed;
  } catch(e) { return null; }
}

// Convierte YYYY-MM-DD (valor de input nativo) a Date al inicio del día
function parseFechaInput(val) {
  if (!val) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0);
}

function getDashFechaRango() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (dashFechaPreset === 'todo') return null;
  if (dashFechaPreset === 'hoy') {
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
    return { desde: hoy, hasta: fin };
  }
  if (dashFechaPreset === 'semana') {
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);
    const dom = new Date(lunes);
    dom.setDate(lunes.getDate() + 6);
    dom.setHours(23, 59, 59);
    return { desde: lunes, hasta: dom };
  }
  if (dashFechaPreset === 'mes') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1, 0, 0, 0);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);
    return { desde: ini, hasta: fin };
  }
  if (dashFechaPreset === 'personalizado') {
    const desdeEl = document.getElementById('dash-fecha-desde');
    const hastaEl = document.getElementById('dash-fecha-hasta');
    const desdeVal = desdeEl ? desdeEl.value : '';
    const hastaVal = hastaEl ? hastaEl.value : '';
    if (!desdeVal && !hastaVal) return null;
    const desde = desdeVal ? parseFechaInput(desdeVal) : null;
    const hasta = hastaVal ? new Date(new Date(parseFechaInput(hastaVal)).setHours(23, 59, 59)) : null;
    return { desde, hasta };
  }
  return null;
}

// Devuelve una referencia ESTABLE para el mismo rango y la misma base: el
// Dashboard y su reporte por zona/conductor lo llaman por separado dentro del
// mismo render, y si cada uno recibiera un array nuevo el caché de
// calcLiquidaciones (que va por identidad) no daría nunca y se recalcularían los
// 47.684 envíos dos veces.
let _filtroCache = null;
// La llama invalidarLiquidaciones: el filtro se apoya en la fecha de cada envío,
// así que cualquier cambio en los registros lo deja viejo igual que al cálculo.
function invalidarFiltroFecha() { _filtroCache = null; _filtroCondCache = null; }
// Envíos de los conductores con ESA condición. Un envío sin chofer, o de un
// cadete que no está en el panel, no tiene condición: queda afuera de cualquier
// filtro por condición (que es lo correcto — no es titular ni suplente).
// Devuelve la MISMA referencia cuando no hay filtro: es lo que hace que
// calcLiquidaciones dé en su caché y las tres pasadas del render no recalculen
// 47.684 envíos cada una.
let _filtroCondCache = null;
function filtrarRecordsPorCondicion(records) {
  const cond = dashCondFilter;
  if (!cond) return records;
  if (_filtroCondCache && _filtroCondCache.cond === cond && _filtroCondCache.src === records
      && _filtroCondCache.n === records.length) return _filtroCondCache.out;
  const out = records.filter(r => {
    const c = conductorCanonico(r.cadete);
    if (!c) return false;
    const p = panelConductorDe(c);
    return !!p && String(p.condicion || '').trim() === cond;
  });
  _filtroCondCache = { cond, src: records, n: records.length, out };
  return out;
}

// Los envíos que el Dashboard está mirando: período Y condición. Es la única
// fuente de los KPIs y de los dos reportes, así que no pueden desfasarse.
function recordsDelDashboard() {
  const porFecha = (typeof filtrarRecordsPorFecha === 'function')
    ? filtrarRecordsPorFecha(AppData.records) : AppData.records;
  return filtrarRecordsPorCondicion(porFecha);
}

function filtrarRecordsPorFecha(records) {
  const rango = getDashFechaRango();
  if (!rango) return records;
  const clave = (rango.desde ? rango.desde.getTime() : 0) + '|' + (rango.hasta ? rango.hasta.getTime() : 0);
  if (_filtroCache && _filtroCache.clave === clave && _filtroCache.src === records
      && _filtroCache.n === records.length) return _filtroCache.out;
  const out = records.filter(r => {
    const f = parseFechaReg(r.fecha);
    if (!f) return false;
    if (rango.desde && f < rango.desde) return false;
    if (rango.hasta && f > rango.hasta) return false;
    return true;
  });
  _filtroCache = { clave, src: records, n: records.length, out };
  return out;
}

function setDashFechaPreset(btn, preset) {
  dashFechaPreset = preset;
  document.querySelectorAll('.dash-fecha-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const customDiv = document.getElementById('dash-fecha-custom');
  customDiv.style.display = preset === 'personalizado' ? 'flex' : 'none';
  renderDashboard();
}

function renderDashboard() {
  const rango = getDashFechaRango();
  const recordsFiltrados = recordsDelDashboard();

  // Las liquidaciones del período salen del MISMO cálculo que usa la pantalla de
  // Liquidaciones (calcLiquidaciones). Antes el Dashboard tenía su propia cuenta
  // en línea que solo miraba getPrecio + precio_manual y NO la dimensión especial
  // asignada al envío: los 73 envíos con condición cargada se contaban a la tarifa
  // común de la zona, así que el "Total a pagar" del Dashboard no coincidía con la
  // suma de lo que se liquida de verdad. Dos cuentas para el mismo número siempre
  // terminan discrepando; ahora hay una sola.
  // Sin filtro de fecha se pasa undefined a propósito: es lo único que calcLiquidaciones
  // cachea, y así el reporte por zona/conductor reusa esta misma pasada.
  const liqFecha = calcLiquidaciones(recordsFiltrados === AppData.records ? undefined : recordsFiltrados);
  const conductores = Object.keys(liqFecha);
  const totalMonto = Object.values(liqFecha).reduce((s, v) => s + v.total, 0);
  // COSTO VARIABLE UNITARIO: lo que cuesta cada envío que se paga.
  // El denominador son LOS MISMOS envíos que forman el total —las filas que
  // contabilizan—, no todos los recorridos del período: los no entregados no
  // se le pagan a nadie y meterlos abajo daría un unitario más barato que el
  // real. Dividir un número por su propia cantidad es lo que hace que esta
  // tarjeta no pueda contradecir a la de al lado.
  const enviosPagos = Object.values(liqFecha).reduce((s, v) => s + v.filas.length, 0);
  const costoUnitario = enviosPagos ? totalMonto / enviosPagos : 0;
  const totalRecs = recordsFiltrados.length;
  const totalEntregados = recordsFiltrados.filter(r => esEstadoEntregado(r.estado)).length;
  const totalExcluidos = totalRecs - totalEntregados;

  // Etiqueta del período seleccionado
  const fmt = d => d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  let labelPeriodo = '';
  if (dashFechaPreset === 'todo') {
    labelPeriodo = '— todos los registros';
  } else if (rango) {
    if (rango.desde && rango.hasta) {
      labelPeriodo = fmt(rango.desde) + ' → ' + fmt(rango.hasta);
    } else if (rango.desde) {
      labelPeriodo = 'Desde ' + fmt(rango.desde);
    } else if (rango.hasta) {
      labelPeriodo = 'Hasta ' + fmt(rango.hasta);
    }
  } else if (dashFechaPreset === 'personalizado') {
    labelPeriodo = 'Seleccioná un rango de fechas';
  }
  _pintarBotonesCond();
  if (dashCondLabel()) labelPeriodo = (labelPeriodo ? labelPeriodo + ' · ' : '') + 'solo ' + dashCondLabel();
  if (dashTab === 'clientes' && dashPerFilter)
    labelPeriodo = (labelPeriodo ? labelPeriodo + ' · ' : '') + 'clientes ' + DASH_PER_PLURAL[dashPerFilter].toLowerCase();
  const labelEl = document.getElementById('dash-fecha-label');
  if (labelEl) labelEl.textContent = labelPeriodo;

  const promedioPorConductor = conductores.length ? Math.round(totalMonto / conductores.length) : 0;

  document.getElementById('metric-total').textContent = fmtPeso(totalMonto);
  document.getElementById('metric-sub-total').textContent = totalEntregados + ' entregados · ' + totalExcluidos + ' en otros estados';
  document.getElementById('metric-cvu').textContent = fmtPeso(costoUnitario);
  const cvuSub = document.getElementById('metric-cvu-sub');
  if (cvuSub) cvuSub.textContent = enviosPagos
    ? 'por envío pagado · ' + enviosPagos.toLocaleString('es-AR') + ' envíos'
    : 'sin envíos pagados en el período';
  document.getElementById('metric-conductores').textContent = conductores.length;
  document.getElementById('metric-promedio').textContent = fmtPeso(promedioPorConductor);
  document.getElementById('metric-promedio-sub').textContent = conductores.length + ' conductores en el período';
  // "Conductores en panel" también sigue al filtro: si dice 102 mientras los
  // demás KPIs hablan de 30 titulares, el promedio no se puede leer contra nada.
  const enPanel = dashCondFilter
    ? (AppData.panelConductores || []).filter(c => String(c.condicion || '').trim() === dashCondFilter).length
    : (AppData.panelConductores || []).length;
  document.getElementById('metric-panel-total').textContent = enPanel;
  const panelSub = document.getElementById('metric-panel-sub');
  if (panelSub) panelSub.textContent = dashCondFilter
    ? dashCondLabel() + ' de ' + (AppData.panelConductores || []).length
    : 'Registrados en el sistema';
  document.getElementById('sidebar-conductor-count').textContent = conductores.length + ' conductores';
  document.getElementById('sidebar-record-count').textContent = AppData.records.length
    ? (AppData.records.length + ' registros' + (AppData.historialCompleto ? ' (historial completo)' : ' · últimos ' + VENTANA_DIAS_REGISTROS + ' días'))
    : 'Sin datos cargados';
  document.getElementById('no-data-alert').style.display = AppData.records.length ? 'none' : 'flex';

  // SOLO la solapa que se está viendo. Antes se recalculaban las tres en cada
  // render, y la de Clientes es la cara de todas: con 47.684 envíos, entrar al
  // Dashboard tardaba 23 s y cambiar de solapa 18 s, con la pantalla congelada.
  // Las otras dos se recalculan al mostrarlas (switchDashTab), que es cuando
  // hacen falta — y siguen leyendo el MISMO período, así que no se desfasan.
  if (dashTab === 'conductores') {
    renderDashConductoresPanel(liqFecha);
    if (typeof renderConductorReport === 'function') renderConductorReport();
  } else if (dashTab === 'zonas') {
    if (typeof renderZonaReport === 'function') renderZonaReport();
  } else {
    if (typeof renderDashClientes === 'function') renderDashClientes();
  }
}

// ===== LIQUIDACIONES =====
// ── Estado filtro fechas de liquidaciones ────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD · SOLAPA CLIENTES — la renta del negocio.
//  Es el ÚNICO lugar donde se mira el margen: los paneles de Facturación
//  arman y descargan lo que se le factura al cliente, y mezclar ahí el costo
//  del conductor solo agrega ruido a esa tarea. Acá, en cambio, la pregunta
//  es justamente cuánto deja cada cliente.
// ════════════════════════════════════════════════════════════════════════

let dashTab = 'clientes';

function switchDashTab(tab) {
  dashTab = ['clientes', 'conductores', 'zonas'].indexOf(tab) >= 0 ? tab : 'clientes';
  ['clientes', 'conductores', 'zonas'].forEach(t => {
    const panel = document.getElementById('dash-tab-' + t);
    const btn = document.getElementById('dash-btn-' + t);
    if (panel) panel.style.display = (t === dashTab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === dashTab);
  });
  renderDashboard();
}

// ════════════════════════════════════════════════════════════════════════
//  FACTURACIÓN POR PERÍODO DEL CLIENTE
//  Lo que se FACTURA en unas fechas no es lo que se ENTREGÓ en ellas: cada
//  cliente factura por su período (semanal, quincenal o mensual) y el período
//  se factura ENTERO el jueves que lo cierra. Un quincenal se factura la semana
//  en que cierra su quincena, con las dos semanas juntas, y la otra semana no
//  se le factura nada. Contando por fecha de entrega —como hacía el Dashboard—
//  todo parecía facturarse cada semana y no se podía saber cuánto entra.
//  Por eso esta solapa cuenta los PERÍODOS QUE CIERRAN en las fechas elegidas,
//  cada uno completo y con el MISMO rango con que se arma su liquidación en
//  Detalle de cliente: el número es el de la factura. De paso los cargos y los
//  envíos traídos de otra semana, que se anclan al viernes que abre el período,
//  entran siempre: con un rango que no arrancaba en viernes ("Esta semana" va de
//  lunes a domingo) quedaban afuera sin avisar.
// ════════════════════════════════════════════════════════════════════════
let dashPerFilter = 0;   // 0 = todos · 7 semanales · 14 quincenales · 28 mensuales
const DASH_PER_PLURAL = { 7: 'Semanales', 14: 'Quincenales', 28: 'Mensuales' };

function setDashPerFilter(dias) {
  dashPerFilter = DASH_PER_PLURAL[_num(dias)] ? _num(dias) : 0;
  renderDashboard();   // también repinta la etiqueta del período
}

function _isoDash(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _ddmmIso(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : ''; }

// Entre qué fechas tiene que CERRAR un período para facturarse en lo elegido.
// Si la fecha final cae en la semana que todavía no cerró, se corre al jueves
// que la cierra: mirar "esta semana" un miércoles daría $0 —todavía no cerró
// nada— cuando la pregunta es cuánto se factura el jueves. Una semana que ya
// cerró se mira tal cual. null = "Todo": sin fechas no hay nada que cierre.
function _dashVentanaCierre() {
  const r = getDashFechaRango();
  if (!r || (!r.desde && !r.hasta)) return null;
  const v = { desde: r.desde ? _isoDash(r.desde) : '', hasta: r.hasta ? _isoDash(r.hasta) : '', extendidaA: '' };
  if (v.hasta) {
    const sem = semanaClienteRango(v.hasta);
    const hoy = _isoDash(new Date());
    const cierre = _isoDash(sem.hastaD);
    if (_isoDash(sem.desdeD) <= hoy && hoy <= cierre && v.hasta < cierre) { v.hasta = cierre; v.extendidaA = cierre; }
  }
  return v;
}

// Para un rango abierto de un lado: desde el envío más viejo, y hasta cuatro
// semanas adelante (así entra el período en curso de cualquier ciclo).
function _limitesFechasRegistros() {
  let min = '';
  (AppData.records || []).forEach(r => { const f = fechaISOde(r.fecha); if (f && (!min || f < min)) min = f; });
  const tope = new Date(); tope.setDate(tope.getDate() + 28);
  return { min, max: _isoDash(tope) };
}

// Los períodos de un cliente que CIERRAN dentro de la ventana, en orden. Cada
// uno es el rango de periodoClienteRango: el de su liquidación.
function _periodosQueCierran(cod, v, limites) {
  const out = [];
  const inicio = v.desde || (limites && limites.min) || '';
  const fin = v.hasta || (limites && limites.max) || '';
  if (!inicio || !fin || inicio > fin) return out;
  let p = periodoClienteRango(cod, inicio);
  for (let i = 0; i < 600; i++) {
    const cierre = _isoDash(p.hastaD);
    if (cierre > fin) break;
    if (cierre >= inicio) out.push(p);
    const sig = new Date(p.hastaD); sig.setDate(sig.getDate() + 1);
    p = periodoClienteRango(cod, _isoDash(sig));
  }
  return out;
}

// La liquidación de cada período, repartiendo los envíos del cliente UNA sola
// vez. Recorrerlos todos por cada período multiplicaba el trabajo: un semestre
// son 26 semanas por 121 clientes y el Dashboard tardaba un segundo. Los traídos
// de otra semana van a todas las cajas —los decide su factura_semana, no su
// fecha— y calcLiquidacionCliente los ubica; son pocos.
function _liqsPorPeriodo(k, periodos, reg) {
  if (periodos.length === 1) return [calcLiquidacionCliente(k, periodos[0], { registros: reg })];
  const cierres = periodos.map(x => _isoDash(x.hastaD));
  const inicio = _isoDash(periodos[0].desdeD);
  const cajas = periodos.map(() => []);
  const arrastrados = [];
  reg.forEach(r => {
    if (String(r.factura_semana || '').slice(0, 10)) { arrastrados.push(r); return; }
    const f = fechaISOde(r.fecha);
    if (!f || f < inicio || f > cierres[cierres.length - 1]) return;
    let lo = 0, hi = cierres.length - 1;       // el primer cierre >= la fecha
    while (lo < hi) { const m = (lo + hi) >> 1; if (cierres[m] < f) lo = m + 1; else hi = m; }
    cajas[lo].push(r);
  });
  return periodos.map((x, i) =>
    calcLiquidacionCliente(k, x, { registros: arrastrados.length ? cajas[i].concat(arrastrados) : cajas[i] }));
}

// ¿La ventana llega a algún cierre? Las semanas cierran los jueves, y las
// quincenas y los meses el 15 y el último día del mes.
function _ventanaTieneJueves(v) {
  if (!v.desde || !v.hasta) return true;
  const d = new Date(v.desde + 'T12:00:00');
  for (let i = 0; i < 32; i++) {
    if (_isoDash(d) > v.hasta) return false;
    const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
    if (d.getDay() === 4 || d.getDate() === 15 || fin) return true;
    d.setDate(d.getDate() + 1);
  }
  return true;
}

// Una fila de la tabla a partir de las liquidaciones de sus períodos.
function _filaRenta(cod, liqs, periodos) {
  const s = campo => liqs.reduce((t, l) => t + _num(l && l[campo]), 0);
  const hoy = _isoDash(new Date());
  return {
    cod, nombre: clienteNombreDe(cod), dias: periodoDiasDe(cod),
    envios: s('totalEnvios'), factura: s('total'), costo: s('pagado'), margen: s('margen'), sinTarifa: s('sinTarifa'),
    periodos: periodos || [], enCurso: (periodos || []).some(p => _isoDash(p.hastaD) >= hoy)
  };
}

// Rango del filtro del dashboard en el formato que usa la facturación.
function _dashRangoCliente() {
  const r = getDashFechaRango();
  return { desdeD: r && r.desde ? r.desde : null, hastaD: r && r.hasta ? r.hasta : null };
}

// Renta por cliente en el período: lo facturado, lo que costó y la diferencia.
function dashRentaClientes() { return dashFacturacionClientes().filas; }

// Facturación por cliente en las fechas elegidas: los períodos que CIERRAN en
// ellas. Devuelve además los clientes que tuvieron envíos en esas fechas pero
// no facturan en ellas (su período cierra más adelante): es plata que entra,
// en otra semana, y sin decirlo parecería que se perdió.
function dashFacturacionClientes() {
  const v = _dashVentanaCierre();
  // Una SOLA pasada agrupando los envíos por cliente, en vez de que cada
  // calcLiquidacionCliente vuelva a recorrer los 47.684. Con 121 clientes eran
  // 5,8 millones de vueltas por render y el Dashboard se congelaba 23 s.
  // El agrupado se arma acá y se descarta al terminar: nada queda cacheado, así
  // que corregir el cliente de un envío no puede quedar desfasado.
  const porCliente = new Map();
  (AppData.records || []).forEach(r => {
    const k = clienteCodDeRegistro(r);
    if (!k) return;
    let a = porCliente.get(k); if (!a) { a = []; porCliente.set(k, a); }
    a.push(r);
  });
  const vacio = [];
  const clientes = (typeof clientesDeRegistros === 'function') ? clientesDeRegistros(null) : [];
  const deEseCiclo = cod => !dashPerFilter || periodoDiasDe(cod) === dashPerFilter;
  const porMargen = (a, b) => b.margen - a.margen;

  // "Todo": sin fechas no hay nada que cierre — se cuenta todo lo entregado.
  if (!v) {
    const filas = clientes.filter(c => deEseCiclo(c.cod)).map(c => {
      const k = clienteKey(c.cod);
      return _filaRenta(k, [calcLiquidacionCliente(k, null, { registros: porCliente.get(k) || vacio })], []);
    }).filter(x => x.envios > 0 || x.factura > 0).sort(porMargen);
    return { filas, noCierran: [], ventana: null };
  }

  const limites = (v.desde && v.hasta) ? null : _limitesFechasRegistros();
  const hoy = _isoDash(new Date());
  const filas = [], noCierran = [];
  clientes.forEach(c => {
    const k = clienteKey(c.cod);
    if (!deEseCiclo(k)) return;
    const reg = porCliente.get(k) || vacio;
    const periodos = _periodosQueCierran(k, v, limites);
    if (periodos.length) {
      const fila = _filaRenta(k, _liqsPorPeriodo(k, periodos, reg), periodos);
      if (fila.envios > 0 || fila.factura > 0) filas.push(fila);
      return;
    }
    const enFechas = reg.some(r => {
      if (!contabilizaRegistro(r)) return false;
      const f = fechaISOde(r.fecha);
      return !!f && (!v.desde || f >= v.desde) && (!v.hasta || f <= v.hasta);
    });
    if (!enFechas) return;
    const p = periodoClienteRango(k, v.hasta || hoy);
    const liq = calcLiquidacionCliente(k, p, { registros: reg });
    noCierran.push({ cod: k, nombre: clienteNombreDe(k), dias: periodoDiasDe(k), cierra: _isoDash(p.hastaD), lleva: _num(liq.total) });
  });
  noCierran.sort((a, b) => a.cierra.localeCompare(b.cierra) || b.lleva - a.lleva);
  return { filas: filas.sort(porMargen), noCierran, ventana: v };
}

// Qué período se está facturando en la fila: "Quincenal · 11/09 → 24/09".
function _txtPeriodoFila(x) {
  const lbl = periodoLabel(x.dias);
  if (!x.periodos || !x.periodos.length) return lbl;
  const n = x.periodos.length;
  return lbl + (n > 1 ? ' · ' + n + ' períodos' : '') +
    '<div style="font-size:10px;color:var(--text-muted)">' + _ddmmIso(_isoDash(x.periodos[0].desdeD)) + ' → ' +
    _ddmmIso(_isoDash(x.periodos[n - 1].hastaD)) + (x.enCurso ? ' · en curso' : '') + '</div>';
}

// Los botones Todos / Semanales / Quincenales y qué se está contando.
function _renderDashPerFiltro(data) {
  const cont = document.getElementById('dash-cli-per');
  if (!cont) return;
  // Mensuales solo si hay alguno: un botón que siempre da vacío es ruido.
  const hayMensual = (AppData.clientes || []).some(c => _num(c.periodo_dias) === 28) || dashPerFilter === 28;
  const opciones = [[0, 'Todos'], [7, 'Semanales'], [14, 'Quincenales']].concat(hayMensual ? [[28, 'Mensuales']] : []);
  const v = data.ventana;
  const txt = v
    ? 'Cuenta el período de cada cliente que <strong>cierra</strong>' +
      (v.desde && v.hasta ? ' entre el ' + _ddmmIso(v.desde) + ' y el ' + _ddmmIso(v.hasta)
        : v.desde ? ' desde el ' + _ddmmIso(v.desde) : ' hasta el ' + _ddmmIso(v.hasta)) +
      ', completo: un quincenal aparece la semana en que cierra su quincena, con las dos semanas.' +
      (v.extendidaA ? ' La semana en curso cierra el jueves ' + _ddmmIso(v.extendidaA) + '.' : '')
    : 'Con <strong>Todo</strong> se cuenta todo lo entregado. Elegí fechas para ver qué se factura en ellas.';
  cont.innerHTML = '<div class="card" style="margin-bottom:14px;padding:10px 14px">' +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:12.5px;font-weight:600;color:var(--text-secondary)"><i class="ic ic-calendar"></i> Facturación</span>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + opciones.map(o =>
        '<button class="btn btn-sm dash-per-btn' + (dashPerFilter === o[0] ? ' active' : '') + '" data-per="' + o[0] + '" onclick="setDashPerFilter(' + o[0] + ')">' + o[1] + '</button>'
      ).join('') + '</div>' +
      '<span style="font-size:11.5px;color:var(--text-muted);flex:1;min-width:260px">' + txt + '</span>' +
    '</div></div>';
}

function renderDashClientes() {
  const body = document.getElementById('dash-cli-body');
  if (!body) return;
  renderDashFuga();   // lo que se paga y no se cobra, antes de la renta
  const data = dashFacturacionClientes();
  const todos = data.filas;
  const v = data.ventana;
  _renderDashPerFiltro(data);
  const q = (document.getElementById('dash-cli-search')?.value || '').toLowerCase().trim();
  const lista = todos.filter(x => !q || x.nombre.toLowerCase().includes(q) || x.cod.toLowerCase().includes(q));

  const factura = todos.reduce((s, x) => s + x.factura, 0);
  const costo = todos.reduce((s, x) => s + x.costo, 0);
  const margen = factura - costo;
  const pct = factura > 0 ? (margen * 100 / factura) : 0;
  const quienes = dashPerFilter ? DASH_PER_PLURAL[dashPerFilter].toLowerCase() : '';

  const kpis = document.getElementById('dash-cli-kpis');
  if (kpis) kpis.innerHTML =
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div>' +
      '<div class="metric-label">Facturación</div><div class="metric-value">' + fmtPeso(factura) + '</div>' +
      '<div class="metric-sub">' + (v
        ? todos.length + ' cliente(s)' + (quienes ? ' ' + quienes : '') + ' facturan' + (todos.some(x => x.enCurso) ? ' · incluye lo que va de la semana' : '')
        : todos.length + ' cliente(s)' + (quienes ? ' ' + quienes : '') + ' con envíos') + '</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-truck"></i></div>' +
      '<div class="metric-label">Costo</div><div class="metric-value">' + fmtPeso(costo) + '</div>' +
      '<div class="metric-sub">lo que se les paga a los conductores</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-trend"></i></div>' +
      '<div class="metric-label">Margen</div>' +
      '<div class="metric-value" style="color:' + (margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(margen) + '</div>' +
      '<div class="metric-sub">' + pct.toFixed(1) + '% de lo facturado</div></div>';

  // El filtro por condición es del lado del CONDUCTOR y acá no aplica: lo que se
  // le factura a un cliente no depende de quién se lo llevó, y filtrarlo daría
  // una "facturación" que no existe en ninguna factura. Se dice, en vez de
  // dejar que el operador crea que el filtro está puesto y no hizo nada.
  const nota = document.getElementById('dash-cli-nota');
  if (nota) nota.innerHTML = dashCondFilter
    ? '<div class="alert" style="margin:0 0 14px;background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd">' +
      '<i class="ic ic-alert"></i><div>El filtro <strong>' + dashCondLabel() + '</strong> es del lado del conductor y ' +
      'acá no se aplica: lo que se le factura a un cliente no depende de quién se lo llevó. Estos números son los del período completo.</div></div>'
    : '';

  // Los que entregaron en estas fechas y facturan más adelante: sin esto, un
  // quincenal que no cierra esta semana desaparece de la tabla y parece perdido.
  const nc = document.getElementById('dash-cli-nocierran');
  if (nc) {
    const n = data.noCierran.length;
    const lleva = data.noCierran.reduce((s, x) => s + x.lleva, 0);
    nc.innerHTML = n
      ? '<div class="alert alert-info" style="margin:14px 0 0"><i class="ic ic-calendar"></i><div>' +
        '<strong>' + n + ' cliente(s) tuvieron envíos en estas fechas y facturan más adelante</strong> — su período cierra después. ' +
        'Llevan <strong>' + fmtPeso(lleva) + '</strong> acumulado, que entra cuando cierren.' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' +
        data.noCierran.slice(0, 12).map(x =>
          '<span class="tag" style="background:var(--surface-1);border:1px solid var(--border);color:var(--text-primary);font-size:11px">' +
          x.nombre + ' · ' + periodoLabel(x.dias).toLowerCase() + ' · cierra el ' + _ddmmIso(x.cierra) + ' · lleva ' + fmtPeso(x.lleva) + '</span>'
        ).join('') + (n > 12 ? '<span style="font-size:11px;align-self:center">y ' + (n - 12) + ' más</span>' : '') +
        '</div></div></div>'
      : '';
  }

  const countEl = document.getElementById('dash-cli-count');
  if (countEl) countEl.textContent = lista.length === todos.length
    ? todos.length + ' cliente(s)'
    : lista.length + ' de ' + todos.length + ' cliente(s)';

  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-building"></i></div>' +
      '<div class="empty-title">' + (todos.length ? 'Sin coincidencias' : AppData._cargandoRegistros ? 'Cargando los envíos…' : v ? 'Nadie factura en estas fechas' : 'Sin clientes con envíos') + '</div>' +
      '<div class="empty-sub">' + (todos.length ? 'Ajustá el buscador'
        : AppData._cargandoRegistros ? 'La facturación se completa sola cuando terminan de bajar.'
        // El porqué depende del caso: si las fechas no llegan a ningún jueves no
        // cerró ni una semana; si llegan, es que el período cierra más adelante.
        : v ? 'Ningún ' + (quienes ? 'cliente ' + quienes.replace(/es$/, '') : 'cliente') + ' cierra su período en estas fechas. ' +
          (!_ventanaTieneJueves(v) ? 'Las semanas cierran los jueves y las quincenas el 15 y a fin de mes, y estas fechas no llegan a ningún cierre.'
            : data.noCierran.length ? 'Los que tuvieron envíos facturan más adelante: están en el aviso de arriba.' : '')
        : 'No hay envíos con cliente en el período elegido') + '</div></div></td></tr>';
    return;
  }

  body.innerHTML = lista.map(x => {
    const p = x.factura > 0 ? Math.round(x.margen * 100 / x.factura) : 0;
    const codEsc = jsAttr(x.cod);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(x.nombre) + '</div>' +
        '<div><strong>' + x.nombre + '</strong>' +
        (x.sinTarifa ? '<div style="font-size:10px;color:#b45309">⚠ ' + x.sinTarifa + ' sin tarifa</div>' : '') +
        '</div></div></td>' +
      '<td style="font-size:12px">' + _txtPeriodoFila(x) + '</td>' +
      '<td class="mono" style="text-align:right">' + x.envios + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(x.factura) + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--text-muted)">' + fmtPeso(x.costo) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700;color:' + (x.margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(x.margen) +
        '<div style="font-size:10px;color:var(--text-muted);font-weight:400">' + p + '%</div></td>' +
      '<td style="text-align:right"><button class="btn btn-sm" onclick="verRentaCliente(\'' + codEsc + '\')">Ver</button></td>' +
    '</tr>';
  }).join('');
}

// Renta de UN cliente, abierta por zona: dónde gana y dónde pierde. El total no
// alcanza — un cliente puede cerrar con buen margen y aun así estar perdiendo
// plata en dos zonas puntuales.
// Suma las liquidaciones de varios períodos de un cliente en una sola, juntando
// las zonas iguales (misma zona, mismo precio y misma condición especial).
function _sumarLiqsCliente(liqs) {
  if (liqs.length === 1) return liqs[0];
  const porZona = new Map();
  const out = { total: 0, pagado: 0, margen: 0, totalEnvios: 0, sinTarifa: 0, filas: [] };
  liqs.forEach(l => {
    ['total', 'pagado', 'margen', 'totalEnvios', 'sinTarifa'].forEach(c => { out[c] += _num(l[c]); });
    (l.filas || []).forEach(f => {
      const clave = f.zona + '|' + _num(f.precio) + '|' + (f.dim || '');
      const a = porZona.get(clave);
      if (!a) { porZona.set(clave, Object.assign({}, f)); return; }
      a.count = _num(a.count) + _num(f.count);
      a.subtotal = _num(a.subtotal) + _num(f.subtotal);
      a.pagado = _num(a.pagado) + _num(f.pagado);
    });
  });
  out.filas = Array.from(porZona.values());
  return out;
}
function verRentaCliente(cod) {
  const k = clienteKey(cod);
  // Los MISMOS períodos que la fila: si la tabla dice la quincena entera, el
  // detalle por zona no puede ser de la semana suelta.
  const v = _dashVentanaCierre();
  let periodos = v ? _periodosQueCierran(k, v, (v.desde && v.hasta) ? null : _limitesFechasRegistros()) : null;
  if (v && !periodos.length) periodos = [periodoClienteRango(k, v.hasta || _isoDash(new Date()))];
  const liqs = periodos
    ? _liqsPorPeriodo(k, periodos, (AppData.records || []).filter(r => clienteCodDeRegistro(r) === k))
    : [calcLiquidacionCliente(k, _dashRangoCliente())];
  const liq = _sumarLiqsCliente(liqs);
  const fila = _filaRenta(k, liqs, periodos || []);
  const subtitulo = periodos
    ? periodoLabel(fila.dias) + ' · ' + (periodos.length > 1 ? periodos.length + ' períodos · ' : '') + 'del ' +
      periodos[0].desde + ' al ' + periodos[periodos.length - 1].hasta + (fila.enCurso ? ' · en curso' : '')
    : dashPeriodoLabel();
  const pct = liq.total > 0 ? (liq.margen * 100 / liq.total) : 0;

  const filas = liq.filas.slice().sort((a, b) => (b.subtotal - b.pagado) - (a.subtotal - a.pagado));
  const cuerpo = filas.length ? filas.map(f => {
    const m = _num(f.subtotal) - _num(f.pagado);
    const p = f.subtotal > 0 ? Math.round(m * 100 / f.subtotal) : 0;
    return '<tr>' +
      '<td>' + f.zona + (f.dim ? ' <span class="badge" style="background:#fef3c7;color:#92400e;font-size:9px">especial</span>' : '') + '</td>' +
      '<td class="mono" style="text-align:right">' + f.count + '</td>' +
      '<td class="mono" style="text-align:right">' + (f.precio > 0 ? fmtPeso(f.precio) : '<span style="color:#b45309">sin tarifa</span>') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(f.subtotal) + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--text-muted)">' + fmtPeso(f.pagado) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700;color:' + (m >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(m) +
        '<div style="font-size:10px;font-weight:400;color:var(--text-muted)">' + p + '%</div></td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">Sin envíos en el período</td></tr>';

  document.getElementById('modal-title').textContent = 'Renta · ' + clienteNombreDe(k);
  document.getElementById('modal-body').innerHTML =
    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">' + subtitulo + '</div>' +
    '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      '<div class="metric-card"><div class="metric-label">Facturación</div><div class="metric-value">' + fmtPeso(liq.total) + '</div>' +
        '<div class="metric-sub">' + liq.totalEnvios + ' envíos</div></div>' +
      '<div class="metric-card"><div class="metric-label">Costo</div><div class="metric-value">' + fmtPeso(liq.pagado) + '</div>' +
        '<div class="metric-sub">a los conductores</div></div>' +
      '<div class="metric-card accent"><div class="metric-label">Margen</div>' +
        '<div class="metric-value" style="color:' + (liq.margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(liq.margen) + '</div>' +
        '<div class="metric-sub">' + pct.toFixed(1) + '% de lo facturado</div></div>' +
    '</div>' +
    (liq.sinTarifa ? '<div class="alert" style="margin:0 0 10px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-size:12px">' +
      '<i class="ic ic-alert"></i><div><strong>' + liq.sinTarifa + ' envío(s) en zonas sin tarifa de venta.</strong> ' +
      'Se facturan en $0 pero igual se le paga al conductor: hunden el margen sin que se note.</div></div>' : '') +
    '<div class="table-wrap" style="max-height:44vh;overflow:auto"><table>' +
      '<thead><tr><th>Zona</th><th style="text-align:right">Envíos</th><th style="text-align:right">Tarifa</th>' +
      '<th style="text-align:right">Factura</th><th style="text-align:right">Costo</th><th style="text-align:right">Margen</th></tr></thead>' +
      '<tbody>' + cuerpo + '</tbody></table></div>';
  document.getElementById('modal-backdrop').classList.add('open');
}

// ════════════════════════════════════════════════════════════════════════
//  CONTROL DE FUGA — lo que se paga y no se cobra
//  Un envío entregado siempre se le paga al conductor. Que se le facture a
//  alguien depende de tres cargas separadas (que el envío traiga cliente, que
//  el cliente esté de alta y que tenga tarifa en esa zona). Si falla una, el
//  envío se factura $0 y NO aparece en la liquidación de ningún cliente: no hay
//  ningún lugar donde se note el faltante. Por eso el control va acá arriba,
//  antes de la renta, y no escondido en un filtro.
// ════════════════════════════════════════════════════════════════════════
let dashFugaAbierto = false;
function toggleDashFuga() { dashFugaAbierto = !dashFugaAbierto; renderDashFuga(); }

function renderDashFuga() {
  const cont = document.getElementById('dash-fuga');
  if (!cont || typeof conciliacionCobro !== 'function') return;
  const c = conciliacionCobro(_dashRangoCliente());

  if (!c.envios) { cont.innerHTML = ''; return; }
  // El reverso: envíos que se facturan pero cuyo conductor no tiene día de pago,
  // así que no entran en ningún lote de liquidación. Se muestra siempre, aunque
  // del otro lado esté todo bien: son dos fugas distintas.
  const rev = _bloqueSinPagar(c.sinPagar);
  if (!c.fugaEnvios) {
    cont.innerHTML = '<div class="alert" style="margin:16px 0 0;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0">' +
      '<i class="ic ic-check-circle"></i><div><strong>Todo lo que se paga se cobra</strong> — ' +
      'los ' + c.envios.toLocaleString('es-AR') + ' envíos del período se le facturan a un cliente.</div></div>' + rev;
    return;
  }

  const pct = (c.fugaEnvios * 100 / c.envios);
  const motivos = Object.entries(c.porMotivo).filter(([, v]) => v.envios > 0)
    .sort((a, b) => b[1].pagado - a[1].pagado)
    .map(([k, v]) => {
      const m = FUGA_MOTIVOS[k] || { label: k, detalle: '', color: '#b45309' };
      return '<div style="border-left:3px solid ' + m.color + ';padding:2px 0 2px 8px">' +
        '<div style="font-size:12px;font-weight:700">' + m.label + ' · ' + v.envios.toLocaleString('es-AR') + ' envío(s)</div>' +
        '<div style="font-size:11px;opacity:.85">' + fmtPeso(v.pagado) + ' pagados · ' + m.detalle + '</div></div>';
    }).join('');

  const filas = c.clientes.slice(0, 12).map(x => {
    const zonas = Array.from(x.zonas.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([z, n]) => z + ' (' + n + ')').join(', ');
    const etq = Array.from(x.motivos).map(m => (FUGA_MOTIVOS[m] || {}).label || m).join(' · ');
    return '<tr>' +
      '<td><strong>' + x.nombre + '</strong>' + (x.cod !== x.nombre ? '<div style="font-size:10px;color:var(--text-muted)">' + x.cod + '</div>' : '') + '</td>' +
      '<td style="font-size:11px">' + etq + '</td>' +
      '<td style="font-size:11px;color:var(--text-muted)">' + (zonas || '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + x.envios.toLocaleString('es-AR') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.pagado) + '</td>' +
      '</tr>';
  }).join('');

  cont.innerHTML =
    '<div class="alert" style="margin:16px 0 0;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
    '<i class="ic ic-alert"></i><div>' +
      '<strong>' + c.fugaEnvios.toLocaleString('es-AR') + ' de ' + c.envios.toLocaleString('es-AR') +
      ' envíos (' + pct.toFixed(1) + '%) se pagan y no se le facturan a nadie</strong> — ' +
      '<strong>' + fmtPeso(c.fugaPagado) + '</strong> pagados a conductores que no se cobran. ' +
      'Esos envíos no salen en la liquidación de ningún cliente, así que no aparecen como faltante en ningún lado.' +
      '<div style="display:grid;gap:6px;margin:10px 0">' + motivos + '</div>' +
      '<button class="btn btn-sm" onclick="toggleDashFuga()">' +
        (dashFugaAbierto ? 'Ocultar el detalle' : 'Ver qué clientes son') + '</button>' +
      (dashFugaAbierto
        ? '<div class="table-wrap" style="margin-top:10px;background:var(--surface-1);border-radius:8px">' +
          '<table><thead><tr><th>Cliente</th><th>Falta</th><th>Zonas</th>' +
          '<th style="text-align:right">Envíos</th><th style="text-align:right">Pagado</th></tr></thead>' +
          '<tbody>' + filas + '</tbody></table>' +
          (c.clientes.length > 12 ? '<div style="padding:6px 10px;font-size:11px;color:var(--text-muted)">…y ' + (c.clientes.length - 12) + ' cliente(s) más</div>' : '') +
          '</div>'
        : '') +
    '</div></div>' + rev;
}

// Bloque del reverso: envíos que se facturan pero que no entran en ninguna
// liquidación de conductor. La condición (día de pago) se carga a mano en el
// Panel de conductores; sin ella el cadete no cae en ningún lote y el operador,
// que liquida por condición, nunca lo ve.
// Envíos entregados que se le facturan al cliente y que NO entran en la
// liquidación de ningún conductor. Son DOS situaciones distintas y se muestran
// separadas: el cadete sin día de pago (un dato que falta, se carga y cobra) y
// el envío sin chofer (política: no se paga, se cobra igual).
function _bloqueSinPagar(sp) {
  const mensual = _bloqueSinChofer();
  if (!sp || !sp.envios) return mensual;
  const filas = sp.conductores.slice(0, 10).map(x =>
    '<tr>' +
    '<td><strong>' + x.conductor + '</strong></td>' +
    '<td style="font-size:11px">' + (x.enPanel ? 'está en el panel, sin condición' : 'no está en el Panel de conductores') + '</td>' +
    '<td class="mono" style="text-align:right">' + x.envios.toLocaleString('es-AR') + '</td>' +
    '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.cobrado) + '</td>' +
    '</tr>').join('');
  return '<div class="alert" style="margin:12px 0 0;background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd">' +
    '<i class="ic ic-truck"></i><div>' +
      '<strong>' + sp.envios.toLocaleString('es-AR') + ' envíos entregados no entran en ninguna liquidación de conductor</strong> — ' +
      'se le facturan al cliente (' + fmtPeso(sp.cobrado) + ') pero el cadete que los hizo <strong>no tiene día de pago</strong>. ' +
      'La condición (Titular y Semi Titular=viernes · Suplente=martes) se carga en <strong>Panel de conductores</strong>; ' +
      'sin ella no cae en ningún lote y el operador que liquida por condición no lo ve.' +
      '<div class="table-wrap" style="margin-top:10px;background:var(--surface-1);border-radius:8px">' +
      '<table><thead><tr><th>Conductor</th><th>Qué falta</th>' +
      '<th style="text-align:right">Envíos</th><th style="text-align:right">Se factura</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table>' +
      (sp.conductores.length > 10 ? '<div style="padding:6px 10px;font-size:11px;color:var(--text-muted)">…y ' + (sp.conductores.length - 10) + ' conductor(es) más</div>' : '') +
      '</div>' +
    '</div></div>' + mensual;
}

// ── SIN CHOFER, mes a mes ───────────────────────────────────────────────
// No es un problema a resolver: es la política —asignarse el envío es
// responsabilidad del chofer, así que no se le paga a nadie y se le factura al
// cliente igual—. Lo que hace falta es el número: cuántos son cada mes y cuánta
// plata mueven. Va sobre TODA la base cargada, no sobre el filtro de arriba,
// porque lo que se mira es la tendencia — y por eso dice qué ventana está
// midiendo: con los últimos 14 días, "por mes" es medio mes.
function _bloqueSinChofer() {
  if (typeof enviosSinChoferPorMes !== 'function') return '';
  const d = enviosSinChoferPorMes();
  if (!d.envios) return '';
  const completo = !!AppData.historialCompleto;
  const ventana = completo
    ? 'Sobre el historial completo.'
    : 'Sobre los últimos ' + (typeof VENTANA_DIAS_REGISTROS !== 'undefined' ? VENTANA_DIAS_REGISTROS : 14) +
      ' días cargados — para ver los meses enteros hace falta el historial completo.';
  const filas = d.meses.slice(0, 12).map(m => {
    const top = Array.from(m.clientes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([n, c]) => n + ' (' + c + ')').join(', ');
    return '<tr>' +
      '<td><strong>' + _mesLargo(m.mes) + '</strong></td>' +
      '<td class="mono" style="text-align:right">' + m.envios.toLocaleString('es-AR') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(m.cobrado) + '</td>' +
      '<td style="font-size:11px;color:var(--text-muted)">' + (top || '—') + '</td>' +
      '</tr>';
  }).join('');
  return '<div class="alert" style="margin:12px 0 0;background:#faf5ff;color:#5b21b6;border:1px solid #d8b4fe">' +
    '<i class="ic ic-truck"></i><div>' +
      '<strong>' + d.envios.toLocaleString('es-AR') + ' envíos entregados llegaron SIN chofer asignado</strong> — ' +
      'se le facturan al cliente (' + fmtPeso(d.cobrado) + ') y <strong>no se le pagan a nadie</strong>. ' +
      'Asignarse el envío es responsabilidad del chofer: no hay nada que corregir acá, ' +
      'pero sí hay que ver cuánto pesa mes a mes.' +
      '<div style="font-size:11px;opacity:.8;margin-top:4px">' + ventana +
      (completo ? '' : ' <button class="btn btn-sm" style="padding:1px 7px;font-size:10px;margin-left:4px" onclick="cargarHistorialCompleto(this)">Cargar historial completo</button>') +
      '</div>' +
      '<div class="table-wrap" style="margin-top:10px;background:var(--surface-1);border-radius:8px">' +
      '<table><thead><tr><th>Mes</th><th style="text-align:right">Envíos</th>' +
      '<th style="text-align:right">Se factura</th><th>Clientes</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
    '</div></div>';
}

const _MESES_LARGO = ['enero','febrero','marzo','abril','mayo','junio','julio',
  'agosto','septiembre','octubre','noviembre','diciembre'];
function _mesLargo(yyyymm) {
  const p = String(yyyymm || '').split('-');
  if (p.length < 2) return yyyymm || '—';
  return _MESES_LARGO[(+p[1]) - 1] + ' ' + p[0];
}
