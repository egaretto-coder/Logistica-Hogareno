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
  (AppData.rendiciones || []).forEach(r => {
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
  (AppData.rendiciones || []).forEach(r => {
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
let rendFiltroEstado = 'abiertas';   // abiertas | vencido | pendiente | rendido | todas

function renderRendiciones() {
  const cont = document.getElementById('rend-rows');
  if (!cont) return;
  const lista = (AppData.rendiciones || []);

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
            '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="recibirDeChofer(\'' + String(d.conductor).replace(/'/g, "\\'") + '\')" title="Registrar que trajo la plata">Recibí todo</button>' +
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
            '<button class="btn btn-sm btn-primary" style="padding:3px 7px;font-size:10px" onclick="abrirDevolucionCliente(\'' + String(c.cliente).replace(/'/g, "\\'") + '\')">Devolver</button>' +
          '</div>').join('')
      : '<div class="muted" style="padding:14px;text-align:center;font-size:12px">No hay plata en la empresa esperando devolución</div>';
  }

  // ── Tabla de detalle ──
  const q = (document.getElementById('rend-search')?.value || '').toLowerCase().trim();
  const filtradas = lista.filter(r => {
    const e = estadoRendicion(r);
    if (rendFiltroEstado === 'abiertas') return e === 'pendiente' || e === 'vencido' || e === 'recibido';
    if (rendFiltroEstado === 'calle') return e === 'pendiente' || e === 'vencido';
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
  if (info) info.textContent = filtradas.length + ' de ' + lista.length + ' cobro(s)';

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
        (!r.fecha_recibido && !r.fecha_rendicion ? '—' : '') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        (enLaCalle(r)
          ? '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="openRendirModal(' + r.id + ')" title="El chofer trajo la plata"><i class="ic ic-check"></i> Recibir</button>'
          : '') +
        (enLaEmpresa(r)
          ? '<button class="btn btn-sm btn-primary" style="padding:3px 7px;font-size:10px" onclick="abrirDevolucionCliente(\'' + String(r.cliente || '').replace(/'/g, "\\'") + '\')" title="Devolverle la plata al cliente">Devolver</button>'
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
  document.getElementById('mrend-fecha').value = f ? f.toISOString().slice(0, 10) : hoyISO();
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
    fecha_limite: lim ? lim.toISOString().slice(0, 10) : null,
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
// Vuelve UN paso atrás: lo devuelto vuelve a la empresa, lo recibido vuelve a
// la calle (a la deuda del chofer).
async function reabrirRendicion(id) {
  const r = AppData.rendiciones.find(x => x.id === id);
  if (!r) return;
  const est = estadoRendicion(r);
  // Un paso atrás, no al principio: lo devuelto vuelve a la empresa; lo que
  // estaba en la empresa vuelve a la deuda del chofer.
  const campos = (est === 'rendido')
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
async function generarRendicionesDesdeEnvios() {
  const yaTrk = new Set((AppData.rendiciones || []).map(r => String(r.tracking || '').trim().toUpperCase()).filter(Boolean));
  const candidatos = (AppData.records || []).filter(r => {
    if (!(_num(r.cobro_destino) > 0)) return false;
    const est = (r.estado || '').toUpperCase().trim();
    if (!(est === ESTADO_CONTABILIZA || ESTADOS_CONTABILIZAN.has(est))) return false;   // solo entregados
    const trk = String(r.tracking || '').trim().toUpperCase();
    return trk && !yaTrk.has(trk);
  });
  if (!candidatos.length) {
    alert('No hay cobros nuevos para registrar.\n\nSe buscan envíos ENTREGADOS con "Total a cobrar" mayor a 0 que todavía no estén en la lista. Si el listado que importaste no traía esa columna, mapeala al importar.');
    return;
  }
  const total = candidatos.reduce((s, r) => s + _num(r.cobro_destino), 0);
  if (!confirm('Se encontraron ' + candidatos.length + ' cobro(s) en destino por ' + fmtPeso(total) + '.\n\n¿Registrarlos como pendientes de rendición?')) return;

  let ok = 0;
  for (const r of candidatos) {
    const fechaDMY = r.fecha || '';
    const lim = limiteRendicion(fechaDMY);
    const rec = {
      tracking: String(r.tracking || '').trim().toUpperCase(),
      conductor: (conductorCanonico(r.cadete) || r.cadete || '').toUpperCase(),
      cliente: (r.cliente || '').toUpperCase(),
      monto: _num(r.cobro_destino),
      fecha_entrega: fechaDMY, fecha_entrega_date: fechaISOde(fechaDMY),
      fecha_limite: lim ? lim.toISOString().slice(0, 10) : null,
      estado: 'pendiente', origen: 'envios',
      registrado_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || ''
    };
    try {
      const row = await DB.insertRow('rendiciones', rec);
      AppData.rendiciones.push(Object.assign({ id: row && row.id }, rec));
      ok++;
    } catch (e) { console.warn('generar rendición ' + rec.tracking, e); }
  }
  persistirRendicionesLocal();
  renderRendiciones();
  showToast('✅ ' + ok + ' cobro(s) agregados a rendir');
}

// ── PDF / export ─────────────────────────────────────────────────────────────
function exportRendicionesPDF() {
  const lista = (AppData.rendiciones || []).filter(r => {
    const e = estadoRendicion(r);
    return e === 'pendiente' || e === 'vencido';
  });
  if (!lista.length) { alert('No hay cobros pendientes de rendir.'); return; }
  lista.sort((a, b) => String(a.conductor).localeCompare(String(b.conductor)));
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Rendiciones pendientes', 14, 18);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  doc.text('Cobros en destino a rendir · generado ' + new Date().toLocaleString('es-AR'), 14, 25);

  const total = lista.reduce((s, r) => s + _num(r.monto), 0);
  const body = lista.map(r => [r.conductor, r.cliente || '—', r.tracking || '—',
    r.fecha_entrega || '—', estadoRendicion(r) === 'vencido' ? 'Vencido ' + diasAtraso(r) + ' d' : 'Pendiente',
    fmtPeso(_num(r.monto))]);
  doc.autoTable({
    startY: 31,
    head: [['Conductor', 'Cliente', 'Tracking', 'Entrega', 'Estado', 'Monto']],
    body,
    foot: [[{ content: 'TOTAL A RENDIR (' + lista.length + ')', colSpan: 5, styles: { halign: 'right' } }, fmtPeso(total)]],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 5: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });
  doc.save('Rendiciones_pendientes.pdf');
  showToast('📥 Listado de rendiciones descargado');
}
