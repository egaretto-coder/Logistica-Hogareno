// ════════════════════════════════════════════════════════════════════════
//  LAS LIQUIDACIONES, EN EXCEL — el archivo de TRABAJO
//
//  El PDF es el papel: el del cliente se manda por mail con la factura, el del
//  conductor se le entrega y se firma. Pero para REVISAR una liquidación —
//  buscar la diferencia, cruzarla contra otra planilla, sumar por zona— un PDF
//  no sirve, y el circuito que se armó para suplirlo era:
//
//      marcar la liquidación como lista → bajar el PDF → destildar lo marcado
//      → pasar el PDF a Excel por una página web → limpiar los datos
//
//  O sea que para LEER un número había que mover el ESTADO de la liquidación,
//  que es justo lo que el circuito de dos manos usa para decir "esto ya lo
//  revisó alguien". Entre el marcado y el destildado el tesorero podía bajar un
//  PDF a medio corregir, y el administrativo terminaba trabajando sobre datos
//  que una web convirtió como pudo.
//
//  Acá se corta por el otro lado: el Excel sale del sistema, con los mismos
//  números que la liquidación, y se baja desde DOS lugares distintos:
//
//    · Liquidación de clientes / Liquidación de Conductores → las que están
//      LISTAS. Es el panel del tesorero: el filtro de "armada" se respeta igual
//      que para el PDF, porque es la misma plata y el mismo destinatario.
//    · Detalle de cliente / Detalle de conductores → SIN marcar nada.
//      Es el panel donde se ARMA, y el que arma necesita mirar antes de cerrar.
//      Ahí el archivo es de control y no hay nada que proteger: no lleva
//      membrete, ni número de documento, y no sale de la empresa.
//
//  Tres criterios que hacen que el archivo sirva:
//
//  1) LOS MONTOS VAN COMO NÚMERO, no como texto con "$". El archivo se baja
//     para sumarlo, y "$5.783.881" es una cadena que Excel no suma.
//  2) CADA HOJA CIERRA SOLA. La de envíos termina en el total de los envíos y
//     la de cargos en el de los cargos; el total a facturar está en Resumen,
//     que es el único lugar donde se suman las dos cosas. Una hoja cuyo total
//     no da el número de arriba, sin decir por qué, es exactamente el problema
//     que esto viene a resolver.
//  3) LA PRIMERA FILA DICE QUÉ ES Y QUÉ ABARCA. Un archivo recortado que no lo
//     dice es un papel que miente (mismo criterio que la descarga del plantel).
//
//  Y lo que el Excel del CLIENTE no trae, a propósito: el costo del conductor y
//  el margen. Detalle de cliente tampoco los muestra — acá se arma lo que se le
//  factura al cliente, y el otro lado del mostrador solo agrega ruido.
// ════════════════════════════════════════════════════════════════════════

// Lo que se escribe en el título de cada hoja. No es decorativo: el archivo se
// manda por chat entre operadores y tiene que poder decir qué es sin el
// contexto de quién lo bajó.
const XLS_NOTA = 'USO INTERNO · archivo de control, el comprobante es el PDF';

// Redondeo a centavos: los importes salen de sumas de precios y el flotante
// arrastra colas (…0000003) que en una celda se leen como un error de carga.
function _xlsNum(v) { return Math.round(_num(v) * 100) / 100; }

// Las fechas van como TEXTO DD/MM/YYYY, igual que en la pantalla y que en el
// resto de las descargas de la app. Pasarlas como Date deja que la conversión a
// serial de Excel las corra un día según la zona horaria, y un envío que cambia
// de fecha dentro del archivo es peor que una columna que no se puede ordenar:
// las filas ya salen en orden cronológico desde acá.
function _xlsFecha(f) { return String(f || '').trim(); }

function _xlsHoja(aoa, anchos) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (anchos) ws['!cols'] = anchos.map(w => ({ wch: w }));
  ws['!rows'] = [{ hpx: 22 }];
  const cols = Math.max(1, (aoa[1] || aoa[0] || []).length) - 1;
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols } }];
  return ws;
}

// Nombre de archivo: Windows no acepta \ / : * ? " < > | y un cliente puede
// llamarse "A/B". Sin esto la descarga falla sin decir por qué.
function _xlsNombreArchivo(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80);
}

