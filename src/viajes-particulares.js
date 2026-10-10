// ════════════════════════════════════════════════════════════════════════
//  VIAJES PARTICULARES
//
//  Un servicio nuevo y DISTINTO del reparto: el cliente pide una ruta y se le
//  cotiza a un valor FIJO de tabla, por vehículo y por tramo. No hay zona, no
//  hay tracking, no hay tarifario por localidad — la parametrización es otra y
//  por eso el precio también.
//
//  POR QUÉ NO SON `registros`. Meterlos ahí haría que el viaje entre solo en
//  las dos liquidaciones, que es tentador, pero rompería todo lo que cuelga de
//  un envío: el conteo de envíos del Dashboard, el costo por envío, el reporte
//  por zona, la deduplicación por clave del import y el archivo por cierre. Un
//  viaje no es un envío y contarlo como uno ensuciaría el número con el que se
//  discute una tarifa. Vive en su propia tabla y se engancha a mano en los dos
//  únicos lugares donde tiene que aparecer: el neto del conductor y el total
//  del cliente.
//
//  MUEVE LAS DOS PUNTAS, igual que un envío:
//    · se le PAGA al conductor  → `costo`, entra en imputacionesConductor()
//    · se le FACTURA al cliente → `venta`, entra en calcLiquidacionCliente()
//  Las dos cifras salen de DOS tarifarios distintos (mismo criterio que las
//  dimensiones especiales): lo que se paga y lo que se cobra no tienen por qué
//  moverse juntos, y el margen es justamente la diferencia.
//
//  OJO CON EL DOBLE COBRO. Ya existía un camino para esto: el cargo
//  "viaje particular" de `cliente_cargos`, que es para el viaje que NO tiene a
//  quién pagarle. Un viaje cargado acá ya factura al cliente, así que sumarle
//  además ese cargo lo cobraría DOS VECES. El alta lo mira y avisa.
//
//  EL TARIFARIO RIGE DESDE UNA FECHA, desde el día uno. Es la lección que este
//  proyecto ya pagó dos veces —en el tarifario de clientes y en el de
//  conductores—: sin vigencia, cargar un aumento reescribe el precio de lo que
//  ya se facturó y se pagó, y el papel que el cliente tiene en la mano deja de
//  coincidir.
// ════════════════════════════════════════════════════════════════════════

const VP_VEHICULOS = { moto: 'Moto', utilitario: 'Utilitario', furgon: 'Furgón' };
// Las dos formas de cotizar. "Especial Transportes" es el acuerdo por cantidad
// de paradas en vez de por distancia, y no existe en moto.
const VP_MODALIDADES = {
  km:      { label: 'Por kilómetros',      unidad: 'km',      corto: 'km' },
  paradas: { label: 'Especial Transportes', unidad: 'paradas', corto: 'par.' }
};
const VP_ESTADOS = { pendiente: 'Programado', realizado: 'Realizado', cancelado: 'Cancelado' };
// Qué puede hacer cada conductor. Un cadete de reparto es "flex"; los que hacen
// estas rutas son "particular"; y hay quien hace las dos cosas.
const VP_SERVICIOS = { flex: 'Flex (reparto)', particular: 'Viajes particulares', ambos: 'Flex y viajes' };
// Anterior a cualquier viaje: una tarifa sin vigencia cargada aplica a todo.
const VP_DESDE_SIEMPRE = '2000-01-01';

function vpVehiculoLabel(v) { return VP_VEHICULOS[v] || v || '—'; }
function vpModalidadLabel(m) { return (VP_MODALIDADES[m] || {}).label || m || '—'; }
function vpUnidad(m) { return (VP_MODALIDADES[m] || {}).unidad || ''; }

// ════════════════════════════════════════════════════════════════════════
//  EL TARIFARIO
// ════════════════════════════════════════════════════════════════════════

