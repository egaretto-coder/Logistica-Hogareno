// ════════════════════════════════════════════════════════════════════════
//  CIERRE Y ARCHIVO — sincronizar lo que se COBRA con lo que se PAGA.
//
//  Un envío recorre dos circuitos independientes: se le paga al conductor
//  (liquidación semanal por condición) y se le factura al cliente (período
//  del cliente). Mientras alguno de los dos siga abierto, ese envío es
//  trabajo EN CURSO y tiene que verse.
//
//  Cuando los DOS se cerraron, el envío ya no es información viva: es
//  historia. Dejarlo en la tabla viva solo hace que la app arrastre decenas
//  de miles de filas que nadie va a volver a tocar, y que los paneles
//  muestren como "pendiente" algo que ya se pagó y ya se cobró.
//
//  Por eso el archivo NO va por fecha: va por CIERRE. Se archiva lo que está
//  liquidado de los dos lados, y lo que no, se queda a la vista con el
//  motivo. Archivar por fecha —como se hacía— podía llevarse envíos con
//  plata pendiente de un lado sin que nadie se enterara.
//
//  EL CORTE DEL MODELO ANTERIOR: la app empezó a capturar el cliente de cada
//  envío a mitad de la semana del 17/08/2026. Todo lo anterior se cobró por
//  fuera del sistema, así que no es una fuga ni una deuda: es historia que
//  entró sin esa información. Se resuelve con UNA fecha de corte en config,
//  no marcando 37.000 filas: es reversible, se explica sola y no hay que
//  migrar nada.
// ════════════════════════════════════════════════════════════════════════

