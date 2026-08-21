// ════════════════════════════════════════════════════════════════════════
//  ADELANTOS (préstamos devueltos en cuotas)
//  Se registra el adelanto (monto + cantidad de cuotas). Cada cuota se
//  "descuenta" registrándola con una fecha; esa cuota aparece automáticamente
//  como deducción en la liquidación de esa semana (ver liquidaciones-pdf.js).
//
//  DOS GRUPOS, DOS VÍAS DE COBRO. Un adelanto puede ser a un CONDUCTOR (se
//  descuenta en su liquidación semanal) o a un EMPLEADO de la empresa (se
//  descuenta en su sueldo mensual, panel Empleados). Por eso el panel se
//  desglosa en dos solapas: son circuitos distintos y no se mezclan.
//
//  MONEDA. El préstamo puede ser en pesos o en dólares. El saldo se lleva en la
//  moneda en que se prestó —quien debe USD 1.000 debe dólares, no pesos— pero
//  el pago siempre sale en pesos, así que al descontar cada cuota se declara el
//  tipo de cambio y se guarda su equivalente (monto_ars): eso es lo que baja
//  del neto, y lo que el PDF puede explicar ("USD 200 a $1.200").
// ════════════════════════════════════════════════════════════════════════

// Solapa activa: 'conductor' | 'empleado'
let adelGrupo = 'conductor';

// Fecha (DD/MM/YYYY) a la que se imputa la cuota — la del selector del panel.
function fechaDescuentoAdelanto() {
  const iso = document.getElementById('adelantos-fecha')?.value || hoyISO();
  return isoToDMY(iso);
}

function switchAdelantoTab(grupo) {
  adelGrupo = (grupo === 'empleado') ? 'empleado' : 'conductor';
  ['conductor', 'empleado'].forEach(g => {
    const btn = document.getElementById('adel-btn-' + g);
    if (btn) btn.classList.toggle('active', g === adelGrupo);
  });
  const search = document.getElementById('adelantos-search');
  if (search) {
    search.value = '';
    search.placeholder = adelGrupo === 'empleado' ? '🔍 Buscar empleado...' : '🔍 Buscar conductor...';
  }
  renderAdelantos();
}

