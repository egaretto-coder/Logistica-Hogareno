// ═══════════════════════════════════════════════════════════════════════
//  COMPRAS — la planificación del consumo de la empresa.
//
//  El circuito real, que es lo que el panel reemplaza (una planilla de Excel
//  con 151 filas y 23 "sectores" escritos a mano para 10 reales):
//    1. Cada área pide por mail.
//    2. Administración COTIZA la demanda y la carga acá: sector, producto,
//       categoría, fecha de la solicitud, importe y urgencia.
//    3. Un supervisor o el analista decide según disponibilidad y urgencia:
//       APROBADA (se compra), PROGRAMADA (se compra más adelante) o RECHAZADA.
//    4. Si se aprueba y se efectúa la compra, se carga la fecha de compra, la
//       forma de pago y, con tarjeta, en cuántas cuotas.
//
//  "REALIZADA" NO ES UN ESTADO: es tener fecha de compra. Guardar el resultado
//  además del factor es la forma de que los dos queden en desacuerdo — el
//  mismo criterio por el que la edad no se guarda y el mes de una compra no se
//  escribe a mano. Por eso `compraRealizada()` mira la fecha y nada más.
//
//  EL MES DICE LO QUE SALE DE CAJA, NO LO QUE SE COMPRÓ. Una compra con
//  tarjeta en 3 cuotas reparte su importe en los 3 meses, así que el total del
//  mes es la plata que efectivamente se paga ese mes — la lectura del
//  tesorero, que es quien mira este panel. Lo decidió el negocio. La contra
//  está dicha donde se ve: ese total NO coincide con el de la planilla vieja,
//  que ponía el importe entero en el mes de la compra, y por eso el panel
//  muestra las dos cifras una al lado de la otra en vez de dejar que la
//  diferencia aparezca como un error de cálculo.
// ═══════════════════════════════════════════════════════════════════════

// Los sectores que PIDEN compras. Lista cerrada por el mismo motivo que los
// puestos de RRHH y los proveedores: escritos a mano, la planilla real tiene
// "Administracion", "Administración", "Aministración" y "Administracón" para
// el mismo sector, y después no se puede agrupar ni comparar a nadie —medido:
// 23 grafías para 10 sectores—.
// NO son `RRHH_AREAS`: esa lista dice dónde está asignado un empleado y esta
// dice quién consume presupuesto; se superponen pero no son lo mismo (acá hay
// Mantenimiento y Recursos Humanos, que no son áreas del legajo). Tampoco se
// deriva de aquella en el tope del archivo: un `const` que lee una constante
// de OTRO archivo ata el orden de los <script> y un TDZ ahí deja este archivo
// entero sin ejecutar, que es un bug que el proyecto ya pagó.
const COMPRAS_SECTORES = [
  'Administración', 'Asesoría Comercial', 'Coordinación', 'Dirección',
  'Gerencia General', 'Logística', 'Mantenimiento', 'Recursos Humanos',
  'Ventas', 'General'
];

// Las categorías son EN QUÉ gasta la empresa. Salen de la planilla real.
const COMPRAS_CATEGORIAS = [
  'Mobiliario', 'Insumos Operativos', 'Insumos Generales', 'Mantenimiento',
  'Indumentaria Laboral', 'Vehículos', 'Fidelización Cliente',
  'Gasto de representación', 'Contingencias'
];

// Qué quiere decir cada categoría, para que dos personas carguen igual.
const COMPRAS_CAT_AYUDA = {
  'Mobiliario': 'computadoras, sillas, escritorios',
  'Insumos Operativos': 'pilas, cuadernos, marcadores, cartuchos',
  'Insumos Generales': 'comida, bebida, limpieza',
  'Mantenimiento': 'soporte físico, mano de obra, reformas, reparaciones',
  'Indumentaria Laboral': 'ropa de trabajo',
  'Vehículos': 'reparación y repuestos de los vehículos',
  'Fidelización Cliente': 'regalos y atenciones a clientes',
  'Gasto de representación': 'comidas y viáticos de representación',
  'Contingencias': 'lo imprevisto que no entra en ninguna otra'
};

const COMPRAS_PAGOS = ['efectivo', 'transferencia', 'tarjeta'];
const COMPRAS_URGENCIAS = ['alta', 'media', 'baja'];

// Los cuatro estados de una solicitud. "programada" es aprobada PERO para más
// adelante: es la proyección, y por eso se cuenta aparte de la aprobada.
const COMPRAS_ESTADOS = {
  solicitada: { label: 'Esperando decisión', color: '#f59e0b', corto: 'Sin decidir' },
  aprobada:   { label: 'Aprobada',           color: '#10b981', corto: 'Aprobada' },
  programada: { label: 'Programada',         color: '#3b82f6', corto: 'Programada' },
  rechazada:  { label: 'Rechazada',          color: '#ef4444', corto: 'Rechazada' }
};

let compTab = 'resumen';
let compBusca = '';
let compFiltroEstado = '';
let compFiltroSector = '';
let compEditId = null;
let compEjecId = null;
let _cprGuardando = false;

const _cprEl = id => document.getElementById(id);
const _cprTxt = v => String(v == null ? '' : v).trim();

