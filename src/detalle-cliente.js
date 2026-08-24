// ════════════════════════════════════════════════════════════════════════
//  DETALLE DE CLIENTE — control y edición antes de facturar.
//  Espejo del panel Conductores, pero mirando el mismo envío desde el otro
//  lado del mostrador: qué se le COBRA al cliente (tarifa de venta por zona)
//  contra qué se le PAGA al conductor (tarifa de costo). La diferencia es el
//  margen.
//
//  Los dos paneles editan LOS MISMOS registros: si el administrativo de
//  clientes corrige una zona acá, el de conductores la ve corregida allá. Esa
//  es la sinergia — no hay dos bases de envíos, hay una sola.
// ════════════════════════════════════════════════════════════════════════

let dcliSoloSinTarifa = false;
let dcliDiasAbiertos = new Set();
let dcliClienteActual = null;

// Semana Vie→Jue que se está mirando (la del date, o la actual).
function dcliRango() {
  const iso = document.getElementById('dcli-semana')?.value || '';
  return semanaClienteRango(iso || undefined);
}

function dcliMoverSemana(dias) {
  const el = document.getElementById('dcli-semana');
  if (!el) return;
  const base = el.value ? new Date(el.value + 'T12:00:00') : new Date();
  base.setDate(base.getDate() + dias);
  el.value = base.toISOString().slice(0, 10);
  renderDetalleCliente();
}
function dcliSemanaAnterior() { dcliMoverSemana(-7); }
function dcliSemanaSiguiente() { dcliMoverSemana(7); }

function toggleDcliSinTarifa() {
  dcliSoloSinTarifa = !dcliSoloSinTarifa;
  renderDetalleCliente();
}

// Llena el selector conservando el cliente elegido (mismo cuidado que en
// Conductores: el re-render de realtime no puede sacarle el cliente de abajo
// al operador que está corrigiendo).
function renderDetalleClienteSelect() {
  const sel = document.getElementById('dcli-select');
  if (!sel) return;
  const elegido = sel.value;
  const lista = clientesDeRegistros(null);
  sel.innerHTML = '<option value="">Seleccionar cliente...</option>' +
    lista.map(c => '<option value="' + c.cod + '">' + c.nombre + ' (' + c.cod + ') · ' + c.envios + ' envíos</option>').join('');
  if (elegido) {
    if (!lista.some(c => c.cod === elegido)) {
      sel.insertAdjacentHTML('beforeend', '<option value="' + elegido + '">' + clienteNombreDe(elegido) + ' (sin envíos)</option>');
    }
    sel.value = elegido;
  }
}

function renderDetalleClientePagina() {
  renderDetalleClienteSelect();
  const el = document.getElementById('dcli-semana');
  if (el && !el.value) el.value = new Date().toISOString().slice(0, 10);
  renderDetalleCliente();
}

