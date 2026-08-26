// ════════════════════════════════════════════════════════════════════════
//  VACACIONES (Recursos Humanos)
//  Sincronizado con el panel de Empleados: el plantel, la fecha de ingreso y
//  la baja salen de AppData.empleados. NO hay una segunda lista de gente — dar
//  de alta a alguien acá sería tener dos padrones que se desincronizan.
//
//  Cuántos días le corresponden (LCT art. 150), por antigüedad AL 31/12 del
//  período (no a hoy: la ley lo fija así, y por eso alguien que cumple 5 años
//  en diciembre ya se lleva los 21 días de ese año):
//     hasta 5 años → 14 · más de 5 y hasta 10 → 21
//     más de 10 y hasta 20 → 28 · más de 20 → 35
//  Si no llegó a trabajar la mitad de los días hábiles del año (art. 151), le
//  corresponde 1 día por cada 20 días trabajados (art. 153). Es el caso de
//  quien entró a mitad de año, que en una empresa que toma seguido es la mayoría
//  del primer año.
//
//  El período es el AÑO al que corresponden, no el año en que se toman: las
//  vacaciones se gozan del 1/10 al 30/4 (art. 154), así que un descanso de
//  enero normalmente pertenece al período del año anterior.
// ════════════════════════════════════════════════════════════════════════

const VAC_ESTADOS = {
  planificada: { label: 'Planificada', bg: '#eef2ff', color: '#4338ca', borde: '#c7d2fe' },
  aprobada:    { label: 'Aprobada',    bg: '#ecfdf5', color: '#065f46', borde: '#a7f3d0' },
  tomada:      { label: 'Tomada',      bg: '#f1f5f9', color: '#334155', borde: '#cbd5e1' },
  cancelada:   { label: 'Cancelada',   bg: '#fef2f2', color: '#991b1b', borde: '#fca5a5' },
};
// La cancelada no descuenta saldo; las demás sí (una planificada ya compromete
// los días, si no dos personas se anotarían el mismo saldo).
function vacCuenta(v) { return v && v.estado !== 'cancelada'; }

// Ventana legal para gozarlas (art. 154): 1/10 del período al 30/4 del siguiente.
function vacVentanaGoce(periodo) {
  return { desde: periodo + '-10-01', hasta: (periodo + 1) + '-04-30' };
}