// ── Render ──────────────────────────────────────────────────────────────
function renderAdelantos() {
  const cont = document.getElementById('adelantos-rows');
  if (!cont) return;

  const fInput = document.getElementById('adelantos-fecha');
  if (fInput && !fInput.value) fInput.value = hoyISO();

  const esEmp = adelGrupo === 'empleado';
  const colBenef = document.getElementById('adelantos-col-benef');
  if (colBenef) colBenef.textContent = esEmp ? 'Empleado' : 'Conductor';

  const ayuda = document.getElementById('adelantos-ayuda');
  if (ayuda) ayuda.innerHTML = '<i class="ic ic-card"></i> ' + (esEmp
    ? 'Préstamos al <strong>personal de la empresa</strong>. Cada cuota que descontás queda imputada a la fecha elegida y aparece en la <strong>liquidación de sueldo</strong> de ese mes (panel Empleados), donde se puede tildar para que baje del neto. No afectan las liquidaciones de conductores.'
    : 'Registrá un préstamo/adelanto (monto total y cantidad de cuotas) y la app calcula la cuota. Cada vez que <strong>descontás una cuota</strong> (por conductor con "− Cuota", o a todos con "Descontar cuota semanal"), esa cuota se imputa a la <strong>semana elegida</strong> y aparece automáticamente como deducción en la <strong>liquidación de esa semana</strong> (baja el neto del PDF). Elegí primero la semana arriba.');

  // Contadores de cada solapa (activos), para ver de un vistazo dónde hay deuda.
  ['conductor', 'empleado'].forEach(g => {
    const el = document.getElementById('adel-count-' + g);
    if (!el) return;
    const n = adelantosDeGrupo(g).filter(a => !adelantoSaldado(a) && esAutorizado(a)).length;
    el.textContent = n ? '(' + n + ')' : '';
  });

  const search = (document.getElementById('adelantos-search')?.value || '').toLowerCase().trim();
  const delGrupo = adelantosDeGrupo(adelGrupo);
  const lista = delGrupo
    .filter(a => !search || String(a.conductor).toLowerCase().includes(search))
    .sort((a, b) => (adelantoSaldado(a) ? 1 : 0) - (adelantoSaldado(b) ? 1 : 0)
                 || String(a.conductor).localeCompare(String(b.conductor)));

  const countEl = document.getElementById('adelantos-count');
  const activos = delGrupo.filter(a => !adelantoSaldado(a) && esAutorizado(a)).length;
  const pendientes = delGrupo.filter(a => a.estado === 'pendiente').length;
  if (countEl) countEl.textContent = delGrupo.length + ' adelantos · ' + activos + ' activos'
    + (pendientes ? ' · ⏳ ' + pendientes + ' pendiente' + (pendientes > 1 ? 's' : '') : '');

  renderAdelantosResumen(lista);

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-card"></i></div><div class="empty-title">Sin adelantos ' +
      (esEmp ? 'a empleados' : 'a conductores') + '</div><div class="empty-sub">Registrá uno con "+ Nuevo adelanto"</div></div></td></tr>';
    return;
  }

  const puedeAut = puedeAutorizar();
  cont.innerHTML = lista.map(a => {
    const pagadas = cuotasPagadasDe(a.id);
    const saldado = pagadas >= a.cuotas_total;
    const pct = a.cuotas_total ? Math.round(pagadas / a.cuotas_total * 100) : 0;
    const saldo = saldoAdelanto(a);
    const estado = a.estado || 'autorizado';
    const pendiente = estado === 'pendiente';
    const rechazado = estado === 'rechazado';
    const usd = adelantoEsUSD(a);

    const estadoBadge = pendiente
      ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i> Pendiente</span>'
      : rechazado ? '<span class="badge badge-red">Rechazado</span>' : '';
    const monedaBadge = usd
      ? '<span class="badge" style="background:#ecfdf5;color:#065f46;border:1px solid #6ee7b7;font-size:9px">USD</span>' : '';

    let acciones;
    if (pendiente) {
      acciones = puedeAut
        ? '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;background:#16a34a;border-color:#16a34a;color:#fff" onclick="autorizarAdelanto(' + a.id + ')"><i class="ic ic-check"></i> Autorizar</button>' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5" onclick="rechazarAdelanto(' + a.id + ')" title="Rechazar"><i class="ic ic-x"></i></button>'
        : '<span style="font-size:11px;color:#9a3412;white-space:nowrap">Esperando autorización</span>' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5" onclick="eliminarAdelanto(' + a.id + ')" title="Cancelar mi solicitud"><i class="ic ic-trash"></i></button>';
    } else if (rechazado) {
      acciones = (puedeAut ? '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="autorizarAdelanto(' + a.id + ')" title="Autorizar igual"><i class="ic ic-check"></i></button>' : '') +
        '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5" onclick="eliminarAdelanto(' + a.id + ')"><i class="ic ic-trash"></i></button>';
    } else {
      acciones = (saldado ? '' : '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="descontarCuota(' + a.id + ')" title="Registrar la próxima cuota en la fecha elegida arriba">− Cuota</button>') +
        '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="verHistorialAdelanto(' + a.id + ')" title="Ver cuotas"><i class="ic ic-list"></i></button>' +
        '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5" onclick="eliminarAdelanto(' + a.id + ')"><i class="ic ic-trash"></i></button>';
    }

    // En dólares mostramos el equivalente en pesos al TC pactado, que es lo que
    // realmente se va a descontar. Sin TC lo decimos: si no, la fila aparenta
    // un descuento que la liquidación no puede calcular.
    const equivTotal = usd ? adelantoARS(a, a.monto_total) : null;
    const equivCuota = usd ? adelantoARS(a, a.monto_cuota) : null;
    const subEquiv = v => usd
      ? '<div style="font-size:10px;color:var(--text-muted)">' + (v != null ? '≈ ' + fmtPeso(v) : 'sin tipo de cambio') + '</div>'
      : '';

    const rowStyle = pendiente ? 'background:#fff7ed;' : (rechazado ? 'opacity:0.55;' : (saldado ? 'opacity:0.6;' : ''));
    return '<tr style="' + rowStyle + '">' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(a.conductor) + ';width:28px;height:28px;font-size:10px">' + initials(a.conductor) + '</div><div style="min-width:0"><strong>' + a.conductor + '</strong> ' + monedaBadge + (estadoBadge ? '<div style="margin-top:3px">' + estadoBadge + '</div>' : '') + '</div></div></td>' +
      '<td class="mono muted">' + (a.fecha || '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtMoneda(a.monto_total, a.moneda) + subEquiv(equivTotal) + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtMoneda(a.monto_cuota, a.moneda) + subEquiv(equivCuota) + '</td>' +
      '<td style="min-width:150px">' + (pendiente ? '<span class="muted" style="font-size:12px">— (pendiente)</span>' :
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div style="flex:1;height:7px;background:var(--surface-0);border-radius:99px;overflow:hidden;border:1px solid var(--border)"><div style="height:100%;width:' + pct + '%;background:' + (saldado ? '#166534' : '#2d4fa1') + '"></div></div>' +
          '<span style="font-size:12px;font-weight:600;white-space:nowrap">' + pagadas + '/' + a.cuotas_total + '</span>' +
        '</div>') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700;color:' + (saldo > 0 ? '#b45309' : '#166534') + '">' + (pendiente ? '—' : (saldo > 0 ? fmtMoneda(saldo, a.moneda) : '✓ Saldado')) + '</td>' +
      '<td><div style="display:flex;gap:4px">' + acciones + '</div></td>' +
    '</tr>';
  }).join('');
}