// ── Meses ───────────────────────────────────────────────────────────────
const _CPR_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Los nombres de los meses son de ESTE módulo y no prestados de otro: el banco
// ya agarró una pantalla mostrando "2026-08" donde tenía que decir "Agosto".
function _cprMesTexto(mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return '—';
  const n = +mes.slice(5, 7) - 1;
  return (_CPR_MESES[n] || '') + ' ' + mes.slice(0, 4);
}
function _cprMesCorto(mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return '—';
  return (_CPR_MESES[+mes.slice(5, 7) - 1] || '').slice(0, 3) + ' ' + mes.slice(2, 4);
}
function _cprMesDe(iso) {
  return /^\d{4}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 7) : '';
}
function _cprMesSumar(mes, n) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return '';
  const d = new Date(+mes.slice(0, 4), +mes.slice(5, 7) - 1 + _num(n), 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── El corazón: en qué meses pesa una compra ────────────────────────────
// Una compra sin fecha de compra todavía no salió de caja y no pesa en ningún
// mes. Con tarjeta en N cuotas, su importe se reparte en N meses desde el de
// la compra.
//
// LA ÚLTIMA CUOTA ABSORBE EL RESTO. $100.000 en 3 no da tres cuotas iguales,
// y si cada una se redondeara por su cuenta la suma de los meses no daría el
// importe de la compra: el panel mostraría un total que no cierra contra su
// propio detalle, que es exactamente la clase de discrepancia que este
// proyecto ya pagó varias veces.
function comprasCuotas(c) {
  if (!c || !c.fecha_compra) return [];
  const mes0 = _cprMesDe(c.fecha_compra);
  if (!mes0) return [];
  const total = _num(c.importe);
  // Las cuotas son de la TARJETA. Con efectivo o transferencia la plata sale
  // entera, aunque el campo haya quedado con un número de una carga vieja.
  const n = (_cprTxt(c.forma_pago).toLowerCase() === 'tarjeta')
    ? Math.max(1, Math.round(_num(c.cuotas) || 1)) : 1;
  const base = Math.round((total / n) * 100) / 100;
  const out = [];
  let acum = 0;
  for (let i = 0; i < n; i++) {
    const monto = (i === n - 1) ? Math.round((total - acum) * 100) / 100 : base;
    acum = Math.round((acum + monto) * 100) / 100;
    out.push({ i: i + 1, n: n, mes: _cprMesSumar(mes0, i), monto: monto });
  }
  return out;
}

function compraRealizada(c) { return !!(c && c.fecha_compra); }
function comprasTodas() { return (AppData.compras || []); }

// Lo que sale de caja en un mes: cada cuota que cae ahí, venga de la compra de
// ese mes o de una anterior. Con mes vacío ("Todos") es todo lo comprado.
function comprasEgresoMes(mes) {
  const filas = [];
  comprasTodas().forEach(c => {
    comprasCuotas(c).forEach(q => {
      if (mes && q.mes !== mes) return;
      filas.push({ compra: c, cuota: q, monto: q.monto });
    });
  });
  const total = filas.reduce((s, f) => s + f.monto, 0);
  // Cuánto de lo que sale este mes viene de compras de meses anteriores: es la
  // parte que no se explica mirando las compras del mes, y sin decirla el
  // número de arriba no cierra contra el detalle de abajo.
  const arrastre = filas.filter(f => f.cuota.i > 1).reduce((s, f) => s + f.monto, 0);
  const arrastreN = filas.filter(f => f.cuota.i > 1).length;
  return { filas: filas, total: total, arrastre: arrastre, arrastreN: arrastreN };
}

// Lo COMPRADO en el mes: el importe entero de las compras con fecha de ese mes.
// Es el número de la planilla vieja, y está para que la diferencia con el de
// arriba se vea explicada en vez de parecer un error.
function comprasCompradoMes(mes) {
  const cs = comprasTodas().filter(c => compraRealizada(c) &&
    (!mes || _cprMesDe(c.fecha_compra) === mes));
  return { n: cs.length, total: cs.reduce((s, c) => s + _num(c.importe), 0), filas: cs };
}

// Lo que ya está firmado y todavía no salió: de las compras HECHAS hasta el
// mes que se está mirando, las cuotas que caen después. Es la pregunta del
// tesorero que ninguna planilla contesta: cuánto de lo que viene ya está
// comprometido.
//
// La compra tiene que ser de ese mes o anterior. Contando todas las cuotas
// posteriores a secas, una compra de septiembre figuraba como "comprometida"
// mirando junio — en junio todavía no existía, así que el número decía que
// había plata atada que nadie había atado.
function comprasComprometido(mes) {
  if (!mes) return { total: 0, n: 0 };
  let total = 0, n = 0;
  comprasTodas().forEach(c => {
    if (!compraRealizada(c) || _cprMesDe(c.fecha_compra) > mes) return;
    comprasCuotas(c).forEach(q => {
      if (q.mes > mes) { total += q.monto; n++; }
    });
  });
  return { total: total, n: n };
}

// La serie para el gráfico: lo que sale de caja mes a mes, de la primera
// compra a la última cuota. Los meses sin movimiento entran en cero, si no el
// gráfico saltea huecos y la forma del año miente.
function comprasSerieMensual() {
  const porMes = {};
  comprasTodas().forEach(c => comprasCuotas(c).forEach(q => {
    porMes[q.mes] = (porMes[q.mes] || 0) + q.monto;
  }));
  const meses = Object.keys(porMes).sort();
  if (!meses.length) return [];
  const out = [];
  let m = meses[0];
  const fin = meses[meses.length - 1];
  let guarda = 0;
  while (m <= fin && guarda++ < 240) {
    out.push({ mes: m, total: porMes[m] || 0 });
    m = _cprMesSumar(m, 1);
  }
  return out;
}

// Reparto del egreso de un mes por un campo de la compra. Todos los repartos
// del panel salen de ACÁ y de la misma base, así que la suma de los sectores,
// la de las categorías y la de las formas de pago dan exactamente el mismo
// total — un reparto que no cierra miente sin que se note.
function comprasReparto(filas, campo, vacio) {
  const m = {};
  filas.forEach(f => {
    const k = _cprTxt(f.compra[campo]) || (vacio || 'Sin especificar');
    m[k] = (m[k] || 0) + f.monto;
  });
  return Object.entries(m).map(([k, v]) => ({ label: k, cnt: v }))
    .sort((a, b) => b.cnt - a.cnt);
}

// Las solicitudes del mes, por FECHA DE SOLICITUD — que es otra fecha que la
// de la compra, y por eso el bloque lo dice. Contesta cuánto se pidió y qué se
// decidió, no cuánta plata salió.
function comprasSolicitudes(mes) {
  const cs = comprasTodas().filter(c => !mes || _cprMesDe(c.fecha_solicitud) === mes);
  const por = e => cs.filter(c => (c.estado || 'solicitada') === e);
  const sum = l => l.reduce((s, c) => s + _num(c.importe), 0);
  const aprobadas = por('aprobada'), programadas = por('programada');
  const rechazadas = por('rechazada'), pendientes = por('solicitada');
  // CUMPLIMIENTO: de lo aprobado, cuánto se ejecutó de verdad. Una aprobación
  // que nadie compra es una decisión que no pasó nada, y es lo que el panel
  // existe para que no se pierda.
  const autorizadas = aprobadas.concat(programadas);
  const ejecutadas = autorizadas.filter(compraRealizada);
  return {
    total: cs.length, monto: sum(cs),
    aprobadas: aprobadas.length, montoAprobadas: sum(aprobadas),
    programadas: programadas.length, montoProgramadas: sum(programadas),
    rechazadas: rechazadas.length, montoRechazadas: sum(rechazadas),
    pendientes: pendientes.length, montoPendientes: sum(pendientes),
    autorizadas: autorizadas.length, ejecutadas: ejecutadas.length,
    pct: n => cs.length ? Math.round(n * 100 / cs.length) : 0
  };
}

// Lo que espera decisión, de CUALQUIER mes. No sigue al navegador a propósito:
// es el trabajo pendiente del supervisor y esconderlo detrás de un filtro de
// mes es exactamente como se pasa de largo (la misma lección que la deuda
// vigente de Adelantos).
function comprasPendientes() {
  return comprasTodas().filter(c => (c.estado || 'solicitada') === 'solicitada');
}

// ── Render ──────────────────────────────────────────────────────────────
function renderComprasPagina() {
  switchComprasTab(compTab || 'resumen');
}

// Cada panel con solapas reabre la SUYA: el re-render de la sincronización en
// vivo pasa por showPage, y con la primera hardcodeada al operador se le
// cerraba sola la solapa que estaba mirando.
function switchComprasTab(t) {
  compTab = t;
  ['resumen', 'registro'].forEach(k => {
    const tab = _cprEl('comp-tab-' + k), pane = _cprEl('comp-pane-' + k);
    if (tab) tab.classList.toggle('active', k === t);
    if (pane) pane.style.display = (k === t) ? '' : 'none';
  });
  renderCompras();
}

function renderCompras() {
  if (typeof _pintarPanelMes === 'function') _pintarPanelMes('compras');
  _cprRenderPendientes();
  if (compTab === 'registro') _cprRenderRegistro();
  else _cprRenderResumen();
}

function _cprRenderPendientes() {
  const cont = _cprEl('comp-pendientes');
  if (!cont) return;
  const ps = comprasPendientes();
  if (!ps.length) { cont.innerHTML = ''; return; }
  const monto = ps.reduce((s, c) => s + _num(c.importe), 0);
  const urg = ps.filter(c => _cprTxt(c.urgencia).toLowerCase() === 'alta').length;
  cont.innerHTML = '<div class="alert" style="margin:0 0 14px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d"><div>' +
    '<strong>' + ps.length + ' solicitud(es) esperando decisión por ' + fmtPeso(monto) + '.</strong> ' +
    (urg ? '<strong style="color:var(--danger)">' + urg + ' marcada(s) como urgentes.</strong> ' : '') +
    '<span style="opacity:.85">Se cuentan de todos los meses, no solo del que estás mirando: ' +
    'una solicitud sin decidir escondida detrás del filtro es una que no se decide nunca.</span> ' +
    '<button class="btn btn-sm" style="margin-left:6px" onclick="compVerPendientes()">Verlas</button>' +
    '</div></div>';
}

function compVerPendientes() {
  compFiltroEstado = 'solicitada';
  if (typeof panelTodosLosMeses === 'function' && typeof _panelMesActivo === 'function'
    && _panelMesActivo('compras') !== '') panelTodosLosMeses('compras');
  switchComprasTab('registro');
}

function _cprCard(cls, icono, etq, valor, sub) {
  return '<div class="metric-card' + (cls ? ' ' + cls : '') + '">' +
    '<div class="metric-ic"><i class="ic ' + icono + '"></i></div>' +
    '<div class="metric-label">' + etq + '</div><div class="metric-value">' + valor + '</div>' +
    '<div class="metric-sub">' + sub + '</div></div>';
}

function _cprBarras(partes, total, colores) {
  if (!partes.length) return '<div class="muted" style="font-size:12px">Sin movimientos</div>';
  return partes.map((p, i) => {
    const col = colores[i % colores.length];
    const pct = total ? Math.round(p.cnt * 100 / total) : 0;
    return '<div class="dash-bar-row">' +
      '<span class="lbl"><span class="dot" style="background:' + col + '"></span>' + p.label + '</span>' +
      '<span class="dash-bar-track"><span class="dash-bar-fill" style="width:' + pct + '%;background:' + col + '"></span></span>' +
      '<span class="meta"><b style="color:' + col + '">' + pct + '%</b><span>' + fmtPeso(p.cnt) + '</span></span>' +
      '</div>';
  }).join('');
}

const _CPR_COLORES = ['#8b5cf6', '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#9ca3af'];

function _cprRenderResumen() {
  const cont = _cprEl('comp-resumen');
  if (!cont) return;
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('compras') : '';
  const rotulo = mes ? _cprMesTexto(mes) : 'todos los meses';
  const eg = comprasEgresoMes(mes);
  const comprado = comprasCompradoMes(mes);
  const futuro = comprasComprometido(mes);
  const sol = comprasSolicitudes(mes);

  // ── Lo que sale de caja ───────────────────────────────────────────────
  let h = '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:6px">' +
    _cprCard('accent', 'ic-dollar', 'Sale de caja · ' + rotulo, fmtPeso(eg.total),
      eg.filas.length + ' pago(s)' +
      (eg.arrastre > 0 ? ' · ' + fmtPeso(eg.arrastre) + ' son cuotas de compras anteriores' : '')) +
    _cprCard('', 'ic-cart', 'Comprado · ' + rotulo, fmtPeso(comprado.total),
      comprado.n + ' compra(s) con fecha en el mes') +
    _cprCard('', 'ic-calendar', 'Comprometido a futuro', mes ? fmtPeso(futuro.total) : '—',
      mes ? futuro.n + ' cuota(s) ya firmadas que salen después' : 'elegí un mes para verlo') +
    '</div>' +
    '<div class="muted" style="font-size:11px;margin-bottom:16px">' +
    'El mes dice <strong>lo que se paga</strong>, no lo que se compró: una compra con tarjeta en cuotas ' +
    'reparte su importe en los meses en que se cobra. Por eso los dos primeros números no coinciden ' +
    '—y por eso tampoco coinciden con la planilla vieja, que ponía el importe entero en el mes de la compra.' +
    '</div>';

  // ── Las solicitudes ───────────────────────────────────────────────────
  const chip = (k, n, monto) => {
    const inf = COMPRAS_ESTADOS[k];
    return '<div style="flex:1;min-width:120px;border-left:3px solid ' + inf.color + ';padding:6px 10px">' +
      '<div style="font-size:19px;font-weight:700">' + n + '</div>' +
      '<div style="font-size:11px;color:var(--text-secondary)">' + inf.corto + ' · ' + sol.pct(n) + '%</div>' +
      '<div style="font-size:11px;color:var(--text-muted)" class="mono">' + fmtPeso(monto) + '</div></div>';
  };
  const cumpl = sol.autorizadas ? Math.round(sol.ejecutadas * 100 / sol.autorizadas) : 0;
  h += '<div class="card" style="margin-bottom:16px"><div class="card-header">' +
    '<span class="card-title">Solicitudes de ' + rotulo + '</span>' +
    '<span class="muted" style="font-size:11px">por fecha de solicitud · ' + sol.total +
    ' por ' + fmtPeso(sol.monto) + '</span></div><div class="card-body">' +
    (sol.total
      ? '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        chip('aprobada', sol.aprobadas, sol.montoAprobadas) +
        chip('programada', sol.programadas, sol.montoProgramadas) +
        chip('rechazada', sol.rechazadas, sol.montoRechazadas) +
        chip('solicitada', sol.pendientes, sol.montoPendientes) +
        '</div>' +
        '<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">' +
        '<strong>Cumplimiento: ' + cumpl + '%</strong> — de las ' + sol.autorizadas +
        ' autorizadas (aprobadas + programadas), ' + sol.ejecutadas + ' ya se compraron. ' +
        '<span style="opacity:.8">Una aprobación que nadie ejecuta es una decisión que no pasó nada.</span></div>'
      : '<div class="muted" style="font-size:12px">No entró ninguna solicitud en ' + rotulo + '.</div>') +
    '</div></div>';

  // ── Evolución mes a mes ───────────────────────────────────────────────
  h += '<div class="card" style="margin-bottom:16px"><div class="card-header">' +
    '<span class="card-title">Evolución mes a mes</span>' +
    '<span class="muted" style="font-size:11px">lo que sale de caja cada mes · ' +
    'el filtro de arriba no la acota, para poder comparar</span></div>' +
    '<div class="card-body">' + _cprGrafico(comprasSerieMensual(), mes) + '</div></div>';

  // ── Repartos: los tres salen de la MISMA base ─────────────────────────
  const bloque = (titulo, nota, partes) =>
    '<div class="card"><div class="card-header"><span class="card-title">' + titulo + '</span>' +
    '<span class="muted" style="font-size:11px">' + nota + '</span></div><div class="card-body">' +
    '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
    '<div>' + (typeof _dashDonut === 'function'
      ? _dashDonut(partes.map((p, i) => ({ label: p.label, cnt: p.cnt, color: _CPR_COLORES[i % _CPR_COLORES.length] })),
        eg.total, { valor: fmtPeso(eg.total), etiqueta: 'del mes', chico: true }, fmtPeso)
      : '') + '</div>' +
    '<div style="flex:1;min-width:260px">' + _cprBarras(partes, eg.total, _CPR_COLORES) + '</div>' +
    '</div></div></div>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
    bloque('Consumo por sector', 'quién gasta', comprasReparto(eg.filas, 'sector', 'Sin sector')) +
    bloque('Categorías de consumo', 'en qué se gasta', comprasReparto(eg.filas, 'categoria', 'Sin categoría')) +
    '</div>' +
    bloque('Forma de pago', 'cómo se paga', comprasReparto(eg.filas, 'forma_pago', 'Sin registrar'));

  h += '<div class="muted" style="font-size:11px;margin-top:10px">' +
    'Los tres repartos salen del mismo conjunto —lo que sale de caja en ' + rotulo + '— así que las tres ' +
    'sumas dan exactamente ' + fmtPeso(eg.total) + '. Si alguna no diera, el panel se estaría contradiciendo.' +
    '</div>';

  cont.innerHTML = h;
}

// Gráfico de barras a mano, como el resto de los de la app: una dependencia
// nueva por un gráfico de barras no se paga.
function _cprGrafico(serie, mesActivo) {
  if (!serie.length) return '<div class="muted" style="font-size:12px">Todavía no hay compras cargadas.</div>';
  const W = 760, H = 210, padL = 8, padB = 34, padT = 24;
  const max = Math.max.apply(null, serie.map(s => s.total)) || 1;
  const bw = Math.max(10, (W - padL * 2) / serie.length - 8);
  const paso = (W - padL * 2) / serie.length;
  const barras = serie.map((s, i) => {
    const x = padL + i * paso + (paso - bw) / 2;
    const alto = Math.max(1, (H - padT - padB) * (s.total / max));
    const y = H - padB - alto;
    const act = s.mes === mesActivo;
    const col = act ? 'var(--accent)' : '#3b82f6';
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
      '" height="' + alto.toFixed(1) + '" rx="3" fill="' + col + '" opacity="' + (act ? 1 : 0.75) + '">' +
      '<title>' + _cprMesTexto(s.mes) + ': ' + fmtPeso(s.total) + '</title></rect>' +
      (serie.length <= 16
        ? '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) +
          '" text-anchor="middle" style="font-size:9px;fill:var(--text-secondary)">' +
          _cprMiles(s.total) + '</text>'
        : '') +
      '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - padB + 14) +
      '" text-anchor="middle" style="font-size:9px;fill:var(--text-muted)' +
      (act ? ';font-weight:700' : '') + '">' + _cprMesCorto(s.mes) + '</text>';
  }).join('');
  const total = serie.reduce((s, x) => s + x.total, 0);
  const pico = serie.reduce((a, b) => b.total > a.total ? b : a, serie[0]);
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" ' +
    'aria-label="Egreso de caja por mes">' +
    '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padL) + '" y2="' + (H - padB) +
    '" stroke="var(--border)"/>' + barras + '</svg>' +
    '<div class="muted" style="font-size:11px;margin-top:6px">' +
    serie.length + ' mes(es) · total ' + fmtPeso(total) + ' · el más alto fue ' +
    _cprMesTexto(pico.mes) + ' con ' + fmtPeso(pico.total) + '.</div>';
}

function _cprMiles(n) {
  const v = Math.round(_num(n));
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1).replace('.', ',') + 'M';
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'k';
  return '$' + v;
}

