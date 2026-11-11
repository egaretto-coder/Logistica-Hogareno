// ════════════════════════════════════════════════════════════════════════
//  TABLA DE COSTOS — cada costo de la empresa, con su categoría y su aprobación
//  ------------------------------------------------------------------------
//  Reemplaza la planilla que hoy carga un operador a mano. De acá salen los
//  análisis con los que la empresa mira rentabilidad y margen, así que las
//  dos cosas que la hacen servir son que los repartos CIERREN contra el total
//  y que un costo que nadie verificó no mueva ningún número.
//
//  EL CATÁLOGO TIENE DOS NIVELES: categoría › detalle. No es un adorno: la
//  planilla real tiene "Operaciones y oficina" con `Alquiler` (Fijos) y
//  `Librería` (Varios) adentro, así que **el tipo NO lo decide la
//  categoría** — 7 de las 11 tienen más de un tipo. Lo decide EL PAR
//  (`costoTipoDe(categoria, detalle)`), que en la planilla de septiembre es
//  inequívoco en 49 de 53 casos.
//
//  EL TIPO NO SE GUARDA, SE DERIVA. Es la decisión del negocio y es lo que
//  hace comparables los meses: con el tipo elegido a mano el mismo gasto
//  entra clasificado de dos formas según quién cargue. Mismo criterio que la
//  edad en RRHH y el mes de una compra — guardar el resultado además del
//  factor es la forma de que queden en desacuerdo.
// ════════════════════════════════════════════════════════════════════════

// Los tres tipos, con las palabras de la planilla (plural). El orden es el de
// lectura: lo que no se puede bajar, lo que acompaña al volumen, el resto.
const COSTOS_TIPOS = ['Fijos', 'Variables', 'Varios'];

// Un par que ya no está en el catálogo NO se esconde ni se mete a la fuerza
// en uno de los tres: cae acá, se cuenta aparte y el panel dice cuántos son.
// Un reparto que no cierra contra el total miente sin que se note — mismo
// criterio que "Fuera del tarifario" en el reporte de zonas.
const COSTOS_SIN_CLASIFICAR = 'Sin clasificar';

// EL CATÁLOGO VIVE EN LA TABLA `costos_catalogo`, no acá. El negocio pidió
// poder crear una categoría o un detalle desde el panel, y un catálogo
// editable no puede vivir en una constante — es el mismo criterio que
// `proveedores`, que es tabla justamente porque se da de alta desde la
// pantalla. La semilla son los 52 pares de la planilla de septiembre de 2026
// y está en supabase/migracion-2026-11-10-catalogo-costos.sql.
//
// Se deriva en cada lectura y NO se cachea por índice: una categoría recién
// creada tiene que aparecer en el selector del modal que está abierto, y un
// índice viejo mostraría el catálogo de hace un rato. Cuesta una pasada
// sobre ~50 filas.
//
// El orden es el de INSERCIÓN (id): preserva el orden por peso de la
// planilla y deja lo nuevo al final, que es predecible. Alfabético mezclaría
// "Conductor" ($126 M) entre categorías de $300.000.
function costosCategorias(incluirBajas) {
  const porCat = new Map();
  (AppData.costosCatalogo || []).forEach(f => {
    if (!incluirBajas && f.activo === false) return;
    const cat = _cosTxt(f.categoria);
    const det = _cosTxt(f.detalle);
    if (!cat || !det) return;
    if (!porCat.has(cat)) porCat.set(cat, { nombre: cat, detalles: [] });
    porCat.get(cat).detalles.push({ id: f.id, nombre: det, tipo: f.tipo, activo: f.activo !== false });
  });
  return Array.from(porCat.values());
}
// Una categoría EXISTE mientras tenga al menos un detalle: no hay fila propia
// de categoría, porque una categoría sin detalles no puede clasificar nada.
function costosNombresCategorias(incluirBajas) {
  return costosCategorias(incluirBajas).map(c => c.nombre);
}

const COSTOS_ESTADOS = {
  pendiente:  { label: 'Esperando aprobación', color: '#f59e0b', corto: 'Sin aprobar' },
  autorizado: { label: 'Aprobado',             color: '#10b981', corto: 'Aprobado' },
  rechazado:  { label: 'Rechazado',            color: '#ef4444', corto: 'Rechazado' }
};

// Colores de los tipos. Van como constante y no inline en cada render para
// que la barra, la fila y el Excel digan el mismo color del mismo concepto.
const COSTOS_TIPO_COLOR = {
  'Fijos': '#3b82f6', 'Variables': '#f59e0b', 'Varios': '#8b5cf6',
  [COSTOS_SIN_CLASIFICAR]: '#9ca3af'
};
// La CLASE de cada tipo y de cada estado. El color del texto no puede ir
// inline: el mismo hex no sirve en los dos temas, y acá se leen importes.
const COSTOS_TIPO_CLASE = {
  'Fijos': 'cos-fijo', 'Variables': 'cos-variable', 'Varios': 'cos-varios',
  [COSTOS_SIN_CLASIFICAR]: 'cos-sinclas'
};
const _cosClaseTipo = t => COSTOS_TIPO_CLASE[t] || 'cos-sinclas';
const _cosClaseEstado = e => 'cos-' + (COSTOS_ESTADOS[e] ? e : 'pendiente');

let cosTab = 'resumen';
let cosBusca = '';
let cosFiltroTipo = '';
let cosFiltroEstado = '';
let cosFiltroCat = '';
let cosEditId = null;
let _cosGuardando = false;

