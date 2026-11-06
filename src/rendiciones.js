// ════════════════════════════════════════════════════════════════════════
//  RENDICIÓN DE ENVÍOS (cobros en destino)
//
//  El circuito real tiene DOS ETAPAS, no una:
//    1) El conductor sale ~16 h, entrega y COBRA al destinatario. Al día
//       siguiente ~14 h vuelve, devuelve lo no entregado y RINDE la plata a la
//       empresa.                                    → estado "recibido"
//    2) La empresa le DEVUELVE esa plata al cliente, normalmente en un solo
//       pago por el total.                          → estado "rendido"
//
//  Antes había un único paso y los dos momentos quedaban mezclados: no se
//  podía saber si la plata estaba en la calle, en la empresa o ya devuelta —
//  que es justo lo que hay que responder cuando un cliente reclama.
//
//  Si el conductor no viene, o vuelve sin haber cobrado, el registro SIGUE
//  PENDIENTE (con su atraso a la vista) hasta que alguien lo resuelva: no se
//  borra ni se cierra solo.
// ════════════════════════════════════════════════════════════════════════

// ── Helpers ─────────────────────────────────────────────────────────────────
function _rendHoy() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function _rendDMY(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

// El conductor rinde al día siguiente de la entrega, cerca de las 14 h.
const RENDICION_HORA_LIMITE = 14;
function limiteRendicion(fechaEntregaDMY) {
  const f = parseFechaReg(fechaEntregaDMY);
  if (!f) return null;
  const l = new Date(f);
  l.setDate(l.getDate() + 1);
  l.setHours(RENDICION_HORA_LIMITE, 0, 0, 0);
  return l;
}

// Estado del cobro:
//   pendiente → la plata está en la calle (el conductor todavía no la trajo)
//   vencido   → pendiente y ya pasó la hora de rendir del día siguiente
//   recibido  → la empresa tiene la plata, falta devolvérsela al cliente
//   rendido   → devuelta al cliente
function estadoRendicion(r) {
  // Descontado de liquidación: el cobro se saldó contra la factura del
  // cliente en vez de devolverle la plata. Cierra igual que "rendido" —no
  // queda nada esperando— pero es OTRO hecho y por eso se cuenta aparte.
  // NO toca la liquidación del cliente: solo deja registrado que se saldó así.
  if (r.estado === 'descontado') return 'descontado';
  if (r.estado === 'rendido') return 'rendido';
  if (r.estado === 'recibido') return 'recibido';
  if (r.estado === 'anulado') return 'anulado';
  const lim = limiteRendicion(r.fecha_entrega);
  if (lim && new Date() > lim) return 'vencido';
  return 'pendiente';
}

// ¿La plata todavía la tiene el conductor? (lo que se le reclama)
function enLaCalle(r) {
  const e = estadoRendicion(r);
  return e === 'pendiente' || e === 'vencido';
}
// ¿Está en la empresa, esperando que se le devuelva al cliente?
function enLaEmpresa(r) { return estadoRendicion(r) === 'recibido'; }

function diasAtraso(r) {
  const lim = limiteRendicion(r.fecha_entrega);
  if (!lim) return 0;
  const d = Math.floor((new Date() - lim) / 86400000);
  return d > 0 ? d : 0;
}

const REND_ESTADOS = {
  pendiente: { label: 'En la calle',        color: '#854d0e', bg: '#fef9c3', borde: '#fde68a' },
  vencido:   { label: 'Atrasado',           color: '#b91c1c', bg: '#fee2e2', borde: '#fca5a5' },
  recibido:  { label: 'En la empresa',      color: '#1d4ed8', bg: '#dbeafe', borde: '#bfdbfe' },
  rendido:   { label: 'Devuelto al cliente',color: '#166534', bg: '#dcfce7', borde: '#bbf7d0' },
  descontado:{ label: 'Descontado de liquidación', color: '#5b21b6', bg: '#ede9fe', borde: '#ddd6fe' },
  anulado:   { label: 'Anulado',            color: '#6b7280', bg: '#f3f4f6', borde: '#e5e7eb' }
};
function rendBadge(est) {
  const c = REND_ESTADOS[est] || REND_ESTADOS.pendiente;
  return '<span class="badge" style="background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.borde + '">' + c.label + '</span>';
}

function persistirRendicionesLocal() {
  try { localStorage.setItem('liq_rendiciones', JSON.stringify(AppData.rendiciones)); } catch (e) {}
}

// Deuda de cada conductor: lo que cobró y todavía no trajo.
function deudaPorConductor() {
  const m = new Map();
  rendicionesDelPeriodo().forEach(r => {
    if (!enLaCalle(r)) return;
    const k = conductorCanonico(r.conductor) || r.conductor;
    let x = m.get(k);
    if (!x) { x = { conductor: k, monto: 0, cobros: 0, atraso: 0 }; m.set(k, x); }
    x.monto += _num(r.monto); x.cobros++;
    const d = diasAtraso(r);
    if (d > x.atraso) x.atraso = d;
  });
  return Array.from(m.values()).sort((a, b) => b.monto - a.monto);
}

// Lo que hay que devolverle a cada cliente: cobros que ya están en la empresa.
function aDevolverPorCliente() {
  const m = new Map();
  rendicionesDelPeriodo().forEach(r => {
    if (!enLaEmpresa(r)) return;
    const k = String(r.cliente || '(sin cliente)').trim();
    let x = m.get(k);
    if (!x) { x = { cliente: k, monto: 0, cobros: 0, ids: [] }; m.set(k, x); }
    x.monto += _num(r.monto); x.cobros++; x.ids.push(r.id);
  });
  return Array.from(m.values()).sort((a, b) => b.monto - a.monto);
}

// ════════════════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════════════════
let rendFiltroEstado = 'abiertas';   // abiertas | calle | vencido | recibido | rendido | todas

// Rango por fecha de ENTREGA. Vacío = todo, para no esconder deuda vieja sin
// querer: si arrancara filtrado por el mes, un cobro atrasado de hace dos meses
// no aparecería en ningún lado.
// El período se maneja con el MISMO navegador de mes que el resto de
// Imputaciones (‹ noviembre de 2026 › + "Todos"). Antes había un rango
// desde/hasta con atajos propios: dos filtros de fecha en el mismo panel se
// pelean, y uno que parece puesto y no manda ya fue un bug en esta app.

// ¿Cae el cobro en el rango elegido?
// El mes se mide por la fecha de ENTREGA, que es cuando el conductor cobró.
function _rendEnMes(r) {
  const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('rendiciones') : '';
  if (!mes) return true;
  // Un cobro cargado sobre un envío que TODAVÍA NO SE ENTREGÓ no tiene
  // fecha de entrega, y es plata abierta: se muestra en cualquier mes.
  // Esconderla detrás del filtro la convertiría en un punto ciego, que es
  // justo por lo que el rango viejo arrancaba vacío.
  if (!r.fecha_entrega) return true;
  return String(dmyToISO(r.fecha_entrega) || '').slice(0, 7) === mes;
}

// Los cobros del mes: es la base de TODO el panel (totales, listas y tabla),
// así se puede cerrar un mes como en la planilla.
function rendicionesDelPeriodo() {
  return (AppData.rendiciones || []).filter(_rendEnMes);
}

// Las 6 solapas de estado (Abiertos · En la calle · Atrasados · En la empresa ·
// Devueltos · Todos) llamaban a esta función y NO existía: cada clic tiraba un
// ReferenceError y la tabla se quedaba siempre en "Abiertos", sin ninguna señal
// de que el filtro no había hecho nada.
function setFiltroRendicion(estado) {
  rendFiltroEstado = estado || 'abiertas';
  renderRendiciones();
}

// Marca cuál de las 6 está activa. Sin esto, aunque el filtro funcione, la
// solapa resaltada sigue siendo la primera y no se sabe qué se está mirando.
function _pintarSolapasRendicion() {
  ['abiertas', 'calle', 'vencido', 'recibido', 'rendido', 'descontado', 'todas'].forEach(f => {
    const b = document.getElementById('rend-f-' + f);
    if (b) b.classList.toggle('active', f === rendFiltroEstado);
  });
}

function renderRendiciones() {
  const cont = document.getElementById('rend-rows');
  if (!cont) return;
  _pintarSolapasRendicion();
  _renderCobrosPendientes();
  const lista = rendicionesDelPeriodo();

  // ── Resumen: dónde está la plata ──
  const enCalle = lista.filter(enLaCalle);
  const atrasados = enCalle.filter(r => diasAtraso(r) > 0);
  const enEmpresa = lista.filter(enLaEmpresa);
  const devueltos = lista.filter(r => estadoRendicion(r) === 'rendido');
  const suma = arr => arr.reduce((a, r) => a + _num(r.monto), 0);

  const met = document.getElementById('rend-metrics');
  if (met) met.innerHTML =
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-truck"></i></div>' +
      '<div class="metric-label">En la calle</div><div class="metric-value">' + fmtPeso(suma(enCalle)) + '</div>' +
      '<div class="metric-sub">' + enCalle.length + ' cobro(s) que los choferes no trajeron' +
      (atrasados.length ? ' · <strong style="color:#b91c1c">' + atrasados.length + ' atrasado(s)</strong>' : '') + '</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-building"></i></div>' +
      '<div class="metric-label">En la empresa</div><div class="metric-value">' + fmtPeso(suma(enEmpresa)) + '</div>' +
      '<div class="metric-sub">' + enEmpresa.length + ' cobro(s) a devolver al cliente</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-check"></i></div>' +
      '<div class="metric-label">Devuelto al cliente</div><div class="metric-value">' + fmtPeso(suma(devueltos)) + '</div>' +
      '<div class="metric-sub">' + devueltos.length + ' cobro(s) cerrados</div></div>';

  // ── Deuda por chofer: a quién hay que reclamarle ──
  const cont1 = document.getElementById('rend-por-conductor');
  if (cont1) {
    const deuda = deudaPorConductor();
    cont1.innerHTML = deuda.length
      ? deuda.map(d =>
          '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">' +
            '<div class="conductor-avatar" style="background:' + avatarColor(d.conductor) + ';width:26px;height:26px;font-size:9px">' + initials(d.conductor) + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12.5px;font-weight:600">' + d.conductor + '</div>' +
              '<div style="font-size:10px;color:var(--text-muted)">' + d.cobros + ' cobro(s)' +
                (d.atraso ? ' · <span style="color:#b91c1c">atraso ' + d.atraso + ' día(s)</span>' : '') + '</div>' +
            '</div>' +
            '<strong class="mono" style="white-space:nowrap">' + fmtPeso(d.monto) + '</strong>' +
            '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="recibirDeChofer(\'' + jsAttr(d.conductor) + '\')" title="Registrar que trajo la plata">Recibí todo</button>' +
          '</div>').join('')
      : '<div class="muted" style="padding:14px;text-align:center;font-size:12px">Ningún chofer tiene plata sin rendir</div>';
  }

  // ── A devolver por cliente: el segundo tramo del circuito ──
  const cont2 = document.getElementById('rend-por-cliente');
  if (cont2) {
    const dev = aDevolverPorCliente();
    cont2.innerHTML = dev.length
      ? dev.map(c =>
          '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">' +
            '<div class="conductor-avatar" style="background:' + avatarColor(c.cliente) + ';width:26px;height:26px;font-size:9px">' + initials(c.cliente) + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12.5px;font-weight:600">' + c.cliente + '</div>' +
              '<div style="font-size:10px;color:var(--text-muted)">' + c.cobros + ' cobro(s) en la empresa</div>' +
            '</div>' +
            '<strong class="mono" style="white-space:nowrap">' + fmtPeso(c.monto) + '</strong>' +
            '<button class="btn btn-sm btn-primary" style="padding:3px 7px;font-size:10px" onclick="abrirDevolucionCliente(\'' + jsAttr(c.cliente) + '\')">Devolver</button>' +
            '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="descontarDeLiquidacion(\'' + jsAttr(c.cliente) + '\')" title="Se tomó como parte de pago en la factura del cliente">Descontar</button>' +
          '</div>').join('')
      : '<div class="muted" style="padding:14px;text-align:center;font-size:12px">No hay plata en la empresa esperando devolución</div>';
  }

  // ── Tabla de detalle ──
  const q = (document.getElementById('rend-search')?.value || '').toLowerCase().trim();
  const filtradas = lista.filter(r => {
    const e = estadoRendicion(r);
    if (rendFiltroEstado === 'abiertas') return e === 'pendiente' || e === 'vencido' || e === 'recibido';
    if (rendFiltroEstado === 'calle') return e === 'pendiente' || e === 'vencido';
    if (rendFiltroEstado === 'descontado') return e === 'descontado';
    if (rendFiltroEstado === 'todas') return true;
    return e === rendFiltroEstado;
  }).filter(r => !q ||
    String(r.conductor || '').toLowerCase().includes(q) ||
    String(r.cliente || '').toLowerCase().includes(q) ||
    String(r.tracking || '').toLowerCase().includes(q));

  filtradas.sort((a, b) => {
    const pa = enLaCalle(a) ? 0 : (enLaEmpresa(a) ? 1 : 2);
    const pb = enLaCalle(b) ? 0 : (enLaEmpresa(b) ? 1 : 2);
    if (pa !== pb) return pa - pb;
    return diasAtraso(b) - diasAtraso(a);
  });

  const info = document.getElementById('rend-info');
  if (info) {
    const mes = (typeof _panelMesActivo === 'function') ? _panelMesActivo('rendiciones') : '';
    info.textContent = filtradas.length + ' de ' + lista.length + ' cobro(s)' +
      (mes ? ' · entregas de ' + mes : '');
  }

  if (!filtradas.length) {
    cont.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon"><i class="ic ic-card"></i></div>' +
      '<div class="empty-title">Sin cobros para mostrar</div>' +
      '<div class="empty-sub">Traelos de los envíos con "Traer de los envíos" o cargá uno a mano</div></div></td></tr>';
    return;
  }

  cont.innerHTML = filtradas.map(r => {
    const est = estadoRendicion(r);
    const atraso = diasAtraso(r);
    return '<tr>' +
      '<td class="mono" style="font-size:11.5px">' + (r.tracking || '—') + '</td>' +
      '<td style="font-size:12px">' + (r.cliente || '—') + '</td>' +
      '<td style="font-size:12px">' + (r.conductor || '—') + '</td>' +
      '<td class="muted mono" style="font-size:11.5px">' + (r.fecha_entrega || '—') +
        '<div style="font-size:10px">rinde ' + (limiteRendicion(r.fecha_entrega) ? _rendDMY(limiteRendicion(r.fecha_entrega)) : '—') + '</div></td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(_num(r.monto)) + '</td>' +
      '<td>' + rendBadge(est) +
        (atraso && enLaCalle(r) ? '<div style="font-size:10px;color:#b91c1c;margin-top:2px">' + atraso + ' día(s) de atraso</div>' : '') +
        (r.obs ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + r.obs + '</div>' : '') + '</td>' +
      '<td style="font-size:11px">' +
        (r.fecha_recibido ? '<div>Recibido ' + r.fecha_recibido + '</div>' : '') +
        (r.fecha_rendicion ? '<div style="color:#166534">Devuelto ' + r.fecha_rendicion + '</div>' : '') +
        (!r.fecha_recibido && !r.fecha_rendicion && !descuentoDeCobro(r.id) ? '—' : '') +
        (function () {
          const d = descuentoDeCobro(r.id);
          if (!d) return '';
          const pend = (typeof esAutorizado === 'function') && !esAutorizado(d);
          return '<div style="margin-top:2px;color:#0f766e">Imputado ' + fmtPeso(_num(d.monto)) +
            (pend ? ' <span style="color:#9a3412">(falta autorizar)</span>' : '') +
            ' <button class="btn btn-sm" style="padding:0 5px;font-size:10px" onclick="quitarImputacionCobro(' + r.id + ')" title="Sacarle el descuento">✕</button></div>';
        })() + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        (enLaCalle(r) && !descuentoDeCobro(r.id)
          ? '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="openRendirModal(' + r.id + ')" title="El chofer trajo la plata"><i class="ic ic-check"></i> Recibir</button>' +
            '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="imputarCobroAlConductor(' + r.id + ')" title="No lo rindió: descontárselo de su liquidación">Imputar</button>'
          : '') +
        (enLaEmpresa(r)
          ? '<button class="btn btn-sm btn-primary" style="padding:3px 7px;font-size:10px" onclick="abrirDevolucionCliente(\'' + jsAttr(r.cliente || '') + '\')" title="Devolverle la plata al cliente">Devolver</button>' +
            '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="descontarDeLiquidacion(\'' + jsAttr(r.cliente || '') + '\')" title="Se tomó como parte de pago en la factura del cliente">Descontar</button>'
          : '') +
        '<button class="btn btn-sm" style="padding:3px 6px;font-size:10px" onclick="editRendicion(' + r.id + ')"><i class="ic ic-edit"></i></button>' +
        (est !== 'pendiente' && est !== 'vencido'
          ? '<button class="btn btn-sm" style="padding:3px 6px;font-size:10px" onclick="reabrirRendicion(' + r.id + ')" title="Volver atrás">↩</button>'
          : '') +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function openAddRendicionModal() {
  rendEditId = null;
  document.getElementById('modal-rend-title').textContent = 'Nuevo cobro en destino';
  ['mrend-tracking','mrend-cliente','mrend-monto','mrend-obs'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  document.getElementById('mrend-conductor').value = '';
  document.getElementById('mrend-fecha').value = hoyISO();
  _rendDatalists();
  document.getElementById('modal-rend-backdrop').style.display = 'flex';
}
function editRendicion(id) {
  const r = (AppData.rendiciones || []).find(x => x.id === id);
  if (!r) return;
  rendEditId = id;
  document.getElementById('modal-rend-title').textContent = 'Editar cobro';
  document.getElementById('mrend-tracking').value = r.tracking || '';
  document.getElementById('mrend-conductor').value = r.conductor || '';
  document.getElementById('mrend-cliente').value = r.cliente || '';
  document.getElementById('mrend-monto').value = _num(r.monto) || '';
  document.getElementById('mrend-obs').value = r.obs || '';
  const f = parseFechaReg(r.fecha_entrega);
  document.getElementById('mrend-fecha').value = f ? isoLocal(f) : hoyISO();
  _rendDatalists();
  document.getElementById('modal-rend-backdrop').style.display = 'flex';
}
function closeRendModal(e) {
  if (!e || e.target.id === 'modal-rend-backdrop') document.getElementById('modal-rend-backdrop').style.display = 'none';
}
function _rendDatalists() {
  const dc = document.getElementById('mrend-conductores-list');
  if (dc) dc.innerHTML = (AppData.panelConductores || []).map(c => '<option value="' + String(c.nombre).replace(/"/g, '&quot;') + '">').join('');
  const dl = document.getElementById('mrend-clientes-list');
  if (dl) dl.innerHTML = (AppData.clientes || []).map(c => '<option value="' + String(c.nombre).replace(/"/g, '&quot;') + '">').join('');
}
async function guardarRendicionModal() {
  const conductor = (document.getElementById('mrend-conductor').value || '').trim().toUpperCase();
  const monto = parseFloat(document.getElementById('mrend-monto').value) || 0;
  const fechaISO = document.getElementById('mrend-fecha').value;
  if (!conductor) { alert('Indicá el conductor que hizo la cobranza.'); return; }
  if (!(monto > 0)) { alert('El monto cobrado debe ser mayor a 0.'); return; }
  if (!fechaISO) { alert('Indicá la fecha de entrega (cuándo cobró).'); return; }
  const fechaDMY = isoToDMY(fechaISO);
  const lim = limiteRendicion(fechaDMY);
  const rec = {
    tracking: (document.getElementById('mrend-tracking').value || '').trim().toUpperCase(),
    conductor,
    cliente: (document.getElementById('mrend-cliente').value || '').trim().toUpperCase(),
    monto,
    fecha_entrega: fechaDMY, fecha_entrega_date: fechaISO,
    fecha_limite: lim ? isoLocal(lim) : null,
    obs: (document.getElementById('mrend-obs').value || '').trim(),
    origen: 'manual',
    registrado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || ''
  };
  try {
    if (rendEditId != null) {
      await DB.updateWhere('rendiciones', 'id', rendEditId, rec);
      const r = AppData.rendiciones.find(x => x.id === rendEditId);
      if (r) Object.assign(r, rec);
    } else {
      rec.estado = 'pendiente';
      const row = await DB.insertRow('rendiciones', rec);
      AppData.rendiciones.push(Object.assign({ id: row.id }, rec));
    }
    persistirRendicionesLocal();
    rendEditId = null;
    document.getElementById('modal-rend-backdrop').style.display = 'none';
    renderRendiciones();
    showToast('✅ Cobro registrado');
  } catch (e) { console.warn('guardarRendicionModal', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

// ── Rendir ───────────────────────────────────────────────────────────────────
let rendirId = null;
function openRendirModal(id) {
  const r = (AppData.rendiciones || []).find(x => x.id === id);
  if (!r) return;
  rendirId = id;
  const est = estadoRendicion(r);
  document.getElementById('mrendir-info').innerHTML =
    '<strong>' + r.conductor + '</strong> rinde <strong>' + fmtPeso(_num(r.monto)) + '</strong>' +
    (r.cliente ? ' · cliente ' + r.cliente : '') +
    '<br><span class="muted">' + (r.tracking ? 'Tracking ' + r.tracking + ' · ' : '') + 'entregado el ' + (r.fecha_entrega || '—') + '</span>' +
    (est === 'vencido' ? '<br><span style="color:#b91c1c">⚠ Vencido hace ' + diasAtraso(r) + ' día(s)</span>' : '');
  document.getElementById('mrendir-fecha').value = hoyISO();
  document.getElementById('mrendir-medio').value = 'efectivo';
  document.getElementById('mrendir-obs').value = '';
  document.getElementById('modal-rendir-backdrop').style.display = 'flex';
}
function closeRendirModal(e) {
  if (!e || e.target.id === 'modal-rendir-backdrop') document.getElementById('modal-rendir-backdrop').style.display = 'none';
}
// PASO 1 — el chofer trajo la plata. Ojo: esto NO cierra el circuito, la plata
// queda en la empresa hasta que se le devuelva al cliente.
async function confirmarRendicion() {
  if (rendirId == null) return;
  const r = AppData.rendiciones.find(x => x.id === rendirId);
  if (!r) return;
  const fechaISO = document.getElementById('mrendir-fecha').value || hoyISO();
  const campos = {
    estado: 'recibido',
    fecha_recibido: isoToDMY(fechaISO), fecha_recibido_date: fechaISO,
    medio_recibido: document.getElementById('mrendir-medio').value || '',
    recibido_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
    obs: (document.getElementById('mrendir-obs').value || '').trim() || r.obs || ''
  };
  try {
    await DB.updateWhere('rendiciones', 'id', rendirId, campos);
    Object.assign(r, campos);
    persistirRendicionesLocal();
    document.getElementById('modal-rendir-backdrop').style.display = 'none';
    renderRendiciones();
    showToast('✅ Recibido del chofer: ' + fmtPeso(_num(r.monto)) + ' — falta devolvérselo al cliente');
  } catch (e) { console.warn('confirmarRendicion', e); alert('No se pudo registrar: ' + (e.message || e)); }
}

// Recibir de una vez TODO lo que un chofer trajo (el caso normal: vuelve al
// mediodía y rinde todo junto).
async function recibirDeChofer(conductor) {
  const key = conductorKey(conductor);
  const pend = (AppData.rendiciones || []).filter(r => enLaCalle(r) && conductorKey(r.conductor) === key);
  if (!pend.length) { showToast('Ese chofer no tiene cobros sin rendir'); return; }
  const total = pend.reduce((a, r) => a + _num(r.monto), 0);
  const iso = hoyISO();
  if (!confirm('¿Registrar que ' + conductor + ' rindió ' + pend.length + ' cobro(s) por ' + fmtPeso(total) + '?\n\n' +
               'La plata queda EN LA EMPRESA hasta que se le devuelva a cada cliente.')) return;
  const campos = {
    estado: 'recibido',
    fecha_recibido: isoToDMY(iso), fecha_recibido_date: iso,
    recibido_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || ''
  };
  let ok = 0;
  for (const r of pend) {
    try { await DB.updateWhere('rendiciones', 'id', r.id, campos); Object.assign(r, campos); ok++; }
    catch (e) { console.warn('recibirDeChofer', r.id, e); }
  }
  persistirRendicionesLocal();
  renderRendiciones();
  showToast('✅ ' + ok + ' cobro(s) recibidos de ' + conductor);
}

// ── PASO 2 — devolverle la plata al cliente, en LOTE ──
// En la práctica se devuelve con un solo pago por el total, no uno por envío.
let rendLoteCliente = null;

function abrirDevolucionCliente(cliente) {
  const cli = String(cliente || '').trim();
  const items = (AppData.rendiciones || []).filter(r => enLaEmpresa(r) && String(r.cliente || '').trim() === cli);
  if (!items.length) { showToast('No hay cobros de ' + cli + ' en la empresa'); return; }
  rendLoteCliente = cli;
  const total = items.reduce((a, r) => a + _num(r.monto), 0);
  document.getElementById('mdev-cliente').textContent = cli;
  document.getElementById('mdev-resumen').textContent = items.length + ' cobro(s) · ' + fmtPeso(total);
  document.getElementById('mdev-fecha').value = hoyISO();
  document.getElementById('mdev-medio').value = 'transferencia';
  document.getElementById('mdev-comprobante').value = '';
  document.getElementById('mdev-obs').value = '';
  document.getElementById('mdev-detalle').innerHTML = items.map(r =>
    '<div style="display:flex;gap:8px;padding:4px 0;font-size:11px;border-top:1px solid var(--border)">' +
      '<span class="mono" style="color:var(--text-muted)">' + (r.tracking || '—') + '</span>' +
      '<span style="flex:1">' + (r.conductor || '') + '</span>' +
      '<strong>' + fmtPeso(_num(r.monto)) + '</strong></div>').join('');
  document.getElementById('modal-devolucion-backdrop').style.display = 'flex';
}

function cerrarDevolucion(e) {
  if (!e || e.target.id === 'modal-devolucion-backdrop') {
    document.getElementById('modal-devolucion-backdrop').style.display = 'none';
    rendLoteCliente = null;
  }
}

async function confirmarDevolucionCliente() {
  if (!rendLoteCliente) return;
  const items = (AppData.rendiciones || []).filter(r => enLaEmpresa(r) && String(r.cliente || '').trim() === rendLoteCliente);
  if (!items.length) { showToast('No quedan cobros para devolver'); return; }
  const iso = document.getElementById('mdev-fecha').value || hoyISO();
  const medio = document.getElementById('mdev-medio').value || '';
  const comprobante = (document.getElementById('mdev-comprobante').value || '').trim();
  const obs = (document.getElementById('mdev-obs').value || '').trim();
  const total = items.reduce((a, r) => a + _num(r.monto), 0);

  try {
    // El lote deja constancia del pago único que se le hizo al cliente.
    const lote = {
      cliente: rendLoteCliente,
      cliente_cod: (typeof clienteCodDeRegistro === 'function'
        ? ((AppData.clientes || []).find(c => normNombre(c.nombre) === normNombre(rendLoteCliente)) || {}).codigo || '' : ''),
      fecha: isoToDMY(iso), fecha_date: iso,
      monto: total, cantidad: items.length, medio, comprobante, obs,
      registrado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || ''
    };
    const row = await DB.insertRow('rendicion_lotes', lote);
    AppData.rendicionLotes = AppData.rendicionLotes || [];
    AppData.rendicionLotes.push(Object.assign({ id: row && row.id }, lote));

    const campos = {
      estado: 'rendido',
      fecha_rendicion: isoToDMY(iso), fecha_rendicion_date: iso,
      medio, comprobante,
      rendido_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
      lote_id: row && row.id
    };
    let ok = 0;
    for (const r of items) {
      try { await DB.updateWhere('rendiciones', 'id', r.id, campos); Object.assign(r, campos); ok++; }
      catch (e) { console.warn('devolucion', r.id, e); }
    }
    persistirRendicionesLocal();
    document.getElementById('modal-devolucion-backdrop').style.display = 'none';
    rendLoteCliente = null;
    renderRendiciones();
    showToast('✅ Devuelto a ' + lote.cliente + ': ' + fmtPeso(total) + ' (' + ok + ' cobros)');
  } catch (e) {
    console.warn('confirmarDevolucionCliente', e);
    alert('No se pudo registrar la devolución: ' + (e.message || e));
  }
}
// IMPUTARLE EL COBRO AL CONDUCTOR
//   El cobro lo tiene el chofer y no lo trajo: lo DEBE, y si no lo entrega se
//   le descuenta. Eso NO pasa solo —lo decide el operador— pero cuando lo
//   decide tiene que poder hacerlo desde acá, que es donde está la deuda.
//
//   Va como tipo PROPIO (`cobros`) y no dentro de extravíos ni de
//   proveedores: el conductor firma el PDF de su liquidación y ahí el
//   descuento tiene que decir de qué es. Metido en otro concepto, el papel
//   diría que se le cobró un extravío que no existió.
//
//   SE FECHA HOY, no el día de la entrega: la fecha decide en qué semana cae
//   el descuento, y la de la entrega lo metería en una liquidación que puede
//   estar cerrada hace semanas —o en ninguna—. Hoy lo pone en la que se está
//   pagando, que es cuando se recupera la plata.
//
//   Y pasa por el régimen de autorización como los adelantos y los extravíos
//   (`estadoNuevaOperacion`): es plata que se le saca a una persona, así que
//   la carga uno y la aprueba otro.
function descuentoDeCobro(idRendicion) {
  return (AppData.descItems || []).find(x => x.origen_rendicion_id === idRendicion) || null;
}

async function imputarCobroAlConductor(id) {
  const r = (AppData.rendiciones || []).find(x => x.id === id);
  if (!r) { showToast('Ese cobro ya no está'); return; }
  if (descuentoDeCobro(id)) {
    showToast('Ese cobro ya está imputado al conductor'); renderRendiciones(); return;
  }
  // Sin chofer no hay a quién descontarle: el envío se entregó igual y la
  // plata la cobró alguien, pero eso se resuelve averiguando quién fue.
  const cond = String(r.conductor || '').trim();
  if (!cond || cond === 'SIN ASIGNAR') {
    alert('Este cobro no tiene conductor asignado, así que no hay a quién descontárselo.' +
      String.fromCharCode(10,10) +
      'Primero hay que saber quién llevó el envío.'); return;
  }
  if (!enLaCalle(r)) {
    alert('Este cobro ya no lo debe el chofer: la plata entró a la empresa.' +
      String.fromCharCode(10,10) +
      'Si querés volver a reclamárselo, reabrilo primero con ↩.'); return;
  }
  const monto = _num(r.monto);
  if (!(monto > 0)) { alert('El cobro no tiene monto: no hay nada que descontar.'); return; }
  const pend = (typeof estadoNuevaOperacion === 'function') ? estadoNuevaOperacion() : 'autorizado';
  if (!confirm('¿Descontarle ' + fmtPeso(monto) + ' a ' + cond + ' por el cobro que no rindió?' +
    String.fromCharCode(10,10) +
    'Se le imputa con fecha de hoy, así cae en la semana que se está liquidando.' +
    String.fromCharCode(10) +
    (pend === 'pendiente'
      ? 'Queda pendiente hasta que un supervisor lo autorice.'
      : 'Queda imputado y se descuenta en su próxima liquidación.'))) return;

  const fila = {
    tipo: 'cobros', conductor: cond,
    fecha: isoToDMY(hoyISO()), fecha_date: hoyISO(),
    monto: monto,
    referencia: String(r.tracking || '').trim(),
    detalle: 'Cobro en destino no rendido' + (r.cliente ? ' · ' + r.cliente : '') +
      (r.fecha_entrega ? ' · entrega ' + r.fecha_entrega : ''),
    cuotas_total: 1, monto_cuota: 0, imputar: true,
    beneficiario_tipo: 'conductor', cliente_cod: '', acredita_cliente: false,
    estado: pend,
    origen_rendicion_id: id
  };
  try {
    const row = await DB.insertRow('descuentos_items', fila);
    AppData.descItems = AppData.descItems || [];
    AppData.descItems.push(Object.assign({ id: row && row.id }, fila));
    renderRendiciones();
    showToast((pend === 'pendiente' ? '⏳ ' : '✅ ') + fmtPeso(monto) + ' imputado' +
      (pend === 'pendiente' ? ' (falta autorizar)' : '') + ' a ' + cond);
  } catch (e) {
    console.warn('imputarCobroAlConductor', e);
    // Si la base todavía no tiene el tipo, el insert muere con un error de
    // Postgres que del otro lado de la pantalla no se entiende.
    const m = String((e && e.message) || e);
    alert(/check constraint|origen_rendicion_id|column/.test(m)
      ? 'La base todavía no tiene el concepto "Cobro no rendido".' + String.fromCharCode(10,10) +
        'Hay que correr una vez la migración supabase/migracion-2026-11-05-cobro-no-rendido.sql.'
      : 'No se pudo imputar: ' + m);
  }
}

async function quitarImputacionCobro(id) {
  const d = descuentoDeCobro(id);
  if (!d) { renderRendiciones(); return; }
  if (!confirm('¿Sacarle el descuento de ' + fmtPeso(_num(d.monto)) + ' a ' + d.conductor + '?' +
    String.fromCharCode(10,10) +
    'El cobro vuelve a quedar sin imputar y se le puede volver a imputar después.')) return;
  try {
    await DB.deleteWhere('descuentos_items', 'id', d.id);
    AppData.descItems = (AppData.descItems || []).filter(x => x.id !== d.id);
    renderRendiciones();
    showToast('Descuento quitado · el cobro queda sin imputar');
  } catch (e) {
    console.warn('quitarImputacionCobro', e);
    alert('No se pudo quitar: ' + ((e && e.message) || e));
  }
}

// DESCONTADO DE LIQUIDACIÓN: la otra forma de cerrar la segunda etapa. En vez
// de devolverle la plata al cliente, se le toma como parte de pago en su
// factura. El cobro queda CERRADO igual que una devolución, pero es otro
// hecho y se cuenta aparte, porque la plata no salió de la empresa.
//
// NO TOCA LA LIQUIDACIÓN DEL CLIENTE, a propósito: acá solo se registra cómo
// se saldó. Que el importe entre en la factura lo decide y lo carga quien la
// arma — si la app lo hiciera sola y además alguien lo cargara a mano, al
// cliente se le descontaría dos veces y eso no se ve en ningún total.
async function descontarDeLiquidacion(cliente) {
  const cli = String(cliente || '').trim();
  const items = (AppData.rendiciones || []).filter(r => enLaEmpresa(r) && String(r.cliente || '').trim() === cli);
  if (!items.length) { showToast('No hay cobros de ' + cli + ' en la empresa'); return; }
  const total = items.reduce((a, r) => a + _num(r.monto), 0);
  if (!confirm('¿Marcar ' + items.length + ' cobro(s) de ' + cli + ' por ' + fmtPeso(total) +
    ' como descontados de su liquidación?' + String.fromCharCode(10,10) +
    'Queda registrado que se saldaron así, en vez de devolverle la plata.' + String.fromCharCode(10) +
    'NO se toca su liquidación: el importe lo carga quien la arma.')) return;
  const campos = {
    estado: 'descontado',
    fecha_rendicion: isoToDMY(hoyISO()), fecha_rendicion_date: hoyISO(),
    medio: 'descuento_liquidacion',
    rendido_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || ''
  };
  let ok = 0;
  for (const r of items) {
    try { await DB.updateWhere('rendiciones', 'id', r.id, campos); Object.assign(r, campos); ok++; }
    catch (e) { console.warn('descontarDeLiquidacion', r.id, e); }
  }
  persistirRendicionesLocal();
  renderRendiciones();
  if (ok < items.length) alert('Se marcaron ' + ok + ' de ' + items.length + ' cobros. Reintentá los que faltan.');
  else showToast('✅ ' + fmtPeso(total) + ' de ' + cli + ' marcados como descontados de su liquidación');
}

// Vuelve UN paso atrás: lo devuelto vuelve a la empresa, lo recibido vuelve a
// la calle (a la deuda del chofer).
async function reabrirRendicion(id) {
  const r = AppData.rendiciones.find(x => x.id === id);
  if (!r) return;
  const est = estadoRendicion(r);
  // Un paso atrás, no al principio: lo devuelto vuelve a la empresa; lo que
  // estaba en la empresa vuelve a la deuda del chofer.
  const campos = (est === 'rendido' || est === 'descontado')
    ? { estado: 'recibido', fecha_rendicion: '', fecha_rendicion_date: null, medio: '', comprobante: '', rendido_por: '', lote_id: null }
    : { estado: 'pendiente', fecha_recibido: '', fecha_recibido_date: null, medio_recibido: '', recibido_por: '' };
  const aDonde = (est === 'rendido') ? 'a la empresa (sin devolver al cliente)' : 'a la deuda del chofer';
  if (!confirm('¿Volver el cobro de ' + r.conductor + ' (' + fmtPeso(_num(r.monto)) + ') ' + aDonde + '?')) return;
  try {
    await DB.updateWhere('rendiciones', 'id', id, campos);
    Object.assign(r, campos);
    persistirRendicionesLocal(); renderRendiciones();
    showToast('↺ Vuelto ' + aDonde);
  } catch (e) { console.warn('reabrirRendicion', e); showToast('⛔ No se pudo'); }
}
async function eliminarRendicion(id) {
  const r = AppData.rendiciones.find(x => x.id === id);
  if (!r) return;
  if (!confirm('¿Eliminar el registro de cobro de ' + r.conductor + ' por ' + fmtPeso(_num(r.monto)) + '?')) return;
  try {
    await DB.deleteWhere('rendiciones', 'id', id);
    AppData.rendiciones = AppData.rendiciones.filter(x => x.id !== id);
    persistirRendicionesLocal(); renderRendiciones();
    showToast('🗑 Registro eliminado');
  } catch (e) { console.warn('eliminarRendicion', e); showToast('⛔ No se pudo eliminar'); }
}

// ── Generar desde los envíos importados ──────────────────────────────────────
// Toma los envíos ENTREGADOS que traen cobro en destino ("Total a cobrar" > 0)
// y crea la rendición pendiente. No duplica los trackings ya registrados.
// ══════════════════════════════════════════════════════════════════════════
//  EL COBRO EN DESTINO SALE DEL LISTADO, NO DE UN BOTÓN
//
//  Este panel no funcionó NUNCA: la tabla `rendiciones` estuvo en cero desde
//  que se escribió, con $5.368.071 de cobros en los envíos. Tres causas, y
//  cada una alcanzaba sola.
//
//  1) LA COLUMNA DEJÓ DE LLEGAR Y NADIE SE ENTERÓ. `cobro_destino` se mapea
//     desde "Total a cobrar", `required: false` y `expectedCol: 'AI'` —la
//     única columna del listado más allá de la AD—. Si el automatch no la
//     encuentra, el `<select>` queda en "No incluido" y **todos los envíos se
//     guardan con 0, en silencio**. Medido: el último envío con cobro es del
//     **10/09/2026**. No fue el negocio: HUELLITAS PET SHOP hizo 3.425 envíos
//     después de esa fecha, AQUA LIVE 3.073 y TOP RACING 736, y ninguno trae
//     cobro. Seis clientes cortan el MISMO día. Eso es una columna, no una
//     decisión comercial. Por eso ahora el import **cuenta los cobros que
//     encontró y lo dice**, y avisa fuerte cuando la columna no quedó mapeada:
//     un campo de plata no puede fallar valiendo cero sin decir nada.
//
//  2) HABÍA QUE APRETAR UN BOTÓN, Y NADIE LO APRETÓ. "Traer de los envíos"
//     existía desde el principio y jamás se usó: dos meses de cobros quedaron
//     sin registrar. Un control que depende de que alguien se acuerde no es un
//     control. Ahora los pendientes se crean **en la importación de todos los
//     días**, que es la acción que ya se hace, y el botón queda de puesta al
//     día.
//
//  3) Y SI SE HUBIERA APRETADO, HABRÍA PERDIDO LA MITAD. Deduplicaba por
//     `tracking`, pero los envíos con cobro traen la referencia interna del
//     cliente: **17 envíos distintos comparten el tracking "1"**, con 13
//     montos y 13 fechas diferentes; otros 10 comparten el "2". De 92 envíos
//     entregados con cobro salían 62 trackings: se creaba UNA rendición por
//     tracking, con un monto que no era el de ninguno, y las otras 30 se
//     perdían sin aviso. La identidad de un envío es su **`clave`**, que es
//     justo lo que el resto de la app ya usa, y ahora es la columna
//     `rendiciones.envio_clave` con su índice único.
// ══════════════════════════════════════════════════════════════════════════

// ── EL PANEL ARRANCA EN UNA FECHA ────────────────────────────────────────
//  Los cobros de agosto, septiembre y octubre hasta el 18/10 son operaciones
//  CERRADAS: se rindieron por fuera del sistema mientras la columna no llegaba.
//  Traerlos ahora llenaría el panel de deuda que no existe y le reclamaría a
//  los choferes plata que ya trajeron — que es peor que no tener el panel,
//  porque un listado de deuda falsa se deja de mirar enseguida.
//  El corte vive en `config` (`rendicion_control_desde`) con el default en el
//  código: mismo criterio que `cliente_corte_iso` y que el control de "qué
//  falta facturar" —UNA fecha, no marcar miles de filas—, se explica solo, es
//  reversible y se corre sin desplegar nada.
//  Se mide por FECHA DE ENTREGA, que es cuando el conductor cobró.
const REND_CONTROL_DESDE = '2026-10-19';

function rendControlDesde() {
  const v = String((AppData.config && AppData.config.rendicion_control_desde) || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : REND_CONTROL_DESDE;
}

// Un envío entregado con cobro > 0, entregado desde el corte, es una rendición
// pendiente. Nada más.
function esCobroEnDestino(r) {
  if (!r || !(_num(r.cobro_destino) > 0) || !contabilizaRegistro(r)) return false;
  const iso = fechaISOde(r.fecha);
  return !!iso && iso >= rendControlDesde();
}

function rendicionDeEnvio(r) {
  const fechaDMY = r.fecha || '';
  const lim = limiteRendicion(fechaDMY);
  const cod = (typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '';
  return {
    envio_clave: r.clave || null,
    tracking: String(r.tracking || '').trim().toUpperCase(),
    // `conductor` es NOT NULL y un envío puede venir sin chofer: la plata la
    // cobró alguien igual, así que se registra marcado en vez de descartarse —
    // un cobro que no entra es plata que no se reclama. Aparece en "le debe el
    // chofer" como SIN ASIGNAR, que es exactamente el dato que hay que ver.
    conductor: (conductorCanonico(r.cadete) || r.cadete || '').toUpperCase() || 'SIN ASIGNAR',
    cliente: String((cod && typeof clienteNombreDe === 'function' ? clienteNombreDe(cod) : '') || r.cliente || '').toUpperCase(),
    monto: _num(r.cobro_destino),
    fecha_entrega: fechaDMY, fecha_entrega_date: fechaISOde(fechaDMY) || null,
    fecha_limite: lim ? isoLocal(lim) : null,
    estado: 'pendiente', origen: 'envios',
    registrado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || ''
  };
}

// Los envíos con cobro que todavía no tienen su rendición.
// El respaldo por tracking + fecha es para las cargadas A MANO, que no tienen
// `envio_clave`: sin él, un cobro que el operador registró porque el cliente
// avisó por otro medio volvería a entrar como nuevo cuando el listado por fin
// traiga la columna — y se le reclamaría dos veces al chofer.
function cobrosSinRendir(records) {
  const porClave = new Set();
  const porTrkFecha = new Set();
  (AppData.rendiciones || []).forEach(r => {
    if (r.envio_clave) porClave.add(r.envio_clave);
    const t = String(r.tracking || '').trim().toUpperCase();
    if (t) porTrkFecha.add(t + '|' + (r.fecha_entrega || ''));
  });
  return (records || []).filter(r => {
    if (!esCobroEnDestino(r) || !r.clave) return false;
    if (porClave.has(r.clave)) return false;
    const t = String(r.tracking || '').trim().toUpperCase();
    return !(t && porTrkFecha.has(t + '|' + (r.fecha || '')));
  });
}

// UNA sola escritura, y repetirla es inofensivo. La versión vieja insertaba de
// a una fila dentro de un `for await` tragándose los errores con `console.warn`:
// con 92 cobros eran 92 idas a la nube y una caída a mitad de camino dejaba la
// lista a medio escribir informando éxito. El índice único de `envio_clave` es
// el guardarraíl para las dos sesiones que generen a la vez.
async function sincronizarCobros(records) {
  const nuevos = cobrosSinRendir(records);
  if (!nuevos.length) return { creados: 0, total: 0 };
  const filas = nuevos.map(rendicionDeEnvio);
  const ids = await DB.insertRows('rendiciones', filas);
  filas.forEach((f, i) => AppData.rendiciones.push(Object.assign({ id: ids[i] }, f)));
  persistirRendicionesLocal();
  return { creados: filas.length, total: filas.reduce((s, f) => s + f.monto, 0) };
}

// El botón, que ahora es solo la PUESTA AL DÍA. Dice qué ventana está mirando:
// la app arranca con los últimos días y los cobros de agosto y septiembre no
// están en memoria — un "no hay cobros nuevos" sobre una ventana de 14 días se
// lee como que no quedó nada pendiente, y es lo contrario.
async function generarRendicionesDesdeEnvios() {
  const pend = cobrosSinRendir(AppData.records);
  const ventana = (typeof textoVentanaCargada === 'function') ? textoVentanaCargada() : '';
  if (!pend.length) {
    alert('No hay cobros nuevos para registrar.' +
      '\n\nSe buscan envíos ENTREGADOS con "Total a cobrar" mayor a 0, entregados desde el ' +
      isoToDMY(rendControlDesde()) + ' (lo anterior son operaciones ya cerradas).' +
      (ventana ? '\nEnvíos cargados: ' + ventana + '.' : '') +
      '\n\nSi el listado no trae esa columna, mapeala al importar: el resumen de la carga dice ' +
      'cuántos cobros encontró.');
    return;
  }
  const total = pend.reduce((s, r) => s + _num(r.cobro_destino), 0);
  if (!confirm('Se encontraron ' + pend.length + ' cobro(s) en destino por ' + fmtPeso(total) + '.' +
    (ventana ? '\n(en los envíos cargados: ' + ventana + ')' : '') +
    '\n\n¿Registrarlos como pendientes de rendición?')) return;
  _btnGenerandoCobros(true);
  try {
    const res = await sincronizarCobros(AppData.records);
    renderRendiciones();
    showToast('✅ ' + res.creados + ' cobro(s) agregados a rendir · ' + fmtPeso(res.total));
  } catch (e) {
    console.warn('generarRendicionesDesdeEnvios', e);
    alert('No se pudieron registrar los cobros: ' + (e.message || e) + '\n\nNo se guardó ninguno. Probá de nuevo.');
  } finally { _btnGenerandoCobros(false); }
}

function _btnGenerandoCobros(on) {
  ['rend-btn-traer', 'rend-btn-traer-aviso'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.disabled = !!on; b.style.opacity = on ? '.6' : ''; }
  });
}

// El aviso que hace innecesario acordarse del botón: lo que el listado trajo y
// todavía no está registrado, con su plata y a la vista.
// **Dice las dos cosas**: cuando hay pendientes los pone arriba, y cuando no hay
// igual deja el renglón con la fecha de corte — un panel vacío sin explicación
// se lee como que el control se rompió, y acá además hay que poder entender por
// qué no figura nada de agosto ni de septiembre.
function _renderCobrosPendientes() {
  const box = document.getElementById('rend-aviso-envios');
  if (!box) return;
  const pend = cobrosSinRendir(AppData.records);
  const desdeTxt = isoToDMY(rendControlDesde());
  const ventana = (typeof textoVentanaCargada === 'function') ? textoVentanaCargada() : '';
  // Sin pendientes no se dice nada: el panel ya muestra lo que hay.
  if (!pend.length) { box.innerHTML = ''; return; }
  const total = pend.reduce((s, r) => s + _num(r.cobro_destino), 0);
  box.innerHTML =
    '<div class="alert" style="margin:0 0 14px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412">' +
      '<i class="ic ic-alert"></i><div style="font-size:13px">' +
        '<strong>' + pend.length + ' cobro(s) del listado sin registrar · ' + fmtPeso(total) + '.</strong> ' +
        'Son envíos entregados con "Total a cobrar" que todavía no están en esta lista. ' +
        '<button class="btn btn-sm" id="rend-btn-traer-aviso" style="margin-left:6px;padding:2px 10px;font-size:11px" ' +
          'onclick="generarRendicionesDesdeEnvios()">Registrarlos</button>' +
        '<div style="opacity:.8;margin-top:4px">Entregas desde el ' + desdeTxt +
          (ventana ? ' · envíos cargados: ' + ventana : '') + '.</div>' +
      '</div>' +
    '</div>';
}

// ── CARGAR UN COBRO QUE EL CLIENTE NO INFORMÓ ─────────────────────────────
//  El caso real: el cliente se olvida de cargar el "Total a cobrar" en su
//  sistema y avisa por otro medio (un mensaje, un llamado). El envío SÍ está en
//  el listado —se entregó— pero viene con cobro 0, así que no aparece en ningún
//  lado y el registro se pierde.
//  Por eso el cobro se le pone a UN ENVÍO EXISTENTE y no se tipea de cero: el
//  conductor, el cliente y la fecha salen del envío, que es de donde tienen que
//  salir. Tipeados a mano entran con otra grafía, no matchean al conductor y la
//  deuda queda colgada de alguien que no existe — es la misma razón por la que
//  el tracking de un extravío se ELIGE y no se escribe.
let _cobroEnvioElegido = null;

// El cliente sale del LISTADO —maestro más los que ya aparecen en los
// envíos—, igual que en el modal de extravíos. Escrito a mano no matchea
// ningún código y no se podría acotar la búsqueda a sus envíos, que es
// justamente para lo que sirve elegirlo primero.
function _poblarClientesCobro() {
  const sel = document.getElementById('mcob-cliente');
  if (!sel) return;
  const m = new Map();
  (AppData.clientes || []).forEach(c => {
    const k = (typeof clienteKey === 'function') ? clienteKey(c.codigo) : c.codigo;
    if (k && (typeof esClienteValido !== 'function' || esClienteValido(k))) m.set(k, c.nombre || k);
  });
  (AppData.records || []).forEach(r => {
    const k = (typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '';
    if (k && (typeof esClienteValido !== 'function' || esClienteValido(k)) && !m.has(k)) m.set(k, String(r.cliente || '').trim() || k);
  });
  const lista = Array.from(m.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  sel.innerHTML = '<option value="">— Elegí el cliente —</option>' +
    lista.map(([k, nom]) => '<option value="' + jsAttr(k) + '">' + jsAttr(nom) + '</option>').join('');
  sel.value = '';
}

function openCobroEnvioModal() {
  _cobroEnvioElegido = null;
  _poblarClientesCobro();
  ['mcob-buscar', 'mcob-monto', 'mcob-obs'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const el = document.getElementById('mcob-elegido'); if (el) el.innerHTML = '';
  buscarEnvioCobro();
  document.getElementById('modal-cobro-backdrop').style.display = 'flex';
}
function closeCobroEnvioModal(e) {
  if (!e || e.target.id === 'modal-cobro-backdrop') document.getElementById('modal-cobro-backdrop').style.display = 'none';
}

// Los envíos de ESE cliente que todavía no tengan rendición: ofrecer uno que
// ya está registrado invita a cobrarlo dos veces.
// Entran los ENTREGADOS y también los PENDIENTES: el cliente avisa del cobro
// cuando quiere, muchas veces antes de que el envío llegue, y negarle al
// operador registrarlo ahí haría que el dato se pierda. El estado se muestra
// en cada fila, y un envío sin entregar se registra sin fecha límite —el
// chofer todavía no cobró nada y no hay qué reclamarle.
function _candidatosCobro(q, cod) {
  const yaClave = new Set((AppData.rendiciones || []).map(r => r.envio_clave).filter(Boolean));
  const desde = rendControlDesde();
  const t = String(q || '').toLowerCase().trim();
  const cli = String(cod || '');
  const out = [];
  for (const r of (AppData.records || [])) {
    if (!r.clave || yaClave.has(r.clave)) continue;
    if (cli && ((typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '') !== cli) continue;
    // Mismo corte que el automático: un envío de una operación ya cerrada no se
    // ofrece, porque registrarlo inventaría una deuda que nadie tiene. Para ese
    // caso excepcional queda el alta libre ("+ Nuevo cobro"), que no cuelga de
    // ningún envío y por eso no se confunde con lo que trae el listado.
    const entregado = contabilizaRegistro(r);
    const iso = fechaISOde(r.fecha);
    // El corte mide operaciones CERRADAS, y eso es por fecha de entrega: un
    // envío todavía sin entregar no puede ser una de agosto.
    if (entregado && (!iso || iso < desde)) continue;
    if (t) {
      const hay = [r.tracking, r.destinatario, r.cliente, r.direccion, r.cadete]
        .map(v => String(v || '').toLowerCase()).join(' ');
      if (!hay.includes(t)) continue;
    }
    out.push(r);
    if (out.length >= 40) break;
  }
  return out;
}

function buscarEnvioCobro() {
  const q = (document.getElementById('mcob-buscar') || {}).value || '';
  const cod = (document.getElementById('mcob-cliente') || {}).value || '';
  const box = document.getElementById('mcob-resultados');
  if (!box) return;
  // El cliente va primero: sin él la lista son todos los envíos de todos, y
  // el cobro terminaría colgado del envío de otro.
  if (!cod) {
    box.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">' +
      'Elegí primero el cliente.</div>';
    return;
  }
  if (!q.trim()) {
    box.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">' +
      'Escribí el tracking, la dirección o el destinatario para ver sus envíos.</div>';
    return;
  }
  const lista = _candidatosCobro(q, cod);
  if (!lista.length) {
    box.innerHTML = '<div style="font-size:12px;color:#9a3412;padding:8px">' +
      'Ningún envío de ese cliente coincide. Puede estar <strong>fuera de los días cargados</strong>, ' +
      'ser <strong>anterior al ' + isoToDMY(rendControlDesde()) + '</strong> (operaciones ya cerradas), ' +
      'o ya tener su cobro registrado. ' +
      'Si el envío no está en el listado, usá <strong>“+ Nuevo cobro”</strong>.</div>';
    return;
  }
  box.innerHTML = '<div class="table-wrap" style="max-height:220px;overflow:auto"><table><tbody>' +
    lista.map(r =>
      '<tr style="cursor:pointer" onclick="elegirEnvioCobro(\'' + jsAttr(r.clave) + '\')">' +
        '<td style="font-size:12px"><strong>' + (r.tracking || '—') + '</strong><div style="color:var(--text-muted)">' +
          (r.destinatario || '') + '</div></td>' +
        '<td style="font-size:12px">' + (r.cliente || '—') + '<div style="color:var(--text-muted)">' + (r.zona || '') + '</div></td>' +
        '<td style="font-size:12px">' + (r.fecha || '') + '<div style="color:var(--text-muted)">' + (r.cadete || 'sin chofer') + '</div></td>' +
        '<td style="font-size:11px">' + (contabilizaRegistro(r)
          ? '<span style="color:#166534">entregado</span>'
          : '<span style="color:#9a3412">pendiente</span>') + '</td>' +
      '</tr>').join('') + '</tbody></table></div>' +
    (lista.length >= 40 ? '<div style="font-size:11px;color:var(--text-muted);padding:4px 8px">Se muestran los primeros 40 — afiná la búsqueda.</div>' : '');
}

function elegirEnvioCobro(clave) {
  const r = (AppData.records || []).find(x => x.clave === clave);
  if (!r) { showToast('Ese envío ya no está en la lista'); buscarEnvioCobro(); return; }
  _cobroEnvioElegido = clave;
  const el = document.getElementById('mcob-elegido');
  if (el) el.innerHTML =
    '<div class="alert" style="margin:0;background:var(--surface-1);border:1px solid var(--border);font-size:12px">' +
      '<i class="ic ic-check"></i><div><strong>' + (r.tracking || 'sin tracking') + '</strong> · ' +
      (r.destinatario || 's/d') + '<br>' +
      (r.cliente || 'sin cliente') + ' · ' +
      (contabilizaRegistro(r)
        ? 'entregado el ' + (r.fecha || 's/f')
        : '<span style="color:#9a3412">todavía NO entregado</span>') +
      ' por <strong>' + (r.cadete || 'SIN CHOFER') + '</strong>' +
      (contabilizaRegistro(r) ? '' :
        '<div style="margin-top:3px;color:var(--text-muted)">Se registra sin fecha límite: el chofer' +
        ' todavía no cobró nada, así que no hay qué reclamarle.</div>') +
      '</div></div>';
  const m = document.getElementById('mcob-monto'); if (m) m.focus();
}

async function guardarCobroEnvio() {
  if (!_cobroEnvioElegido) { alert('Elegí primero el envío al que corresponde el cobro.'); return; }
  const r = (AppData.records || []).find(x => x.clave === _cobroEnvioElegido);
  if (!r) { alert('Ese envío ya no está cargado. Volvé a buscarlo.'); return; }
  const monto = parseFloat((document.getElementById('mcob-monto') || {}).value) || 0;
  if (!(monto > 0)) { alert('El monto cobrado al destinatario tiene que ser mayor a 0.'); return; }
  if ((AppData.rendiciones || []).some(x => x.envio_clave === r.clave)) {
    alert('Ese envío ya tiene su cobro registrado.'); return;
  }
  const entregado = contabilizaRegistro(r);
  const fila = rendicionDeEnvio(Object.assign({}, r, { cobro_destino: monto }));
  fila.origen = 'manual';
  // El estado se calcula desde `fecha_entrega`: dejarle la del último
  // movimiento a un envío que no se entregó lo mostraría ATRASADO al día
  // siguiente, reclamándole al chofer una plata que todavía no cobró.
  if (!entregado) {
    fila.fecha_entrega = ''; fila.fecha_entrega_date = null; fila.fecha_limite = null;
  }
  const obsTxt = (document.getElementById('mcob-obs') || {}).value.trim();
  fila.obs = (obsTxt || 'Cobro informado por el cliente fuera del listado') +
    (entregado ? '' : ' · el envío todavía no estaba entregado');
  _btnGuardando('mcob-guardar', true);
  try {
    const ids = await DB.insertRows('rendiciones', [fila]);
    AppData.rendiciones.push(Object.assign({ id: ids[0] }, fila));
    persistirRendicionesLocal();
    document.getElementById('modal-cobro-backdrop').style.display = 'none';
    renderRendiciones();
    showToast('✅ Cobro de ' + fmtPeso(monto) + ' registrado a ' + fila.conductor);
  } catch (e) {
    console.warn('guardarCobroEnvio', e);
    alert('No se pudo registrar el cobro: ' + (e.message || e));
  } finally { _btnGuardando('mcob-guardar', false); }
}