// Autoriza un adelanto pendiente (solo supervisor/analista). Recién ahí impacta
// la liquidación.
async function autorizarAdelanto(id) {
  if (!puedeAutorizar()) { showToast('⛔ Solo un supervisor puede autorizar'); return; }
  const a = AppData.adelantos.find(x => x.id === id);
  if (!a) return;
  const cuando = new Date().toISOString();
  const quien = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  try {
    await DB.updateWhere('adelantos', 'id', id, { estado: 'autorizado', autorizado_por: quien, autorizado_en: cuando });
    a.estado = 'autorizado'; a.autorizado_por = quien; a.autorizado_en = cuando;
    renderAdelantos();
    showToast('✅ Adelanto de ' + a.conductor + ' autorizado — ya impacta la liquidación');
  } catch (e) { console.warn('autorizarAdelanto:', e); showToast('⛔ No se pudo autorizar'); }
}

async function rechazarAdelanto(id) {
  if (!puedeAutorizar()) { showToast('⛔ Solo un supervisor puede rechazar'); return; }
  const a = AppData.adelantos.find(x => x.id === id);
  if (!a) return;
  if (!confirm('¿Rechazar el adelanto de ' + a.conductor + ' (' + fmtMoneda(a.monto_total, a.moneda) + ')? No impactará ninguna liquidación.')) return;
  const quien = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  try {
    await DB.updateWhere('adelantos', 'id', id, { estado: 'rechazado', autorizado_por: quien, autorizado_en: new Date().toISOString() });
    a.estado = 'rechazado';
    renderAdelantos();
    showToast('🚫 Adelanto de ' + a.conductor + ' rechazado');
  } catch (e) { console.warn('rechazarAdelanto:', e); showToast('⛔ No se pudo rechazar'); }
}

// Resumen de deuda (solo adelantos AUTORIZADOS con saldo) del grupo activo.
// Respeta el buscador. Pesos y dólares se muestran POR SEPARADO: sumarlos en un
// solo número exigiría fijar una cotización y daría una deuda que no es real.
function renderAdelantosResumen(lista) {
  const cont = document.getElementById('adelantos-resumen');
  if (!cont) return;
  const esEmp = adelGrupo === 'empleado';
  const conDeuda = (lista || []).filter(a => esAutorizado(a) && saldoAdelanto(a) > 0);
  const deudaARS = conDeuda.filter(a => !adelantoEsUSD(a)).reduce((s, a) => s + saldoAdelanto(a), 0);
  const deudaUSD = conDeuda.filter(a => adelantoEsUSD(a)).reduce((s, a) => s + saldoAdelanto(a), 0);
  const personas = new Set(conDeuda.map(a => esEmp ? ('e' + a.empleado_id) : conductorKey(a.conductor)));
  const prestadoARS = conDeuda.filter(a => !adelantoEsUSD(a)).reduce((s, a) => s + _num(a.monto_total), 0);
  const prestadoUSD = conDeuda.filter(a => adelantoEsUSD(a)).reduce((s, a) => s + _num(a.monto_total), 0);
  const q = (document.getElementById('adelantos-search')?.value || '').trim();
  const linUSD = v => v > 0 ? '<div class="metric-sub" style="color:#065f46;font-weight:600">+ ' + fmtUSD(v) + ' en dólares</div>' : '';
  cont.innerHTML =
    '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div>' +
        '<div class="metric-label">Deuda vigente' + (q ? ' (filtrado)' : '') + '</div>' +
        '<div class="metric-value">' + fmtPeso(deudaARS) + '</div>' +
        '<div class="metric-sub">saldo pendiente de cobro</div>' + linUSD(deudaUSD) + '</div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-users"></i></div>' +
        '<div class="metric-label">' + (esEmp ? 'Empleados' : 'Conductores') + ' con deuda</div>' +
        '<div class="metric-value">' + personas.size + '</div>' +
        '<div class="metric-sub">con saldo &gt; 0</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-card"></i></div>' +
        '<div class="metric-label">Total prestado (activo)</div>' +
        '<div class="metric-value">' + fmtPeso(prestadoARS) + '</div>' +
        '<div class="metric-sub">' + conDeuda.length + ' adelanto' + (conDeuda.length !== 1 ? 's' : '') + ' con saldo</div>' + linUSD(prestadoUSD) + '</div>' +
    '</div>';
}

// ── Tipo de cambio de la cuota ──────────────────────────────────────────
// Una cuota en dólares necesita una cotización para poder descontarse en pesos.
// Se propone la pactada en el adelanto (o la última usada) y se puede corregir:
// el valor del día no es el de hace tres meses.
let tcModalCtx = null;