const _cosEl = id => document.getElementById(id);
const _cosTxt = v => String(v == null ? '' : v).trim();
// Texto libre que va al HTML. No hay un escapador global en el proyecto: cada
// módulo tiene el suyo. Para lo que va DENTRO de un onclick se usa jsAttr(),
// que escapa los dos parsers (el del atributo y el de JavaScript).
function _cosEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const _COS_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Los nombres de los meses son de este módulo y no prestados de otro: el
// banco ya agarró una vez un panel mostrando "2026-08" donde tenía que decir
// "agosto 2026".
function _cosMesTexto(mes) {
  const p = String(mes || '').split('-');
  if (p.length < 2) return '';
  const i = +p[1] - 1;
  return (_COS_MESES[i] || '') + ' ' + p[0];
}
function _cosMesVecino(mes, n) {
  const d = new Date(+String(mes).slice(0, 4), +String(mes).slice(5, 7) - 1 + _num(n), 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── El catálogo ──────────────────────────────────────────────────────────
const _cosNorm = s => _cosTxt(s).toLowerCase();
function costoCategoria(nombre) {
  const n = _cosNorm(nombre);
  return costosCategorias(true).find(c => _cosNorm(c.nombre) === n) || null;
}
// Los detalles de una categoría, para el segundo selector.
function costoDetallesDe(categoria) {
  const c = costoCategoria(categoria);
  return c ? c.detalles : [];
}
function costoDetalle(categoria, detalle) {
  const d = _cosNorm(detalle);
  return costoDetallesDe(categoria).find(x => _cosNorm(x.nombre) === d) || null;
}
// EL TIPO SALE DEL PAR, SIEMPRE. Un par que ya no está en el catálogo
// devuelve "Sin clasificar" en vez de caer en uno de los tres: meterlo a la
// fuerza movería un total sin que nadie lo note, y esconderlo dejaría el
// reparto sin cerrar contra el total.
function costoTipoDe(categoria, detalle) {
  const d = costoDetalle(categoria, detalle);
  return d ? d.tipo : COSTOS_SIN_CLASIFICAR;
}
// Fuera del catálogo: o la categoría no existe, o el detalle no es de ella.
function costoFueraDeLista(categoria, detalle) {
  if (_cosTxt(categoria) === '') return false;
  return !costoDetalle(categoria, detalle);
}

// ── Lectura ──────────────────────────────────────────────────────────────
function costoMesDe(c) { return String((c && c.fecha) || '').slice(0, 7); }

// Los costos de un mes, de cualquier estado. Sin mes devuelve todos: "Todos"
// del navegador es un interruptor real, no un mes vacío.
function costosDelMes(mes) {
  const todos = AppData.costos || [];
  if (!mes) return todos.slice();
  return todos.filter(c => costoMesDe(c) === mes);
}

// EL TOTAL DEL MES ES SOLO LO APROBADO. Lo pendiente se devuelve aparte con
// su importe para poder avisarlo: un resumen que lo esconde miente por
// omisión, y uno que lo suma da por bueno lo que nadie verificó.
//
// Los repartos (por tipo y por categoría) salen de LAS MISMAS filas que el
// total, así que suman exactamente eso. El banco lo verifica: un reparto que
// no cierra es la peor forma de mostrar un número.
function costosResumen(mes) {
  const filas = costosDelMes(mes);
  const aprobados = filas.filter(c => _cosTxt(c.estado) === 'autorizado');
  const pendientes = filas.filter(c => _cosTxt(c.estado) === 'pendiente');
  const rechazados = filas.filter(c => _cosTxt(c.estado) === 'rechazado');

  const porTipo = new Map();
  const porCategoria = new Map();
  let total = 0;
  aprobados.forEach(c => {
    const m = _num(c.monto);
    total += m;
    // EL TIPO SALE DEL PAR. Una categoría sola no alcanza: "Operaciones y
    // oficina" tiene Alquiler (Fijos) y Librería (Varios) adentro.
    const t = costoTipoDe(c.categoria, c.detalle);
    porTipo.set(t, (porTipo.get(t) || 0) + m);
    const k = _cosTxt(c.categoria) || '(sin categoría)';
    const prev = porCategoria.get(k) ||
      { categoria: k, monto: 0, n: 0, fuera: false, tipos: new Map(), dets: new Map() };
    prev.monto += m; prev.n++;
    if (costoFueraDeLista(c.categoria, c.detalle)) prev.fuera = true;
    prev.tipos.set(t, (prev.tipos.get(t) || 0) + m);
    const dk = _cosTxt(c.detalle) || '(sin detalle)';
    const d = prev.dets.get(dk) || { detalle: dk, tipo: t, monto: 0, n: 0 };
    d.monto += m; d.n++;
    prev.dets.set(dk, d);
    porCategoria.set(k, prev);
  });

  // Los tipos salen en el orden de lectura y SIN los que no tienen nada: un
  // renglón en $0 que sale siempre deja de leerse. "Sin clasificar" va último
  // y solo si existe.
  const tipos = COSTOS_TIPOS.concat([COSTOS_SIN_CLASIFICAR])
    .filter(t => (porTipo.get(t) || 0) !== 0)
    .map(t => ({ tipo: t, monto: porTipo.get(t) || 0,
                 pct: total ? (porTipo.get(t) || 0) / total * 100 : 0 }));

  // Cada fila del ranking lleva sus DETALLES (ordenados por plata) y la
  // mezcla de tipos: una categoría puede tener más de uno, así que mostrar
  // "el" tipo de la categoría sería inventar un dato que no existe.
  const cats = Array.from(porCategoria.values()).map(x => Object.assign({}, x, {
    pct: total ? x.monto / total * 100 : 0,
    detalles: Array.from(x.dets.values()).sort((a, b) => b.monto - a.monto),
    mezcla: Array.from(x.tipos.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0])
  })).sort((a, b) => b.monto - a.monto);

  return {
    mes: mes || '', filas, aprobados, total,
    tipos, categorias: cats,
    pendientes: { n: pendientes.length, monto: pendientes.reduce((s, c) => s + _num(c.monto), 0) },
    rechazados: { n: rechazados.length, monto: rechazados.reduce((s, c) => s + _num(c.monto), 0) },
    // Cuántos PARES quedaron fuera del catálogo. No se esconden: el panel lo
    // dice y con eso se sabe qué hay que reclasificar.
    fuera: aprobados.filter(c => costoFueraDeLista(c.categoria, c.detalle)).length
  };
}

// La variación de cada categoría contra el mes anterior. Un total que sube no
// dice DÓNDE subió, y esa es la pregunta con la que se toman las decisiones.
function costosVariacion(mes) {
  if (!mes) return new Map();
  const ant = costosResumen(_cosMesVecino(mes, -1));
  const m = new Map();
  ant.categorias.forEach(c => m.set(c.categoria, c.monto));
  return m;
}

// Los últimos N meses, para ver la tendencia. Se arma hacia atrás desde el
// mes dado, así un mes sin costos aparece en cero en vez de saltearse — un
// hueco que no se dibuja se lee como que ese mes no existió.
function costosEvolucion(mesHasta, n) {
  const cant = Math.max(1, _num(n) || 6);
  const out = [];
  for (let i = cant - 1; i >= 0; i--) {
    const m = _cosMesVecino(mesHasta, -i);
    const r = costosResumen(m);
    const porT = {};
    r.tipos.forEach(t => { porT[t.tipo] = t.monto; });
    out.push({ mes: m, total: r.total, porTipo: porT });
  }
  return out;
}

// Lo que espera decisión, de TODOS los meses. No sigue al navegador: es el
// trabajo pendiente del supervisor, y esconderlo detrás de un filtro de mes
// es exactamente como se pasa de largo — la misma lección que la deuda
// vigente de Adelantos y que las compras sin decidir.
function costosPendientes() {
  return (AppData.costos || [])
    .filter(c => _cosTxt(c.estado) === 'pendiente')
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

// ── Lo que muestra la tabla ──────────────────────────────────────────────
// UNA sola fuente para la tabla y para las descargas. Si la descarga filtrara
// distinto, el archivo diría otra cosa que lo que el operador está mirando —
// que es el bug que ya tuvo Liquidación de conductores.
function costosFiltrados() {
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('costos') : '';
  let filas = costosDelMes(mes);
  const q = _cosTxt(cosBusca).toLowerCase();
  if (q) {
    filas = filas.filter(c =>
      _cosTxt(c.categoria).toLowerCase().includes(q) ||
      _cosTxt(c.detalle).toLowerCase().includes(q) ||
      _cosTxt(c.descripcion).toLowerCase().includes(q));
  }
  if (cosFiltroTipo) filas = filas.filter(c => costoTipoDe(c.categoria, c.detalle) === cosFiltroTipo);
  if (cosFiltroCat) filas = filas.filter(c => _cosNorm(c.categoria) === _cosNorm(cosFiltroCat));
  if (cosFiltroEstado) filas = filas.filter(c => _cosTxt(c.estado) === cosFiltroEstado);
  return filas.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id));
}

// Qué filtros tenía puestos, escrito con palabras. Va a la primera línea de
// cada descarga: un archivo recortado que no lo dice es un papel que miente.
function costosFiltrosTxt() {
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('costos') : '';
  const p = [mes ? _cosMesTexto(mes) : 'todos los meses'];
  if (cosBusca) p.push('búsqueda: "' + cosBusca + '"');
  if (cosFiltroCat) p.push('categoría: ' + cosFiltroCat);
  if (cosFiltroTipo) p.push('tipo: ' + cosFiltroTipo);
  if (cosFiltroEstado) p.push('estado: ' + (COSTOS_ESTADOS[cosFiltroEstado] || {}).corto);
  return p.join(' · ');
}

// ════════════════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════════════════

// El router entra por acá y REABRE LA SOLAPA QUE ESTABA, no la primera: la
// sincronización en vivo re-renderiza la pantalla activa pasando por
// showPage, así que con la primera hardcodeada al operador se le cerraba
// sola la solapa que estaba mirando. Un re-render no puede moverlo de lugar.
function renderCostosPagina() {
  switchCostosTab(cosTab || 'resumen');
}

function switchCostosTab(t) {
  cosTab = (t === 'registro' || t === 'catalogo') ? t : 'resumen';
  ['resumen', 'registro', 'catalogo'].forEach(k => {
    const pane = _cosEl('cos-pane-' + k);
    const tab = _cosEl('cos-tab-' + k);
    if (pane) pane.style.display = (k === cosTab) ? '' : 'none';
    if (tab) tab.classList.toggle('active', k === cosTab);
  });
  renderCostos();
}

function renderCostos() {
  if (typeof _pintarPanelMes === 'function') _pintarPanelMes('costos');
  _renderCostosPendientes();
  if (cosTab === 'registro') _renderCostosRegistro();
  else if (cosTab === 'catalogo') _renderCostosCatalogo();
  else _renderCostosResumen();
}

// ── Lo que espera decisión ───────────────────────────────────────────────
function _renderCostosPendientes() {
  const cont = _cosEl('cos-pendientes');
  if (!cont) return;
  const ps = costosPendientes();
  if (!ps.length) { cont.innerHTML = ''; return; }
  const monto = ps.reduce((s, c) => s + _num(c.monto), 0);
  const puede = (typeof puedeAutorizar === 'function') && puedeAutorizar();
  cont.innerHTML =
    '<div class="alert" style="margin:0 0 14px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d"><div>' +
    '<strong>' + ps.length + ' costo(s) esperando aprobación</strong> · ' + fmtPeso(monto) +
    ' — de todos los meses, no solo del que estás mirando.<br>' +
    '<span style="font-size:12px">No suman en ningún total hasta que se aprueben: un costo que nadie ' +
    'verificó no puede mover el margen.' +
    (puede ? ' Se aprueban desde la solapa <strong>Registro</strong>.'
           : ' Los aprueba un supervisor.') +
    '</span></div></div>';
}

