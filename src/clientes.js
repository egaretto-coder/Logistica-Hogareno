// ════════════════════════════════════════════════════════════════════════
//  CLIENTES — facturación por cliente.
//  Cada cliente tiene un tarifario de VENTA por zona (lo que se le cobra por
//  envío entregado). La liquidación es semanal Viernes→Jueves (el jueves es el
//  corte). Se descarga en PDF.
//
//  IDENTIDAD = el CÓDIGO de cliente (registros.cliente_cod, columna
//  "Cod.Cliente" del listado). Viene en todas las filas y es único. El nombre
//  de fantasía (registros.cliente) es solo para mostrar: trae variantes
//  ("Bluemail" / "BLUEMAIL") que, usadas como clave, partirían al cliente en
//  dos — el mismo problema que resolvimos con los alias de conductores.
// ════════════════════════════════════════════════════════════════════════

let clienteEditId = null;

// ── Identidad ───────────────────────────────────────────────────────────────
function normCliente(s) { return normNombre(s); }

function clienteKey(cod) { return String(cod || '').trim().toUpperCase(); }

// ── Cuentas de un mismo cliente ─────────────────────────────────────────────
// Un cliente real puede operar con VARIAS cuentas, cada una con su Cod.Cliente:
// LA FERRETERIA factura como FERR y FERR2, PUNTO HERRAMIENTAS como PH1/PH2/PH3,
// y el mismo nombre puede tener dos códigos (BLUEMAIL = BLUE y BLM). Es el mismo
// cliente y la misma lista de precios. Sin unificarlos habría que cargar el
// tarifario una vez por cuenta y la facturación saldría partida en pedazos.
// El índice se cachea porque esto se resuelve una vez por ENVÍO (decenas de
// miles) en cada render.
let _idxCuentas = null;
function invalidarIndiceCuentas() { _idxCuentas = null; }
function _indiceCuentas() {
  if (_idxCuentas) return _idxCuentas;
  _idxCuentas = new Map();
  (AppData.clienteCuentas || []).forEach(c => {
    const a = clienteKey(c.alias_cod), canon = clienteKey(c.cliente_cod);
    if (a && canon && a !== canon) _idxCuentas.set(a, canon);
  });
  return _idxCuentas;
}
// Código canónico de una cuenta (o el mismo, si no es alias de nadie).
function clienteCodCanonico(cod) {
  const k = clienteKey(cod);
  return _indiceCuentas().get(k) || k;
}
// Cuentas secundarias de un cliente.
function cuentasDeCliente(cod) {
  const k = clienteKey(cod);
  return (AppData.clienteCuentas || []).filter(c => clienteKey(c.cliente_cod) === k)
    .map(c => clienteKey(c.alias_cod));
}

// Código de un registro, YA unificado: todas las cuentas del mismo cliente
// caen en su código canónico, así el tarifario, la liquidación, las cards y el
// detalle ven un solo cliente.
function clienteCodDeRegistro(r) {
  return clienteCodCanonico((r && r.cliente_cod) || '');
}

// Nombre para mostrar de un código: el del maestro si está cargado, si no el
// último nombre de fantasía visto en los envíos.
function clienteNombreDe(cod) {
  const k = clienteKey(cod);
  if (!k) return '(sin cliente)';
  const c = (AppData.clientes || []).find(x => clienteKey(x.codigo) === k);
  if (c && c.nombre) return c.nombre;
  const r = (AppData.records || []).find(x => clienteCodDeRegistro(x) === k && String(x.cliente || '').trim());
  return r ? String(r.cliente).trim() : k;
}

