// ════════════════════════════════════════════════════════════════════════
//  DETALLE DE CLIENTE — donde el administrativo ARMA la liquidación.
//  Se revisan los envíos de la semana (zona, estado, si factura), se corrige
//  lo que haga falta y se cierra con "Marcar liquidación como lista", que es
//  lo que habilita al operador a descargarla desde Liquidación de clientes.
//
//  A propósito NO se muestra el costo del conductor ni el margen: acá se está
//  armando lo que se le factura AL CLIENTE, y mezclar el otro lado del
//  mostrador solo agrega ruido a esa tarea.
//
//  Los dos paneles editan LOS MISMOS registros: si se corrige una zona acá, el
//  detalle de conductor la ve corregida allá — no hay dos bases de envíos.
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
// Al elegir un día cualquiera, el campo se corre al viernes de esa semana.
function dcliCambioSemana() {
  if (typeof snapSemanaCliente === 'function') snapSemanaCliente('dcli-semana');
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
  if (typeof snapSemanaCliente === 'function') snapSemanaCliente('dcli-semana');
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
      '<div class="empty-sub">Vas a poder revisar y corregir sus envíos antes de facturarle</div></div>';
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

  // Cada envío con lo que se le factura al cliente por su zona.
  const detalle = idxs.map(i => {
    const r = AppData.records[i];
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const contab = contabilizaRegistro(r);
    const cobrado = contab ? precioVentaEnvio(cod, r) : 0;
    return { i, r, zona, contab, cobrado, sinTarifa: contab && cobrado <= 0 };
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

  // Catálogo de zonas con el precio DE VENTA de este cliente (una vez por
  // render). Antes se usaba el del conductor, que mostraba lo que se le paga al
  // cadete y su categoría — acá no va ninguna de las dos cosas.
  const zonaCat = zonaCatalogoCliente(cod);
  const zonaPreviewCliente = z => _dcliPreviewZona(cod, z);

  // Resumen por día (mismo plegado que Conductores: con cientos de filas,
  // scrollear es inmanejable).
  const porDia = new Map();
  vista.forEach(d => {
    const dia = (d.r.fecha || '').trim() || 'Sin fecha';
    let x = porDia.get(dia);
    if (!x) { x = { envios: 0, contab: 0, cobrado: 0 }; porDia.set(dia, x); }
    x.envios++;
    if (d.contab) { x.contab++; x.cobrado += d.cobrado; }
  });

  let diaPrev = null;
  const filas = vista.map(d => {
    const dia = (d.r.fecha || '').trim() || 'Sin fecha';
    let sep = '';
    if (dia !== diaPrev) {
      diaPrev = dia;
      const rd = porDia.get(dia) || { envios: 0, contab: 0, cobrado: 0 };
      // Con el filtro puesto los días van ABIERTOS: si no, el filtro decía
      // "23 envíos" y no se veía ninguno, porque quedaban dentro de días plegados.
      const abierto = dcliSoloSinTarifa || dcliDiasAbiertos.has(dia);
      const fd = parseFechaReg(dia);
      const dow = fd && typeof DIAS_SEM !== 'undefined' ? DIAS_SEM[fd.getDay()] + ' ' : '';
      sep = '<tr class="dcli-dia-head" style="background:var(--surface-0);cursor:pointer" data-dia="' + dia.replace(/"/g, '&quot;') + '" onclick="toggleDiaCliente(this.dataset.dia)">' +
        '<td colspan="5" style="padding:8px 12px;border-top:2px solid var(--border)">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px">' +
            '<span class="cond-dia-chev' + (abierto ? ' abierto' : '') + '" data-dia="' + dia.replace(/"/g, '&quot;') + '"><i class="ic ic-chevrons-down"></i></span>' +
            '<strong style="font-size:13px"><i class="ic ic-calendar"></i> ' + dow + dia + '</strong>' +
            '<span class="muted">' + rd.contab + ' de ' + rd.envios + ' facturan</span>' +
            '<strong style="margin-left:auto;font-family:monospace">' + fmtPeso(rd.cobrado) + '</strong>' +
          '</div></td></tr>';
    }
    const oculto = (dcliSoloSinTarifa || dcliDiasAbiertos.has(dia)) ? '' : 'display:none;';
    return sep +
      '<tr class="dcli-fila-dia" data-dia="' + dia.replace(/"/g, '&quot;') + '" style="' + oculto + (d.contab ? '' : 'background:#fdf6f6;') + '">' +
        '<td class="mono" style="font-size:11.5px">' + (d.r.tracking || '—') +
          (d.r.destinatario ? '<div class="muted" style="font-size:10px">' + d.r.destinatario + '</div>' : '') + '</td>' +
        '<td class="muted mono" style="font-size:12px">' + (d.r.fecha || '—') + '</td>' +
        '<td>' + ((typeof zonaSelectHTML === 'function')
            ? zonaSelectHTML(zonaCat, d.i, d.r.zona, d.r.cadete || '', zonaPreviewCliente)
            : (d.zona || '—')) + '</td>' +
        '<td style="font-size:11px">' + (d.contab
            ? '<span class="badge" style="background:#dcfce7;color:#166534">Factura</span>'
            : '<span class="badge" style="background:#fee2e2;color:#b91c1c">No factura</span>') +
          '<div class="muted" style="font-size:10px;margin-top:2px">' + (d.r.estado || '—') + '</div></td>' +
        '<td class="mono" style="text-align:right">' + (d.sinTarifa
            ? '<span style="color:#b45309" title="La zona no tiene tarifa de venta para este cliente">sin tarifa</span>'
            : fmtPeso(d.cobrado)) + '</td>' +

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
        '<div class="metric-card"><div class="metric-ic"><i class="ic ic-box"></i></div>' +
          '<div class="metric-label">Envíos que facturan</div><div class="metric-value">' + contab.length + '</div>' +
          '<div class="metric-sub">de ' + detalle.length + ' de la semana</div></div>' +
        '<div class="metric-card"' + (sinTarifa ? ' style="border-color:#f5d97a"' : '') + '><div class="metric-ic"><i class="ic ic-alert"></i></div>' +
          '<div class="metric-label">En zonas sin tarifa</div>' +
          '<div class="metric-value"' + (sinTarifa ? ' style="color:#b45309"' : '') + '>' + sinTarifa + '</div>' +
          '<div class="metric-sub">se facturan en $0 — cargá esas zonas</div></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted)">' +
        '<span>Los días arrancan cerrados — tocá uno para ver y corregir sus envíos.</span>' +
        '<button class="btn btn-sm" style="margin-left:auto;padding:3px 8px;font-size:10.5px" onclick="abrirTodosLosDiasCliente(true)">Abrir todos</button>' +
        '<button class="btn btn-sm" style="padding:3px 8px;font-size:10.5px" onclick="abrirTodosLosDiasCliente(false)">Cerrar todos</button>' +
      '</div>' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>Tracking</th><th>Fecha</th><th>Zona</th><th>¿Factura?</th>' +
          '<th style="text-align:right">Se factura</th></tr></thead>' +
        '<tbody>' + (filas || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">' +
          (dcliSoloSinTarifa ? '✅ No hay envíos sin tarifa en la semana' : 'Sin envíos de este cliente en la semana') + '</td></tr>') + '</tbody>' +
      '</table></div>' +
      '<div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">' +
        '💡 Corregí la zona o el estado y el total se recalcula solo. Cuando esté listo, marcá la liquidación como lista para que el operador pueda descargarla.' +
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

// ════════════════════════════════════════════════════════════════════════
//  ZONAS CON EL PRECIO DE VENTA
//  El selector de zona de este panel NO puede usar el catálogo del conductor
//  (zonaCatalogoDe): ese etiqueta con getPrecio(), o sea lo que se le PAGA al
//  cadete, y arrastra su categoría — "MATANZA SUR · $3.400 · Super SLA". Acá se
//  arma lo que se le COBRA al cliente, así que cada zona tiene que mostrar la
//  tarifa de venta de ESE cliente. Además Super SLA es una categoría de
//  conductor: verla acá hacía pensar que el tarifario del cliente estaba mal.
// ════════════════════════════════════════════════════════════════════════

// Zonas ofrecidas: las del tarifario de costos (la lista canónica de zonas
// reales) MÁS las que el cliente tenga tarifadas. No se limita a las que el
// cliente tiene con precio: la zona de un envío es un lugar real y el operador
// tiene que poder corregirla aunque todavía no esté tarifada — para eso queda
// marcada "sin tarifa", que es justo lo que cuenta el aviso de arriba.
function zonaCatalogoCliente(cod) {
  const k = clienteKey(cod);
  const zonas = new Set(
    ((typeof zonasDelTarifario === 'function') ? zonasDelTarifario() : [])
  );
  (AppData.clienteTarifas || []).forEach(t => {
    if (clienteKey(t.cliente_cod) !== k) return;
    const z = String(t.zona || '').trim().toUpperCase();
    if (z && (typeof esZonaValida !== 'function' || esZonaValida(z))) zonas.add(z);
  });
  return Array.from(zonas).sort().map(z => {
    const p = clienteTarifaEnZona(k, z);
    return { val: z, label: z + ' · ' + (p > 0 ? fmtPeso(p) : 'sin tarifa') };
  });
}

// Vista previa al confirmar una zona: lo que pasaría a facturarse.
function _dcliPreviewZona(cod, zona) {
  const p = clienteTarifaEnZona(clienteKey(cod), zona);
  return p > 0
    ? '<span style="color:#15803d;font-weight:600">' + zona + ' · ' + fmtPeso(p) + '</span>'
    : '<span style="color:#b91c1c;font-weight:600">' + zona + ' · sin tarifa · se factura $0</span>';
}