// Botón de cierre de la semana. Es el traspaso del administrativo al operador:
// mientras no esté marcada, la liquidación aparece en gris en el panel del
// operador y no se puede descargar — así nadie baja un PDF a medio corregir.
function _dcliBotonArmar(cod, rango) {
  if (typeof liquidacionArmada !== 'function') return '';
  const a = liquidacionArmada(cod, rango);
  const codEsc = String(cod).replace(/'/g, "\\'");
  if (a) {
    return '<div style="margin-top:8px;font-size:11px;opacity:.9">' +
      '<span class="badge badge-green"><i class="ic ic-check"></i> Liquidación lista</span>' +
      (a.armada_por ? '<div style="margin-top:3px">por ' + a.armada_por + '</div>' : '') +
      '<button class="btn btn-sm" style="margin-top:6px" onclick="dcliDesarmar(\'' + codEsc + '\')">Reabrir</button>' +
      '</div>';
  }
  return '<button class="btn btn-sm" style="margin-top:8px;background:#fff;color:#0e7490;border-color:#fff;font-weight:700" ' +
    'onclick="dcliArmar(\'' + codEsc + '\')" title="Cierra la semana de este cliente para que el operador pueda descargarla">' +
    '<i class="ic ic-check"></i> Marcar liquidación como lista</button>';
}

async function dcliArmar(cod) {
  const rango = dcliRango();
  const liq = calcLiquidacionCliente(cod, rango);
  if (!liq.totalEnvios) { alert('Este cliente no tiene envíos que facturen en la semana ' + rango.desde + ' → ' + rango.hasta + '.'); return; }
  // Las zonas sin tarifa se facturan en $0: conviene decidirlo antes de cerrar,
  // no después de que el operador haya mandado el PDF.
  if (liq.sinTarifa && !confirm('Ojo: ' + liq.sinTarifa + ' envío(s) están en zonas SIN tarifa de venta y se facturan en $0.\n\n' +
    '¿Marcar la liquidación como lista igual?')) return;
  await marcarLiquidacionLista(cod, rango);
  renderDetalleCliente();
}
async function dcliDesarmar(cod) {
  await desarmarLiquidacion(cod, dcliRango());
  renderDetalleCliente();
}

function renderDetalleCliente() {
  const wrap = document.getElementById('dcli-detalle-wrap');
  if (!wrap) return;
  const cod = document.getElementById('dcli-select')?.value || '';
  if (dcliClienteActual !== cod) { dcliClienteActual = cod; dcliDiasAbiertos = new Set(); }

  const rango = dcliRango();
  const rangoEl = document.getElementById('dcli-rango');
  if (rangoEl) rangoEl.textContent = rango.desde + ' → ' + rango.hasta;

  if (!cod) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ic ic-building"></i></div>' +
      '<div class="empty-title">Seleccioná un cliente</div>' +
      '<div class="empty-sub">Vas a poder revisar sus envíos y el margen antes de facturar</div></div>';
    return;
  }

  // Envíos del cliente en la semana (índices para poder editarlos).
  const idxs = [];
  (AppData.records || []).forEach((r, i) => {
    if (clienteCodDeRegistro(r) !== clienteKey(cod)) return;
    const f = parseFechaReg(r.fecha);
    if (!f) return;
    if (f < rango.desdeD || f > rango.hastaD) return;
    idxs.push(i);
  });

  // Cada envío: cobrado (tarifa de venta) vs pagado (costo del conductor).
  const detalle = idxs.map(i => {
    const r = AppData.records[i];
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const contab = contabilizaRegistro(r);
    const cobrado = contab ? clienteTarifaEnZona(cod, zona) : 0;
    const pagado = contab ? precioPagadoConductor(r) : 0;
    return { i, r, zona, contab, cobrado, pagado, margen: cobrado - pagado, sinTarifa: contab && cobrado <= 0 };
  });

  const sinTarifa = detalle.filter(d => d.sinTarifa).length;
  const badge = document.getElementById('dcli-sintarifa-count');
  if (badge) badge.textContent = sinTarifa ? (' · ' + sinTarifa) : '';
  const btn = document.getElementById('dcli-btn-sinzona');
  if (btn) {
    btn.style.borderColor = dcliSoloSinTarifa ? '#f59e0b' : '';
    btn.style.background = dcliSoloSinTarifa ? '#fffbeb' : '';
    btn.style.fontWeight = dcliSoloSinTarifa ? '700' : '';
  }

  const vista = dcliSoloSinTarifa ? detalle.filter(d => d.sinTarifa) : detalle;
  const cont = document.getElementById('dcli-count');
  if (cont) cont.textContent = dcliSoloSinTarifa
    ? 'Mostrando ' + vista.length + ' de ' + detalle.length + ' envíos'
    : detalle.length + ' envío(s) en la semana';

  const contab = detalle.filter(d => d.contab);
  const totCobrado = contab.reduce((s, d) => s + d.cobrado, 0);
  const totPagado = contab.reduce((s, d) => s + d.pagado, 0);
  const margen = totCobrado - totPagado;
  const pctMargen = totCobrado > 0 ? (margen * 100 / totCobrado) : 0;

  // Resumen por día (mismo plegado que Conductores: con cientos de filas,
  // scrollear es inmanejable).
  const porDia = new Map();
  vista.forEach(d => {
    const dia = (d.r.fecha || '').trim() || 'Sin fecha';
    let x = porDia.get(dia);
    if (!x) { x = { envios: 0, contab: 0, cobrado: 0, pagado: 0 }; porDia.set(dia, x); }
    x.envios++;
    if (d.contab) { x.contab++; x.cobrado += d.cobrado; x.pagado += d.pagado; }
  });

  let diaPrev = null;
  const filas = vista.map(d => {
    const dia = (d.r.fecha || '').trim() || 'Sin fecha';
    let sep = '';
    if (dia !== diaPrev) {
      diaPrev = dia;
      const rd = porDia.get(dia) || { envios: 0, contab: 0, cobrado: 0, pagado: 0 };
      const abierto = dcliDiasAbiertos.has(dia);
      const fd = parseFechaReg(dia);
      const dow = fd && typeof DIAS_SEM !== 'undefined' ? DIAS_SEM[fd.getDay()] + ' ' : '';
      sep = '<tr class="dcli-dia-head" style="background:var(--surface-0);cursor:pointer" data-dia="' + dia.replace(/"/g, '&quot;') + '" onclick="toggleDiaCliente(this.dataset.dia)">' +
        '<td colspan="7" style="padding:8px 12px;border-top:2px solid var(--border)">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px">' +
            '<span class="cond-dia-chev' + (abierto ? ' abierto' : '') + '" data-dia="' + dia.replace(/"/g, '&quot;') + '"><i class="ic ic-chevrons-down"></i></span>' +
            '<strong style="font-size:13px"><i class="ic ic-calendar"></i> ' + dow + dia + '</strong>' +
            '<span class="muted">' + rd.contab + ' de ' + rd.envios + ' facturan</span>' +
            '<strong style="margin-left:auto;font-family:monospace">' + fmtPeso(rd.cobrado) + '</strong>' +
            '<span class="muted" style="font-family:monospace">− ' + fmtPeso(rd.pagado) + '</span>' +
            '<strong style="font-family:monospace;color:' + (rd.cobrado - rd.pagado >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(rd.cobrado - rd.pagado) + '</strong>' +
          '</div></td></tr>';
    }
    const oculto = dcliDiasAbiertos.has(dia) ? '' : 'display:none;';
    const zonaCat = (typeof zonaCatalogoDe === 'function') ? zonaCatalogoDe(d.r.cadete || '') : [];
    return sep +
      '<tr class="dcli-fila-dia" data-dia="' + dia.replace(/"/g, '&quot;') + '" style="' + oculto + (d.contab ? '' : 'background:#fdf6f6;') + '">' +
        '<td class="mono" style="font-size:11.5px">' + (d.r.tracking || '—') +
          (d.r.destinatario ? '<div class="muted" style="font-size:10px">' + d.r.destinatario + '</div>' : '') + '</td>' +
        '<td class="muted mono" style="font-size:12px">' + (d.r.fecha || '—') + '</td>' +
        '<td>' + ((typeof zonaSelectHTML === 'function')
            ? zonaSelectHTML(zonaCat, d.i, d.r.zona, d.r.cadete || '')
            : (d.zona || '—')) + '</td>' +
        '<td style="font-size:11px">' + (d.contab
            ? '<span class="badge" style="background:#dcfce7;color:#166534">Factura</span>'
            : '<span class="badge" style="background:#fee2e2;color:#b91c1c">No factura</span>') +
          '<div class="muted" style="font-size:10px;margin-top:2px">' + (d.r.estado || '—') + '</div></td>' +
        '<td class="mono" style="text-align:right">' + (d.sinTarifa
            ? '<span style="color:#b45309" title="La zona no tiene tarifa de venta para este cliente">sin tarifa</span>'
            : fmtPeso(d.cobrado)) + '</td>' +
        '<td class="mono" style="text-align:right;color:var(--text-muted)">' + fmtPeso(d.pagado) + '</td>' +
        '<td class="mono" style="text-align:right;font-weight:700;color:' + (d.margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(d.margen) + '</td>' +
      '</tr>';
  }).join('');

  wrap.innerHTML =
    '<div class="card">' +
      '<div class="conductor-header" style="background:linear-gradient(135deg,#0e7490 0%,#0e7490cc 100%)">' +
        '<div class="big-avatar" style="background:rgba(255,255,255,0.25)">' + initials(clienteNombreDe(cod)) + '</div>' +
        '<div>' +
          '<div class="conductor-name">' + clienteNombreDe(cod) + '</div>' +
          '<div class="conductor-meta"><strong>' + cod + '</strong> · ' + detalle.length + ' envíos · ' +
            contab.length + ' facturan · ' + clienteNZonas(cod) + ' zonas con tarifa' +
            (sinTarifa ? ' · ⚠ ' + sinTarifa + ' sin tarifa' : '') + '</div>' +
        '</div>' +
        '<div style="margin-left:auto;text-align:right">' +
          '<div style="font-size:11px;opacity:.85;text-transform:uppercase;letter-spacing:.04em">A facturar</div>' +
          '<div style="font-size:24px;font-weight:700">' + fmtPeso(totCobrado) + '</div>' +
          // Acá cierra el administrativo: hasta que no marque la semana como
          // lista, el operador no la ve para descargar.
          _dcliBotonArmar(cod, rango) +
        '</div>' +
      '</div>' +
      '<div class="metrics" style="padding:14px 16px 0">' +
        '<div class="metric-card"><div class="metric-ic"><i class="ic ic-dollar"></i></div>' +
          '<div class="metric-label">Se le cobra al cliente</div><div class="metric-value">' + fmtPeso(totCobrado) + '</div>' +
          '<div class="metric-sub">' + contab.length + ' envíos facturables</div></div>' +
        '<div class="metric-card"><div class="metric-ic"><i class="ic ic-truck"></i></div>' +
          '<div class="metric-label">Se le paga a los conductores</div><div class="metric-value">' + fmtPeso(totPagado) + '</div>' +
          '<div class="metric-sub">por esos mismos envíos</div></div>' +
        '<div class="metric-card"><div class="metric-ic"><i class="ic ic-alert"></i></div>' +
          '<div class="metric-label">Margen</div>' +
          '<div class="metric-value" style="color:' + (margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(margen) + '</div>' +
          '<div class="metric-sub">' + pctMargen.toFixed(1) + '% de lo facturado</div></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted)">' +
        '<span>Los días arrancan cerrados — tocá uno para ver y corregir sus envíos.</span>' +
        '<button class="btn btn-sm" style="margin-left:auto;padding:3px 8px;font-size:10.5px" onclick="abrirTodosLosDiasCliente(true)">Abrir todos</button>' +
        '<button class="btn btn-sm" style="padding:3px 8px;font-size:10.5px" onclick="abrirTodosLosDiasCliente(false)">Cerrar todos</button>' +
      '</div>' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>Tracking</th><th>Fecha</th><th>Zona</th><th>¿Factura?</th>' +
          '<th style="text-align:right">Se cobra</th><th style="text-align:right">Se paga</th><th style="text-align:right">Margen</th></tr></thead>' +
        '<tbody>' + (filas || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">' +
          (dcliSoloSinTarifa ? '✅ No hay envíos sin tarifa en la semana' : 'Sin envíos de este cliente en la semana') + '</td></tr>') + '</tbody>' +
      '</table></div>' +
      '<div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">' +
        '💡 Corregir la zona acá también corrige lo que se le paga al conductor: es el mismo envío.' +
      '</div>' +
    '</div>';
}

// Plegado por día: se muestra/oculta sin re-renderizar, igual que en Conductores.
function toggleDiaCliente(dia) {
  if (!dia) return;
  if (dcliDiasAbiertos.has(dia)) dcliDiasAbiertos.delete(dia);
  else dcliDiasAbiertos.add(dia);
  aplicarPlegadoDiasCliente();
}
function aplicarPlegadoDiasCliente() {
  const wrap = document.getElementById('dcli-detalle-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('tr.dcli-fila-dia').forEach(tr => {
    tr.style.display = dcliDiasAbiertos.has(tr.dataset.dia) ? '' : 'none';
  });
  wrap.querySelectorAll('.cond-dia-chev').forEach(el => {
    el.classList.toggle('abierto', dcliDiasAbiertos.has(el.dataset.dia));
  });
}
function abrirTodosLosDiasCliente(abrir) {
  const wrap = document.getElementById('dcli-detalle-wrap');
  if (!wrap) return;
  dcliDiasAbiertos = new Set();
  if (abrir) wrap.querySelectorAll('tr.dcli-dia-head').forEach(tr => dcliDiasAbiertos.add(tr.dataset.dia));
  aplicarPlegadoDiasCliente();
}