function _xlsHoy() {
  const d = new Date();
  return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear();
}

function _xlsBajar(wb, nombre, aviso) {
  XLSX.writeFile(wb, nombre);
  if (typeof showToast === 'function') showToast('📥 ' + (aviso || ('Descargado ' + nombre)));
}

// Guarda contra el caso en que la librería no cargó (CDN caído, primera visita
// sin conexión). Sin esto el botón tira un ReferenceError y no pasa nada
// visible, que el operador lee como "el botón no anda".
function _xlsListo() {
  if (typeof XLSX !== 'undefined' && XLSX && XLSX.utils) return true;
  alert('No se pudo cargar el componente de Excel.\n\n' +
    'Probá recargar la página; si seguís sin conexión, el PDF sí se puede descargar.');
  return false;
}

// ════════════════════════════════════════════════════════════════════════
//  CLIENTES
// ════════════════════════════════════════════════════════════════════════

// Qué tiene de particular este envío. Va en UNA sola columna y no en seis
// banderas: el que revisa busca "¿por qué este sale en $0?", no una matriz.
function _xlsMarcasEnvio(e) {
  const m = [];
  if (e.anulado) m.push('ANULADO · se bonificó ' + fmtPeso(e.bonificado));
  if (e.visita) m.push('visita pagada (no se entregó, se factura igual)');
  if (e.arrastrado) m.push('traído de otro período');
  if (e.dimSinVenta) m.push('la condición "' + (e.dimAsignada || '') + '" NO tiene precio de venta: se factura la tarifa de la zona');
  if (!e.anulado && _num(e.precio) <= 0) m.push('SIN TARIFA en esa zona: se factura $0');
  return m.join(' · ');
}

// Un cliente ya resuelto: sus envíos, sus zonas, sus cargos y sus totales, en
// la forma que después se vuelca a las hojas. Se arma una vez por cliente y lo
// usan tanto el archivo de uno como el de muchos, así los dos no pueden dar
// números distintos.
function _xlsClienteDatos(cod, rango) {
  const k = clienteKey(cod);
  const liq = calcLiquidacionCliente(k, rango, { detalle: true });
  // El detalle sale en el orden de los registros (orden de importación). Se
  // ordena por fecha para que el archivo siga la cronología real, igual que el
  // PDF: un día cargado tarde no puede quedar al final de todo.
  const envios = (liq.envios || []).slice();
  if (typeof parseFechaReg === 'function') {
    const t = new Map();
    envios.forEach(e => { const f = parseFechaReg(e.fecha); t.set(e, f ? f.getTime() : Infinity); });
    envios.sort((a, b) => t.get(a) - t.get(b));
  }
  const armada = (typeof liquidacionArmada === 'function') ? liquidacionArmada(k, rango) : null;
  return {
    cod: k, nombre: clienteNombreDe(k), rango, liq, envios, armada,
    periodo: (typeof periodoLabel === 'function' && typeof periodoDiasDe === 'function')
      ? periodoLabel(periodoDiasDe(k)) : 'Semanal'
  };
}