// ── Registro ────────────────────────────────────────────────────────────
function comprasFiltradas() {
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('compras') : '';
  const q = _cprTxt(compBusca).toLowerCase();
  return comprasTodas().filter(c => {
    // El Registro acota por FECHA DE SOLICITUD: es el registro de lo que se
    // pidió. Una sola regla, dicha en la pantalla, y "Todos" a un clic.
    if (mes && _cprMesDe(c.fecha_solicitud) !== mes) return false;
    if (compFiltroEstado && (c.estado || 'solicitada') !== compFiltroEstado) return false;
    if (compFiltroSector && _cprTxt(c.sector) !== compFiltroSector) return false;
    if (q) {
      const txt = [c.producto, c.sector, c.categoria, c.obs, c.solicitado_por].join(' ').toLowerCase();
      if (txt.indexOf(q) < 0) return false;
    }
    return true;
  }).sort((a, b) => String(b.fecha_solicitud || '').localeCompare(String(a.fecha_solicitud || ''))
    || _num(b.id) - _num(a.id));
}

function _cprRenderRegistro() {
  const cont = _cprEl('comp-registro');
  if (!cont) return;
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('compras') : '';
  const lista = comprasFiltradas();
  const puede = (typeof puedeAutorizar === 'function') ? puedeAutorizar() : false;

  const selEstado = '<select id="comp-f-estado" onchange="compFiltroEstado=this.value;renderCompras()" ' +
    'style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">' +
    '<option value="">Todos los estados</option>' +
    Object.keys(COMPRAS_ESTADOS).map(k => '<option value="' + k + '"' +
      (compFiltroEstado === k ? ' selected' : '') + '>' + COMPRAS_ESTADOS[k].corto + '</option>').join('') +
    '</select>';
  const selSector = '<select id="comp-f-sector" onchange="compFiltroSector=this.value;renderCompras()" ' +
    'style="padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">' +
    '<option value="">Todos los sectores</option>' +
    COMPRAS_SECTORES.map(s => '<option value="' + jsAttr(s) + '"' +
      (compFiltroSector === s ? ' selected' : '') + '>' + s + '</option>').join('') +
    '</select>';

  const filas = lista.map(c => {
    const est = COMPRAS_ESTADOS[c.estado || 'solicitada'] || COMPRAS_ESTADOS.solicitada;
    const cuotas = comprasCuotas(c);
    const chipEstado = '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;' +
      'font-weight:600;color:#fff;background:' + est.color + '">' + est.corto + '</span>';
    const urg = _cprTxt(c.urgencia).toLowerCase();
    const chipUrg = urg === 'alta'
      ? '<span style="font-size:10px;color:var(--danger);font-weight:700"> · urgente</span>' : '';
    const compraTxt = compraRealizada(c)
      ? isoToDMY(c.fecha_compra) + ' · ' + (_cprTxt(c.forma_pago) || '—') +
        (cuotas.length > 1 ? ' en ' + cuotas.length + ' cuotas de ' + fmtPeso(cuotas[0].monto) : '')
      : '<span class="muted">sin comprar</span>';
    const acciones =
      (puede && (c.estado || 'solicitada') === 'solicitada'
        ? '<button class="btn btn-sm" onclick="abrirDecisionCompra(' + _num(c.id) + ",'aprobada')\" " +
          'title="Aprobar: se compra">Aprobar</button> ' +
          '<button class="btn btn-sm" onclick="abrirDecisionCompra(' + _num(c.id) + ",'programada')\" " +
          'title="Programada: aprobada, pero para más adelante">Programar</button> ' +
          '<button class="btn btn-sm" onclick="abrirDecisionCompra(' + _num(c.id) + ",'rechazada')\" " +
          'title="Rechazar la solicitud">Rechazar</button> '
        : '') +
      ((c.estado === 'aprobada' || c.estado === 'programada') && !compraRealizada(c)
        ? '<button class="btn btn-sm btn-primary" onclick="abrirRegistrarCompra(' + _num(c.id) + ')">Registrar compra</button> '
        : '') +
      '<button class="btn btn-sm" onclick="abrirCompraModal(' + _num(c.id) + ')" title="Editar la solicitud">✎</button>';
    return '<tr>' +
      '<td class="mono">' + (isoToDMY(c.fecha_solicitud) || '—') + '</td>' +
      '<td>' + (_cprTxt(c.sector) || '<span class="muted">—</span>') + '</td>' +
      '<td><strong>' + (_cprTxt(c.producto) || '—') + '</strong>' + chipUrg +
        (_cprTxt(c.obs) ? '<div class="muted" style="font-size:11px">' + c.obs + '</div>' : '') + '</td>' +
      '<td style="font-size:12px">' + (_cprTxt(c.categoria) || '<span class="muted">—</span>') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(_num(c.importe)) + '</td>' +
      '<td>' + chipEstado +
        (_cprTxt(c.motivo) ? '<div class="muted" style="font-size:11px">' + c.motivo + '</div>' : '') + '</td>' +
      '<td style="font-size:12px">' + compraTxt + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' + acciones + '</td>' +
      '</tr>';
  }).join('');

  const totalLista = lista.reduce((s, c) => s + _num(c.importe), 0);
  cont.innerHTML =
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<input type="search" id="comp-search" placeholder="Buscar producto, sector, quién pidió…" ' +
    'value="' + jsAttr(compBusca) + '" oninput="compBusca=this.value;renderCompras()" ' +
    'style="width:300px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px">' +
    selEstado + selSector +
    '<button class="btn btn-primary btn-sm" onclick="abrirCompraModal(null)" style="margin-left:auto">' +
    '<i class="ic ic-plus"></i> Nueva solicitud</button>' +
    '</div>' +
    '<div class="muted" style="font-size:11px;margin-bottom:8px">' +
    (mes ? 'Las solicitudes que entraron en <strong>' + _cprMesTexto(mes) + '</strong> (por fecha de solicitud). ' +
      'Una compra de este mes que nació de una solicitud anterior se ve poniendo “Todos”.'
      : 'Todas las solicitudes cargadas.') +
    ' · Mostrando <strong>' + lista.length + '</strong> por ' + fmtPeso(totalLista) + '</div>' +
    '<div class="table-wrap"><table><thead><tr>' +
    '<th>Solicitud</th><th>Sector</th><th>Producto</th><th>Categoría</th>' +
    '<th style="text-align:right">Importe</th><th>Estado</th><th>Compra</th><th></th>' +
    '</tr></thead><tbody>' +
    (filas || '<tr><td colspan="8" class="muted" style="text-align:center;padding:18px">' +
      'No hay solicitudes con estos filtros.</td></tr>') +
    '</tbody></table></div>';
}