// ── Resumen: los análisis ────────────────────────────────────────────────
function _renderCostosResumen() {
  const cont = _cosEl('cos-resumen');
  if (!cont) return;
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('costos') : '';
  const r = costosResumen(mes);
  const rotulo = mes ? _cosMesTexto(mes) : 'todos los meses';

  if (!r.filas.length) {
    cont.innerHTML = '<div class="alert alert-info"><div>Todavía no hay costos cargados en ' +
      _cosEsc(rotulo) + '. Cargá el primero con <strong>Nuevo costo</strong>.</div></div>';
    return;
  }

  // ── KPIs. El % fijo es el número con el que se toman las decisiones:
  //    dice cuánto del costo no se puede bajar si cae el volumen.
  // Los nombres salen de COSTOS_TIPOS y no de un literal: escritos a mano se
  // desfasan del catálogo y la tarjeta muestra $0 mientras la barra de abajo
  // dice 23,7% (pasó, y se vio en la captura).
  const montoDe = t => (r.tipos.find(x => x.tipo === t) || {}).monto || 0;
  const fijo = montoDe(COSTOS_TIPOS[0]);
  const varia = montoDe(COSTOS_TIPOS[1]);
  const pctFijo = r.total ? fijo / r.total * 100 : 0;
  let h = '<div class="metrics-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
    _cosCard('accent', 'ic-dollar', 'Costo total · ' + rotulo, fmtPeso(r.total),
      r.aprobados.length + ' registro(s) aprobado(s)') +
    _cosCard('', 'ic-lock', 'Costos ' + COSTOS_TIPOS[0].toLowerCase(), fmtPeso(fijo),
      pctFijo.toFixed(1) + '% del total — se paga igual sin volumen') +
    _cosCard('', 'ic-truck', 'Costos ' + COSTOS_TIPOS[1].toLowerCase(), fmtPeso(varia),
      (r.total ? (varia / r.total * 100).toFixed(1) : '0') + '% del total — acompaña a los envíos') +
    _cosCard('', 'ic-alert', 'Sin aprobar', r.pendientes.n ? fmtPeso(r.pendientes.monto) : '—',
      r.pendientes.n ? r.pendientes.n + ' registro(s) · NO suman en el total' : 'todo lo cargado está aprobado') +
    '</div>';

  // ── Composición por tipo. Las barras dan el número exacto, que es lo que
  //    se copia a un informe; el % da la proporción.
  h += '<div class="card" style="margin-bottom:14px"><div class="card-header">' +
    '<span class="card-title">Composición del costo</span>' +
    '<span class="muted" style="font-size:11px">suma ' + fmtPeso(r.total) + '</span></div>' +
    '<div id="cos-tipo-rows">';
  // La misma barra que el Dashboard y Compras. El % da la proporción de un
  // vistazo y el importe da el número exacto, que es lo que se copia a un
  // informe: son dos lecturas y ninguna reemplaza a la otra.
  r.tipos.forEach(t => {
    const col = COSTOS_TIPO_COLOR[t.tipo] || '#9ca3af';
    h += '<div class="dash-bar-row">' +
      '<span class="lbl"><span class="dot" style="background:' + col + '"></span>' + _cosEsc(t.tipo) + '</span>' +
      '<span class="dash-bar-track"><span class="dash-bar-fill" style="width:' + t.pct.toFixed(1) + '%;background:' + col + '"></span></span>' +
      '<span class="meta"><b class="' + _cosClaseTipo(t.tipo) + '" style="background:none;padding:0">' + t.pct.toFixed(1) + '%</b>' +
        '<span>' + fmtPeso(t.monto) + '</span></span>' +
      '</div>';
  });
  h += '</div>';
  if (r.fuera) {
    h += '<div class="cos-ojo" style="font-size:11px;padding:4px 2px">⚠ ' + r.fuera +
      ' categoría(s) ya no están en la lista: se cuentan en "' + COSTOS_SIN_CLASIFICAR +
      '" en vez de meterlas a la fuerza en un tipo. Hay que reclasificarlas.</div>';
  }
  h += '</div>';

  // ── Ranking por categoría, con la variación contra el mes anterior. El
  //    total sube pero no dice DÓNDE subió, y esa es la pregunta real.
  const prev = costosVariacion(mes);
  h += '<div class="card" style="margin-bottom:14px"><div class="card-header">' +
    '<span class="card-title">En qué se va la plata</span>' +
    '<span class="muted" style="font-size:11px">' +
    (mes ? 'contra ' + _cosMesTexto(_cosMesVecino(mes, -1)) : 'sin comparación: estás viendo todos los meses') +
    '</span></div>' +
    '<div style="overflow-x:auto"><table class="table"><thead><tr>' +
    '<th>Categoría</th><th>Tipo</th><th style="text-align:right">Monto</th>' +
    '<th style="text-align:right">% del total</th><th style="text-align:right">vs mes anterior</th>' +
    '</tr></thead><tbody>';
  r.categorias.forEach(c => {
    const antes = prev.has(c.categoria) ? prev.get(c.categoria) : null;
    let varTxt = '<span style="color:var(--text-secondary)">—</span>';
    if (mes && antes !== null) {
      const d = c.monto - antes;
      const pct = antes ? (d / antes * 100) : 0;
      // Gris neutro, no rojo: que un costo suba puede ser lo esperable (más
      // volumen, una paritaria), y pintarlo de rojo lo haría pasar por
      // problema. Mismo criterio que las variaciones del historial de RRHH.
      varTxt = '<span style="font-family:monospace;font-size:11px;color:var(--text-secondary)">' +
        (d >= 0 ? '+' : '') + fmtPeso(d) + (antes ? ' · ' + (d >= 0 ? '+' : '') + pct.toFixed(0) + '%' : '') + '</span>';
    } else if (mes && antes === null) {
      varTxt = '<span style="font-size:11px;color:var(--text-secondary)">nuevo este mes</span>';
    }
    // El subtítulo de la fila son SUS detalles, que es el segundo nivel del
    // catálogo: sin eso "Conductor $126 M" no dice de qué está hecho.
    const dets = c.detalles.slice(0, 4).map(d => _cosEsc(d.detalle) + ' ' + _cosMiles(d.monto)).join(' · ') +
      (c.detalles.length > 4 ? ' · +' + (c.detalles.length - 4) + ' más' : '');
    h += '<tr><td>' + _cosEsc(c.categoria) +
      (c.fuera ? ' <span class="cos-ojo" style="font-size:10px">— fuera del catálogo</span>' : '') +
      '<div style="font-size:10px;color:var(--text-secondary)">' + dets + '</div></td>' +
      // Una categoría puede tener MÁS DE UN tipo: mostrar uno solo sería
      // inventar un dato. Se muestran los que tiene, por peso.
      '<td>' + c.mezcla.map(t => '<span class="cos-t ' + _cosClaseTipo(t) + '">' + _cosEsc(t) + '</span>').join(' ') + '</td>' +
      '<td style="text-align:right;font-family:monospace">' + fmtPeso(c.monto) + '</td>' +
      '<td style="text-align:right;font-size:12px">' + c.pct.toFixed(1) + '%</td>' +
      '<td style="text-align:right">' + varTxt + '</td></tr>';
  });
  h += '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--border)">' +
    '<td>TOTAL</td><td></td><td style="text-align:right;font-family:monospace">' + fmtPeso(r.total) + '</td>' +
    '<td style="text-align:right">100%</td><td></td></tr></tfoot></table></div></div>';

  // ── Evolución. Un mes solo no dice nada: la lectura es la tendencia.
  if (mes) h += _cosEvolucionHTML(mes);

  h += '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn btn-sm" onclick="exportCostosExcel()"><i class="ic ic-download"></i> Excel</button>' +
    '<button class="btn btn-sm" onclick="exportCostosPDF()"><i class="ic ic-file"></i> PDF</button></div>';

  cont.innerHTML = h;
}

// La misma tarjeta que usa Compras: las clases son las del proyecto, no unas
// propias — inventadas, salen sin estilo y el panel aparece en blanco.
function _cosCard(cls, icono, etq, valor, sub) {
  return '<div class="metric-card' + (cls ? ' ' + cls : '') + '">' +
    '<div class="metric-ic"><i class="ic ' + icono + '"></i></div>' +
    '<div class="metric-label">' + _cosEsc(etq) + '</div>' +
    '<div class="metric-value">' + _cosEsc(valor) + '</div>' +
    '<div class="metric-sub">' + _cosEsc(sub) + '</div></div>';
}