function _xlsClienteLibro(datos, titulo) {
  const wb = XLSX.utils.book_new();
  const varios = datos.length > 1;

  // ── Resumen ────────────────────────────────────────────────────────────
  // Va primero a propósito: el archivo se baja para encontrar una diferencia, y
  // lo primero que se mira es el total.
  const aR = [
    [titulo],
    ['CLIENTE', 'CÓD. CLIENTE', 'PERÍODO', 'DESDE', 'HASTA', 'ENVÍOS', 'FACTURADO POR ENVÍOS',
      'CARGOS', 'TOTAL A FACTURAR', 'SIN TARIFA', 'CONDICIÓN SIN PRECIO', 'ANULADOS', 'BONIFICADO', 'ESTADO']
  ];
  datos.forEach(d => aR.push([
    d.nombre, d.cod, d.periodo, d.rango.desde, d.rango.hasta,
    _num(d.liq.totalEnvios), _xlsNum(d.liq.totalEnvio), _xlsNum(d.liq.totalCargos), _xlsNum(d.liq.total),
    _num(d.liq.sinTarifa), _num(d.liq.dimSinVenta), _num(d.liq.anulados), _xlsNum(d.liq.bonificado),
    d.armada ? ('Lista' + (d.armada.armada_por ? ' (por ' + d.armada.armada_por + ')' : '')) : 'Sin armar'
  ]));
  if (varios) {
    const sum = f => datos.reduce((s, d) => s + _num(f(d)), 0);
    aR.push([]);
    aR.push(['TOTAL', '', '', '', '', sum(d => d.liq.totalEnvios),
      _xlsNum(sum(d => d.liq.totalEnvio)), _xlsNum(sum(d => d.liq.totalCargos)), _xlsNum(sum(d => d.liq.total)),
      sum(d => d.liq.sinTarifa), sum(d => d.liq.dimSinVenta), sum(d => d.liq.anulados),
      _xlsNum(sum(d => d.liq.bonificado)), '']);
  }
  XLSX.utils.book_append_sheet(wb, _xlsHoja(aR,
    [26, 16, 12, 12, 12, 9, 20, 13, 18, 11, 20, 11, 14, 28]), 'Resumen');

  // ── Envíos: una fila por envío ─────────────────────────────────────────
  const aE = [
    [titulo + ' · detalle envío por envío'],
    ['CLIENTE', 'CÓD. CLIENTE', 'FECHA', 'TRACKING', 'DESTINATARIO', 'ZONA',
      'CONDICIÓN ESPECIAL', 'IMPORTE', 'OBSERVACIÓN']
  ];
  let nEnv = 0, totEnv = 0;
  datos.forEach(d => d.envios.forEach(e => {
    nEnv++; totEnv += _num(e.precio);
    aE.push([d.nombre, d.cod, _xlsFecha(e.fecha), e.tracking || '', e.destinatario || '',
      e.zona || '', e.dim || '', _xlsNum(e.precio), _xlsMarcasEnvio(e)]);
  }));
  aE.push([]);
  aE.push(['TOTAL ENVÍOS', '', '', '', '', '', nEnv + ' envío(s)', _xlsNum(totEnv), '']);
  XLSX.utils.book_append_sheet(wb, _xlsHoja(aE, [26, 16, 12, 20, 28, 22, 24, 14, 56]), 'Envíos');

  // ── Por zona: el mismo resumen que lleva el PDF ────────────────────────
  const aZ = [
    [titulo + ' · resumen por zona'],
    ['CLIENTE', 'ZONA / CONDICIÓN', 'ENVÍOS', 'PRECIO UNITARIO', 'SUBTOTAL', 'BONIFICADO']
  ];
  let totZ = 0;
  datos.forEach(d => (d.liq.filas || []).forEach(f => {
    totZ += _num(f.subtotal);
    aZ.push([d.nombre, f.zona || '', _num(f.count), _xlsNum(f.precio), _xlsNum(f.subtotal), _xlsNum(f.bonificado)]);
  }));
  aZ.push([]);
  aZ.push(['TOTAL', '', '', '', _xlsNum(totZ), '']);
  XLSX.utils.book_append_sheet(wb, _xlsHoja(aZ, [26, 36, 10, 17, 15, 14]), 'Por zona');

  // ── Cargos ─────────────────────────────────────────────────────────────
  // La hoja va SIEMPRE, aunque esté vacía: así el archivo tiene la misma forma
  // siempre y el cero se lee como un cero medido y no como una hoja que falta.
  const aC = [
    [titulo + ' · cargos que no vienen de un envío'],
    ['CLIENTE', 'CONCEPTO', 'DETALLE', 'CANTIDAD', 'PRECIO UNITARIO', 'MONTO']
  ];
  let totC = 0, nC = 0;
  datos.forEach(d => (d.liq.cargos || []).forEach(c => {
    nC++; totC += _num(c.monto);
    aC.push([d.nombre,
      (typeof cargoLabel === 'function' ? cargoLabel(c.concepto) : (c.concepto || '')),
      (typeof cargoDatosTxt === 'function' ? cargoDatosTxt(c) : ''),
      _num(c.cantidad), _xlsNum(c.precio_unitario), _xlsNum(c.monto)]);
  }));
  if (!nC) aC.push(['', 'Sin cargos en el período', '', '', '', 0]);
  aC.push([]);
  aC.push(['TOTAL CARGOS', '', '', '', '', _xlsNum(totC)]);
  XLSX.utils.book_append_sheet(wb, _xlsHoja(aC, [26, 24, 48, 11, 17, 15]), 'Cargos');

  return wb;
}