// ── Alta y edición de la solicitud ──────────────────────────────────────
function compraPorId(id) {
  return comprasTodas().find(c => _num(c.id) === _num(id)) || null;
}

function abrirCompraModal(id) {
  compEditId = id ? _num(id) : null;
  const c = compEditId ? compraPorId(compEditId) : null;
  const t = _cprEl('modal-compra-title');
  if (t) t.textContent = c ? 'Editar solicitud' : 'Nueva solicitud de compra';
  const sel = (el, opts, val, vacio) => {
    const e = _cprEl(el); if (!e) return;
    e.innerHTML = (vacio ? '<option value="">' + vacio + '</option>' : '') +
      opts.map(o => '<option value="' + jsAttr(o) + '"' + (val === o ? ' selected' : '') + '>' +
        o + (COMPRAS_CAT_AYUDA[o] ? ' (' + COMPRAS_CAT_AYUDA[o] + ')' : '') + '</option>').join('');
  };
  sel('mcompra-sector', COMPRAS_SECTORES, c ? c.sector : '', 'Elegí el sector…');
  sel('mcompra-categoria', COMPRAS_CATEGORIAS, c ? c.categoria : '', 'Elegí la categoría…');
  sel('mcompra-urgencia', COMPRAS_URGENCIAS, c ? _cprTxt(c.urgencia).toLowerCase() : 'media', '');
  const v = (el, val) => { const e = _cprEl(el); if (e) e.value = val == null ? '' : val; };
  v('mcompra-producto', c ? c.producto : '');
  v('mcompra-fecha', c ? c.fecha_solicitud : (typeof hoyISO === 'function' ? hoyISO() : ''));
  v('mcompra-importe', c ? (_num(c.importe) || '') : '');
  v('mcompra-solicitante', c ? c.solicitado_por : '');
  v('mcompra-obs', c ? c.obs : '');
  const borrar = _cprEl('mcompra-borrar');
  if (borrar) borrar.style.display = c ? '' : 'none';
  const est = _cprEl('mcompra-estado-nota');
  if (est) {
    est.innerHTML = c
      ? 'Estado actual: <strong>' + (COMPRAS_ESTADOS[c.estado || 'solicitada'] || {}).corto + '</strong>. ' +
        'Para aprobarla, programarla o rechazarla se usan los botones de la fila.'
      : 'Nace <strong>esperando decisión</strong>: la aprueba o la rechaza un supervisor desde el registro.';
  }
  _cprEl('modal-compra-backdrop').style.display = 'flex';
}