// Barras apiladas por mes, SVG a mano como el resto del proyecto: un gráfico
// de seis barras no justifica sumar una dependencia.
function _cosEvolucionHTML(mes) {
  const serie = costosEvolucion(mes, 6);
  const max = serie.reduce((m, s) => Math.max(m, s.total), 0);
  if (!max) return '';
  const W = 640, H = 170, pad = 26;
  const bw = (W - pad * 2) / serie.length;
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="Evolución del costo por mes">';
  serie.forEach((s, i) => {
    const x = pad + i * bw + bw * 0.18;
    const w = bw * 0.64;
    let acum = 0;
    COSTOS_TIPOS.concat([COSTOS_SIN_CLASIFICAR]).forEach(t => {
      const v = s.porTipo[t] || 0;
      if (!v) return;
      const alto = (v / max) * (H - pad * 2);
      acum += alto;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + (H - pad - acum).toFixed(1) + '" width="' + w.toFixed(1) +
        '" height="' + alto.toFixed(1) + '" fill="' + (COSTOS_TIPO_COLOR[t] || '#9ca3af') + '">' +
        '<title>' + _cosEsc(_cosMesTexto(s.mes) + ' · ' + t + ': ' + fmtPeso(v)) + '</title></rect>';
    });
    // El total va arriba de la barra: el apilado dice de qué está hecho, pero
    // la pregunta es cuánto, y leerlo contra el eje es aproximar. Se ubica
    // restando la ALTURA dibujada, no los pesos — restando el monto los
    // <text> salen con y negativo: están en el DOM y no se ven en pantalla.
    if (s.total) {
      svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - pad - acum - 4).toFixed(1) +
        '" text-anchor="middle" font-size="9" fill="currentColor">' + _cosEsc(_cosMiles(s.total)) + '</text>';
    }
    svg += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) +
      '" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">' +
      _cosEsc((_COS_MESES[+s.mes.slice(5, 7) - 1] || '').slice(0, 3)) + '</text>';
  });
  svg += '</svg>';
  const leyenda = COSTOS_TIPOS.concat([COSTOS_SIN_CLASIFICAR])
    .filter(t => serie.some(s => s.porTipo[t]))
    .map(t => '<span style="font-size:11px;margin-right:12px"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' +
      COSTOS_TIPO_COLOR[t] + ';margin-right:4px"></span>' + _cosEsc(t) + '</span>').join('');
  return '<div class="card" style="margin-bottom:14px"><div class="card-header">' +
    '<span class="card-title">Cómo viene</span>' +
    '<span class="muted" style="font-size:11px">últimos 6 meses</span></div>' +
    '<div style="padding:4px 2px">' + svg + '<div style="margin-top:6px">' + leyenda + '</div></div></div>';
}

function _cosMiles(n) {
  const v = _num(n);
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
  return fmtPeso(v);
}

// ── Registro: la tabla y la aprobación ───────────────────────────────────
function _renderCostosRegistro() {
  const cont = _cosEl('cos-registro');
  if (!cont) return;
  const filas = costosFiltrados();
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('costos') : '';
  const totalMes = costosDelMes(mes).length;
  const puede = (typeof puedeAutorizar === 'function') && puedeAutorizar();

  // Los botones se marcan contra el ESTADO y no contra el que se tocó:
  // marcando solo el clickeado, un grupo queda diciendo una cosa mientras el
  // panel filtra otra (ya pasó con el filtro por condición del Dashboard).
  let h = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
    '<input type="text" id="cos-busca" class="input" placeholder="Buscar por categoría, detalle o descripción…" ' +
      'style="max-width:340px" value="' + _cosEsc(cosBusca) + '" oninput="cosBuscar(this.value)">' +
    '<span style="font-size:12px;color:var(--text-secondary)">' +
      (filas.length === totalMes ? filas.length + ' registro(s)'
                                 : 'Mostrando ' + filas.length + ' de ' + totalMes) + '</span>' +
    '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
    _cosBtnFiltro('tipo', '', 'Todos los tipos') +
    COSTOS_TIPOS.map(t => _cosBtnFiltro('tipo', t, t)).join('') +
    '<span style="width:12px"></span>' +
    _cosBtnFiltro('estado', '', 'Todos los estados') +
    Object.keys(COSTOS_ESTADOS).map(e => _cosBtnFiltro('estado', e, COSTOS_ESTADOS[e].corto)).join('') +
    '</div>' +
    '<div style="margin-bottom:12px"><select class="form-input" style="max-width:260px;font-size:12px" onchange="cosFiltrar(\'cat\',this.value)">' +
      '<option value="">Todas las categorías</option>' +
      costosCategorias().map(c => '<option value="' + _cosEsc(c.nombre) + '"' +
        (_cosNorm(c.nombre) === _cosNorm(cosFiltroCat) ? ' selected' : '') + '>' + _cosEsc(c.nombre) + '</option>').join('') +
      '</select></div>';

  if (!filas.length) {
    h += '<div class="alert alert-info"><div>' +
      (totalMes ? 'Ningún registro coincide con el filtro.'
                : 'Todavía no hay costos cargados en ' + _cosEsc(mes ? _cosMesTexto(mes) : 'ningún mes') + '.') +
      '</div></div>';
    cont.innerHTML = h;
    return;
  }

  h += '<div style="overflow-x:auto"><table class="table"><thead><tr>' +
    '<th>Fecha</th><th>Categoría › Detalle</th><th>Descripción</th>' +
    '<th style="text-align:right">Monto</th><th>Estado</th><th></th>' +
    '</tr></thead><tbody>';
  let sumaVista = 0, sumaAprob = 0;
  filas.forEach(c => {
    const est = COSTOS_ESTADOS[_cosTxt(c.estado)] || COSTOS_ESTADOS.pendiente;
    const tipo = costoTipoDe(c.categoria, c.detalle);
    const m = _num(c.monto);
    sumaVista += m;
    if (_cosTxt(c.estado) === 'autorizado') sumaAprob += m;
    h += '<tr' + (_cosTxt(c.estado) === 'rechazado' ? ' style="opacity:.55"' : '') + '>' +
      '<td style="white-space:nowrap">' + _cosEsc(isoToDMY(c.fecha)) + '</td>' +
      '<td>' + _cosEsc(c.categoria) + '<span style="color:var(--text-secondary)"> › </span>' + _cosEsc(c.detalle || '—') +
        (costoFueraDeLista(c.categoria, c.detalle) ? ' <span class="cos-ojo" style="font-size:10px">— fuera del catálogo</span>' : '') +
        '<div class="' + _cosClaseTipo(tipo) + '" style="font-size:10px;background:none;padding:0">' + _cosEsc(tipo) + '</div></td>' +
      '<td style="font-size:12px">' + _cosEsc(c.descripcion || '—') + '</td>' +
      '<td style="text-align:right;font-family:monospace">' + fmtPeso(m) + '</td>' +
      '<td><span class="cos-t ' + _cosClaseEstado(_cosTxt(c.estado)) + '">' + _cosEsc(est.corto) + '</span>' +
        (c.decidido_por ? '<div style="font-size:10px;color:var(--text-secondary)">' + _cosEsc(c.decidido_por) + '</div>' : '') +
        (_cosTxt(c.estado) === 'rechazado' && c.motivo
          ? '<div class="cos-motivo" style="font-size:10px">' + _cosEsc(c.motivo) + '</div>' : '') + '</td>' +
      '<td style="white-space:nowrap;text-align:right">' + _cosAcciones(c, puede) + '</td></tr>';
  });
  // El pie mide LO QUE SE ESTÁ VIENDO y lo dice: un total que no coincide con
  // las filas de arriba es la peor forma de mostrar un número. Y separa lo
  // aprobado, que es lo único que entra en los análisis.
  h += '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--border)">' +
    '<td colspan="3">' + (filas.length === totalMes ? 'TOTAL' : 'TOTAL DE LO FILTRADO') + '</td>' +
    '<td style="text-align:right;font-family:monospace">' + fmtPeso(sumaVista) + '</td><td colspan="2"></td></tr>';
  if (sumaAprob !== sumaVista) {
    h += '<tr><td colspan="3" style="font-size:11px;color:var(--text-secondary)">Aprobado (lo que entra en los análisis)</td>' +
      '<td style="text-align:right;font-family:monospace;font-size:12px">' + fmtPeso(sumaAprob) + '</td><td colspan="2"></td></tr>';
  }
  h += '</tfoot></table></div>';
  cont.innerHTML = h;
}

function _cosBtnFiltro(cual, valor, label) {
  const activo = (cual === 'tipo' ? cosFiltroTipo : cosFiltroEstado) === valor;
  return '<button class="btn btn-sm' + (activo ? ' panel-mes-btn' : '') +
    '" onclick="cosFiltrar(\'' + jsAttr(cual) + '\',\'' + jsAttr(valor) + '\')">' + _cosEsc(label) + '</button>';
}

// Las acciones van por ID, nunca por posición: AppData.costos se reemplaza
// entera al re-hidratar, así que un índice guardado pasa a apuntar a OTRA
// fila — se aprobaría el costo equivocado.
function _cosAcciones(c, puede) {
  const est = _cosTxt(c.estado);
  let h = '';
  if (puede && est === 'pendiente') {
    h += '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="aprobarCosto(' + c.id + ')">Aprobar</button> ' +
      '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="rechazarCosto(' + c.id + ')">Rechazar</button> ';
  }
  h += '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="abrirCostoModal(' + c.id + ')" title="Editar">✎</button> ' +
    '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="borrarCosto(' + c.id + ')" title="Borrar">✕</button>';
  return h;
}