function tcSugerido(a) {
  const guardado = parseFloat(localStorage.getItem('liq_tc_usd') || '0') || 0;
  return _num(a && a.tipo_cambio) || guardado || 0;
}
function abrirTCModal(ctx) {
  tcModalCtx = ctx;
  const det = document.getElementById('mtc-detalle');
  if (det) det.innerHTML = ctx.detalle || '';
  const val = document.getElementById('mtc-valor');
  if (val) val.value = ctx.tc > 0 ? ctx.tc : '';
  actualizarPreviewTC();
  document.getElementById('modal-tc-backdrop').style.display = 'flex';
  if (val) setTimeout(() => val.focus(), 50);
}
function closeTCModal(e) {
  if (!e || e.target.id === 'modal-tc-backdrop') {
    document.getElementById('modal-tc-backdrop').style.display = 'none';
    tcModalCtx = null;
  }
}
function actualizarPreviewTC() {
  const el = document.getElementById('mtc-preview');
  if (!el) return;
  const tc = parseFloat(document.getElementById('mtc-valor')?.value) || 0;
  const usd = tcModalCtx ? _num(tcModalCtx.usd) : 0;
  el.textContent = (tc > 0 && usd > 0)
    ? 'Equivale a: ' + fmtPeso(Math.round(usd * tc)) + '  (' + fmtUSD(usd) + ' × ' + tc + ')'
    : 'Equivale a: —';
}
async function confirmarTCModal() {
  const tc = parseFloat(document.getElementById('mtc-valor')?.value) || 0;
  if (!(tc > 0)) { alert('Ingresá el tipo de cambio (pesos por USD).'); return; }
  const ctx = tcModalCtx;
  localStorage.setItem('liq_tc_usd', String(tc));
  document.getElementById('modal-tc-backdrop').style.display = 'none';
  tcModalCtx = null;
  if (ctx && ctx.onConfirmar) await ctx.onConfirmar(tc);
}

// Inserta la cuota. `monto` va en la moneda del adelanto (para el saldo) y
// `monto_ars` es lo que baja de la liquidación, que siempre se paga en pesos.
async function _registrarCuotaAdelanto(a, nro, fecha, tc) {
  const usd = adelantoEsUSD(a);
  const monto = _num(a.monto_cuota);
  const rec = {
    adelanto_id: a.id, nro, monto, fecha, fecha_date: fechaISOde(fecha),
    moneda: usd ? 'USD' : 'ARS',
    tipo_cambio: usd ? _num(tc) : 0,
    monto_ars: usd ? Math.round(monto * _num(tc)) : monto
  };
  const row = await DB.insertRow('adelanto_cuotas', rec);
  AppData.adelantoCuotas.push(Object.assign({ id: row && row.id }, rec));
  return rec;
}

// Registra la próxima cuota de un adelanto en la fecha elegida (la de su semana).
async function descontarCuota(adelantoId) {
  const a = AppData.adelantos.find(x => x.id === adelantoId);
  if (!a) return;
  if (!esAutorizado(a)) { showToast('⏳ Adelanto pendiente de autorización — no se puede imputar todavía'); return; }
  if (adelantoSaldado(a)) { showToast('Ese adelanto ya está saldado'); return; }
  const nro = cuotasPagadasDe(a.id) + 1;
  const fecha = fechaDescuentoAdelanto();

  const aplicar = async (tc) => {
    try {
      const rec = await _registrarCuotaAdelanto(a, nro, fecha, tc);
      renderAdelantos();
      showToast('✅ Cuota ' + nro + '/' + a.cuotas_total + ' de ' + a.conductor + ' descontada (' + fecha + ')' +
        (adelantoEsUSD(a) ? ' — ' + fmtUSD(rec.monto) + ' = ' + fmtPeso(rec.monto_ars) : ''));
    } catch (e) { console.warn('descontarCuota:', e); showToast('⛔ No se pudo registrar la cuota'); }
  };

  if (adelantoEsUSD(a)) {
    abrirTCModal({
      usd: _num(a.monto_cuota),
      tc: tcSugerido(a),
      detalle: '<strong>' + a.conductor + '</strong> · cuota ' + nro + '/' + a.cuotas_total +
               ' de <strong>' + fmtUSD(a.monto_cuota) + '</strong><br><span class="muted">Se imputa a la semana del ' + fecha + '</span>',
      onConfirmar: aplicar
    });
    return;
  }
  if (!confirm('¿Descontar la cuota ' + nro + '/' + a.cuotas_total + ' (' + fmtPeso(a.monto_cuota) + ') de ' + a.conductor + ' en la semana del ' + fecha + '?\nAparecerá en su liquidación de esa fecha.')) return;
  await aplicar(0);
}

