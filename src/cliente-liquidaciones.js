// ════════════════════════════════════════════════════════════════════════
//  LIQUIDACIÓN DE CLIENTES — el panel del OPERADOR.
//
//  El circuito tiene dos manos y este panel es la segunda:
//    1) el ADMINISTRATIVO revisa y corrige los envíos de la semana en
//       "Detalle de cliente" y, cuando está conforme, marca la liquidación
//       como lista;
//    2) el OPERADOR entra acá y descarga las que están listas.
//
//  Sin ese estado el operador no podría distinguir lo revisado de lo que
//  todavía nadie miró, y bajaría PDFs de datos a medio corregir. Por eso las
//  que faltan armar también se muestran (en gris): saber qué falta es parte
//  del trabajo.
//
//  Los montos NO se congelan: se calculan en vivo desde los envíos, así una
//  corrección posterior del administrativo se refleja en el PDF.
// ════════════════════════════════════════════════════════════════════════

// Jueves de corte de la semana que se está mirando (ISO).
function cliqSemanaISO() {
  const el = document.getElementById('cliq-semana');
  return (el && el.value) || hoyISO();
}

// ── Estado "armada" ─────────────────────────────────────────────────────
function liquidacionArmada(cod, rango) {
  const k = clienteKey(cod);
  const hasta = fechaISOde(rango.hasta);
  return (AppData.clienteLiquidaciones || []).find(x =>
    clienteKey(x.cliente_cod) === k && String(x.semana_hasta).slice(0, 10) === hasta) || null;
}

async function marcarLiquidacionLista(cod, rango) {
  const k = clienteKey(cod);
  if (!k) return;
  if (liquidacionArmada(k, rango)) return;
  const rec = {
    cliente_cod: k,
    semana_desde: fechaISOde(rango.desde),
    semana_hasta: fechaISOde(rango.hasta),
    armada_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
    armada_en: new Date().toISOString(),
    // Se congela lo facturado: sin esto, corregir una zona o anular un envío
    // meses después movería para atrás la evaluación de comisiones —y con ella
    // una categoría que ya se está pagando.
    monto: _num(calcLiquidacionCliente(k, rango).total),
    cuenta_comision: false
  };
  try {
    const row = await DB.insertRow('cliente_liquidaciones', rec);
    AppData.clienteLiquidaciones.push(Object.assign({ id: row && row.id }, rec));
    showToast('✅ Liquidación de ' + clienteNombreDe(k) + ' marcada como lista — el operador ya puede descargarla');
  } catch (e) { console.warn('marcarLiquidacionLista', e); showToast('⛔ No se pudo marcar'); }
}

async function desarmarLiquidacion(cod, rango) {
  const a = liquidacionArmada(cod, rango);
  if (!a) return;
  if (!confirm('¿Reabrir la liquidación de ' + clienteNombreDe(cod) + ' (' + rango.desde + ' → ' + rango.hasta + ')?\n' +
    'Vuelve a quedar pendiente y el operador deja de verla como lista.')) return;
  try {
    await DB.deleteWhere('cliente_liquidaciones', 'id', a.id);
    AppData.clienteLiquidaciones = AppData.clienteLiquidaciones.filter(x => x.id !== a.id);
    showToast('↩ Liquidación reabierta');
  } catch (e) { console.warn('desarmarLiquidacion', e); showToast('⛔ No se pudo reabrir'); }
}

// ── Listado del panel ───────────────────────────────────────────────────
// Todos los clientes con envíos contabilizables en la semana, armados o no.
function cliqListado(rango) {
  // El rango que llega es el de la SEMANA de la fecha elegida; sirve para
  // saber a quién mirar, pero cada cliente se liquida por SU período (7, 14
  // o 28 días). Un quincenal que no cierra esta semana no tiene nada que
  // descargar todavía, y mostrarle media quincena seria un numero falso.
  const conEnvios = clientesDeRegistros(rango);
  const iso = (rango && rango.desdeD)
    ? rango.desdeD.getFullYear() + '-' + String(rango.desdeD.getMonth() + 1).padStart(2, '0') + '-' + String(rango.desdeD.getDate()).padStart(2, '0')
    : undefined;
  return conEnvios.map(c => {
    const rc = periodoClienteRango(c.cod, iso);
    const liq = calcLiquidacionCliente(c.cod, rc);
    const armada = liquidacionArmada(c.cod, rc);
    return {
      cod: c.cod, nombre: clienteNombreDe(c.cod), rango: rc,
      periodo: periodoDiasDe(c.cod), periodoLabel: periodoLabel(periodoDiasDe(c.cod)),
      envios: liq.totalEnvios, total: liq.total,
      sinTarifa: liq.sinTarifa, armada
    };
  }).filter(x => x.envios > 0)
    .sort((a, b) => (b.armada ? 1 : 0) - (a.armada ? 1 : 0) || b.total - a.total);
}