function cosBuscar(v) { cosBusca = v || ''; _renderCostosRegistro(); }
function cosFiltrar(cual, valor) {
  if (cual === 'tipo') cosFiltroTipo = valor || '';
  else if (cual === 'cat') cosFiltroCat = valor || '';
  else cosFiltroEstado = valor || '';
  _renderCostosRegistro();
}

// ════════════════════════════════════════════════════════════════════════
//  ALTA, EDICIÓN Y DECISIÓN
// ════════════════════════════════════════════════════════════════════════

// Resuelve la fila por ID y NUNCA por posición: AppData.costos se reemplaza
// entera al re-hidratar, así que un índice guardado al abrir el modal pasa a
// apuntar a otra fila — se editaría o se aprobaría el costo equivocado.
function _costoPorId(id) {
  const n = _num(id);
  return (AppData.costos || []).find(c => c.id === n) || null;
}

function abrirCostoModal(id) {
  const c = (id == null) ? null : _costoPorId(id);
  if (id != null && !c) { showToast('Ese costo ya no está'); renderCostos(); return; }
  cosEditId = c ? c.id : null;

  // Primero la CATEGORÍA; el detalle se repuebla con los suyos. Una vieja
  // que ya no está en el catálogo SE CONSERVA marcada: si se borrara, abrir
  // la ficha para corregir un importe le cambiaría la categoría al costo.
  // Mismo criterio que los puestos de RRHH.
  _cosPoblarCategorias(c ? _cosTxt(c.categoria) : '');
  _cosPoblarDetalles(c ? _cosTxt(c.detalle) : '');
  _cosMostrarNuevo(null);

  const v = (k, val) => { const e = _cosEl(k); if (e) e.value = val; };
  v('mcos-fecha', c ? String(c.fecha || '').slice(0, 10) : hoyISO());
  v('mcos-descripcion', c ? (c.descripcion || '') : '');
  v('mcos-monto', c ? _num(c.monto) : '');

  // UN SELECTOR VACÍO SIN EXPLICACIÓN SE LEE COMO QUE EL PANEL SE ROMPIÓ.
  // Pasa en dos situaciones distintas y desde acá NO se pueden distinguir
  // (las dos dejan el catálogo en []): la tabla todavía no existe, o es una
  // sucursal nueva que no cargó el suyo. Así que el aviso no afirma una
  // causa: dice qué hacer, que es lo mismo en los dos casos.
  const vac = _cosEl('mcos-vacio');
  if (vac) {
    vac.innerHTML = costosCategorias(true).length ? '' :
      '<div class="alert alert-alert"><div>Esta sucursal todavía no tiene catálogo de costos, ' +
      'así que no hay categorías para elegir. Creá la primera con <strong>➕ Crear una categoría nueva…</strong> ' +
      '(pide su primer detalle, porque una categoría sola no puede clasificar nada). ' +
      'La solapa <strong>Catálogo</strong> muestra lo que haya cargado.</div></div>';
  }

  const t = _cosEl('mcos-titulo');
  if (t) t.textContent = c ? 'Editar costo' : 'Nuevo costo';
  _cosPintarTipo();
  const bd = _cosEl('modal-costo-backdrop');
  if (bd) bd.style.display = 'flex';
}

// El segundo selector depende del primero: solo los detalles de ESA
// categoría. Ofrecer los 47 de todas es lo que deja que entre
// "Operaciones y oficina › Titular", que no existe.
function _cosPoblarDetalles(elegido) {
  const sel = _cosEl('mcos-detalle');
  if (!sel) return;
  const cat = _cosTxt((_cosEl('mcos-categoria') || {}).value);
  const dets = costoDetallesDe(cat).filter(d => d.activo !== false);
  let h = '<option value="">— Elegí el detalle —</option>' +
    dets.map(d => '<option value="' + _cosEsc(d.nombre) + '">' + _cosEsc(d.nombre) +
      ' · ' + _cosEsc(d.tipo) + '</option>').join('') +
    (cat ? '<option value="__nuevo__">➕ Crear un detalle nuevo en ' + _cosEsc(cat) + '…</option>' : '');
  // Un detalle viejo que ya no pertenece a esa categoría se conserva
  // marcado, por lo mismo que la categoría.
  if (elegido && cat && !costoDetalle(cat, elegido)) {
    h += '<option value="' + _cosEsc(elegido) + '">' + _cosEsc(elegido) +
      ' — ya no está en el catálogo</option>';
  }
  sel.innerHTML = h;
  sel.value = elegido || '';
  _cosPintarTipo();
}

// El selector de categorías. Una que ya no está en el catálogo SE CONSERVA
// marcada: si se borrara, abrir la ficha para corregir un importe le
// cambiaría la categoría al costo.
function _cosPoblarCategorias(elegida) {
  const sel = _cosEl('mcos-categoria');
  if (!sel) return;
  let h = '<option value="">— Elegí la categoría —</option>' +
    costosCategorias().map(x => '<option value="' + _cosEsc(x.nombre) + '">' + _cosEsc(x.nombre) +
      ' (' + x.detalles.filter(d => d.activo !== false).length + ')</option>').join('');
  if (elegida && !costoCategoria(elegida)) {
    h += '<option value="' + _cosEsc(elegida) + '">' + _cosEsc(elegida) + ' — ya no está en el catálogo</option>';
  }
  // La última opción: crear. Va acá porque es donde nace la necesidad —
  // mandar al operador a otra pantalla a mitad de una carga es donde se
  // abandona.
  h += '<option value="__nueva__">➕ Crear una categoría nueva…</option>';
  sel.innerHTML = h;
  sel.value = elegida || '';
}

// Cambiar de categoría repuebla los detalles y limpia el elegido: el que
// estaba casi nunca pertenece a la nueva, y dejarlo puesto haría que el par
// quede fuera del catálogo sin que nadie lo pida.
function cosCambioCategoria() {
  const v = _cosTxt((_cosEl('mcos-categoria') || {}).value);
  if (v === '__nueva__') { _cosPoblarDetalles(''); _cosMostrarNuevo('cat'); return; }
  _cosMostrarNuevo(null);
  _cosPoblarDetalles('');
}

// Elegir "➕ Crear un detalle nuevo" abre el bloque en vez de dejar el
// selector con un valor que no existe.
function cosCambioDetalle() {
  const v = _cosTxt((_cosEl('mcos-detalle') || {}).value);
  if (v === '__nuevo__') { _cosMostrarNuevo('det'); return; }
  _cosMostrarNuevo(null);
  _cosPintarTipo();
}

function closeCostoModal() {
  const bd = _cosEl('modal-costo-backdrop');
  if (bd) bd.style.display = 'none';
  cosEditId = null;
}

// Anticipa el efecto ANTES de guardar: a qué tipo va a quedar el costo y en
// qué mes va a pesar. Las dos cosas se derivan (de la categoría y de la
// fecha), así que sin esto el operador las descubre después, en el reporte.
function _cosPintarTipo() {
  const cont = _cosEl('mcos-efecto');
  if (!cont) return;
  const cat = _cosTxt((_cosEl('mcos-categoria') || {}).value);
  const det = _cosTxt((_cosEl('mcos-detalle') || {}).value);
  const fecha = _cosTxt((_cosEl('mcos-fecha') || {}).value);
  if (!cat || !det || cat === '__nueva__' || det === '__nuevo__') { cont.innerHTML = ''; return; }
  const tipo = costoTipoDe(cat, det);
  const mes = fecha.slice(0, 7);
  const puede = (typeof puedeAutorizar === 'function') && puedeAutorizar();
  cont.innerHTML = '<div style="font-size:12px;padding:8px 10px;border-radius:8px;background:var(--surface-0);border:1px solid var(--border)">' +
    'Queda como <strong class="' + _cosClaseTipo(tipo) + '" style="background:none;padding:0">' + _cosEsc(tipo) + '</strong>' +
    (mes ? ' y pesa en <strong>' + _cosEsc(_cosMesTexto(mes)) + '</strong>' : '') + '.' +
    (puede ? '' : '<br><span class="cos-ojo">Queda esperando que un supervisor lo apruebe: ' +
      'hasta entonces no suma en ningún total.</span>') +
    '</div>';
}