function closeCompraModal(e) {
  if (!e || e.target.id === 'modal-compra-backdrop') {
    _cprEl('modal-compra-backdrop').style.display = 'none';
    compEditId = null;
  }
}

async function guardarCompraModal() {
  if (_cprGuardando) return;
  const val = id => _cprTxt((_cprEl(id) || {}).value);
  const sector = val('mcompra-sector'), producto = val('mcompra-producto');
  const categoria = val('mcompra-categoria'), fecha = val('mcompra-fecha');
  const importe = _num(val('mcompra-importe'));
  if (!sector) { alert('Elegí el sector que pide la compra.'); return; }
  if (!producto) { alert('Escribí qué se está pidiendo.'); return; }
  if (!fecha) { alert('Cargá la fecha de la solicitud.'); return; }
  if (!(importe > 0)) {
    alert('Cargá el importe cotizado. Sin importe la solicitud no se puede comparar con las otras ' +
      'ni entra en ningún total.');
    return;
  }
  const fila = {
    sector: sector, producto: producto, categoria: categoria,
    urgencia: val('mcompra-urgencia') || 'media',
    fecha_solicitud: fecha, importe: importe,
    solicitado_por: val('mcompra-solicitante'), obs: val('mcompra-obs')
  };
  // Un guardado que tarda y no deshabilita su botón INVITA al segundo clic que
  // carga la solicitud dos veces: la ventana sigue abierta mientras se escribe
  // y el segundo clic no ve la primera carga.
  _cprGuardando = true;
  const btn = _cprEl('mcompra-guardar');
  const txtPrev = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    if (compEditId) {
      await DB.updateWhere('compras', 'id', compEditId, fila);
      const c = compraPorId(compEditId);
      if (c) Object.assign(c, fila);
      showToast('✅ Solicitud actualizada');
    } else {
      fila.estado = 'solicitada';
      fila.cuotas = 1;
      fila.cargado_por = _cprOperador();
      const row = await DB.insertRow('compras', fila);
      AppData.compras = comprasTodas().concat([_cprMapear(row || fila)]);
      showToast('✅ Solicitud cargada — espera decisión');
    }
    closeCompraModal();
    renderCompras();
  } catch (e) {
    console.warn('guardarCompraModal', e);
    alert('No se pudo guardar la solicitud: ' + (e.message || e) +
      '\n\nNo quedó registrada. Reintentá en unos segundos.');
  } finally {
    _cprGuardando = false;
    if (btn) { btn.disabled = false; btn.textContent = txtPrev; }
  }
}

