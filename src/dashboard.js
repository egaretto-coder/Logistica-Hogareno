function getZonaEfectiva(r) {
  return (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
}

// Estado del filtro de condición en dashboard
let dashCondFilter = '';

function setDashCondFilter(btn, cond) {
  dashCondFilter = cond;
  document.querySelectorAll('.dash-cond-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
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
function invalidarFiltroFecha() { _filtroCache = null; }
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
  const recordsFiltrados = filtrarRecordsPorFecha(AppData.records);

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
  const labelEl = document.getElementById('dash-fecha-label');
  if (labelEl) labelEl.textContent = labelPeriodo;

  const promedioPorConductor = conductores.length ? Math.round(totalMonto / conductores.length) : 0;

  document.getElementById('metric-total').textContent = fmtPeso(totalMonto);
  document.getElementById('metric-sub-total').textContent = totalEntregados + ' entregados · ' + totalExcluidos + ' en otros estados';
  document.getElementById('metric-conductores').textContent = conductores.length;
  document.getElementById('metric-promedio').textContent = fmtPeso(promedioPorConductor);
  document.getElementById('metric-promedio-sub').textContent = conductores.length + ' conductores en el período';
  document.getElementById('metric-panel-total').textContent = AppData.panelConductores.length;
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

// Rango del filtro del dashboard en el formato que usa la facturación.
function _dashRangoCliente() {
  const r = getDashFechaRango();
  return { desdeD: r && r.desde ? r.desde : null, hastaD: r && r.hasta ? r.hasta : null };
}

// Renta por cliente en el período: lo facturado, lo que costó y la diferencia.
function dashRentaClientes() {
  const rango = _dashRangoCliente();
  const clientes = (typeof clientesDeRegistros === 'function') ? clientesDeRegistros(rango) : [];
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
  return clientes.map(c => {
    const liq = calcLiquidacionCliente(c.cod, rango, { registros: porCliente.get(clienteKey(c.cod)) || vacio });
    return {
      cod: c.cod, nombre: clienteNombreDe(c.cod),
      envios: liq.totalEnvios, factura: liq.total, costo: liq.pagado,
      margen: liq.margen, sinTarifa: liq.sinTarifa
    };
  }).filter(x => x.envios > 0).sort((a, b) => b.margen - a.margen);
}

function renderDashClientes() {
  const body = document.getElementById('dash-cli-body');
  if (!body) return;
  renderDashFuga();   // lo que se paga y no se cobra, antes de la renta
  const todos = dashRentaClientes();
  const q = (document.getElementById('dash-cli-search')?.value || '').toLowerCase().trim();
  const lista = todos.filter(x => !q || x.nombre.toLowerCase().includes(q) || x.cod.toLowerCase().includes(q));

  const factura = todos.reduce((s, x) => s + x.factura, 0);
  const costo = todos.reduce((s, x) => s + x.costo, 0);
  const margen = factura - costo;
  const pct = factura > 0 ? (margen * 100 / factura) : 0;

  const kpis = document.getElementById('dash-cli-kpis');
  if (kpis) kpis.innerHTML =
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div>' +
      '<div class="metric-label">Facturación</div><div class="metric-value">' + fmtPeso(factura) + '</div>' +
      '<div class="metric-sub">' + todos.length + ' cliente(s) con envíos</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-truck"></i></div>' +
      '<div class="metric-label">Costo</div><div class="metric-value">' + fmtPeso(costo) + '</div>' +
      '<div class="metric-sub">lo que se les paga a los conductores</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-trend"></i></div>' +
      '<div class="metric-label">Margen</div>' +
      '<div class="metric-value" style="color:' + (margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(margen) + '</div>' +
      '<div class="metric-sub">' + pct.toFixed(1) + '% de lo facturado</div></div>';

  const countEl = document.getElementById('dash-cli-count');
  if (countEl) countEl.textContent = lista.length === todos.length
    ? todos.length + ' cliente(s)'
    : lista.length + ' de ' + todos.length + ' cliente(s)';

  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon"><i class="ic ic-building"></i></div>' +
      '<div class="empty-title">Sin clientes con envíos</div>' +
      '<div class="empty-sub">' + (todos.length ? 'Ajustá el buscador' : 'No hay envíos con cliente en el período elegido') + '</div></div></td></tr>';
    return;
  }

  body.innerHTML = lista.map(x => {
    const p = x.factura > 0 ? Math.round(x.margen * 100 / x.factura) : 0;
    const codEsc = String(x.cod).replace(/'/g, "\\'");
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(x.nombre) + '</div>' +
        '<div><strong>' + x.nombre + '</strong>' +
        (x.sinTarifa ? '<div style="font-size:10px;color:#b45309">⚠ ' + x.sinTarifa + ' sin tarifa</div>' : '') +
        '</div></div></td>' +
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
function verRentaCliente(cod) {
  const k = clienteKey(cod);
  const rango = _dashRangoCliente();
  const liq = calcLiquidacionCliente(k, rango);
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
    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">' + dashPeriodoLabel() + '</div>' +
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
function _bloqueSinPagar(sp) {
  if (!sp || !sp.envios) return '';
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
    '</div></div>';
}