async function guardarCostoModal() {
  // Un guardado que tarda y no deshabilita su botón INVITA a la segunda
  // corrida que lo duplica: las vacaciones ya se grabaron dos veces con 22
  // microsegundos de diferencia por esto.
  if (_cosGuardando) return;
  const cat = _cosTxt((_cosEl('mcos-categoria') || {}).value);
  const fecha = _cosTxt((_cosEl('mcos-fecha') || {}).value);
  const monto = _num((_cosEl('mcos-monto') || {}).value);
  const det = _cosTxt((_cosEl('mcos-detalle') || {}).value);
  if (!cat || cat === '__nueva__') { alert('Elegí la categoría.'); return; }
  // Sin detalle no hay tipo: el par es lo que lo decide.
  if (!det || det === '__nuevo__') { alert('Elegí el detalle: de la categoría MÁS el detalle sale el tipo, y de ahí todos los reportes.'); return; }
  if (!fecha) { alert('Poné la fecha del costo: de ella sale el mes en el que pesa.'); return; }
  if (!(monto > 0)) { alert('El monto tiene que ser mayor que cero.'); return; }

  const fila = {
    fecha: fecha, categoria: cat,
    detalle: _cosTxt((_cosEl('mcos-detalle') || {}).value),
    descripcion: _cosTxt((_cosEl('mcos-descripcion') || {}).value),
    monto: monto
  };

  _cosGuardando = true;
  const btn = _cosEl('mcos-guardar');
  if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Guardando…'; }
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    if (cosEditId != null) {
      const c = _costoPorId(cosEditId);
      if (!c) { alert('Ese costo ya no está: alguien lo borró mientras lo editabas.'); return; }
      // EDITAR UN COSTO APROBADO LO DEVUELVE A PENDIENTE. Si se quedara
      // aprobado, el supervisor habría dado por bueno un número que ya no
      // es el que está: la aprobación tiene que valer sobre lo que se vio.
      const vuelve = _cosTxt(c.estado) === 'autorizado' && !(typeof puedeAutorizar === 'function' && puedeAutorizar());
      if (vuelve && !confirm('Este costo ya estaba aprobado.' + String.fromCharCode(10, 10) +
        'Al modificarlo vuelve a quedar pendiente y un supervisor lo tiene que aprobar de nuevo. ¿Seguís?')) return;
      const campos = Object.assign({}, fila);
      if (vuelve) { campos.estado = 'pendiente'; campos.decidido_por = ''; campos.decidido_en = null; }
      await DB.updateWhere('costos', 'id', c.id, campos);
      Object.assign(c, campos);
      showToast('✅ Costo actualizado' + (vuelve ? ' · vuelve a esperar aprobación' : ''));
    } else {
      fila.estado = (typeof estadoNuevaOperacion === 'function') ? estadoNuevaOperacion() : 'autorizado';
      fila.cargado_por = (typeof _operadorActual === 'function') ? _operadorActual()
        : ((currentUser && (currentUser.nombre || currentUser.usuario)) || '');
      if (fila.estado === 'autorizado') {
        fila.decidido_por = fila.cargado_por;
        fila.decidido_en = new Date().toISOString();
      }
      const row = await DB.insertRow('costos', fila);
      AppData.costos = AppData.costos || [];
      AppData.costos.push(Object.assign({ id: row && row.id }, fila));
      showToast((fila.estado === 'pendiente' ? '⏳ ' : '✅ ') + fmtPeso(monto) + ' registrado' +
        (fila.estado === 'pendiente' ? ' · falta que lo apruebe un supervisor' : ''));
    }
    closeCostoModal();
    renderCostos();
  } catch (e) {
    console.warn('guardarCostoModal', e);
    const m = String((e && e.message) || e);
    // Si la base todavía no tiene la tabla, el error de Postgres del otro
    // lado de la pantalla no se entiende.
    alert(/relation .*costos.* does not exist|schema cache/i.test(m)
      ? 'La base todavía no tiene la Tabla de Costos.' + String.fromCharCode(10, 10) +
        'Hay que correr una vez la migración supabase/migracion-2026-11-06-tabla-costos.sql.'
      : 'No se pudo guardar: ' + m);
  } finally {
    _cosGuardando = false;
    if (btn) { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; }
    if (typeof finEscrituraNube === 'function') finEscrituraNube();
  }
}

async function aprobarCosto(id) {
  const c = _costoPorId(id);
  if (!c) { showToast('Ese costo ya no está'); renderCostos(); return; }
  if (!(typeof puedeAutorizar === 'function' && puedeAutorizar())) {
    alert('Solo un supervisor o el analista pueden aprobar un costo.'); return;
  }
  if (!confirm('¿Aprobar ' + fmtPeso(_num(c.monto)) + ' de ' + c.categoria + '?' +
    String.fromCharCode(10, 10) + 'A partir de ahí suma en el total del mes y en todos los análisis.')) return;
  await _cosDecidir(c, 'autorizado', '');
}

async function rechazarCosto(id) {
  const c = _costoPorId(id);
  if (!c) { showToast('Ese costo ya no está'); renderCostos(); return; }
  if (!(typeof puedeAutorizar === 'function' && puedeAutorizar())) {
    alert('Solo un supervisor o el analista pueden rechazar un costo.'); return;
  }
  // El motivo es OBLIGATORIO: el que lo cargó va a preguntar, y en dos meses
  // nadie se acuerda. Mismo criterio que rechazar una compra.
  const motivo = prompt('¿Por qué se rechaza? (queda registrado y lo ve quien lo cargó)');
  if (motivo === null) return;
  if (!_cosTxt(motivo)) { alert('Hace falta el motivo: sin él, nadie puede saber por qué se rechazó.'); return; }
  await _cosDecidir(c, 'rechazado', _cosTxt(motivo));
}

async function _cosDecidir(c, estado, motivo) {
  const campos = {
    estado: estado, motivo: motivo || '',
    decidido_por: (typeof _operadorActual === 'function') ? _operadorActual()
      : ((currentUser && (currentUser.nombre || currentUser.usuario)) || ''),
    decidido_en: new Date().toISOString()
  };
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.updateWhere('costos', 'id', c.id, campos);
    Object.assign(c, campos);
    renderCostos();
    showToast(estado === 'autorizado' ? '✅ Aprobado · ya suma en el mes' : '✕ Rechazado · no suma');
  } catch (e) {
    console.warn('_cosDecidir', e);
    alert('No se pudo guardar la decisión: ' + ((e && e.message) || e));
  } finally {
    if (typeof finEscrituraNube === 'function') finEscrituraNube();
  }
}

async function borrarCosto(id) {
  const c = _costoPorId(id);
  if (!c) { showToast('Ese costo ya no está'); renderCostos(); return; }
  if (!confirm('¿Borrar este costo?' + String.fromCharCode(10, 10) +
    c.categoria + ' · ' + fmtPeso(_num(c.monto)) + ' · ' + isoToDMY(c.fecha) +
    String.fromCharCode(10, 10) + 'No se puede deshacer. Si lo que querés es dejar registrado que no ' +
    'corresponde, rechazalo en vez de borrarlo: así queda el motivo.')) return;
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.deleteWhere('costos', 'id', c.id);
    AppData.costos = (AppData.costos || []).filter(x => x.id !== c.id);
    renderCostos();
    showToast('Costo borrado');
  } catch (e) {
    console.warn('borrarCosto', e);
    alert('No se pudo borrar: ' + ((e && e.message) || e));
  } finally {
    if (typeof finEscrituraNube === 'function') finEscrituraNube();
  }
}

// ════════════════════════════════════════════════════════════════════════
//  DESCARGAS
//  Salen de costosFiltrados(), LA MISMA fuente que la tabla: si la descarga
//  filtrara distinto, el archivo diría otra cosa que lo que el operador está
//  mirando — el bug que ya tuvo Liquidación de conductores.
// ════════════════════════════════════════════════════════════════════════
// Prefijo propio: un `const total` en el tope es un binding GLOBAL, y dos
// archivos que declaren el mismo nombre dejan al segundo sin ejecutar ENTERO.
const _cosTotalDe = r => r.total || 0;

