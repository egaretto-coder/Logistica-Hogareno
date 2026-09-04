// ════════════════════════════════════════════════════════════════════════
//  DIMENSIONES ESPECIALES — CATÁLOGO (base de datos por cliente)
//  El panel es SOLO un catálogo: cada dimensión de un cliente tiene un precio
//  por zona. La asignación a un envío se hace a mano desde el panel Conductores
//  (botón "Dimensión"), y el precio aplicado sale de la zona de entrega.
// ════════════════════════════════════════════════════════════════════════
// Mismo criterio que km de desvío: el modal guarda el ID, no la posición.
let dimEditId = null;
function _dimEditando() {
  if (dimEditId == null) return null;
  return (AppData.dimCatalogo || []).find(x => String(x.id) === String(dimEditId)) || null;
}

// DOS tarifarios para la misma dimensión: lo que se le PAGA al conductor por
// llevarla y lo que se le COBRA al cliente por ese envío. No tienen por qué
// coincidir, y con una sola lista o el conductor cobraba de más o al cliente se
// le facturaba de menos. La solapa activa decide sobre cuál se trabaja.
let dimTipo = 'conductor';
function dimEsTipo(d) { return ((d && d.tipo) || 'conductor') === dimTipo; }
function dimOtroTipo() { return dimTipo === 'cliente' ? 'conductor' : 'cliente'; }
function dimEtiquetaTipo(t) { return t === 'cliente' ? 'CLIENTES' : 'CONDUCTOR'; }
// Una fila con precio 0 no es un precio: es una condición registrada a la
// espera de que le pongan valor. Se puede filtrar para completarlas.
let dimFiltroSinPrecio = false;
function dimSinPrecio(d) { return !(_num(d && d.precio) > 0); }

function switchDimTab(tipo) {
  dimTipo = (tipo === 'cliente') ? 'cliente' : 'conductor';
  ['conductor', 'cliente'].forEach(t => {
    const b = document.getElementById('dim-btn-' + t);
    if (b) b.classList.toggle('active', t === dimTipo);
  });
  dimFiltroSinPrecio = false;
  const s = document.getElementById('dim-search'); if (s) s.value = '';
  renderDimensionesEspeciales();
}

function saveDimCatalogo() {
  try { localStorage.setItem('liq_dim_catalogo', JSON.stringify(AppData.dimCatalogo)); } catch (e) {}
  dbPush('dimensiones_catalogo');
}