function _cprOperador() {
  try {
    return (typeof currentUser !== 'undefined' && currentUser)
      ? (currentUser.nombre || currentUser.usuario || '') : '';
  } catch (e) { return ''; }
}

function _cprMapear(r) {
  return {
    id: r.id, sector: r.sector || '', producto: r.producto || '', categoria: r.categoria || '',
    urgencia: r.urgencia || 'media', fecha_solicitud: String(r.fecha_solicitud || '').slice(0, 10),
    importe: _num(r.importe), estado: r.estado || 'solicitada', motivo: r.motivo || '',
    fecha_compra: r.fecha_compra ? String(r.fecha_compra).slice(0, 10) : '',
    forma_pago: r.forma_pago || '', cuotas: _num(r.cuotas) || 1, obs: r.obs || '',
    solicitado_por: r.solicitado_por || '', cargado_por: r.cargado_por || '',
    decidido_por: r.decidido_por || '', decidido_en: r.decidido_en || '',
    created_at: r.created_at || ''
  };
}

async function eliminarCompra() {
  const c = compEditId ? compraPorId(compEditId) : null;
  if (!c) return;
  if (compraRealizada(c)) {
    alert('Esta compra ya se efectuó (' + isoToDMY(c.fecha_compra) + ') y está contada en los totales ' +
      'del mes. Borrarla haría desaparecer plata que salió de caja sin dejar explicación.\n\n' +
      'Si se cargó por error, corregí el importe o la fecha desde esta misma ventana.');
    return;
  }
  if (!confirm('¿Borrar la solicitud "' + c.producto + '" de ' + c.sector + ' por ' +
    fmtPeso(_num(c.importe)) + '?\n\nSe borra del registro y no queda rastro.')) return;
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.deleteWhere('compras', 'id', c.id);
    AppData.compras = comprasTodas().filter(x => _num(x.id) !== _num(c.id));
    closeCompraModal();
    renderCompras();
    showToast('Solicitud borrada');
  } catch (e) {
    alert('No se pudo borrar: ' + (e.message || e));
  }
}