function vpVigenteDesde(t) {
  const v = String((t && t.vigente_desde) || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : VP_DESDE_SIEMPRE;
}

function vpHoyISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Las tarifas que REGÍAN en una fecha: una sola fila por (vehículo, modalidad,
// tramo), la última lista que ya había empezado. Sin esto la grilla mostraría
// cada tramo repetido una vez por aumento, y el selector del modal ofrecería
// el precio viejo y el nuevo uno debajo del otro.
function vpTarifasVigentes(fechaISO) {
  const f = fechaISO || vpHoyISO();
  const m = new Map();
  (AppData.viajeTarifas || []).forEach(t => {
    const d = vpVigenteDesde(t);
    if (d > f) return;                       // esa lista todavía no empezó a regir
    const k = t.vehiculo + '|' + t.modalidad + '|' + _num(t.tramo);
    const prev = m.get(k);
    if (!prev || vpVigenteDesde(prev) <= d) m.set(k, t);
  });
  return Array.from(m.values());
}

// Los tramos cargados para un vehículo y una modalidad, de menor a mayor.
function vpTramosDe(vehiculo, modalidad, fechaISO) {
  return vpTarifasVigentes(fechaISO)
    .filter(t => t.vehiculo === vehiculo && t.modalidad === modalidad)
    .sort((a, b) => _num(a.tramo) - _num(b.tramo));
}

// La tarifa exacta de un tramo. null = ese tramo no tiene precio acordado a esa
// fecha, que NO es lo mismo que un precio de $0.
function vpTarifaDe(vehiculo, modalidad, tramo, fechaISO) {
  const t = vpTarifasVigentes(fechaISO).find(x =>
    x.vehiculo === vehiculo && x.modalidad === modalidad && _num(x.tramo) === _num(tramo));
  return t ? { costo: _num(t.costo), venta: _num(t.venta), tramo: _num(t.tramo) } : null;
}

// El tramo que CUBRE un valor: el más chico cuyo tope lo alcanza ("hasta 50 km"
// cubre 37 km). Si se pasa del último, devuelve null — no se estira el último
// tramo, porque eso cobraría 300 km al precio de 200 sin que nadie lo note.
function vpTramoQueCubre(vehiculo, modalidad, valor, fechaISO) {
  const v = _num(valor);
  if (!(v > 0)) return null;
  const t = vpTramosDe(vehiculo, modalidad, fechaISO).find(x => v <= _num(x.tramo));
  return t ? _num(t.tramo) : null;
}

// El margen de una fila del tarifario, en porcentaje sobre el costo.
function vpMargenPct(costo, venta) {
  const c = _num(costo);
  return c > 0 ? ((_num(venta) - c) / c) * 100 : null;
}

// El margen que se repite en el tarifario (la MEDIANA, no el promedio: un solo
// renglón mal cargado no puede mover la referencia contra la que se comparan
// todos los demás). Es lo que permite señalar la fila que se salió de la escala.
function vpMargenTipico(fechaISO) {
  const pcts = vpTarifasVigentes(fechaISO)
    .map(t => vpMargenPct(t.costo, t.venta))
    .filter(p => p != null && isFinite(p))
    .sort((a, b) => a - b);
  if (!pcts.length) return null;
  const mid = Math.floor(pcts.length / 2);
  return pcts.length % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;
}

// ════════════════════════════════════════════════════════════════════════
//  LOS VIAJES
// ════════════════════════════════════════════════════════════════════════

// Un viaje PROGRAMADO todavía no se hizo y uno CANCELADO no se hizo nunca:
// ninguno de los dos se paga ni se factura. Solo el realizado mueve plata.
function vpContabiliza(v) { return String((v && v.estado) || 'realizado') === 'realizado'; }

function vpViajes() { return AppData.viajesParticulares || []; }

function vpViajePorId(id) {
  return vpViajes().find(v => String(v.id) === String(id)) || null;
}

// ── Lo que se le PAGA al conductor en un período ─────────────────────────
// Misma forma que kmAdicionalConductor / recorridoEspecialConductor, para que
// imputacionesConductor los trate a todos igual.
function viajesDeConductor(conductor, rango) {
  const key = conductorKey(conductor);
  if (!key) return { monto: 0, n: 0, detalle: [] };
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let monto = 0, n = 0;
  const detalle = [];
  vpViajes().forEach(v => {
    if (!vpContabiliza(v)) return;
    if (conductorKey(v.conductor) !== key) return;
    if (desde || hasta) {
      const f = parseFechaReg(v.fecha);
      if (!f) return;                       // sin fecha no entra en un período
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    monto += _num(v.costo); n++;
    detalle.push({
      id: v.id, fecha: v.fecha || '', cliente: v.cliente || v.cliente_cod || '',
      vehiculo: v.vehiculo, modalidad: v.modalidad, tramo: _num(v.tramo),
      origen: v.origen || '', destino: v.destino || '', monto: _num(v.costo)
    });
  });
  detalle.sort((a, b) => {
    const fa = parseFechaReg(a.fecha), fb = parseFechaReg(b.fecha);
    return (fa ? fa.getTime() : Infinity) - (fb ? fb.getTime() : Infinity);
  });
  return { monto, n, detalle };
}

// Conductores (canónicos) con viajes realizados en SU semana. El panel de
// Liquidación de Conductores arma su listado desde los ENVÍOS, así que un
// conductor que solo hace viajes particulares no aparecería en ningún lote y
// no se le pagaría nunca — que es exactamente el agujero que el control de
// fuga ya detecta del otro lado.
function vpConductoresDeLaSemana(isoRef) {
  const out = new Map();
  const cacheSem = new Map();
  vpViajes().forEach(v => {
    if (!vpContabiliza(v)) return;
    const cond = (typeof conductorCanonico === 'function' ? conductorCanonico(v.conductor) : v.conductor) || '';
    if (!cond) return;                      // viaje sin conductor: no se le paga a nadie
    const f = parseFechaReg(v.fecha);
    if (!f) return;
    let sem = cacheSem.get(cond);
    if (!sem) {
      sem = (typeof semanaDeConductor === 'function') ? semanaDeConductor(cond, isoRef) : null;
      if (!sem) return;
      cacheSem.set(cond, sem);
    }
    if (f < sem.desde || f > sem.hasta) return;
    out.set(cond, (out.get(cond) || 0) + 1);
  });
  return out;
}

// ── Lo que se le FACTURA al cliente ──────────────────────────────────────
// Dos lecturas, igual que los cargos: por el PERÍODO en que se cobra (la
// factura) y por la FECHA en que se prestó (el Dashboard, que cuenta lo que se
// movió entre dos días).
function vpViajesDeSemana(cod, semana) {
  const k = clienteKey(cod);
  if (!k || !semana) return [];
  return vpViajes()
    .filter(v => vpContabiliza(v) && clienteKey(v.cliente_cod) === k &&
      vpAnclaDe(k, v) === semana)
    .sort((a, b) => _num(a.id) - _num(b.id));
}

// En qué período se COBRA este viaje. `semana` seteada lo arrastra a otra
// factura (mismo mecanismo que registros.factura_semana); sin ella, el período
// que contiene su fecha. Se compara por el período que la contiene y no por
// igualdad: si el cliente cambia de ciclo, las anclas viejas son viernes y el
// período nuevo abre el 1 o el 16.
function vpAnclaDe(cod, v) {
  const arr = String((v && v.semana) || '').slice(0, 10);
  if (arr) return (typeof anclaDePeriodo === 'function') ? anclaDePeriodo(cod, arr) : arr;
  const f = parseFechaReg(v && v.fecha);
  if (!f) return null;
  const iso = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  const rc = (typeof periodoClienteRango === 'function') ? periodoClienteRango(cod, iso) : null;
  return rc ? (typeof viernesDeRango === 'function' ? viernesDeRango(rc) : null) : null;
}

function vpViajesEntreFechas(cod, desdeD, hastaD) {
  const k = clienteKey(cod);
  if (!k) return [];
  return vpViajes().filter(v => {
    if (!vpContabiliza(v) || clienteKey(v.cliente_cod) !== k) return false;
    if (!desdeD && !hastaD) return true;
    const f = parseFechaReg(v.fecha);
    if (!f) return false;
    if (desdeD && f < desdeD) return false;
    if (hastaD && f > hastaD) return false;
    return true;
  }).sort((a, b) => _num(a.id) - _num(b.id));
}

// Clientes con viajes en un rango, para que el panel y el selector los ofrezcan
// aunque no tengan un solo envío. Sin esto, un cliente que solo contrata viajes
// no existe para ninguna pantalla de facturación.
function vpClientesEnRango(rango) {
  const m = new Map();
  vpViajes().forEach(v => {
    if (!vpContabiliza(v)) return;
    const k = clienteKey(v.cliente_cod);
    if (!k) return;
    if (rango && (rango.desdeD || rango.hastaD)) {
      const f = parseFechaReg(v.fecha);
      if (!f) return;
      if (rango.desdeD && f < rango.desdeD) return;
      if (rango.hastaD && f > rango.hastaD) return;
    }
    let x = m.get(k);
    if (!x) { x = { cod: k, nombre: String(v.cliente || '').trim() || k, viajes: 0 }; m.set(k, x); }
    x.viajes++;
  });
  return Array.from(m.values());
}

// Lo que movieron los viajes de un conjunto de conductores en un rango. Lo usa
// el Dashboard para DECIR lo que su tarjeta deja afuera: un número que excluye
// una línea entera de servicio, sin avisarlo, es un número que miente.
function vpTotalDeConductores(rango, conductores) {
  const desde = rango && rango.desde ? new Date(rango.desde) : null;
  const hasta = rango && rango.hasta ? new Date(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let total = 0, n = 0;
  vpViajes().forEach(v => {
    if (!vpContabiliza(v)) return;
    const cond = (typeof conductorCanonico === 'function' ? conductorCanonico(v.conductor) : v.conductor) || '';
    if (!cond) return;
    // El MISMO universo de conductores que los KPI, así el filtro por condición
    // mueve las dos cosas.
    if (conductores && !conductores.has(conductorKey(cond))) return;
    const f = parseFechaReg(v.fecha);
    if (!f) return;
    if (desde && f < desde) return;
    if (hasta && f > hasta) return;
    total += _num(v.costo); n++;
  });
  return { total, n };
}

// Una línea para el PDF y la tabla: "Moto · hasta 50 km · Rosario → CABA".
function vpDetalleTxt(v) {
  const p = [vpVehiculoLabel(v.vehiculo)];
  if (_num(v.tramo) > 0) p.push('hasta ' + _num(v.tramo) + ' ' + vpUnidad(v.modalidad));
  const ruta = [String(v.origen || '').trim(), String(v.destino || '').trim()].filter(Boolean);
  if (ruta.length) p.push(ruta.join(' a '));
  const d = String(v.detalle || '').trim();
  if (d) p.push(d);
  return p.join('  ·  ');
}

// ════════════════════════════════════════════════════════════════════════
//  PANTALLA
// ════════════════════════════════════════════════════════════════════════

// La solapa abierta se recuerda: el re-render de la sincronización en vivo pasa
// por showPage, y con la primera hardcodeada se le cerraba sola al operador.
let vpTab = 'viajes';
function switchViajesTab(t) {
  vpTab = t;
  renderViajesParticulares();
}

function renderViajesParticularesPagina() { renderViajesParticulares(); }

function renderViajesParticulares() {
  const wrap = document.getElementById('page-viajes-particulares');
  if (!wrap) return;
  ['viajes', 'tarifario'].forEach(t => {
    const pane = document.getElementById('vp-tab-' + t);
    if (pane) pane.style.display = (t === vpTab) ? '' : 'none';
    const btn = document.getElementById('vp-btn-' + t);
    if (btn) btn.classList.toggle('active', t === vpTab);
  });
  if (vpTab === 'tarifario') renderVpTarifario();
  else renderVpListado();
}

// ── Solapa VIAJES ───────────────────────────────────────────────────────
function vpListaFiltrada() {
  const q = (document.getElementById('vp-search')?.value || '').toLowerCase().trim();
  let lista = vpViajes().slice();
  if (typeof filtrarPorMesPanel === 'function') lista = filtrarPorMesPanel('vp', lista);
  if (q) {
    lista = lista.filter(v =>
      String(v.cliente || '').toLowerCase().includes(q) ||
      String(v.cliente_cod || '').toLowerCase().includes(q) ||
      String(v.conductor || '').toLowerCase().includes(q) ||
      String(v.origen || '').toLowerCase().includes(q) ||
      String(v.destino || '').toLowerCase().includes(q) ||
      String(v.detalle || '').toLowerCase().includes(q));
  }
  return lista.sort((a, b) => {
    const fa = parseFechaReg(a.fecha), fb = parseFechaReg(b.fecha);
    return (fb ? fb.getTime() : 0) - (fa ? fa.getTime() : 0) || _num(b.id) - _num(a.id);
  });
}

function renderVpListado() {
  if (typeof _pintarPanelMes === 'function') _pintarPanelMes('vp');
  const lista = vpListaFiltrada();
  const hechos = lista.filter(vpContabiliza);
  const costo = hechos.reduce((s, v) => s + _num(v.costo), 0);
  const venta = hechos.reduce((s, v) => s + _num(v.venta), 0);
  const margen = venta - costo;
  const pend = lista.filter(v => v.estado === 'pendiente').length;
  const q = (document.getElementById('vp-search')?.value || '').trim();

  const kpis = document.getElementById('vp-kpis');
  if (kpis) {
    kpis.className = 'metrics-grid';
    kpis.style.cssText = 'grid-template-columns:repeat(4,1fr);margin-bottom:16px';
    kpis.innerHTML =
      '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-route"></i></div>' +
        '<div class="metric-label">Viajes realizados' + (q ? ' (filtrado)' : '') + '</div>' +
        '<div class="metric-value">' + hechos.length + '</div>' +
        '<div class="metric-sub">' + (pend ? pend + ' programado(s) sin hacer' : 'sin viajes programados') + '</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-dollar"></i></div>' +
        '<div class="metric-label">Se factura</div><div class="metric-value">' + fmtPeso(venta) + '</div>' +
        '<div class="metric-sub">entra en la liquidación de cada cliente</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-truck"></i></div>' +
        '<div class="metric-label">Se paga</div><div class="metric-value">' + fmtPeso(costo) + '</div>' +
        '<div class="metric-sub">suma al neto de cada conductor</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-trend"></i></div>' +
        '<div class="metric-label">Margen</div>' +
        '<div class="metric-value"' + (margen < 0 ? ' style="color:#b91c1c"' : '') + '>' + fmtPeso(margen) + '</div>' +
        '<div class="metric-sub">' + (venta > 0 ? (Math.round(margen * 1000 / venta) / 10) + '% de lo facturado' : '—') + '</div></div>';
  }

  const cont = document.getElementById('vp-count');
  if (cont) cont.textContent = q
    ? 'Mostrando ' + lista.length + ' de ' + vpViajes().length + ' viajes'
    : lista.length + ' viaje(s)';

  const body = document.getElementById('vp-rows');
  if (!body) return;
  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon"><i class="ic ic-route"></i></div>' +
      '<div class="empty-title">Sin viajes en este período</div>' +
      '<div class="empty-sub">Cargá uno con "+ Agregar viaje", o mirá otro mes</div></div></td></tr>';
    return;
  }
  body.innerHTML = lista.map(v => {
    const m = _num(v.venta) - _num(v.costo);
    const tar = vpTarifaDe(v.vehiculo, v.modalidad, v.tramo, _vpFechaISO(v.fecha));
    const pisado = !tar || _num(tar.costo) !== _num(v.costo) || _num(tar.venta) !== _num(v.venta);
    const sinCond = !String(v.conductor || '').trim();
    return '<tr' + (vpContabiliza(v) ? '' : ' style="opacity:.55"') + '>' +
      '<td class="mono" style="white-space:nowrap">' + (v.fecha || '—') + '</td>' +
      '<td><strong>' + (v.cliente || v.cliente_cod || '—') + '</strong>' +
        '<div class="muted" style="font-size:10px">' + (v.cliente_cod || '') + '</div></td>' +
      '<td>' + (sinCond
        ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74" title="Nadie de la empresa lo hizo: se le factura al cliente y no se le paga a nadie">sin conductor</span>'
        : v.conductor) + '</td>' +
      '<td>' + vpVehiculoLabel(v.vehiculo) +
        '<div class="muted" style="font-size:10px">hasta ' + _num(v.tramo) + ' ' + vpUnidad(v.modalidad) +
        (v.modalidad === 'paradas' ? ' · Especial' : '') + '</div></td>' +
      '<td style="font-size:11.5px">' + ([v.origen, v.destino].filter(Boolean).join(' → ') || '—') +
        (v.detalle ? '<div class="muted" style="font-size:10px">' + v.detalle + '</div>' : '') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(_num(v.costo)) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(_num(v.venta)) + '</td>' +
      '<td class="mono" style="text-align:right;color:' + (m < 0 ? '#b91c1c' : '#166534') + '">' + fmtPeso(m) +
        (pisado ? ' <span title="El costo o la venta no son los del tarifario a esa fecha: se escribieron a mano">✎</span>' : '') + '</td>' +
      '<td><div style="display:flex;gap:4px;align-items:center;justify-content:flex-end">' +
        '<span class="badge ' + (v.estado === 'realizado' ? 'badge-green' : 'badge-gray') + '">' +
          (VP_ESTADOS[v.estado] || v.estado) + '</span>' +
        '<button class="btn btn-sm" onclick="editarViaje(\'' + jsAttr(String(v.id)) + '\')" title="Editar"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" onclick="eliminarViaje(\'' + jsAttr(String(v.id)) + '\')" title="Eliminar" style="border-color:#fca5a5;color:#b91c1c"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function _vpFechaISO(dmy) {
  const f = parseFechaReg(dmy);
  if (!f) return vpHoyISO();
  return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
}

// ── Solapa TARIFARIO ────────────────────────────────────────────────────
function renderVpTarifario() {
  const box = document.getElementById('vp-tarifario');
  if (!box) return;
  const vig = vpTarifasVigentes();
  const tipico = vpMargenTipico();
  const desdes = Array.from(new Set((AppData.viajeTarifas || []).map(vpVigenteDesde))).sort();
  const hoy = vpHoyISO();
  const proxima = desdes.find(d => d > hoy);
  const rige = desdes.filter(d => d <= hoy).pop();

  const grupos = [
    { modalidad: 'km', titulo: 'Por kilómetros', vehiculos: ['moto', 'utilitario', 'furgon'] },
    { modalidad: 'paradas', titulo: 'Especial Transportes (por paradas)', vehiculos: ['utilitario', 'furgon'] }
  ];

  let html =
    '<div class="alert alert-info" style="margin-bottom:14px"><i class="ic ic-tag"></i><div>' +
    'Estos son los <strong>dos</strong> tarifarios del viaje particular: lo que se le <strong>paga al conductor</strong> y lo que se le ' +
    '<strong>cobra al cliente</strong>. Cada lista <strong>rige desde una fecha</strong>, así que cargar un aumento no le cambia el precio ' +
    'a un viaje ya facturado.' +
    '<div style="margin-top:6px;font-size:11.5px">Lista vigente: <strong>' +
      (rige === VP_DESDE_SIEMPRE ? 'la original' : 'desde el ' + (rige ? isoToDMY(rige) : '—')) + '</strong>' +
      (proxima ? ' · <span style="color:#b45309">hay una nueva que rige desde el ' + isoToDMY(proxima) + '</span>' : '') +
    '</div></div></div>';

  grupos.forEach(g => {
    const tramos = Array.from(new Set(vig.filter(t => t.modalidad === g.modalidad).map(t => _num(t.tramo))))
      .sort((a, b) => a - b);
    html += '<div class="card" style="margin-bottom:14px"><div class="card-header"><span class="card-title">' +
      g.titulo + '</span><span class="muted" style="font-size:11px">' +
      (g.modalidad === 'km' ? 'el tramo es el TOPE: "hasta 50 km" cubre 37' : 'hasta N paradas · no hay moto en esta modalidad') +
      '</span></div><div class="table-wrap"><table><thead><tr><th>Vehículo</th>' +
      tramos.map(t => '<th colspan="3" style="text-align:center;border-left:1px solid var(--border)">hasta ' + t + ' ' + vpUnidad(g.modalidad) + '</th>').join('') +
      '</tr><tr><th></th>' +
      tramos.map(() => '<th style="text-align:right;font-size:10px;border-left:1px solid var(--border)">Costo</th>' +
        '<th style="text-align:right;font-size:10px">Venta</th>' +
        '<th style="text-align:right;font-size:10px">Margen</th>').join('') +
      '</tr></thead><tbody>';
    g.vehiculos.forEach(veh => {
      html += '<tr><td><strong>' + vpVehiculoLabel(veh) + '</strong></td>';
      tramos.forEach(tr => {
        const t = vig.find(x => x.vehiculo === veh && x.modalidad === g.modalidad && _num(x.tramo) === tr);
        if (!t) { html += '<td colspan="3" class="muted" style="text-align:center;border-left:1px solid var(--border)">—</td>'; return; }
        const p = vpMargenPct(t.costo, t.venta);
        // Una fila que se salió de la escala del resto no es un precio: casi
        // siempre es un arrastre de fórmula. Se marca, no se corrige sola.
        const raro = (p != null && tipico != null && Math.abs(p - tipico) > 1.5);
        html += '<td class="mono" style="text-align:right;border-left:1px solid var(--border)">' + fmtPeso(_num(t.costo)) + '</td>' +
          '<td class="mono" style="text-align:right;font-weight:600">' + fmtPeso(_num(t.venta)) + '</td>' +
          '<td class="mono" style="text-align:right;font-size:11px' + (raro ? ';background:#fff7ed;color:#9a3412;font-weight:700' : ';color:var(--text-muted)') + '"' +
            (raro ? ' title="El resto del tarifario trabaja al ' + (Math.round(tipico * 10) / 10) + '%. Revisá si este precio es el acordado."' : '') + '>' +
          (p == null ? '—' : (p >= 0 ? '+' : '') + (Math.round(p * 10) / 10) + '%') + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  });

  if (tipico != null) {
    const fuera = vig.filter(t => {
      const p = vpMargenPct(t.costo, t.venta);
      return p != null && Math.abs(p - tipico) > 1.5;
    });
    if (fuera.length) {
      html += '<div class="alert" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i><div>' +
        '<strong>' + fuera.length + ' tramo(s) fuera de la escala del tarifario.</strong> El resto trabaja al <strong>' +
        (Math.round(tipico * 10) / 10) + '%</strong> de margen y estos no: ' +
        fuera.map(t => vpVehiculoLabel(t.vehiculo) + ' hasta ' + _num(t.tramo) + ' ' + vpUnidad(t.modalidad) +
          ' (' + (Math.round(vpMargenPct(t.costo, t.venta) * 10) / 10) + '%)').join(' · ') +
        '. No se corrige solo: puede ser un acuerdo distinto o un precio mal copiado, y eso lo decide el negocio.' +
        '</div></div>';
    }
  }
  box.innerHTML = html;
}

// ════════════════════════════════════════════════════════════════════════
//  ALTA / EDICIÓN DE UN VIAJE
// ════════════════════════════════════════════════════════════════════════
let vpEditId = null;

function _vpEl(id) { return document.getElementById(id); }
function _vpVal(id) { const e = _vpEl(id); return e ? e.value : ''; }

// Los clientes que se pueden elegir: el maestro MÁS los que ya aparecen en los
// envíos o en viajes anteriores. Un viaje a un cliente que no matchea ningún
// código se factura en $0 y no aparece en la liquidación de nadie.
function vpClientesParaSelect() {
  const m = new Map();
  (AppData.clientes || []).forEach(c => {
    const k = clienteKey(c.codigo);
    if (k) m.set(k, c.nombre || k);
  });
  if (typeof clientesDeRegistros === 'function') {
    clientesDeRegistros(null).forEach(c => { if (!m.has(c.cod)) m.set(c.cod, c.nombre); });
  }
  vpClientesEnRango(null).forEach(c => { if (!m.has(c.cod)) m.set(c.cod, c.nombre); });
  return Array.from(m.entries()).map(([cod, nombre]) => ({ cod, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function _vpPoblarClientes(sel) {
  const el = _vpEl('mvp-cliente');
  if (!el) return;
  el.innerHTML = '<option value="">Seleccionar cliente…</option>' +
    vpClientesParaSelect().map(c =>
      '<option value="' + c.cod + '">' + c.nombre + (c.nombre !== c.cod ? ' (' + c.cod + ')' : '') + '</option>').join('');
  if (sel) {
    if (!Array.from(el.options).some(o => o.value === sel)) {
      el.insertAdjacentHTML('beforeend', '<option value="' + sel + '">' + sel + '</option>');
    }
    el.value = sel;
  }
}

// El conductor sale del Panel, con los de viajes PRIMERO: son los que hacen
// estas rutas. Los de reparto quedan abajo y marcados, porque el negocio dijo
// que un flex también puede tomar un viaje — esconderlos sería decidir por el
// operador algo que no le corresponde a la app.
function _vpPoblarConductores(sel) {
  const el = _vpEl('mvp-conductor');
  if (!el) return;
  const panel = (AppData.panelConductores || []).slice()
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const deViajes = panel.filter(c => c.servicio === 'particular' || c.servicio === 'ambos');
  const flex = panel.filter(c => !(c.servicio === 'particular' || c.servicio === 'ambos'));
  const opt = c => '<option value="' + c.nombre + '">' + c.nombre +
    (c.servicio === 'ambos' ? ' · flex y viajes' : '') + '</option>';
  el.innerHTML = '<option value="">— sin conductor asignado —</option>' +
    (deViajes.length ? '<optgroup label="Viajes particulares">' + deViajes.map(opt).join('') + '</optgroup>' : '') +
    (flex.length ? '<optgroup label="Reparto (Flex)">' + flex.map(opt).join('') + '</optgroup>' : '');
  if (sel) {
    if (!Array.from(el.querySelectorAll('option')).some(o => o.value === sel)) {
      el.insertAdjacentHTML('beforeend', '<option value="' + sel + '">' + sel + ' (fuera del panel)</option>');
    }
    el.value = sel;
  }
}

function abrirViajeModal() {
  vpEditId = null;
  _vpEl('modal-viaje-title').textContent = 'Agregar viaje particular';
  _vpEl('mvp-fecha').value = (typeof hoyISO === 'function') ? hoyISO() : vpHoyISO();
  _vpEl('mvp-vehiculo').value = 'moto';
  _vpEl('mvp-modalidad').value = 'km';
  _vpEl('mvp-medida').value = '';
  _vpEl('mvp-origen').value = '';
  _vpEl('mvp-destino').value = '';
  _vpEl('mvp-detalle').value = '';
  _vpEl('mvp-estado').value = 'realizado';
  _vpEl('mvp-costo').value = '';
  _vpEl('mvp-venta').value = '';
  _vpEl('mvp-nuevo-wrap').style.display = 'none';
  _vpEl('mvp-nuevo-nombre').value = '';
  _vpEl('mvp-nuevo-cod').value = '';
  _vpPoblarClientes('');
  _vpPoblarConductores('');
  vpCambioVehiculo();
  _vpEl('modal-viaje-backdrop').style.display = 'flex';
}

function editarViaje(id) {
  const v = vpViajePorId(id);
  if (!v) { showToast('⚠️ Ese viaje ya no existe'); renderViajesParticulares(); return; }
  vpEditId = String(id);
  _vpEl('modal-viaje-title').textContent = 'Editar viaje · ' + (v.cliente || v.cliente_cod);
  _vpEl('mvp-fecha').value = _vpFechaISO(v.fecha);
  _vpEl('mvp-vehiculo').value = v.vehiculo || 'moto';
  _vpEl('mvp-modalidad').value = v.modalidad || 'km';
  _vpEl('mvp-origen').value = v.origen || '';
  _vpEl('mvp-destino').value = v.destino || '';
  _vpEl('mvp-detalle').value = v.detalle || '';
  _vpEl('mvp-estado').value = v.estado || 'realizado';
  _vpEl('mvp-nuevo-wrap').style.display = 'none';
  _vpPoblarClientes(clienteKey(v.cliente_cod));
  _vpPoblarConductores(v.conductor || '');
  vpPintarTramos(_num(v.tramo));
  _vpEl('mvp-medida').value = _num(v.modalidad === 'paradas' ? v.paradas : v.km) || '';
  _vpEl('mvp-costo').value = _num(v.costo) || 0;
  _vpEl('mvp-venta').value = _num(v.venta) || 0;
  vpPintarResumen();
  _vpEl('modal-viaje-backdrop').style.display = 'flex';
}

function cerrarViajeModal(e) {
  if (!e || e.target.id === 'modal-viaje-backdrop') {
    _vpEl('modal-viaje-backdrop').style.display = 'none';
    vpEditId = null;
  }
}

function vpToggleClienteNuevo() {
  const w = _vpEl('mvp-nuevo-wrap');
  const abierto = w.style.display !== 'none';
  w.style.display = abierto ? 'none' : '';
  if (!abierto) { _vpEl('mvp-cliente').value = ''; _vpEl('mvp-nuevo-nombre').focus(); }
}

// Al cambiar de vehículo o modalidad se repueblan los tramos: Especial
// Transportes no tiene moto, y los topes no son los mismos.
function vpCambioVehiculo() {
  const veh = _vpVal('mvp-vehiculo'), mod = _vpVal('mvp-modalidad');
  const aviso = _vpEl('mvp-aviso-combo');
  const tramos = vpTramosDe(veh, mod, _vpVal('mvp-fecha') || vpHoyISO());
  if (aviso) {
    aviso.innerHTML = tramos.length ? '' :
      '<span style="color:#9a3412">No hay tarifa cargada para <strong>' + vpVehiculoLabel(veh) + '</strong> en ' +
      vpModalidadLabel(mod) + '. Podés escribir el costo y la venta a mano.</span>';
  }
  const uni = _vpEl('mvp-medida-label');
  if (uni) uni.textContent = mod === 'paradas' ? 'Paradas' : 'Kilómetros';
  vpPintarTramos();
  vpAutoTarifa();
}

function vpPintarTramos(sel) {
  const el = _vpEl('mvp-tramo');
  if (!el) return;
  const veh = _vpVal('mvp-vehiculo'), mod = _vpVal('mvp-modalidad');
  const tramos = vpTramosDe(veh, mod, _vpVal('mvp-fecha') || vpHoyISO());
  el.innerHTML = '<option value="">— a convenir (sin tramo) —</option>' +
    tramos.map(t => '<option value="' + _num(t.tramo) + '">hasta ' + _num(t.tramo) + ' ' + vpUnidad(mod) +
      ' · paga ' + fmtPeso(_num(t.costo)) + ' · cobra ' + fmtPeso(_num(t.venta)) + '</option>').join('');
  if (sel != null && _num(sel) > 0) el.value = String(_num(sel));
}

// Escribir los km propone el tramo que los cubre. Es una propuesta: el precio
// está cotizado de antemano y el operador puede moverlo.
function vpDesdeMedida() {
  const veh = _vpVal('mvp-vehiculo'), mod = _vpVal('mvp-modalidad');
  const val = _num(_vpVal('mvp-medida'));
  const t = vpTramoQueCubre(veh, mod, val, _vpVal('mvp-fecha') || vpHoyISO());
  const aviso = _vpEl('mvp-aviso-tramo');
  if (t != null) {
    _vpEl('mvp-tramo').value = String(t);
    if (aviso) aviso.innerHTML = '';
    vpAutoTarifa();
  } else if (val > 0 && aviso) {
    const tramos = vpTramosDe(veh, mod, _vpVal('mvp-fecha') || vpHoyISO());
    const tope = tramos.length ? _num(tramos[tramos.length - 1].tramo) : 0;
    aviso.innerHTML = tope
      ? '<span style="color:#9a3412">' + val + ' ' + vpUnidad(mod) + ' se pasa del último tramo (hasta ' + tope +
        '): no hay precio de tabla, hay que cotizarlo a mano.</span>'
      : '';
    vpPintarResumen();
  }
}

// Trae del tarifario el costo y la venta del tramo elegido. No pisa lo que el
// operador haya escrito si ya cotizó distinto: solo completa.
function vpAutoTarifa(forzar) {
  const veh = _vpVal('mvp-vehiculo'), mod = _vpVal('mvp-modalidad');
  const tramo = _num(_vpVal('mvp-tramo'));
  const t = tramo > 0 ? vpTarifaDe(veh, mod, tramo, _vpVal('mvp-fecha') || vpHoyISO()) : null;
  if (t) {
    const c = _vpEl('mvp-costo'), v = _vpEl('mvp-venta');
    if (forzar || !_num(c.value)) c.value = t.costo;
    if (forzar || !_num(v.value)) v.value = t.venta;
  }
  vpPintarResumen();
}

function vpUsarTarifa() { vpAutoTarifa(true); }

// El resumen del modal dice las tres cosas que deciden: cuánto se paga, cuánto
// se cobra y cuánto queda. Un viaje a pérdida se ve ANTES de guardarlo.
function vpPintarResumen() {
  const costo = _num(_vpVal('mvp-costo')), venta = _num(_vpVal('mvp-venta'));
  const m = venta - costo;
  const box = _vpEl('mvp-resumen');
  if (!box) return;
  const veh = _vpVal('mvp-vehiculo'), mod = _vpVal('mvp-modalidad'), tramo = _num(_vpVal('mvp-tramo'));
  const t = tramo > 0 ? vpTarifaDe(veh, mod, tramo, _vpVal('mvp-fecha') || vpHoyISO()) : null;
  const pisado = t && (_num(t.costo) !== costo || _num(t.venta) !== venta);
  box.innerHTML =
    '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
      '<div><div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Se le paga al conductor</div>' +
        '<div style="font-size:17px;font-weight:700;font-family:monospace">' + fmtPeso(costo) + '</div></div>' +
      '<div><div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Se le factura al cliente</div>' +
        '<div style="font-size:17px;font-weight:700;font-family:monospace">' + fmtPeso(venta) + '</div></div>' +
      '<div><div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Margen</div>' +
        '<div style="font-size:17px;font-weight:700;font-family:monospace;color:' + (m < 0 ? '#b91c1c' : '#166534') + '">' +
        fmtPeso(m) + (venta > 0 ? ' <span style="font-size:11px">(' + (Math.round(m * 1000 / venta) / 10) + '%)</span>' : '') + '</div></div>' +
    '</div>' +
    (m < 0 ? '<div style="margin-top:8px;font-size:11.5px;color:#b91c1c"><strong>Queda a pérdida:</strong> se le paga al conductor más de lo que se le cobra al cliente.</div>' : '') +
    (pisado ? '<div style="margin-top:8px;font-size:11.5px;color:#9a3412">El tarifario dice <strong>' + fmtPeso(_num(t.costo)) +
      ' / ' + fmtPeso(_num(t.venta)) + '</strong>. Estos valores se escribieron a mano.' +
      ' <button class="btn btn-sm" style="margin-left:6px" onclick="vpUsarTarifa()">Usar los del tarifario</button></div>' : '');
}

async function guardarViajeModal() {
  const btn = _vpEl('mvp-guardar');
  // Guardar no se dispara dos veces: la ventana sigue abierta mientras se
  // escribe en la nube y el segundo clic no ve la primera carga (es el mismo
  // doble guardado que dejó cuatro vacaciones idénticas con 22 µs de
  // diferencia).
  if (btn && btn.disabled) return;

  const iso = _vpVal('mvp-fecha');
  if (!iso) { alert('La fecha del viaje es obligatoria.'); return; }
  const fecha = isoToDMY(iso);

  // Cliente: uno existente o uno nuevo que se da de alta acá mismo.
  let cod = clienteKey(_vpVal('mvp-cliente'));
  let nombre = cod ? clienteNombreDe(cod) : '';
  let crearCliente = null;
  if (_vpEl('mvp-nuevo-wrap').style.display !== 'none') {
    const nn = _vpVal('mvp-nuevo-nombre').trim();
    if (!nn) { alert('Escribí el nombre del cliente nuevo.'); return; }
    const nc = clienteKey(_vpVal('mvp-nuevo-cod').trim() || nn);
    if ((AppData.clientes || []).some(c => clienteKey(c.codigo) === nc)) {
      alert('Ya existe un cliente con el código ' + nc + '. Elegilo de la lista en vez de crearlo de nuevo.');
      return;
    }
    cod = nc; nombre = nn;
    crearCliente = { nombre: nn, codigo: nc, activo: true, periodo_dias: 7 };
  }
  if (!cod) { alert('Elegí el cliente, o cargá uno nuevo.'); return; }

  const conductor = _vpVal('mvp-conductor').trim();
  const vehiculo = _vpVal('mvp-vehiculo');
  const modalidad = _vpVal('mvp-modalidad');
  const tramo = _num(_vpVal('mvp-tramo'));
  const medida = _num(_vpVal('mvp-medida'));
  const costo = _num(_vpVal('mvp-costo'));
  const venta = _num(_vpVal('mvp-venta'));
  const estado = _vpVal('mvp-estado') || 'realizado';

  if (venta <= 0 && estado !== 'cancelado') {
    if (!confirm('El viaje se factura en $0: al cliente no se le cobra nada.\n\n¿Guardar igual?')) return;
  }
  if (!conductor && estado !== 'cancelado') {
    if (!confirm('Sin conductor asignado NO se le paga a nadie.\n\n' +
      'Es lo correcto si el viaje lo hizo alguien de afuera: al cliente se le factura igual.\n\n¿Guardar así?')) return;
  }
  if (venta < costo && estado !== 'cancelado') {
    if (!confirm('Queda a PÉRDIDA: se le pagan ' + fmtPeso(costo) + ' al conductor y se le cobran ' +
      fmtPeso(venta) + ' al cliente.\n\n¿Guardar igual?')) return;
  }
  // El otro camino del viaje particular es el CARGO de cliente_cargos, que
  // existe para el viaje sin conductor. Los dos juntos lo cobran dos veces.
  const choque = vpCargoViajeDelPeriodo(cod, iso);
  if (choque && vpEditId == null) {
    if (!confirm('OJO: ' + nombre + ' ya tiene ' + choque + ' cargo(s) de "viaje particular" en este período.\n\n' +
      'Ese cargo es para el viaje que NO se carga acá. Si este viaje es el mismo, se le va a facturar DOS VECES:\n' +
      'quitá el cargo desde Detalle de cliente.\n\n¿Guardar el viaje igual?')) return;
  }

  const rec = {
    fecha, cliente_cod: cod, cliente: nombre, conductor,
    vehiculo, modalidad, tramo,
    km: modalidad === 'km' ? (medida || null) : null,
    paradas: modalidad === 'paradas' ? (medida || null) : null,
    origen: _vpVal('mvp-origen').trim(), destino: _vpVal('mvp-destino').trim(),
    detalle: _vpVal('mvp-detalle').trim(),
    costo, venta, estado,
    creado_por: (typeof currentUser !== 'undefined' && currentUser && (currentUser.nombre || currentUser.usuario)) || ''
  };

  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    if (crearCliente) {
      try {
        const c = await DB.insertRow('clientes', crearCliente);
        AppData.clientes.push(Object.assign({ id: c && c.id }, crearCliente));
        if (typeof invalidarIndiceCliTarifas === 'function') invalidarIndiceCliTarifas();
      } catch (e) {
        console.warn('alta de cliente desde viajes', e);
        alert('No se pudo dar de alta al cliente: ' + (e.message || e) + '\nEl viaje no se guardó.');
        return;
      }
    }
    const previo = vpEditId != null ? vpViajePorId(vpEditId) : null;
    if (vpEditId != null && !previo) {
      alert('El viaje que estabas editando ya no existe: lo borró o lo cambió otra sesión.');
      vpEditId = null; renderViajesParticulares(); return;
    }
    if (previo) {
      await DB.updateWhere('viajes_particulares', 'id', previo.id, rec);
      Object.assign(previo, rec);
    } else {
      const row = await DB.insertRow('viajes_particulares', rec);
      vpViajes().push(Object.assign({ id: row && row.id }, rec));
    }
    _vpPersistirLocal();
    await _vpReabrirLiquidaciones(rec, previo);
    _vpEl('modal-viaje-backdrop').style.display = 'none';
    vpEditId = null;
    if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
    renderViajesParticulares();
    showToast('🚐 Viaje guardado · se le cobran ' + fmtPeso(venta) + ' a ' + nombre +
      (conductor ? ' y se le pagan ' + fmtPeso(costo) + ' a ' + conductor : ' · sin conductor: no se le paga a nadie'));
  } catch (e) {
    console.warn('guardarViajeModal', e);
    alert('No se pudo guardar el viaje: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
  }
}

async function eliminarViaje(id) {
  const v = vpViajePorId(id);
  if (!v) { showToast('⚠️ Ese viaje ya no existe'); renderViajesParticulares(); return; }
  if (!confirm('¿Eliminar el viaje del ' + (v.fecha || '—') + ' de ' + (v.cliente || v.cliente_cod) + '?\n\n' +
    'Dejan de facturarse ' + fmtPeso(_num(v.venta)) + ' al cliente' +
    (v.conductor ? ' y de pagarse ' + fmtPeso(_num(v.costo)) + ' a ' + v.conductor : '') + '.')) return;
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.deleteWhere('viajes_particulares', 'id', v.id);
    AppData.viajesParticulares = vpViajes().filter(x => String(x.id) !== String(v.id));
    _vpPersistirLocal();
    await _vpReabrirLiquidaciones(v, v);
    if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
    renderViajesParticulares();
    showToast('🗑 Viaje eliminado');
  } catch (e) {
    console.warn('eliminarViaje', e);
    alert('No se pudo eliminar: ' + (e.message || e));
  }
}

// Un viaje cambia lo que se le factura al cliente, así que si su liquidación ya
// estaba cerrada se reabre sola — mismo criterio que un cargo o una anulación.
async function _vpReabrirLiquidaciones(rec, previo) {
  if (typeof _reabrirPorCambio !== 'function' || typeof periodoClienteRango !== 'function') return;
  const vistos = new Set();
  [rec, previo].filter(Boolean).forEach(x => {
    const k = clienteKey(x.cliente_cod);
    const iso = _vpFechaISO(x.fecha);
    if (k) vistos.add(k + '|' + iso);
  });
  for (const v of vistos) {
    const [k, iso] = v.split('|');
    try { await _reabrirPorCambio(k, periodoClienteRango(k, iso), 'un viaje particular'); } catch (e) {}
  }
}

function _vpPersistirLocal() {
  try { localStorage.setItem('liq_viajes_particulares', JSON.stringify(vpViajes())); } catch (e) {}
}

// Cuántos cargos "viaje particular" tiene ese cliente en el período de esa
// fecha. Es el control del doble cobro.
function vpCargoViajeDelPeriodo(cod, iso) {
  if (typeof periodoClienteRango !== 'function' || typeof cargosDeSemana !== 'function') return 0;
  const rc = periodoClienteRango(cod, iso);
  const sem = (typeof viernesDeRango === 'function') ? viernesDeRango(rc) : null;
  if (!sem) return 0;
  return cargosDeSemana(cod, sem).filter(c => c.concepto === 'viaje').length;
}

// ════════════════════════════════════════════════════════════════════════
//  EDITAR EL TARIFARIO
//  Carga una lista NUEVA con su fecha en vez de pisar la que está: lo que ya se
//  facturó conserva su precio. Es el mismo circuito que "Actualizar lista de
//  precios" del tarifario de clientes.
// ════════════════════════════════════════════════════════════════════════
function abrirVpTarifaModal() {
  const vig = vpTarifasVigentes();
  _vpEl('mvpt-desde').value = vpHoyISO();
  const body = _vpEl('mvpt-rows');
  body.innerHTML = [
    { modalidad: 'km', vehiculos: ['moto', 'utilitario', 'furgon'] },
    { modalidad: 'paradas', vehiculos: ['utilitario', 'furgon'] }
  ].map(g => {
    const tramos = Array.from(new Set(vig.filter(t => t.modalidad === g.modalidad).map(t => _num(t.tramo)))).sort((a, b) => a - b);
    return g.vehiculos.map(veh => tramos.map(tr => {
      const t = vig.find(x => x.vehiculo === veh && x.modalidad === g.modalidad && _num(x.tramo) === tr);
      const key = veh + '|' + g.modalidad + '|' + tr;
      return '<tr><td style="font-size:12px">' + vpVehiculoLabel(veh) +
        '<div class="muted" style="font-size:10px">' + (g.modalidad === 'paradas' ? 'Especial · ' : '') +
        'hasta ' + tr + ' ' + vpUnidad(g.modalidad) + '</div></td>' +
        '<td><input type="number" class="form-input vpt-costo" data-k="' + key + '" value="' + (t ? _num(t.costo) : 0) +
          '" min="0" step="1" style="width:110px;text-align:right" oninput="vpPintarMargenFila(this)"></td>' +
        '<td><input type="number" class="form-input vpt-venta" data-k="' + key + '" value="' + (t ? _num(t.venta) : 0) +
          '" min="0" step="1" style="width:110px;text-align:right" oninput="vpPintarMargenFila(this)"></td>' +
        '<td class="mono vpt-margen" data-k="' + key + '" style="text-align:right;font-size:11px"></td></tr>';
    }).join('')).join('');
  }).join('');
  Array.from(body.querySelectorAll('.vpt-costo')).forEach(vpPintarMargenFila);
  _vpEl('modal-vptarifa-backdrop').style.display = 'flex';
}

function cerrarVpTarifaModal(e) {
  if (!e || e.target.id === 'modal-vptarifa-backdrop') {
    _vpEl('modal-vptarifa-backdrop').style.display = 'none';
  }
}

function vpPintarMargenFila(el) {
  const k = el.getAttribute('data-k');
  const body = _vpEl('mvpt-rows');
  const c = _num(body.querySelector('.vpt-costo[data-k="' + k + '"]').value);
  const v = _num(body.querySelector('.vpt-venta[data-k="' + k + '"]').value);
  const cel = body.querySelector('.vpt-margen[data-k="' + k + '"]');
  const p = vpMargenPct(c, v);
  cel.textContent = p == null ? '—' : (p >= 0 ? '+' : '') + (Math.round(p * 10) / 10) + '%';
  cel.style.color = p != null && p < 0 ? '#b91c1c' : 'var(--text-muted)';
}

async function guardarVpTarifa() {
  const desde = _vpEl('mvpt-desde').value;
  if (!desde) { alert('Poné desde qué día rige la lista nueva.'); return; }
  const body = _vpEl('mvpt-rows');
  const filas = Array.from(body.querySelectorAll('.vpt-costo')).map(inp => {
    const k = inp.getAttribute('data-k');
    const [vehiculo, modalidad, tramo] = k.split('|');
    return {
      vehiculo, modalidad, tramo: _num(tramo),
      costo: _num(inp.value),
      venta: _num(body.querySelector('.vpt-venta[data-k="' + k + '"]').value),
      vigente_desde: desde,
      creado_por: (typeof currentUser !== 'undefined' && currentUser && (currentUser.nombre || currentUser.usuario)) || ''
    };
  });
  const hoy = vpHoyISO();
  const aviso = desde < hoy
    ? '\n\nOJO: la fecha YA PASÓ. Los viajes de esos días pasan a valuarse con estos precios, así que las liquidaciones que los incluyan cambian de total.'
    : (desde === hoy ? '' : '\n\nRige recién desde el ' + isoToDMY(desde) + ': hasta entonces sigue la lista actual.');
  if (!confirm('Se carga una lista NUEVA de ' + filas.length + ' tramos que rige desde el ' + isoToDMY(desde) + '.\n' +
    'Las listas anteriores se conservan: lo ya facturado mantiene su precio.' + aviso)) return;

  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    // Se pisan SOLO las filas de esa misma fecha, para que reintentar la carga
    // no acumule dos versiones del mismo aumento.
    const previas = (AppData.viajeTarifas || []).filter(t => vpVigenteDesde(t) === desde && t.id);
    for (const p of previas) await DB.deleteWhere('viaje_tarifas', 'id', p.id);
    AppData.viajeTarifas = (AppData.viajeTarifas || []).filter(t => vpVigenteDesde(t) !== desde);
    for (const f of filas) {
      const row = await DB.insertRow('viaje_tarifas', f);
      AppData.viajeTarifas.push(Object.assign({ id: row && row.id }, f));
    }
    try { localStorage.setItem('liq_viaje_tarifas', JSON.stringify(AppData.viajeTarifas)); } catch (e) {}
    _vpEl('modal-vptarifa-backdrop').style.display = 'none';
    renderViajesParticulares();
    showToast('💵 Tarifario de viajes actualizado · rige desde el ' + isoToDMY(desde));
  } catch (e) {
    console.warn('guardarVpTarifa', e);
    alert('No se pudo guardar el tarifario: ' + (e.message || e));
  }
}
