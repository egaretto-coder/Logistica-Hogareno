// ════════════════════════════════════════════════════════════════════════
//  RENDICIÓN DE ENVÍOS (cobros en destino)
//  Hay envíos que se cobran al destinatario. El conductor cobra esa plata y
//  debe RENDIRLA al día siguiente de la entrega; administración reclama lo que
//  no se rindió. Reemplaza la planilla de Excel.
//
//  Los pendientes se pueden cargar a mano o generarse solos desde los envíos
//  importados que traen "Total a cobrar" (columna cobro_destino del listado).
// ════════════════════════════════════════════════════════════════════════

// ── Helpers ─────────────────────────────────────────────────────────────────
function _rendHoy() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function _rendDMY(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
// Vence al día siguiente de la entrega.
function limiteRendicion(fechaEntregaDMY) {
  const f = parseFechaReg(fechaEntregaDMY);
  if (!f) return null;
  const l = new Date(f); l.setDate(l.getDate() + 1); l.setHours(23, 59, 59, 999);
  return l;
}
// pendiente al día | vencida | rendida | anulada
function estadoRendicion(r) {
  if (r.estado === 'rendido') return 'rendido';
  if (r.estado === 'anulado') return 'anulado';
  const lim = limiteRendicion(r.fecha_entrega);
  if (lim && new Date() > lim) return 'vencido';
  return 'pendiente';
}
function diasAtraso(r) {
  const lim = limiteRendicion(r.fecha_entrega);
  if (!lim) return 0;
  const d = Math.floor((new Date() - lim) / 86400000);
  return d > 0 ? d : 0;
}
function persistirRendicionesLocal() {
  try { localStorage.setItem('liq_rendiciones', JSON.stringify(AppData.rendiciones)); } catch (e) {}
}

// ════════════════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════════════════
let rendFiltroEstado = 'abiertas';   // abiertas | vencido | pendiente | rendido | todas

function renderRendiciones() {
  const cont = document.getElementById('rend-rows');
  if (!cont) return;
  const lista = AppData.rendiciones || [];
  const q = (document.getElementById('rend-search')?.value || '').toLowerCase().trim();

  // Resumen (sobre TODO, no sobre el filtro)
  const abiertas = lista.filter(r => r.estado === 'pendiente');
  const vencidas = abiertas.filter(r => estadoRendicion(r) === 'vencido');
  const alDia = abiertas.filter(r => estadoRendicion(r) === 'pendiente');
  const totalAbierto = abiertas.reduce((s, r) => s + _num(r.monto), 0);
  const totalVencido = vencidas.reduce((s, r) => s + _num(r.monto), 0);
  const hoyDMY = _rendDMY(_rendHoy());
  const rendidoHoy = lista.filter(r => r.estado === 'rendido' && r.fecha_rendicion === hoyDMY)
    .reduce((s, r) => s + _num(r.monto), 0);

  const res = document.getElementById('rend-resumen');
  if (res) res.innerHTML =
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Pendiente de rendir</div><div class="metric-value">' + fmtPeso(totalAbierto) + '</div><div class="metric-sub">' + abiertas.length + ' cobro(s)</div></div>' +
    '<div class="metric-card"' + (totalVencido ? ' style="border-color:#fca5a5"' : '') + '><div class="metric-ic"><i class="ic ic-alert"></i></div><div class="metric-label">Vencido (a reclamar)</div><div class="metric-value"' + (totalVencido ? ' style="color:#b91c1c"' : '') + '>' + fmtPeso(totalVencido) + '</div><div class="metric-sub">' + vencidas.length + ' cobro(s) fuera de término</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-check"></i></div><div class="metric-label">Rendido hoy</div><div class="metric-value">' + fmtPeso(rendidoHoy) + '</div><div class="metric-sub">al día: ' + alDia.length + ' cobro(s)</div></div>';

  // Deuda por conductor (lo que administración reclama)
  const porCond = {};
  abiertas.forEach(r => {
    const k = conductorCanonico(r.conductor) || r.conductor;
    if (!porCond[k]) porCond[k] = { conductor: k, monto: 0, cant: 0, vencido: 0 };
    porCond[k].monto += _num(r.monto); porCond[k].cant++;
    if (estadoRendicion(r) === 'vencido') porCond[k].vencido += _num(r.monto);
  });
  const deuda = Object.values(porCond).sort((a, b) => b.monto - a.monto);
  const deudaEl = document.getElementById('rend-por-conductor');
  if (deudaEl) {
    deudaEl.innerHTML = deuda.length
      ? deuda.map(d => '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">' +
          '<div class="conductor-avatar" style="background:' + avatarColor(d.conductor) + ';width:24px;height:24px;font-size:9px">' + initials(d.conductor) + '</div>' +
          '<span style="flex:1"><strong>' + d.conductor + '</strong> <span class="muted">· ' + d.cant + ' cobro(s)</span></span>' +
          (d.vencido ? '<span style="color:#b91c1c;font-size:11px">' + fmtPeso(d.vencido) + ' vencido</span>' : '') +
          '<strong style="min-width:90px;text-align:right">' + fmtPeso(d.monto) + '</strong></div>').join('')
      : '<div class="muted" style="padding:8px">Nadie debe rendir dinero.</div>';
  }

  // Filtro
  let filtradas = lista.filter(r => {
    const e = estadoRendicion(r);
    if (rendFiltroEstado === 'abiertas') return e === 'pendiente' || e === 'vencido';
    if (rendFiltroEstado === 'todas') return true;
    return e === rendFiltroEstado;
  });
  if (q) filtradas = filtradas.filter(r =>
    String(r.conductor).toLowerCase().includes(q) || String(r.cliente).toLowerCase().includes(q) || String(r.tracking).toLowerCase().includes(q));

  // Vencidos primero, después por fecha
  filtradas.sort((a, b) => {
    const ea = estadoRendicion(a), eb = estadoRendicion(b);
    if (ea !== eb) { if (ea === 'vencido') return -1; if (eb === 'vencido') return 1; }
    const fa = parseFechaReg(a.fecha_entrega), fb = parseFechaReg(b.fecha_entrega);
    return (fa ? fa.getTime() : 0) - (fb ? fb.getTime() : 0);
  });

  const cEl = document.getElementById('rend-count');
  if (cEl) cEl.textContent = filtradas.length + ' de ' + lista.length + ' registros';

  if (!filtradas.length) {
    cont.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon"><i class="ic ic-dollar"></i></div><div class="empty-title">Sin cobros para mostrar</div><div class="empty-sub">Cargá uno con "+ Nuevo cobro" o generalos desde los envíos importados</div></div></td></tr>';
    return;
  }

  cont.innerHTML = filtradas.map(r => {
    const est = estadoRendicion(r);
    const lim = limiteRendicion(r.fecha_entrega);
    const badge = est === 'vencido'
      ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5"><i class="ic ic-alert"></i> Vencido ' + diasAtraso(r) + ' d</span>'
      : est === 'pendiente' ? '<span class="badge" style="background:#fef9c3;color:#854d0e">Pendiente</span>'
      : est === 'rendido' ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ Rendido</span>'
      : '<span class="badge badge-gray">Anulado</span>';
    const acciones = (est === 'pendiente' || est === 'vencido')
      ? '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="openRendirModal(' + r.id + ')"><i class="ic ic-check"></i> Rendir</button>' +
        '<button class="btn btn-sm" style="padding:4px 6px;font-size:11px" onclick="editRendicion(' + r.id + ')"><i class="ic ic-edit"></i></button>'
      : '<button class="btn btn-sm" style="padding:4px 6px;font-size:11px" onclick="reabrirRendicion(' + r.id + ')" title="Volver a pendiente">↺</button>';
    return '<tr' + (est === 'vencido' ? ' style="background:#fff5f5"' : '') + '>' +
      '<td class="mono" style="font-size:11px">' + (r.tracking || '—') + '</td>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(r.conductor) + ';width:24px;height:24px;font-size:9px">' + initials(r.conductor) + '</div><strong style="font-size:12px">' + r.conductor + '</strong></div></td>' +
      '<td style="font-size:12px">' + (r.cliente || '—') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(_num(r.monto)) + '</td>' +
      '<td style="font-size:11px">' + (r.fecha_entrega || '—') + '<div class="muted" style="font-size:10px">vence ' + (lim ? _rendDMY(lim) : '—') + '</div></td>' +
      '<td style="text-align:center">' + badge + '</td>' +
      '<td style="font-size:11px">' + (r.estado === 'rendido' ? (r.fecha_rendicion || '—') + (r.medio ? '<div class="muted" style="font-size:10px">' + r.medio + '</div>' : '') : '—') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' + acciones +
        '<button class="btn btn-sm" style="padding:4px 6px;font-size:11px;border-color:#fca5a5;color:#b91c1c" onclick="eliminarRendicion(' + r.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function setFiltroRendicion(f) { rendFiltroEstado = f;
  ['abiertas','vencido','pendiente','rendido','todas'].forEach(x => {
    const b = document.getElementById('rend-f-' + x);
    if (b) b.classList.toggle('active', x === f);
  });
  renderRendiciones();
}

// ── Alta / edición manual ────────────────────────────────────────────────────
let rendEditId = null;
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
async function confirmarRendicion() {
  if (rendirId == null) return;
  const r = AppData.rendiciones.find(x => x.id === rendirId);
  if (!r) return;
  const fechaISO = document.getElementById('mrendir-fecha').value || hoyISO();
  const campos = {
    estado: 'rendido',
    fecha_rendicion: isoToDMY(fechaISO), fecha_rendicion_date: fechaISO,
    medio: document.getElementById('mrendir-medio').value || '',
    recibido_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
    obs: (document.getElementById('mrendir-obs').value || '').trim() || r.obs || ''
  };
  try {
    await DB.updateWhere('rendiciones', 'id', rendirId, campos);
    Object.assign(r, campos);
    persistirRendicionesLocal();
    document.getElementById('modal-rendir-backdrop').style.display = 'none';
    renderRendiciones();
    showToast('✅ Rendición registrada: ' + fmtPeso(_num(r.monto)));
  } catch (e) { console.warn('confirmarRendicion', e); alert('No se pudo registrar: ' + (e.message || e)); }
}
async function reabrirRendicion(id) {
  const r = AppData.rendiciones.find(x => x.id === id);
  if (!r) return;
  if (!confirm('¿Volver a marcar como PENDIENTE el cobro de ' + r.conductor + ' (' + fmtPeso(_num(r.monto)) + ')?')) return;
  const campos = { estado: 'pendiente', fecha_rendicion: '', fecha_rendicion_date: null, medio: '' };
  try {
    await DB.updateWhere('rendiciones', 'id', id, campos);
    Object.assign(r, campos);
    persistirRendicionesLocal(); renderRendiciones();
    showToast('↺ Vuelto a pendiente');
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
