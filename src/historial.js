// ════════════════════════════════════════════════════════════════════════
//  HISTORIAL DE LIQUIDACIONES — conductores y clientes
//  Los dos paneles de liquidación trabajan sobre UNA semana: son la herramienta
//  del día de pago. Lo que ya se pagó y lo que ya se facturó no se podía
//  consultar en ningún lado, y al ARCHIVAR los envíos desaparecía de la
//  pantalla —el panel recalcula desde los registros vivos—. Acá se listan las
//  liquidaciones cerradas, por mes, con lo que salió de cada una, y el PDF se
//  rearma del DETALLE CONGELADO (`liquidacion_detalle`): es el mismo papel que
//  se descargó ese día aunque los envíos ya estén archivados y el tarifario
//  haya cambiado —las tarifas de conductor no tienen vigencia, así que
//  recalcular una semana vieja con el tarifario de hoy da otro número—.
//
//  Va como SOLAPA de cada panel y NO como pantalla nueva: así hereda los
//  permisos que el panel ya tiene. Una pantalla nueva hay que habilitarla rol
//  por rol en Gestión de permisos, y un rol que ya tiene filas en `rol_permisos`
//  no hereda las nuevas: el tesorero se habría quedado sin verla.
// ════════════════════════════════════════════════════════════════════════

let histTab = { conductor: 'semana', cliente: 'semana' };
// El detalle se trae de a uno y se recuerda: abrir la ficha y después el PDF
// del mismo son dos idas a la nube por el mismo dato.
const _histCache = new Map();

function _histMesInicial() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function _histEsConductor(tipo) { return tipo === 'conductor'; }
function _histId(tipo, sufijo) { return (_histEsConductor(tipo) ? 'liq' : 'cliq') + '-hist-' + sufijo; }
function _histVal(tipo, sufijo) {
  const el = document.getElementById(_histId(tipo, sufijo));
  return el ? el.value : '';
}

// Solapas de cada panel. El render de la semana ya existe en cada uno.
function switchLiqTab(tab) { _histSwitch('conductor', tab); }
function switchCliqTab(tab) { _histSwitch('cliente', tab); }
function _histSwitch(tipo, tab) {
  histTab[tipo] = (tab === 'historial') ? 'historial' : 'semana';
  const pre = _histEsConductor(tipo) ? 'liq' : 'cliq';
  ['semana', 'historial'].forEach(t => {
    const panel = document.getElementById(pre + '-tab-' + t);
    const btn = document.getElementById(pre + '-btn-' + t);
    if (panel) panel.style.display = (t === histTab[tipo]) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === histTab[tipo]);
  });
  if (histTab[tipo] === 'historial') {
    const mes = document.getElementById(_histId(tipo, 'mes'));
    if (mes && !mes.value) mes.value = _histMesInicial();
    renderHistorial(tipo);
  } else if (_histEsConductor(tipo)) {
    if (typeof renderLiquidaciones === 'function') renderLiquidaciones();
  } else if (typeof renderClienteLiquidaciones === 'function') {
    renderClienteLiquidaciones();
  }
}

// Las liquidaciones cerradas de ese lado, filtradas por mes y por el buscador.
// El mes se cruza con el PERÍODO: una semana que empieza en un mes y termina en
// el otro aparece en los dos, porque en los dos es cierta —lo contrario sería
// que la semana del 28/09 no figure en ningún lado.
function histLiquidaciones(tipo) {
  const mes = _histVal(tipo, 'mes');
  const q = String(_histVal(tipo, 'search') || '').toLowerCase().trim();
  const filas = (_histEsConductor(tipo) ? (AppData.conductorLiquidaciones || []) : (AppData.clienteLiquidaciones || []))
    .map(x => {
      const clave = _histEsConductor(tipo) ? (x.conductor || '') : (x.cliente_cod || '');
      const nombre = _histEsConductor(tipo) ? clave
        : (typeof clienteNombreDe === 'function' ? clienteNombreDe(clave) : clave);
      return {
        id: x.id, clave, nombre,
        desde: String(x.semana_desde || '').slice(0, 10),
        hasta: String(x.semana_hasta || '').slice(0, 10),
        monto: _num(x.monto), bruto: _num(x.bruto), envios: _num(x.envios),
        tieneDetalle: !!x.tiene_detalle,
        armada_por: x.armada_por || '', armada_en: x.armada_en || ''
      };
    })
    .filter(x => !mes || (x.desde.slice(0, 7) === mes || x.hasta.slice(0, 7) === mes))
    .filter(x => !q || x.nombre.toLowerCase().includes(q) || x.clave.toLowerCase().includes(q));
  return filas.sort((a, b) => b.desde.localeCompare(a.desde) || b.monto - a.monto);
}