function renderDimensionesEspeciales() {
  const search = (document.getElementById('dim-search')?.value || '').toLowerCase().trim();
  const cat = (AppData.dimCatalogo || []).filter(dimEsTipo);

  // Contador de cada solapa y ayuda según la que esté activa.
  ['conductor', 'cliente'].forEach(t => {
    const el = document.getElementById('dim-count-' + t);
    if (el) {
      const n = (AppData.dimCatalogo || []).filter(d => ((d.tipo || 'conductor') === t)).length;
      el.textContent = n ? '(' + n + ')' : '';
    }
  });
  const ayuda = document.getElementById('dim-ayuda');
  if (ayuda) ayuda.innerHTML = '<i class="ic ic-box"></i><div>' + (dimTipo === 'cliente'
    ? 'Lo que se le <strong>COBRA AL CLIENTE</strong> por un envío con esa condición especial. Reemplaza la tarifa de venta de su zona: ' +
      'cuando el administrativo asigna la dimensión a un envío desde <strong>Conductores</strong>, la liquidación de ese cliente pasa a facturar este precio, ' +
      'discriminado en su propia línea. Si una zona no tiene precio acá, ese envío se factura con la tarifa común de la zona.'
    : 'Lo que se le <strong>PAGA AL CONDUCTOR</strong> por llevar esa condición especial. Reemplaza la tarifa de su zona cuando se le asigna la dimensión al envío ' +
      'desde <strong>Conductores</strong> (botón <strong>Dimensión</strong>).<br>' +
      '<strong>Importar:</strong> subí directamente la <strong>planilla de la empresa</strong> ("PLANILLA DE CARGA PARA CONDUCTORES"). ' +
      'Se leen <em>Cliente · Zona · Condición especial · Precio</em>; la columna <em>Detalle</em> y los títulos se ignoran.') +
    '</div>';
  // Nos guardamos el índice real acá: buscarlo con indexOf() dentro del map era
  // O(n²) y con un catálogo completo (~2.700 precios) trababa el panel entero.
  // OJO: el índice tiene que ser el de AppData.dimCatalogo (editar/borrar
  // trabajan sobre él), no el de la lista filtrada por solapa.
  const list = [];
  (AppData.dimCatalogo || []).forEach((d, i) => {
    if (!dimEsTipo(d)) return;
    if (dimFiltroSinPrecio && !dimSinPrecio(d)) return;
    if (!search ||
      String(d.cliente || '').toLowerCase().includes(search) ||
      String(d.nombre || '').toLowerCase().includes(search) ||
      String(d.zona || '').toLowerCase().includes(search)) list.push({ d, i });
  });

  const avisosEl = document.getElementById('dim-avisos');
  if (avisosEl) avisosEl.innerHTML = _dimBloqueAvisos();

  const countEl = document.getElementById('dim-count');
  if (countEl) {
    const nClientes = new Set(cat.map(d => normNombre(d.cliente))).size;
    const nDims = new Set(cat.map(d => normNombre(d.cliente) + '|' + normNombre(d.nombre))).size;
    countEl.textContent = cat.length + ' precio(s) · ' + nDims + ' dimensión(es) · ' + nClientes + ' cliente(s)' +
      (dimFiltroSinPrecio ? ' · mostrando solo las que están sin precio' : '');
  }

  const body = document.getElementById('dim-table-body');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon"><i class="ic ic-box"></i></div><div class="empty-title">Sin dimensiones en el catálogo</div><div class="empty-sub">' +
      (dimFiltroSinPrecio ? 'Ninguna quedó sin precio en esta solapa'
        : cat.length ? 'Ajustá el buscador'
        : 'Agregá una con "+ Nueva dimensión" o importá el Excel (Cliente · Dimensión · Zona · Precio)') +
      '</div></div></td></tr>';
    return;
  }

  // Orden: cliente, dimensión, zona.
  const ordenada = list.slice().sort((x, y) =>
    String(x.d.cliente).localeCompare(String(y.d.cliente)) ||
    String(x.d.nombre).localeCompare(String(y.d.nombre)) ||
    String(x.d.zona).localeCompare(String(y.d.zona)));

  // El catálogo completo son miles de precios: pintarlos todos no sirve para
  // leerlos y hace lento cada render. Se muestran los primeros y el resto se
  // encuentra con el buscador.
  const TOPE = 500;
  const recortada = ordenada.slice(0, TOPE);
  const avisoEl = document.getElementById('dim-recorte');
  if (avisoEl) avisoEl.textContent = ordenada.length > TOPE
    ? 'Mostrando ' + TOPE + ' de ' + ordenada.length + ' — usá el buscador para encontrar una dimensión puntual'
    : '';

  body.innerHTML = recortada.map(({ d, i: realIdx }) => {
    return '<tr>' +
      '<td><strong>' + (d.cliente || '—') + '</strong></td>' +
      '<td><span class="tag" style="background:#fef3c7;color:#92400e"><i class="ic ic-box"></i> ' + (d.nombre || '—') + '</span></td>' +
      '<td>' + (d.zona || '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + (dimSinPrecio(d)
        ? '<span class="tag" style="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5">sin precio</span>'
        : '<strong>' + fmtPeso(_num(d.precio)) + '</strong>') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="editDimension(' + JSON.stringify(String(d.id != null ? d.id : '')) + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDimension(' + JSON.stringify(String(d.id != null ? d.id : realIdx)) + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Condiciones que están en un tarifario y NO en el otro ────────────────
// La misma condición especial tiene que existir de los dos lados: lo que se le
// paga al conductor por llevarla y lo que se le cobra al cliente por mandarla.
// Si se carga de un solo lado, ese envío se liquida con la tarifa común de la
// zona sin que nadie lo note. Devuelve las que faltan EN LA SOLAPA ACTIVA,
// agrupadas por cliente + condición (no una línea por zona: son ~47 cada una).
function dimFaltantesEnSolapa() {
  const cat = AppData.dimCatalogo || [];
  const clave = d => normNombre(d.cliente) + '|' + normNombre(d.nombre) + '|' + normNombre(d.zona);
  const acaSet = new Set();
  cat.forEach(d => { if (dimEsTipo(d)) acaSet.add(clave(d)); });
  // Las que están en el otro lado con OTRA REDACCIÓN no son faltantes: tienen
  // su propio aviso, con la opción de unificar el nombre. Contarlas acá era lo
  // que hacía que las mismas 11 aparecieran como ausentes en las dos solapas.
  const emparejadas = new Set();
  dimParesDesalineados().forEach(p => {
    emparejadas.add(normNombre(p.cond.cliente) + '|' + normNombre(p.cond.nombre));
    emparejadas.add(normNombre(p.cli.cliente) + '|' + normNombre(p.cli.nombre));
  });
  const grupos = new Map();
  cat.forEach(d => {
    if (dimEsTipo(d) || acaSet.has(clave(d))) return;
    const k = normNombre(d.cliente) + '|' + normNombre(d.nombre);
    if (emparejadas.has(k)) return;
    if (!grupos.has(k)) grupos.set(k, { cliente: d.cliente, nombre: d.nombre, zonas: [] });
    grupos.get(k).zonas.push(d.zona);
  });
  return Array.from(grupos.values()).sort((a, b) =>
    String(a.cliente).localeCompare(String(b.cliente)) || String(a.nombre).localeCompare(String(b.nombre)));
}

// Lo que el hueco está costando AHORA, contado sobre los envíos cargados.
// "14 condiciones · 499 precios" es abstracto y no mueve a nadie; "3 envíos se
// están facturando con la tarifa de la zona" es lo que hace que alguien cargue
// el precio. Un envío con condición asignada y sin precio en ESTE tarifario se
// liquida con la tarifa común de la zona: cobra (o paga) MÁS de $0, así que no
// cae en ningún control de "sin tarifa" y hasta ahora no lo contaba nadie.
function dimImpactoEnEnvios(tipo) {
  const t = tipo === 'cliente' ? 'cliente' : 'conductor';
  const res = { envios: 0, facturado: 0, pagado: 0, condiciones: new Map() };
  // Índice de lo que SÍ tiene precio en este tarifario: sin él serían 22.000
  // envíos por 6.800 filas de catálogo en cada render.
  const conPrecio = new Set();
  (AppData.dimCatalogo || []).forEach(d => {
    if ((d.tipo || 'conductor') !== t || !(_num(d.precio) > 0)) return;
    conPrecio.add(normNombre(d.cliente) + '|' + normNombre(d.nombre) + '|' +
      normNombre(typeof zonaCanonica === 'function' ? zonaCanonica(d.zona) : d.zona));
  });
  (AppData.records || []).forEach(r => {
    const nom = String(r.dim_especial || '').trim();
    if (!nom) return;
    if (typeof contabilizaRegistro === 'function' && !contabilizaRegistro(r)) return;
    if (typeof envioAnuladoCliente === 'function' && envioAnuladoCliente(r)) return;
    const zonaRaw = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const zk = normNombre(typeof zonaCanonica === 'function' ? zonaCanonica(zonaRaw) : zonaRaw);
    const nk = normNombre(nom);
    // Mismos candidatos de cliente que usa el cálculo real.
    const cands = [r.dim_cliente, r.cliente];
    if (cands.some(c => c && conPrecio.has(normNombre(c) + '|' + nk + '|' + zk))) return;
    res.envios++;
    const cod = (typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '';
    if (typeof precioVentaEnvio === 'function' && cod) res.facturado += _num(precioVentaEnvio(cod, r));
    if (typeof precioPagadoConductor === 'function') res.pagado += _num(precioPagadoConductor(r));
    const k = (r.dim_cliente || r.cliente || '(sin cliente)') + ' · ' + nom;
    res.condiciones.set(k, (res.condiciones.get(k) || 0) + 1);
  });
  return res;
}

// El cartel. Va SUELTO y no dentro del aviso de faltantes: el hueco también
// existe cuando la condición SÍ está registrada acá pero en $0 —la fila que
// crea "Registrarlas acá sin precio"— y ese caso no lo cubre ningún otro.
function _dimImpactoTxt() {
  const imp = dimImpactoEnEnvios(dimTipo);
  if (!imp.envios) return '';
  const top = Array.from(imp.condiciones.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const esCliente = dimTipo === 'cliente';
  return '<div class="alert" style="margin:0 0 12px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5">' +
    '<i class="ic ic-alert"></i><div><strong>' + imp.envios.toLocaleString('es-AR') + ' envío(s) ya cargados no están ' +
    (esCliente ? 'facturando' : 'pagando') + ' la condición pactada.</strong> ' +
    'Tienen una condición especial asignada que en este tarifario no tiene precio para su zona, así que se liquidan con la ' +
    '<strong>tarifa común de la zona</strong>. Hoy se facturan ' + fmtPeso(imp.facturado) +
    ' y se le pagan ' + fmtPeso(imp.pagado) + ' al conductor.' +
    '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' +
    top.map(function (e) {
      return '<span class="tag" style="background:#fff;border:1px solid #fca5a5;color:#991b1b;font-size:11px">' +
        e[0] + ' <span style="opacity:.7">(' + e[1] + ' envío' + (e[1] === 1 ? '' : 's') + ')</span></span>';
    }).join('') +
    (imp.condiciones.size > 5 ? '<span style="font-size:11px;align-self:center;opacity:.8">…y ' + (imp.condiciones.size - 5) + ' más</span>' : '') +
    '</div></div></div>';
}

// ── Condiciones escritas DISTINTO en cada tarifario ─────────────────────────
// Las dos planillas las carga gente distinta y la misma condición termina con
// otra redacción de cada lado: "COMPRESORES" / "COMPRESORES 25000",
// "PINTURERIA SENTIDOS" / "SENTIDOS PINTURERIAS", "RR MOTOSPORT" / "RR
// MOTORSPORT". El aviso de faltantes las contaba como ausentes en LOS DOS
// lados —11 acá y las mismas 11 allá— y no había forma de que apareciera en
// ninguno. Peor: el envío guarda el nombre del lado CONDUCTOR, así que el
// cadete cobra la condición y al cliente se le factura la tarifa común de la
// zona, sin que nadie lo note.
function _dimTokens(s) {
  return String(s || '').toUpperCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
}
// "CALZADO" ≈ "CALZADOS" (plural/sufijo), pero no cualquier prefijo corto.
function _dimTokenParecido(a, b) {
  if (a === b) return true;
  const [c, l] = a.length <= b.length ? [a, b] : [b, a];
  return c.length >= 4 && l.startsWith(c);
}
function _dimSim(a, b) {
  const A = _dimTokens(a), B = _dimTokens(b);
  if (!A.length || !B.length) return 0;
  const usados = new Set();
  let comunes = 0;
  A.forEach(x => {
    const j = B.findIndex((y, k) => !usados.has(k) && _dimTokenParecido(x, y));
    if (j >= 0) { usados.add(j); comunes++; }
  });
  return comunes / (A.length + B.length - comunes);
}

// Devuelve [{ cond, cli, motivo, score }] — cond/cli = { cliente, nombre }.
// Es candidato si coincide EXACTO el cliente o la condición (el caso real: una
// de las dos cosas la escribieron igual), o si las dos se parecen bastante.
// El emparejado es 1 a 1 por mejor puntaje, así dos condiciones parecidas del
// mismo cliente no se cruzan entre sí.
function dimParesDesalineados() {
  const cat = AppData.dimCatalogo || [];
  const par = (d) => normNombre(d.cliente) + '|' + normNombre(d.nombre);
  const setDe = t => {
    const m = new Map();
    cat.forEach(d => { if (((d.tipo || 'conductor') === t)) m.set(par(d), { cliente: d.cliente, nombre: d.nombre }); });
    return m;
  };
  const mCond = setDe('conductor'), mCli = setDe('cliente');
  const soloCond = Array.from(mCond.entries()).filter(([k]) => !mCli.has(k)).map(([, v]) => v);
  const soloCli = Array.from(mCli.entries()).filter(([k]) => !mCond.has(k)).map(([, v]) => v);
  if (!soloCond.length || !soloCli.length) return [];

  const cand = [];
  soloCond.forEach((c, i) => soloCli.forEach((v, j) => {
    const mismoCli = normNombre(c.cliente) === normNombre(v.cliente);
    const mismoNom = normNombre(c.nombre) === normNombre(v.nombre);
    const sc = mismoCli ? 1 : _dimSim(c.cliente, v.cliente);
    const sn = mismoNom ? 1 : _dimSim(c.nombre, v.nombre);
    if (!(mismoCli || mismoNom || (sc >= 0.5 && sn >= 0.5))) return;
    cand.push({ i, j, score: sc + sn, motivo: mismoCli ? 'mismo cliente' : mismoNom ? 'misma condición' : 'ambos parecidos' });
  }));
  cand.sort((a, b) => b.score - a.score);
  const usC = new Set(), usV = new Set(), pares = [];
  cand.forEach(x => {
    if (usC.has(x.i) || usV.has(x.j)) return;
    usC.add(x.i); usV.add(x.j);
    pares.push({ cond: soloCond[x.i], cli: soloCli[x.j], motivo: x.motivo, score: x.score });
  });
  return pares.sort((a, b) => String(a.cond.cliente).localeCompare(String(b.cond.cliente)) ||
                              String(a.cond.nombre).localeCompare(String(b.cond.nombre)));
}

// Renombra las filas del tarifario de CLIENTES para que coincidan con las de
// CONDUCTOR. La dirección NO es arbitraria: el envío guarda el nombre del lado
// conductor (`registros.dim_especial` / `dim_cliente`, que es lo que ofrece el
// panel Conductores al asignar), así que ese es el que tiene que mandar.
// Renombrar el otro lado dejaría huérfanos los envíos ya asignados.
async function unificarNombresDimension(soloIdx) {
  const pares = dimParesDesalineados();
  if (!pares.length) return;
  const lista = (soloIdx === undefined || soloIdx === null) ? pares : [pares[soloIdx]].filter(Boolean);
  if (!lista.length) return;

  const detalle = lista.slice(0, 8).map(p =>
    '· ' + p.cli.cliente + ' · ' + p.cli.nombre + String.fromCharCode(10) +
    '     → ' + p.cond.cliente + ' · ' + p.cond.nombre).join(String.fromCharCode(10));
  if (!confirm('Se van a renombrar ' + lista.length + ' condición(es) del tarifario de CLIENTES ' +
    'para que coincidan con las de CONDUCTOR:' + String.fromCharCode(10) + String.fromCharCode(10) + detalle +
    (lista.length > 8 ? String.fromCharCode(10) + '…y ' + (lista.length - 8) + ' más' : '') +
    String.fromCharCode(10) + String.fromCharCode(10) +
    'Manda el nombre de CONDUCTOR porque es el que queda grabado en el envío.' + String.fromCharCode(10) +
    'Los precios no se tocan: solo cambia el nombre.')) return;

  const clave = d => normNombre(d.cliente) + '|' + normNombre(d.nombre) + '|' + normNombre(d.zona);
  const yaExiste = new Set();
  (AppData.dimCatalogo || []).forEach(d => { if (d.tipo === 'cliente') yaExiste.add(clave(d)); });

  let renombradas = 0, chocaron = 0;
  lista.forEach(p => {
    const kOrigen = normNombre(p.cli.cliente) + '|' + normNombre(p.cli.nombre);
    (AppData.dimCatalogo || []).forEach(d => {
      if (d.tipo !== 'cliente') return;
      if (normNombre(d.cliente) + '|' + normNombre(d.nombre) !== kOrigen) return;
      const destino = normNombre(p.cond.cliente) + '|' + normNombre(p.cond.nombre) + '|' + normNombre(d.zona);
      // Si ya hay una fila de cliente con el nombre destino en esa zona, no se
      // pisa su precio: se avisa y se deja como está.
      if (yaExiste.has(destino)) { chocaron++; return; }
      yaExiste.delete(clave(d));
      // El destino pasa a estar ocupado: sin esto, dos condiciones distintas que
      // se unifican al MISMO nombre quedaban como dos filas idénticas y el
      // guardado se caía por clave repetida.
      yaExiste.add(destino);
      d.cliente = p.cond.cliente;
      d.nombre = p.cond.nombre;
      yaExiste.add(destino);
      renombradas++;
    });
  });

  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('✅ ' + renombradas + ' fila(s) renombradas' + (chocaron ? ' · ' + chocaron + ' se dejaron sin tocar (ya existía ese nombre)' : ''));
}

// Aviso arriba de la tabla: qué falta registrar acá y qué está sin precio.
function _dimBloqueAvisos() {
  let html = '';

  // Primero lo que NO es un faltante sino una diferencia de redacción: si no se
  // resuelve esto, el aviso de abajo cuenta las mismas condiciones en los dos
  // lados y no se puede completar en ninguno.
  const pares = dimParesDesalineados();
  if (pares.length) {
    const filas = pares.slice(0, 8).map((p, i) =>
      '<tr>' +
      '<td style="padding:3px 8px 3px 0;font-size:11px"><span style="opacity:.65">CONDUCTOR</span><br><strong>' + p.cond.cliente + '</strong> · ' + p.cond.nombre + '</td>' +
      '<td style="padding:3px 8px;font-size:11px"><span style="opacity:.65">CLIENTES</span><br><strong>' + p.cli.cliente + '</strong> · ' + p.cli.nombre + '</td>' +
      '<td style="padding:3px 0;text-align:right"><button class="btn btn-sm" onclick="unificarNombresDimension(' + i + ')">Unificar</button></td>' +
      '</tr>').join('');
    html += '<div class="alert" style="margin:0 0 12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
      '<i class="ic ic-alert"></i><div><strong>' + pares.length + ' condición(es) están cargadas con NOMBRES DISTINTOS en cada tarifario</strong> — ' +
      'son la misma condición escrita de otra manera, por eso figuran como faltantes en los dos lados y no se pueden completar en ninguno. ' +
      'Mientras no coincidan, al conductor se le paga la condición y <strong>al cliente se le factura la tarifa común de la zona</strong>.' +
      '<div style="overflow-x:auto;margin:8px 0"><table style="border-collapse:collapse">' + filas + '</table></div>' +
      (pares.length > 8 ? '<div style="font-size:11px;opacity:.85;margin-bottom:6px">…y ' + (pares.length - 8) + ' más</div>' : '') +
      '<button class="btn btn-sm" onclick="unificarNombresDimension()">Unificar las ' + pares.length + '</button>' +
      '<span style="font-size:11px;margin-left:8px;opacity:.85">Se renombran las de <strong>CLIENTES</strong> para que coincidan con las de <strong>CONDUCTOR</strong>, ' +
      'que es el nombre que queda grabado en el envío. Los precios no se tocan.</span>' +
      '</div></div>';
  }

  html += _dimImpactoTxt();
  const faltan = dimFaltantesEnSolapa();
  if (faltan.length) {
    const nZonas = faltan.reduce((s, g) => s + g.zonas.length, 0);
    const muestra = faltan.slice(0, 6).map(g =>
      '<span class="tag" style="background:#fff;border:1px solid #fdba74;color:#9a3412;font-size:11px">' +
      g.cliente + ' · ' + g.nombre + ' <span style="opacity:.7">(' + g.zonas.length + ' zona' + (g.zonas.length === 1 ? '' : 's') + ')</span></span>').join(' ');
    html += '<div class="alert" style="margin:0 0 12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
      '<i class="ic ic-alert"></i><div><strong>' + faltan.length + ' condición(es) están en el tarifario de ' + dimEtiquetaTipo(dimOtroTipo()) +
      ' y no acá</strong> (' + nZonas.toLocaleString('es-AR') + ' precios). Mientras falten, esos envíos se liquidan con la tarifa común de la zona.' +
      '<div style="margin:8px 0;display:flex;gap:6px;flex-wrap:wrap">' + muestra +
      (faltan.length > 6 ? '<span style="font-size:11px;align-self:center;opacity:.8">…y ' + (faltan.length - 6) + ' más</span>' : '') + '</div>' +
      '<button class="btn btn-sm" onclick="crearDimensionesFaltantes()">Registrarlas acá sin precio</button>' +
      '<span style="font-size:11px;margin-left:8px;opacity:.85">Se crean las ' + nZonas.toLocaleString('es-AR') + ' filas en $0 para completarles el valor.</span>' +
      '</div></div>';
  }
  const sinPrecio = (AppData.dimCatalogo || []).filter(d => dimEsTipo(d) && dimSinPrecio(d)).length;
  if (sinPrecio) {
    html += '<div class="alert" style="margin:0 0 12px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5">' +
      '<i class="ic ic-alert"></i><div><strong>' + sinPrecio.toLocaleString('es-AR') + ' fila(s) sin precio</strong> en el tarifario de ' + dimEtiquetaTipo(dimTipo) + '. ' +
      'Hay que asignarles el valor: en $0 la condición no se aplica. ' +
      '<button class="btn btn-sm" style="margin-left:6px" onclick="toggleDimSinPrecio()">' +
      (dimFiltroSinPrecio ? 'Ver todas' : 'Ver las sin precio') + '</button></div></div>';
  }
  return html;
}

// Crea acá las condiciones que solo existen en el otro tarifario, en $0, para
// que aparezcan en la tabla y se les cargue el valor. No se inventa un precio:
// copiar el del otro lado sería pagarle al conductor lo que se le cobra al
// cliente, que es exactamente el error que dejó el catálogo mal.
function crearDimensionesFaltantes() {
  const faltan = dimFaltantesEnSolapa();
  if (!faltan.length) return;
  const nZonas = faltan.reduce((s, g) => s + g.zonas.length, 0);
  if (!confirm('Se van a registrar ' + faltan.length + ' condición(es) en el tarifario de ' + dimEtiquetaTipo(dimTipo) + ',' + String.fromCharCode(10) +
    'con ' + nZonas + ' filas en $0 para que les cargues el precio.' + String.fromCharCode(10) + String.fromCharCode(10) +
    'El tarifario de ' + dimEtiquetaTipo(dimOtroTipo()) + ' no se toca.')) return;
  const tipo = dimTipo;
  // Se saltea lo que ya exista en esta solapa: volver a crearlo dejaría dos
  // filas con la misma clave y el guardado fallaría entero.
  const yaEstan = new Set();
  (AppData.dimCatalogo || []).forEach(d => {
    if ((d.tipo || 'conductor') === tipo) yaEstan.add(normNombre(d.cliente) + '|' + normNombre(d.nombre) + '|' + normNombre(d.zona));
  });
  faltan.forEach(g => g.zonas.forEach(z => {
    const k = normNombre(g.cliente) + '|' + normNombre(g.nombre) + '|' + normNombre(z);
    if (yaEstan.has(k)) return;
    yaEstan.add(k);
    AppData.dimCatalogo.push({ cliente: g.cliente, nombre: g.nombre, zona: z, precio: 0, detalle: '', tipo: tipo });
  }));
  dimFiltroSinPrecio = true;
  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('✅ ' + nZonas + ' fila(s) registradas en $0 — cargales el precio');
}

function toggleDimSinPrecio() {
  dimFiltroSinPrecio = !dimFiltroSinPrecio;
  renderDimensionesEspeciales();
}

// Datalists del modal: clientes (catálogo + recorridos), dimensiones y zonas (tarifario).
function _dimDatalists() {
  const cli = document.getElementById('md-clientes-list');
  if (cli) {
    const set = new Map();
    AppData.dimCatalogo.forEach(d => { const k = normNombre(d.cliente); if (k && !set.has(k)) set.set(k, d.cliente); });
    AppData.records.forEach(r => { const k = normNombre(r.cliente); if (k && !set.has(k)) set.set(k, r.cliente); });
    cli.innerHTML = Array.from(set.values()).sort().map(c => '<option value="' + String(c).replace(/"/g, '&quot;') + '">').join('');
  }
  const nom = document.getElementById('md-nombres-list');
  if (nom) {
    const set = new Set(AppData.dimCatalogo.map(d => d.nombre).filter(Boolean));
    nom.innerHTML = Array.from(set).sort().map(n => '<option value="' + String(n).replace(/"/g, '&quot;') + '">').join('');
  }
  const zon = document.getElementById('md-zonas-list');
  if (zon) {
    const set = new Set(AppData.tarifas.map(t => String(t.zona || '').toUpperCase().trim()).filter(Boolean));
    zon.innerHTML = Array.from(set).sort().map(z => '<option value="' + z.replace(/"/g, '&quot;') + '">').join('');
  }
}

// Zonas del tarifario (mismo criterio que Super SLA).
function _dimZonasTarifario() {
  if (typeof zonasDelTarifario === 'function') return zonasDelTarifario();
  return Array.from(new Set(
    (AppData.tarifas || []).map(t => String(t.zona || '').trim().toUpperCase()).filter(Boolean)
  )).sort();
}

// "Mismo precio en todas las zonas": el campo Zona deja de aplicar.
function toggleDimTodasZonas() {
  const chk = document.getElementById('md-todas-zonas');
  const todas = !!(chk && chk.checked);
  const zonaWrap = document.getElementById('md-zona-wrap');
  const zonaInput = document.getElementById('md-zona');
  const label = document.getElementById('md-precio-label');
  if (zonaWrap) zonaWrap.style.display = todas ? 'none' : '';
  if (zonaInput) zonaInput.disabled = todas;
  if (label) label.innerHTML = todas
    ? '<i class="ic ic-dollar"></i> Precio para TODAS las zonas ($) *'
    : '<i class="ic ic-dollar"></i> Precio en esa zona ($) *';
  const hint = document.getElementById('md-todas-hint');
  if (hint) hint.textContent = todas
    ? '— se carga una fila por cada una de las ' + _dimZonasTarifario().length + ' zonas del tarifario'
    : '— si el cliente cerró un valor fijo (' + _dimZonasTarifario().length + ' zonas)';
}

function openAddDimensionModal() {
  dimEditId = null;
  document.getElementById('modal-dim-title').textContent = 'Nueva dimensión (catálogo)';
  document.getElementById('md-cliente').value = '';
  document.getElementById('md-nombre').value = '';
  document.getElementById('md-zona').value = '';
  document.getElementById('md-precio').value = '';
  const chk = document.getElementById('md-todas-zonas');
  if (chk) chk.checked = false;
  const wrap = document.getElementById('md-todas-wrap');
  if (wrap) wrap.style.display = '';      // solo tiene sentido al dar de alta
  toggleDimTodasZonas();
  _dimDatalists();
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function editDimension(id) {
  const d = (AppData.dimCatalogo || []).find(x => String(x.id) === String(id));
  if (!d) { showToast('⚠️ Esa condición ya no existe'); renderDimensionesEspeciales(); return; }
  dimEditId = String(id);
  document.getElementById('modal-dim-title').textContent = 'Editar dimensión (catálogo)';
  document.getElementById('md-cliente').value = d.cliente || '';
  document.getElementById('md-nombre').value = d.nombre || '';
  document.getElementById('md-zona').value = d.zona || '';
  document.getElementById('md-precio').value = _num(d.precio) || '';
  const chkE = document.getElementById('md-todas-zonas');
  if (chkE) chkE.checked = false;
  const wrapE = document.getElementById('md-todas-wrap');
  if (wrapE) wrapE.style.display = 'none';   // editar es de UNA zona
  toggleDimTodasZonas();
  _dimDatalists();
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function closeDimModal(e) {
  if (!e || e.target.id === 'modal-dim-backdrop') document.getElementById('modal-dim-backdrop').style.display = 'none';
}

function guardarDimensionModal() {
  try {
    const cliente = document.getElementById('md-cliente').value.trim().toUpperCase();
    const nombre = document.getElementById('md-nombre').value.trim().toUpperCase();
    const zona = document.getElementById('md-zona').value.trim().toUpperCase();
    const precio = parseFloat(document.getElementById('md-precio').value);
    const todasZonas = !!(document.getElementById('md-todas-zonas') || {}).checked && dimEditId == null;
    if (!cliente) { alert('Elegí el cliente.'); return; }
    if (!nombre) { alert('Ingresá el nombre de la dimensión.'); return; }
    if (!todasZonas && !zona) { alert('Elegí la zona.'); return; }
    if (isNaN(precio) || precio < 0) { alert('Ingresá un precio válido.'); return; }

    // Precio único cerrado con el cliente: una fila por cada zona del tarifario.
    if (todasZonas) {
      const zonas = _dimZonasTarifario();
      if (!zonas.length) { alert('El tarifario no tiene zonas cargadas: no se puede aplicar a todas.'); return; }
      const yaCargadas = zonas.filter(z => AppData.dimCatalogo.some(x =>
        dimEsTipo(x) &&
        normNombre(x.cliente) === normNombre(cliente) &&
        normNombre(x.nombre) === normNombre(nombre) &&
        normNombre(x.zona) === normNombre(z)));
      const nuevas = zonas.length - yaCargadas.length;
      const salto = String.fromCharCode(10);
      if (!confirm('"' + nombre + '" de ' + cliente + ' a ' + fmtPeso(precio) + ' en las ' + zonas.length + ' zonas del tarifario.' + salto + salto +
                   '· ' + nuevas + ' zona(s) nueva(s)' + salto +
                   '· ' + yaCargadas.length + ' con el precio actualizado' + salto + salto + '¿Confirmás?')) return;

      zonas.forEach(z => {
        const i = AppData.dimCatalogo.findIndex(x =>
          dimEsTipo(x) &&
          normNombre(x.cliente) === normNombre(cliente) &&
          normNombre(x.nombre) === normNombre(nombre) &&
          normNombre(x.zona) === normNombre(z));
        if (i >= 0) AppData.dimCatalogo[i].precio = precio;
        else AppData.dimCatalogo.push({ cliente, nombre, zona: z, precio, tipo: dimTipo });
      });

      saveDimCatalogo();
      dimEditId = null;
      document.getElementById('modal-dim-backdrop').style.display = 'none';
      renderDimensionesEspeciales();
      showToast('✅ ' + nombre + ' cargada en ' + zonas.length + ' zonas a ' + fmtPeso(precio));
      return;
    }

    const entry = { cliente, nombre, zona, precio, tipo: dimTipo };
    const dupIdx = AppData.dimCatalogo.findIndex((x, i) => String(x.id) !== String(dimEditId) && dimEsTipo(x) &&
      normNombre(x.cliente) === normNombre(cliente) && normNombre(x.nombre) === normNombre(nombre) && normNombre(x.zona) === normNombre(zona));

    const editandoD = _dimEditando();
    if (dimEditId != null && !editandoD) {
      alert('La condición que estabas editando ya no existe: la borró o la cambió otra sesión.');
      dimEditId = null; renderDimensionesEspeciales(); return;
    }
    if (editandoD) {
      if (dupIdx >= 0) { alert('Ya existe ese cliente + dimensión + zona.'); return; }
      Object.assign(editandoD, entry);
    } else if (dupIdx >= 0) {
      if (!confirm('Ya existe "' + nombre + '" de ' + cliente + ' en ' + zona + '. ¿Actualizar su precio?')) return;
      AppData.dimCatalogo[dupIdx].precio = precio;
    } else {
      AppData.dimCatalogo.push(entry);
    }

    saveDimCatalogo();
    dimEditId = null;
    document.getElementById('modal-dim-backdrop').style.display = 'none';
    renderDimensionesEspeciales();
    showToast('✅ Dimensión guardada en el catálogo');
  } catch (err) { console.error(err); alert('Error al guardar: ' + err.message); }
}

// Por ID, no por posición: el catálogo se reemplaza entero al re-hidratar y el
// índice horneado en el HTML terminaba borrando la condición de otro cliente.
// Es el mismo bug que le borraba el Super SLA al conductor equivocado.
function eliminarDimension(id) {
  const d = (AppData.dimCatalogo || []).find(x => String(x.id) === String(id))
    || AppData.dimCatalogo[id];   // filas todavía sin id (recién creadas)
  if (!d) { showToast('⚠️ Esa condición ya no existe'); renderDimensionesEspeciales(); return; }
  const idx = AppData.dimCatalogo.indexOf(d);
  if (!confirm('Eliminar del catálogo: ' + d.nombre + ' de ' + d.cliente + ' en ' + d.zona + '?')) return;
  AppData.dimCatalogo.splice(idx, 1);
  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('🗑 Dimensión eliminada del catálogo');
}

function limpiarDimensiones() {
  const propias = (AppData.dimCatalogo || []).filter(dimEsTipo);
  const etq = dimTipo === 'cliente' ? 'de CLIENTES' : 'de CONDUCTOR';
  if (!propias.length) { showToast('El catálogo ' + etq + ' ya está vacío'); return; }
  const salto = String.fromCharCode(10);
  if (!confirm('¿Vaciar el tarifario ' + etq + '? (' + propias.length + ' filas)' + salto + salto + 'El otro tarifario no se toca.')) return;
  AppData.dimCatalogo = (AppData.dimCatalogo || []).filter(d => !dimEsTipo(d));
  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('🗑 Tarifario ' + etq + ' vaciado');
}

function descargarPlantillaDimensiones() {
  // La planilla NO es una plantilla vacía: baja con TODO el catálogo cargado.
  // El circuito real es descargar → agregar las condiciones nuevas → volver a
  // subir. Con una plantilla en blanco habría que recargar todo de cero.
  const cat = (AppData.dimCatalogo || []).filter(dimEsTipo).slice().sort((a, b) =>
    String(a.cliente).localeCompare(String(b.cliente)) ||
    String(a.nombre).localeCompare(String(b.nombre)) ||
    String(a.zona).localeCompare(String(b.zona)));

  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por Cliente + Condición especial + Zona. El precio es lo que se le paga al conductor por ESA condición en ESA zona. Agregá abajo las filas nuevas y volvé a subir el archivo.'],
    ['CLIENTE', 'ZONA', 'CONDICION ESPECIAL', 'PRECIO A PAGAR AL CONDUCTOR', 'DETALLE'],
  ];
  if (cat.length) {
    cat.forEach(d => aoa.push([d.cliente || '', d.zona || '', d.nombre || '', _num(d.precio), d.detalle || '']));
  } else {
    // Catálogo vacío: dejamos ejemplos para que se vea el formato esperado.
    aoa.push(['ACONCAGUA', 'CABA', '3 Y 4 BULTOS', 5040, '3 Y 4 BULTOS X2']);
    aoa.push(['ACONCAGUA', 'MERLO', '3 Y 4 BULTOS', 5600, '3 Y 4 BULTOS X2']);
    aoa.push(['FERRETERIA MARTIN', 'ZARATE', 'CARRETILLA', 10000, 'LAS CARRETILLAS VALEN $10000']);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 30 }, { wch: 28 }, { wch: 32 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HOJA DE CARGA');
  const hoy = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Dimensiones_Catalogo_' + hoy + '.xlsx');
  showToast(cat.length
    ? '📥 Catálogo descargado: ' + cat.length + ' precio(s) — agregá las filas nuevas y volvé a subirlo'
    : '📥 Plantilla descargada (el catálogo está vacío) — completala y subila');
}

function importDimensionesEspeciales(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }

      // Detección de la fila de encabezados. Acepta la planilla de la EMPRESA
      // ("HOJA DE CARGA": título en la fila 1, encabezados en la 3, columna A
      // vacía, "CONDICION ESPECIAL" + "PRECIO A PAGAR AL CONDUCTOR" + "DETALLE")
      // y también la plantilla simple que genera la app.
      const esCli    = c => c.includes('cliente') || c.includes('empresa');
      const esZona   = c => c.includes('zona') || c.includes('localidad');
      const esDim    = c => c.includes('dimension') || c.includes('dimensin') || c.includes('condicion') || c.includes('condicin') || c.includes('nombre');
      const esPrecio = c => c.includes('precio') || c.includes('valor') || c.includes('monto') || c.includes('tarifa');
      // Cada concepto tiene que caer en una columna DISTINTA. Sin esa condición,
      // la fila 1 de la plantilla (el aviso "…una fila por Cliente + Condición
      // especial + Zona…") matcheaba las tres palabras en una sola celda: se la
      // tomaba como encabezado, las 4 columnas apuntaban a la A y se importaba
      // el nombre del cliente en cliente, dimensión y zona, con precio 0.
      let h = -1, cols = null;
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const cells = (rows[r] || []).map(x => String(x).toLowerCase().replace(/[^a-z]/g, ''));
        const iC = cells.findIndex(esCli), iZ = cells.findIndex(esZona), iD = cells.findIndex(esDim);
        if (iC >= 0 && iZ >= 0 && iD >= 0 && iC !== iZ && iC !== iD && iZ !== iD) {
          h = r; cols = { iC, iZ, iD }; break;
        }
      }
      if (h < 0) {
        alert('No se encontró la fila de encabezados.\n\nSe esperan columnas de Cliente, Zona y Condición especial (o Dimensión).\nFunciona con la planilla de la empresa ("HOJA DE CARGA") o con la plantilla que descarga la app.');
        return;
      }
      const header = (rows[h] || []).map(x => String(x).toLowerCase().trim());
      const norm = x => String(x).toLowerCase().replace(/[^a-z]/g, '');
      const iCli    = cols.iC;
      const iNom    = cols.iD;
      const iZona   = cols.iZ;
      const iPrecio = header.findIndex(x => esPrecio(norm(x)));
      const iDet    = header.findIndex(x => norm(x).includes('detalle') || norm(x).includes('observacion') || norm(x).includes('nota'));
      if (iCli < 0 || iNom < 0 || iZona < 0 || iPrecio < 0) {
        alert('Faltan columnas. Se necesitan: Cliente, Zona, Condición especial (o Dimensión) y Precio.');
        return;
      }
      // Las demás columnas (p. ej. DETALLE) se ignoran: no afectan el cálculo.

      const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
      const claveDe = (c, n, z) => normNombre(c) + '|' + normNombre(n) + '|' + normNombre(z);

      // Índice del catálogo actual (evita el escaneo por fila: con ~2.700 filas
      // el findIndex anidado hacía millones de comparaciones).
      // SOLO las filas de la solapa activa: son dos tarifarios distintos y la
      // misma combinación cliente+dimensión+zona existe en los dos. Sin este
      // filtro, importar la lista de CLIENTES le pisaba el precio a la del
      // CONDUCTOR y ofrecía borrarla, que es el cartel que aparecía.
      const idxActual = new Map();
      AppData.dimCatalogo.forEach((d, i) => { if (dimEsTipo(d)) idxActual.set(claveDe(d.cliente, d.nombre, d.zona), i); });

      const vistas = new Set();
      let nuevas = 0, actualizadas = 0, sinCambio = 0, ignoradas = 0;
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const cliente = String(r[iCli] || '').trim().toUpperCase();
        const nombre  = String(r[iNom] || '').trim().toUpperCase();
        // Alias de zona, igual que en el tarifario de clientes: la planilla parte
        // LA PLATA en sub-zonas que en los envios no existen, y una dimension
        // cuya zona no matchea ningun envio no se aplica nunca.
        const zona    = (typeof zonaCanonica === 'function')
          ? zonaCanonica(r[iZona])
          : String(r[iZona] || '').trim().toUpperCase();
        const precio  = parseNum(r[iPrecio]);
        const detalle = iDet >= 0 ? String(r[iDet] || '').trim() : '';
        if (!cliente || !nombre || !zona) { if (r.some(c => String(c).trim())) ignoradas++; continue; }
        const k = claveDe(cliente, nombre, zona);
        vistas.add(k);
        const pos = idxActual.get(k);
        if (pos !== undefined) {
          if (_num(AppData.dimCatalogo[pos].precio) !== precio) { AppData.dimCatalogo[pos].precio = precio; actualizadas++; }
          else sinCambio++;
          if (detalle) AppData.dimCatalogo[pos].detalle = detalle;
        } else {
          idxActual.set(k, AppData.dimCatalogo.length);
          AppData.dimCatalogo.push({ cliente, nombre, zona, precio, detalle, tipo: dimTipo });
          nuevas++;
        }
      }
      if (!vistas.size) { alert('No se importó ninguna fila válida (se necesitan Cliente, Zona y Condición especial).'); return; }

      // La planilla de la empresa es la base de datos maestra: ofrecemos dejar el
      // catálogo idéntico al archivo, quitando lo que ya no figura en él.
      const sobrantes = AppData.dimCatalogo.filter(d => dimEsTipo(d) && !vistas.has(claveDe(d.cliente, d.nombre, d.zona)));
      let eliminadas = 0;
      if (sobrantes.length) {
        const muestra = sobrantes.slice(0, 5).map(d => '· ' + d.cliente + ' — ' + d.nombre + ' (' + d.zona + ')').join('\n');
        // Decir SIEMPRE de que tarifario habla: el cartel salia sin aclararlo y
        // parecia que al archivo de clientes le faltaban las filas del conductor.
        const etq = dimTipo === 'cliente' ? 'de CLIENTES' : 'de CONDUCTOR';
        if (confirm('El archivo trae ' + vistas.size + ' combinaciones para el tarifario ' + etq + '.\n\nEn ese tarifario hay ' + sobrantes.length + ' que NO figuran en el archivo:\n' + muestra + (sobrantes.length > 5 ? '\n…y ' + (sobrantes.length - 5) + ' más' : '') +
          '\n\n¿Eliminarlas para que el tarifario ' + etq + ' quede igual al archivo?\n(Aceptar = sincronizar · Cancelar = conservarlas · el otro tarifario no se toca)')) {
          // El otro tarifario no se toca.
          AppData.dimCatalogo = AppData.dimCatalogo.filter(d => !dimEsTipo(d) || vistas.has(claveDe(d.cliente, d.nombre, d.zona)));
          eliminadas = sobrantes.length;
        }
      }

      saveDimCatalogo();
      renderDimensionesEspeciales();
      showToast('✅ Catálogo importado: ' + nuevas + ' nueva(s) · ' + actualizadas + ' con precio actualizado · ' + sinCambio + ' sin cambios' +
        (eliminadas ? ' · ' + eliminadas + ' eliminada(s)' : '') + (ignoradas ? ' · ' + ignoradas + ' fila(s) ignorada(s)' : ''));

      // Lo que este import sumó de un lado puede faltar del otro: se avisa acá y
      // no solo con el cartel de la otra solapa, que no se ve hasta entrar.
      const otro = dimTipo; dimTipo = dimOtroTipo();
      const faltanAlla = dimFaltantesEnSolapa().length;
      dimTipo = otro;
      if (faltanAlla) setTimeout(() => showToast('⚠️ Quedan ' + faltanAlla +
        ' condición(es) sin registrar en el tarifario de ' + dimEtiquetaTipo(dimOtroTipo()) +
        ' — entrá a esa solapa para cargarles el precio'), 1200);
    } catch (err) { console.error(err); alert('Error al importar: ' + err.message); }
    finally { event.target.value = ''; }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ═════════════════ MÓDULO DESCUENTO CONDUCTORES ══════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