// ── La decisión: aprobar, programar o rechazar ──────────────────────────
// Es maker-checker, como los adelantos y los extravíos: carga administración y
// decide quien puede autorizar plata.
async function abrirDecisionCompra(id, estado) {
  const c = compraPorId(id);
  if (!c) return;
  if (typeof puedeAutorizar === 'function' && !puedeAutorizar()) {
    alert('Solo un supervisor o el analista pueden decidir sobre una solicitud.');
    return;
  }
  const inf = COMPRAS_ESTADOS[estado];
  let motivo = '';
  if (estado === 'rechazada' || estado === 'programada') {
    // El motivo es OBLIGATORIO: una solicitud que se rechaza o se corre sin
    // explicación no se puede auditar, y el área que pidió va a preguntar.
    motivo = _cprTxt(prompt(estado === 'rechazada'
      ? '¿Por qué se rechaza "' + c.producto + '"? (queda registrado)'
      : '¿Para cuándo queda programada "' + c.producto + '" y por qué? (queda registrado)', ''));
    if (!motivo) { alert('Hace falta el motivo: sin él, en dos meses nadie va a poder decir por qué.'); return; }
  } else {
    if (!confirm('Aprobar "' + c.producto + '" de ' + c.sector + ' por ' + fmtPeso(_num(c.importe)) + '?' +
      '\n\nQueda lista para comprar. La compra se registra después, con su fecha y forma de pago.')) return;
  }
  const campos = {
    estado: estado, motivo: motivo,
    decidido_por: _cprOperador(), decidido_en: new Date().toISOString()
  };
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.updateWhere('compras', 'id', c.id, campos);
    Object.assign(c, campos);
    renderCompras();
    showToast('Solicitud ' + inf.corto.toLowerCase());
  } catch (e) {
    alert('No se pudo registrar la decisión: ' + (e.message || e));
  }
}