let cliqSeleccion = new Set();
function toggleCliqSel(cod, on) {
  if (on) cliqSeleccion.add(clienteKey(cod)); else cliqSeleccion.delete(clienteKey(cod));
  renderClienteLiquidaciones();
}
function toggleCliqSelTodas(on) {
  const rango = semanaClienteRango(cliqSemanaISO());
  cliqListado(rango).filter(x => x.armada).forEach(x => {
    if (on) cliqSeleccion.add(x.cod); else cliqSeleccion.delete(x.cod);
  });
  renderClienteLiquidaciones();
}

// Al elegir un día cualquiera, el campo se corre al viernes de esa semana.
function cliqCambioSemana() {
  if (typeof snapSemanaCliente === 'function') snapSemanaCliente('cliq-semana');
  renderClienteLiquidaciones();
}

function renderClienteLiquidacionesPagina() {
  const f = document.getElementById('cliq-semana');
  if (f && !f.value) f.value = hoyISO();
  if (typeof snapSemanaCliente === 'function') snapSemanaCliente('cliq-semana');
  renderClienteLiquidaciones();
}

function renderClienteLiquidaciones() {
  const body = document.getElementById('cliq-rows');
  if (!body) return;
  const rango = semanaClienteRango(cliqSemanaISO());
  const per = document.getElementById('cliq-periodo');
  // Cada cliente puede tener su propio ciclo, así que el encabezado habla de
  // la fecha elegida y cada fila muestra el período que le toca.
  if (per) per.textContent = 'Períodos que contienen la semana ' + rango.desde + ' → ' + rango.hasta;

  _cliqAvisoEmpresa();

  const q = (document.getElementById('cliq-search')?.value || '').toLowerCase().trim();
  const todas = cliqListado(rango);
  const lista = todas.filter(x => !q || x.nombre.toLowerCase().includes(q) || x.cod.toLowerCase().includes(q));
  const armadas = todas.filter(x => x.armada);

  // Resumen: lo listo, lo que falta y cuánto factura la semana.
  const res = document.getElementById('cliq-resumen');
  if (res) {
    const totalArmado = armadas.reduce((s, x) => s + x.total, 0);
    const pendientes = todas.length - armadas.length;
    res.innerHTML =
      '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-check"></i></div>' +
        '<div class="metric-label">Listas para descargar</div><div class="metric-value">' + armadas.length + '</div>' +
        '<div class="metric-sub">' + fmtPeso(totalArmado) + ' a facturar</div></div>' +
      '<div class="metric-card"' + (pendientes ? ' style="border-color:#f5d97a"' : '') + '><div class="metric-ic"><i class="ic ic-alert"></i></div>' +
        '<div class="metric-label">Sin armar</div><div class="metric-value"' + (pendientes ? ' style="color:#b45309"' : '') + '>' + pendientes + '</div>' +
        '<div class="metric-sub">las arma el administrativo en Detalle de cliente</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-building"></i></div>' +
        '<div class="metric-label">Clientes con envíos</div><div class="metric-value">' + todas.length + '</div>' +
        '<div class="metric-sub">en la semana elegida</div></div>';
  }

  const nSel = armadas.filter(x => cliqSeleccion.has(x.cod)).length;
  const btn = document.getElementById('cliq-btn-descargar');
  if (btn) {
    btn.disabled = !armadas.length;
    btn.innerHTML = '<i class="ic ic-download"></i> ' + (nSel
      ? 'Descargar ' + nSel + ' seleccionada' + (nSel > 1 ? 's' : '')
      : 'Descargar las ' + armadas.length + ' listas');
  }
  const unico = document.getElementById('cliq-btn-unpdf');
  if (unico) unico.style.display = (nSel || armadas.length) > 1 ? '' : 'none';
  const all = document.getElementById('cliq-check-all');
  if (all) {
    all.checked = armadas.length > 0 && nSel === armadas.length;
    all.indeterminate = nSel > 0 && nSel < armadas.length;
  }

  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-file"></i></div>' +
      '<div class="empty-title">Sin clientes con envíos</div>' +
      '<div class="empty-sub">No hay envíos entregados en la semana ' + rango.desde + ' → ' + rango.hasta + '</div></div></td></tr>';
    return;
  }

  body.innerHTML = lista.map(x => {
    const codEsc = String(x.cod).replace(/'/g, "\\'");
    return '<tr' + (x.armada ? '' : ' style="opacity:.6"') + '>' +
      '<td>' + (x.armada
        ? '<input type="checkbox" class="cliq-check" ' + (cliqSeleccion.has(x.cod) ? 'checked' : '') +
          ' onchange="toggleCliqSel(\'' + codEsc + '\',this.checked)">'
        : '') + '</td>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(x.nombre) + '</div>' +
        '<div><strong>' + x.nombre + '</strong><div class="muted" style="font-size:10px">' + x.cod +
          (x.periodo !== 7 ? ' · ' + x.periodoLabel : '') + '</div>' +
          '<div class="muted" style="font-size:9.5px">' + x.rango.desde + ' → ' + x.rango.hasta + '</div></div></div></td>' +
      '<td class="mono" style="text-align:right">' + x.envios + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.total) + '</td>' +

      '<td>' + (x.sinTarifa
        ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74" title="Envíos en zonas sin tarifa de venta: se facturan en $0">' + x.sinTarifa + ' sin tarifa</span>'
        : '<span class="muted" style="font-size:11px">—</span>') + '</td>' +
      '<td>' + (x.armada
        ? '<span class="badge badge-green"><i class="ic ic-check"></i> Lista</span>' +
          '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' +
            (x.armada.armada_por ? 'por ' + x.armada.armada_por : '') +
            (x.armada.armada_en ? ' · ' + new Date(x.armada.armada_en).toLocaleDateString('es-AR') : '') + '</div>'
        : '<span class="badge badge-gray">⏳ Sin armar</span>') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="verDetalleDesdeLiq(\'' + codEsc + '\')" title="Abrir en Detalle de cliente">Ver detalle</button>' +
        (x.armada
          ? '<button class="btn btn-sm btn-primary" onclick="descargarLiqCliente(\'' + codEsc + '\')"><i class="ic ic-download"></i></button>'
          : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// Salta al panel de edición con ese cliente y esa semana ya puestos.
function verDetalleDesdeLiq(cod) {
  showPage('detalle-cliente');
  const sel = document.getElementById('dcli-select');
  const fecha = document.getElementById('dcli-semana');
  if (fecha) fecha.value = cliqSemanaISO();
  if (sel) { sel.value = clienteKey(cod); if (typeof renderDetalleCliente === 'function') renderDetalleCliente(); }
}

// La liquidación es el papel que se le manda al cliente: sin razón social ni
// CUIT no se puede saber quién la emite, y eso se descubre del otro lado. Se
// avisa acá, que es donde se bajan, y antes de bajar cuarenta.
function _cliqAvisoEmpresa() {
  const box = document.getElementById('cliq-aviso-empresa');
  if (!box) return;
  if (typeof empresaFaltaFiscal !== 'function' || !empresaFaltaFiscal()) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="alert" style="margin-bottom:16px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d">' +
    '<i class="ic ic-alert"></i><div><strong>Faltan los datos de la empresa.</strong> El PDF que se le manda al cliente sale sin ' +
    '<strong>razón social ni CUIT</strong> en el encabezado y el pie, así que no identifica a quién lo emite. ' +
    '<button class="btn btn-sm" style="margin-left:6px" onclick="abrirDatosEmpresa()">Cargarlos</button></div></div>';
}

// ── Descarga ────────────────────────────────────────────────────────────
function cliqADescargar() {
  const rango = semanaClienteRango(cliqSemanaISO());
  const armadas = cliqListado(rango).filter(x => x.armada);
  const elegidas = armadas.filter(x => cliqSeleccion.has(x.cod));
  return { rango, lista: elegidas.length ? elegidas : armadas };
}

function descargarLiqCliente(cod) {
  exportLiquidacionClientePDF(cod, periodoClienteRango(cod, cliqSemanaISO()));
}

async function descargarLiqClientes() {
  const { rango, lista } = cliqADescargar();
  if (!lista.length) { alert('No hay liquidaciones armadas en esta semana.'); return; }
  if (lista.length > 1) {
    const segs = Math.ceil(lista.length * LIQ_MS_ENTRE_DESCARGAS / 1000);
    if (!confirm('Se van a descargar ' + lista.length + ' archivos.\n\n' +
      'Van de a uno para que el navegador no descarte ninguno: tarda unos ' + segs + ' segundos.\n' +
      'Si preferís un único archivo, cancelá y usá "En un solo PDF".')) return;
  }
  const btn = document.getElementById('cliq-btn-descargar');
  const original = btn ? btn.innerHTML : '';
  if (btn) btn.disabled = true;
  try {
    for (let i = 0; i < lista.length; i++) {
      if (btn) btn.innerHTML = '<i class="ic ic-download"></i> Descargando ' + (i + 1) + ' de ' + lista.length + '…';
      exportLiquidacionClientePDF(lista[i].cod, lista[i].rango || rango);
      if (i < lista.length - 1) await _esperar(LIQ_MS_ENTRE_DESCARGAS);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
    renderClienteLiquidaciones();
  }
  showToast('✅ ' + lista.length + ' liquidación(es) descargadas');
}

async function descargarLiqClientesCombinado() {
  const { rango, lista } = cliqADescargar();
  if (!lista.length) { alert('No hay liquidaciones armadas en esta semana.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  for (let i = 0; i < lista.length; i++) {
    exportLiquidacionClientePDF(lista[i].cod, lista[i].rango || rango, { doc, nuevaPagina: i > 0 });
    await _esperar(0);
  }
  doc.save('Liquidaciones_clientes_' + lista.length + '_' + rango.hasta.replace(/\//g, '-') + '.pdf');
  showToast('📄 ' + lista.length + ' liquidaciones en un solo PDF');
}

// ── Reapertura automática ───────────────────────────────────────────────
// Una liquidación que cambió DESPUÉS de cerrarse no está lista: el tesorero
// podría bajar un PDF que ya no coincide con lo aprobado, o mandar uno y que el
// número se mueva atrás suyo. Así que cualquier cambio que toque lo que se le
// factura la desmarca sola y vuelve a quedar pendiente del administrativo.
// Sin confirmación: no es una decisión, es la consecuencia de lo que se hizo.
async function _reabrirPorCambio(cod, rango, queCambio) {
  const k = clienteKey(cod);
  if (!k || !rango) return false;
  const a = liquidacionArmada(k, rango);
  if (!a) return false;
  try {
    await DB.deleteWhere('cliente_liquidaciones', 'id', a.id);
    AppData.clienteLiquidaciones = (AppData.clienteLiquidaciones || []).filter(x => x.id !== a.id);
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    setTimeout(() => showToast('↩ La liquidación de ' + clienteNombreDe(k) + ' (' + rango.desde + ' → ' +
      rango.hasta + ') se reabrió: cambió ' + (queCambio || 'un envío') +
      ' después de cerrarse. Volvé a marcarla como lista.'), 900);
    return true;
  } catch (e) { console.warn('_reabrirPorCambio', e); return false; }
}

// Reabre la liquidación del cliente de ESE envío, en el período que le toca.
// Si el envío está arrastrado, el período afectado es el de destino.
async function reabrirLiquidacionDeEnvio(r, queCambio) {
  if (!r || typeof clienteCodDeRegistro !== 'function') return;
  const cod = clienteCodDeRegistro(r);
  if (!cod) return;
  const arr = String(r.factura_semana || '').slice(0, 10);
  const iso = arr || (typeof isoDeFecha === 'function' ? isoDeFecha(parseFechaReg(r.fecha)) : null);
  if (!iso) return;
  await _reabrirPorCambio(cod, periodoClienteRango(cod, iso), queCambio);
}
