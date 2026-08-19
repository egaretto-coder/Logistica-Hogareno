// ════════════════════════════════════════════════════════════════════════
//  EMPLEADOS (Recursos Humanos)
//  Control de sueldos del personal de la empresa (distinto de los cadetes).
//
//  Regla de ajuste: el sueldo se revisa CADA 3 MESES contados desde la FECHA DE
//  INGRESO de cada empleado, así que a cada uno le toca en un mes distinto.
//  Ej.: ingresó el 10/02 → le toca 10/05, 10/08, 10/11, 10/02…
//  El panel marca a quién le toca (o está vencido) y permite aplicar el ajuste
//  del mes solo a los empleados designados, dejando historial.
//
//  Liquidación mensual: sueldo + horas extras + bono de eficiencia − adelanto
//  (si corresponde), repartido entre transferencia y efectivo.
// ════════════════════════════════════════════════════════════════════════

const RRHH_MESES_AJUSTE = 3;

// Áreas de la empresa. La columna empleados.area es texto libre a propósito:
// sumar un área acá no necesita tocar la base.
const RRHH_AREAS = ['Gerencia', 'Administracion', 'Coordinacion', 'Logistica', 'Asesoria Comercial', 'Ventas'];

// ── Helpers de fecha ────────────────────────────────────────────────────────
function _empFecha(iso) { return iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00') : null; }
function _empFmt(iso) {
  const d = _empFecha(iso); if (!d || isNaN(d)) return '—';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
// Meses completos entre dos fechas (para la antigüedad).
function _mesesEntre(desde, hasta) {
  if (!desde || !hasta) return 0;
  let m = (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
  if (hasta.getDate() < desde.getDate()) m--;
  return Math.max(0, m);
}
function antiguedadTexto(emp) {
  const ing = _empFecha(emp.fecha_ingreso); if (!ing) return '—';
  const m = _mesesEntre(ing, new Date());
  const a = Math.floor(m / 12), r = m % 12;
  if (a && r) return a + (a === 1 ? ' año ' : ' años ') + r + (r === 1 ? ' mes' : ' meses');
  if (a) return a + (a === 1 ? ' año' : ' años');
  return m + (m === 1 ? ' mes' : ' meses');
}

// ── Estado de ajuste ────────────────────────────────────────────────────────
// Próxima fecha de ajuste = ingreso + N×3 meses, posterior al ÚLTIMO ajuste
// aplicado (o al ingreso si nunca se ajustó).
function ultimoAjusteDe(empId) {
  const lista = (AppData.empleadoAjustes || []).filter(a => a.empleado_id === empId);
  if (!lista.length) return null;
  return lista.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
}

function proximoAjuste(emp) {
  // Se ajusta 3 meses DESPUÉS del último aumento; si nunca tuvo uno, desde el
  // ingreso. El ciclo se cuenta POR MES: el día no importa, así que siempre
  // cae el 1º del mes que corresponde y dos personas del mismo mes ajustan
  // juntas (antes, quien entró un día 18 arrastraba ese día para siempre).
  const ult = ultimoAjusteDe(emp.id);
  const base = ult ? _empFecha(ult.fecha) : _empFecha(emp.fecha_ingreso);
  if (!base) return null;
  return new Date(base.getFullYear(), base.getMonth() + RRHH_MESES_AJUSTE, 1);
}

// { estado: 'vencido' | 'toca' | 'al_dia', dias, fecha }
// { estado, meses, fecha } — meses < 0 vencido, 0 le toca este mes, > 0 futuro.
function estadoAjuste(emp) {
  const prox = proximoAjuste(emp);
  if (!prox) return { estado: 'sin_fecha', meses: 0, fecha: null };
  const hoy = new Date();
  // La comparación es de MES a MES: dentro del mes que le toca, le toca.
  const meses = (prox.getFullYear() * 12 + prox.getMonth()) - (hoy.getFullYear() * 12 + hoy.getMonth());
  if (meses < 0) return { estado: 'vencido', meses, fecha: prox };
  if (meses === 0) return { estado: 'toca', meses, fecha: prox };
  return { estado: 'al_dia', meses, fecha: prox };
}

// "1 mes" / "3 meses"
function _mesesTexto(n) { const a = Math.abs(n); return a + (a === 1 ? ' mes' : ' meses'); }
function leTocaAjuste(emp) { const e = estadoAjuste(emp).estado; return e === 'vencido' || e === 'toca'; }

// ── Persistencia local ──────────────────────────────────────────────────────
function persistirEmpleadosLocal() {
  try {
    localStorage.setItem('liq_empleados', JSON.stringify(AppData.empleados));
    localStorage.setItem('liq_empleado_ajustes', JSON.stringify(AppData.empleadoAjustes));
    localStorage.setItem('liq_empleado_sueldos', JSON.stringify(AppData.empleadoSueldos));
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════════════════
//  SOLAPAS
// ════════════════════════════════════════════════════════════════════════
function switchEmpleadosTab(tab) {
  ['plantel', 'ajustes', 'sueldos', 'bajas'].forEach(t => {
    const panel = document.getElementById('emp-tab-' + t);
    const btn = document.getElementById('emp-btn-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'plantel') renderEmpleados();
  else if (tab === 'ajustes') renderAjustesPanel();
  else if (tab === 'bajas') renderBajas();
  else renderSueldosPanel();
}
function renderEmpleadosPagina() { switchEmpleadosTab('plantel'); }

// ════════════════════════════════════════════════════════════════════════
//  TAB 1 — PLANTEL (cards)
// ════════════════════════════════════════════════════════════════════════
let empSoloAjuste = false;
function toggleFiltroAjuste() { empSoloAjuste = !empSoloAjuste; renderEmpleados(); }

function renderEmpleados() {
  const cont = document.getElementById('emp-cards');
  if (!cont) return;
  const q = (document.getElementById('emp-search')?.value || '').toLowerCase().trim();
  const todos = (AppData.empleados || []).filter(e => e.activo !== false);
  const lista = todos
    .filter(e => !q || String(e.nombre).toLowerCase().includes(q) || String(e.puesto || '').toLowerCase().includes(q) || String(e.area || '').toLowerCase().includes(q) || String(e.dni || '').includes(q))
    .filter(e => !empSoloAjuste || leTocaAjuste(e))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  // Resumen
  const nTocan = todos.filter(leTocaAjuste).length;
  const masaSalarial = todos.reduce((s, e) => s + _num(e.sueldo), 0);
  const noRegistrados = todos.filter(e => e.registrado === false).length;
  const res = document.getElementById('emp-resumen');
  if (res) res.innerHTML =
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-user"></i></div><div class="metric-label">Empleados activos</div><div class="metric-value">' + todos.length + '</div><div class="metric-sub">' + noRegistrados + ' sin registrar</div></div>' +
    '<div class="metric-card"' + (nTocan ? ' style="border-color:#f5d97a"' : '') + '><div class="metric-ic"><i class="ic ic-alert"></i></div><div class="metric-label">Les toca ajuste</div><div class="metric-value"' + (nTocan ? ' style="color:#b45309"' : '') + '>' + nTocan + '</div><div class="metric-sub">cada ' + RRHH_MESES_AJUSTE + ' meses desde su ingreso</div></div>' +
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Masa salarial</div><div class="metric-value">' + fmtPeso(masaSalarial) + '</div><div class="metric-sub">suma de sueldos vigentes</div></div>';

  const cEl = document.getElementById('emp-count');
  if (cEl) cEl.textContent = lista.length + ' de ' + todos.length + ' empleados';

  const btnF = document.getElementById('emp-filtro-ajuste');
  if (btnF) {
    btnF.style.background = empSoloAjuste ? '#fffbeb' : '';
    btnF.style.borderColor = empSoloAjuste ? '#f59e0b' : '';
    btnF.style.fontWeight = empSoloAjuste ? '700' : '';
  }

  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:40px"><div class="empty-icon"><i class="ic ic-user"></i></div><div class="empty-title">' +
      (todos.length ? 'Sin resultados' : 'Sin empleados cargados') + '</div><div class="empty-sub">' +
      (todos.length ? 'Ajustá el buscador o el filtro' : 'Agregá el primero con "+ Nuevo empleado"') + '</div></div>';
    return;
  }

  cont.innerHTML = lista.map(e => {
    const est = estadoAjuste(e);
    const badgeAjuste = est.estado === 'vencido'
      ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5"><i class="ic ic-alert"></i> Ajuste vencido — ' + _mesTexto(_yyyymm(est.fecha)) + '</span>'
      : est.estado === 'toca'
        ? '<span class="badge" style="background:#fef9c3;color:#854d0e;border:1px solid #fde68a"><i class="ic ic-alert"></i> Le toca este mes</span>'
        : est.estado === 'al_dia'
          ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ Al día · próx. ' + _mesTexto(_yyyymm(est.fecha)) + '</span>'
          : '<span class="badge badge-gray">Sin fecha de ingreso</span>';
    const badgeReg = e.registrado === false
      ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74">No registrado</span>'
      : '<span class="badge" style="background:#eef2ff;color:#3730a3">Registrado</span>';
    const ult = ultimoAjusteDe(e.id);
    const pctT = _num(e.pct_transferencia);
    return '<div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div class="conductor-avatar" style="background:' + avatarColor(e.nombre) + ';width:40px;height:40px;font-size:13px">' + initials(e.nombre) + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:700">' + e.nombre + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted)">' + (e.puesto || 'Sin puesto') + (e.dni ? ' · DNI ' + e.dni : '') + '</div>' +
          (e.area ? '<span class="tag" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:9.5px;margin-top:3px;display:inline-block">' + e.area + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editEmpleado(' + e.id + ')" title="Editar datos"><i class="ic ic-edit"></i></button>' +
          '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarEmpleado(' + e.id + ')" title="Dar de baja"><i class="ic ic-trash"></i></button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + badgeReg + badgeAjuste + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">' +
        '<div><div style="font-size:10px;color:var(--text-muted)">Ingreso</div><strong>' + _empFmt(e.fecha_ingreso) + '</strong><div style="font-size:10px;color:var(--text-muted)">' + antiguedadTexto(e) + '</div></div>' +
        '<div><div style="font-size:10px;color:var(--text-muted)">Sueldo</div><strong style="font-size:15px">' + fmtPeso(_num(e.sueldo)) + '</strong>' +
          (ult ? '<div style="font-size:10px;color:var(--text-muted)">últ. ajuste ' + _empFmt(ult.fecha) + (ult.pct ? ' (+' + ult.pct + '%)' : '') + '</div>' : '<div style="font-size:10px;color:var(--text-muted)">sin ajustes</div>') +
        '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-secondary);border-top:1px solid var(--border);padding-top:8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">' +
        '<span><i class="ic ic-card"></i> Transferencia ' + pctT + '% · Efectivo ' + (100 - pctT) + '%</span>' +
        (e.telefono ? '<span>' + e.telefono + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// ── ABM empleado ─────────────────────────────────────────────────────────────
let empleadoEditId = null;
// Carga las opciones del selector de área (vacío = sin asignar).
function poblarAreasEmpleado(sel) {
  const el = document.getElementById('memp-area');
  if (!el) return;
  el.innerHTML = '<option value="">— Sin asignar —</option>' +
    RRHH_AREAS.map(a => '<option value="' + a + '">' + a + '</option>').join('');
  el.value = sel || '';
}

function openAddEmpleadoModal() {
  empleadoEditId = null;
  document.getElementById('modal-emp-title').textContent = 'Nuevo empleado';
  ['memp-nombre','memp-dni','memp-telefono','memp-email','memp-direccion','memp-puesto','memp-obs'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  poblarAreasEmpleado('');
  document.getElementById('memp-registrado').value = 'si';
  document.getElementById('memp-ingreso').value = '';
  document.getElementById('memp-sueldo').value = '';
  document.getElementById('memp-pct-transf').value = 100;
  document.getElementById('modal-emp-backdrop').style.display = 'flex';
}
function editEmpleado(id) {
  const e = AppData.empleados.find(x => x.id === id);
  if (!e) return;
  empleadoEditId = id;
  document.getElementById('modal-emp-title').textContent = 'Editar empleado';
  document.getElementById('memp-nombre').value = e.nombre || '';
  document.getElementById('memp-dni').value = e.dni || '';
  document.getElementById('memp-telefono').value = e.telefono || '';
  document.getElementById('memp-email').value = e.email || '';
  document.getElementById('memp-direccion').value = e.direccion || '';
  document.getElementById('memp-puesto').value = e.puesto || '';
  poblarAreasEmpleado(e.area || '');
  document.getElementById('memp-obs').value = e.obs || '';
  document.getElementById('memp-registrado').value = e.registrado === false ? 'no' : 'si';
  document.getElementById('memp-ingreso').value = e.fecha_ingreso ? String(e.fecha_ingreso).slice(0, 10) : '';
  document.getElementById('memp-sueldo').value = _num(e.sueldo) || '';
  document.getElementById('memp-pct-transf').value = _num(e.pct_transferencia);
  document.getElementById('modal-emp-backdrop').style.display = 'flex';
}
function closeEmpleadoModal(ev) {
  if (!ev || ev.target.id === 'modal-emp-backdrop') document.getElementById('modal-emp-backdrop').style.display = 'none';
}
async function guardarEmpleadoModal() {
  const nombre = (document.getElementById('memp-nombre').value || '').trim().toUpperCase();
  if (!nombre) { alert('El nombre es obligatorio.'); return; }
  let pct = parseFloat(document.getElementById('memp-pct-transf').value);
  if (isNaN(pct) || pct < 0) pct = 0; if (pct > 100) pct = 100;
  const rec = {
    nombre,
    dni: (document.getElementById('memp-dni').value || '').trim(),
    telefono: (document.getElementById('memp-telefono').value || '').trim(),
    email: (document.getElementById('memp-email').value || '').trim(),
    direccion: (document.getElementById('memp-direccion').value || '').trim(),
    puesto: (document.getElementById('memp-puesto').value || '').trim(),
    area: (document.getElementById('memp-area') || {}).value || '',
    obs: (document.getElementById('memp-obs').value || '').trim(),
    registrado: document.getElementById('memp-registrado').value === 'si',
    fecha_ingreso: document.getElementById('memp-ingreso').value || null,
    sueldo: parseFloat(document.getElementById('memp-sueldo').value) || 0,
    pct_transferencia: pct,
    activo: true
  };
  try {
    if (empleadoEditId != null) {
      await DB.updateWhere('empleados', 'id', empleadoEditId, rec);
      const e = AppData.empleados.find(x => x.id === empleadoEditId);
      if (e) Object.assign(e, rec);
    } else {
      const row = await DB.insertRow('empleados', rec);
      AppData.empleados.push(Object.assign({ id: row.id }, rec));
    }
    persistirEmpleadosLocal();
    empleadoEditId = null;
    document.getElementById('modal-emp-backdrop').style.display = 'none';
    renderEmpleados();
    showToast('✅ Empleado guardado');
  } catch (e) { console.warn('guardarEmpleadoModal', e); alert('No se pudo guardar: ' + (e.message || e)); }
}
async function eliminarEmpleado(id) {
  const e = AppData.empleados.find(x => x.id === id);
  if (!e) return;
  const motivo = prompt('Dar de baja a ' + e.nombre + '.\n\n¿Motivo? (renuncia, despido, fin de contrato…)\n\nPasa a la solapa Bajas; su historial de sueldos se conserva.', '');
  if (motivo === null) return;   // canceló
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    await DB.updateWhere('empleados', 'id', id, { activo: false, fecha_baja: hoy, motivo_baja: motivo.trim() });
    e.activo = false; e.fecha_baja = hoy; e.motivo_baja = motivo.trim();
    persistirEmpleadosLocal();
    renderEmpleados();
    if (typeof renderBajas === 'function') renderBajas();
    showToast('Empleado dado de baja — quedó en la solapa Bajas');
  } catch (err) { console.warn('eliminarEmpleado', err); showToast('⛔ No se pudo dar de baja'); }
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 2 — AJUSTES DE SUELDO
// ════════════════════════════════════════════════════════════════════════
function renderAjustesPanel() {
  const cont = document.getElementById('emp-ajustes-rows');
  if (!cont) return;
  const mesEl = document.getElementById('emp-ajuste-periodo');
  if (mesEl && !mesEl.value) mesEl.value = new Date().toISOString().slice(0, 7);
  const mesSel = (mesEl && mesEl.value) || new Date().toISOString().slice(0, 7);

  const activos = (AppData.empleados || []).filter(e => e.activo !== false);
  // Le toca en el mes elegido o antes (los vencidos arrastran).
  const alcanzados = activos.filter(e => {
    const p = proximoAjuste(e);
    return p && _yyyymm(p) <= mesSel;
  }).sort((a, b) => {
    const pa = proximoAjuste(a), pb = proximoAjuste(b);
    return (pa ? pa.getTime() : 0) - (pb ? pb.getTime() : 0);
  });

  _renderMesesAjuste(activos, mesSel);

  const info = document.getElementById('emp-ajuste-info');
  if (info) info.textContent = alcanzados.length
    ? alcanzados.length + ' empleado(s) ajustan en ' + _mesTexto(mesSel) + ' o antes'
    : 'Nadie tiene ajuste pendiente hasta ' + _mesTexto(mesSel);

  if (!alcanzados.length) {
    cont.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">✓</div>' +
      '<div class="empty-title">Nadie ajusta en ' + _mesTexto(mesSel) + '</div>' +
      '<div class="empty-sub">Cada uno ajusta 3 meses después de su último aumento — probá con otro mes</div></div></td></tr>';
    _actualizarPreviewAjuste();
    return;
  }

  cont.innerHTML = alcanzados.map(e => {
    const est = estadoAjuste(e);
    const ult = ultimoAjusteDe(e.id);
    const prox = proximoAjuste(e);
    const ultTxt = ult
      ? '<div style="font-weight:600">' + _empFmt(ult.fecha) + '</div>' +
        '<div style="font-size:10px;color:var(--text-muted)">' +
          (_num(ult.sueldo_anterior) > 0
            ? fmtPeso(_num(ult.sueldo_anterior)) + ' → ' + fmtPeso(_num(ult.sueldo_nuevo))
            : (ult.pct ? '+' + ult.pct + '%' : 'sin detalle')) + '</div>'
      : '<span class="muted" style="font-size:11px">Nunca ajustado</span>';
    const vencido = est.estado === 'vencido';
    return '<tr>' +
      '<td><label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
        '<input type="checkbox" class="emp-ajuste-chk" data-id="' + e.id + '" checked onchange="_actualizarPreviewAjuste()">' +
        '<div class="conductor-avatar" style="background:' + avatarColor(e.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(e.nombre) + '</div>' +
        '<div><strong>' + e.nombre + '</strong>' +
        '<div style="font-size:10px;color:var(--text-muted)">' + (e.puesto || '') + (e.area ? ' · ' + e.area : '') + '</div></div></label></td>' +
      '<td class="muted" style="font-size:12px">' + _empFmt(e.fecha_ingreso) + '</td>' +
      '<td style="font-size:12px">' + ultTxt + '</td>' +
      '<td style="font-size:12px">' +
        '<div style="font-weight:600;color:' + (vencido ? '#b91c1c' : '#854d0e') + '">' + (prox ? _mesTexto(_yyyymm(prox)) : '—') + '</div>' +
        '<div style="font-size:10px;color:var(--text-muted)">' + (vencido ? 'atrasado ' + _mesesTexto(est.meses) : (est.meses === 0 ? 'le toca este mes' : 'en ' + _mesesTexto(est.meses))) + '</div></td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(_num(e.sueldo)) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700" id="emp-prev-' + e.id + '">—</td>' +
    '</tr>';
  }).join('');
  _actualizarPreviewAjuste();
}

// AAAA-MM de una fecha.
function _yyyymm(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

const _MESES_TXT = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function _mesTexto(yyyymm) {
  const p = String(yyyymm || '').split('-');
  if (p.length < 2) return yyyymm || '—';
  return _MESES_TXT[(+p[1]) - 1] + ' ' + p[0];
}

// Chips por mes: cuántos ajustan y cuánto suman. Sirve para ver de un vistazo
// cómo se reparte el año y planificar el costo.
function _renderMesesAjuste(activos, mesSel) {
  const cont = document.getElementById('emp-ajuste-meses');
  if (!cont) return;
  const hoy = new Date();
  const meses = [];
  for (let i = -1; i <= 5; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
    meses.push(_yyyymm(d));
  }
  // Los vencidos (de meses anteriores) se muestran aparte, al principio.
  let vencidos = 0, vencidosMonto = 0;
  const porMes = {};
  activos.forEach(e => {
    const p = proximoAjuste(e);
    if (!p) return;
    const m = _yyyymm(p);
    if (m < meses[0]) { vencidos++; vencidosMonto += _num(e.sueldo); return; }
    if (!porMes[m]) porMes[m] = { n: 0, masa: 0 };
    porMes[m].n++; porMes[m].masa += _num(e.sueldo);
  });

  const chip = (etiqueta, n, masa, valor, activo) =>
    '<button class="btn btn-sm" onclick="_elegirMesAjuste(\'' + valor + '\')" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:7px 11px;' +
      (activo ? 'border-color:#6366f1;background:#eef2ff;color:#3730a3;font-weight:700' : '') + '">' +
      '<span style="font-size:11px">' + etiqueta + '</span>' +
      '<span style="font-size:10px;opacity:.75">' + (n ? n + ' pers. · ' + fmtPeso(masa) : 'nadie') + '</span></button>';

  let html = '';
  if (vencidos) html += chip('⚠ Vencidos', vencidos, vencidosMonto, meses[0], mesSel <= meses[0]);
  html += meses.map(m => chip(_mesTexto(m), (porMes[m] || {}).n || 0, (porMes[m] || {}).masa || 0, m, m === mesSel)).join('');
  cont.innerHTML = html;
}

function _elegirMesAjuste(m) {
  const el = document.getElementById('emp-ajuste-periodo');
  if (el) el.value = m;
  renderAjustesPanel();
}

// Vista previa: sueldo nuevo por persona y costo total de la nómina.
function _actualizarPreviewAjuste() {
  const pct = parseFloat(document.getElementById('emp-ajuste-pct')?.value) || 0;
  const monto = parseFloat(document.getElementById('emp-ajuste-monto')?.value) || 0;
  let n = 0, sube = 0;
  document.querySelectorAll('.emp-ajuste-chk').forEach(chk => {
    const id = parseInt(chk.dataset.id);
    const e = (AppData.empleados || []).find(x => x.id === id); if (!e) return;
    const nuevo = _nuevoSueldo(_num(e.sueldo), pct, monto);
    const cell = document.getElementById('emp-prev-' + id);
    if (cell) cell.innerHTML = chk.checked
      ? '<span style="color:#166534">' + fmtPeso(nuevo) + '</span>' +
        (nuevo > _num(e.sueldo) ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400">+' + fmtPeso(nuevo - _num(e.sueldo)) + '</div>' : '')
      : '<span class="muted">sin cambio</span>';
    if (chk.checked) { n++; sube += (nuevo - _num(e.sueldo)); }
  });

  // El costo se mide sobre TODA la nómina activa, no solo sobre los que ajustan.
  const activos = (AppData.empleados || []).filter(e => e.activo !== false);
  const masaHoy = activos.reduce((a, e) => a + _num(e.sueldo), 0);
  const tot = document.getElementById('emp-ajuste-totales');
  if (tot) tot.innerHTML =
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-dollar"></i></div>' +
      '<div class="metric-label">Costo actual de sueldos</div><div class="metric-value">' + fmtPeso(masaHoy) + '</div>' +
      '<div class="metric-sub">' + activos.length + ' empleado(s) activos</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-alert"></i></div>' +
      '<div class="metric-label">Con el ajuste proyectado</div><div class="metric-value">' + fmtPeso(masaHoy + sube) + '</div>' +
      '<div class="metric-sub">' + n + ' ajuste(s) tildado(s)</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-alert"></i></div>' +
      '<div class="metric-label">Aumento mensual</div><div class="metric-value" style="color:' + (sube ? '#b45309' : 'inherit') + '">+' + fmtPeso(sube) + '</div>' +
      '<div class="metric-sub">' + (masaHoy ? (sube * 100 / masaHoy).toFixed(1) : 0) + '% sobre la nómina</div></div>';

  const aviso = document.getElementById('emp-ajuste-aviso');
  if (aviso) {
    const falta = n > 0 && !pct && !monto;
    aviso.style.display = falta ? '' : 'none';
    aviso.textContent = falta ? 'Cargá un porcentaje o un monto: por ahora el ajuste no cambia ningún sueldo.' : '';
  }
}
function _nuevoSueldo(actual, pct, monto) {
  let n = actual;
  if (pct) n = n * (1 + pct / 100);
  if (monto) n = n + monto;
  return Math.round(n);
}

// Aplica el ajuste a los empleados tildados y deja historial.
async function aplicarAjusteSueldos() {
  const pct = parseFloat(document.getElementById('emp-ajuste-pct').value) || 0;
  const monto = parseFloat(document.getElementById('emp-ajuste-monto').value) || 0;
  const periodo = document.getElementById('emp-ajuste-periodo').value || '';
  const motivo = (document.getElementById('emp-ajuste-motivo').value || '').trim();
  if (!pct && !monto) { alert('Cargá el % de aumento o un monto fijo.'); return; }
  const ids = Array.from(document.querySelectorAll('.emp-ajuste-chk')).filter(c => c.checked).map(c => parseInt(c.dataset.id));
  if (!ids.length) { alert('Seleccioná al menos un empleado.'); return; }
  const detalle = ids.map(id => { const e = AppData.empleados.find(x => x.id === id); return '· ' + e.nombre + ': ' + fmtPeso(_num(e.sueldo)) + ' → ' + fmtPeso(_nuevoSueldo(_num(e.sueldo), pct, monto)); }).join('\n');
  if (!confirm('¿Aplicar el ajuste a ' + ids.length + ' empleado(s)?\n\n' + detalle + '\n\nQueda registrado en el historial de cada uno.')) return;

  const quien = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  // El ajuste se fecha en el MES ELEGIDO, no en el día en que se aplica: si se
  // adelanta el aumento de septiembre, el ciclo de 3 meses tiene que arrancar
  // en septiembre igual.
  const hoyIso = periodo ? (periodo + '-01') : new Date().toISOString().slice(0, 10);
  let ok = 0;
  for (const id of ids) {
    const e = AppData.empleados.find(x => x.id === id); if (!e) continue;
    const anterior = _num(e.sueldo);
    const nuevo = _nuevoSueldo(anterior, pct, monto);
    const rec = { empleado_id: id, fecha: hoyIso, periodo, pct, sueldo_anterior: anterior, sueldo_nuevo: nuevo, motivo, aplicado_por: quien };
    try {
      await DB.updateWhere('empleados', 'id', id, { sueldo: nuevo });
      const row = await DB.insertRow('empleado_ajustes', rec);
      e.sueldo = nuevo;
      AppData.empleadoAjustes.push(Object.assign({ id: row && row.id }, rec));
      ok++;
    } catch (err) { console.warn('aplicarAjuste ' + id, err); }
  }
  persistirEmpleadosLocal();
  document.getElementById('emp-ajuste-pct').value = '';
  document.getElementById('emp-ajuste-monto').value = '';
  document.getElementById('emp-ajuste-motivo').value = '';
  renderAjustesPanel();
  showToast('✅ Ajuste aplicado a ' + ok + ' empleado(s)');
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 3 — LIQUIDACIÓN DE SUELDOS (mensual)
// ════════════════════════════════════════════════════════════════════════
function sueldoDe(empId, periodo) {
  return (AppData.empleadoSueldos || []).find(s => s.empleado_id === empId && s.periodo === periodo);
}

function renderSueldosPanel() {
  const mesEl = document.getElementById('emp-sueldo-periodo');
  if (mesEl && !mesEl.value) mesEl.value = (typeof mesActualYYYYMM === 'function') ? mesActualYYYYMM() : new Date().toISOString().slice(0, 7);
  const periodo = (mesEl && mesEl.value) || '';
  const cont = document.getElementById('emp-sueldos-rows');
  if (!cont) return;
  const lista = (AppData.empleados || []).filter(e => e.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-title">Sin empleados</div></div></td></tr>';
    return;
  }
  let totT = 0, totE = 0, totG = 0;
  cont.innerHTML = lista.map(e => {
    const s = sueldoDe(e.id, periodo);
    const base = s ? _num(s.sueldo_base) : _num(e.sueldo);
    const extras = s ? _num(s.monto_horas_extra) : 0;
    const bono = s ? _num(s.bono_eficiencia) : 0;
    const adel = s && s.descuenta_adelanto ? _num(s.monto_adelanto) : 0;
    const total = s ? _num(s.total) : base;
    const pctT = s ? _num(s.pct_transferencia) : _num(e.pct_transferencia);
    const mT = s ? _num(s.monto_transferencia) : Math.round(total * pctT / 100);
    const mE = s ? _num(s.monto_efectivo) : total - Math.round(total * pctT / 100);
    totT += mT; totE += mE; totG += total;
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(e.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(e.nombre) + '</div><div><strong>' + e.nombre + '</strong>' +
        (e.registrado === false ? ' <span class="badge" style="background:#fff7ed;color:#9a3412;font-size:9px">no reg.</span>' : '') +
        '<div class="muted" style="font-size:10px">' + (e.puesto || '') + '</div></div></div></td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(base) + '</td>' +
      '<td class="mono" style="text-align:right">' + (extras ? '+' + fmtPeso(extras) : '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + (bono ? '+' + fmtPeso(bono) : '—') + '</td>' +
      '<td class="mono" style="text-align:right;color:#b91c1c">' + (adel ? '-' + fmtPeso(adel) : '—') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(total) + '</td>' +
      '<td style="font-size:11px">' + fmtPeso(mT) + ' <span class="muted">transf.</span><br>' + fmtPeso(mE) + ' <span class="muted">efvo.</span></td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        (s && s.pagado
          ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ Pagado</span>'
          : '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="openSueldoModal(' + e.id + ')"><i class="ic ic-edit"></i> Liquidar</button>') +
        (s ? '<button class="btn btn-sm" style="padding:4px 6px;font-size:11px" onclick="openSueldoModal(' + e.id + ')" title="Editar"><i class="ic ic-edit"></i></button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');

  const tot = document.getElementById('emp-sueldos-total');
  if (tot) tot.innerHTML =
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-card"></i></div><div class="metric-label">Transferencia</div><div class="metric-value">' + fmtPeso(totT) + '</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Efectivo</div><div class="metric-value">' + fmtPeso(totE) + '</div></div>' +
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-file"></i></div><div class="metric-label">Total del mes</div><div class="metric-value">' + fmtPeso(totG) + '</div></div>';
}

// ── Modal de liquidación de sueldo ──────────────────────────────────────────
let sueldoModalEmpId = null;
function openSueldoModal(empId) {
  const e = AppData.empleados.find(x => x.id === empId); if (!e) return;
  sueldoModalEmpId = empId;
  const periodo = document.getElementById('emp-sueldo-periodo').value;
  const s = sueldoDe(empId, periodo);
  document.getElementById('modal-sueldo-title').textContent = 'Liquidar sueldo · ' + e.nombre;
  document.getElementById('msld-info').innerHTML = '<strong>' + e.nombre + '</strong> · ' + (e.puesto || 'sin puesto') +
    ' · ' + (e.registrado === false ? '<span style="color:#9a3412">No registrado</span>' : 'Registrado') +
    '<br><span class="muted">Período ' + periodo + ' · ingreso ' + _empFmt(e.fecha_ingreso) + '</span>';
  document.getElementById('msld-base').value = s ? _num(s.sueldo_base) : _num(e.sueldo);
  document.getElementById('msld-horas').value = s ? _num(s.horas_extra) : '';
  document.getElementById('msld-valor-hora').value = s ? _num(s.valor_hora_extra) : '';
  document.getElementById('msld-bono').value = s ? _num(s.bono_eficiencia) : '';
  document.getElementById('msld-desc-adelanto').checked = s ? !!s.descuenta_adelanto : false;
  document.getElementById('msld-adelanto').value = s ? _num(s.monto_adelanto) : '';
  document.getElementById('msld-pct-transf').value = s ? _num(s.pct_transferencia) : _num(e.pct_transferencia);
  document.getElementById('msld-obs').value = s ? (s.obs || '') : '';
  recalcSueldoModal();
  document.getElementById('modal-sueldo-backdrop').style.display = 'flex';
}
function closeSueldoModal(ev) {
  if (!ev || ev.target.id === 'modal-sueldo-backdrop') document.getElementById('modal-sueldo-backdrop').style.display = 'none';
}
function recalcSueldoModal() {
  const base = parseFloat(document.getElementById('msld-base').value) || 0;
  const horas = parseFloat(document.getElementById('msld-horas').value) || 0;
  const vh = parseFloat(document.getElementById('msld-valor-hora').value) || 0;
  const bono = parseFloat(document.getElementById('msld-bono').value) || 0;
  const descAd = document.getElementById('msld-desc-adelanto').checked;
  const adel = descAd ? (parseFloat(document.getElementById('msld-adelanto').value) || 0) : 0;
  let pct = parseFloat(document.getElementById('msld-pct-transf').value); if (isNaN(pct)) pct = 100;
  pct = Math.max(0, Math.min(100, pct));
  const extras = Math.round(horas * vh);
  const total = Math.round(base + extras + bono - adel);
  const mT = Math.round(total * pct / 100);
  const mE = total - mT;
  document.getElementById('msld-extras-calc').textContent = horas && vh ? (horas + ' h × ' + fmtPeso(vh) + ' = ' + fmtPeso(extras)) : '—';
  document.getElementById('msld-total').textContent = fmtPeso(total);
  document.getElementById('msld-split').innerHTML =
    '<span><i class="ic ic-card"></i> Transferencia (' + pct + '%): <strong>' + fmtPeso(mT) + '</strong></span>' +
    '<span style="margin-left:14px"><i class="ic ic-dollar"></i> Efectivo (' + (100 - pct) + '%): <strong>' + fmtPeso(mE) + '</strong></span>';
  return { base, horas, vh, extras, bono, descAd, adel, pct, total, mT, mE };
}
async function guardarSueldo(marcarPagado) {
  if (sueldoModalEmpId == null) return;
  const periodo = document.getElementById('emp-sueldo-periodo').value;
  const c = recalcSueldoModal();
  const rec = {
    empleado_id: sueldoModalEmpId, periodo,
    sueldo_base: c.base, horas_extra: c.horas, valor_hora_extra: c.vh, monto_horas_extra: c.extras,
    bono_eficiencia: c.bono, descuenta_adelanto: c.descAd, monto_adelanto: c.adel,
    total: c.total, pct_transferencia: c.pct, monto_transferencia: c.mT, monto_efectivo: c.mE,
    pagado: !!marcarPagado, obs: (document.getElementById('msld-obs').value || '').trim()
  };
  if (marcarPagado) rec.pagado_en = new Date().toISOString();
  const existente = sueldoDe(sueldoModalEmpId, periodo);
  try {
    if (existente && typeof existente.id === 'number') {
      await DB.updateWhere('empleado_sueldos', 'id', existente.id, rec);
      Object.assign(existente, rec);
    } else {
      const row = await DB.insertRow('empleado_sueldos', rec);
      AppData.empleadoSueldos.push(Object.assign({ id: row && row.id }, rec));
    }
    persistirEmpleadosLocal();
    document.getElementById('modal-sueldo-backdrop').style.display = 'none';
    renderSueldosPanel();
    showToast(marcarPagado ? '✅ Sueldo liquidado y marcado como pagado' : '✅ Liquidación guardada');
  } catch (e) { console.warn('guardarSueldo', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

// PDF del mes: quién cobra cuánto, con el corte transferencia / efectivo.
function exportSueldosPDF() {
  const periodo = document.getElementById('emp-sueldo-periodo').value;
  const lista = (AppData.empleados || []).filter(e => e.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  if (!lista.length) { alert('Sin empleados.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Sueldos del personal', 14, 18);
  doc.setFontSize(11); doc.text((typeof mesLabel === 'function' ? mesLabel(periodo) : periodo), 14, 26);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  doc.text('Generado: ' + new Date().toLocaleString('es-AR'), 14, 31);

  let tT = 0, tE = 0, tG = 0;
  const body = lista.map(e => {
    const s = sueldoDe(e.id, periodo);
    const total = s ? _num(s.total) : _num(e.sueldo);
    const pct = s ? _num(s.pct_transferencia) : _num(e.pct_transferencia);
    const mT = s ? _num(s.monto_transferencia) : Math.round(total * pct / 100);
    const mE = s ? _num(s.monto_efectivo) : total - mT;
    tT += mT; tE += mE; tG += total;
    return [e.nombre + (e.registrado === false ? ' (no reg.)' : ''), e.puesto || '—',
      fmtPeso(total), fmtPeso(mT), fmtPeso(mE), s && s.pagado ? 'Pagado' : 'Pendiente'];
  });
  doc.autoTable({
    startY: 37,
    head: [['Empleado', 'Puesto', 'Total', 'Transferencia', 'Efectivo', 'Estado']],
    body,
    foot: [[{ content: 'TOTALES', colSpan: 2, styles: { halign: 'right' } }, fmtPeso(tG), fmtPeso(tT), fmtPeso(tE), '']],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });
  doc.save('Sueldos_' + periodo + '.pdf');
  showToast('📥 Sueldos de ' + periodo + ' descargados');
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 4 — BAJAS
//  Personal que salió de la empresa. No se borra: la baja es lógica, así que
//  su historial de sueldos y ajustes queda disponible para consultar.
// ════════════════════════════════════════════════════════════════════════
function renderBajas() {
  const cont = document.getElementById('emp-bajas-cards');
  if (!cont) return;
  const q = (document.getElementById('emp-bajas-search')?.value || '').toLowerCase().trim();
  const bajas = (AppData.empleados || []).filter(e => e.activo === false);
  const lista = bajas
    .filter(e => !q || String(e.nombre).toLowerCase().includes(q) ||
                 String(e.puesto || '').toLowerCase().includes(q) ||
                 String(e.area || '').toLowerCase().includes(q))
    .sort((a, b) => String(b.fecha_baja || '').localeCompare(String(a.fecha_baja || '')) ||
                    String(a.nombre).localeCompare(String(b.nombre)));

  const badge = document.getElementById('emp-bajas-count');
  if (badge) badge.textContent = bajas.length ? '· ' + bajas.length : '';
  const info = document.getElementById('emp-bajas-info');
  if (info) info.textContent = bajas.length
    ? (lista.length === bajas.length ? bajas.length + ' baja(s)' : lista.length + ' de ' + bajas.length + ' baja(s)')
    : '';

  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="ic ic-user"></i></div>' +
      '<div class="empty-title">' + (bajas.length ? 'Ninguna baja coincide con la búsqueda' : 'Sin bajas registradas') + '</div>' +
      '<div class="empty-sub">' + (bajas.length ? 'Probá con otro texto' : 'El personal dado de baja aparece acá, con su historial intacto') + '</div></div>';
    return;
  }

  cont.innerHTML = lista.map(e => {
    const fIng = e.fecha_ingreso ? _empFecha(e.fecha_ingreso) : null;
    const fBaja = e.fecha_baja ? _empFecha(e.fecha_baja) : null;
    let anti = "—";
    if (fIng) {
      const hasta = fBaja || new Date();
      const meses = Math.max(0, (hasta.getFullYear() - fIng.getFullYear()) * 12 + (hasta.getMonth() - fIng.getMonth()));
      const a = Math.floor(meses / 12), m = meses % 12;
      anti = (a ? a + (a === 1 ? ' año' : ' años') : '') + (a && m ? ' ' : '') + (m || !a ? m + (m === 1 ? ' mes' : ' meses') : '');
    }
    const fmtF = d => d ? String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() : '—';
    return '<div class="card" style="opacity:.9">' +
      '<div class="card-body">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
          '<div class="conductor-avatar" style="background:' + avatarColor(e.nombre) + ';width:38px;height:38px;font-size:13px;filter:grayscale(.5)">' + initials(e.nombre) + '</div>' +
          '<div style="min-width:0;flex:1">' +
            '<div style="font-size:14px;font-weight:700">' + e.nombre + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' + (e.puesto || 'Sin puesto') + '</div>' +
            (e.area ? '<span class="tag" style="background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb;font-size:9.5px;margin-top:3px;display:inline-block">' + e.area + '</span>' : '') +
          '</div>' +
          '<button class="btn btn-sm" title="Volver a incorporarlo al plantel" onclick="reincorporarEmpleado(' + e.id + ')"><i class="ic ic-check"></i> Reincorporar</button>' +
        '</div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;padding-top:8px;border-top:1px solid var(--border)">' +
          '<div><span style="color:var(--text-muted)">Ingreso</span><div style="font-weight:600">' + fmtF(fIng) + '</div></div>' +
          '<div><span style="color:var(--text-muted)">Baja</span><div style="font-weight:600">' + fmtF(fBaja) + '</div></div>' +
          '<div><span style="color:var(--text-muted)">Antigüedad</span><div style="font-weight:600">' + anti + '</div></div>' +
          '<div><span style="color:var(--text-muted)">Último sueldo</span><div style="font-weight:600">' + fmtPeso(_num(e.sueldo)) + '</div></div>' +
        '</div>' +
        (e.motivo_baja ? '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)"><i class="ic ic-alert"></i> ' + e.motivo_baja + '</div>' : '') +
      '</div></div>';
  }).join("");
}

async function reincorporarEmpleado(id) {
  const e = AppData.empleados.find(x => x.id === id);
  if (!e) return;
  if (!confirm('¿Reincorporar a ' + e.nombre + ' al plantel?\nVuelve a contar en la masa salarial y en los ajustes trimestrales.')) return;
  try {
    await DB.updateWhere('empleados', 'id', id, { activo: true, fecha_baja: null, motivo_baja: '' });
    e.activo = true; e.fecha_baja = null; e.motivo_baja = '';
    persistirEmpleadosLocal();
    renderBajas();
    showToast('✅ ' + e.nombre + ' volvió al plantel');
  } catch (err) { console.warn('reincorporarEmpleado', err); showToast('⛔ No se pudo reincorporar'); }
}