// Descuenta la próxima cuota de TODOS los adelantos activos DEL GRUPO ACTIVO,
// misma fecha (rutina semanal).
async function descontarCuotaSemanal() {
  const activos = adelantosDeGrupo(adelGrupo).filter(a => !adelantoSaldado(a) && esAutorizado(a));
  if (!activos.length) { showToast('No hay adelantos activos autorizados en esta solapa'); return; }
  const fecha = fechaDescuentoAdelanto();
  const enUSD = activos.filter(adelantoEsUSD);

  const aplicar = async (tc) => {
    let ok = 0;
    for (const a of activos) {
      const nro = cuotasPagadasDe(a.id) + 1;
      try { await _registrarCuotaAdelanto(a, nro, fecha, tc); ok++; }
      catch (e) { console.warn('cuota masiva', a.conductor, e); }
    }
    renderAdelantos();
    showToast('✅ ' + ok + ' cuota(s) descontadas para la semana del ' + fecha);
  };

  // Si hay adelantos en dólares se pide UNA cotización para todos: es la del día.
  if (enUSD.length) {
    const usdTotal = enUSD.reduce((s, a) => s + _num(a.monto_cuota), 0);
    abrirTCModal({
      usd: usdTotal,
      tc: tcSugerido(enUSD[0]),
      detalle: 'Se van a descontar <strong>' + activos.length + ' cuota(s)</strong> en la semana del ' + fecha +
               '.<br>' + enUSD.length + ' son en dólares (' + fmtUSD(usdTotal) + ' en total) y necesitan cotización.',
      onConfirmar: aplicar
    });
    return;
  }
  if (!confirm('¿Descontar una cuota a los ' + activos.length + ' adelantos activos en la semana del ' + fecha + '?\nCada cuota aparecerá en la liquidación de esa semana.')) return;
  await aplicar(0);
}

// ── Modal "nuevo adelanto" ──────────────────────────────────────────────
let madvTipo = 'conductor';
let madvMoneda = 'ARS';

function openAddAdelantoModal() {
  document.getElementById('madv-conductor').value = '';
  document.getElementById('madv-monto').value = '';
  document.getElementById('madv-cuotas').value = '';
  document.getElementById('madv-fecha').value = hoyISO();
  document.getElementById('madv-obs').value = '';
  document.getElementById('madv-tc').value = '';
  poblarConductoresAdelantoDatalist();
  poblarEmpleadosAdelantoSelect();
  // El modal se abre en la solapa que el operador está mirando.
  setAdelantoBeneficiario(adelGrupo);
  setAdelantoMoneda('ARS');
  document.getElementById('modal-adelanto-backdrop').style.display = 'flex';
}
function closeAdelantoModal(e) {
  if (!e || e.target.id === 'modal-adelanto-backdrop') document.getElementById('modal-adelanto-backdrop').style.display = 'none';
}

function _toggleBtn(id, on) {
  const b = document.getElementById(id);
  if (b) b.classList.toggle('btn-primary', !!on);
}
function setAdelantoBeneficiario(tipo) {
  madvTipo = (tipo === 'empleado') ? 'empleado' : 'conductor';
  _toggleBtn('madv-tipo-conductor', madvTipo === 'conductor');
  _toggleBtn('madv-tipo-empleado', madvTipo === 'empleado');
  document.getElementById('madv-wrap-conductor').style.display = madvTipo === 'conductor' ? '' : 'none';
  document.getElementById('madv-wrap-empleado').style.display = madvTipo === 'empleado' ? '' : 'none';
}
function setAdelantoMoneda(m) {
  madvMoneda = (String(m).toUpperCase() === 'USD') ? 'USD' : 'ARS';
  _toggleBtn('madv-moneda-ars', madvMoneda === 'ARS');
  _toggleBtn('madv-moneda-usd', madvMoneda === 'USD');
  document.getElementById('madv-wrap-tc').style.display = madvMoneda === 'USD' ? '' : 'none';
  const unidad = document.getElementById('madv-monto-unidad');
  if (unidad) unidad.textContent = madvMoneda === 'USD' ? '(USD)' : '($)';
  actualizarPreviewCuota();
}

