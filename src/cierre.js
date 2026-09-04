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

  html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-sm btn-primary" onclick="archivarCerrados()"' + (arch.length ? '' : ' disabled') + '>' +
      '<i class="ic ic-folder"></i> Archivar ' + fmt(arch.length) + ' cerrados</button>' +
    '<span style="font-size:11px;color:var(--text-muted)">' +
      (rec.hasta ? 'Se archiva lo anterior al ' + _cieFmt(rec.hasta) + ', que es el envío en curso más viejo.'
                 : 'No hay nada en curso: se archiva todo lo cerrado.') +
    '</span></div>';

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

// Archiva lo cerrado. Solo analista, igual que el archivado por fecha: mueve
// filas a una tabla de solo lectura y desde la app no hay vuelta atrás.
async function archivarCerrados() {
  if (typeof esAnalista === 'function' && !esAnalista()) {
    showToast('⛔ Solo un analista puede archivar'); return;
  }
  const rec = recomendacionArchivo();
  const arch = rec.archivables;
  if (!arch.length) { showToast('No hay envíos cerrados para archivar'); return; }
  const hasta = rec.hasta;
  if (!hasta) {
    if (!confirm('No hay ningún envío en curso, así que se archiva TODO lo cerrado (' +
      arch.length.toLocaleString('es-AR') + ' envíos).\n\nSiguen consultables desde el archivo histórico. ¿Continuar?')) return;
  } else {
    if (!confirm('Se van a archivar ' + arch.length.toLocaleString('es-AR') + ' envíos ya cerrados ' +
      '(anteriores al ' + _cieFmt(hasta) + ').\n\n' +
      'Están pagados al conductor y facturados al cliente, así que ya no cambian. ' +
      'Siguen consultables desde el archivo histórico y el historial de liquidaciones queda entero.\n\n¿Continuar?')) return;
  }
  // archivarRegistrosAntesDe corta por fecha, y por eso el tope es el envío
  // ABIERTO más viejo: así no se puede llevar puesto nada en curso.
  const tope = hasta || _cieISO(new Date(Date.now() + 86400000));
  if (typeof archivarRegistrosAntesDe === 'function') {
    await archivarRegistrosAntesDe(tope);
    renderCierrePanel();
  }
}