// Un solo cliente. Es lo que baja Detalle de cliente, sin pedirle que marque
// nada: el archivo no es el comprobante.
function exportLiqClienteExcel(cod, rango) {
  if (!_xlsListo()) return;
  const k = clienteKey(cod);
  if (!k) { alert('Elegí un cliente primero.'); return; }
  rango = rango || semanaClienteRango(hoyISO());
  const d = _xlsClienteDatos(k, rango);
  if (!d.liq.totalEnvios && !(d.liq.cargos || []).length) {
    alert('Sin envíos ni cargos de ' + d.nombre + ' en el período ' + rango.desde + ' al ' + rango.hasta + '.');
    return;
  }
  const titulo = 'Liquidación de ' + d.nombre + ' · Del ' + rango.desde + ' al ' + rango.hasta +
    ' · ' + d.liq.totalEnvios + ' envío(s) · ' + fmtPeso(d.liq.total) +
    (d.armada ? ' · liquidación marcada como lista' : ' · TODAVÍA SIN ARMAR (borrador de control)') +
    ' · ' + XLS_NOTA + ' · generado el ' + new Date().toLocaleString('es-AR');
  _xlsBajar(_xlsClienteLibro([d], titulo),
    'Liquidacion_' + _xlsNombreArchivo(d.nombre) + '_' + rango.hasta.replace(/\//g, '-') + '.xlsx',
    'Excel de ' + d.nombre + ' descargado · ' + d.liq.totalEnvios + ' envío(s)');
}

// Varios clientes en UN archivo. No se bajan N archivos como con el PDF: el PDF
// es el papel de cada cliente y va suelto, pero el Excel se abre para cruzar, y
// cuarenta archivos sueltos obligan a pegarlos a mano — que es exactamente el
// trabajo que esto viene a sacar.
function exportLiqClientesExcel(lista, rangoRef) {
  if (!_xlsListo()) return;
  if (!lista || !lista.length) { alert('No hay liquidaciones para exportar.'); return; }
  const datos = lista.map(x => _xlsClienteDatos(x.cod, x.rango || rangoRef));
  const total = datos.reduce((s, d) => s + _num(d.liq.total), 0);
  const envios = datos.reduce((s, d) => s + _num(d.liq.totalEnvios), 0);
  const titulo = 'Liquidación de clientes · ' + datos.length + ' cliente(s) · semana ' +
    rangoRef.desde + ' al ' + rangoRef.hasta + ' · ' + envios + ' envío(s) · ' + fmtPeso(total) +
    ' · cada cliente con SU período · ' + XLS_NOTA + ' · generado el ' + new Date().toLocaleString('es-AR');
  _xlsBajar(_xlsClienteLibro(datos, titulo),
    'Liquidaciones_clientes_' + datos.length + '_' + rangoRef.hasta.replace(/\//g, '-') + '.xlsx',
    datos.length + ' liquidación(es) de cliente en un Excel');
}

// Handler del panel Liquidación de clientes. Respeta EXACTAMENTE la misma
// selección que el PDF (cliqADescargar): lo tildado dentro del filtro, y solo
// lo que está armado. Que el archivo sea interno no lo convierte en otra lista.
function descargarLiqClientesExcel() {
  const { rango, lista } = cliqADescargar();
  if (!lista.length) {
    alert('No hay liquidaciones armadas en esta semana.\n\n' +
      'Para revisar una antes de cerrarla, bajá el Excel de control desde Detalle de cliente: ' +
      'ahí no hace falta marcarla como lista.');
    return;
  }
  exportLiqClientesExcel(lista, rango);
}

// Handler de Detalle de cliente: el cliente y el período que están en pantalla.
// Exporta el PERÍODO ENTERO y no lo que el buscador deja a la vista: lo que se
// baja es la liquidación, y una liquidación recortada no cierra contra ningún
// total.
function dcliDescargarExcel() {
  const cod = document.getElementById('dcli-select')?.value || '';
  if (!cod) { alert('Elegí un cliente primero.'); return; }
  exportLiqClienteExcel(cod, dcliRango());
}

// ════════════════════════════════════════════════════════════════════════
//  CONDUCTORES
// ════════════════════════════════════════════════════════════════════════

// Lo que hay que mirar de una fila. A diferencia del PDF —que es cara al
// conductor y por eso no muestra marcadores internos— acá SÍ van: el archivo es
// del administrativo, y la pregunta que trae es justamente "¿por qué este envío
// pagó esto?".
function _xlsMarcasFila(f) {
  const m = [];
  if (f.precio_corregido) m.push('precio pisado a mano');
  if (f.manual) m.push('envío cargado a mano');
  if (f.zona_manual) m.push('zona corregida a mano');
  if (f.es_super) m.push('precio Super SLA');
  if (f.sin_tarifa) m.push(f.es_dim_especial
    ? 'la condición especial NO tiene precio en esa zona: se paga $0'
    : 'SIN TARIFA en esa zona: se paga $0');
  return m.join(' · ');
}

// Un conductor resuelto: sus filas, sus imputaciones y su neto. `rango` es el
// que manda para las imputaciones y tiene que ser el MISMO con el que se
// filtraron los envíos: si los envíos salen de una semana y los descuentos de
// otra, el neto mezcla dos períodos. Sin rango no se calcula ninguna: un neto
// que mezcla es peor que no mostrar ninguno.
function _xlsConductorDatos(cond, d, rango) {
  const imp = rango ? {
    km: kmAdicionalConductor(cond, rango),
    especial: recorridoEspecialConductor(cond, rango),
    adelanto: adelantoDescuentoConductor(cond, rango),
    extravio: extravioCuotaDescuento(cond, rango),
    combustible: descItemDescuentoConductor('combustible', cond, rango),
    proveedores: descItemDescuentoConductor('proveedores', cond, rango),
    extraviados: descItemDescuentoConductor('extraviados', cond, rango)
  } : null;
  const bruto = _num(d.total);
  // El neto sale de la MISMA cuenta que el PDF y que el panel: reimplementarlo
  // acá daría un número parecido y no el mismo, que es como dos cuentas del
  // mismo importe terminan discrepando.
  const resumen = rango ? imputacionesConductor(cond, rango) : null;
  const neto = rango ? _num(netoLiquidacion(bruto, resumen)) : bruto;
  const pan = (typeof panelConductorDe === 'function') ? panelConductorDe(cond) : null;
  return {
    cond, d, rango, imp, bruto, neto,
    // netoLiquidacion nunca baja de 0: si lo descontado se come el bruto, el
    // neto queda en 0 y la fila NO suma de punta a punta. Se dice, en vez de
    // dejar una resta que no da.
    recortado: !!resumen &&
      (bruto + _num(resumen.km) + _num(resumen.especial) - _num(resumen.descuentos)) < 0,
    condicion: (pan && pan.condicion) || '',
    armada: (typeof liqConductorArmada === 'function') ? liqConductorArmada(cond) : null
  };
}

function _xlsConductorLibro(datos, titulo, conImputaciones) {
  const wb = XLSX.utils.book_new();
  const varios = datos.length > 1;
  const cab = ['CONDUCTOR', 'CONDICIÓN', 'DESDE', 'HASTA', 'ENVÍOS QUE PAGAN', 'NO CONTABILIZAN', 'BRUTO'];
  // Los descuentos van en NEGATIVO para que la fila se pueda sumar de punta a
  // punta y dé el neto. Puestos en positivo, el que revisa tiene que acordarse
  // de cuál suma y cuál resta, y ahí es donde se equivoca.
  const cabImp = ['KM DE DESVÍO', 'RECORRIDOS ESPECIALES', 'COMBUSTIBLE', 'PROVEEDORES',
    'EXTRAVIADOS', 'CUOTA DE ADELANTO', 'CUOTA DE EXTRAVÍO', 'NETO A PAGAR', 'ESTADO', 'OBSERVACIÓN'];

  const aR = [[titulo], conImputaciones ? cab.concat(cabImp) : cab.concat(['ESTADO'])];
  datos.forEach(x => {
    const base = [x.cond, x.condicion || '(sin condición: no se liquida)',
      x.rango ? x.rango.desde : '', x.rango ? x.rango.hasta : '',
      _num(x.d.filas.length), _num((x.d.filas_excluidas || []).length), _xlsNum(x.bruto)];
    if (!conImputaciones) { aR.push(base.concat([x.armada ? 'Lista' : 'Sin armar'])); return; }
    aR.push(base.concat([
      _xlsNum(x.imp.km.monto), _xlsNum(x.imp.especial.monto),
      -_xlsNum(x.imp.combustible.monto), -_xlsNum(x.imp.proveedores.monto), -_xlsNum(x.imp.extraviados.monto),
      -_xlsNum(x.imp.adelanto.monto), -_xlsNum(x.imp.extravio.monto),
      _xlsNum(x.neto),
      x.armada ? ('Lista' + (x.armada.armada_por ? ' (por ' + x.armada.armada_por + ')' : '')) : 'Sin armar',
      x.recortado ? 'Lo descontado supera al bruto: el neto queda en $0 y el saldo se arrastra' : ''
    ]));
  });
  if (varios) {
    const sum = f => _xlsNum(datos.reduce((s, x) => s + _num(f(x)), 0));
    const fila = ['TOTAL', '', '', '',
      datos.reduce((s, x) => s + x.d.filas.length, 0),
      datos.reduce((s, x) => s + (x.d.filas_excluidas || []).length, 0),
      sum(x => x.bruto)];
    aR.push([]);
    aR.push(conImputaciones ? fila.concat([
      sum(x => x.imp.km.monto), sum(x => x.imp.especial.monto),
      -sum(x => x.imp.combustible.monto), -sum(x => x.imp.proveedores.monto),
      -sum(x => x.imp.extraviados.monto), -sum(x => x.imp.adelanto.monto),
      -sum(x => x.imp.extravio.monto), sum(x => x.neto), '', ''
    ]) : fila.concat(['']));
  }
  XLSX.utils.book_append_sheet(wb, _xlsHoja(aR, conImputaciones
    ? [26, 22, 12, 12, 17, 17, 14, 15, 22, 15, 14, 14, 19, 18, 16, 28, 58]
    : [26, 22, 12, 12, 17, 17, 14, 16]), 'Resumen');

  // ── Envíos ─────────────────────────────────────────────────────────────
  // Van también los que NO contabilizan, en $0 y marcados: es donde está la
  // mitad de los errores que se buscan (el "No entregado" que sí había que
  // pagar) y esconderlos haría que el archivo no sirva justamente para eso.
  const aE = [
    [titulo + ' · detalle envío por envío'],
    ['CONDUCTOR', 'FECHA', 'TRACKING', 'CLIENTE', 'DESTINATARIO', 'ZONA', 'ESTADO', 'CONTABILIZA',
      'CONDICIÓN ESPECIAL', 'TIPO DE TARIFA', 'IMPORTE', 'OBSERVACIÓN']
  ];
  let nE = 0, totE = 0, nNo = 0;
  datos.forEach(x => {
    x.d.filas.forEach(f => {
      nE++; totE += _num(f.precio);
      aE.push([x.cond, _xlsFecha(f.fecha), f.tracking || '', f.cliente || '', f.destinatario || '',
        f.zona || '', f.estado || '', 'Sí',
        f.es_dim_especial ? ((f.dim_cliente ? f.dim_cliente + ' · ' : '') + (f.dim_condicion || '')) : '',
        (typeof tipoLabel === 'function' ? tipoLabel(f.tipo) : (f.tipo || '')),
        _xlsNum(f.precio), _xlsMarcasFila(f)]);
    });
    (x.d.filas_excluidas || []).forEach(f => {
      nNo++;
      aE.push([x.cond, _xlsFecha(f.fecha), f.tracking || '', f.cliente || '', f.destinatario || '',
        f.zona || '', f.estado || '', 'No', '', '', 0,
        'No se le paga. Si la visita se hizo igual, se resuelve con "Pagar visita" en Detalle de conductores']);
    });
  });
  aE.push([]);
  aE.push(['TOTAL', '', '', '', '', '', '', nE + ' pagan · ' + nNo + ' no', '', '', _xlsNum(totE), '']);
  XLSX.utils.book_append_sheet(wb, _xlsHoja(aE,
    [26, 12, 20, 24, 26, 22, 22, 12, 30, 18, 14, 62]), 'Envíos');

  // ── Imputaciones ───────────────────────────────────────────────────────
  if (conImputaciones) {
    const aI = [
      [titulo + ' · lo que movió el neto (los descuentos, en negativo)'],
      ['CONDUCTOR', 'CONCEPTO', 'FECHA', 'DETALLE', 'MONTO']
    ];
    let totI = 0, nI = 0;
    const push = (cond, concepto, fecha, det, monto) => {
      nI++; totI += monto;
      aI.push([cond, concepto, _xlsFecha(fecha), det, _xlsNum(monto)]);
    };
    datos.forEach(x => {
      x.imp.km.detalle.forEach(k => push(x.cond, 'Km de desvío', k.fecha,
        k.km + ' km' + (k.obs ? ' · ' + k.obs : ''), _num(k.monto)));
      x.imp.especial.detalle.forEach(e => push(x.cond, 'Recorrido especial', e.fecha,
        'ruta pactada en ' + fmtPeso(e.valor_ruta) + ' · el día ya paga ' + fmtPeso(e.base) +
        (e.detalle ? ' · ' + e.detalle : ''), _num(e.monto)));
      x.imp.combustible.detalle.forEach(i => push(x.cond, 'Combustible', i.fecha,
        [i.referencia, i.detalleTxt].filter(Boolean).join(' · '), -_num(i.monto)));
      x.imp.proveedores.detalle.forEach(i => push(x.cond, 'Servicio de proveedores', i.fecha,
        [i.referencia, i.detalleTxt].filter(Boolean).join(' · '), -_num(i.monto)));
      x.imp.extraviados.detalle.forEach(i => push(x.cond, 'Extraviado / roto', i.fecha,
        [i.referencia, i.detalleTxt].filter(Boolean).join(' · '), -_num(i.monto)));
      x.imp.adelanto.detalle.forEach(c => push(x.cond, 'Cuota de adelanto', '',
        'cuota ' + c.nro + (c.total ? '/' + c.total : '') +
        (c.moneda && c.moneda !== 'ARS' ? ' · ' + c.moneda + ' ' + c.origen + ' a ' + fmtPeso(c.tc) : ''),
        -_num(c.monto)));
      x.imp.extravio.detalle.forEach(c => push(x.cond, 'Cuota de extravío / proveedor', '',
        'cuota ' + c.nro + (c.total ? '/' + c.total : '') + (c.ref ? ' · ' + c.ref : ''), -_num(c.monto)));
    });
    if (!nI) aI.push(['', 'Sin imputaciones en el período', '', '', 0]);
    aI.push([]);
    aI.push(['TOTAL', '', '', 'efecto neto sobre el bruto', _xlsNum(totI)]);
    XLSX.utils.book_append_sheet(wb, _xlsHoja(aI, [26, 30, 12, 62, 15]), 'Imputaciones');
  }

  return wb;
}

// Varios conductores en UN archivo, por el mismo motivo que del lado del
// cliente: el PDF va suelto porque se entrega, el Excel se abre para cruzar.
function exportLiqConductoresExcel(conductores, liq) {
  if (!_xlsListo()) return;
  if (!conductores || !conductores.length) { alert('No hay liquidaciones para exportar.'); return; }
  const base = liq || calcLiquidacionesFiltradas();
  // Cada conductor con SU semana (la de su condición): liquidar a todos de
  // viernes a jueves le mete a un suplente los envíos de otra semana.
  const datos = conductores.map(c => _xlsConductorDatos(c,
    base[c] || { total: 0, filas: [], filas_excluidas: [] }, liqRangoImputDe(c)));
  const bruto = datos.reduce((s, x) => s + _num(x.bruto), 0);
  const neto = datos.reduce((s, x) => s + _num(x.neto), 0);
  const uno = datos.length === 1;
  const titulo = (uno ? 'Liquidación de ' + datos[0].cond
    : 'Liquidación de conductores · ' + datos.length + ' conductor(es)') +
    ' · ' + (uno ? 'Del ' + datos[0].rango.desde + ' al ' + datos[0].rango.hasta
      : 'cada uno con SU semana según su condición') +
    ' · bruto ' + fmtPeso(bruto) + ' · neto ' + fmtPeso(neto) +
    ' · ' + XLS_NOTA + ' · generado el ' + new Date().toLocaleString('es-AR');
  _xlsBajar(_xlsConductorLibro(datos, titulo, true),
    uno ? 'Liquidacion_' + _xlsNombreArchivo(datos[0].cond) + '_' + datos[0].rango.hasta.replace(/\//g, '-') + '.xlsx'
      : 'Liquidaciones_conductores_' + datos.length + '_' + _xlsHoy() + '.xlsx',
    datos.length + ' liquidación(es) de conductor en un Excel');
}

// Handler del panel Liquidación de Conductores. Misma selección que el PDF
// (seleccionParaDescargar): lo tildado dentro del filtro y solo lo armado.
function descargarLiqConductoresExcel() {
  const liq = calcLiquidacionesFiltradas();
  const sel = seleccionParaDescargar(liq);
  if (!sel.conductores.length) {
    alert('No hay liquidaciones marcadas como listas.\n\n' +
      'Para revisar una antes de cerrarla, bajá el Excel de control desde Detalle de conductores: ' +
      'ahí no hace falta marcarla como lista.');
    return;
  }
  exportLiqConductoresExcel(sel.conductores, liq);
}

// Handler de Detalle de conductores: el conductor y el período que están en
// pantalla, SIN marcar nada. Exporta el período completo y no lo que el
// buscador deja a la vista, por lo mismo que del lado del cliente.
//
// Las imputaciones solo entran si hay un período puesto: con "Todas las fechas"
// los envíos son de todo lo cargado y los descuentos de una semana, y un neto
// que mezcla dos períodos es peor que no mostrar ninguno.
function condDescargarExcel() {
  if (!_xlsListo()) return;
  const cond = document.getElementById('cond-select')?.value || '';
  if (!cond) { alert('Elegí un conductor primero.'); return; }
  const dISO = document.getElementById('cond-fecha-desde')?.value || '';
  const hISO = document.getElementById('cond-fecha-hasta')?.value || '';
  const idxs = indicesConductorFiltrados(cond);
  if (!idxs.length) { alert('Este conductor no tiene recorridos en el período elegido.'); return; }

  // Se calcula con la MISMA cuenta que paga, sobre los envíos que el panel está
  // mostrando: calcLiquidacionesFiltradas recibe los registros del período en
  // vez de los de la semana del panel de Liquidaciones.
  const recs = idxs.map(i => AppData.records[i]);
  const base = calcLiquidacionesFiltradas(recs);
  const key = normNombre(cond);
  const cl = Object.keys(base).find(k => normNombre(k) === key);
  const d = base[cl] || { total: 0, filas: [], filas_excluidas: [] };

  const fmtD = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const conPeriodo = !!(dISO && hISO);
  const rango = conPeriodo ? { desde: fmtD(dISO), hasta: fmtD(hISO) } : null;
  const datos = [_xlsConductorDatos(cl || cond, d, rango)];
  const titulo = 'Liquidación de ' + (cl || cond) + ' · ' +
    (conPeriodo ? 'Del ' + rango.desde + ' al ' + rango.hasta
      : 'TODOS los recorridos cargados (sin período elegido no se calculan las imputaciones ni el neto)') +
    ' · ' + d.filas.length + ' envío(s) que pagan · bruto ' + fmtPeso(datos[0].bruto) +
    (datos[0].armada ? ' · semana marcada como lista' : ' · borrador de control') +
    ' · ' + XLS_NOTA + ' · generado el ' + new Date().toLocaleString('es-AR');
  _xlsBajar(_xlsConductorLibro(datos, titulo, conPeriodo),
    'Liquidacion_' + _xlsNombreArchivo(cl || cond) + '_' +
    (conPeriodo ? rango.hasta.replace(/\//g, '-') : _xlsHoy()) + '.xlsx',
    'Excel de ' + (cl || cond) + ' descargado · ' + d.filas.length + ' envío(s)');
}