function exportCostosExcel() {
  const filas = costosFiltrados();
  if (!filas.length) { alert('No hay costos para exportar con los filtros puestos.'); return; }
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('costos') : '';
  const r = costosResumen(mes);

  // Los importes van como NÚMERO y no como texto con "$": este archivo se
  // baja justamente para sumarlo y cruzarlo contra otra planilla.
  const aoa = [
    ['Tabla de costos · ' + costosFiltrosTxt() + ' · Generado el ' + new Date().toLocaleString('es-AR')],
    ['FECHA', 'CATEGORÍA', 'DETALLE', 'TIPO', 'DESCRIPCIÓN', 'MONTO', 'ESTADO', 'DECIDIÓ']
  ];
  filas.forEach(c => aoa.push([
    isoToDMY(c.fecha), c.categoria || '', c.detalle || '', costoTipoDe(c.categoria, c.detalle),
    c.descripcion || '', _num(c.monto),
    (COSTOS_ESTADOS[_cosTxt(c.estado)] || {}).corto || c.estado || '',
    c.decidido_por || ''
  ]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 11 }, { wch: 22 }, { wch: 20 }, { wch: 11 }, { wch: 30 },
    { wch: 15 }, { wch: 13 }, { wch: 18 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

  // Hoja 2: el análisis. Es lo que se lleva a los reportes, y rehacerlo a
  // mano desde las filas es justo el trabajo que este panel viene a sacar.
  const aoa2 = [
    ['Análisis · ' + (mes ? _cosMesTexto(mes) : 'todos los meses') + ' · solo lo APROBADO'],
    ['CATEGORÍA', 'DETALLE', 'TIPO', 'REGISTROS', 'MONTO', '% DEL TOTAL']
  ];
  r.categorias.forEach(c => {
    aoa2.push([c.categoria, '', c.mezcla.join(' + '), c.n, c.monto, Math.round(c.pct * 10) / 10]);
    c.detalles.forEach(d => aoa2.push(['', d.detalle, d.tipo, d.n, d.monto,
      _cosTotalDe(r) ? Math.round(d.monto / _cosTotalDe(r) * 1000) / 10 : 0]));
  });
  aoa2.push([]);
  aoa2.push(['TOTAL', '', '', r.aprobados.length, r.total, 100]);
  aoa2.push([]);
  aoa2.push(['POR TIPO', '', '', '', '', '']);
  r.tipos.forEach(t => aoa2.push([t.tipo, '', '', '', t.monto, Math.round(t.pct * 10) / 10]));
  if (r.pendientes.n) {
    aoa2.push([]);
    aoa2.push(['Sin aprobar (NO entra en el total de arriba)', '', '', r.pendientes.n, r.pendientes.monto, '']);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  ws2['!cols'] = [{ wch: 24 }, { wch: 22 }, { wch: 12 }, { wch: 11 }, { wch: 16 }, { wch: 13 }];
  ws2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Costos');
  XLSX.utils.book_append_sheet(wb, ws2, 'Análisis');
  XLSX.writeFile(wb, 'Tabla_de_costos_' + (mes || hoyISO()) + '.xlsx');
  showToast('📥 Tabla de costos descargada');
}

function exportCostosPDF() {
  const filas = costosFiltrados();
  if (!filas.length) { alert('No hay costos para exportar con los filtros puestos.'); return; }
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('costos') : '';
  const r = costosResumen(mes);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });

  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Tabla de costos', 14, 17);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  // La primera línea dice qué abarca: un papel recortado que no lo dice miente.
  doc.text(costosFiltrosTxt() + ' · Generado: ' + new Date().toLocaleString('es-AR'), 14, 23);

  const resumen = r.tipos.map(t => t.tipo + ': ' + fmtPeso(t.monto) + ' (' + t.pct.toFixed(1) + '%)').join('   ');
  doc.setTextColor(40, 50, 70);
  doc.text('Total aprobado: ' + fmtPeso(r.total) + '   ' + resumen, 14, 28.5);
  if (r.pendientes.n) {
    doc.setTextColor(146, 64, 14);
    doc.text('Sin aprobar: ' + fmtPeso(r.pendientes.monto) + ' en ' + r.pendientes.n +
      ' registro(s) — no entran en el total.', 14, 33.5);
  }

  doc.autoTable({
    startY: r.pendientes.n ? 38 : 33,
    head: [['Fecha', 'Categoría', 'Detalle', 'Tipo', 'Descripción', 'Monto', 'Estado']],
    body: filas.map(c => [
      isoToDMY(c.fecha), c.categoria || '', c.detalle || '', costoTipoDe(c.categoria, c.detalle),
      c.descripcion || '', fmtPeso(_num(c.monto)),
      (COSTOS_ESTADOS[_cosTxt(c.estado)] || {}).corto || ''
    ]),
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 5: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });
  doc.save('Tabla_de_costos_' + (mes || hoyISO()) + '.pdf');
  showToast('📥 Tabla de costos descargada');
}


// ════════════════════════════════════════════════════════════════════════
//  EL CATÁLOGO SE EDITA DESDE EL PANEL
//  ------------------------------------------------------------------------
//  Lo pidió el negocio. Dos cuidados que lo hacen seguro:
//
//  1) CREAR UNA CATEGORÍA EXIGE SU PRIMER DETALLE. No hay fila propia de
//     categoría —una categoría existe mientras tenga detalles— y sobre todo:
//     una categoría sin detalles no puede clasificar nada, así que dejarla
//     crear sola sería ofrecerla en el selector para que el costo siguiente
//     quede sin tipo.
//
//  2) CAMBIAR EL TIPO DE UN PAR RECLASIFICA LO YA CARGADO, incluidos los
//     meses cerrados: el tipo no se guarda en el costo, se deriva. Eso es lo
//     correcto —corregir un error tiene que arreglar el pasado— pero mueve
//     plata entre Fijos y Variables, así que se dice cuántos costos y cuánta
//     plata antes de aplicar.
// ════════════════════════════════════════════════════════════════════════

// Cuántos costos usan un par. Es lo que decide si se puede borrar o si
// corresponde una baja lógica.
function costosQueUsan(categoria, detalle) {
  const c = _cosNorm(categoria), d = _cosNorm(detalle);
  const filas = (AppData.costos || []).filter(x =>
    _cosNorm(x.categoria) === c && _cosNorm(x.detalle) === d);
  return { n: filas.length, monto: filas.reduce((s, x) => s + _num(x.monto), 0) };
}

// El par ya existe (activo o de baja). Dos filas del mismo par romperían la
// regla de que el tipo lo decide el par: habría dos respuestas.
function _cosParExiste(categoria, detalle) {
  const c = _cosNorm(categoria), d = _cosNorm(detalle);
  return (AppData.costosCatalogo || []).find(f =>
    _cosNorm(f.categoria) === c && _cosNorm(f.detalle) === d) || null;
}

async function _cosGuardarPar(categoria, detalle, tipo) {
  const fila = {
    categoria: _cosTxt(categoria), detalle: _cosTxt(detalle), tipo: tipo,
    activo: true,
    creado_por: (typeof _operadorActual === 'function') ? _operadorActual()
      : ((currentUser && (currentUser.nombre || currentUser.usuario)) || '')
  };
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
  const row = await DB.insertRow('costos_catalogo', fila);
  AppData.costosCatalogo = AppData.costosCatalogo || [];
  AppData.costosCatalogo.push(Object.assign({ id: row && row.id }, fila));
  return fila;
}

// ── Crear desde el modal de carga ────────────────────────────────────────
// El selector ofrece "➕ Crear…" como última opción: es donde nace la
// necesidad, y mandar al operador a otra pantalla a mitad de una carga es
// donde se abandona.
function _cosMostrarNuevo(modo) {
  const cont = _cosEl('mcos-nuevo');
  if (!cont) return;
  if (!modo) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
  const cat = _cosTxt((_cosEl('mcos-categoria') || {}).value);
  const opts = COSTOS_TIPOS.map(t => '<option value="' + _cosEsc(t) + '">' + _cosEsc(t) + '</option>').join('');
  cont.style.display = '';
  cont.innerHTML =
    '<div style="padding:10px;border:1px dashed var(--border);border-radius:8px;background:var(--surface-0)">' +
    '<div style="font-size:12px;font-weight:600;margin-bottom:8px">' +
      (modo === 'cat' ? 'Nueva categoría' : 'Nuevo detalle en ' + _cosEsc(cat)) + '</div>' +
    (modo === 'cat'
      ? '<input type="text" id="mcos-nueva-cat" class="form-input" placeholder="Nombre de la categoría" style="width:100%;margin-bottom:8px">'
      : '') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
      '<div style="flex:2;min-width:160px">' +
        '<label class="form-label" style="font-size:11px">' +
          (modo === 'cat' ? 'Su primer detalle' : 'Detalle') + '</label>' +
        '<input type="text" id="mcos-nuevo-det" class="form-input" placeholder="Ej.: Telefono" style="width:100%">' +
      '</div>' +
      '<div style="flex:1;min-width:130px">' +
        '<label class="form-label" style="font-size:11px">Tipo</label>' +
        '<select id="mcos-nuevo-tipo" class="form-input" style="width:100%">' + opts + '</select>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="crearParCosto(\'' + jsAttr(modo) + '\')">Crear</button>' +
      '<button class="btn btn-sm" onclick="cosCancelarNuevo()">Cancelar</button>' +
    '</div>' +
    // Una categoría sin detalles no clasifica nada: por eso se piden juntos.
    (modo === 'cat'
      ? '<div class="muted" style="font-size:11px;margin-top:6px">Una categoría sin detalles no puede clasificar ningún costo, ' +
        'así que se crea con el primero. Después le agregás los que quieras.</div>'
      : '<div class="muted" style="font-size:11px;margin-top:6px">El <strong>tipo</strong> queda pegado a este par ' +
        'y es el que van a tener todos los costos que se carguen acá.</div>') +
    '</div>';
}
function cosCancelarNuevo() {
  _cosMostrarNuevo(null);
  const sc = _cosEl('mcos-categoria');
  if (sc && sc.value === '__nueva__') sc.value = '';
  _cosPoblarDetalles('');
}

async function crearParCosto(modo) {
  const cat = (modo === 'cat')
    ? _cosTxt((_cosEl('mcos-nueva-cat') || {}).value)
    : _cosTxt((_cosEl('mcos-categoria') || {}).value);
  const det = _cosTxt((_cosEl('mcos-nuevo-det') || {}).value);
  const tipo = _cosTxt((_cosEl('mcos-nuevo-tipo') || {}).value);
  if (!cat) { alert('Poné el nombre de la categoría.'); return; }
  if (!det) { alert('Poné el detalle: una categoría sin detalles no puede clasificar ningún costo.'); return; }
  if (COSTOS_TIPOS.indexOf(tipo) < 0) { alert('Elegí el tipo.'); return; }
  // Dos filas del mismo par darían DOS tipos para el mismo gasto, que es
  // justo lo que el catálogo viene a impedir.
  const ya = _cosParExiste(cat, det);
  if (ya) {
    alert('Ese par ya existe: ' + ya.categoria + ' › ' + ya.detalle + ' (' + ya.tipo + ')' +
      (ya.activo === false ? String.fromCharCode(10, 10) + 'Está dado de baja; se reactiva desde la solapa Catálogo.' : ''));
    return;
  }
  try {
    await _cosGuardarPar(cat, det, tipo);
    _cosMostrarNuevo(null);
    // Queda elegido lo que se acaba de crear: es a lo que el operador venía.
    const sc = _cosEl('mcos-categoria');
    if (sc) { _cosPoblarCategorias(cat); sc.value = cat; }
    _cosPoblarDetalles(det);
    showToast('✅ ' + cat + ' › ' + det + ' (' + tipo + ')');
  } catch (e) {
    console.warn('crearParCosto', e);
    const m = String((e && e.message) || e);
    alert(/relation .*costos_catalogo.* does not exist|schema cache/i.test(m)
      ? 'La base todavía no tiene el catálogo.' + String.fromCharCode(10, 10) +
        'Hay que correr una vez la migración supabase/migracion-2026-11-10-catalogo-costos.sql.'
      : 'No se pudo crear: ' + m);
  } finally {
    if (typeof finEscrituraNube === 'function') finEscrituraNube();
  }
}

// ── La solapa Catálogo ───────────────────────────────────────────────────
function _renderCostosCatalogo() {
  const cont = _cosEl('cos-catalogo');
  if (!cont) return;
  const cats = costosCategorias(true);
  if (!cats.length) {
    cont.innerHTML = '<div class="alert alert-alert"><div>El catálogo está vacío. ' +
      'Si acabás de crear la tabla, falta correr la semilla de ' +
      '<code>migracion-2026-11-10-catalogo-costos.sql</code>.</div></div>';
    return;
  }
  const pares = cats.reduce((s, c) => s + c.detalles.length, 0);
  let h = '<div class="muted" style="font-size:12px;margin-bottom:12px">' +
    cats.length + ' categoría(s) · ' + pares + ' par(es). ' +
    'El <strong>tipo</strong> es del par: cambiarlo <strong>reclasifica los costos ya cargados</strong>, ' +
    'también los de meses cerrados — el tipo no se guarda en el costo, se deriva.</div>';
  cats.forEach(c => {
    const vivos = c.detalles.filter(d => d.activo !== false).length;
    h += '<div class="card" style="margin-bottom:10px"><div class="card-header">' +
      '<span class="card-title">' + _cosEsc(c.nombre) + '</span>' +
      '<span class="muted" style="font-size:11px">' + vivos + ' de ' + c.detalles.length + ' en uso</span></div>' +
      '<div style="overflow-x:auto"><table class="table"><tbody>';
    c.detalles.forEach(d => {
      const uso = costosQueUsan(c.nombre, d.nombre);
      h += '<tr' + (d.activo === false ? ' style="opacity:.55"' : '') + '>' +
        '<td>' + _cosEsc(d.nombre) +
          (d.activo === false ? ' <span class="muted" style="font-size:10px">— de baja</span>' : '') + '</td>' +
        '<td style="width:150px"><select class="form-input" style="font-size:11px;padding:3px 6px" ' +
          'onchange="cosCatCambiarTipo(' + d.id + ', this.value)">' +
          COSTOS_TIPOS.map(t => '<option value="' + _cosEsc(t) + '"' +
            (t === d.tipo ? ' selected' : '') + '>' + _cosEsc(t) + '</option>').join('') +
          '</select></td>' +
        '<td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">' +
          (uso.n ? uso.n + ' costo(s) · ' + fmtPeso(uso.monto) : 'sin uso') + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' +
          (d.activo === false
            ? '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="cosCatReactivar(' + d.id + ')">Reactivar</button>'
            : '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="cosCatBaja(' + d.id + ')">Dar de baja</button>') +
        '</td></tr>';
    });
    h += '</tbody></table></div></div>';
  });
  cont.innerHTML = h;
}

function _cosParPorId(id) {
  const n = _num(id);
  return (AppData.costosCatalogo || []).find(f => f.id === n) || null;
}

// CAMBIAR EL TIPO RECLASIFICA LO YA CARGADO. Es lo correcto —el tipo se
// deriva, así que corregir un error arregla el pasado— pero mueve plata entre
// Fijos y Variables en meses que ya se reportaron, así que se dice cuánta.
async function cosCatCambiarTipo(id, tipo) {
  const f = _cosParPorId(id);
  if (!f) { showToast('Ese par ya no está'); renderCostos(); return; }
  if (COSTOS_TIPOS.indexOf(tipo) < 0 || tipo === f.tipo) return;
  const uso = costosQueUsan(f.categoria, f.detalle);
  const aviso = '¿Pasar ' + f.categoria + ' › ' + f.detalle + ' de ' + f.tipo + ' a ' + tipo + '?' +
    String.fromCharCode(10, 10) +
    (uso.n
      ? 'RECLASIFICA ' + uso.n + ' costo(s) ya cargado(s) por ' + fmtPeso(uso.monto) + ', también los de meses cerrados: ' +
        'esa plata se mueve de ' + f.tipo + ' a ' + tipo + ' en todos los reportes.'
      : 'Todavía no hay costos con este par, así que no se reclasifica nada.');
  if (!confirm(aviso)) { renderCostos(); return; }
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.updateWhere('costos_catalogo', 'id', f.id, { tipo: tipo });
    f.tipo = tipo;
    renderCostos();
    showToast('✅ ' + f.detalle + ' ahora es ' + tipo + (uso.n ? ' · ' + uso.n + ' costo(s) reclasificado(s)' : ''));
  } catch (e) {
    console.warn('cosCatCambiarTipo', e);
    alert('No se pudo cambiar: ' + ((e && e.message) || e));
    renderCostos();
  } finally {
    if (typeof finEscrituraNube === 'function') finEscrituraNube();
  }
}