// ── Fechas ──────────────────────────────────────────────────────────────────
function _vacFecha(iso) { return iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00') : null; }
function _vacISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function vacFmt(iso) {
  const d = _vacFecha(iso); if (!d || isNaN(d)) return '—';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
// Días CORRIDOS, con los dos extremos incluidos: del 1 al 14 son 14 días, no 13.
function vacDiasEntre(desdeISO, hastaISO) {
  const a = _vacFecha(desdeISO), b = _vacFecha(hastaISO);
  if (!a || !b || isNaN(a) || isNaN(b)) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}
// Días hábiles Lun–Sáb entre dos fechas (la empresa opera de lunes a sábado,
// mismo criterio que el aviso de días sin registros del importador).
function _vacHabiles(desde, hasta) {
  if (!desde || !hasta || desde > hasta) return 0;
  let n = 0;
  const d = new Date(desde.getTime());
  while (d <= hasta) { if (d.getDay() !== 0) n++; d.setDate(d.getDate() + 1); }
  return n;
}

// ── Cuántos días le corresponden ────────────────────────────────────────────
// Escala del art. 150 según la antigüedad AL 31/12 del período.
function vacEscalaLCT(anios) {
  if (anios > 20) return 35;
  if (anios > 10) return 28;
  if (anios > 5) return 21;
  return 14;
}

// Devuelve { dias, base, detalle } — 'base' distingue el cálculo aplicado para
// poder explicarlo en pantalla en vez de mostrar un número sin origen.
function vacCorresponden(emp, periodo) {
  const ing = _vacFecha(emp && emp.fecha_ingreso);
  if (!ing || isNaN(ing)) return { dias: 0, base: 'sin_ingreso', detalle: 'Sin fecha de ingreso cargada' };
  const cierre = new Date(periodo, 11, 31, 12);
  if (ing > cierre) return { dias: 0, base: 'no_ingresado', detalle: 'Ingresó después del 31/12/' + periodo };

  // Antigüedad en años cumplidos al 31/12 del período.
  let anios = cierre.getFullYear() - ing.getFullYear();
  const cumpleEsteAnio = new Date(cierre.getFullYear(), ing.getMonth(), ing.getDate(), 12);
  if (cumpleEsteAnio > cierre) anios--;

  const inicioAnio = new Date(periodo, 0, 1, 12);
  const desde = ing > inicioAnio ? ing : inicioAnio;
  const trabajados = _vacHabiles(desde, cierre);
  const totalAnio = _vacHabiles(inicioAnio, cierre);

  // Art. 151: con menos de la mitad de los días hábiles del año no se accede al
  // período completo, y va la proporción del art. 153.
  if (trabajados < totalAnio / 2) {
    const dias = Math.floor(trabajados / 20);
    return {
      dias, base: 'proporcional',
      detalle: 'Ingresó el ' + vacFmt(emp.fecha_ingreso) + ' · ' + trabajados + ' días hábiles trabajados en ' + periodo +
        ' → 1 día cada 20 (art. 153)'
    };
  }
  const dias = vacEscalaLCT(anios);
  return {
    dias, base: 'escala',
    detalle: 'Antigüedad al 31/12/' + periodo + ': ' + anios + (anios === 1 ? ' año' : ' años') +
      ' → ' + dias + ' días corridos (art. 150)'
  };
}

// ── Saldo por empleado y período ────────────────────────────────────────────
function vacacionesDe(empId, periodo) {
  return (AppData.vacaciones || []).filter(v => v.empleado_id === empId &&
    (periodo == null || _num(v.periodo) === _num(periodo)));
}
function vacTomados(empId, periodo) {
  return vacacionesDe(empId, periodo).filter(vacCuenta).reduce((s, v) => s + _num(v.dias), 0);
}
function vacSaldo(emp, periodo) {
  const c = vacCorresponden(emp, periodo);
  const tomados = vacTomados(emp.id, periodo);
  return { corresponden: c.dias, base: c.base, detalle: c.detalle, tomados, pendientes: c.dias - tomados };
}

function empleadoDeVac(id) { return (AppData.empleados || []).find(e => e.id === id) || null; }
function _vacNombre(id) { const e = empleadoDeVac(id); return e ? e.nombre : '(empleado dado de baja)'; }

function persistirVacacionesLocal() {
  try { localStorage.setItem('liq_vacaciones', JSON.stringify(AppData.vacaciones)); } catch (e) {}
}

// ════════════════════════════════════════════════════════════════════════
//  SOLAPAS
// ════════════════════════════════════════════════════════════════════════
let vacPeriodo = new Date().getFullYear();
let vacTab = 'saldos';

function switchVacacionesTab(tab) {
  vacTab = tab;
  ['saldos', 'calendario', 'historial'].forEach(t => {
    const panel = document.getElementById('vac-tab-' + t);
    const btn = document.getElementById('vac-btn-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'saldos') renderVacSaldos();
  else if (tab === 'calendario') renderVacCalendario();
  else renderVacHistorial();
}

function renderVacacionesPagina() {
  const sel = document.getElementById('vac-periodo');
  if (sel && !sel.options.length) {
    const hoy = new Date().getFullYear();
    let html = '';
    for (let a = hoy + 1; a >= hoy - 5; a--) html += '<option value="' + a + '">' + a + '</option>';
    sel.innerHTML = html;
    sel.value = String(vacPeriodo);
  }
  const mes = document.getElementById('vac-mes');
  if (mes && !mes.value) {
    const d = new Date();
    mes.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  switchVacacionesTab(vacTab);
}

function vacCambioPeriodo() {
  vacPeriodo = parseInt(document.getElementById('vac-periodo').value, 10) || new Date().getFullYear();
  switchVacacionesTab(vacTab);
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 1 — SALDOS (quién tiene días y cuántos le quedan)
// ════════════════════════════════════════════════════════════════════════
let vacSoloPendientes = false;
function toggleVacPendientes() { vacSoloPendientes = !vacSoloPendientes; renderVacSaldos(); }

function renderVacSaldos() {
  const cont = document.getElementById('vac-saldos-cards');
  if (!cont) return;
  const q = (document.getElementById('vac-search')?.value || '').toLowerCase().trim();
  const activos = (AppData.empleados || []).filter(e => e.activo !== false);

  const filas = activos.map(e => ({ e, s: vacSaldo(e, vacPeriodo) }));

  // Resumen: lo que RRHH mira primero es cuánto descanso queda por otorgar.
  const totCorr = filas.reduce((s, f) => s + f.s.corresponden, 0);
  const totTom = filas.reduce((s, f) => s + f.s.tomados, 0);
  const totPend = filas.reduce((s, f) => s + Math.max(0, f.s.pendientes), 0);
  const sinIngreso = filas.filter(f => f.s.base === 'sin_ingreso').length;
  const res = document.getElementById('vac-resumen');
  if (res) {
    const card = (etq, val, sub) =>
      '<div class="metric-card"><div class="metric-label">' + etq + '</div>' +
      '<div class="metric-value">' + val + '</div>' +
      '<div class="metric-sub">' + sub + '</div></div>';
    res.innerHTML =
      card('Días que corresponden', totCorr, activos.length + ' empleado(s) activos · período ' + vacPeriodo) +
      card('Días ya otorgados', totTom, totCorr ? Math.round(totTom * 100 / totCorr) + '% del total' : '—') +
      card('Días pendientes', totPend, 'Por otorgar antes del 30/04/' + (vacPeriodo + 1));
  }

  const aviso = document.getElementById('vac-aviso');
  if (aviso) aviso.innerHTML = sinIngreso
    ? '<div class="alert" style="margin:0 0 12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
      '<i class="ic ic-alert"></i><div><strong>' + sinIngreso + ' empleado(s) sin fecha de ingreso</strong> — sin ese dato no se puede ' +
      'calcular la antigüedad y aparecen en 0 días. Cargásela en <strong>Empleados</strong> y el saldo se corrige solo.</div></div>'
    : '';

  let lista = filas.filter(f => !q ||
    String(f.e.nombre).toLowerCase().includes(q) ||
    String(f.e.puesto || '').toLowerCase().includes(q) ||
    String(f.e.area || '').toLowerCase().includes(q));
  if (vacSoloPendientes) lista = lista.filter(f => f.s.pendientes > 0);
  lista.sort((a, b) => b.s.pendientes - a.s.pendientes || String(a.e.nombre).localeCompare(String(b.e.nombre)));

  const btn = document.getElementById('vac-filtro-pend');
  if (btn) btn.classList.toggle('active', vacSoloPendientes);
  const cnt = document.getElementById('vac-count');
  if (cnt) cnt.textContent = lista.length === activos.length
    ? activos.length + ' empleado(s)'
    : lista.length + ' de ' + activos.length + ' empleado(s)';

  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="ic ic-user"></i></div>' +
      '<div class="empty-title">' + (activos.length ? 'Ningún empleado coincide' : 'Sin empleados activos') + '</div>' +
      '<div class="empty-sub">' + (activos.length ? 'Probá con otro texto o quitá el filtro' : 'El plantel se carga en el panel Empleados') + '</div></div>';
    return;
  }

  cont.innerHTML = lista.map(({ e, s }) => {
    const pct = s.corresponden > 0 ? Math.min(100, Math.round(s.tomados * 100 / s.corresponden)) : 0;
    const colorBarra = s.pendientes <= 0 ? '#059669' : (pct >= 50 ? '#f59e0b' : '#254fa1');
    const vs = vacacionesDe(e.id, vacPeriodo).filter(vacCuenta)
      .sort((a, b) => String(a.fecha_desde).localeCompare(String(b.fecha_desde)));
    const chips = vs.map(v => {
      const st = VAC_ESTADOS[v.estado] || VAC_ESTADOS.planificada;
      return '<span class="tag" style="background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.borde + ';font-size:10.5px">' +
        vacFmt(v.fecha_desde) + ' → ' + vacFmt(v.fecha_hasta) + ' · ' + v.dias + 'd</span>';
    }).join(' ');

    return '<div class="card"><div class="card-body">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
        '<div class="conductor-avatar" style="background:' + avatarColor(e.nombre) + ';width:38px;height:38px;font-size:13px">' + initials(e.nombre) + '</div>' +
        '<div style="min-width:0;flex:1">' +
          '<div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + e.nombre + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted)">' + (e.puesto || e.area || '—') + ' · ingresó ' + vacFmt(e.fecha_ingreso) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;margin-bottom:8px">' +
        '<div><div style="font-size:10px;color:var(--text-muted)">Corresponden</div><div style="font-size:16px;font-weight:700">' + s.corresponden + '</div></div>' +
        '<div><div style="font-size:10px;color:var(--text-muted)">Tomados</div><div style="font-size:16px;font-weight:700">' + s.tomados + '</div></div>' +
        '<div><div style="font-size:10px;color:var(--text-muted)">Pendientes</div><div style="font-size:16px;font-weight:700;color:' +
          (s.pendientes < 0 ? '#b91c1c' : s.pendientes === 0 ? '#059669' : 'inherit') + '">' + s.pendientes + '</div></div>' +
      '</div>' +
      '<div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden;margin-bottom:8px">' +
        '<div style="height:100%;width:' + pct + '%;background:' + colorBarra + '"></div></div>' +
      '<div style="font-size:10.5px;color:var(--text-muted);margin-bottom:8px">' + s.detalle + '</div>' +
      (s.pendientes < 0 ? '<div style="font-size:11px;color:#b91c1c;margin-bottom:8px"><strong>Tomó ' + Math.abs(s.pendientes) +
        ' día(s) de más</strong> para este período — revisá si alguno corresponde a otro año.</div>' : '') +
      (chips ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' + chips + '</div>' : '') +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="btn btn-sm btn-primary" onclick="openVacModal(null,' + e.id + ')">+ Cargar vacaciones</button>' +
        (vs.length ? '<button class="btn btn-sm" onclick="exportVacNotificacion(' + e.id + ')"><i class="ic ic-download"></i> Notificación</button>' : '') +
      '</div>' +
    '</div></div>';
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 2 — CALENDARIO (quién está afuera y cuándo)
//  El dato que importa no es la lista sino la SUPERPOSICIÓN: si se van tres de
//  la misma área la misma semana, la oficina queda vacía y eso hay que verlo
//  antes de aprobar, no después.
// ════════════════════════════════════════════════════════════════════════
function renderVacCalendario() {
  const cont = document.getElementById('vac-cal-cont');
  if (!cont) return;
  const mesVal = document.getElementById('vac-mes')?.value || '';
  if (!mesVal) { cont.innerHTML = ''; return; }
  const [anio, mes] = mesVal.split('-').map(Number);
  const primero = new Date(anio, mes - 1, 1, 12);
  const ultimo = new Date(anio, mes, 0, 12);
  const nDias = ultimo.getDate();

  // Todas las vacaciones que tocan el mes, del período que sea: en enero se
  // están gozando las del año anterior y filtrarlas por período las escondería.
  const delMes = (AppData.vacaciones || []).filter(v => vacCuenta(v) &&
    _vacFecha(v.fecha_desde) <= ultimo && _vacFecha(v.fecha_hasta) >= primero)
    .sort((a, b) => String(a.fecha_desde).localeCompare(String(b.fecha_desde)) ||
                    String(_vacNombre(a.empleado_id)).localeCompare(String(_vacNombre(b.empleado_id))));

  const activos = (AppData.empleados || []).filter(e => e.activo !== false).length;
  const porDia = new Array(nDias + 1).fill(0);
  delMes.forEach(v => {
    const a = _vacFecha(v.fecha_desde), b = _vacFecha(v.fecha_hasta);
    for (let d = 1; d <= nDias; d++) {
      const f = new Date(anio, mes - 1, d, 12);
      if (f >= a && f <= b) porDia[d]++;
    }
  });
  const pico = Math.max.apply(null, porDia.slice(1).concat([0]));

  const nombreMes = primero.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  let grid = '';
  for (let d = 1; d <= nDias; d++) {
    const f = new Date(anio, mes - 1, d, 12);
    const n = porDia[d];
    const dom = f.getDay() === 0;
    const bg = n === 0 ? 'var(--bg)' : n === 1 ? '#dbeafe' : n === 2 ? '#fde68a' : '#fecaca';
    // Los días con gente afuera van pintados con un pastel fijo, así que el texto
    // NO puede heredar el color del tema: en modo oscuro quedaba casi blanco
    // sobre fondo claro y no se leía el número del día.
    const fg = n ? '#1f2937' : 'inherit';
    const fgTenue = n ? '#4b5563' : 'var(--text-muted)';
    grid += '<div title="' + d + '/' + mes + ': ' + n + ' de licencia" style="border:1px solid var(--border);border-radius:6px;padding:4px 2px;text-align:center;' +
      'background:' + bg + ';opacity:' + (dom ? '.55' : '1') + '">' +
      '<div style="font-size:9px;color:' + fgTenue + '">' + DOW[f.getDay()] + '</div>' +
      '<div style="font-size:12px;font-weight:600;color:' + fg + '">' + d + '</div>' +
      '<div style="font-size:10px;font-weight:700;color:' + (n ? '#7c2d12' : 'var(--text-muted)') + '">' + (n || '·') + '</div>' +
      '</div>';
  }

  const filas = delMes.map(v => {
    const e = empleadoDeVac(v.empleado_id);
    const st = VAC_ESTADOS[v.estado] || VAC_ESTADOS.planificada;
    return '<tr>' +
      '<td><strong>' + _vacNombre(v.empleado_id) + '</strong>' +
        (e && e.area ? '<div style="font-size:10.5px;color:var(--text-muted)">' + e.area + '</div>' : '') + '</td>' +
      '<td>' + vacFmt(v.fecha_desde) + ' → ' + vacFmt(v.fecha_hasta) + '</td>' +
      '<td style="text-align:right"><strong>' + v.dias + '</strong></td>' +
      '<td>' + v.periodo + '</td>' +
      '<td><span class="tag" style="background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.borde + '">' + st.label + '</span></td>' +
      '<td style="text-align:right"><button class="btn btn-sm" onclick="openVacModal(' + v.id + ')"><i class="ic ic-edit"></i></button></td>' +
    '</tr>';
  }).join('');

  cont.innerHTML =
    '<div class="card" style="margin-bottom:14px"><div class="card-header">' +
      '<span class="card-title">' + nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1) + '</span>' +
      '<span style="font-size:11px;color:var(--text-muted)">' +
        (pico ? 'Pico: ' + pico + ' de ' + activos + ' persona(s) afuera el mismo día' : 'Nadie de licencia este mes') +
      '</span></div>' +
      '<div class="card-body"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:4px">' + grid + '</div>' +
      '<div style="font-size:10.5px;color:var(--text-muted);margin-top:8px">El número es cuánta gente está de licencia ese día. ' +
      'Los domingos van atenuados: los días son <strong>corridos</strong>, así que cuentan igual.</div></div></div>' +
    (delMes.length
      ? '<div class="card"><div class="table-wrap"><table><thead><tr>' +
        '<th>Empleado</th><th>Período de licencia</th><th style="text-align:right">Días</th><th>Corresponde a</th><th>Estado</th><th></th>' +
        '</tr></thead><tbody>' + filas + '</tbody></table></div></div>'
      : '<div class="empty-state"><div class="empty-icon"><i class="ic ic-calendar"></i></div>' +
        '<div class="empty-title">Sin licencias en el mes</div>' +
        '<div class="empty-sub">Cargalas desde la solapa Saldos, con el botón de cada empleado</div></div>');
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 3 — HISTORIAL
// ════════════════════════════════════════════════════════════════════════
function renderVacHistorial() {
  const body = document.getElementById('vac-hist-rows');
  if (!body) return;
  const q = (document.getElementById('vac-hist-search')?.value || '').toLowerCase().trim();
  const todos = (document.getElementById('vac-hist-todos')?.checked) === true;

  let lista = (AppData.vacaciones || []).slice();
  if (!todos) lista = lista.filter(v => _num(v.periodo) === _num(vacPeriodo));
  if (q) lista = lista.filter(v => String(_vacNombre(v.empleado_id)).toLowerCase().includes(q));
  lista.sort((a, b) => String(b.fecha_desde).localeCompare(String(a.fecha_desde)));

  const info = document.getElementById('vac-hist-info');
  if (info) info.textContent = lista.length + ' licencia(s)' + (todos ? ' (todos los períodos)' : ' del período ' + vacPeriodo);

  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-calendar"></i></div>' +
      '<div class="empty-title">Sin licencias cargadas</div>' +
      '<div class="empty-sub">Se cargan desde la solapa Saldos, en la tarjeta de cada empleado</div></div></td></tr>';
    return;
  }

  body.innerHTML = lista.map(v => {
    const e = empleadoDeVac(v.empleado_id);
    const st = VAC_ESTADOS[v.estado] || VAC_ESTADOS.planificada;
    return '<tr' + (e && e.activo === false ? ' style="opacity:.6"' : '') + '>' +
      '<td><strong>' + _vacNombre(v.empleado_id) + '</strong>' +
        (e && e.activo === false ? ' <span class="tag" style="background:#fef2f2;color:#991b1b;font-size:9.5px">baja</span>' : '') + '</td>' +
      '<td>' + vacFmt(v.fecha_desde) + '</td>' +
      '<td>' + vacFmt(v.fecha_hasta) + '</td>' +
      '<td style="text-align:right"><strong>' + v.dias + '</strong></td>' +
      '<td>' + v.periodo + '</td>' +
      '<td><span class="tag" style="background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.borde + '">' + st.label + '</span>' +
        (v.obs ? '<div style="font-size:10.5px;color:var(--text-muted)">' + v.obs + '</div>' : '') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="openVacModal(' + v.id + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarVacacion(' + v.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL — cargar / editar una licencia
// ════════════════════════════════════════════════════════════════════════
let vacEditId = null;

function openVacModal(id, empIdSugerido) {
  vacEditId = id != null ? id : null;
  const v = id != null ? (AppData.vacaciones || []).find(x => x.id === id) : null;

  // El selector sale del plantel de Empleados. Un empleado de baja con licencia
  // vieja se agrega igual para poder editarla, marcado como tal.
  const sel = document.getElementById('mvac-empleado');
  if (sel) {
    const activos = (AppData.empleados || []).filter(e => e.activo !== false)
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    let html = '<option value="">— Elegí un empleado —</option>' +
      activos.map(e => '<option value="' + e.id + '">' + e.nombre + (e.area ? ' · ' + e.area : '') + '</option>').join('');
    const elegido = v ? v.empleado_id : empIdSugerido;
    if (elegido && !activos.some(e => e.id === elegido)) {
      html += '<option value="' + elegido + '">' + _vacNombre(elegido) + ' (dado de baja)</option>';
    }
    sel.innerHTML = html;
    sel.value = elegido ? String(elegido) : '';
  }

  const per = document.getElementById('mvac-periodo');
  if (per) {
    const hoy = new Date().getFullYear();
    let html = '';
    for (let a = hoy + 1; a >= hoy - 5; a--) html += '<option value="' + a + '">' + a + '</option>';
    per.innerHTML = html;
    per.value = String(v ? v.periodo : vacPeriodo);
  }
  document.getElementById('mvac-desde').value = v ? String(v.fecha_desde).slice(0, 10) : '';
  document.getElementById('mvac-hasta').value = v ? String(v.fecha_hasta).slice(0, 10) : '';
  document.getElementById('mvac-estado').value = v ? v.estado : 'planificada';
  document.getElementById('mvac-obs').value = v ? (v.obs || '') : '';
  document.getElementById('modal-vac-title').textContent = v ? 'Editar licencia' : 'Cargar vacaciones';
  document.getElementById('modal-vac-backdrop').style.display = 'flex';
  recalcVacModal();
}

function closeVacModal(ev) {
  if (ev && ev.target !== ev.currentTarget) return;
  document.getElementById('modal-vac-backdrop').style.display = 'none';
  vacEditId = null;
}

// Muestra el efecto ANTES de guardar: cuántos días son y con cuántos queda.
// Sin esto hay que guardar para enterarse de que se pasó del saldo.
function recalcVacModal() {
  const empId = parseInt(document.getElementById('mvac-empleado').value, 10);
  const periodo = parseInt(document.getElementById('mvac-periodo').value, 10);
  const desde = document.getElementById('mvac-desde').value;
  const hasta = document.getElementById('mvac-hasta').value;
  const dias = (desde && hasta) ? vacDiasEntre(desde, hasta) : 0;
  const cancelada = document.getElementById('mvac-estado').value === 'cancelada';

  const elDias = document.getElementById('mvac-dias');
  if (elDias) elDias.textContent = dias > 0 ? dias + (dias === 1 ? ' día corrido' : ' días corridos') : '—';

  const info = document.getElementById('mvac-info');
  if (!info) return;
  const emp = empleadoDeVac(empId);
  if (!emp || !periodo) { info.innerHTML = ''; return; }

  const s = vacSaldo(emp, periodo);
  // Al editar, sus propios días no cuentan como ya tomados.
  const propios = vacEditId != null
    ? (AppData.vacaciones.find(x => x.id === vacEditId && vacCuenta(x)) || { dias: 0 }).dias : 0;
  const tomadosOtros = s.tomados - _num(propios);
  const quedan = s.corresponden - tomadosOtros - (cancelada ? 0 : dias);

  const v154 = vacVentanaGoce(periodo);
  const fueraVentana = desde && (desde < v154.desde || desde > v154.hasta);

  let html = '<div style="font-size:11.5px;line-height:1.6">' +
    '<div>' + s.detalle + '</div>' +
    '<div>Le corresponden <strong>' + s.corresponden + '</strong> · ya tiene <strong>' + tomadosOtros + '</strong> cargados' +
    (dias && !cancelada ? ' · con esta licencia quedarían <strong>' + quedan + '</strong>' : '') + '</div>';
  if (dias && !cancelada && quedan < 0) {
    html += '<div style="color:#b91c1c;margin-top:4px"><strong>Se pasa por ' + Math.abs(quedan) + ' día(s)</strong> ' +
      'del período ' + periodo + '. Se puede guardar igual (puede ser un adelanto o una licencia de otro tipo), pero revisá el período.</div>';
  }
  if (fueraVentana) {
    html += '<div style="color:#9a3412;margin-top:4px">La fecha de inicio queda <strong>fuera del 1/10/' + periodo +
      ' al 30/4/' + (periodo + 1) + '</strong>, que es cuando se gozan las del período ' + periodo + ' (art. 154). ' +
      'Si el descanso es de otro año, cambiá "Corresponde al período".</div>';
  }
  html += '</div>';
  info.innerHTML = html;
}

async function guardarVacacion() {
  const empleado_id = parseInt(document.getElementById('mvac-empleado').value, 10);
  const periodo = parseInt(document.getElementById('mvac-periodo').value, 10);
  const fecha_desde = document.getElementById('mvac-desde').value;
  const fecha_hasta = document.getElementById('mvac-hasta').value;
  const estado = document.getElementById('mvac-estado').value;
  const obs = (document.getElementById('mvac-obs').value || '').trim();

  if (!empleado_id) { alert('Elegí el empleado.'); return; }
  if (!fecha_desde || !fecha_hasta) { alert('Cargá las dos fechas.'); return; }
  if (fecha_hasta < fecha_desde) { alert('La fecha de fin no puede ser anterior a la de inicio.'); return; }
  const dias = vacDiasEntre(fecha_desde, fecha_hasta);

  // Superposición con otra licencia del MISMO empleado: casi siempre es que se
  // cargó dos veces, y sumaría días de más al saldo.
  const choca = (AppData.vacaciones || []).find(v => v.empleado_id === empleado_id && v.id !== vacEditId &&
    vacCuenta(v) && String(v.fecha_desde) <= fecha_hasta && String(v.fecha_hasta) >= fecha_desde);
  if (choca && !confirm('Ya tiene una licencia del ' + vacFmt(choca.fecha_desde) + ' al ' + vacFmt(choca.fecha_hasta) +
      ', que se superpone con estas fechas.' + String.fromCharCode(10) + String.fromCharCode(10) + '¿Guardar igual?')) return;

  const rec = { empleado_id, periodo, fecha_desde, fecha_hasta, dias, estado, obs };
  try {
    if (vacEditId != null) {
      await DB.updateWhere('vacaciones', 'id', vacEditId, rec);
      const v = AppData.vacaciones.find(x => x.id === vacEditId);
      if (v) Object.assign(v, rec);
    } else {
      const row = await DB.insertRow('vacaciones', rec);
      AppData.vacaciones.push(Object.assign({ id: row.id }, rec));
    }
    persistirVacacionesLocal();
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    closeVacModal();
    switchVacacionesTab(vacTab);
    showToast('✅ Licencia guardada — ' + dias + ' día(s)');
  } catch (e) { console.warn('guardarVacacion', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

async function eliminarVacacion(id) {
  const v = (AppData.vacaciones || []).find(x => x.id === id);
  if (!v) return;
  if (!confirm('Borrar la licencia de ' + _vacNombre(v.empleado_id) + ' del ' + vacFmt(v.fecha_desde) +
    ' al ' + vacFmt(v.fecha_hasta) + '?' + String.fromCharCode(10) + String.fromCharCode(10) +
    'Si la persona no llegó a tomarlas, conviene marcarla como Cancelada en vez de borrarla: así queda el registro.')) return;
  try {
    await DB.deleteWhere('vacaciones', 'id', id);
    AppData.vacaciones = AppData.vacaciones.filter(x => x.id !== id);
    persistirVacacionesLocal();
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    switchVacacionesTab(vacTab);
    showToast('Licencia borrada');
  } catch (e) { console.warn('eliminarVacacion', e); alert('No se pudo borrar: ' + (e.message || e)); }
}

// ════════════════════════════════════════════════════════════════════════
//  PDF
// ════════════════════════════════════════════════════════════════════════
// Notificación individual: la LCT (art. 154) exige comunicar las vacaciones POR
// ESCRITO, así que el papel que firma el empleado es parte del circuito.
function exportVacNotificacion(empId) {
  const emp = empleadoDeVac(empId);
  if (!emp) return;
  const vs = vacacionesDe(empId, vacPeriodo).filter(vacCuenta)
    .sort((a, b) => String(a.fecha_desde).localeCompare(String(b.fecha_desde)));
  if (!vs.length) { alert('Ese empleado no tiene licencias cargadas en el período ' + vacPeriodo + '.'); return; }

  const s = vacSaldo(emp, vacPeriodo);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Notificación de vacaciones', 14, 18);
  doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(60);
  doc.text('Logística Hogareño · período ' + vacPeriodo, 14, 25);
  doc.setFontSize(8.5); doc.setTextColor(110);
  doc.text('Emitida: ' + new Date().toLocaleString('es-AR'), 14, 30);

  doc.setFontSize(11); doc.setTextColor(30);
  doc.setFont(undefined, 'bold'); doc.text(emp.nombre, 14, 42);
  doc.setFont(undefined, 'normal'); doc.setFontSize(9.5); doc.setTextColor(70);
  const datos = [emp.puesto, emp.area, emp.dni ? 'DNI ' + emp.dni : '', 'Ingreso: ' + vacFmt(emp.fecha_ingreso)]
    .filter(Boolean).join('  ·  ');
  doc.text(datos, 14, 48);

  doc.autoTable({
    startY: 55,
    head: [['Desde', 'Hasta', 'Días corridos', 'Estado', 'Observaciones']],
    body: vs.map(v => [vacFmt(v.fecha_desde), vacFmt(v.fecha_hasta), String(v.dias),
      (VAC_ESTADOS[v.estado] || {}).label || v.estado, v.obs || '']),
    foot: [[{ content: 'TOTAL', colSpan: 2, styles: { halign: 'right' } }, String(s.tomados), '', '']],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8.5, textColor: [40, 50, 70] },
    columnStyles: { 2: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });

  let y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(9.5); doc.setTextColor(60);
  doc.text('Días que le corresponden por el período ' + vacPeriodo + ': ' + s.corresponden, 14, y); y += 5;
  doc.text(s.detalle, 14, y); y += 5;
  doc.text('Días otorgados: ' + s.tomados + '   ·   Días pendientes: ' + s.pendientes, 14, y); y += 14;

  doc.setDrawColor(150); doc.line(14, y, 84, y); doc.line(110, y, 180, y);
  doc.setFontSize(8.5); doc.setTextColor(110);
  doc.text('Firma del empleado', 14, y + 5);
  doc.text('Fecha de notificación', 110, y + 5);

  doc.save('Vacaciones_' + String(emp.nombre).replace(/[^A-Za-z0-9]+/g, '_') + '_' + vacPeriodo + '.pdf');
  showToast('📥 Notificación de ' + emp.nombre + ' descargada');
}

// Planilla general de saldos del período.
function exportVacSaldosPDF() {
  const activos = (AppData.empleados || []).filter(e => e.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  if (!activos.length) { alert('Sin empleados activos.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Vacaciones · saldos del personal', 14, 18);
  doc.setFontSize(11); doc.setFont(undefined, 'normal'); doc.text('Período ' + vacPeriodo, 14, 26);
  doc.setFontSize(8.5); doc.setTextColor(110);
  doc.text('Se gozan del 01/10/' + vacPeriodo + ' al 30/04/' + (vacPeriodo + 1) + ' · generado ' + new Date().toLocaleString('es-AR'), 14, 31);

  let tC = 0, tT = 0, tP = 0;
  const body = activos.map(e => {
    const s = vacSaldo(e, vacPeriodo);
    tC += s.corresponden; tT += s.tomados; tP += s.pendientes;
    return [e.nombre, e.area || e.puesto || '—', vacFmt(e.fecha_ingreso),
      String(s.corresponden), String(s.tomados), String(s.pendientes)];
  });
  doc.autoTable({
    startY: 37,
    head: [['Empleado', 'Área', 'Ingreso', 'Corresponden', 'Tomados', 'Pendientes']],
    body,
    foot: [[{ content: 'TOTALES', colSpan: 3, styles: { halign: 'right' } }, String(tC), String(tT), String(tP)]],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });
  doc.save('Vacaciones_saldos_' + vacPeriodo + '.pdf');
  showToast('📥 Saldos de vacaciones descargados');
}