function _histFmtFecha(iso) {
  if (!iso) return '—';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}
function _histFmtCuando(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function renderHistorial(tipo) {
  const body = document.getElementById(_histId(tipo, 'rows'));
  if (!body) return;
  const esCond = _histEsConductor(tipo);
  const filas = histLiquidaciones(tipo);
  const mes = _histVal(tipo, 'mes');
  const q = String(_histVal(tipo, 'search') || '').trim();

  const total = filas.reduce((s, x) => s + x.monto, 0);
  const envios = filas.reduce((s, x) => s + x.envios, 0);
  const sinDetalle = filas.filter(x => !x.tieneDetalle).length;

  const kpis = document.getElementById(_histId(tipo, 'kpis'));
  if (kpis) kpis.innerHTML =
    '<div class="metric-card"><div class="metric-label">Liquidaciones</div>' +
      '<div class="metric-value">' + filas.length + '</div>' +
      '<div class="metric-sub">' + (mes ? 'en el mes elegido' : 'todo el historial') + (q ? ' · ' + q : '') + '</div></div>' +
    '<div class="metric-card"><div class="metric-label">Envíos</div>' +
      '<div class="metric-value">' + envios.toLocaleString('es-AR') + '</div>' +
      '<div class="metric-sub">' + (sinDetalle ? sinDetalle + ' sin detalle guardado' : 'de las liquidaciones listadas') + '</div></div>' +
    '<div class="metric-card accent"><div class="metric-label">' + (esCond ? 'Pagado (neto)' : 'Facturado') + '</div>' +
      '<div class="metric-value">' + fmtPeso(total) + '</div>' +
      '<div class="metric-sub">' + (esCond ? 'lo que cobraron los conductores' : 'lo que se le facturó a los clientes') + '</div></div>';

  // Las cerradas antes de que existiera el historial no tienen detalle: se
  // pueden reconstruir mientras sus envíos sigan en la base viva.
  const aviso = document.getElementById(_histId(tipo, 'aviso'));
  if (aviso) aviso.innerHTML = sinDetalle
    ? '<div class="alert" style="margin:0 0 14px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
      '<i class="ic ic-alert"></i><div><strong>' + sinDetalle + ' liquidación(es) sin detalle guardado</strong> — se cerraron antes de que existiera el historial, ' +
      'así que se puede ver el total pero no rearmar el PDF. Se reconstruye con los envíos de esa semana: si son de hace más de ' +
      'dos semanas, primero traelos con <strong>Cargar historial completo</strong> (arriba del Dashboard). ' +
      '<button class="btn btn-sm" style="margin-left:6px" onclick="reconstruirHistorial(\'' + tipo + '\')">' +
      '<i class="ic ic-refresh"></i> Reconstruir las que se puedan</button></div></div>'
    : '';

  if (!filas.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-file"></i></div>' +
      '<div class="empty-title">Sin liquidaciones cerradas</div><div class="empty-sub">' +
      (q ? 'Probá con otro nombre' : mes ? 'Nadie cerró liquidaciones en ese mes — probá otro o borrá el mes para ver todo' :
        'Acá aparecen las que se marcan como listas') + '</div></div></td></tr>';
    return;
  }

  body.innerHTML = filas.map(x => {
    const esc = jsAttr(x.clave);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(x.nombre) + '</div>' +
        '<strong>' + x.nombre + '</strong></div></td>' +
      '<td style="font-size:12px">' + _histFmtFecha(x.desde) + ' → ' + _histFmtFecha(x.hasta) + '</td>' +
      '<td class="mono" style="text-align:right">' + (x.envios ? x.envios.toLocaleString('es-AR') : (x.tieneDetalle ? '0' : '—')) + '</td>' +
      (esCond ? '<td class="mono" style="text-align:right;color:var(--text-muted)">' + (x.bruto ? fmtPeso(x.bruto) : '—') + '</td>' : '') +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.monto) + '</td>' +
      '<td style="font-size:11px;color:var(--text-muted)">' + (x.armada_por || '—') +
        (x.armada_en ? '<div>' + _histFmtCuando(x.armada_en) + '</div>' : '') + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="verDetalleLiq(\'' + tipo + '\',\'' + esc + '\',\'' + x.desde + '\')" title="Ver el detalle congelado de esta liquidación"><i class="ic ic-search"></i> Ver</button> ' +
        '<button class="btn btn-sm" onclick="pdfDesdeHistorial(\'' + tipo + '\',\'' + esc + '\',\'' + x.desde + '\')" title="Rearma el PDF con el detalle de esa liquidación"><i class="ic ic-download"></i> PDF</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// El detalle se trae de la nube (no se hidrata con el resto: son decenas de MB).
async function _histDetalle(tipo, clave, semanaISO) {
  const k = tipo + '|' + clave + '|' + semanaISO;
  if (_histCache.has(k)) return _histCache.get(k);
  const row = await DB.selectDetalleLiq(tipo, clave, semanaISO);
  _histCache.set(k, row);
  return row;
}

function _histRango(snap) {
  const r = (snap && snap.rango) || {};
  return {
    desde: r.desde || '', hasta: r.hasta || '',
    desdeD: r.desde ? parseFechaReg(r.desde) : null,
    hastaD: r.hasta ? parseFechaReg(r.hasta) : null
  };
}

// Rearma el PDF con lo congelado: el mismo papel que se descargó ese día.
async function pdfDesdeHistorial(tipo, clave, semanaISO) {
  try {
    const row = await _histDetalle(tipo, clave, semanaISO);
    if (!row || !row.detalle) {
      alert('Esta liquidación no tiene detalle guardado: se cerró antes de que existiera el historial.' +
        String.fromCharCode(10) + 'Probá "Reconstruir las que se puedan".');
      return;
    }
    const snap = row.detalle;
    const rango = _histRango(snap);
    if (tipo === 'conductor') {
      exportPDF(clave, {
        liqData: liqDesdeSnapshot(clave, snap),
        rangoFechas: { desde: rango.desde, hasta: rango.hasta },
        descuentos: Object.assign({ obs: '' }, (snap.imp && snap.imp.items) || {}),
        imputaciones: snap.imp || null
      });
    } else {
      exportLiquidacionClientePDF(clave, rango, { liq: liqClienteDesdeSnapshot(snap) });
    }
    showToast('📄 PDF rearmado con el detalle de esa liquidación');
  } catch (e) {
    console.warn('pdfDesdeHistorial', e);
    alert('No se pudo traer el detalle: ' + (e.message || e));
  }
}

// La ficha de una liquidación cerrada: los números que salieron y de dónde.
async function verDetalleLiq(tipo, clave, semanaISO) {
  const esCond = tipo === 'conductor';
  const nombre = esCond ? clave : (typeof clienteNombreDe === 'function' ? clienteNombreDe(clave) : clave);
  document.getElementById('modal-title').textContent = 'Liquidación · ' + nombre;
  document.getElementById('modal-body').innerHTML = '<div class="muted" style="padding:16px">Trayendo el detalle…</div>';
  document.getElementById('modal-backdrop').classList.add('open');
  let row = null;
  try { row = await _histDetalle(tipo, clave, semanaISO); }
  catch (e) {
    document.getElementById('modal-body').innerHTML =
      '<div class="alert" style="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5"><i class="ic ic-alert"></i>' +
      '<div>No se pudo traer el detalle: ' + (e.message || e) + '</div></div>';
    return;
  }
  if (!row || !row.detalle) {
    document.getElementById('modal-body').innerHTML =
      '<div class="alert" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i>' +
      '<div>Esta liquidación <strong>no tiene detalle guardado</strong>: se cerró antes de que existiera el historial. ' +
      'El total sigue siendo el que se pagó; el detalle se puede reconstruir mientras sus envíos sigan cargados.</div></div>';
    return;
  }
  const snap = row.detalle;
  const rango = _histRango(snap);
  const kpi = (etq, val, sub) => '<div class="metric-card"><div class="metric-label">' + etq + '</div>' +
    '<div class="metric-value">' + val + '</div>' + (sub ? '<div class="metric-sub">' + sub + '</div>' : '') + '</div>';

  let html = '<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">' +
    'Período <strong>' + (rango.desde || '—') + ' → ' + (rango.hasta || '—') + '</strong>' +
    (row.armada_por ? ' · armada por ' + row.armada_por : '') +
    (row.reconstruido ? ' · <span style="color:#9a3412">reconstruida después: los precios salen del tarifario de hoy</span>' : '') +
    '</div>';

  if (esCond) {
    const imp = snap.imp || {};
    const items = imp.items || {};
    html += '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      kpi('Bruto', fmtPeso(snap.bruto), _num(snap.envios).toLocaleString('es-AR') + ' envíos entregados') +
      kpi('Neto pagado', fmtPeso(snap.neto), 'lo que cobró') +
      kpi('Diferencia', fmtPeso(_num(snap.neto) - _num(snap.bruto)), 'adicionales − descuentos') +
    '</div>';
    const mov = [
      ['Adicional km de desvío', _num(imp.km && imp.km.monto), '+'],
      ['Recorridos especiales', _num(imp.especial && imp.especial.monto), '+'],
      ['Combustible', _num(items.combustible), '−'],
      ['Extraviados / rotos', _num(items.extraviados), '−'],
      ['Servicio proveedores', _num(items.proveedores), '−'],
      ['Cuota de adelanto', _num(imp.adelanto && imp.adelanto.monto), '−'],
      ['Cuota de saldo', _num(imp.extravio && imp.extravio.monto), '−'],
    ].filter(x => x[1] > 0);
    html += mov.length
      ? '<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>Movimiento</th><th style="text-align:right">Importe</th></tr></thead><tbody>' +
        mov.map(m => '<tr><td>' + m[0] + '</td><td class="mono" style="text-align:right;color:' + (m[2] === '+' ? '#166534' : '#b91c1c') + '">' +
          m[2] + fmtPeso(m[1]) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="muted" style="font-size:12px;margin-bottom:12px">Sin adicionales ni descuentos imputados.</div>';
    // Por zona: es como se lee una liquidación de un vistazo.
    const porZona = new Map();
    (snap.ent || []).forEach(a => {
      const z = a[2] || '(sin zona)';
      const g = porZona.get(z) || { n: 0, monto: 0 };
      g.n++; g.monto += _num(a[3]); porZona.set(z, g);
    });
    const zonas = Array.from(porZona.entries()).sort((x, y) => y[1].monto - x[1].monto);
    html += '<div class="table-wrap" style="max-height:38vh;overflow:auto"><table><thead><tr>' +
      '<th>Zona</th><th style="text-align:right">Envíos</th><th style="text-align:right">Total</th></tr></thead><tbody>' +
      zonas.map(z => '<tr><td>' + z[0] + '</td><td class="mono" style="text-align:right">' + z[1].n + '</td>' +
        '<td class="mono" style="text-align:right">' + fmtPeso(z[1].monto) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (_num(snap.noent && snap.noent.length) ? '<div class="muted" style="font-size:11.5px;margin-top:8px">' +
        snap.noent.length + ' recorrido(s) en otros estados, que no se pagaron.</div>' : '');
  } else {
    html += '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      kpi('Facturado', fmtPeso(snap.total), _num(snap.envios).toLocaleString('es-AR') + ' envíos') +
      kpi('Envíos', fmtPeso(snap.totalEnvio), 'sin los cargos') +
      kpi('Cargos', fmtPeso(snap.totalCargos), (snap.cargos || []).length + ' cargo(s)') +
    '</div>';
    const zonas = (snap.zonas || []).slice().sort((a, b) => _num(b.subtotal) - _num(a.subtotal));
    html += '<div class="table-wrap" style="max-height:38vh;overflow:auto"><table><thead><tr>' +
      '<th>Zona</th><th style="text-align:right">Envíos</th><th style="text-align:right">Tarifa</th><th style="text-align:right">Total</th></tr></thead><tbody>' +
      (zonas.length ? zonas.map(f => '<tr><td>' + f.zona + '</td>' +
        '<td class="mono" style="text-align:right">' + _num(f.count) + '</td>' +
        '<td class="mono" style="text-align:right">' + (_num(f.precio) > 0 ? fmtPeso(f.precio) : '—') + '</td>' +
        '<td class="mono" style="text-align:right">' + fmtPeso(_num(f.subtotal)) + '</td></tr>').join('')
        : '<tr><td colspan="4" class="muted" style="text-align:center;padding:12px">Sin envíos: solo cargos</td></tr>') +
      '</tbody></table></div>' +
      (_num(snap.anulados) ? '<div class="muted" style="font-size:11.5px;margin-top:8px">' + _num(snap.anulados) +
        ' envío(s) con el cobro anulado · ' + fmtPeso(snap.bonificado) + ' bonificados.</div>' : '');
  }

  html += '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
    '<button class="btn btn-primary btn-sm" onclick="pdfDesdeHistorial(\'' + tipo + '\',\'' + jsAttr(clave) + '\',\'' + semanaISO + '\')">' +
    '<i class="ic ic-download"></i> Descargar el PDF</button></div>';
  document.getElementById('modal-body').innerHTML = html;
}

// ── Reconstruir las que se cerraron antes del historial ────────────────────
// Se rehacen con los envíos que sigan cargados. Quedan marcadas como
// reconstruidas: los precios salen del tarifario de HOY, así que el bruto puede
// no coincidir con lo que se pagó —y el número que vale sigue siendo el monto
// congelado de la liquidación, que no se toca.
async function reconstruirHistorial(tipo) {
  const esCond = tipo === 'conductor';
  const pendientes = histLiquidaciones(tipo).filter(x => !x.tieneDetalle);
  if (!pendientes.length) { showToast('No hay ninguna sin detalle en lo que estás viendo'); return; }
  const NL = String.fromCharCode(10);
  if (!confirm('¿Reconstruir el detalle de ' + pendientes.length + ' liquidación(es)?' + NL + NL +
    'Se rehace con los envíos que sigan cargados y con el tarifario de HOY, así que puede no dar exactamente lo que se pagó: ' +
    'por eso quedan marcadas como reconstruidas. El monto de cada liquidación no se toca.')) return;

  let ok = 0, sinEnvios = 0;
  for (const p of pendientes) {
    try {
      const rango = {
        desde: _histFmtFecha(p.desde), hasta: _histFmtFecha(p.hasta),
        desdeD: parseFechaReg(_histFmtFecha(p.desde)), hastaD: parseFechaReg(_histFmtFecha(p.hasta))
      };
      const fila = (esCond ? (AppData.conductorLiquidaciones || []) : (AppData.clienteLiquidaciones || []))
        .find(x => x.id === p.id);
      if (!fila) continue;
      if (esCond) {
        // Los envíos de ESA semana y de ESE conductor (el panel mira la semana
        // que está en pantalla, que no es la que se está reconstruyendo).
        const recs = (AppData.records || []).filter(r => {
          if (conductorCanonico(r.cadete) !== p.clave) return false;
          const f = parseFechaReg(r.fecha);
          return !!f && f >= rango.desdeD && f <= rango.hastaD;
        });
        if (!recs.length) { sinEnvios++; continue; }
        const snap = snapshotConductor(p.clave, rango, calcLiquidacionesFiltradas(recs));
        await _guardarSnapshotConductor(fila, snap, true);
      } else {
        const snap = snapshotCliente(p.clave, rango);
        if (!snap.envios && !(snap.cargos || []).length) { sinEnvios++; continue; }
        await _guardarSnapshotCliente(fila, snap, true);
      }
      ok++;
    } catch (e) { console.warn('reconstruirHistorial', p.clave, e); }
  }
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
  renderHistorial(tipo);
  alert('Reconstruidas: ' + ok + ' liquidación(es).' + NL +
    (sinEnvios ? sinEnvios + ' no se pudieron: sus envíos ya no están cargados (archivados o fuera de la ventana de días).' + NL : '') +
    'Las reconstruidas quedan marcadas como tales.');
}