// Códigos de cliente presentes en los envíos (con su nombre y cuántos envíos).
function clientesDeRegistros(rango) {
  const m = new Map();
  (AppData.records || []).forEach(r => {
    const k = clienteCodDeRegistro(r);
    if (!k || !esClienteValido(k)) return;
    if (rango && (rango.desdeD || rango.hastaD)) {
      const f = parseFechaReg(r.fecha);
      if (!f) return;
      if (rango.desdeD && f < rango.desdeD) return;
      if (rango.hastaD && f > rango.hastaD) return;
    }
    let x = m.get(k);
    if (!x) { x = { cod: k, nombre: String(r.cliente || '').trim() || k, envios: 0 }; m.set(k, x); }
    x.envios++;
    if (!x.nombre && r.cliente) x.nombre = String(r.cliente).trim();
  });
  return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Fecha desde la que rige la tarifa "original": es anterior a cualquier envío
// del sistema, así que una tarifa sin vigencia cargada aplica a todo.
const TARIFA_DESDE_SIEMPRE = '2000-01-01';
function tarifaVigenteDesde(t) {
  const v = String((t && t.vigente_desde) || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : TARIFA_DESDE_SIEMPRE;
}

// Índice del tarifario de VENTA. Se resuelve una vez por ENVÍO y el tarifario
// real tiene 5.445 filas, así que el find lineal costaba 0,2 ms por llamada:
// con 47.684 envíos eran ~10 s por render del Dashboard, con la pantalla
// congelada. Mismo patrón que _tarifaIndex de getPrecio.
// Clave: código de cliente -> Map(zonaNorm -> [{desde, precio}] ordenado por
// fecha). Las filas SIN código se indexan aparte por nombre, que es como las
// matcheaba el find original.
let _idxCliTarifas = null;
function invalidarIndiceCliTarifas() { _idxCliTarifas = null; }
function _cliTarifaIndex() {
  // El índice se invalida explícitamente al re-hidratar y al guardar, pero varias
  // pantallas también mutan AppData.clienteTarifas en memoria. Un índice viejo no
  // da error: da un PRECIO equivocado, que es mucho peor. Por eso además se
  // verifica que siga siendo el mismo array y con la misma cantidad de filas.
  const arr = AppData.clienteTarifas || [];
  if (_idxCliTarifas && (_idxCliTarifas.src !== arr || _idxCliTarifas.n !== arr.length)) _idxCliTarifas = null;
  if (_idxCliTarifas) return _idxCliTarifas;
  const porCod = new Map(), porNombre = new Map();
  arr.forEach(x => {
    // OJO: la zona GUARDADA no se canoniza, igual que el find original — lo
    // persistido ya queda canónico al guardar (guardarClienteTarifas) y canonizar
    // de nuevo acá cambiaría el matcheo de las filas viejas.
    const z = normNombre(x.zona);
    const destino = x.cliente_cod ? porCod : porNombre;
    const k = x.cliente_cod ? clienteKey(x.cliente_cod) : normCliente(x.cliente);
    if (!k) return;
    let zm = destino.get(k); if (!zm) { zm = new Map(); destino.set(k, zm); }
    let lista = zm.get(z); if (!lista) { lista = []; zm.set(z, lista); }
    lista.push({ desde: tarifaVigenteDesde(x), precio: _num(x.precio) });
  });
  // Cada zona queda con sus precios ordenados por fecha de vigencia, para poder
  // contestar "cuánto valía ESTE envío el día que se entregó".
  [porCod, porNombre].forEach(m => m.forEach(zm => zm.forEach(lista => {
    lista.sort((a, b) => a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0);
  })));
  _idxCliTarifas = { porCod, porNombre, src: arr, n: arr.length };
  return _idxCliTarifas;
}

// El precio vigente a una fecha: el último que empezó a regir en o antes de ese
// día. Sin fecha se toma el de hoy, que es lo que corresponde para las
// previsualizaciones (el selector de zona, la ficha del cliente).
function _precioVigente(lista, fechaISO) {
  if (!lista || !lista.length) return undefined;
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(fechaISO || '')) ? fechaISO : _hoyISO();
  let out;
  for (const x of lista) { if (x.desde <= f) out = x.precio; else break; }
  // Todas las vigencias empiezan DESPUÉS de esa fecha: ese día no había precio
  // acordado. Devolver el más nuevo sería facturar hacia atrás con una lista que
  // todavía no existía, que es justo lo que se vino a arreglar.
  return out;
}
function _hoyISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

// Tarifa de venta de un cliente (por CÓDIGO) para una zona, al día del envío.
// 0 = sin cargar.
function clienteTarifaEnZona(cod, zona, fechaISO) {
  // Misma resolución que getPrecio: la zona del envío pasa por el alias antes de
  // buscar la tarifa de venta. Las zonas del tarifario son las mismas de los dos
  // lados y tienen que resolverse igual.
  const k = clienteKey(cod), z = normNombre(typeof zonaCanonica === 'function' ? zonaCanonica(zona) : zona);
  const idx = _cliTarifaIndex();
  const porCod = idx.porCod.get(k);
  if (porCod) { const p = _precioVigente(porCod.get(z), fechaISO); if (p !== undefined) return p; }
  const porNombre = idx.porNombre.get(normCliente(k));
  if (porNombre) { const p = _precioVigente(porNombre.get(z), fechaISO); if (p !== undefined) return p; }
  return 0;
}

// Lo que se le FACTURA al cliente por un envío. Es el único punto que decide
// ese precio, para que la card, el detalle, la liquidación y el PDF no puedan
// discrepar.
//
// Si el envío tiene una DIMENSIÓN ESPECIAL asignada, manda el precio del
// catálogo para esa dimensión en esa zona: la dimensión es justamente un
// acuerdo que reemplaza la tarifa de la zona (un colchón king no se cobra como
// un paquete). Antes solo pisaba lo que se le pagaba al conductor, así que el
// cliente seguía facturándose por la tarifa común.
function precioVentaEnvio(cod, r) {
  // Gesto comercial: se anuló para este cliente. No se le factura — pero al
  // conductor se le paga igual, así que precioPagadoConductor NO mira esto.
  if (envioAnuladoCliente(r)) return 0;
  const zona = (r && r.zona && r.zona.trim()) ? r.zona.trim() : ((r && r.localidad) || '').trim();
  const p = dimPrecioVenta(cod, r, zona);
  if (p != null) return p;
  // La tarifa que se aplica es la VIGENTE EL DÍA DEL ENVÍO, no la última cargada:
  // una lista de precios nueva rige de ahí en adelante y no puede reescribir lo
  // que ya se facturó en semanas que ya se cerraron.
  return clienteTarifaEnZona(cod, zona, (typeof fechaISOde === 'function' ? fechaISOde(r && r.fecha) : null));
}

// ¿Este envío está anulado como gesto con el cliente?
function envioAnuladoCliente(r) { return !!(r && r.anulado_cliente); }

// Lo que se le habría facturado si no estuviera anulado. Es el valor del gesto:
// va en la liquidación para que el cliente VEA cuánto se le descontó.
function precioSinAnular(cod, r) {
  if (!r) return 0;
  const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : ((r.localidad) || '').trim();
  const p = dimPrecioVenta(cod, r, zona);
  return p != null ? p : clienteTarifaEnZona(cod, zona);
}

// Precio de venta de la dimensión asignada, del tarifario de CLIENTES (no del
// de conductores: lo que se le paga al cadete por llevar un colchón no es lo
// que se le cobra al cliente por mandarlo). null = no hay precio cargado, y
// entonces se cae a la tarifa de la zona en vez de facturar $0.
function dimPrecioVenta(cod, r, zona) {
  if (!r || !r.dim_especial) return null;
  const z = zona || ((r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim());
  // El acuerdo es del cliente del envío; dim_cliente es con el que se cargó.
  const candidatos = [r.dim_cliente, clienteNombreDe(cod), cod, r.cliente];
  for (const c of candidatos) {
    if (!c) continue;
    const p = dimPrecioEnZona(c, r.dim_especial, z, 'cliente');
    if (p != null && _num(p) > 0) return _num(p);
  }
  return null;
}

// Nombre de la dimensión que efectivamente se le factura (para discriminarla en
// la liquidación). Vacío si no tiene precio de venta cargado.
function dimVentaNombre(cod, r) {
  return dimPrecioVenta(cod, r) != null ? String(r.dim_especial || '') : '';
}

// Lo que se le PAGA al conductor por ese envío (para el margen).
function precioPagadoConductor(r) {
  if (typeof precioManualDe === 'function') {
    const m = precioManualDe(r);
    if (m !== null && m !== undefined) return _num(m);
  }
  if (typeof precioAutoDe === 'function') return _num(precioAutoDe(r).precio);
  return 0;
}

// La semana de facturación va del VIERNES (día 1) al JUEVES siguiente, que es
// el corte. Al elegir cualquier día, el campo se corre al viernes de esa
// semana: así el control muestra la pauta en vez de la fecha suelta que se
// tocó, y no hay que deducir a qué semana pertenece un martes.
// Son los 7 días de calendario, DOMINGO INCLUIDO: pasa poco, pero a veces un
// conductor trabaja el domingo y esas entregas se liquidan como cualquier otra.
function snapSemanaCliente(inputId) {
  const el = document.getElementById(inputId);
  if (!el || !el.value) return;
  const r = semanaClienteRango(el.value);
  const v = r.desdeD;
  el.value = v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
}

// Semana de facturación Viernes→Jueves que CONTIENE la fecha dada (ISO o Date).
function semanaClienteRango(iso) {
  const d = iso ? new Date(iso + 'T12:00:00') : new Date();
  const desdeViernes = (d.getDay() - 5 + 7) % 7;      // días transcurridos desde el viernes
  const vie = new Date(d); vie.setDate(d.getDate() - desdeViernes); vie.setHours(0, 0, 0, 0);
  const jue = new Date(vie); jue.setDate(vie.getDate() + 6); jue.setHours(23, 59, 59, 999);
  const fmt = x => String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear();
  return { desde: fmt(vie), hasta: fmt(jue), desdeD: vie, hastaD: jue };
}

// Liquidación de un cliente en un rango { desdeD, hastaD }: envíos ENTREGADOS
// agrupados por zona × tarifa de venta de esa zona.
// opts.detalle = true junta además el detalle envío por envío (tracking,
// destinatario, fecha) para el PDF que se le manda al cliente. Va detrás de una
// opción porque el dashboard y el panel llaman a esta función una vez POR
// CLIENTE en cada render y no necesitan las 400 filas de cada uno.
function calcLiquidacionCliente(cliente, rango, opts) {
  const cKey = clienteKey(cliente);
  const conDetalle = !!(opts && opts.detalle);
  const envios = [];
  const desde = rango && rango.desdeD ? rango.desdeD : null;
  const hasta = rango && rango.hastaD ? rango.hastaD : null;
  const semana = viernesDeRango(rango);   // clave de la semana que se está facturando
  const porZona = {};
  let totalEnvios = 0, total = 0, sinTarifa = 0, arrastrados = 0;
  // Condición especial asignada al envío que NO tiene precio de venta cargado:
  // se factura con la tarifa común de la zona. NO es "sin tarifa" —factura más
  // de $0— así que ningún control lo contaba y el panel del cliente daba todo
  // en verde mientras el acuerdo no se estaba aplicando (bug real: BS FIT
  // mostraba "0 en zonas sin tarifa" y facturaba $7.641 un envío pactado en
  // $18.000, pagándole $9.000 al conductor).
  let dimSinVenta = 0, dimSinVentaMonto = 0, dimSinVentaPagado = 0;
  // De dónde salen los envíos a recorrer. Por defecto, todos: es la única forma
  // segura, porque un cliente_cod se puede corregir en memoria y un índice
  // global cacheado facturaría el envío al cliente equivocado.
  // Quien necesita llamar esto para MUCHOS clientes seguidos (el Dashboard, que
  // lo hacía 121 veces sobre 47.684 envíos = 5,8 millones de vueltas por render)
  // agrupa una sola vez y le pasa a cada cliente su propia lista.
  const _fuente = (opts && opts.registros) ? opts.registros : AppData.records;
  _fuente.forEach(r => {
    if (!cKey || clienteCodDeRegistro(r) !== cKey) return;
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    if (!contabilizaRegistro(r)) return;   // la visita fallida también se le factura al cliente
    // Semana en la que se COBRA. Un envío arrastrado (factura_semana seteada)
    // se cobra en la semana que indica ese campo y NO en la de su fecha: si no
    // se lo sacara de su semana original se facturaría dos veces.
    const arr = String(r.factura_semana || '').slice(0, 10);
    if (arr) {
      if (!semana || arr !== semana) return;
      arrastrados++;
    } else if (desde || hasta) {
      const f = parseFechaReg(r.fecha); if (!f) return;
      if (desde && f < desde) return; if (hasta && f > hasta) return;
    }
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim() || '(sin zona)';
    // ANULADO: va en su PROPIA línea, en $0 y con lo que se bonificó. No se
    // esconde ni se saca de la liquidación — el punto del gesto es que el
    // cliente lo vea descontado.
    if (envioAnuladoCliente(r)) {
      const bonif = precioSinAnular(cKey, r);
      const etq = zona + ' · ANULADO';
      if (!porZona[etq]) porZona[etq] = { zona: etq, count: 0, precio: 0, subtotal: 0, pagado: 0, anulado: true, bonificado: 0 };
      porZona[etq].count++;
      porZona[etq].bonificado += bonif;
      porZona[etq].pagado += precioPagadoConductor(r);   // al conductor se le paga igual
      totalEnvios++;
      if (conDetalle) envios.push({
        fecha: r.fecha || '', tracking: r.tracking || '', destinatario: r.destinatario || '',
        zona: zona, dim: '', precio: 0, bonificado: bonif, anulado: true,
        arrastrado: !!arr, visita: !!r.contabiliza_manual
      });
      return;
    }
    // El precio es POR ENVÍO, no por zona: una dimensión especial asignada pisa
    // la tarifa de la zona (un colchón king no se cobra como un paquete). Cada
    // dimensión va en SU PROPIA LÍNEA: en la factura el cliente tiene que ver
    // el acuerdo especial discriminado, no diluido en un promedio de la zona.
    const p = precioVentaEnvio(cKey, r);
    const nombreDim = dimVentaNombre(cKey, r);
    const etiqueta = nombreDim ? (zona + ' · ' + nombreDim) : zona;
    if (!porZona[etiqueta]) porZona[etiqueta] = { zona: etiqueta, count: 0, precio: p, subtotal: 0, pagado: 0, dim: !!nombreDim };
    const pagadoR = precioPagadoConductor(r);
    porZona[etiqueta].pagado += pagadoR;   // para el margen
    porZona[etiqueta].count++;
    porZona[etiqueta].subtotal += p;
    if (p <= 0) sinTarifa++;
    // Tiene condición asignada y no se le está aplicando: se cobra la zona.
    const dimHuerfana = !!String(r.dim_especial || '').trim() && !nombreDim;
    if (dimHuerfana) { dimSinVenta++; dimSinVentaMonto += p; dimSinVentaPagado += pagadoR; }
    totalEnvios++; total += p;
    if (conDetalle) envios.push({
      fecha: r.fecha || '', tracking: r.tracking || '', destinatario: r.destinatario || '',
      zona: zona, dim: nombreDim || '', precio: p, bonificado: 0, anulado: false,
      dimSinVenta: dimHuerfana, dimAsignada: String(r.dim_especial || '').trim(),
      arrastrado: !!arr, visita: !!r.contabiliza_manual
    });
  });
  const filas = Object.values(porZona).sort((a, b) => b.subtotal - a.subtotal);
  const pagado = filas.reduce((s, f) => s + _num(f.pagado), 0);
  // Cargos que no vienen de un envío: colecta, viajes particulares, otros.
  // Van aparte de las zonas porque en la factura son otro concepto.
  const cargos = cargosDeSemana(cKey, semana);
  const totalCargos = cargos.reduce((s, c) => s + _num(c.monto), 0);
  // Margen = lo que se le cobra al cliente menos lo que se le paga al conductor
  // por esos mismos envíos. Es el número que conecta las dos liquidaciones.
  const anulados = filas.filter(f => f.anulado);
  return {
    filas, envios, totalEnvios, total: total + totalCargos, totalEnvio: total,
    sinTarifa, pagado, margen: (total + totalCargos) - pagado,
    dimSinVenta, dimSinVentaMonto, dimSinVentaPagado,
    arrastrados, cargos, totalCargos, semana,
    // Gestos comerciales de la semana: cuántos y cuánto se bonificó.
    anulados: anulados.reduce((s, f) => s + f.count, 0),
    bonificado: anulados.reduce((s, f) => s + _num(f.bonificado), 0)
  };
}

// Las tarifas de un cliente con UNA sola fila por zona: la vigente a esa fecha.
// Desde que las listas tienen vigencia, el mismo cliente y la misma zona tienen
// varios precios —uno por aumento— y todo lo que MUESTRA o EXPORTA el tarifario
// tiene que quedarse con el que corresponde. Si no, la ficha diría "90 zonas"
// donde hay 45 y la descarga saldría con cada zona repetida.
function tarifasVigentesDe(cod, fechaISO) {
  const k = clienteKey(cod);
  const f = fechaISO || _hoyISO();
  const porZona = new Map();
  (AppData.clienteTarifas || []).forEach(t => {
    const mio = clienteKey(t.cliente_cod) === k ||
      (!t.cliente_cod && normCliente(t.cliente) === normCliente(k));
    if (!mio) return;
    const d = tarifaVigenteDesde(t);
    if (d > f) return;                       // esa lista todavía no empezó a regir
    const prev = porZona.get(normNombre(t.zona));
    if (!prev || tarifaVigenteDesde(prev) <= d) porZona.set(normNombre(t.zona), t);
  });
  return Array.from(porZona.values());
}

// Desde cuándo rige la lista de precios que se le está aplicando al cliente, y
// si hay otra ya cargada esperando su fecha. Se muestra en la card porque es la
// pregunta que se hace el que factura —"¿este cliente tiene el aumento puesto?"—
// y hasta ahora había que abrir el tarifario para saberlo.
function ultimaListaPrecios(cod) {
  const hoy = _hoyISO();
  const k = clienteKey(cod);
  let rige = null, proxima = null;
  (AppData.clienteTarifas || []).forEach(t => {
    const mio = clienteKey(t.cliente_cod) === k ||
      (!t.cliente_cod && normCliente(t.cliente) === normCliente(k));
    if (!mio) return;
    const d = tarifaVigenteDesde(t);
    if (d <= hoy) { if (!rige || d > rige) rige = d; }
    else if (!proxima || d < proxima) proxima = d;
  });
  return {
    desde: rige,
    // El centinela quiere decir que nunca se le cargó un aumento: es la lista con
    // la que se dio de alta. Mostrar "01/01/2000" no le diría nada a nadie.
    original: rige === TARIFA_DESDE_SIEMPRE,
    proxima: proxima
  };
}

// Texto corto para la card: desde cuándo rige la lista que se está aplicando.
function ultimaListaPreciosTxt(cod) {
  const u = ultimaListaPrecios(cod);
  if (!u.desde) return { txt: '—', sub: '' };
  const txt = u.original ? 'original' : _precFmt(u.desde);
  const sub = u.proxima ? 'nueva desde el ' + _precFmt(u.proxima) : '';
  return { txt, sub, original: u.original };
}

// Cantidad de zonas con tarifa cargada de un cliente (las que rigen hoy).
function clienteNZonas(cod) {
  return tarifasVigentesDe(cod).filter(t => _num(t.precio) > 0).length;
}

// ── Persistencia ────────────────────────────────────────────────────────────
function persistirClientesLocal() {
  try {
    localStorage.setItem('liq_clientes', JSON.stringify(AppData.clientes));
    localStorage.setItem('liq_cliente_tarifas', JSON.stringify(AppData.clienteTarifas));
  } catch (e) {}
}

// ── Solapas ────────────────────────────────────────────────────────────────
// El panel es la BASE DE DATOS de clientes: ficha, cuentas vinculadas y
// tarifario. La liquidación se arma en "Detalle de cliente" y se descarga desde
// "Liquidación de clientes", que ahora son pantallas propias.
// Se conserva el nombre de la función porque el router la llama.
function switchClientesTab() { renderClientes(); }

// ── Render lista de clientes ────────────────────────────────────────────────
// Ficha de cada cliente: identificación, contacto y cómo viene facturando.
// El administrativo necesita cotejar sin salir del panel: con quién hablar, con
// qué razón social se factura y —sobre todo— si hay zonas SIN TARIFA, que se
// facturan en $0 y se comen el margen sin avisar.
// Solapas del panel. La de bajas es una vista aparte y no un filtro de la
// grilla: son dos preguntas distintas —"quién opera" y "quién se fue"— y
// mezclarlas obliga a leer 121 tarjetas para encontrar 3.
let cliTab = 'activos';
function switchClientesTab(t) {
  // Cualquier valor que no sea "bajas" es la lista de clientes. El router la
  // llamaba con 'lista' —el nombre de cuando había una sola solapa— y con una
  // comparación estricta contra 'activos' eso escondía LAS DOS: el panel entero
  // quedaba en blanco al entrar (bug real).
  const esBajas = t === 'bajas';
  cliTab = esBajas ? 'bajas' : 'activos';
  const lista = document.getElementById('cli-tab-lista');
  const bajas = document.getElementById('cli-tab-bajas');
  if (lista) lista.style.display = esBajas ? 'none' : '';
  if (bajas) bajas.style.display = esBajas ? '' : 'none';
  const bA = document.getElementById('cli-btn-activos'), bB = document.getElementById('cli-btn-bajas');
  if (bA) bA.classList.toggle('active', !esBajas);
  if (bB) bB.classList.toggle('active', esBajas);
  if (esBajas) renderClientesBajas(); else renderClientes();
}

function clientesDadosDeBaja() {
  return (AppData.clientes || []).filter(c => c.activo === false)
    .sort((a, b) => String(b.fecha_baja || '').localeCompare(String(a.fecha_baja || '')) ||
                    String(a.nombre).localeCompare(String(b.nombre)));
}

function renderClientesBajas() {
  const cont = document.getElementById('cli-bajas-rows');
  if (!cont) return;
  const q = (document.getElementById('cli-bajas-search')?.value || '').toLowerCase().trim();
  const todos = clientesDadosDeBaja();
  const lista = todos.filter(c => !q || String(c.nombre).toLowerCase().includes(q) ||
    String(c.codigo || '').toLowerCase().includes(q) || String(c.motivo_baja || '').toLowerCase().includes(q));

  const info = document.getElementById('cli-bajas-info');
  if (info) info.textContent = q ? lista.length + ' de ' + todos.length : todos.length + ' cliente(s) de baja';

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:26px"><div class="empty-icon"><i class="ic ic-check-circle"></i></div>' +
      '<div class="empty-title">' + (q ? 'Ningún cliente con esa búsqueda' : 'No hay clientes de baja') + '</div>' +
      '<div class="empty-sub">' + (q ? 'Probá con otro nombre o motivo.' : 'Los que des de baja desde su ficha aparecen acá.') + '</div></div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(c => {
    const k = clienteKey(c.codigo);
    // Lo que quedó sin liquidar es la plata que se pierde de verdad: a un cliente
    // que ya no opera nadie vuelve a mirarlo.
    const pend = (typeof periodosSinLiquidar === 'function') ? periodosSinLiquidar(k, c.fecha_baja || '') : [];
    const montoPend = pend.reduce((s, p) => s + _num(p.total), 0);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(c.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(c.nombre) + '</div>' +
        '<div><strong>' + c.nombre + '</strong><div class="muted" style="font-size:10px">' + k + '</div></div></div></td>' +
      '<td style="font-size:12px">' + (c.fecha_baja ? cargoFechaTxt(c.fecha_baja) : '<span class="muted">—</span>') + '</td>' +
      '<td style="font-size:12px">' + (c.motivo_baja ? String(c.motivo_baja).replace(/</g, '&lt;') : '<span class="muted">—</span>') + '</td>' +
      '<td class="mono" style="text-align:right">' + (pend.length
        ? '<span style="color:#b45309;font-weight:600" title="' + pend.length + ' período(s) cerrados con envíos y sin liquidación">' + fmtPeso(montoPend) + '</span>' +
          '<div class="muted" style="font-size:10px">' + pend.length + ' período(s)</div>'
        : '<span class="muted">—</span>') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="verCardCliente(' + JSON.stringify(k).replace(/"/g, '&quot;') + ')"><i class="ic ic-file"></i> Ficha</button>' +
        '<button class="btn btn-sm" style="border-color:#86efac;color:#15803d;white-space:nowrap" onclick="reactivarCliente(' + c.id + ')"><i class="ic ic-undo"></i> Reactivar</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function renderClientes() {
  const cont = document.getElementById('cli-cards');
  if (!cont) return;
  // El contador de la solapa se mantiene al día desde acá: es el render que
  // corre en cada cambio del padrón.
  const nBajas = clientesDadosDeBaja().length;
  const bc = document.getElementById('cli-bajas-count');
  if (bc) bc.textContent = nBajas ? ' · ' + nBajas : '';
  const q = (document.getElementById('cli-search')?.value || '').toLowerCase().trim();

  // Semana en curso, para mostrar actividad reciente.
  const rango = semanaClienteRango();
  const conEnvios = clientesDeRegistros(rango);
  const porCod = new Map(conEnvios.map(c => [c.cod, c]));

  const idsPendientes = new Set(clientesPendientesCodigo().map(c => c.id));
  const lista = (AppData.clientes || [])
    .filter(c => !q || String(c.nombre).toLowerCase().includes(q) ||
                 String(c.codigo || '').toLowerCase().includes(q) ||
                 String(c.razon_social || '').toLowerCase().includes(q))
    .filter(c => !cliSoloPendientes || idsPendientes.has(c.id))
    // Los dados de baja viven en su propia solapa: acá estorban.
    .filter(c => c.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  const countEl = document.getElementById('cli-count');
  if (countEl) {
    const sinTarifa = (AppData.clientes || []).filter(c => clienteNZonas(c.codigo) === 0).length;
    countEl.textContent = ((AppData.clientes || []).filter(c => c.activo !== false).length) + ' cliente(s)' +
      (cliSoloPendientes ? ' · mostrando solo los pendientes' : '') +
      (idsPendientes.size ? ' · ' + idsPendientes.size + ' con código pendiente' : '') +
      (sinTarifa ? ' · ' + sinTarifa + ' sin tarifario' : '');
  }

  // Un solo aviso para lo que hay que decidir: los clientes que aparecen en los
  // envíos y no están en el maestro, cada uno con sus dos salidas (vincular como
  // otra cuenta / agregar como nuevo) y el atajo para las que son obviamente
  // cuentas de un mismo cliente.
  const avisoEl = document.getElementById('cli-faltantes');
  if (avisoEl) {
    let html = '';

    // Sin recorridos no se puede resolver ningún código ni detectar cuentas: si
    // no se dijera, el panel parecería estar diciendo "no hay nada que hacer".
    if (!hayEnviosConCodigo()) {
      // Con los números a la vista: sin ellos, "no hay clientes" no distingue
      // entre que no cargaron los envíos, que el listado no traía la columna, o
      // que la sesión quedó con datos viejos.
      const nRec = (AppData.records || []).length;
      html += '<div class="alert alert-info" style="margin:0 0 12px"><i class="ic ic-alert"></i><div>' +
        (AppData._cargandoRegistros
          ? '<strong>Cargando los recorridos…</strong> Los avisos de códigos y de cuentas aparecen cuando terminen.'
          : '<strong>Ninguno de los ' + nRec.toLocaleString('es-AR') + ' envíos en memoria trae cliente.</strong> ' +
            'La identidad del cliente sale de la <strong>columna K</strong> del listado. ' +
            (nRec
              ? 'Si acabás de importar o de cambiar algo, <strong>recargá la página</strong> para traer los datos frescos; ' +
                'si el listado importado no tenía esa columna, hay que reimportarlo.'
              : 'Todavía no hay recorridos cargados.')) +
        '</div></div>';
    }

    // Los que quedan pendientes de código, matcheen por nombre o no.
    const pendientes = clientesPendientesCodigo();
    if (pendientes.length) {
      html += '<div class="alert" style="margin:0 0 12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
        '<i class="ic ic-alert"></i><div><strong>' + pendientes.length + ' de ' + (AppData.clientes || []).length +
        (pendientes.length === 1 ? ' cliente no tiene' : ' clientes no tienen') + ' ningún envío con ese nombre</strong> — su tarifario no se está aplicando. ' +
        'Puede ser que no hayan operado en el período cargado, o que en el listado figuren con otro nombre: ' +
        'en ese caso abrí su ficha (<strong>Card</strong>) y sumale esa cuenta. ' +
        '<button class="btn btn-sm" style="margin-left:6px" onclick="toggleSoloPendientes()">' +
        (cliSoloPendientes ? 'Ver todos' : (pendientes.length === 1 ? 'Ver el pendiente' : 'Ver los ' + pendientes.length + ' pendientes')) + '</button>' +
        '</div></div>';
    }
    // (El aviso de "re-codificar" quedó sin sentido: desde que la identidad es
    //  el nombre, el código de la ficha y el de los envíos son lo mismo.)
    // Los reconocidos en los envíos que no están en el maestro: cada uno con
    // su decisión (vincular como otra cuenta, o agregar como cliente nuevo).
    html += _chipsNuevosClientes();
    avisoEl.innerHTML = html;
  }

  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="ic ic-building"></i></div>' +
      '<div class="empty-title">' + (q ? 'Ningún cliente coincide' : 'Sin clientes') + '</div>' +
      '<div class="empty-sub">' + (q ? 'Probá con otro texto' : 'Agregá uno con "+ Nuevo cliente" o importá el tarifario') + '</div></div>';
    return;
  }

  cont.innerHTML = lista.map(c => {
    const cod = clienteKey(c.codigo);
    const nz = clienteNZonas(cod);
    const act = porCod.get(cod);
    const liq = act ? calcLiquidacionCliente(cod, rango) : null;
    const dato = (etq, val) =>
      '<div><span style="font-size:10px;color:var(--text-muted);display:block">' + etq + '</span>' +
      '<span style="font-size:12px;font-weight:600">' + val + '</span></div>';

    return '<div class="card"' + (c.activo === false ? ' style="opacity:.6;box-shadow:inset 3px 0 0 #b91c1c"' : '') + '>' +
      '<div class="card-body">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
          '<div class="conductor-avatar" style="background:' + avatarColor(c.nombre) + ';width:38px;height:38px;font-size:13px">' + initials(c.nombre) + '</div>' +
          '<div style="min-width:0;flex:1">' +
            '<div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + c.nombre + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' +
              (cod
                ? '<span class="tag" style="font-size:9.5px;' + (idsPendientes.has(c.id)
                    ? 'background:#fff7ed;color:#9a3412;border:1px solid #fdba74" title="Este código no aparece en ningún envío: su tarifario no se aplica"'
                    : 'background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe"') + '>' + cod +
                  (idsPendientes.has(c.id) ? ' ⚠' : '') + '</span> '
                : '<span style="color:#b91c1c">sin código</span> ') +
              // Las otras cuentas del mismo cliente, para que se vea que su
              // tarifario cubre todas y se puedan separar si se unieron mal.
              cuentasDeCliente(cod).map(a =>
                '<span class="tag" style="background:var(--surface-0);color:var(--text-secondary);border:1px dashed var(--border);font-size:9.5px" ' +
                'title="Otra cuenta del mismo cliente — clic para separarla" onclick="separarCuenta(\'' + a + '\')" role="button">+ ' + a + '</span> ').join('') +
              (c.cuit ? 'CUIT ' + c.cuit : '') + '</div>' +
          '</div>' +
        '</div>' +

        (c.razon_social || c.contacto || c.telefono || c.email
          ? '<div style="font-size:11px;color:var(--text-secondary);padding:8px 0;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:2px">' +
            (c.razon_social ? '<div><i class="ic ic-building"></i> ' + c.razon_social + '</div>' : '') +
            (c.contacto ? '<div><i class="ic ic-user"></i> ' + c.contacto + '</div>' : '') +
            (c.telefono ? '<div><i class="ic ic-phone"></i> ' + c.telefono + '</div>' : '') +
            (c.email ? '<div style="overflow:hidden;text-overflow:ellipsis"><i class="ic ic-mail"></i> ' + c.email + '</div>' : '') +
            '</div>'
          : '') +

        '<div style="display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)">' +
          dato('Zonas con tarifa', nz ? nz : '<span style="color:#b45309">ninguna</span>') +
          // Desde cuándo rige la lista que se le está aplicando: es lo primero que
          // se pregunta el que factura cuando entra un aumento.
          dato('Lista de precios', (function(){
            const u = ultimaListaPreciosTxt(cod);
            return (u.original
                ? '<span title="Nunca se le cargó un aumento: rige la lista con la que se dio de alta">original</span>'
                : 'desde ' + u.txt) +
              (u.sub ? '<div style="font-size:10px;font-weight:400;color:#b45309">' + u.sub + '</div>' : '');
          })()) +
          dato('Envíos esta semana', act ? act.envios : '—') +
          (liq ? dato('Se factura', fmtPeso(liq.total)) : '') +

        '</div>' +

        (liq && liq.dimSinVenta
          ? '<div style="font-size:11px;color:#b45309;padding:6px 0"><i class="ic ic-alert"></i> ' + liq.dimSinVenta +
            ' envío(s) con condición especial <strong>sin precio de venta</strong> — se facturan con la tarifa de la zona</div>'
          : '') +
        (liq && liq.sinTarifa
          ? '<div style="font-size:11px;color:#b45309;padding:6px 0"><i class="ic ic-alert"></i> ' + liq.sinTarifa + ' envío(s) en zonas sin tarifa — se facturan en $0</div>'
          : '') +
        (c.obs ? '<div style="font-size:10.5px;color:var(--text-muted);padding:4px 0;font-style:italic">' + c.obs + '</div>' : '') +

        '<div style="display:flex;gap:4px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border)">' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="openTarifasCliente(' + c.id + ')"><i class="ic ic-tag"></i> Tarifas' + (nz ? ' (' + nz + ')' : '') + '</button>' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="verCardCliente(\'' + cod + '\')" title="Ver la ficha completa del cliente"><i class="ic ic-building"></i> Card</button>' +
          '<button class="btn btn-sm" style="margin-left:auto" onclick="editCliente(' + c.id + ')" title="Editar datos"><i class="ic ic-edit"></i></button>' +
          '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c;white-space:nowrap" onclick="darDeBajaCliente(' + c.id + ')" title="El cliente dejó de operar. No se borra nada: sus envíos, tarifas y liquidaciones quedan como están.">Dar de baja</button>' +
        '</div>' +
      '</div></div>';
  }).join('');
}

// ── Ficha completa del cliente ("Card") ─────────────────────────────────────
// Todo lo del cliente en un solo lugar: identificación, contacto, las CUENTAS
// con las que factura, su tarifario y cómo viene la semana. Las cuentas son lo
// que más costaba ver: BOIRATECNO factura con 8 grafías distintas y desde la
// tarjeta chica no había forma de saber cuáles están colgando de él.
function verCardCliente(cod) {
  const k = clienteKey(cod);
  const c = (AppData.clientes || []).find(x => clienteKey(x.codigo) === k);
  if (!c) { showToast('No se encontró el cliente'); return; }
  const rango = periodoClienteRango(k);
  const liq = calcLiquidacionCliente(k, rango);
  const cuentas = cuentasDeCliente(k);
  const nz = clienteNZonas(k);

  // Envíos de la semana por cuenta, para ver cuánto aporta cada una.
  const porCuenta = new Map();
  (AppData.records || []).forEach(r => {
    if (clienteCodDeRegistro(r) !== k) return;
    const f = parseFechaReg(r.fecha);
    if (!f || f < rango.desdeD || f > rango.hastaD) return;
    const cuenta = clienteKey(r.cliente_cod);
    porCuenta.set(cuenta, (porCuenta.get(cuenta) || 0) + 1);
  });

  const dato = (etq, val) => '<div style="min-width:150px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em">' +
    etq + '</div><div style="font-size:13px;font-weight:600">' + (val || '<span class="muted" style="font-weight:400">—</span>') + '</div></div>';

  const chipCuenta = (cta, principal) =>
    '<span class="tag" style="font-size:11px;padding:4px 8px;' +
      (principal ? 'background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe' : 'background:var(--surface-0);color:var(--text-secondary);border:1px dashed var(--border)') + '">' +
      cta + (porCuenta.get(cta) ? ' · ' + porCuenta.get(cta) + ' envíos' : '') +
      (principal ? ' <strong style="font-size:9px;opacity:.75;margin-left:4px">· principal</strong>'
                 : ' <button class="btn btn-sm" style="padding:0 5px;font-size:10px;margin-left:4px" title="Separar esta cuenta" onclick="separarCuenta(\'' + String(cta).replace(/'/g, "\\'") + '\')">✕</button>') +
    '</span>';

  // Identidades de los envíos que todavía no cuelgan de ningún cliente: son las
  // candidatas a sumarse como otra cuenta de este.
  const enMaestro = new Set((AppData.clientes || []).map(x => clienteKey(x.codigo)).filter(Boolean));
  const libres = clientesDeRegistros().filter(x => !enMaestro.has(clienteKey(x.cod)) && clienteKey(x.cod) !== k);

  document.getElementById('modal-title').textContent = 'Ficha · ' + c.nombre;
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">' +
      '<div class="conductor-avatar" style="background:' + avatarColor(c.nombre) + ';width:44px;height:44px;font-size:15px">' + initials(c.nombre) + '</div>' +
      '<div><div style="font-size:16px;font-weight:700">' + c.nombre + '</div>' +
      '<div style="font-size:11px;color:var(--text-muted)">' + k + (c.activo === false ? ' · dado de baja' : '') + '</div></div>' +
    '</div>' +

    _cardPeriodo(k, c) +
    _cardVendedor(c) +
    '<div style="display:flex;flex-wrap:wrap;gap:14px;padding:12px 0;border-top:1px solid var(--border)">' +
      dato('Razón social', c.razon_social) + dato('CUIT', c.cuit) +
      dato('Contacto', c.contacto) + dato('Teléfono', c.telefono) + dato('Email', c.email) +
    '</div>' +

    '<div style="padding:12px 0;border-top:1px solid var(--border)">' +
      '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px">' +
        'Cuentas con las que factura (' + (cuentas.length + 1) + ')</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
        chipCuenta(k, true) + cuentas.map(a => chipCuenta(a, false)).join('') +
      '</div>' +
      (libres.length
        ? '<div style="display:flex;gap:6px;align-items:center;margin-top:10px">' +
            '<select id="card-cuenta-nueva" style="flex:1;max-width:280px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px">' +
              '<option value="">Sumar otra cuenta de este cliente…</option>' +
              libres.map(x => '<option value="' + String(x.cod).replace(/"/g, '&quot;') + '">' + x.nombre + ' · ' + x.envios + ' envíos</option>').join('') +
            '</select>' +
            '<button class="btn btn-sm" onclick="sumarCuentaDesdeCard(\'' + String(k).replace(/'/g, "\\'") + '\')"><i class="ic ic-clip"></i> Vincular</button>' +
          '</div>'
        : '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">No hay cuentas sueltas en los envíos para sumarle.</div>') +
    '</div>' +

    '<div style="display:flex;flex-wrap:wrap;gap:14px;padding:12px 0;border-top:1px solid var(--border)">' +
      dato('Zonas con tarifa', nz ? String(nz) : '<span style="color:#b45309">ninguna</span>') +
      dato('Lista de precios', (function(){
        const u = ultimaListaPreciosTxt(k);
        return (u.original
            ? '<span title="Nunca se le cargó un aumento">original</span>'
            : 'desde ' + u.txt) +
          (u.sub ? '<div style="font-size:11px;font-weight:400;color:#b45309">' + u.sub + '</div>' : '');
      })()) +
      dato('Envíos de la semana', liq.totalEnvios ? String(liq.totalEnvios) : '—') +
      dato('A facturar', fmtPeso(liq.total)) +

    '</div>' +
    (liq.dimSinVenta ? '<div style="font-size:11px;color:#b45309;padding:4px 0"><i class="ic ic-alert"></i> ' + liq.dimSinVenta +
      ' con condición sin precio de venta — se facturan con la tarifa de la zona</div>' : '') +
    (liq.sinTarifa ? '<div style="font-size:11px;color:#b45309;padding:4px 0"><i class="ic ic-alert"></i> ' + liq.sinTarifa +
      ' envío(s) en zonas sin tarifa — se facturan en $0</div>' : '') +
    (c.obs ? '<div style="font-size:12px;color:var(--text-secondary);padding:10px 0;border-top:1px solid var(--border)">📝 ' + c.obs + '</div>' : '') +

    (c.activo === false && (c.fecha_baja || c.motivo_baja)
      ? '<div style="margin-top:10px;padding:9px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fca5a5;font-size:11.5px;color:#991b1b">' +
        '<strong>Dado de baja</strong>' + (c.fecha_baja ? ' el ' + cargoFechaTxt(c.fecha_baja) : '') +
        (c.motivo_baja ? ' · ' + c.motivo_baja : '') + '</div>'
      : '') +
    // Lo que quedó sin facturar. Se muestra siempre que haya algo: en un cliente
    // de baja es lo que hay que cerrar antes de olvidarlo, y en uno activo es un
    // período que se pasó por alto.
    '<div style="padding:12px 0;border-top:1px solid var(--border)">' +
      '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px">Liquidaciones pendientes</div>' +
      _bloqueSinLiquidar(k, c.activo === false ? (c.fecha_baja || '') : '') +
    '</div>' +
    '<div style="display:flex;gap:6px;justify-content:flex-end;padding-top:12px;border-top:1px solid var(--border)">' +
      (c.activo === false
        ? '<button class="btn btn-sm" onclick="reactivarCliente(' + c.id + ')"><i class="ic ic-undo"></i> Reactivar</button>'
        : '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c;margin-right:auto" onclick="darDeBajaCliente(' + c.id + ')">Dar de baja</button>') +
      '<button class="btn btn-sm" style="color:var(--text-muted)" onclick="eliminarCliente(' + c.id + ')" title="Borrar del padrón. Solo sirve para un cliente cargado por error: si tiene envíos o liquidaciones, no se permite."><i class="ic ic-trash"></i></button>' +
      '<button class="btn btn-sm" onclick="openTarifasCliente(' + c.id + ')"><i class="ic ic-tag"></i> Tarifario</button>' +
      '<button class="btn btn-sm" onclick="editCliente(' + c.id + ')"><i class="ic ic-edit"></i> Editar datos</button>' +
    '</div>';
  document.getElementById('modal-backdrop').classList.add('open');
}

// ── Períodos con envíos que quedaron SIN liquidar ──────────────────────────
// Después de una baja es lo que hay que cerrar: la baja no borra nada y esos
// envíos se cobran igual, pero si nadie los mira quedan sin facturar para
// siempre. Se excluye el período en curso, que está abierto por definición.
function periodosSinLiquidar(cod, hastaISO) {
  const k = clienteCodCanonico(clienteKey(cod));
  if (!k) return [];
  const ahora = new Date();
  const porPeriodo = new Map();
  (AppData.records || []).forEach(r => {
    if (clienteCodDeRegistro(r) !== k) return;
    if (!contabilizaRegistro(r)) return;
    const f = parseFechaReg(r.fecha);
    if (!f) return;
    const iso = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
    if (hastaISO && iso > hastaISO) return;
    const rango = periodoClienteRango(k, iso);
    if (!rango || !rango.hastaD || rango.hastaD > ahora) return;   // el período en curso no cuenta
    const key = viernesDeRango(rango);
    if (!porPeriodo.has(key)) porPeriodo.set(key, { rango, envios: 0 });
    porPeriodo.get(key).envios++;
  });
  const out = [];
  porPeriodo.forEach((v, key) => {
    if (typeof liquidacionArmada === 'function' && liquidacionArmada(k, v.rango)) return;
    out.push({ semana: key, rango: v.rango, envios: v.envios, total: _num(calcLiquidacionCliente(k, v.rango).total) });
  });
  return out.sort((a, b) => String(a.semana).localeCompare(String(b.semana)));
}

// Abre Detalle de cliente en ese cliente y ese período, listo para armar.
function liquidarPeriodoCliente(cod, semanaISO) {
  const backs = ['modal-cbaja-backdrop'];
  backs.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const mb = document.getElementById('modal-backdrop'); if (mb) mb.classList.remove('open');
  showPage('detalle-cliente');
  const sel = document.getElementById('dcli-select');
  const fecha = document.getElementById('dcli-semana');
  if (fecha) fecha.value = semanaISO;
  if (sel) {
    sel.value = clienteKey(cod);
    // Un cliente sin envíos en la ventana no está en el select: se agrega.
    if (sel.value !== clienteKey(cod)) {
      sel.insertAdjacentHTML('beforeend', '<option value="' + clienteKey(cod) + '">' + clienteNombreDe(cod) + '</option>');
      sel.value = clienteKey(cod);
    }
  }
  if (typeof renderDetalleCliente === 'function') renderDetalleCliente();
}

// El bloque que lista lo que quedó sin liquidar, con el atajo para cerrarlo.
function _bloqueSinLiquidar(cod, hastaISO, titulo) {
  const pend = periodosSinLiquidar(cod, hastaISO);
  if (!pend.length) {
    return '<div class="muted" style="font-size:11.5px">' +
      (hastaISO ? 'No queda ningún período sin liquidar hasta esa fecha.' : 'No queda ningún período cerrado sin liquidar.') + '</div>';
  }
  const tot = pend.reduce((s, p) => s + p.total, 0);
  const env = pend.reduce((s, p) => s + p.envios, 0);
  const esc = s => String(s).replace(/'/g, "\\'");
  return '<div style="font-size:12px"><strong>' + (titulo || 'Quedan sin liquidar') + ': ' + pend.length +
      ' período(s)</strong> · ' + env + ' envíos · ' + fmtPeso(tot) + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:3px;margin-top:6px;max-height:150px;overflow-y:auto">' +
      pend.map(p => '<div style="display:flex;align-items:center;gap:8px;font-size:11.5px">' +
        '<span style="flex:1">' + p.rango.desde + ' → ' + p.rango.hasta + ' · ' + p.envios + ' envíos</span>' +
        '<span class="mono" style="font-weight:600">' + fmtPeso(p.total) + '</span>' +
        '<button class="btn btn-sm" style="padding:1px 7px;font-size:10px" onclick="liquidarPeriodoCliente(\'' + esc(cod) + '\',\'' + p.semana + '\')">Liquidar</button>' +
      '</div>').join('') +
    '</div>';
}

// ── Baja del cliente (maestro) ─────────────────────────────────────────────
// Es la baja que manda: la carga Comercial, que es quien se entera de que el
// cliente se fue, y **arrastra la de comisiones** — el vendedor deja de
// comisionar por un cliente que ya no está. La baja se puede cargar también
// desde Comisiones, pero esa solo corta la comisión: acá se corta el cliente.
let clienteBajaId = null;

function darDeBajaCliente(id) {
  const c = (AppData.clientes || []).find(x => x.id === id);
  if (!c) return;
  clienteBajaId = id;
  document.getElementById('mcbaja-title').textContent = 'Baja de ' + c.nombre;
  const info = document.getElementById('mcbaja-cliente');
  if (info) info.innerHTML = '<strong style="color:var(--text-primary)">' + c.nombre + '</strong> · ' + clienteKey(c.codigo) +
    (c.razon_social ? ' · ' + c.razon_social : '');
  const hoy = new Date();
  document.getElementById('mcbaja-fecha').value = c.fecha_baja ||
    (hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0'));
  document.getElementById('mcbaja-motivo').value = c.motivo_baja || '';
  recalcBajaCliente();
  document.getElementById('modal-cbaja-backdrop').style.display = 'flex';
}

function cerrarBajaCliente(e) {
  if (!e || e.target.id === 'modal-cbaja-backdrop') {
    document.getElementById('modal-cbaja-backdrop').style.display = 'none';
    clienteBajaId = null;
  }
}

// Adelanta qué pasa con la comisión: es el efecto que no se ve desde acá y el
// que mueve plata de un vendedor.
function recalcBajaCliente() {
  const c = (AppData.clientes || []).find(x => x.id === clienteBajaId);
  const box = document.getElementById('mcbaja-comision');
  if (!c || !box) return;
  _recalcPendientesBaja();
  const f = (document.getElementById('mcbaja-fecha') || {}).value || '';
  const row = (typeof comisionDeCliente === 'function') ? comisionDeCliente(c.nombre) : null;
  if (!row) { box.innerHTML = '<span class="muted">No tiene comisión asignada: la baja no afecta a ningún vendedor.</span>'; return; }
  if (typeof comisionEsBaja === 'function' && comisionEsBaja(row)) {
    box.innerHTML = '<span class="muted">Su comisión ya estaba dada de baja' +
      (row.mes_baja ? ' desde ' + mesLabel(row.mes_baja) : '') + '.</span>';
    return;
  }
  if (!row.bloqueado) {
    box.innerHTML = '<strong>' + row.vendedor + '</strong> lo tenía en evaluación. Se le da de baja la comisión: deja de contar.';
    return;
  }
  const m = (typeof mesBajaDeFecha === 'function') ? mesBajaDeFecha(f) : '';
  if (!m) { box.innerHTML = '<span style="color:#b45309">Elegí la fecha de la baja.</span>'; return; }
  const meses = mesesPagoComision(row);
  const pagos = meses.filter(x => x < m).length;
  const perdidos = meses.length - pagos;
  box.innerHTML = '<div><strong>' + row.vendedor + '</strong> comisiona ' + fmtPeso(_num(row.monto)) + '/mes por este cliente.</div>' +
    '<div style="margin-top:4px">Deja de comisionar desde <strong>' + mesLabel(m) + '</strong>' +
    (perdidos > 0 ? ' · cobra ' + pagos + ' de sus 5 pagos y se pierden ' + perdidos + ' (' + fmtPeso(perdidos * _num(row.monto)) + ').'
                  : ' · ya había cobrado sus 5 pagos.') + '</div>';
}

// Lo que quedó sin facturar hasta la baja. Es la plata que se pierde de verdad
// si nadie la cierra: la baja no la toca, pero después nadie vuelve a mirar a
// un cliente que ya no opera.
function _recalcPendientesBaja() {
  const c = (AppData.clientes || []).find(x => x.id === clienteBajaId);
  const box = document.getElementById('mcbaja-pendientes');
  if (!c || !box) return;
  const f = (document.getElementById('mcbaja-fecha') || {}).value || '';
  box.innerHTML = _bloqueSinLiquidar(c.codigo, f, 'Sin liquidar hasta la baja');
}

async function guardarBajaCliente() {
  const id = clienteBajaId;
  const c = (AppData.clientes || []).find(x => x.id === id);
  if (!c) return;
  const fecha = (document.getElementById('mcbaja-fecha') || {}).value || '';
  const motivo = ((document.getElementById('mcbaja-motivo') || {}).value || '').trim();
  if (!fecha) { alert('Elegí la fecha de la baja.'); return; }
  if (!motivo) { alert('Poné el motivo: un cliente que desaparece del padrón sin explicación no se puede auditar después.'); return; }
  try {
    await DB.updateWhere('clientes', 'id', id, { activo: false, fecha_baja: fecha, motivo_baja: motivo });
    Object.assign(c, { activo: false, fecha_baja: fecha, motivo_baja: motivo });
    persistirClientesLocal();

    // Arrastra la comisión: el vendedor deja de cobrar por un cliente que ya no
    // está. Es el punto de la baja desde acá — si no, habría que acordarse de
    // repetirla en el otro panel y ahí es donde se pierde.
    let aviso = '';
    const row = (typeof comisionDeCliente === 'function') ? comisionDeCliente(c.nombre) : null;
    if (row && !(typeof comisionEsBaja === 'function' && comisionEsBaja(row))) {
      const m = mesBajaDeFecha(fecha);
      const campos = { estado: 'baja', fecha_baja: fecha, mes_baja: m, motivo_baja: motivo };
      try {
        await DB.updateWhere('comision_clientes', 'id', row.id, campos);
        Object.assign(row, campos);
        if (typeof persistirComisionesLocal === 'function') persistirComisionesLocal();
        aviso = ' · ' + row.vendedor + ' deja de comisionar desde ' + mesLabel(m);
      } catch (e) { console.warn('baja de comisión', e); aviso = ' · ⚠ no se pudo dar de baja la comisión'; }
    }
    document.getElementById('modal-cbaja-backdrop').style.display = 'none';
    clienteBajaId = null;
    if (document.getElementById('modal-backdrop')) document.getElementById('modal-backdrop').classList.remove('open');
    renderClientes();
    renderClientesBajas();
    if (typeof renderComisionClientes === 'function' && document.getElementById('com-cli-rows')) renderComisionClientes();
    showToast('✔ ' + c.nombre + ' dado de baja' + aviso);
  } catch (e) { console.warn('guardarBajaCliente', e); alert('No se pudo dar de baja: ' + (e.message || e)); }
}

async function reactivarCliente(id) {
  const c = (AppData.clientes || []).find(x => x.id === id);
  if (!c) return;
  if (!confirm('¿Reactivar a ' + c.nombre + '?' + String.fromCharCode(10) +
    'Vuelve al padrón. Su comisión, si la tenía, NO se reactiva sola: eso se decide en Comisiones.')) return;
  try {
    await DB.updateWhere('clientes', 'id', id, { activo: true, fecha_baja: '', motivo_baja: '' });
    Object.assign(c, { activo: true, fecha_baja: '', motivo_baja: '' });
    persistirClientesLocal();
    renderClientes();
    renderClientesBajas();
    showToast('↺ ' + c.nombre + ' reactivado');
  } catch (e) { console.warn('reactivarCliente', e); alert('No se pudo reactivar: ' + (e.message || e)); }
}

// ── Vendedor que trajo al cliente ──────────────────────────────────────────
// La asignación NO se guarda en `clientes`: escribe derecho en
// `comision_clientes`, que es de donde sale la comisión. Un segundo padrón se
// desincroniza, y el vendedor que cobra tiene que ser el mismo que se asignó acá.
function comisionDeCliente(nombre) {
  return (AppData.comisionClientes || []).find(x => normCliente(x.cliente) === normCliente(nombre));
}
function _cardVendedor(c) {
  const row = comisionDeCliente(c.nombre);
  const actual = row ? (row.vendedor || '') : '';
  const vends = (AppData.vendedores || []).filter(v => v.activo !== false)
    .slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const esc = s => String(s).replace(/"/g, '&quot;');
  const hayActual = actual && vends.some(v => normNombre(v.nombre) === normNombre(actual));
  const opts = '<option value="">Sin vendedor asignado</option>' +
    vends.map(v => '<option value="' + esc(v.nombre) + '"' +
      (normNombre(v.nombre) === normNombre(actual) ? ' selected' : '') + '>' + v.nombre + '</option>').join('') +
    // Un vendedor dado de baja que figure en una asignación vieja se muestra
    // marcado en vez de desaparecer: si no, guardar la ficha se lo borraría.
    (actual && !hayActual ? '<option value="' + esc(actual) + '" selected>' + actual + ' (dado de baja)</option>' : '');

  let estado;
  if (!row) {
    estado = '<span class="muted">Al asignarle un vendedor entra al régimen de comisiones y la app evalúa sus 4 primeras liquidaciones.</span>';
  } else if (comisionEsBaja(row)) {
    estado = '<span style="color:#b91c1c">Comisión dada de baja' + (row.mes_baja ? ' desde ' + mesLabel(row.mes_baja) : '') + '</span>';
  } else if (row.bloqueado) {
    const mi = row.mes_inicio || '';
    estado = '<span style="color:#166534">Comisiona ' + fmtPeso(_num(row.monto)) + '/mes' +
      (row.categoria ? ' · categoría ' + row.categoria : '') +
      (mi ? ' · ' + mesLabel(mi) + ' → ' + mesLabel(addMeses(mi, 4)) : '') + '</span>';
  } else {
    estado = '<span style="color:#854d0e">En evaluación — se confirma desde el panel Comisiones.</span>';
  }

  return '<div style="padding:12px 0;border-top:1px solid var(--border)">' +
    '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px">Vendedor</div>' +
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
      '<select id="card-vendedor" style="flex:1;min-width:200px;max-width:280px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px">' + opts + '</select>' +
      '<button class="btn btn-sm" onclick="asignarVendedorCliente(' + JSON.stringify(c.nombre).replace(/"/g, '&quot;') + ')"><i class="ic ic-save"></i> Asignar</button>' +
    '</div>' +
    '<div style="font-size:11px;margin-top:6px">' + estado + '</div>' +
  '</div>';
}

async function asignarVendedorCliente(nombre) {
  const sel = document.getElementById('card-vendedor');
  if (!sel) return;
  const vendedor = (sel.value || '').trim().toUpperCase();
  const row = comisionDeCliente(nombre);
  const actual = row ? (row.vendedor || '') : '';
  if (normNombre(vendedor) === normNombre(actual)) { showToast('El vendedor ya es ese'); return; }

  try {
    // Sacarle el vendedor: si ya está confirmado, la comisión está corriendo y
    // eso se decide en Comisiones (baja), no borrando la asignación de una ficha.
    if (!vendedor) {
      if (!row) return;
      if (row.bloqueado) {
        alert('"' + nombre + '" ya tiene la comisión confirmada y corriendo.' + String.fromCharCode(10) +
          'Para cortarla usá "Dar de baja" en el panel Comisiones: así queda registrado desde qué mes deja de pagarse y por qué.');
        return;
      }
      if (!confirm('¿Sacar a ' + nombre + ' del régimen de comisiones?')) return;
      await DB.deleteWhere('comision_clientes', 'id', row.id);
      AppData.comisionClientes = AppData.comisionClientes.filter(x => x.id !== row.id);
    } else if (row) {
      if (row.bloqueado && !confirm('La comisión de "' + nombre + '" ya está confirmada (' + fmtPeso(_num(row.monto)) + '/mes).' + String.fromCharCode(10) +
        'Cambiar el vendedor a ' + vendedor + ' mueve ese pago de un vendedor al otro desde el próximo cierre.' + String.fromCharCode(10) + String.fromCharCode(10) + '¿Confirmás?')) return;
      await DB.updateWhere('comision_clientes', 'id', row.id, { vendedor });
      row.vendedor = vendedor;
    } else {
      const rec = { cliente: String(nombre).toUpperCase(), vendedor, fecha_alta: '', mes_inicio: '',
        categoria: '', facturacion_eval: 0, monto: 0, bloqueado: false, estado: 'activo', mes_baja: '', motivo_baja: '' };
      const r = await DB.insertRow('comision_clientes', rec);
      AppData.comisionClientes.push(Object.assign({ id: r.id }, rec));
    }
    if (typeof persistirComisionesLocal === 'function') persistirComisionesLocal();
    if (typeof renderComisionClientes === 'function' && document.getElementById('com-cli-rows')) renderComisionClientes();
    verCardCliente(clienteKey((AppData.clientes || []).find(x => normCliente(x.nombre) === normCliente(nombre))?.codigo));
    showToast(vendedor ? '✅ ' + nombre + ' asignado a ' + vendedor : '🗑 ' + nombre + ' fuera de comisiones');
  } catch (e) {
    console.warn('asignarVendedorCliente', e);
    alert('No se pudo asignar el vendedor: ' + (e.message || e));
  }
}

async function sumarCuentaDesdeCard(cod) {
  const sel = document.getElementById('card-cuenta-nueva');
  const alias = sel && sel.value;
  if (!alias) { showToast('Elegí la cuenta que querés sumarle'); return; }
  const ok = await unirCuentasCliente(cod, [alias]);
  renderClientes();
  if (ok) { showToast('🔗 ' + alias + ' vinculada a ' + clienteNombreDe(cod)); verCardCliente(cod); }
  else showToast('⛔ No se pudo vincular');
}

// Salta al detalle del cliente con el cliente ya elegido.
function verDetalleDeCliente(cod) {
  showPage('detalle-cliente');
  setTimeout(() => {
    const sel = document.getElementById('dcli-select');
    if (sel) { sel.value = cod; renderDetalleCliente(); }
  }, 80);
}

// Da de alta los clientes que aparecen en los envíos y no están en el maestro.
// ── Clientes reconocidos en los envíos que no están en el maestro ───────────
// Mismo criterio que el panel de conductores: al aparecer uno nuevo hay dos
// respuestas posibles y solo el operador sabe cuál. VINCULAR si es otra cuenta
// de un cliente que ya está (LA FERRETERIA 2 → LA FERRETERIA); AGREGAR si es un
// cliente nuevo de verdad. Elegir por él sería inventar la facturación.
let _cliNuevosReconocidos = [];
function clientesNuevosReconocidos() {
  const enMaestro = new Set((AppData.clientes || []).map(c => clienteKey(c.codigo)).filter(Boolean));
  return clientesDeRegistros()
    .filter(c => !enMaestro.has(clienteKey(c.cod)))
    .sort((a, b) => b.envios - a.envios);
}

function _chipsNuevosClientes() {
  _cliNuevosReconocidos = clientesNuevosReconocidos();
  if (!_cliNuevosReconocidos.length) return '';
  const n = _cliNuevosReconocidos.length;

  // De los que faltan, cuáles parecen cuentas de un mismo cliente (BOIRATECNO3,
  // BOIRATECNO5, …). Se ofrece como ATAJO dentro del mismo aviso, no como otro
  // cartel aparte: es la misma decisión —vincular— hecha de a muchas.
  const grupos = cuentasSugeridas();
  const nAgrupables = grupos.reduce((s, g) => s + g.otras.length, 0);

  const chips = _cliNuevosReconocidos.slice(0, 40).map((c, i) =>
    '<span style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #f0d98a;border-radius:8px;padding:4px 6px 4px 10px;font-size:12px;white-space:nowrap">' +
      '<span class="conductor-avatar" style="background:' + avatarColor(c.nombre) + ';width:22px;height:22px;font-size:9px">' + initials(c.nombre) + '</span>' +
      '<span>' + c.nombre + ' <span style="color:#8a6d00">· ' + c.envios + '</span></span>' +
      '<button class="btn btn-sm" style="padding:2px 8px;font-size:11px" title="Es otra cuenta de un cliente que ya está cargado: comparte su tarifario" onclick="vincularClienteReconocido(' + i + ')"><i class="ic ic-clip"></i> Vincular</button>' +
      '<button class="btn btn-sm" style="padding:2px 8px;font-size:11px" title="Es un cliente nuevo: se le carga su propio tarifario" onclick="agregarClienteReconocido(' + i + ')"><i class="ic ic-plus"></i> Agregar</button>' +
    '</span>').join('');

  // El contenido va TODO dentro de un solo hijo: .alert es flex y cada hijo
  // suelto se convertía en una columna (el texto quedaba en una tira vertical).
  return '<div class="alert" style="background:#fff8e1;border:1px solid #f5d97a;color:#7a5c00;margin:0 0 12px;padding:12px 16px">' +
    '<i class="ic ic-alert"></i>' +
    '<div style="min-width:0;flex:1">' +
      '<div style="font-weight:600;margin-bottom:4px">' +
        n + ' cliente' + (n !== 1 ? 's' : '') + ' de los envíos ' + (n !== 1 ? 'no están' : 'no está') + ' en el maestro</div>' +
      '<div style="font-size:12px;margin-bottom:10px">' +
        'Decidí uno por uno: <strong>Vincular</strong> si es otra cuenta de un cliente que ya tenés (comparte su tarifario y factura junto), ' +
        '<strong>Agregar</strong> si es un cliente nuevo al que le vas a cargar su tarifario.</div>' +
      (nAgrupables
        ? '<div style="font-size:12px;background:#fff;border:1px solid #f0d98a;border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<span><strong>Atajo:</strong> ' + nAgrupables + ' de estas parecen cuentas de clientes que ya tenés ' +
            '(' + grupos.slice(0, 2).map(g => g.principal.nombre + ' + ' + g.otras.length).join(', ') +
            (grupos.length > 2 ? ', …' : '') + '). Las vincula todas juntas.</span>' +
            '<button class="btn btn-sm" style="margin-left:auto" onclick="unirCuentasSugeridas()"><i class="ic ic-clip"></i> Vincular las ' + nAgrupables + '</button>' +
          '</div>'
        : '') +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;max-height:220px;overflow-y:auto">' + chips +
        (n > 40 ? '<span style="align-self:center;font-size:11px">…y ' + (n - 40) + ' más</span>' : '') + '</div>' +
      (n > 1 ? '<div style="margin-top:10px"><button class="btn btn-sm" onclick="altaClientesFaltantes()">Agregar las ' + n + ' como clientes nuevos</button></div>' : '') +
    '</div>' +
  '</div>';
}

// Alta: abre el modal de cliente nuevo con el nombre y el código ya puestos.
function agregarClienteReconocido(i) {
  const c = _cliNuevosReconocidos[i];
  if (!c) return;
  openAddClienteModal();
  const n = document.getElementById('mcli-nombre'); if (n) n.value = c.nombre;
  const cod = document.getElementById('mcli-codigo'); if (cod) cod.value = c.cod;
}

// Vincular: esa cuenta pasa a colgar de un cliente que ya está cargado.
let _cliVincPendiente = null;
function vincularClienteReconocido(i) {
  const c = _cliNuevosReconocidos[i];
  if (!c) return;
  _cliVincPendiente = c;
  document.getElementById('vcli-nombre').textContent = c.nombre + ' (' + c.envios + ' envíos)';
  const sel = document.getElementById('vcli-select');
  sel.innerHTML = '<option value="">Elegí un cliente…</option>' +
    (AppData.clientes || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
      .map(x => '<option value="' + clienteKey(x.codigo) + '">' + x.nombre +
        ' — ' + clienteNZonas(x.codigo) + ' zonas con tarifa</option>').join('');
  sel.value = '';
  document.getElementById('modal-vinccli-backdrop').style.display = 'flex';
}
function closeVincClienteModal(e) {
  if (!e || e.target.id === 'modal-vinccli-backdrop') {
    document.getElementById('modal-vinccli-backdrop').style.display = 'none';
    _cliVincPendiente = null;
  }
}
async function confirmarVincularCliente() {
  const cod = document.getElementById('vcli-select').value;
  if (!cod) { alert('Elegí a qué cliente vincular esta cuenta.'); return; }
  const c = _cliVincPendiente;
  if (!c) return;
  document.getElementById('modal-vinccli-backdrop').style.display = 'none';
  _cliVincPendiente = null;
  const ok = await unirCuentasCliente(cod, [c.cod]);
  renderClientes();
  showToast(ok ? '🔗 ' + c.nombre + ' vinculado a ' + clienteNombreDe(cod) : '⛔ No se pudo vincular');
}

// ── Pendientes de código ────────────────────────────────────────────────────
// Un cliente está PENDIENTE si su código no aparece en NINGÚN envío: su
// tarifario no se aplica a nada y se factura en $0. Es el estado que hay que
// poder ver de un vistazo, sin depender de que el nombre matchee (los que
// matchean se arreglan solos con "Vincular"; el resto hay que corregirlos a
// mano y antes no figuraban en ningún lado).
function hayEnviosConCodigo() {
  return (AppData.records || []).some(r => clienteKey(r && r.cliente_cod));
}
function clientesPendientesCodigo() {
  const sabemos = hayEnviosConCodigo();
  const cods = new Set(clientesDeRegistros().map(c => clienteKey(c.cod)));
  return (AppData.clientes || []).filter(c => {
    const cod = clienteKey(c.codigo);
    if (!cod) return true;
    // Sin recorridos cargados no se puede saber: vale la marca que dejó el import.
    if (!sabemos) return /^Código provisional/.test(String(c.obs || ''));
    return !cods.has(cod);
  });
}

let cliSoloPendientes = false;
function toggleSoloPendientes() { cliSoloPendientes = !cliSoloPendientes; renderClientes(); }

// ── Detección de cuentas del mismo cliente ──────────────────────────────────
// Raíz del nombre de fantasía: sin el número de cuenta al final ni la forma
// societaria. "LA FERRETERIA 2" y "ATAWALLPA PAPELES S.A" caen en la misma raíz
// que su cuenta hermana; es la pista que usa el operador para reconocerlas.
function _raizCliente(nombre) {
  return normNombre(String(nombre || '')
    .replace(/\s*(S\.?A\.?S?|S\.?R\.?L\.?)\s*$/i, '')
    .replace(/\s*[0-9]+\s*$/, ''))
    .trim();
}

// Grupos de códigos DISTINTOS que parecen el mismo cliente. Se propone como
// canónico el que más envíos tiene. Solo sugiere: unir cuentas es del operador.
function cuentasSugeridas() {
  const porRaiz = new Map();
  clientesDeRegistrosCrudo().forEach(c => {
    const raiz = _raizCliente(c.nombre);
    if (!raiz) return;
    if (!porRaiz.has(raiz)) porRaiz.set(raiz, []);
    porRaiz.get(raiz).push(c);
  });
  const out = [];
  porRaiz.forEach((cuentas, raiz) => {
    const cods = Array.from(new Set(cuentas.map(c => clienteKey(c.cod))));
    if (cods.length < 2) return;
    // Si ya están unificadas, no hay nada que sugerir.
    const canon = Array.from(new Set(cods.map(clienteCodCanonico)));
    if (canon.length < 2) return;
    const porCod = cods.map(cod => {
      const envios = cuentas.filter(c => clienteKey(c.cod) === cod).reduce((s, c) => s + c.envios, 0);
      const nombre = cuentas.find(c => clienteKey(c.cod) === cod).nombre;
      // Se prefiere el código que YA está dado de alta: si el operador armó la
      // ficha y le cargó el tarifario, no tiene sentido moverle el código.
      const enMaestro = (AppData.clientes || []).some(x => clienteKey(x.codigo) === cod);
      return { cod, nombre, envios, enMaestro };
    }).sort((a, b) => (b.enMaestro ? 1 : 0) - (a.enMaestro ? 1 : 0) || b.envios - a.envios);
    out.push({ raiz, principal: porCod[0], otras: porCod.slice(1) });
  });
  return out.sort((a, b) => b.principal.envios - a.principal.envios);
}

// Igual que clientesDeRegistros pero SIN unificar cuentas: se necesita para
// poder detectar las que todavía no están unidas.
function clientesDeRegistrosCrudo() {
  const m = new Map();
  (AppData.records || []).forEach(r => {
    const k = clienteKey(r && r.cliente_cod);
    if (!k || !esClienteValido(k)) return;
    let x = m.get(k);
    if (!x) { x = { cod: k, nombre: String(r.cliente || '').trim() || k, envios: 0 }; m.set(k, x); }
    x.envios++;
  });
  return Array.from(m.values());
}

// Une las cuentas elegidas bajo un código canónico y mueve sus tarifas.
async function unirCuentasCliente(canon, alias) {
  const canonK = clienteKey(canon);
  let ok = 0;
  for (const a of alias) {
    const aliasK = clienteKey(a);
    if (!aliasK || aliasK === canonK) continue;
    try {
      await DB.insertRow('cliente_cuentas', { alias_cod: aliasK, cliente_cod: canonK });
      AppData.clienteCuentas = (AppData.clienteCuentas || [])
        .filter(x => clienteKey(x.alias_cod) !== aliasK)
        .concat([{ alias_cod: aliasK, cliente_cod: canonK }]);
      ok++;
    } catch (e) { console.warn('unir cuenta', aliasK, e); }
    // Si la cuenta secundaria tenía su propia ficha y su tarifario, se los
    // queda el cliente canónico: es el mismo acuerdo comercial.
    const ficha = (AppData.clientes || []).find(c => clienteKey(c.codigo) === aliasK);
    if (ficha) {
      const suyas = (AppData.clienteTarifas || []).filter(t => clienteKey(t.cliente_cod) === aliasK);
      const tieneCanon = (AppData.clienteTarifas || []).some(t => clienteKey(t.cliente_cod) === canonK);
      try {
        if (suyas.length && !tieneCanon) {
          await DB.updateWhere('cliente_tarifas', 'cliente_cod', aliasK, { cliente_cod: canonK });
          suyas.forEach(t => { t.cliente_cod = canonK; });
        } else if (suyas.length) {
          // El canónico ya tiene tarifario propio: el duplicado se descarta.
          await DB.deleteWhere('cliente_tarifas', 'cliente_cod', aliasK);
          AppData.clienteTarifas = AppData.clienteTarifas.filter(t => clienteKey(t.cliente_cod) !== aliasK);
        }
        await DB.deleteWhere('clientes', 'id', ficha.id);
        AppData.clientes = AppData.clientes.filter(c => c.id !== ficha.id);
      } catch (e) { console.warn('absorber ficha', aliasK, e); }
    }
  }
  invalidarIndiceCuentas();
  persistirClientesLocal();
  return ok;
}

// Aplica todas las sugerencias de una (el caso de la primera carga).
async function unirCuentasSugeridas() {
  const grupos = cuentasSugeridas();
  if (!grupos.length) { showToast('No hay cuentas para unir'); return; }
  const detalle = grupos.slice(0, 10).map(g =>
    '· ' + g.principal.nombre + ' [' + g.principal.cod + '] ← ' + g.otras.map(o => o.cod).join(', ')).join('\n');
  if (!confirm('Estos códigos parecen ser el MISMO cliente con varias cuentas.\n' +
    'Se unifican bajo el que más envíos tiene, y el tarifario pasa a valer para todas:\n\n' + detalle +
    (grupos.length > 10 ? '\n…y ' + (grupos.length - 10) + ' más' : '') +
    '\n\nSe puede deshacer desde la ficha de cada cliente.')) return;
  let ok = 0;
  for (const g of grupos) ok += await unirCuentasCliente(g.principal.cod, g.otras.map(o => o.cod));
  renderClientes();
  showToast('✅ ' + ok + ' cuenta(s) unidas a su cliente');
}

async function separarCuenta(aliasCod) {
  const a = clienteKey(aliasCod);
  const fila = (AppData.clienteCuentas || []).find(x => clienteKey(x.alias_cod) === a);
  if (!fila) return;
  if (!confirm('¿Separar la cuenta ' + a + '?\nVuelve a facturarse por su cuenta y va a necesitar su propio tarifario.')) return;
  try {
    await DB.deleteWhere('cliente_cuentas', 'alias_cod', a);
    AppData.clienteCuentas = AppData.clienteCuentas.filter(x => clienteKey(x.alias_cod) !== a);
    invalidarIndiceCuentas();
    persistirClientesLocal();
    renderClientes();
    showToast('↩ Cuenta ' + a + ' separada');
  } catch (e) { console.warn('separarCuenta', e); showToast('⛔ No se pudo separar'); }
}

// Clientes del maestro cuyo código NO aparece en ningún envío pero cuyo NOMBRE
// sí. Son los que quedaron con un código que no factura nada: típicamente el
// provisional que pone el import cuando los envíos todavía no estaban cargados.
// Darlos de alta otra vez duplicaría el cliente y dejaría el tarifario colgado
// del código viejo, así que lo que corresponde es RE-CODIFICARLOS.
function clientesPorVincular() {
  const deEnvios = clientesDeRegistros();          // todos los envíos cargados, no solo la semana
  const codsEnvios = new Set(deEnvios.map(c => clienteKey(c.cod)));
  const porNombre = new Map(deEnvios.map(c => [normCliente(c.nombre), c]));
  const codsMaestro = new Set((AppData.clientes || []).map(c => clienteKey(c.codigo)).filter(Boolean));
  const out = [];
  (AppData.clientes || []).forEach(c => {
    const cod = clienteKey(c.codigo);
    if (cod && codsEnvios.has(cod)) return;        // su código ya matchea envíos: no se toca
    const env = porNombre.get(normCliente(c.nombre));
    if (!env) return;                              // su nombre no aparece en los envíos
    const codNuevo = clienteKey(env.cod);
    if (!codNuevo || codNuevo === cod) return;
    out.push({ id: c.id, nombre: c.nombre, codViejo: cod, codNuevo, envios: env.envios,
               conflicto: codsMaestro.has(codNuevo) });
  });
  return out;
}

// Les pone el código real de los envíos y se lleva su tarifario con ellos.
async function vincularClientesConEnvios() {
  const todos = clientesPorVincular();
  const lista = todos.filter(x => !x.conflicto);
  const conflictos = todos.filter(x => x.conflicto);
  if (!lista.length) {
    showToast(conflictos.length ? '⚠️ Solo hay casos con código ya usado por otro cliente' : 'No hay clientes para vincular');
    if (conflictos.length) alert('Estos no se pueden vincular solos porque su código real ya lo tiene otro cliente del maestro:\n\n' +
      conflictos.map(x => '· ' + x.nombre + ' → ' + x.codNuevo).join('\n'));
    return;
  }
  if (!confirm('Estos ' + lista.length + ' cliente(s) ya están cargados pero con un código que no coincide con sus envíos.\n' +
    'Se les pone el código real y su tarifario se mueve con ellos:\n\n' +
    lista.slice(0, 12).map(x => '· ' + x.nombre + ': ' + x.codViejo + ' → ' + x.codNuevo + '  (' + x.envios + ' envíos)').join('\n') +
    (lista.length > 12 ? '\n…y ' + (lista.length - 12) + ' más' : '') +
    '\n\nNo se crea ningún cliente nuevo ni se pierde ninguna tarifa.')) return;

  let ok = 0, tarifas = 0;
  for (const x of lista) {
    try {
      await DB.updateWhere('clientes', 'id', x.id, { codigo: x.codNuevo, obs: '' });
      const cli = (AppData.clientes || []).find(c => c.id === x.id);
      if (cli) { cli.codigo = x.codNuevo; cli.obs = ''; }
      // El tarifario cuelga del código: se mueve entero en una sola operación.
      if (x.codViejo) {
        const suyas = (AppData.clienteTarifas || []).filter(t => clienteKey(t.cliente_cod) === x.codViejo);
        if (suyas.length) {
          await DB.updateWhere('cliente_tarifas', 'cliente_cod', x.codViejo, { cliente_cod: x.codNuevo });
          suyas.forEach(t => { t.cliente_cod = x.codNuevo; });
          tarifas += suyas.length;
        }
      }
      ok++;
    } catch (e) { console.warn('vincular cliente', x.nombre, e); }
  }
  persistirClientesLocal();
  renderClientes();
  showToast('✅ ' + ok + ' cliente(s) vinculados con sus envíos · ' + tarifas + ' tarifas movidas');
  if (conflictos.length) alert('Quedaron ' + conflictos.length + ' sin vincular porque su código real ya lo tiene otro cliente:\n\n' +
    conflictos.map(x => '· ' + x.nombre + ' → ' + x.codNuevo).join('\n') + '\n\nRevisá si están duplicados.');
}

async function altaClientesFaltantes() {
  const rango = semanaClienteRango();
  const faltantes = clientesDeRegistros(rango)
    .filter(c => !(AppData.clientes || []).some(x => clienteKey(x.codigo) === c.cod));
  if (!faltantes.length) { showToast('No hay clientes nuevos'); return; }
  if (!confirm('¿Dar de alta ' + faltantes.length + ' cliente(s)?\n\n' +
    faltantes.slice(0, 12).map(f => '· ' + f.nombre + ' (' + f.cod + ')').join('\n') +
    (faltantes.length > 12 ? '\n…y ' + (faltantes.length - 12) + ' más' : '') +
    '\n\nDespués hay que cargarles el tarifario por zona.')) return;
  let ok = 0;
  for (const f of faltantes) {
    try {
      const row = await DB.insertRow('clientes', { nombre: f.nombre, codigo: f.cod, razon_social: '', cuit: '', activo: true });
      AppData.clientes.push({ id: row.id, nombre: f.nombre, codigo: f.cod, razon_social: '', cuit: '', contacto: '', telefono: '', email: '', obs: '', activo: true });
      ok++;
    } catch (e) { console.warn('alta cliente ' + f.cod, e); }
  }
  persistirClientesLocal();
  renderClientes();
  showToast('✅ ' + ok + ' cliente(s) dados de alta — cargales el tarifario');
}
// Llena el select de vendedores del modal de alta/edición, dejando marcado el
// que ya tenga asignado el cliente.
function _mcliVendedores(actual) {
  const sel = document.getElementById('mcli-vendedor');
  if (!sel) return;
  const esc = s => String(s).replace(/"/g, '&quot;');
  const vends = (AppData.vendedores || []).filter(v => v.activo !== false)
    .slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const hay = actual && vends.some(v => normNombre(v.nombre) === normNombre(actual));
  sel.innerHTML = '<option value="">Sin vendedor</option>' +
    vends.map(v => '<option value="' + esc(v.nombre) + '"' +
      (normNombre(v.nombre) === normNombre(actual) ? ' selected' : '') + '>' + v.nombre + '</option>').join('') +
    (actual && !hay ? '<option value="' + esc(actual) + '" selected>' + actual + ' (dado de baja)</option>' : '');
}

function openAddClienteModal() {
  clienteEditId = null;
  document.getElementById('modal-cliente-title').textContent = 'Nuevo cliente';
  document.getElementById('mcli-nombre').value = '';
  _mcliVendedores('');
  ['mcli-codigo','mcli-razon','mcli-contacto','mcli-telefono','mcli-email','mcli-obs'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('mcli-cuit').value = '';
  document.getElementById('modal-cliente-backdrop').style.display = 'flex';
}
function editCliente(id) {
  const c = AppData.clientes.find(x => x.id === id);
  if (!c) return;
  clienteEditId = id;
  document.getElementById('modal-cliente-title').textContent = 'Editar cliente';
  document.getElementById('mcli-nombre').value = c.nombre || '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('mcli-codigo', c.codigo); set('mcli-razon', c.razon_social);
  set('mcli-contacto', c.contacto); set('mcli-telefono', c.telefono);
  set('mcli-email', c.email); set('mcli-obs', c.obs);
  const rc = comisionDeCliente(c.nombre);
  _mcliVendedores(rc ? (rc.vendedor || '') : '');
  document.getElementById('mcli-cuit').value = c.cuit || '';
  document.getElementById('modal-cliente-backdrop').style.display = 'flex';
}
function closeClienteModal(e) {
  if (!e || e.target.id === 'modal-cliente-backdrop') document.getElementById('modal-cliente-backdrop').style.display = 'none';
}
async function guardarClienteModal() {
  const nombre = document.getElementById('mcli-nombre').value.trim().toUpperCase();
  const codigo = (document.getElementById('mcli-codigo')?.value || '').trim().toUpperCase();
  const razon_social = document.getElementById('mcli-razon').value.trim();
  const cuit = document.getElementById('mcli-cuit').value.trim();
  const contacto = (document.getElementById('mcli-contacto')?.value || '').trim();
  const telefono = (document.getElementById('mcli-telefono')?.value || '').trim();
  const email = (document.getElementById('mcli-email')?.value || '').trim();
  const obs = (document.getElementById('mcli-obs')?.value || '').trim();
  if (!nombre) { alert('El nombre del cliente es obligatorio.'); return; }
  if (!codigo) { alert('El código es obligatorio: es lo que une al cliente con sus envíos (columna Cod.Cliente del listado).'); return; }
  const dupCod = AppData.clientes.find(c => clienteKey(c.codigo) === clienteKey(codigo) && c.id !== clienteEditId);
  if (dupCod) { alert('El código "' + codigo + '" ya lo usa ' + dupCod.nombre + '.'); return; }
  // Nombre único (por normalizado)
  const dup = AppData.clientes.find(c => normCliente(c.nombre) === normCliente(nombre) && c.id !== clienteEditId);
  if (dup) { alert('Ya existe un cliente "' + nombre + '".'); return; }
  try {
    if (clienteEditId != null) {
      await DB.updateWhere('clientes', 'id', clienteEditId, { nombre, codigo, razon_social, cuit, contacto, telefono, email, obs });
      const c = AppData.clientes.find(x => x.id === clienteEditId);
      if (c) Object.assign(c, { nombre, codigo, razon_social, cuit, contacto, telefono, email, obs });
    } else {
      const row = await DB.insertRow('clientes', { nombre, codigo, razon_social, cuit, contacto, telefono, email, obs, activo: true });
      AppData.clientes.push({ id: row.id, nombre, codigo, razon_social, cuit, contacto, telefono, email, obs, activo: true });
    }
    persistirClientesLocal();
    // El vendedor no se guarda en `clientes`: va a `comision_clientes`, que es la
    // única fuente de la comisión. Se aplica después de tener el cliente creado.
    await _guardarVendedorDeCliente(nombre);
    clienteEditId = null;
    document.getElementById('modal-cliente-backdrop').style.display = 'none';
    renderClientes();
    showToast('✅ Cliente guardado');
  } catch (e) { console.warn('guardarClienteModal:', e); alert('No se pudo guardar: ' + (e.message || e)); }
}
// Aplica lo elegido en el select del modal. Un cliente con la comisión ya
// confirmada no se saca de acá: eso es una baja y se decide en Comisiones, con
// su mes y su motivo.
async function _guardarVendedorDeCliente(nombre) {
  const sel = document.getElementById('mcli-vendedor');
  if (!sel) return;
  const vendedor = (sel.value || '').trim().toUpperCase();
  const row = comisionDeCliente(nombre);
  const actual = row ? (row.vendedor || '') : '';
  if (normNombre(vendedor) === normNombre(actual)) return;
  try {
    if (!vendedor) {
      if (!row || row.bloqueado) return;   // confirmado: se da de baja en Comisiones
      await DB.deleteWhere('comision_clientes', 'id', row.id);
      AppData.comisionClientes = AppData.comisionClientes.filter(x => x.id !== row.id);
    } else if (row) {
      await DB.updateWhere('comision_clientes', 'id', row.id, { vendedor });
      row.vendedor = vendedor;
    } else {
      const rec = { cliente: String(nombre).toUpperCase(), vendedor, fecha_alta: '', mes_inicio: '',
        categoria: '', facturacion_eval: 0, monto: 0, bloqueado: false, estado: 'activo', mes_baja: '', motivo_baja: '' };
      const r = await DB.insertRow('comision_clientes', rec);
      AppData.comisionClientes.push(Object.assign({ id: r.id }, rec));
    }
    if (typeof persistirComisionesLocal === 'function') persistirComisionesLocal();
    if (typeof renderComisionClientes === 'function' && document.getElementById('com-cli-rows')) renderComisionClientes();
  } catch (e) {
    console.warn('_guardarVendedorDeCliente', e);
    showToast('⚠️ El cliente se guardó, pero no se pudo asignar el vendedor');
  }
}

// Borrado FÍSICO: solo para el cliente cargado por error, que no tiene nada
// atrás. Si tiene envíos, liquidaciones o comisión, borrarlo se llevaría puesta
// esa historia y no habría forma de recuperarla — para eso está la baja, que
// deja todo en su lugar (bug real: el botón de la tarjeta decía "Dar de baja"
// y borraba de verdad).
async function eliminarCliente(id) {
  const c = AppData.clientes.find(x => x.id === id);
  if (!c) return;
  const k = clienteCodCanonico(clienteKey(c.codigo));
  const envios = (AppData.records || []).filter(r => clienteCodDeRegistro(r) === k).length;
  const liqs = (AppData.clienteLiquidaciones || []).filter(x => clienteCodCanonico(clienteKey(x.cliente_cod)) === k).length;
  const com = (typeof comisionDeCliente === 'function') ? comisionDeCliente(c.nombre) : null;
  if (envios || liqs || com) {
    const NL = String.fromCharCode(10);
    alert('No se puede eliminar a ' + c.nombre + ': tiene historia que se perdería.' + NL + NL +
      (envios ? '· ' + envios.toLocaleString('es-AR') + ' envío(s)' + NL : '') +
      (liqs ? '· ' + liqs + ' liquidación(es) cerradas' + NL : '') +
      (com ? '· comisión asignada a ' + com.vendedor + NL : '') + NL +
      'Si dejó de operar, usá "Dar de baja": sale del padrón pero no se borra nada y se puede reincorporar cuando vuelva.');
    return;
  }
  if (!confirm('¿Eliminar el cliente ' + c.nombre + '?' + String.fromCharCode(10) +
    'No tiene envíos ni liquidaciones. Se borra también su tarifario.')) return;
  try {
    await DB.deleteWhere('cliente_tarifas', 'cliente', c.nombre);
    await DB.deleteWhere('clientes', 'id', id);
    AppData.clientes = AppData.clientes.filter(x => x.id !== id);
    AppData.clienteTarifas = AppData.clienteTarifas.filter(t => normCliente(t.cliente) !== normCliente(c.nombre));
    persistirClientesLocal();
    renderClientes();
    showToast('🗑 Cliente eliminado');
  } catch (e) { console.warn('eliminarCliente:', e); showToast('⛔ No se pudo eliminar'); }
}

// ── Editor de tarifas por zona (por cliente) ────────────────────────────────
let tarifasClienteNombre = '';
function openTarifasCliente(id) {
  const c = AppData.clientes.find(x => x.id === id);
  if (!c) return;
  tarifasClienteNombre = c.nombre;
  document.getElementById('modal-cli-tarifas-title').textContent = 'Tarifario de venta · ' + c.nombre;
  // Zonas: las del tarifario base (AppData.tarifas) + las que ya tenga el cliente.
  const zonas = new Set(AppData.tarifas.map(t => String(t.zona || '').toUpperCase().trim()).filter(Boolean));
  AppData.clienteTarifas.filter(t => normCliente(t.cliente) === normCliente(c.nombre))
    .forEach(t => zonas.add(String(t.zona || '').toUpperCase().trim()));
  // El precio que se ofrece para editar es el que RIGE HOY, no una versión
  // cualquiera: con varias listas cargadas, el find se quedaba con la primera.
  const precioDe = z => {
    const t = tarifasVigentesDe(clienteKey(c.codigo) || c.nombre)
      .find(x => normNombre(x.zona) === normNombre(z));
    return t ? _num(t.precio) : '';
  };
  const rows = Array.from(zonas).sort().map(z =>
    '<div style="display:grid;grid-template-columns:1fr 130px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:13px">' + z + '</span>' +
      '<div style="display:flex;align-items:center;gap:6px"><span class="muted" style="font-size:12px">$</span>' +
        '<input type="number" min="0" step="1" data-zona="' + z.replace(/"/g, '&quot;') + '" value="' + (precioDe(z) === '' ? '' : precioDe(z)) + '" placeholder="0" style="width:110px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;text-align:right;font-family:monospace">' +
      '</div>' +
    '</div>').join('');
  document.getElementById('mcli-tarifas-body').innerHTML = rows || '<div class="muted" style="padding:10px">No hay zonas en el tarifario base. Cargá zonas en Tarifas primero, o subí el tarifario por Excel.</div>';
  document.getElementById('modal-cli-tarifas-backdrop').style.display = 'flex';
}
function closeCliTarifasModal(e) {
  if (!e || e.target.id === 'modal-cli-tarifas-backdrop') document.getElementById('modal-cli-tarifas-backdrop').style.display = 'none';
}
async function guardarTarifasCliente() {
  const nombre = tarifasClienteNombre;
  const inputs = Array.from(document.querySelectorAll('#mcli-tarifas-body input[data-zona]'));
  const nuevas = inputs.map(inp => ({ cliente: nombre, zona: inp.getAttribute('data-zona'), precio: parseFloat(inp.value) || 0 }))
    .filter(t => t.precio > 0);
  try {
    // Reemplaza el tarifario del cliente (borrar + insertar).
    await DB.deleteWhere('cliente_tarifas', 'cliente', nombre);
    let inserted = [];
    if (nuevas.length) inserted = await guardarClienteTarifas(nuevas);
    AppData.clienteTarifas = AppData.clienteTarifas.filter(t => normCliente(t.cliente) !== normCliente(nombre)).concat(inserted);
    persistirClientesLocal();
    document.getElementById('modal-cli-tarifas-backdrop').style.display = 'none';
    renderClientes();
    showToast('✅ Tarifario de ' + nombre + ' guardado (' + nuevas.length + ' zonas)');
  } catch (e) { console.warn('guardarTarifasCliente:', e); alert('No se pudo guardar el tarifario: ' + (e.message || e)); }
}
// Inserta filas de cliente_tarifas y devuelve las filas con id.
async function guardarClienteTarifas(rows) {
  // Se canoniza acá también: es el único punto por el que pasan TODAS las
  // tarifas que se guardan, venga del import o de una edición a mano.
  // Se canoniza la zona y se completa la vigencia: una tarifa sin fecha rige
  // "desde siempre", que es como se comportaba todo antes de que existiera.
  rows = rows.map(r => Object.assign({}, r, {
    zona: zonaCanonica(r.zona),
    vigente_desde: tarifaVigenteDesde(r)
  }));
  const ids = await DB.insertRows('cliente_tarifas', rows);
  return rows.map((r, i) => ({ id: ids[i], cliente: r.cliente, vigente_desde: r.vigente_desde, cliente_cod: (r.cliente_cod || '').toUpperCase(), zona: r.zona, precio: _num(r.precio) }));
}

// ── Import Excel del tarifario (Cliente · Zona · Precio) ─────────────────────
// Baja el tarifario COMPLETO (no una plantilla vacía): el circuito real es
// descargar → actualizar precios / sumar zonas → volver a subir. Con una
// plantilla en blanco habría que recargar todo de cero cada vez.
function descargarPlantillaTarifario() {
  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por Cod.Cliente + Zona. El precio es lo que le COBRÁS al cliente por envío entregado en esa zona. El código es el que trae el listado de envíos (Cod.Cliente).'],
    ['Cod.Cliente', 'Cliente', 'Zona', 'Precio']
  ];

  const filas = [];
  // Solo la lista que RIGE HOY: es la que se quiere editar y volver a subir. Las
  // versiones anteriores quedan guardadas, pero bajarlas mezcladas haría que al
  // reimportar el archivo se pisara el historial con precios viejos.
  const _cods = new Set();
  (AppData.clienteTarifas || []).forEach(t => { const c = clienteKey(t.cliente_cod); if (c) _cods.add(c); });
  _cods.forEach(cod => {
    tarifasVigentesDe(cod).forEach(t => {
      filas.push([cod, clienteNombreDe(cod), t.zona || '', _num(t.precio)]);
    });
  });
  // Clientes sin ninguna tarifa: van igual, con las zonas del tarifario en 0,
  // así se completan en el mismo archivo en vez de tener que agregarlos a mano.
  const zonas = (typeof zonasDelTarifario === 'function') ? zonasDelTarifario() : [];
  (AppData.clientes || []).forEach(c => {
    const cod = clienteKey(c.codigo);
    if (!cod || clienteNZonas(cod) > 0) return;
    if (zonas.length) zonas.forEach(z => filas.push([cod, c.nombre, z, 0]));
    else filas.push([cod, c.nombre, '', 0]);
  });

  if (filas.length) {
    filas.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])));
    filas.forEach(f => aoa.push(f));
  } else {
    aoa.push(['BLUE', 'BLUEMAIL', 'QUILMES', 5000]);
    aoa.push(['BLUE', 'BLUEMAIL', 'LA PLATA', 6200]);
    aoa.push(['ART', 'ARTEC', 'CABA', 4800]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 22 }, { wch: 12 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tarifario');
  const hoy = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Tarifario_Clientes_' + hoy + '.xlsx');
  showToast(filas.length
    ? '📥 Tarifario descargado: ' + filas.length + ' fila(s) — actualizalo y volvé a subirlo'
    : '📥 Plantilla descargada (todavía no hay tarifas) — completala y subila');
}
// ── Importación de tarifarios ────────────────────────────────────────────────
// Acepta VARIOS archivos de una vez y dos formatos por archivo:
//   · tarifario completo      → Cod.Cliente · Cliente · Zona · Precio
//   · planilla de un cliente  → su nombre arriba y debajo las columnas ZONA y PRECIO
//
// En la planilla de un cliente el código NO viene en el archivo, y las tarifas
// se atan a cliente_cod. Se resuelve por nombre (maestro → envíos) y, si no
// aparece en ninguno, se le asigna uno PROVISIONAL derivado del nombre para que
// el cliente quede creado igual — que es lo que hace falta en la primera carga.
// El resumen final marca cuáles quedaron provisionales: un código que no matchea
// ningún envío factura en $0 sin que nadie lo note, así que hay que corregirlos.

// Código inventado a partir del nombre, único contra los ya usados. Se nota a
// simple vista que no es un código real (los de verdad son cortos: CIM, GMC),
// justamente para que salte a la vista que hay que revisarlo.
function _codigoProvisional(nombre, usados) {
  const base = String(normNombre(nombre) || '').replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'CLIENTE';
  let cod = base, n = 2;
  while (usados.has(cod)) { cod = base.slice(0, 10) + n; n++; }
  return cod;
}

// ════════════════════════════════════════════════════════════════════════
//  ACTUALIZAR LISTA DE PRECIOS — el aumento rige DESDE UNA FECHA
//  Subir una lista nueva por "Importar tarifario" REEMPLAZA el tarifario del
//  cliente, y como la tarifa no tenía fecha eso reescribía el precio de todos
//  los envíos ya cargados: una liquidación cerrada la semana pasada pasaba a
//  dar otro total, y el papel que ya se había mandado dejaba de coincidir.
//  Acá la lista nueva se guarda con su fecha de vigencia y convive con la
//  anterior; cada envío se cobra con el precio que regía el día que se entregó.
//  El import queda para dar de ALTA clientes nuevos, que es cuando reemplazar
//  todo es justamente lo que se quiere.
// ════════════════════════════════════════════════════════════════════════
let _precArchivos = [];

function abrirActualizarPrecios() {
  const bd = document.getElementById('modal-precios-backdrop');
  if (!bd) return;
  _precArchivos = [];
  const d = document.getElementById('mprec-desde');
  // Por defecto, desde HOY: un aumento se acuerda y se aplica de ahí en más.
  if (d) d.value = _hoyISO();
  const f = document.getElementById('mprec-file'); if (f) f.value = '';
  bd.style.display = 'flex';
  _precPreview();
}
function cerrarActualizarPrecios(e) {
  if (!e || e.target.id === 'modal-precios-backdrop') {
    const bd = document.getElementById('modal-precios-backdrop');
    if (bd) bd.style.display = 'none';
  }
}

// Anticipa qué va a pasar ANTES de aplicar: desde cuándo rige y qué envíos
// quedan afuera. Una fecha hacia atrás no es un error —se puede estar cargando
// un aumento que se acordó antes— pero sí cambia liquidaciones ya emitidas, y
// eso tiene que decirse.
function _precPreview() {
  const desde = (document.getElementById('mprec-desde') || {}).value || '';
  const files = Array.from((document.getElementById('mprec-file') || {}).files || []);
  _precArchivos = files;
  const hint = document.getElementById('mprec-hint');
  const est = document.getElementById('mprec-estado');
  const btn = document.getElementById('mprec-guardar');
  const hoy = _hoyISO();
  if (hint) {
    hint.innerHTML = !desde ? '<span style="color:#b91c1c">Elegí desde cuándo rige la lista nueva.</span>'
      : desde > hoy ? 'Rige a futuro: hasta el ' + _precFmt(desde) + ' se sigue cobrando la lista actual.'
      : desde === hoy ? 'Rige desde hoy. Todo lo entregado hasta ayer se factura con la lista actual.'
      : '<span style="color:#b45309">Rige desde una fecha PASADA (' + _precFmt(desde) + '): los envíos entregados desde ese día se van a recalcular con la lista nueva, aunque su liquidación ya se haya cerrado.</span>';
  }
  if (est) {
    est.innerHTML = files.length
      ? '<div class="muted">' + files.length + ' archivo(s): ' + files.map(f => f.name).join(' · ') + '</div>'
      : '<div class="muted">Todavía no elegiste archivo.</div>';
  }
  if (btn) btn.disabled = !(desde && files.length);
}
function _precFmt(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || ''); }

async function guardarActualizacionPrecios() {
  const desde = (document.getElementById('mprec-desde') || {}).value || '';
  const files = _precArchivos;
  if (!desde || !files.length) { alert('Falta la fecha desde la que rige, o el archivo con la lista nueva.'); return; }
  if (desde < _hoyISO()) {
    if (!confirm('La lista nueva rige desde el ' + _precFmt(desde) + ', que ya pasó.' + String.fromCharCode(10) + String.fromCharCode(10) +
      'Los envíos entregados desde ese día se van a recalcular con los precios nuevos, incluso los de liquidaciones ya cerradas.' + String.fromCharCode(10) + String.fromCharCode(10) +
      '¿Aplicar igual?')) return;
  }
  const btn = document.getElementById('mprec-guardar');
  if (btn) { btn.disabled = true; btn.textContent = 'Aplicando…'; }
  try {
    await _procesarTarifarios(files, desde);
    const bd = document.getElementById('modal-precios-backdrop');
    if (bd) bd.style.display = 'none';
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ic ic-check"></i> Aplicar desde esa fecha'; }
  }
}

function importTarifarioClientes(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  _procesarTarifarios(files).finally(() => { event.target.value = ''; });
}

async function _procesarTarifarios(files, vigenteDesde) {
  // Los códigos REALES salen de los envíos. Si todavía se están cargando, todos
  // los clientes quedarían con código provisional al pedo.
  if (AppData._cargandoRegistros) {
    if (!confirm('Los recorridos todavía se están cargando, así que los códigos de cliente pueden no encontrarse ' +
      'y quedar provisionales.\n\nConviene esperar unos segundos y reintentar.\n\n¿Importar igual?')) return;
  }
  const resultados = [];
  for (const file of files) {
    try { resultados.push(await _importarUnTarifario(file, vigenteDesde)); }
    catch (e) {
      console.warn('importar tarifario', file.name, e);
      resultados.push({ archivo: file.name, error: e.message || String(e), clientes: [] });
    }
  }
  persistirClientesLocal();
  renderClientes();
  _resumenImportTarifarios(resultados);
}

// Lee y aplica UN archivo. Devuelve qué hizo, para el resumen.
function _importarUnTarifario(file, vigenteDesde) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = async function (e) {
      try { resolve(await _aplicarTarifario(file.name, new Uint8Array(e.target.result), vigenteDesde)); }
      catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// vigenteDesde llega hasta ACA: el trabajo real (crear el cliente y guardar sus
// tarifas) pasa en esta funcion, no en la que lee el archivo.
async function _aplicarTarifario(nombreArchivo, bytes, vigenteDesde) {
  const wb = XLSX.read(bytes, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const res = { archivo: nombreArchivo, clientes: [], zonasDesconocidas: [], repetidas: 0, ignoradas: 0 };
  if (rows.length < 2) throw new Error('El archivo está vacío');

  const norm = x => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const esCod    = c => c.includes('codcliente') || c.includes('codigocliente') || c === 'codigo' || c === 'cod';
  const esCli    = c => (c.includes('cliente') || c.includes('empresa')) && !esCod(c);
  const esZona   = c => c.includes('zona') || c.includes('localidad');
  const esPrecio = c => c.includes('precio') || c.includes('tarifa') || c.includes('monto') || c.includes('valor');

  // Cada concepto en una columna DISTINTA. Sin esa condición, la fila del aviso
  // (que nombra "Cod.Cliente" y "Zona") se toma como encabezado y todo se
  // importa desde la misma columna — el bug que ya tuvimos en dimensiones.
  let h = -1, cols = null;
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const cells = (rows[r] || []).map(norm);
    const iCod = cells.findIndex(esCod);
    const iZona = cells.findIndex(esZona);
    const iPrecio = cells.findIndex(esPrecio);
    if (iCod >= 0 && iZona >= 0 && iPrecio >= 0 && iCod !== iZona && iZona !== iPrecio && iCod !== iPrecio) {
      h = r; cols = { iCod, iZona, iPrecio, iCli: cells.findIndex(esCli) };
      break;
    }
  }

  // Formato POR CLIENTE: nombre arriba (título) + columnas ZONA y PRECIO.
  let unico = null;
  if (h < 0) {
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const cells = (rows[r] || []).map(norm);
      const iZona = cells.findIndex(esZona);
      const iPrecio = cells.findIndex(esPrecio);
      const iCod = cells.findIndex(esCod);
      if (iZona >= 0 && iPrecio >= 0 && iZona !== iPrecio && iCod < 0) {
        let nombre = '';
        for (let k = r - 1; k >= 0 && !nombre; k--) {
          for (const celda of (rows[k] || [])) {
            const txt = String(celda || '').trim();
            if (txt) { nombre = txt; break; }
          }
        }
        // Sin título, el nombre del archivo suele ser el del cliente
        // ("MUNDO CIMA.xlsx"), que es mejor que la hoja ("Tarifario").
        if (!nombre) nombre = String(nombreArchivo || '').replace(/\.(xlsx?|csv)$/i, '').trim();
        if (!nombre) nombre = String(wb.SheetNames[0] || '').trim();
        unico = { h: r, iZona, iPrecio, nombre: nombre.toUpperCase() };
        break;
      }
    }
  }
  if (h < 0 && !unico) throw new Error('No se encontró la fila de encabezados (hacen falta ZONA y PRECIO en columnas distintas)');

  const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
  const zonasOk = new Set(((typeof zonasDelTarifario === 'function') ? zonasDelTarifario() : []).map(z => normNombre(z)));
  const desconocidas = new Set();
  const porCod = {};

  if (unico) {
    const zonas = {};
    for (let i = unico.h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const zona = zonaCanonica(r[unico.iZona]);
      const precio = parseNum(r[unico.iPrecio]);
      // 'ZONA' repetida en el medio de la planilla es el encabezado, no una zona.
      if (!zona || !esZonaValida(zona)) { if (r.some(c => String(c).trim())) res.ignoradas++; continue; }
      if (precio <= 0) continue;
      if (zonasOk.size && !zonasOk.has(normNombre(zona))) desconocidas.add(zona);
      if (zonas[zona] !== undefined) res.repetidas++;   // la última gana
      zonas[zona] = precio;
    }
    if (!Object.keys(zonas).length) throw new Error('No hay ninguna zona con precio');

    // Código: maestro → envíos → provisional.
    const clave = normCliente(unico.nombre);
    let cod = '', origen = '';
    const enMaestro = (AppData.clientes || []).find(c => normCliente(c.nombre) === clave && clienteKey(c.codigo));
    if (enMaestro) { cod = clienteKey(enMaestro.codigo); origen = 'del maestro'; }
    if (!cod) {
      const enEnvios = (typeof clientesDeRegistros === 'function' ? clientesDeRegistros() : [])
        .find(c => normCliente(c.nombre) === clave);
      if (enEnvios) { cod = clienteKey(enEnvios.cod); origen = 'de los envíos'; }
    }
    if (!cod) {
      const usados = new Set((AppData.clientes || []).map(c => clienteKey(c.codigo)).filter(Boolean));
      cod = _codigoProvisional(unico.nombre, usados);
      origen = 'provisional';
    }
    porCod[cod] = { nombre: unico.nombre, zonas, origen };
  } else {
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const cod = String(r[cols.iCod] || '').trim().toUpperCase();
      const nombre = cols.iCli >= 0 ? String(r[cols.iCli] || '').trim().toUpperCase() : '';
      const zona = zonaCanonica(r[cols.iZona]);
      const precio = parseNum(r[cols.iPrecio]);
      if (!cod || !zona || !esZonaValida(zona)) { if (r.some(c => String(c).trim())) res.ignoradas++; continue; }
      if (precio <= 0) continue;   // sin precio no se carga (así se puede dejar en 0 lo no acordado)
      if (zonasOk.size && !zonasOk.has(normNombre(zona))) desconocidas.add(zona);
      if (!porCod[cod]) porCod[cod] = { nombre: nombre || cod, zonas: {}, origen: 'del archivo' };
      if (nombre) porCod[cod].nombre = nombre;
      if (porCod[cod].zonas[zona] !== undefined) res.repetidas++;
      porCod[cod].zonas[zona] = precio;
    }
    if (!Object.keys(porCod).length) throw new Error('No se encontró ninguna tarifa válida (Cod.Cliente, Zona y Precio > 0)');
  }
  res.zonasDesconocidas = Array.from(desconocidas);

  for (const cod of Object.keys(porCod)) {
    const info = porCod[cod];
    let cli = (AppData.clientes || []).find(c => clienteKey(c.codigo) === cod);
    let nuevo = false;
    if (!cli) {
      // Si ya existe por nombre pero sin código, se le completa el código.
      cli = (AppData.clientes || []).find(c => !clienteKey(c.codigo) && normCliente(c.nombre) === normCliente(info.nombre));
      if (cli) {
        try { await DB.updateWhere('clientes', 'id', cli.id, { codigo: cod }); cli.codigo = cod; }
        catch (err) { console.warn('completar codigo', cod, err); }
      }
    }
    if (!cli) {
      const obs = info.origen === 'provisional'
        ? 'Código provisional puesto al importar el tarifario: verificar contra la columna Cod.Cliente del listado de envíos.'
        : '';
      const nuevoCli = { nombre: info.nombre, codigo: cod, razon_social: '', cuit: '', activo: true, obs };
      try {
        const row = await DB.insertRow('clientes', nuevoCli);
        cli = Object.assign({ id: row.id, contacto: '', telefono: '', email: '' }, nuevoCli);
        AppData.clientes.push(cli);
        nuevo = true;
      } catch (err) { console.warn('crear cliente import', cod, err); continue; }
    }
    const filas = Object.entries(info.zonas).map(([zona, precio]) => ({
      cliente: cli.nombre, cliente_cod: cod, zona, precio,
      vigente_desde: vigenteDesde || TARIFA_DESDE_SIEMPRE
    }));
    try {
      if (vigenteDesde) {
        // ACTUALIZACIÓN: la lista nueva CONVIVE con la anterior. Solo se pisan las
        // filas de ESTA MISMA fecha, para que reintentar la carga no acumule
        // versiones repetidas del mismo aumento.
        const previas = (AppData.clienteTarifas || []).filter(t =>
          clienteKey(t.cliente_cod) === cod && tarifaVigenteDesde(t) === vigenteDesde);
        for (const t of previas) {
          try { if (typeof t.id === 'number') await DB.deleteWhere('cliente_tarifas', 'id', t.id); }
          catch (err) { console.warn('quitar version previa', t.id, err); }
        }
        const ins = await guardarClienteTarifas(filas);
        AppData.clienteTarifas = (AppData.clienteTarifas || [])
          .filter(t => !(clienteKey(t.cliente_cod) === cod && tarifaVigenteDesde(t) === vigenteDesde))
          .concat(ins);
      } else {
        // ALTA: reemplaza el tarifario de ESE cliente, con toda su historia. Es lo
        // que corresponde al cargar un cliente nuevo o rehacerle la lista entera.
        await DB.deleteWhere('cliente_tarifas', 'cliente_cod', cod);
        const ins = await guardarClienteTarifas(filas);
        AppData.clienteTarifas = (AppData.clienteTarifas || []).filter(t => clienteKey(t.cliente_cod) !== cod).concat(ins);
      }
    } catch (err) { console.warn('tarifas import', cod, err); }
    res.clientes.push({ nombre: cli.nombre, cod, origen: info.origen, zonas: filas.length, nuevo });
  }
  return res;
}

// Zonas del tarifario del cliente que no existen del lado del costo. Casi
// siempre son la misma zona escrita distinta o partida en sub-zonas ("LA PLATA
// NORTE" cuando el envío siempre dice "LA PLATA"). Se ofrecen para vincular ahí
// mismo: si quedan sueltas, esas tarifas no se aplican a ningún envío y el
// cliente se factura en $0 sin que nadie lo note.
function _bloqueVincularZonas(desconocidas) {
  const zonas = (typeof zonasDelTarifario === 'function') ? zonasDelTarifario() : [];
  if (!zonas.length) {
    return '<div style="font-size:11px;color:#9a3412;margin-top:10px"><strong>' + desconocidas.length +
      ' zona(s) no están en el tarifario de costos</strong> (' + desconocidas.join(', ') + ').</div>';
  }
  const opciones = zonas.slice().sort().map(z => '<option value="' + z + '">' + z + '</option>').join('');
  const filas = desconocidas.map(z =>
    '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">' +
      '<span style="flex:1;font-weight:600">' + z + '</span>' +
      '<span style="color:var(--text-muted)">→</span>' +
      '<select class="zona-vincular" data-zona="' + String(z).replace(/"/g, '&quot;') + '" style="width:220px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px">' +
        '<option value="">— dejar como está —</option>' + opciones +
      '</select>' +
    '</div>').join('');
  return '<div style="margin-top:12px;padding:10px 12px;border:1px solid #fdba74;background:#fff7ed;border-radius:8px">' +
    '<div style="font-size:12px;color:#9a3412;margin-bottom:6px"><strong>' + desconocidas.length +
    ' zona(s) no están en el tarifario de costos.</strong> Mientras no coincidan con la zona que traen los envíos, ' +
    'esas tarifas no se aplican y esos envíos se facturan en $0. Vinculalas con la zona que corresponda:</div>' +
    filas +
    '<div style="text-align:right;margin-top:8px">' +
      '<button class="btn btn-sm btn-primary" onclick="vincularZonasDesconocidas()">Vincular zonas</button>' +
    '</div></div>';
}

// Guarda los alias elegidos y corrige las tarifas YA cargadas con esa grafía.
async function vincularZonasDesconocidas() {
  const pares = Array.from(document.querySelectorAll('.zona-vincular'))
    .map(s => ({ alias: s.dataset.zona, zona: s.value }))
    .filter(p => p.zona && normNombre(p.zona) !== normNombre(p.alias));
  if (!pares.length) { showToast('Elegí con qué zona vincular al menos una'); return; }

  let renombradas = 0, quitadas = 0; const conflictos = [];
  for (const { alias, zona } of pares) {
    try { await DB.insertRow('zona_alias', { alias, zona }); }
    catch (e) { console.warn('zona_alias', alias, e); }
    AppData.zonaAlias = (AppData.zonaAlias || [])
      .filter(x => normNombre(x.alias) !== normNombre(alias)).concat([{ alias, zona }]);

    // Las tarifas que ya se guardaron con la grafía vieja pasan a la canónica.
    const afectadas = (AppData.clienteTarifas || []).filter(t => normNombre(t.zona) === normNombre(alias));
    for (const t of afectadas) {
      const gemela = (AppData.clienteTarifas || []).find(x =>
        x.id !== t.id && clienteKey(x.cliente_cod) === clienteKey(t.cliente_cod) && normNombre(x.zona) === normNombre(zona));
      if (gemela && _num(gemela.precio) !== _num(t.precio)) {
        // Dos precios para la misma zona: no se elige por el operador.
        conflictos.push(clienteNombreDe(t.cliente_cod) + ': ' + zona + ' ' + fmtPeso(gemela.precio) + ' vs ' + fmtPeso(t.precio));
        continue;
      }
      if (gemela) {
        try { await DB.deleteWhere('cliente_tarifas', 'id', t.id); AppData.clienteTarifas = AppData.clienteTarifas.filter(x => x.id !== t.id); quitadas++; }
        catch (e) { console.warn('quitar tarifa duplicada', e); }
      } else {
        try { await DB.updateWhere('cliente_tarifas', 'id', t.id, { zona }); t.zona = zona; renombradas++; }
        catch (e) { console.warn('renombrar tarifa', e); }
      }
    }
  }
  persistirClientesLocal();
  renderClientes();
  document.getElementById('modal-backdrop').classList.remove('open');
  showToast('✅ ' + pares.length + ' zona(s) vinculadas' +
    (renombradas ? ' · ' + renombradas + ' tarifas actualizadas' : '') +
    (quitadas ? ' · ' + quitadas + ' duplicadas quitadas' : ''));
  if (conflictos.length) {
    alert('Estas tarifas quedaron sin tocar porque el cliente ya tenía esa zona con OTRO precio.\n' +
      'Revisá cuál corresponde y borrá la que sobra:\n\n' + conflictos.join('\n'));
  }
}

// Resumen de toda la tanda. Va en el modal y no en un alert porque con varios
// archivos hay que poder leerlo y saber cuáles quedaron para revisar.
function _resumenImportTarifarios(resultados) {
  const ok = resultados.filter(r => !r.error);
  const conError = resultados.filter(r => r.error);
  const clientes = ok.reduce((a, r) => a.concat(r.clientes), []);
  const provisionales = clientes.filter(c => c.origen === 'provisional');
  const zonasTotal = clientes.reduce((s, c) => s + c.zonas, 0);
  const nuevos = clientes.filter(c => c.nuevo).length;
  const repetidas = ok.reduce((s, r) => s + r.repetidas, 0);
  const desconocidas = Array.from(new Set(ok.reduce((a, r) => a.concat(r.zonasDesconocidas), [])));

  const badge = o => o === 'provisional'
    ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74">provisional</span>'
    : '<span class="badge badge-gray">' + o + '</span>';

  const filas = clientes.map(c =>
    '<tr>' +
      '<td><strong>' + c.nombre + '</strong>' + (c.nuevo ? ' <span class="badge badge-green">nuevo</span>' : '') + '</td>' +
      '<td class="mono">' + c.cod + '</td>' +
      '<td>' + badge(c.origen) + '</td>' +
      '<td class="mono" style="text-align:right">' + c.zonas + '</td>' +
    '</tr>').join('');

  document.getElementById('modal-title').textContent = 'Tarifarios importados';
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">' +
      '<div>Archivos: <strong>' + resultados.length + '</strong></div>' +
      '<div>Clientes: <strong>' + clientes.length + '</strong>' + (nuevos ? ' (' + nuevos + ' nuevos)' : '') + '</div>' +
      '<div>Tarifas: <strong>' + zonasTotal + '</strong></div>' +
    '</div>' +
    (provisionales.length
      ? '<div class="alert" style="margin-bottom:10px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i><div><strong>' +
        provisionales.length + ' cliente(s) quedaron con código provisional.</strong> No se encontró su código en los envíos, ' +
        'así que se les puso uno derivado del nombre. <strong>Hay que corregirlo</strong> con el Cod.Cliente real: ' +
        'con un código que no matchea ningún envío, ese cliente se factura en $0. Editalos desde su tarjeta.</div></div>'
      : '') +
    (filas ? '<div class="table-wrap" style="max-height:44vh;overflow:auto"><table><thead><tr>' +
      '<th>Cliente</th><th>Código</th><th>De dónde</th><th style="text-align:right">Zonas</th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table></div>' : '') +
    (repetidas ? '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">' + repetidas +
      ' fila(s) con la zona repetida: quedó el último precio.</div>' : '') +
    (desconocidas.length ? _bloqueVincularZonas(desconocidas) : '') +
    (conError.length ? '<div style="font-size:11px;color:#b91c1c;margin-top:8px"><strong>No se pudieron leer:</strong><br>' +
      conError.map(r => '· ' + r.archivo + ' — ' + r.error).join('<br>') + '</div>' : '');
  document.getElementById('modal-backdrop').classList.add('open');

  showToast('✅ ' + clientes.length + ' tarifario(s) · ' + zonasTotal + ' tarifas' +
    (provisionales.length ? ' · ⚠️ ' + provisionales.length + ' con código provisional' : ''));
}

// ── Liquidación de cliente (PDF) ────────────────────────────────────────────
// Es el ÚNICO papel que sale de la app hacia afuera: se manda por mail junto
// con la factura y lo abre alguien que no trabaja acá. Por eso lleva la marca
// (`src/marca.js`), los datos del emisor y una sola lectura posible del total.
//
// Y por eso NO lleva una palabra interna: "cargá esas zonas en el tarifario del
// cliente" es una instrucción para el operador, no algo que el cliente tenga
// que leer en su liquidación. Lo que el cliente sí tiene que ver es el hecho
// —"tarifa a definir"—, que es distinto.
//
// jsPDF escribe con Helvetica en WinAnsi: los acentos y el · entran, pero las
// flechas (→) y los símbolos (⚠) NO — salen como basura. Por eso el rango se
// escribe "del X al Y" y los avisos van sin ícono.
const LIQCLI = { izq: 14, der: 196, ancho: 182, pieRegla: 277, tablaAbajo: 24 };

// toLocaleDateString('es-AR') devuelve "28/8/2026": en un documento formal las
// fechas van parejas, con dos dígitos siempre.
function _fechaCorta(d) {
  const x = (d instanceof Date) ? d : new Date(d);
  if (isNaN(x.getTime())) return '';
  return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear();
}

// Recorta con puntos suspensivos. Los cuadros de arriba tienen alto fijo, y
// tomar la primera línea de splitTextToSize dejaba el renglón cortado a la
// mitad con el separador colgando ("Marcela Díaz · 11 4444-3333 ·"), que se lee
// como un error de carga.
function _recorte(doc, txt, ancho) {
  let s = String(txt || '').trim();
  if (!s || doc.getTextWidth(s) <= ancho) return s;
  while (s.length > 1 && doc.getTextWidth(s + '…') > ancho) s = s.slice(0, -1);
  return s.replace(/[\s·]+$/, '') + '…';
}

const _DIAS_LIQ = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

// Rótulo del día tal como se lee en el papel: "VIERNES 21/08/2026". Se arma a
// partir de r.fecha, que viene DD/MM/AAAA de los recorridos.
function _diaLiqLabel(fecha) {
  const d = (typeof parseFechaReg === 'function') ? parseFechaReg(fecha) : null;
  if (!d) return String(fecha || 'Sin fecha');
  return _DIAS_LIQ[d.getDay()] + ' ' + _fechaCorta(d);
}

// Clave de orden del día: el ISO, para que los días salgan en orden cronológico
// y no alfabético (con DD/MM/AAAA, el 03/09 iría antes que el 21/08).
function _diaLiqOrden(fecha) {
  const d = (typeof parseFechaReg === 'function') ? parseFechaReg(fecha) : null;
  if (!d) return '9999-99-99';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const _pdfTexto = (doc, c) => doc.setTextColor(c[0], c[1], c[2]);
const _pdfRelleno = (doc, c) => doc.setFillColor(c[0], c[1], c[2]);
const _pdfTrazo = (doc, c) => doc.setDrawColor(c[0], c[1], c[2]);

// Identificador del documento. El mismo cliente y el mismo período dan siempre
// el mismo número, se baje las veces que se baje: un número que cambiara en
// cada descarga no serviría para citar el papel cuando el cliente lo reclame.
// No hace falta un contador en la base — el par (cuenta, corte) ya es único.
function _liqCliNumero(cod, rango) {
  const c = clienteKey(cod).replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'CLI';
  return 'LH-' + c + '-' + String(isoDeRango(rango, 'hasta') || '').replace(/-/g, '');
}

// Encabezado de la primera página: marca a la izquierda, identificación del
// documento a la derecha.
function _liqCliEncabezado(doc, ctx) {
  const L = LIQCLI.izq, R = LIQCLI.der;
  try { doc.addImage(MARCA.logo, 'PNG', L, 12, 44, 44 / MARCA.logoRatio); } catch (e) {}
  _pdfTexto(doc, MARCA.navy); doc.setFont(undefined, 'bold'); doc.setFontSize(13);
  doc.text('LIQUIDACIÓN DE SERVICIOS', R, 16.5, { align: 'right' });
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); _pdfTexto(doc, MARCA.gris);
  doc.text('N° ' + ctx.numero, R, 21.5, { align: 'right' });
  doc.text('Emitida el ' + ctx.emitida, R, 25.5, { align: 'right' });
  // Regla de marca: la barra navy a todo el ancho con el acento azul del logo.
  _pdfRelleno(doc, MARCA.navy); doc.rect(L, 29.5, LIQCLI.ancho, 1.1, 'F');
  _pdfRelleno(doc, MARCA.azul); doc.rect(L, 29.5, 46, 1.1, 'F');
}

// Encabezado reducido de las páginas 2 y siguientes: una liquidación de 300
// envíos ocupa varias hojas y cada hoja tiene que poder identificarse sola —
// si se imprime y se traspapela, una página suelta sin cliente no dice nada.
function _liqCliEncabezadoCont(doc, ctx) {
  const L = LIQCLI.izq, R = LIQCLI.der;
  try { doc.addImage(MARCA.logo, 'PNG', L, 10, 30, 30 / MARCA.logoRatio); } catch (e) {}
  _pdfTexto(doc, MARCA.navy); doc.setFont(undefined, 'bold'); doc.setFontSize(9);
  doc.text(_recorte(doc, ctx.cliente, 110), R, 13.5, { align: 'right' });
  doc.setFont(undefined, 'normal'); doc.setFontSize(7.5); _pdfTexto(doc, MARCA.gris);
  doc.text('N° ' + ctx.numero + '  ·  ' + ctx.periodoTxt, R, 17.5, { align: 'right' });
  _pdfRelleno(doc, MARCA.navy); doc.rect(L, 20, LIQCLI.ancho, 0.6, 'F');
}

// Las dos fichas de arriba: a quién se le factura y qué período.
function _liqCliFichas(doc, ctx) {
  const L = LIQCLI.izq, W = 87, X2 = 109, Y = 35, H = 26;
  _pdfRelleno(doc, MARCA.azulPapel);
  doc.roundedRect(L, Y, W, H, 1.6, 1.6, 'F');
  doc.roundedRect(X2, Y, W, H, 1.6, 1.6, 'F');

  const ficha = (rotulo, titulo, lineas, x) => {
    _pdfTexto(doc, MARCA.azul); doc.setFont(undefined, 'bold'); doc.setFontSize(6.5);
    doc.text(_recorte(doc, rotulo, W - 10), x + 5, Y + 5.8);
    _pdfTexto(doc, MARCA.navy); doc.setFontSize(10);
    doc.text(_recorte(doc, titulo, W - 10), x + 5, Y + 12);
    doc.setFont(undefined, 'normal'); doc.setFontSize(7.5); _pdfTexto(doc, MARCA.texto);
    let ly = Y + 17;
    lineas.filter(Boolean).slice(0, 3).forEach(t => {
      doc.text(_recorte(doc, t, W - 10), x + 5, ly); ly += 3.9;
    });
  };
  ficha('FACTURAR A  ·  CUENTA ' + ctx.cuenta, ctx.cliente, ctx.datosCliente, L);
  ficha('PERÍODO FACTURADO', ctx.periodoTxt, ctx.datosPeriodo, X2);
}

// Pie de página. Va en TODAS las hojas: es donde el documento dice quién lo
// emite, que es lo que lo hace formal, y aclara que no reemplaza a la factura.
function _liqCliPie(doc, pag, total) {
  const L = LIQCLI.izq, R = LIQCLI.der, Y = LIQCLI.pieRegla;
  _pdfTrazo(doc, MARCA.linea); doc.setLineWidth(0.2); doc.line(L, Y, R, Y);
  const fiscal = empresaLineaFiscal(), contacto = empresaLineaContacto();
  doc.setFont(undefined, 'bold'); doc.setFontSize(7); _pdfTexto(doc, MARCA.navy);
  if (fiscal) doc.text(doc.splitTextToSize(fiscal, 140)[0], L, Y + 4.5);
  doc.setFont(undefined, 'normal'); _pdfTexto(doc, MARCA.gris);
  if (contacto) doc.text(doc.splitTextToSize(contacto, 140)[0], L, Y + 8);
  doc.setFontSize(6.5);
  doc.text('Detalle de servicios prestados. No válido como factura.', L, Y + 11.5);
  doc.setFontSize(7.5);
  doc.text('Página ' + pag + ' de ' + total, R, Y + 4.5, { align: 'right' });
}

// PDF de la liquidación de UN cliente. Recibe el CÓDIGO (no el nombre: el
// nombre de fantasía tiene variantes y no es la identidad) y el rango del
// período. opts.doc permite encadenar varias liquidaciones en un solo archivo.
function exportLiquidacionClientePDF(cod, rango, opts) {
  opts = opts || {};
  const codK = clienteKey(cod);
  if (!codK) { alert('Elegí un cliente primero.'); return; }
  rango = rango || semanaClienteRango(hoyISO());
  const cliente = clienteNombreDe(codK);
  const liq = calcLiquidacionCliente(codK, rango, { detalle: true });
  // Puede no haber envíos y sí cargos (un período en el que solo se le cobró
  // una colecta o un viaje particular): esa liquidación también se emite.
  if (!liq.filas.length && !(liq.cargos || []).length) {
    if (!opts.doc) alert('Sin envíos entregados ni cargos de este cliente en el período ' + rango.desde + ' al ' + rango.hasta + '.');
    return;
  }
  const cli = (AppData.clientes || []).find(c => clienteKey(c.codigo) === codK);
  const { jsPDF } = window.jspdf;
  const doc = opts.doc || new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  if (opts.doc && opts.nuevaPagina) doc.addPage();
  const pag0 = doc.internal.getCurrentPageInfo().pageNumber;
  const conEncabezado = new Set([pag0]);
  const encabezarPagina = () => {
    const p = doc.internal.getCurrentPageInfo().pageNumber;
    if (conEncabezado.has(p)) return;
    conEncabezado.add(p);
    _liqCliEncabezadoCont(doc, ctx);
  };

  const armada = (typeof liquidacionArmada === 'function') ? liquidacionArmada(codK, rango) : null;
  const dias = (typeof periodoDiasDe === 'function') ? periodoDiasDe(codK) : 7;
  const datosCliente = [];
  if (cli && cli.razon_social && normCliente(cli.razon_social) !== normCliente(cliente)) datosCliente.push(cli.razon_social);
  if (cli && cli.cuit) datosCliente.push('CUIT ' + cli.cuit);
  if (cli && cli.contacto) datosCliente.push(cli.contacto + (cli.telefono ? '  ·  ' + cli.telefono : ''));
  else if (cli && cli.telefono) datosCliente.push(cli.telefono);
  if (cli && cli.email) datosCliente.push(cli.email);

  const ctx = {
    cliente: cliente,
    numero: _liqCliNumero(codK, rango),
    cuenta: codK,
    emitida: _fechaCorta(new Date()),
    periodoTxt: 'Del ' + rango.desde + ' al ' + rango.hasta,
    datosCliente: datosCliente,
    datosPeriodo: [
      (typeof periodoLabel === 'function' ? periodoLabel(dias) : 'Semanal') + '  ·  ' +
        (dias === 7 ? 'viernes a jueves' : (dias / 7) + ' semanas, viernes a jueves'),
      liq.totalEnvios + ' servicio(s)' + ((liq.cargos || []).length ? '  ·  ' + liq.cargos.length + ' cargo(s)' : ''),
      armada && armada.armada_en ? 'Preparada el ' + _fechaCorta(armada.armada_en) : ''
    ]
  };

  _liqCliEncabezado(doc, ctx);
  _liqCliFichas(doc, ctx);

  // ── Detalle POR DÍA, envío por envío ─────────────────────────────────────
  // El cliente concilia contra su propio sistema, y para eso necesita el
  // TRACKING y el día: un resumen por zona le dice cuánto pagar pero no le deja
  // ubicar un envío puntual cuando reclama uno. El resumen por zona sigue
  // estando, más abajo, que es donde se lee el total de un vistazo.
  // `meta` corre en paralelo al body para pintar cada fila según lo que es.
  const body = [], meta = [];
  const porDia = new Map();
  (liq.envios || []).forEach(e => {
    const k = _diaLiqOrden(e.fecha);
    if (!porDia.has(k)) porDia.set(k, { fecha: e.fecha, envios: [], total: 0, n: 0 });
    const g = porDia.get(k);
    g.envios.push(e); g.total += _num(e.precio); g.n++;
  });
  Array.from(porDia.keys()).sort().forEach(k => {
    const g = porDia.get(k);
    meta.push('dia');
    body.push([_diaLiqLabel(g.fecha), String(g.n), '', fmtPeso(g.total)]);
    // Dentro del día, por zona y después por tracking: así los envíos de una
    // misma zona quedan juntos y el papel se recorre sin saltar.
    g.envios.sort((a, b) => String(a.zona).localeCompare(String(b.zona)) ||
                            String(a.tracking).localeCompare(String(b.tracking)));
    g.envios.forEach(e => {
      const partes = [e.tracking || '(sin tracking)', e.zona];
      if (e.dim) partes.push(e.dim);
      if (e.destinatario) partes.push(e.destinatario);
      meta.push(e.anulado ? 'anulado' : (e.precio > 0 ? 'ok' : 'sintarifa'));
      body.push([
        '   ' + partes.join('  ·  '),
        '1',
        e.anulado ? 'Bonificado ' + fmtPeso(_num(e.bonificado)) : (e.precio > 0 ? fmtPeso(e.precio) : 'A definir'),
        fmtPeso(_num(e.precio))
      ]);
    });
  });
  // Cargos que no vienen de un envío (colecta, viajes particulares): van con su
  // propio concepto y en su propio bloque, no metidos en un día — su fecha es la
  // del servicio y la imputación es al período. El cliente tiene que ver por qué
  // le cobran eso y cuándo se le prestó.
  if ((liq.cargos || []).length) {
    meta.push('dia');
    body.push(['CARGOS Y ADICIONALES', String(liq.cargos.length), '', fmtPeso(_num(liq.totalCargos))]);
    liq.cargos.forEach(c => {
      const cant = _num(c.cantidad) || 1;
      meta.push('cargo');
      body.push([
        '   ' + cargoLabel(c.concepto) + (cargoDatosTxt(c) ? '  ·  ' + cargoDatosTxt(c) : ''),
        String(cant),
        fmtPeso(cant !== 1 ? _num(c.precio_unitario) : _num(c.monto)),
        fmtPeso(_num(c.monto))
      ]);
    });
  }

  doc.autoTable({
    startY: 66,
    head: [['Detalle del servicio  ·  tracking, zona y destinatario', 'Env.', 'Tarifa', 'Importe']],
    body: body,
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 2.4, bottom: 2.4, left: 3, right: 3 }, lineWidth: 0 },
    headStyles: { fillColor: MARCA.navy, textColor: 255, fontSize: 8, fontStyle: 'bold', cellPadding: { top: 3, bottom: 3, left: 3, right: 3 } },
    bodyStyles: { textColor: MARCA.texto },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 14, halign: 'right' },
      2: { cellWidth: 30, halign: 'right' },
      3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
    },
    margin: { left: LIQCLI.izq, right: LIQCLI.izq, top: 25, bottom: LIQCLI.tablaAbajo },
    didParseCell: function (data) {
      if (data.section !== 'body') return;
      const m = meta[data.row.index];
      if (m === 'dia') {
        data.cell.styles.fillColor = MARCA.azulPapel;
        data.cell.styles.textColor = MARCA.navy;
        data.cell.styles.fontStyle = 'bold';
      }
      else if (m === 'anulado') { data.cell.styles.textColor = MARCA.gris; data.cell.styles.fontStyle = 'italic'; }
      else if (m === 'sintarifa' && data.column.index >= 2) { data.cell.styles.textColor = MARCA.ambar; }
      else if (m === 'cargo' && data.column.index === 0) { data.cell.styles.textColor = MARCA.azul; }
    },
    didDrawPage: function () { encabezarPagina(); }
  });

  // ── Resumen por zona ─────────────────────────────────────────────────────
  // El detalle sirve para conciliar un envío; esto, para entender la factura de
  // un vistazo: cuántos envíos por zona, a qué tarifa. Son las dos lecturas que
  // se le hacen a una liquidación y ninguna reemplaza a la otra.
  if (liq.filas.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Resumen por zona', 'Env.', 'Tarifa', 'Subtotal']],
      body: liq.filas.map(f => f.anulado
        ? [String(f.zona).replace(' · ANULADO', '') + '  ·  Sin cargo', String(f.count),
           'Bonificado ' + fmtPeso(_num(f.bonificado)), fmtPeso(0)]
        : [f.zona, String(f.count), f.precio > 0 ? fmtPeso(f.precio) : 'A definir', fmtPeso(f.subtotal)]),
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 1.9, bottom: 1.9, left: 3, right: 3 }, lineWidth: 0 },
      headStyles: { fillColor: MARCA.azul, textColor: 255, fontSize: 7.5, fontStyle: 'bold', cellPadding: { top: 2.4, bottom: 2.4, left: 3, right: 3 } },
      bodyStyles: { textColor: MARCA.texto },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 14, halign: 'right' },
        2: { cellWidth: 30, halign: 'right' },
        3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
      },
      margin: { left: LIQCLI.izq, right: LIQCLI.izq, top: 25, bottom: LIQCLI.tablaAbajo },
      didDrawPage: function () { encabezarPagina(); }
    });
  }

  // ── Cierre: resumen a la izquierda, totales a la derecha ─────────────────
  let y = doc.lastAutoTable.finalY + 8;
  if (y + 34 > LIQCLI.pieRegla - 6) { doc.addPage(); encabezarPagina(); y = 28; }

  const notas = [];
  if (liq.arrastrados) notas.push({ t: 'Incluye ' + liq.arrastrados + ' servicio(s) de períodos anteriores.', c: MARCA.texto });
  if (liq.anulados) notas.push({ t: liq.anulados + ' servicio(s) bonificados por ' + fmtPeso(liq.bonificado) + ': no se facturan.', c: MARCA.verde });
  if (liq.sinTarifa) notas.push({ t: liq.sinTarifa + ' servicio(s) con tarifa a definir para su zona: se facturarán una vez acordada.', c: MARCA.ambar });
  if (empresaDato('empresa_pago')) notas.push({ t: 'Pago: ' + empresaDato('empresa_pago'), c: MARCA.texto });
  if (notas.length) {
    _pdfTexto(doc, MARCA.azul); doc.setFont(undefined, 'bold'); doc.setFontSize(6.5);
    doc.text('OBSERVACIONES', LIQCLI.izq, y + 3);
    doc.setFont(undefined, 'normal'); doc.setFontSize(7.5);
    let ly = y + 8;
    notas.forEach(n => {
      _pdfTexto(doc, n.c);
      doc.splitTextToSize(n.t, 90).forEach(l => { doc.text(l, LIQCLI.izq, ly); ly += 3.9; });
    });
  }

  const RX = 112;
  let ty = y + 3;
  const renglon = (lab, val) => {
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.5); _pdfTexto(doc, MARCA.gris);
    doc.text(lab, RX, ty);
    _pdfTexto(doc, MARCA.texto);
    doc.text(val, LIQCLI.der, ty, { align: 'right' });
    ty += 5.4;
  };
  renglon('Subtotal servicios', fmtPeso(liq.totalEnvio));
  if (liq.totalCargos) renglon('Cargos y adicionales', fmtPeso(liq.totalCargos));
  _pdfTrazo(doc, MARCA.linea); doc.setLineWidth(0.2); doc.line(RX, ty - 3.2, LIQCLI.der, ty - 3.2);
  _pdfRelleno(doc, MARCA.navy); doc.roundedRect(RX, ty, 84, 15, 1.8, 1.8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, 'bold'); doc.setFontSize(7.5);
  doc.text('TOTAL A FACTURAR', RX + 5, ty + 5.5);
  doc.setFontSize(15);
  doc.text(fmtPeso(liq.total), LIQCLI.der - 5, ty + 11.8, { align: 'right' });

  // El pie se estampa al final porque recién acá se sabe cuántas hojas ocupó
  // ESTA liquidación — en el PDF combinado la numeración es por cliente, no
  // por archivo: al cliente se le manda su liquidación, no el lote entero.
  const pagN = doc.internal.getCurrentPageInfo().pageNumber;
  for (let p = pag0; p <= pagN; p++) { doc.setPage(p); _liqCliPie(doc, p - pag0 + 1, pagN - pag0 + 1); }
  doc.setPage(pagN);

  if (opts.doc) return doc;   // el combinado guarda una sola vez, al final
  doc.save('Liquidacion_' + cliente.replace(/\s+/g, '_') + '_' + rango.hasta.replace(/\//g, '-') + '.pdf');
}

// ════════════════════════════════════════════════════════════════════════
//  CONCILIACIÓN — lo que se PAGA y no se COBRA
//  Un envío entregado siempre se le paga al conductor. Que además se le
//  facture a alguien depende de tres cosas que se cargan por separado: que el
//  envío traiga cliente, que ese cliente esté de alta y que tenga tarifa en esa
//  zona. Si falla cualquiera, el envío se paga y se factura $0 — y no aparece
//  en la liquidación de ningún cliente, así que nadie lo extraña.
//  Medido sobre producción: 1.690 de 8.335 envíos pagados desde el 20/08.
// ════════════════════════════════════════════════════════════════════════

// Por qué un envío no se cobra. El orden importa: se informa la PRIMERA causa,
// que es la que hay que resolver para destrabarlo.
const FUGA_MOTIVOS = {
  sin_zona:    { label: 'Sin zona',                 detalle: 'El envío no tiene zona ni localidad: no hay con qué buscar la tarifa.', color: '#b91c1c' },
  sin_cliente: { label: 'Sin cliente',              detalle: 'El envío no dice a quién facturarle. Los cargados a mano piden el cliente; los importados lo traen en la columna K.', color: '#b91c1c' },
  no_alta:     { label: 'Cliente sin ficha',        detalle: 'El cliente aparece en los envíos pero no está dado de alta en Clientes y tarifas.', color: '#c2410c' },
  sin_tarifa:  { label: 'Sin tarifa en esa zona',   detalle: 'El cliente está de alta pero no tiene precio de venta cargado para esa zona.', color: '#b45309' },
};

// Recorre los envíos que SE PAGAN en el rango y los clasifica. `pagado` es lo
// que cuesta ese envío, así que la suma de cada motivo es la plata en juego.
function conciliacionCobro(rango) {
  const desde = rango && rango.desdeD ? rango.desdeD : null;
  const hasta = rango && rango.hastaD ? rango.hastaD : null;
  const enAlta = new Set((AppData.clientes || []).map(c => clienteKey(c.codigo)).filter(Boolean));

  const res = {
    envios: 0, pagadoTotal: 0, cobradoTotal: 0,
    fugaEnvios: 0, fugaPagado: 0,
    anuladosEnvios: 0, anuladosPagado: 0,
    porMotivo: {}, porCliente: new Map(), casos: []
  };
  Object.keys(FUGA_MOTIVOS).forEach(m => { res.porMotivo[m] = { envios: 0, pagado: 0 }; });

  (AppData.records || []).forEach((r, i) => {
    if (!contabilizaRegistro(r)) return;
    if (desde || hasta) {
      const f = parseFechaReg(r.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    const pagado = precioPagadoConductor(r);
    res.envios++; res.pagadoTotal += pagado;

    // Anulado a propósito (gesto con el cliente): NO es una fuga. Se cuenta
    // aparte, con la plata que la empresa decidió absorber.
    if (envioAnuladoCliente(r)) { res.anuladosEnvios++; res.anuladosPagado += pagado; return; }

    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const cod = clienteCodDeRegistro(r);
    const cobrado = cod ? precioVentaEnvio(cod, r) : 0;

    let motivo = null;
    if (!zona) motivo = 'sin_zona';
    else if (!cod) motivo = 'sin_cliente';
    else if (!enAlta.has(cod)) motivo = 'no_alta';
    else if (!(cobrado > 0)) motivo = 'sin_tarifa';

    if (!motivo) { res.cobradoTotal += cobrado; return; }

    res.fugaEnvios++; res.fugaPagado += pagado;
    res.porMotivo[motivo].envios++; res.porMotivo[motivo].pagado += pagado;

    const clave = cod || '(sin cliente)';
    let c = res.porCliente.get(clave);
    if (!c) { c = { cod: clave, nombre: cod ? clienteNombreDe(cod) : '(sin cliente)', envios: 0, pagado: 0, motivos: new Set(), zonas: new Map() }; res.porCliente.set(clave, c); }
    c.envios++; c.pagado += pagado; c.motivos.add(motivo);
    if (zona) c.zonas.set(zona, (c.zonas.get(zona) || 0) + 1);
    if (res.casos.length < 500) res.casos.push({ i, r, zona, cod, pagado, motivo });
  });

  res.clientes = Array.from(res.porCliente.values()).sort((a, b) => b.pagado - a.pagado);
  res.sinPagar = _conciliacionSinPagar(desde, hasta);
  return res;
}

// Diagnóstico de UN envío, para avisar en el momento de editarlo. Devuelve
// { cobra, pagado, cobrado, motivo, texto } — 'cobra' false = se paga y no se cobra.
function diagnosticoCobroEnvio(r) {
  if (!r || !contabilizaRegistro(r)) return { cobra: true, noContabiliza: true, pagado: 0, cobrado: 0 };
  const pagado = precioPagadoConductor(r);
  // Anulado a propósito: no se avisa como problema, se confirma el gesto.
  if (envioAnuladoCliente(r)) return { cobra: true, anulado: true, pagado, cobrado: 0 };
  const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
  const cod = clienteCodDeRegistro(r);
  const cobrado = cod ? precioVentaEnvio(cod, r) : 0;
  let motivo = null;
  if (!zona) motivo = 'sin_zona';
  else if (!cod) motivo = 'sin_cliente';
  else if (!(AppData.clientes || []).some(c => clienteKey(c.codigo) === cod)) motivo = 'no_alta';
  else if (!(cobrado > 0)) motivo = 'sin_tarifa';
  return {
    cobra: !motivo, motivo, pagado, cobrado, zona, cod,
    texto: motivo ? (FUGA_MOTIVOS[motivo] || {}).label : ''
  };
}

// ── El reverso: lo que se COBRA y no se PAGA ────────────────────────────────
// Todo envío entregado se le factura al cliente, tenga o no conductor asignado
// — eso está bien y es lo que corresponde. Pero el conductor cobra por DÍA DE
// PAGO (Titular y Semi Titular=viernes · Suplente=martes), y esa condición
// se carga a mano en el Panel de conductores. Un cadete que reparte pero que
// nunca fue dado de alta ahí —o que está sin condición— no cae en ningún lote:
// el operador liquida por condición y nunca lo ve. Sus envíos se facturan y no
// se pagan, y no aparecen como faltante en ningún lado.
// Medido al implementarlo: 11 conductores con 1.146 envíos desde el 20/08.
function _conciliacionSinPagar(desde, hasta) {
  const porCond = new Map();
  let envios = 0, cobrado = 0;
  (AppData.records || []).forEach(r => {
    if (!contabilizaRegistro(r)) return;
    if (desde || hasta) {
      const f = parseFechaReg(r.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    const cond = (typeof conductorCanonico === 'function') ? conductorCanonico(r.cadete) : String(r.cadete || '').trim();
    const panel = (typeof panelConductorDe === 'function') ? panelConductorDe(cond) : null;
    const sinDiaDePago = !panel || !String(panel.condicion || '').trim();
    if (!sinDiaDePago) return;

    const cod = clienteCodDeRegistro(r);
    const c = cod ? precioVentaEnvio(cod, r) : 0;
    envios++; cobrado += c;
    const clave = cond || '(sin conductor)';
    let x = porCond.get(clave);
    if (!x) x = { conductor: clave, envios: 0, cobrado: 0, enPanel: !!panel }, porCond.set(clave, x);
    x.envios++; x.cobrado += c;
  });
  return {
    envios, cobrado,
    conductores: Array.from(porCond.values()).sort((a, b) => b.envios - a.envios)
  };
}

// ════════════════════════════════════════════════════════════════════════
//  ARRASTRE DE ENVÍOS Y CARGOS EXTRA
// ════════════════════════════════════════════════════════════════════════

// Viernes que abre la semana de un rango, en ISO. Es la CLAVE con la que se
// imputan los arrastres y los cargos: identifica la semana con un solo dato.
// Los dos extremos del rango en ISO (YYYY-MM-DD). `rango.desde/hasta` son para
// mostrar (DD/MM/AAAA) y no sirven ni para un input[type=date] ni para comparar.
function isoDeRango(rango, cual) {
  const d = rango && (cual === 'hasta' ? rango.hastaD : rango.desdeD);
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function viernesDeRango(rango) {
  const d = rango && rango.desdeD ? rango.desdeD : null;
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── Cargos extra (colecta, viajes particulares, otros) ─────────────────────
const CARGO_CONCEPTOS = {
  colecta: { label: 'Colecta',           detalle: 'Lo que se le cobra al cliente por pasar a retirar los envíos.' },
  viaje:   { label: 'Viaje particular',  detalle: 'Viaje hecho por fuera de la plataforma, lo haya hecho o no un conductor de la empresa.' },
  otro:    { label: 'Otro cargo',        detalle: 'Cualquier otro concepto que se le factura al cliente.' },
};
function cargoLabel(c) { return (CARGO_CONCEPTOS[c] || {}).label || c || 'Cargo'; }

// Los datos que acompañan al concepto en la tabla y en la factura: la fecha
// siempre, y para el viaje particular a dónde fue. Reemplazan al viejo campo
// libre "detalle": escrito a mano cada operador ponía otra cosa y el cliente no
// podía reconocer qué le estaban cobrando. Una sola fuente para los dos lados.
function cargoFechaTxt(f) {
  const s = String(f || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
}
function cargoDatosTxt(c) {
  const p = [];
  const f = cargoFechaTxt(c.fecha);
  if (f) p.push(f);
  if (c.concepto === 'viaje') {
    const dir = String(c.direccion || '').trim();
    const z = String(c.zona || '').trim();
    if (dir && z) p.push(dir + ' (' + z + ')');
    else if (dir || z) p.push(dir || z);
  }
  return p.join(' · ');
}

function cargosDeSemana(cod, semana) {
  const k = clienteKey(cod);
  if (!k || !semana) return [];
  return (AppData.clienteCargos || [])
    .filter(c => clienteKey(c.cliente_cod) === k && String(c.semana || '').slice(0, 10) === semana)
    .sort((a, b) => String(a.concepto).localeCompare(String(b.concepto)) || _num(a.id) - _num(b.id));
}

function persistirCargosLocal() {
  try { localStorage.setItem('liq_cliente_cargos', JSON.stringify(AppData.clienteCargos || [])); } catch (e) {}
}

async function guardarCargoCliente(rec) {
  const row = await DB.insertRow('cliente_cargos', rec);
  // Un cargo cambia el total: si la liquidación ya estaba cerrada, se reabre.
  if (typeof _reabrirPorCambio === 'function')
    await _reabrirPorCambio(rec.cliente_cod, periodoClienteRango(rec.cliente_cod, rec.semana), 'un cargo');
  AppData.clienteCargos = (AppData.clienteCargos || []).concat([Object.assign({ id: row.id }, rec)]);
  persistirCargosLocal();
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
  return row.id;
}

async function borrarCargoCliente(id) {
  const c = (AppData.clienteCargos || []).find(x => x.id === id);
  await DB.deleteWhere('cliente_cargos', 'id', id);
  if (c && typeof _reabrirPorCambio === 'function')
    await _reabrirPorCambio(c.cliente_cod, periodoClienteRango(c.cliente_cod, c.semana), 'un cargo quitado');
  AppData.clienteCargos = (AppData.clienteCargos || []).filter(c => c.id !== id);
  persistirCargosLocal();
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
}

// ── Arrastre: mover en qué semana se COBRA un envío ────────────────────────
// El envío sigue perteneciendo a su fecha (el conductor cobra por la fecha
// real); lo único que se mueve es en qué liquidación de cliente entra.
async function arrastrarEnviosASemana(indices, semanaISO) {
  // Un arrastre mueve el cobro entre DOS períodos: el que lo pierde y el que
  // lo recibe. Los dos cambian de total, así que los dos se reabren.
  const afectados = [];
  const ids = [];
  indices.forEach(i => {
    const r = AppData.records[i];
    if (!r || !r.id) return;
    const cod = clienteCodDeRegistro(r);
    const antes = String(r.factura_semana || '').slice(0, 10) ||
      (typeof isoDeFecha === 'function' ? isoDeFecha(parseFechaReg(r.fecha)) : null);
    if (cod && antes) afectados.push([cod, antes]);
    if (cod && semanaISO) afectados.push([cod, semanaISO]);
    r.factura_semana = semanaISO || null;
    ids.push(r.id);
  });
  for (const id of ids) await DB.updateWhere('registros', 'id', id, { factura_semana: semanaISO || null });
  if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
  if (typeof _reabrirPorCambio === 'function') {
    const vistos = new Set();
    for (const [cod, iso] of afectados) {
      const clave = clienteKey(cod) + '|' + iso;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      await _reabrirPorCambio(cod, periodoClienteRango(cod, iso), 'un envío traído de otra semana');
    }
  }
  return ids.length;
}

// ════════════════════════════════════════════════════════════════════════
//  PERÍODO DE FACTURACIÓN POR CLIENTE
//  Hay clientes semanales, quincenales y mensuales. Se cuenta por SEMANAS
//  ENTERAS Vie→Jue —el mismo ciclo con el que se le paga al conductor—, así el
//  corte nunca parte una semana del cadete y el viernes que ABRE el período
//  sigue siendo la clave que ancla los arrastres y los cargos.
// ════════════════════════════════════════════════════════════════════════
const PERIODOS_CLIENTE = {
  7:  { label: 'Semanal',    detalle: 'Viernes a jueves' },
  14: { label: 'Quincenal',  detalle: 'Dos semanas, de viernes a jueves' },
  28: { label: 'Mensual',    detalle: 'Cuatro semanas, de viernes a jueves' },
};
function periodoLabel(dias) { return (PERIODOS_CLIENTE[_num(dias) || 7] || PERIODOS_CLIENTE[7]).label; }

function periodoDiasDe(cod) {
  const k = clienteKey(cod);
  const c = (AppData.clientes || []).find(x => clienteKey(x.codigo) === k);
  const d = _num(c && c.periodo_dias) || 7;
  return PERIODOS_CLIENTE[d] ? d : 7;
}

// Semanas transcurridas desde un viernes de referencia (02/01/1970 fue viernes).
// Da una grilla ESTABLE: qué viernes abre un período no depende de qué día se
// mire, así que la liquidación de un quincenal cae siempre en las mismas fechas.
function _semanasDesdeEpoca(viernes) {
  const base = Date.UTC(1970, 0, 2);
  const v = Date.UTC(viernes.getFullYear(), viernes.getMonth(), viernes.getDate());
  return Math.floor((v - base) / 604800000);
}

// Período de facturación de un cliente que CONTIENE la fecha dada.
// Sin cliente (o semanal) devuelve la semana de siempre.
function periodoClienteRango(cod, iso) {
  const semana = semanaClienteRango(iso);
  const dias = periodoDiasDe(cod);
  if (dias === 7) return Object.assign({}, semana, { dias: 7, semanas: 1 });
  const n = dias / 7;
  const atras = ((_semanasDesdeEpoca(semana.desdeD) % n) + n) % n;
  const desde = new Date(semana.desdeD); desde.setDate(desde.getDate() - atras * 7); desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde); hasta.setDate(desde.getDate() + n * 7 - 1); hasta.setHours(23, 59, 59, 999);
  const fmt = x => String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear();
  return { desde: fmt(desde), hasta: fmt(hasta), desdeD: desde, hastaD: hasta, dias, semanas: n };
}

// Corre un input date al viernes que ABRE el período de ese cliente.
function snapPeriodoCliente(inputId, cod) {
  const el = document.getElementById(inputId);
  if (!el || !el.value) return;
  const v = periodoClienteRango(cod, el.value).desdeD;
  el.value = v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
}

// Guarda el período elegido en la ficha.
async function guardarPeriodoCliente(cod, dias) {
  const k = clienteKey(cod);
  const c = (AppData.clientes || []).find(x => clienteKey(x.codigo) === k);
  if (!c) return;
  const d = PERIODOS_CLIENTE[_num(dias)] ? _num(dias) : 7;
  try {
    await DB.updateWhere('clientes', 'id', c.id, { periodo_dias: d });
    c.periodo_dias = d;
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    if (typeof renderClientes === 'function') renderClientes();
    showToast('✅ ' + clienteNombreDe(k) + ': facturación ' + periodoLabel(d).toLowerCase() +
      ' (' + d + ' días)');
  } catch (e) { console.warn('guardarPeriodoCliente', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

// Selector del período de facturación en la ficha. Va arriba de todo porque
// define el ciclo: de él dependen qué envíos entran, dónde se anclan los cargos
// y qué le muestra el panel del operador.
function _cardPeriodo(k, c) {
  const actual = periodoDiasDe(k);
  const esc = String(k).replace(/'/g, "\'");
  const opts = Object.keys(PERIODOS_CLIENTE).map(d => {
    const info = PERIODOS_CLIENTE[d];
    return '<option value="' + d + '"' + (_num(d) === actual ? ' selected' : '') + '>' +
      info.label + ' · cada ' + d + ' días</option>';
  }).join('');
  const r = periodoClienteRango(k);
  return '<div style="padding:12px 0;border-top:1px solid var(--border)">' +
    '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px">' +
      'Período de facturación</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<select id="card-periodo" onchange="guardarPeriodoCliente(\'' + esc + '\', this.value)" ' +
        'style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">' + opts + '</select>' +
      '<span style="font-size:11.5px;color:var(--text-muted)">' + PERIODOS_CLIENTE[actual].detalle +
      ' · el período en curso va del <strong>' + r.desde + '</strong> al <strong>' + r.hasta + '</strong></span>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">' +
      'Se cuenta por semanas enteras Vie→Jue, el mismo ciclo con el que se le paga al conductor: ' +
      'así el corte no parte una semana del cadete.</div>' +
  '</div>';
}