// ── Registrar la compra efectuada ───────────────────────────────────────
function abrirRegistrarCompra(id) {
  const c = compraPorId(id);
  if (!c) return;
  compEjecId = _num(id);
  const t = _cprEl('modal-compraejec-title');
  if (t) t.textContent = 'Registrar la compra — ' + c.producto;
  const res = _cprEl('mcompraejec-resumen');
  if (res) {
    res.innerHTML = '<strong>' + c.producto + '</strong> · ' + c.sector + ' · ' +
      fmtPeso(_num(c.importe)) + '<div class="muted" style="font-size:11px">Aprobada el ' +
      (c.decidido_en ? isoToDMY(String(c.decidido_en).slice(0, 10)) : '—') +
      (c.decidido_por ? ' por ' + c.decidido_por : '') + '</div>';
  }
  const v = (el, val) => { const e = _cprEl(el); if (e) e.value = val == null ? '' : val; };
  v('mcompraejec-fecha', c.fecha_compra || (typeof hoyISO === 'function' ? hoyISO() : ''));
  const pago = _cprEl('mcompraejec-pago');
  if (pago) {
    pago.innerHTML = '<option value="">Elegí la forma de pago…</option>' +
      COMPRAS_PAGOS.map(p => '<option value="' + p + '"' +
        (_cprTxt(c.forma_pago).toLowerCase() === p ? ' selected' : '') + '>' +
        p.charAt(0).toUpperCase() + p.slice(1) + '</option>').join('');
  }
  v('mcompraejec-cuotas', _num(c.cuotas) || 1);
  compCuotasVisibles();
  _cprEl('modal-compraejec-backdrop').style.display = 'flex';
}

function closeRegistrarCompra(e) {
  if (!e || e.target.id === 'modal-compraejec-backdrop') {
    _cprEl('modal-compraejec-backdrop').style.display = 'none';
    compEjecId = null;
  }
}

// Las cuotas son de la tarjeta: ofrecerlas con efectivo invita a cargar algo
// que no existe, y el reparto mensual saldría repartiendo plata que salió toda
// junta.
function compCuotasVisibles() {
  const pago = _cprTxt((_cprEl('mcompraejec-pago') || {}).value).toLowerCase();
  const fila = _cprEl('mcompraejec-cuotas-fila');
  if (fila) fila.style.display = (pago === 'tarjeta') ? '' : 'none';
  compPreviewCuotas();
}

function compPreviewCuotas() {
  const c = compEjecId ? compraPorId(compEjecId) : null;
  const prev = _cprEl('mcompraejec-preview');
  if (!prev || !c) return;
  const fecha = _cprTxt((_cprEl('mcompraejec-fecha') || {}).value);
  const pago = _cprTxt((_cprEl('mcompraejec-pago') || {}).value).toLowerCase();
  const cuotas = Math.max(1, Math.round(_num((_cprEl('mcompraejec-cuotas') || {}).value) || 1));
  if (!fecha) { prev.innerHTML = ''; return; }
  const sim = comprasCuotas({ importe: _num(c.importe), fecha_compra: fecha, forma_pago: pago, cuotas: cuotas });
  if (sim.length <= 1) {
    prev.innerHTML = '<div class="muted" style="font-size:12px">Sale entero en <strong>' +
      _cprMesTexto(_cprMesDe(fecha)) + '</strong>: ' + fmtPeso(_num(c.importe)) + '.</div>';
    return;
  }
  // Se muestra ANTES de guardar en qué meses va a pesar: es la consecuencia
  // que no se ve, y la que mueve los totales de los meses que vienen.
  prev.innerHTML = '<div style="font-size:12px"><strong>Se reparte en ' + sim.length + ' meses:</strong> ' +
    sim.map(q => _cprMesCorto(q.mes) + ' ' + fmtPeso(q.monto)).join(' · ') +
    '<div class="muted" style="font-size:11px;margin-top:3px">Suman ' +
    fmtPeso(sim.reduce((s, q) => s + q.monto, 0)) + ', exactamente el importe de la compra.</div></div>';
}

async function guardarRegistrarCompra() {
  if (_cprGuardando) return;
  const c = compEjecId ? compraPorId(compEjecId) : null;
  if (!c) return;
  const fecha = _cprTxt((_cprEl('mcompraejec-fecha') || {}).value);
  const pago = _cprTxt((_cprEl('mcompraejec-pago') || {}).value).toLowerCase();
  const cuotas = (pago === 'tarjeta')
    ? Math.max(1, Math.round(_num((_cprEl('mcompraejec-cuotas') || {}).value) || 1)) : 1;
  if (!fecha) { alert('Cargá la fecha de la compra: es la que decide en qué mes pesa.'); return; }
  if (!pago) { alert('Elegí la forma de pago.'); return; }
  if (cuotas > 36) { alert('¿' + cuotas + ' cuotas? Revisá el número.'); return; }
  const campos = { fecha_compra: fecha, forma_pago: pago, cuotas: cuotas };
  _cprGuardando = true;
  const btn = _cprEl('mcompraejec-guardar');
  const txtPrev = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.updateWhere('compras', 'id', c.id, campos);
    Object.assign(c, campos);
    closeRegistrarCompra();
    renderCompras();
    const sim = comprasCuotas(c);
    showToast('✅ Compra registrada' + (sim.length > 1
      ? ' — se reparte en ' + sim.length + ' meses' : ' en ' + _cprMesTexto(_cprMesDe(fecha))));
  } catch (e) {
    alert('No se pudo registrar la compra: ' + (e.message || e));
  } finally {
    _cprGuardando = false;
    if (btn) { btn.disabled = false; btn.textContent = txtPrev; }
  }
}