// BAJA LÓGICA, como los proveedores: deja de ofrecerse para cargas nuevas
// pero los costos que ya lo usan se conservan y se siguen clasificando igual.
// Borrarlo los dejaría "fuera del catálogo" de golpe y sin tipo.
async function cosCatBaja(id) {
  const f = _cosParPorId(id);
  if (!f) { showToast('Ese par ya no está'); renderCostos(); return; }
  const uso = costosQueUsan(f.categoria, f.detalle);
  if (!confirm('¿Dar de baja ' + f.categoria + ' › ' + f.detalle + '?' +
    String.fromCharCode(10, 10) +
    'Deja de ofrecerse para cargas nuevas.' +
    (uso.n ? ' Los ' + uso.n + ' costo(s) que ya lo usan (' + fmtPeso(uso.monto) + ') se conservan y siguen contando como ' + f.tipo + '.'
           : ' Todavía no lo usa ningún costo.'))) return;
  await _cosCatActivo(f, false, 'dado de baja');
}
async function cosCatReactivar(id) {
  const f = _cosParPorId(id);
  if (!f) { showToast('Ese par ya no está'); renderCostos(); return; }
  await _cosCatActivo(f, true, 'reactivado');
}
async function _cosCatActivo(f, activo, txt) {
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.updateWhere('costos_catalogo', 'id', f.id, { activo: activo });
    f.activo = activo;
    renderCostos();
    showToast(f.detalle + ' ' + txt);
  } catch (e) {
    console.warn('_cosCatActivo', e);
    alert('No se pudo guardar: ' + ((e && e.message) || e));
  } finally {
    if (typeof finEscrituraNube === 'function') finEscrituraNube();
  }
}