function poblarConductoresAdelantoDatalist() {
  const dl = document.getElementById('madv-conductores-list');
  if (!dl) return;
  const nombres = AppData.panelConductores.map(c => c.nombre);
  dl.innerHTML = Array.from(new Set(nombres)).sort().map(n => '<option value="' + n + '">').join('');
}
function poblarEmpleadosAdelantoSelect() {
  const sel = document.getElementById('madv-empleado');
  if (!sel) return;
  const lista = (AppData.empleados || []).filter(e => e.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  sel.innerHTML = '<option value="">Seleccionar empleado...</option>' +
    lista.map(e => '<option value="' + e.id + '">' + e.nombre + (e.puesto ? ' — ' + e.puesto : '') + '</option>').join('');
}

function actualizarPreviewCuota() {
  const monto = parseFloat(document.getElementById('madv-monto').value) || 0;
  const cuotas = parseInt(document.getElementById('madv-cuotas').value) || 0;
  const tc = parseFloat(document.getElementById('madv-tc')?.value) || 0;
  const el = document.getElementById('madv-preview');
  if (!el) return;
  if (!(monto > 0 && cuotas > 0)) { el.textContent = 'Cada cuota: —'; return; }
  const cuota = Math.round(monto / cuotas * 100) / 100;
  let txt = 'Cada cuota: ' + fmtMoneda(cuota, madvMoneda) + '  ×  ' + cuotas + ' cuotas';
  if (madvMoneda === 'USD') {
    txt += tc > 0
      ? '  ≈  ' + fmtPeso(Math.round(cuota * tc)) + ' por cuota'
      : '  ·  sin tipo de cambio se declara al descontar cada cuota';
  }
  el.textContent = txt;
}

async function guardarAdelantoModal() {
  const esEmp = madvTipo === 'empleado';
  let conductor = '', empleado_id = null;
  if (esEmp) {
    empleado_id = parseInt(document.getElementById('madv-empleado').value) || null;
    const emp = (AppData.empleados || []).find(x => x.id === empleado_id);
    if (!emp) { alert('Elegí un empleado de la lista.'); return; }
    conductor = emp.nombre; // el nombre del beneficiario, para buscador e historial
  } else {
    conductor = document.getElementById('madv-conductor').value.trim().toUpperCase();
    if (!conductor) { alert('El conductor es obligatorio.'); return; }
  }
  const monto_total = parseFloat(document.getElementById('madv-monto').value) || 0;
  const cuotas_total = parseInt(document.getElementById('madv-cuotas').value) || 0;
  const tipo_cambio = madvMoneda === 'USD' ? (parseFloat(document.getElementById('madv-tc').value) || 0) : 0;
  const iso = document.getElementById('madv-fecha').value;
  const obs = document.getElementById('madv-obs').value.trim();
  if (monto_total <= 0) { alert('El monto del adelanto debe ser mayor a 0.'); return; }
  if (cuotas_total < 1) { alert('Ingresá la cantidad de cuotas (1 o más).'); return; }
  const monto_cuota = madvMoneda === 'USD'
    ? Math.round(monto_total / cuotas_total * 100) / 100   // los dólares llevan centavos
    : Math.round(monto_total / cuotas_total);
  const fecha = iso ? isoToDMY(iso) : isoToDMY(hoyISO());
  const estado = estadoNuevaOperacion(); // operador → 'pendiente'; supervisor/analista → 'autorizado'
  const rec = { conductor, monto_total, cuotas_total, monto_cuota, fecha, obs, estado,
                beneficiario_tipo: esEmp ? 'empleado' : 'conductor', empleado_id,
                moneda: madvMoneda, tipo_cambio };
  try {
    const row = await DB.insertRow('adelantos', rec);
    AppData.adelantos.push(Object.assign({ id: row.id }, rec));
    document.getElementById('modal-adelanto-backdrop').style.display = 'none';
    // Dejar al operador parado en la solapa donde acaba de cargar el adelanto.
    switchAdelantoTab(esEmp ? 'empleado' : 'conductor');
    showToast(estado === 'pendiente'
      ? '📋 Adelanto de ' + conductor + ' cargado como PENDIENTE — falta que un supervisor lo autorice'
      : '✅ Adelanto de ' + conductor + ': ' + fmtMoneda(monto_total, madvMoneda) + ' en ' + cuotas_total + ' cuotas de ' + fmtMoneda(monto_cuota, madvMoneda));
  } catch (e) { console.warn('guardarAdelantoModal:', e); alert('No se pudo guardar el adelanto: ' + (e.message || e)); }
}

async function eliminarAdelanto(id) {
  const a = AppData.adelantos.find(x => x.id === id);
  if (!a) return;
  if (!confirm('¿Eliminar el adelanto de ' + a.conductor + '?\nSe borran también sus cuotas descontadas (afecta liquidaciones de esas semanas).')) return;
  try {
    await DB.deleteWhere('adelantos', 'id', id); // cascade borra las cuotas
    AppData.adelantos = AppData.adelantos.filter(x => x.id !== id);
    AppData.adelantoCuotas = AppData.adelantoCuotas.filter(c => c.adelanto_id !== id);
    renderAdelantos();
    showToast('🗑 Adelanto eliminado');
  } catch (e) { console.warn('eliminarAdelanto:', e); showToast('⛔ No se pudo eliminar'); }
}

// Deshace la última cuota descontada (por si se cargó de más).
async function deshacerUltimaCuota(adelantoId) {
  const cuotas = cuotasDeAdelanto(adelantoId).sort((x, y) => y.nro - x.nro);
  if (!cuotas.length) { showToast('No hay cuotas para deshacer'); return; }
  const ult = cuotas[0];
  if (!confirm('¿Deshacer la cuota ' + ult.nro + ' (' + fmtMoneda(ult.monto, ult.moneda) + ', semana del ' + ult.fecha + ')?')) return;
  try {
    await DB.deleteWhere('adelanto_cuotas', 'id', ult.id);
    AppData.adelantoCuotas = AppData.adelantoCuotas.filter(c => c.id !== ult.id);
    verHistorialAdelanto(adelantoId);
    renderAdelantos();
    showToast('↩ Cuota deshecha');
  } catch (e) { console.warn('deshacerUltimaCuota:', e); showToast('⛔ No se pudo deshacer'); }
}

// Modal detalle: cuotas del adelanto (pagadas y pendientes).
function verHistorialAdelanto(adelantoId) {
  const a = AppData.adelantos.find(x => x.id === adelantoId);
  if (!a) return;
  const usd = adelantoEsUSD(a);
  const cuotas = cuotasDeAdelanto(adelantoId);
  document.getElementById('modal-title').textContent = 'Adelanto · ' + a.conductor;
  const filas = [];
  for (let i = 1; i <= a.cuotas_total; i++) {
    const c = cuotas.find(x => x.nro === i);
    // En dólares importa a qué cotización se abonó cada cuota: es la que explica
    // por qué dos cuotas del mismo adelanto descontaron pesos distintos.
    const enPesos = c ? cuotaAdelantoARS(c) : (usd ? adelantoARS(a, a.monto_cuota) : _num(a.monto_cuota));
    filas.push('<tr>' +
      '<td class="mono">' + i + '/' + a.cuotas_total + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtMoneda(c ? c.monto : a.monto_cuota, a.moneda) + '</td>' +
      (usd ? '<td class="mono" style="text-align:right">' + (c && _num(c.tipo_cambio) ? '$' + _num(c.tipo_cambio).toLocaleString('es-AR') : '—') + '</td>' +
             '<td class="mono" style="text-align:right">' + (enPesos != null ? fmtPeso(enPesos) : '—') + '</td>' : '') +
      '<td>' + (c ? '<span class="badge badge-green"><i class="ic ic-check"></i> Descontada</span>' : '<span class="badge badge-gray">Pendiente</span>') + '</td>' +
      '<td class="mono muted">' + (c ? c.fecha : '—') + '</td>' +
    '</tr>');
  }
  const saldo = saldoAdelanto(a);
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">' +
      '<div>Beneficiario: <strong>' + (adelantoEsEmpleado(a) ? 'Empleado' : 'Conductor') + '</strong></div>' +
      '<div>Monto total: <strong>' + fmtMoneda(a.monto_total, a.moneda) + '</strong></div>' +
      '<div>Cuota: <strong>' + fmtMoneda(a.monto_cuota, a.moneda) + '</strong></div>' +
      '<div>Pagadas: <strong>' + cuotasPagadasDe(adelantoId) + '/' + a.cuotas_total + '</strong></div>' +
      '<div>Saldo: <strong style="color:' + (saldo > 0 ? '#b45309' : '#166534') + '">' + fmtMoneda(saldo, a.moneda) + '</strong></div>' +
    '</div>' +
    (usd && _num(a.tipo_cambio) ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Tipo de cambio pactado: $' + _num(a.tipo_cambio).toLocaleString('es-AR') + ' por USD</div>' : '') +
    (a.obs ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">📝 ' + a.obs + '</div>' : '') +
    '<div class="table-wrap" style="max-height:46vh;overflow:auto"><table><thead><tr><th>Cuota</th><th style="text-align:right">Monto</th>' +
      (usd ? '<th style="text-align:right">TC</th><th style="text-align:right">En pesos</th>' : '') +
      '<th>Estado</th><th>Semana</th></tr></thead><tbody>' + filas.join('') + '</tbody></table></div>' +
    (cuotasPagadasDe(adelantoId) ? '<div style="margin-top:10px;text-align:right"><button class="btn btn-sm" style="color:#b91c1c;border-color:#fca5a5" onclick="deshacerUltimaCuota(' + adelantoId + ')"><i class="ic ic-undo"></i> Deshacer última cuota</button></div>' : '');
  document.getElementById('modal-backdrop').classList.add('open');
}

// ── Plantilla + importación de Excel (crea adelantos; las cuotas se descuentan aparte) ──
// La importación carga en el GRUPO de la solapa activa: en Empleados, el nombre
// tiene que existir en el legajo (si no, no hay a quién descontarle el sueldo).
function descargarPlantillaAdelantos() {
  const esEmp = adelGrupo === 'empleado';
  const quien = esEmp ? 'Empleado' : 'Conductor';
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Completá desde la fila 3 (una fila por adelanto). La cuota se calcula sola = Monto total / Cuotas. Moneda: ARS o USD (si va vacía, ARS). El tipo de cambio es opcional y solo aplica a USD. Las cuotas se descuentan después con "− Cuota".'],
    [quien, 'Monto total', 'Cuotas', 'Moneda', 'Tipo de cambio', 'Fecha', 'Observación'],
    esEmp ? ['Nombre del empleado', 1000000, 10, 'ARS', '', '15/07/2026', 'Adelanto acordado']
          : ['ALEJO BRIEND', 1000000, 10, 'ARS', '', '15/07/2026', 'Adelanto acordado'],
    esEmp ? ['Nombre del empleado', 1000, 5, 'USD', 1200, '16/07/2026', 'Préstamo en dólares']
          : ['FEDERICO LABIGNAN', 1000, 5, 'USD', 1200, '16/07/2026', 'Préstamo en dólares'],
    ['NOMBRE APELLIDO', '', '', '', '', '', ''],
    ['NOMBRE APELLIDO', '', '', '', '', '', ''],
    ['NOMBRE APELLIDO', '', '', '', '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 14 }, { wch: 30 }];
  ws['!rows'] = [{ hpx: 40 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Adelantos');
  XLSX.writeFile(wb, 'Plantilla_Adelantos_' + (esEmp ? 'Empleados' : 'Conductores') + '.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importAdelantos(event) {
  const file = event.target.files[0];
  if (!file) return;
  const esEmp = adelGrupo === 'empleado';
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío o no tiene datos suficientes.'); return; }

      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('conductor') || cells.includes('cadete') || cells.includes('nombre') || cells.includes('empleado')) { headerRowIdx = r; break; }
      }
      if (headerRowIdx < 0) { alert('No se encontró una fila de encabezados válida (falta la columna "' + (esEmp ? 'Empleado' : 'Conductor') + '").\nDescargá la plantilla oficial.'); return; }

      const header = rows[headerRowIdx].map(h => String(h).toLowerCase().trim());
      const idx = {
        conductor: header.findIndex(h => h.includes('conductor') || h.includes('cadete') || h.includes('empleado') || h.includes('nombre')),
        monto:     header.findIndex(h => h.includes('monto') || h.includes('total') || h.includes('importe')),
        cuotas:    header.findIndex(h => h.includes('cuota')),
        moneda:    header.findIndex(h => h.includes('moneda')),
        tc:        header.findIndex(h => h.includes('cambio') || h === 'tc'),
        fecha:     header.findIndex(h => h.includes('fecha')),
        obs:       header.findIndex(h => h.includes('observ') || h.includes('nota') || h.includes('detalle') || h.includes('comentar')),
      };
      if (idx.conductor < 0) { alert('No se encontró la columna del beneficiario.'); return; }

      const parseNum = v => {
        if (v === '' || v == null) return 0;
        if (typeof v === 'number') return v;
        const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? 0 : n;
      };
      const empPorNombre = new Map((AppData.empleados || [])
        .filter(x => x.activo !== false)
        .map(x => [String(x.nombre).trim().toLowerCase(), x]));

      const nuevos = []; const sinLegajo = [];
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const nombreCrudo = String(r[idx.conductor] || '').trim();
        if (!nombreCrudo || nombreCrudo.toUpperCase() === 'NOMBRE APELLIDO' || nombreCrudo.toLowerCase() === 'nombre del empleado') continue;
        const monto_total = idx.monto >= 0 ? parseNum(r[idx.monto]) : 0;
        const cuotas_total = idx.cuotas >= 0 ? Math.round(parseNum(r[idx.cuotas])) : 0;
        if (monto_total <= 0 || cuotas_total < 1) continue;

        let conductor = nombreCrudo.toUpperCase(), empleado_id = null;
        if (esEmp) {
          const emp = empPorNombre.get(nombreCrudo.toLowerCase());
          if (!emp) { sinLegajo.push(nombreCrudo); continue; }
          empleado_id = emp.id; conductor = emp.nombre;
        }
        const moneda = idx.moneda >= 0 && String(r[idx.moneda]).trim().toUpperCase() === 'USD' ? 'USD' : 'ARS';
        const tipo_cambio = (moneda === 'USD' && idx.tc >= 0) ? parseNum(r[idx.tc]) : 0;
        const monto_cuota = moneda === 'USD'
          ? Math.round(monto_total / cuotas_total * 100) / 100
          : Math.round(monto_total / cuotas_total);
        const fecha = idx.fecha >= 0 ? fechaCeldaExcel(r[idx.fecha]) : '';
        const obs = idx.obs >= 0 ? String(r[idx.obs] || '').trim() : '';
        nuevos.push({ conductor, monto_total, cuotas_total, monto_cuota, fecha, obs,
                      estado: estadoNuevaOperacion(),
                      beneficiario_tipo: esEmp ? 'empleado' : 'conductor', empleado_id,
                      moneda, tipo_cambio });
      }

      if (!nuevos.length) {
        alert('No se importó ningún adelanto válido (revisá el nombre, el monto total y las cuotas).' +
          (sinLegajo.length ? '\n\nNo están en el plantel de empleados: ' + Array.from(new Set(sinLegajo)).join(', ') : ''));
        return;
      }

      let ok = 0;
      for (const a of nuevos) {
        try {
          const row = await DB.insertRow('adelantos', a);
          AppData.adelantos.push({ id: row.id, ...a });
          ok++;
        } catch (err) { console.warn('importAdelantos fila', a.conductor, err); }
      }
      renderAdelantos();
      showToast('✅ Importados ' + ok + ' adelantos' + (sinLegajo.length ? ' · ' + sinLegajo.length + ' sin legajo (omitidos)' : ''));
      if (sinLegajo.length) alert('Estos nombres no están en el plantel de empleados y se omitieron:\n\n' + Array.from(new Set(sinLegajo)).join('\n'));
    } catch (err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}