// Fecha (ISO) desde la que la app liquida clientes. Antes de eso, el cobro se
// hizo con el modelo anterior y el sistema no lo reclama.
function corteFacturacionISO() {
  const v = String((AppData.config && AppData.config.cliente_corte_iso) || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

// ¿Este envío es anterior al arranque del panel de clientes?
function envioModeloAnterior(r) {
  const corte = corteFacturacionISO();
  if (!corte) return false;
  const iso = (typeof fechaISOde === 'function') ? fechaISOde(r && r.fecha) : null;
  return !!iso && iso < corte;
}

// ── Los dos lados de un envío ───────────────────────────────────────────
// PAGADO: la liquidación del conductor de SU semana está marcada lista.
function envioPagadoAlConductor(r) {
  if (typeof liqConductorArmada !== 'function') return false;
  const cond = (typeof conductorCanonico === 'function') ? conductorCanonico(r && r.cadete) : (r && r.cadete);
  if (!cond) return false;
  const iso = (typeof fechaISOde === 'function') ? fechaISOde(r && r.fecha) : null;
  if (!iso) return false;
  // La semana de ESE conductor que contiene la fecha del envío — no la que el
  // panel tenga en pantalla.
  const sem = (typeof semanaDeCondicion === 'function')
    ? semanaDeCondicion((panelConductorDe(cond) || {}).condicion || '', iso) : null;
  if (!sem) return false;
  const ini = sem.desde.getFullYear() + '-' + String(sem.desde.getMonth() + 1).padStart(2, '0') +
    '-' + String(sem.desde.getDate()).padStart(2, '0');
  return !!liqConductorArmada(cond, ini);
}

// COBRADO: el período del cliente que contiene ese envío está cerrado. Los
// anteriores al corte cuentan como cobrados: se facturaron por fuera.
function envioCobradoAlCliente(r) {
  if (envioModeloAnterior(r)) return true;
  const cod = (typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '';
  if (!cod) return false;                       // sin cliente no hay a quién cobrarle
  const iso = (typeof fechaISOde === 'function') ? fechaISOde(r && r.fecha) : null;
  if (!iso || typeof periodoClienteRango !== 'function') return false;
  const per = periodoClienteRango(cod, iso);
  if (!per || !per.desdeD) return false;
  const ini = _cieISO(per.desdeD);
  return (AppData.clienteLiquidaciones || []).some(x =>
    clienteKey(x.cliente_cod) === clienteKey(cod) &&
    String(x.semana_desde || '').slice(0, 10) === ini);
}

function _cieISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Un envío está CERRADO cuando los dos circuitos terminaron.
function envioCerrado(r) {
  if (envioModeloAnterior(r)) return true;      // se cobró y se pagó con el modelo viejo
  return envioPagadoAlConductor(r) && envioCobradoAlCliente(r);
}

// Por qué NO está cerrado: es lo que hay que ir a destrabar.
function motivoAbierto(r) {
  if (envioCerrado(r)) return null;
  const pag = envioPagadoAlConductor(r);
  const cob = envioCobradoAlCliente(r);
  if (!pag && !cob) return 'ambos';
  if (!pag) return 'sin_pagar';
  return 'sin_cobrar';
}

// ── El estado del archivo ───────────────────────────────────────────────
// Con 55.000 envíos vivos esto no puede resolverse con una búsqueda por fila:
// se arman dos índices (las semanas de conductor marcadas listas y los períodos
// de cliente cerrados) y se hace UNA sola pasada. Los índices son locales a la
// pasada y se descartan al terminar: un índice viejo diría que algo está cerrado
// cuando no lo está, y eso archivaría trabajo en curso.
function _idxCierre() {
  const semCond = new Set();
  (AppData.conductorLiquidaciones || []).forEach(x =>
    semCond.add(normNombre(x.conductor) + '|' + String(x.semana_desde || '').slice(0, 10)));
  const perCli = new Set();
  (AppData.clienteLiquidaciones || []).forEach(x =>
    perCli.add(clienteKey(x.cliente_cod) + '|' + String(x.semana_desde || '').slice(0, 10)));
  return { semCond, perCli, semanaDe: new Map(), periodoDe: new Map() };
}

// Estado + lista archivable en una sola pasada.
function estadoCierre(registros) {
  const base = registros || AppData.records || [];
  const ix = _idxCierre();
  const corte = corteFacturacionISO();
  const res = {
    total: base.length, cerrados: 0, modeloAnterior: 0,
    abiertos: 0, sinPagar: 0, sinCobrar: 0, ambos: 0,
    semanasConductor: new Set(), periodosCliente: new Set(),
    masViejo: null, cerradosFilas: []
  };
  base.forEach(r => {
    const iso = (typeof fechaISOde === 'function') ? fechaISOde(r.fecha) : null;
    if (corte && iso && iso < corte) { res.modeloAnterior++; res.cerrados++; res.cerradosFilas.push(r); return; }

    // ¿Pagado? La semana de SU condición que contiene la fecha del envío.
    let pag = false;
    const cond = conductorCanonico(r.cadete);
    if (cond && iso) {
      const c = (panelConductorDe(cond) || {}).condicion || '';
      const k = c + '|' + iso;
      let ini = ix.semanaDe.get(k);
      if (ini === undefined) { ini = _cieISO(semanaDeCondicion(c, iso).desde); ix.semanaDe.set(k, ini); }
      pag = ix.semCond.has(normNombre(cond) + '|' + ini);
    }

    // ¿Cobrado? El período de ESE cliente que contiene la fecha del envío.
    let cob = false;
    const cod = clienteCodDeRegistro(r);
    if (cod && iso) {
      const k = cod + '|' + iso;
      let ini = ix.periodoDe.get(k);
      if (ini === undefined) {
        const per = periodoClienteRango(cod, iso);
        ini = (per && per.desdeD) ? _cieISO(per.desdeD) : '';
        ix.periodoDe.set(k, ini);
      }
      cob = !!ini && ix.perCli.has(clienteKey(cod) + '|' + ini);
    }

    if (pag && cob) { res.cerrados++; res.cerradosFilas.push(r); return; }
    res.abiertos++;
    if (!pag && !cob) res.ambos++; else if (!pag) res.sinPagar++; else res.sinCobrar++;
    if (iso && (!res.masViejo || iso < res.masViejo)) res.masViejo = iso;
    if (!pag && cond) res.semanasConductor.add(cond);
    if (!cob && cod) res.periodosCliente.add(cod);
  });
  return res;
}

// ¿Conviene archivar? La app lo recomienda sola cuando hay volumen cerrado:
// con decenas de miles de filas vivas la app arrastra peso y los paneles
// muestran como pendiente lo que ya se pagó y se cobró.
const CIERRE_MINIMO_RECOMENDAR = 2000;
function recomendacionArchivo(registros) {
  const e = estadoCierre(registros);
  // Hasta dónde se puede archivar SIN tocar nada abierto: el envío en curso
  // más viejo. Más allá de ahí se llevaría puesto trabajo pendiente.
  const tope = e.masViejo || null;
  const archivables = tope
    ? e.cerradosFilas.filter(r => { const i = fechaISOde(r.fecha); return !!i && i < tope; })
    : e.cerradosFilas;
  return { estado: e, conviene: archivables.length >= CIERRE_MINIMO_RECOMENDAR, hasta: tope, archivables };
}

// Los envíos que se archivarían. Comparte la pasada con recomendacionArchivo.
function enviosArchivables(registros) {
  return recomendacionArchivo(registros).archivables;
}

// ── El panel ────────────────────────────────────────────────────────────
// Vive en Importar datos, al lado del archivo histórico. Muestra el estado
// real: qué está cerrado, qué falta cerrar y de qué lado, y recién ahí ofrece
// archivar. Sin ese detalle, "no se puede archivar" se lee como una falla del
// sistema en vez de como trabajo pendiente.
function renderCierrePanel() {
  const cont = document.getElementById('cierre-panel');
  if (!cont) return;
  const rec = recomendacionArchivo();
  const e = rec.estado;
  const arch = rec.archivables;   // la misma pasada, no otra
  const corte = corteFacturacionISO();
  const fmt = n => Number(n || 0).toLocaleString('es-AR');

  const kpi = (etq, val, sub, color) =>
    '<div class="metric-card"' + (color ? ' style="border-color:' + color + '"' : '') + '>' +
      '<div class="metric-label">' + etq + '</div>' +
      '<div class="metric-value"' + (color ? ' style="color:' + color + '"' : '') + '>' + val + '</div>' +
      '<div class="metric-sub">' + sub + '</div></div>';

  let html = '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">' +
    kpi('Cerrados', fmt(e.cerrados), 'pagados al conductor y facturados al cliente') +
    kpi('En curso', fmt(e.abiertos), 'todavía se están liquidando', e.abiertos ? '#fdba74' : '') +
    kpi('Se archivarían ahora', fmt(arch.length), arch.length ? 'salen de la vista, quedan consultables' : 'nada listo todavía') +
    '</div>';

  // Qué falta para destrabar. Es la información que convierte "0 archivables"
  // en una tarea concreta.
  if (e.abiertos) {
    html += '<div class="alert" style="margin:0 0 12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i><div>' +
      '<strong>' + fmt(e.abiertos) + ' envío(s) siguen en curso.</strong> Para poder archivarlos hay que cerrarlos de los dos lados:' +
      '<div style="display:grid;gap:4px;margin-top:8px;font-size:12px">' +
        (e.sinPagar ? '<div>· <strong>' + fmt(e.sinPagar) + '</strong> sin liquidar al conductor — se marcan en <strong>Liquidación Conductores</strong> (' + e.semanasConductor.size + ' conductor/es)</div>' : '') +
        (e.sinCobrar ? '<div>· <strong>' + fmt(e.sinCobrar) + '</strong> sin facturar al cliente — se cierran en <strong>Detalle de cliente</strong> (' + e.periodosCliente.size + ' cliente/s)</div>' : '') +
        (e.ambos ? '<div>· <strong>' + fmt(e.ambos) + '</strong> sin cerrar de <strong>ninguno</strong> de los dos lados — hay que pasar por <strong>Liquidación Conductores</strong> y por <strong>Detalle de cliente</strong></div>' : '') +
      '</div></div></div>';
  }

  // La recomendación: aparece sola cuando hay volumen que ya no aporta nada
  // vivo. No es un aviso permanente, es una sugerencia con su número.
  if (rec.conviene && arch.length) {
    html += '<div class="alert" style="margin:0 0 12px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0"><i class="ic ic-check-circle"></i><div>' +
      '<strong>Conviene archivar.</strong> Hay ' + fmt(arch.length) + ' envíos ya cerrados ocupando la vista: ' +
      'archivarlos deja la app más liviana y hace que los paneles muestren solo lo que está en curso.</div></div>';
  }

  // ── Quién puede archivar ──────────────────────────────────────────────
  // El administrativo PIDE; el supervisor o el analista AUTORIZAN. Quien ya
  // puede autorizar no se pide permiso a sí mismo: archiva directo.
  const autoriza = (typeof puedeAutorizar === 'function') && puedeAutorizar();
  const pend = solicitudArchivoPendiente();

  if (pend) {
    // El pedido a la vista, con lo que hay que decidir.
    html += '<div class="alert" style="margin:0 0 12px;background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd"><i class="ic ic-clock"></i><div>' +
      '<strong>Hay un pedido de archivo esperando autorización.</strong><br>' +
      'Lo pidió <strong>' + (pend.solicitado_por || '—') + '</strong>: ' + fmt(pend.envios) + ' envíos, anteriores al ' + _cieFmt(pend.hasta) + '.' +
      (pend.motivo ? '<br><span style="opacity:.85">Motivo: ' + pend.motivo + '</span>' : '') +
      '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
        (autoriza
          ? '<button class="btn btn-sm btn-primary" onclick="aprobarArchivo(\'' + pend.id + '\')"><i class="ic ic-check"></i> Autorizar y archivar</button>' +
            '<button class="btn btn-sm" onclick="rechazarArchivo(\'' + pend.id + '\')">Rechazar</button>'
          : '<button class="btn btn-sm" onclick="cancelarArchivo(\'' + pend.id + '\')">Cancelar mi pedido</button>' +
            '<span style="font-size:11px;opacity:.85;align-self:center">Lo tiene que autorizar un supervisor o un analista.</span>') +
      '</div></div></div>';
  }

  html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-sm btn-primary" onclick="pedirArchivoCerrados()"' + ((arch.length && !pend) ? '' : ' disabled') + '>' +
      '<i class="ic ic-folder"></i> ' + (autoriza ? 'Archivar ' + fmt(arch.length) + ' cerrados' : 'Pedir archivar ' + fmt(arch.length) + ' cerrados') + '</button>' +
    '<span style="font-size:11px;color:var(--text-muted)">' +
      (rec.hasta ? 'Se archiva lo anterior al ' + _cieFmt(rec.hasta) + ', que es el envío en curso más viejo.'
                 : 'No hay nada en curso: se archiva todo lo cerrado.') +
      (autoriza ? '' : ' Lo autoriza un supervisor o un analista.') +
    '</span></div>';

  // Lo ya resuelto, para que quede el rastro de quién autorizó qué.
  const hist = (AppData.archivoSolicitudes || []).filter(x => x.estado !== 'pendiente')
    .sort((a, b) => String(b.resuelto_en || '').localeCompare(String(a.resuelto_en || ''))).slice(0, 5);
  if (hist.length) {
    html += '<div style="margin-top:10px;font-size:11px;color:var(--text-muted)"><strong>Últimos archivos:</strong>' +
      hist.map(x => '<div>· ' + _cieFmt(String(x.resuelto_en || '').slice(0, 10)) + ' — ' +
        (x.estado === 'aprobada' ? fmt(x.archivados) + ' envíos archivados' : 'rechazado') +
        ', pedido por ' + (x.solicitado_por || '—') + ' y resuelto por ' + (x.resuelto_por || '—') + '</div>').join('') +
      '</div>';
  }

  // El corte del modelo anterior, para que se entienda de dónde sale el número.
  html += '<div style="margin-top:10px;font-size:11px;color:var(--text-muted)">' +
    (corte
      ? 'Los ' + fmt(e.modeloAnterior) + ' envíos anteriores al <strong>' + _cieFmt(corte) + '</strong> se cobraron con el modelo anterior, por fuera del sistema: cuentan como cerrados y no se reclaman.'
      : '<span style="color:#b45309">No hay fecha de corte cargada: todos los envíos viejos figuran como pendientes de cobro aunque se hayan facturado por fuera.</span>') +
    '</div>';

  cont.innerHTML = html;
}

function _cieFmt(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
}

// ── Régimen de autorización ─────────────────────────────────────────────
// Archivar lo puede PEDIR un administrativo, pero lo AUTORIZA un supervisor o
// un analista. Es el mismo maker-checker que adelantos, extravíos y las
// reaperturas de sueldo: la operación mueve decenas de miles de filas a una
// tabla de solo lectura y desde la app no hay vuelta atrás, así que la decide
// alguien distinto del que la propone.
function solicitudArchivoPendiente() {
  return (AppData.archivoSolicitudes || []).find(x => x.estado === 'pendiente') || null;
}

// Pide archivar. Si quien lo pide ya puede autorizar, se aplica en el acto: no
// tiene sentido pedirse permiso a sí mismo.
async function pedirArchivoCerrados() {
  const rec = recomendacionArchivo();
  const arch = rec.archivables;
  if (!arch.length) { showToast('No hay envíos cerrados para archivar'); return; }
  const tope = rec.hasta;

  if (typeof puedeAutorizar === 'function' && puedeAutorizar()) {
    return _ejecutarArchivo(tope, arch.length, null);
  }

  const ya = solicitudArchivoPendiente();
  if (ya) {
    alert('Ya hay un pedido de archivo esperando autorización (' + _cieFmt(ya.hasta) + ', ' +
      Number(ya.envios).toLocaleString('es-AR') + ' envíos), pedido por ' + (ya.solicitado_por || '—') + '.');
    return;
  }
  const motivo = prompt('¿Por qué archivar ahora? (queda registrado en el pedido)', 'Cierre de período');
  if (motivo === null) return;
  const rec2 = {
    hasta: tope || _cieISO(new Date(Date.now() + 86400000)),
    envios: arch.length,
    solicitado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
    solicitado_en: new Date().toISOString(),
    motivo: String(motivo || '').trim(), estado: 'pendiente', archivados: 0
  };
  try {
    const row = await DB.insertRow('archivo_solicitudes', rec2);
    AppData.archivoSolicitudes = (AppData.archivoSolicitudes || []).concat([Object.assign({ id: row && row.id }, rec2)]);
    _persistirArchivoSolic();
    showToast('📩 Pedido enviado — un supervisor o analista tiene que autorizarlo');
    renderCierrePanel();
  } catch (e) { console.warn('pedirArchivo', e); showToast('⛔ No se pudo enviar el pedido'); }
}

// Autoriza y archiva. RECALCULA antes de ejecutar: entre el pedido y la
// aprobación puede haberse reabierto una liquidación o haber entrado envíos
// nuevos, y archivar por el número viejo se llevaría trabajo en curso. Se toma
// el MENOR entre lo pedido y lo que hoy está cerrado.
async function aprobarArchivo(id) {
  if (typeof puedeAutorizar !== 'function' || !puedeAutorizar()) {
    showToast('⛔ Solo un supervisor o analista puede autorizar'); return;
  }
  const sol = (AppData.archivoSolicitudes || []).find(x => String(x.id) === String(id));
  if (!sol) return;
  const rec = recomendacionArchivo();
  const topeHoy = rec.hasta || _cieISO(new Date(Date.now() + 86400000));
  // El menor de los dos: nunca más allá de lo aprobado, nunca más allá de lo
  // que hoy está efectivamente cerrado.
  const tope = (sol.hasta && sol.hasta < topeHoy) ? sol.hasta : topeHoy;
  const cuantos = rec.archivables.filter(r => fechaISOde(r.fecha) < tope).length;
  if (!cuantos) {
    alert('Ya no queda nada archivable dentro de lo pedido.' + String.fromCharCode(10) + String.fromCharCode(10) +
      'Puede que se haya reabierto una liquidación o que otro usuario ya lo haya archivado. El pedido queda como está.');
    return;
  }
  const cambio = (tope !== sol.hasta)
    ? String.fromCharCode(10) + String.fromCharCode(10) + 'OJO: se pidió hasta el ' + _cieFmt(sol.hasta) +
      ' pero hoy solo está cerrado hasta el ' + _cieFmt(tope) + ', así que se archiva hasta ahí.'
    : '';
  if (!confirm('Autorizar el archivo pedido por ' + (sol.solicitado_por || '—') + '.' + String.fromCharCode(10) +
    'Se archivan ' + cuantos.toLocaleString('es-AR') + ' envíos ya cerrados (anteriores al ' + _cieFmt(tope) + ').' +
    cambio + String.fromCharCode(10) + String.fromCharCode(10) + '¿Continuar?')) return;
  await _ejecutarArchivo(tope, cuantos, sol);
}

async function rechazarArchivo(id) {
  if (typeof puedeAutorizar !== 'function' || !puedeAutorizar()) {
    showToast('⛔ Solo un supervisor o analista puede rechazar'); return;
  }
  const sol = (AppData.archivoSolicitudes || []).find(x => String(x.id) === String(id));
  if (!sol) return;
  if (!confirm('¿Rechazar el pedido de archivo de ' + (sol.solicitado_por || '—') + '?')) return;
  await _resolverSolicitud(sol, 'rechazada', 0);
  showToast('Pedido rechazado');
  renderCierrePanel();
}

// El que lo pidió puede cancelarlo mientras nadie lo haya resuelto.
async function cancelarArchivo(id) {
  const sol = (AppData.archivoSolicitudes || []).find(x => String(x.id) === String(id));
  if (!sol || sol.estado !== 'pendiente') return;
  if (!confirm('¿Cancelar tu pedido de archivo?')) return;
  try {
    await DB.deleteWhere('archivo_solicitudes', 'id', sol.id);
    AppData.archivoSolicitudes = AppData.archivoSolicitudes.filter(x => x.id !== sol.id);
    _persistirArchivoSolic();
    showToast('Pedido cancelado');
    renderCierrePanel();
  } catch (e) { console.warn('cancelarArchivo', e); showToast('⛔ No se pudo cancelar'); }
}

async function _resolverSolicitud(sol, estado, archivados) {
  const upd = {
    estado, archivados: archivados || 0,
    resuelto_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
    resuelto_en: new Date().toISOString()
  };
  try { await DB.updateWhere('archivo_solicitudes', 'id', sol.id, upd); } catch (e) { console.warn('resolver', e); }
  Object.assign(sol, upd);
  _persistirArchivoSolic();
}

function _persistirArchivoSolic() {
  try { localStorage.setItem('liq_archivo_solicitudes', JSON.stringify(AppData.archivoSolicitudes || [])); } catch (e) {}
}

// La ejecución real. archivarRegistrosAntesDe corta por fecha, y por eso el
// tope es el envío ABIERTO más viejo: así no se puede llevar puesto nada en
// curso. Solo un analista puede correr la RPC, así que un supervisor que
// autoriza sin serlo lo va a ver rechazado ahí y no acá.
async function _ejecutarArchivo(tope, cuantos, sol) {
  const t = tope || _cieISO(new Date(Date.now() + 86400000));
  if (!sol) {
    if (!confirm('Se van a archivar ' + Number(cuantos).toLocaleString('es-AR') + ' envíos ya cerrados' +
      (tope ? ' (anteriores al ' + _cieFmt(tope) + ')' : '') + '.' + String.fromCharCode(10) + String.fromCharCode(10) +
      'Están pagados al conductor y facturados al cliente, así que ya no cambian. Siguen consultables desde el archivo ' +
      'histórico y el historial de liquidaciones queda entero.' + String.fromCharCode(10) + String.fromCharCode(10) + '¿Continuar?')) return;
  }
  if (typeof archivarRegistrosAntesDe !== 'function') return;
  const movidos = await archivarRegistrosAntesDe(t);
  if (sol) await _resolverSolicitud(sol, 'aprobada', _num(movidos) || cuantos);
  renderCierrePanel();
}

// Compatibilidad: el botón del panel llama a este nombre.
async function archivarCerrados() { return pedirArchivoCerrados(); }

// ══════════════════════════════════════════════════════════════════════════
//  EL ARCHIVO CORRE SOLO
//
//  Archivar era una decisión que alguien tenía que acordarse de tomar, y por
//  eso no se tomaba: la tabla viva llegó a 120.221 envíos con junio y julio
//  como único archivo. Ahora se hace solo, con DOS condiciones que tienen que
//  cumplirse las dos:
//
//  1) **CERRADO de los dos lados** — pagado al conductor y cobrado al cliente,
//     que es la regla que ya existía (`envioCerrado`). No se reemplaza por la
//     fecha: archivar por fecha a secas se lleva envíos con plata pendiente de
//     un lado, y archivado el envío queda SOLO LECTURA — no se le puede
//     corregir la zona, ni pagar la visita, ni cerrar la liquidación que falta.
//  2) **Y más viejo que el margen de meses**: se deja vivo el mes en curso y
//     el anterior completo. En octubre se archiva hasta el 31/08 y septiembre
//     queda entero, por si aparece algo que corregir.
//
//  La fecha es un margen ARRIBA del cierre, no en su lugar. Medido en
//  producción al escribirlo: de los 49.857 envíos de agosto, ~37.700 estaban
//  cerrados y ~7.600 seguían abiertos (se facturaron por fuera del sistema).
//  Con las dos condiciones se archivan los 37.700 y los otros quedan donde
//  están — que es justo lo que el panel de Cierre lista diciendo qué falta.
//
//  LO QUE SE PIERDE, DICHO: el maker-checker. Archivar lo pedía un
//  administrativo y lo autorizaba un supervisor, porque mueve decenas de miles
//  de filas sin vuelta atrás. Automatizarlo saca esa aprobación; se puede
//  porque la condición de cierre garantiza que no toca nada en curso. Queda el
//  registro: cada corrida deja su fila en `archivo_solicitudes` marcada
//  `automatica`, con cuántos movió y cuándo.
//
//  POR QUÉ NO ES UN pg_cron: la regla de cierre vive en JavaScript y es
//  compleja —la semana de cada conductor según su condición, el período de
//  cada cliente con sus vigencias, el corte del modelo anterior—.
//  Reimplementarla en SQL serían dos versiones de la misma regla, y en este
//  proyecto eso siempre terminó discrepando. Corre en la app, que alguien abre
//  todos los días para importar.
// ══════════════════════════════════════════════════════════════════════════

// Meses que quedan vivos además del que está corriendo.
const CIERRE_MESES_VIVOS = 1;
// Por debajo de esto no vale la pena: mover 30 filas no cambia nada y la
// corrida cuesta una consulta.
const ARCHIVO_AUTO_MINIMO = 200;

// El 1º del mes a partir del cual NO se archiva. En octubre con
// CIERRE_MESES_VIVOS=1 da el 01/09: se archiva agosto y lo anterior.
function topeArchivoAuto() {
  const h = new Date();
  return _cieISO(new Date(h.getFullYear(), h.getMonth() - CIERRE_MESES_VIVOS, 1));
}

// La corrida de hoy, si ya se hizo. Va en `config` y no en localStorage porque
// vale para todos: con uno por navegador, dos operadores la correrían dos veces.
function archivoAutoHechoHoy() {
  const v = String((AppData.config && AppData.config.archivo_auto_ultimo) || '').slice(0, 10);
  return v === _cieISO(new Date());
}

// ¿Hasta dónde se puede archivar sin tocar nada abierto?
//  OJO: la app arranca con los últimos 14 días en memoria, así que `AppData.records`
//  NO alcanza para contestar esto — con la ventana corta, el envío abierto más
//  viejo que se ve es de hace una semana y el cálculo diría que todo lo anterior
//  está cerrado. Por eso se piden a la nube los envíos ANTERIORES al tope, que
//  son justo los candidatos, y se los evalúa aparte: no entran en AppData.records
//  —no son de la ventana de trabajo— y se descartan al terminar.
async function _topeArchivoCerrado(tope) {
  const res = await DB.selectRegistrosRango(null, tope);
  const filas = (res.vivos || []).map(mapRegistroNube);
  if (!filas.length) return { tope: tope, cuantos: 0 };
  const e = estadoCierre(filas);
  // El envío EN CURSO más viejo manda: más allá de ahí se archivaría trabajo
  // pendiente. Si no hay ninguno abierto, vale el tope de meses.
  const corte = (e.masViejo && e.masViejo < tope) ? e.masViejo : tope;
  const cuantos = e.cerradosFilas.filter(r => {
    const i = fechaISOde(r.fecha);
    return !!i && i < corte;
  }).length;
  return { tope: corte, cuantos: cuantos, abiertos: e.enCurso };
}

let _archivoAutoCorriendo = false;

// Se llama al terminar de hidratar. No molesta: si no hay nada que archivar
// no dice una palabra — un aviso que sale todos los días deja de leerse.
async function archivoAutomatico() {
  if (_archivoAutoCorriendo) return;
  // Lo ejecuta quien PODRÍA autorizarlo a mano: la función de la base exige
  // `puede_autorizar()`, así que con un administrativo fallaría igual. Si hoy
  // solo abren la app administrativos, corre mañana — es mantenimiento, no
  // algo urgente.
  if (typeof puedeAutorizar !== 'function' || !puedeAutorizar()) return;
  if (!window.DB || !DB.ready) return;
  if (AppData._cargandoRegistros) return;
  if (archivoAutoHechoHoy()) return;

  _archivoAutoCorriendo = true;
  try {
    const limite = topeArchivoAuto();
    const r = await _topeArchivoCerrado(limite);
    // Se marca el día SIEMPRE que la corrida haya podido evaluar, haya movido
    // o no: si no, cada arranque volvería a pedir los candidatos.
    const marcar = async () => {
      try { await DB.setConfig('archivo_auto_ultimo', _cieISO(new Date())); } catch (e) {}
      AppData.config = AppData.config || {};
      AppData.config.archivo_auto_ultimo = _cieISO(new Date());
    };
    if (r.cuantos < ARCHIVO_AUTO_MINIMO) { await marcar(); return; }

    const movidos = await DB.archivarRegistros(r.tope);
    await marcar();
    if (!(movidos > 0)) return;

    // Queda el registro de lo que hizo: sin esto, decenas de miles de filas se
    // mueven y no hay dónde ver quién ni cuándo.
    const fila = {
      hasta: r.tope, envios: movidos,
      solicitado_por: '(automático)', solicitado_en: new Date().toISOString(),
      motivo: 'Archivo automático: cerrado de los dos lados y anterior al ' + _cieFmt(r.tope),
      estado: 'automatica',
      resuelto_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
      resuelto_en: new Date().toISOString(), archivados: movidos
    };
    try {
      const row = await DB.insertRow('archivo_solicitudes', fila);
      AppData.archivoSolicitudes = (AppData.archivoSolicitudes || []).concat([Object.assign({ id: row && row.id }, fila)]);
      _persistirArchivoSolic();
    } catch (e) { console.warn('registrar archivo automático:', e); }

    // La ventana se recarga sin los archivados, igual que en el archivo a mano.
    AppData.historialCompleto = false;
    AppData.cargadoDesde = null;
    await hydrateFromSupabase();
    if (typeof showToast === 'function') {
      showToast('🗄️ ' + Number(movidos).toLocaleString('es-AR') + ' envíos cerrados se archivaron solos');
    }
    if (typeof renderCierrePanel === 'function') renderCierrePanel();
    if (typeof rerenderPaginaActiva === 'function') rerenderPaginaActiva();
  } catch (e) {
    // Un fallo acá no puede entorpecer el arranque: es mantenimiento. Se
    // reintenta mañana, y el panel de Cierre sigue ofreciendo hacerlo a mano.
    console.warn('archivoAutomatico:', e);
  } finally { _archivoAutoCorriendo = false; }
}