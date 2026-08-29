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

// ── Jornada ─────────────────────────────────────────────────────────────────
// Dos ejes independientes: cuántas horas hace por día y cuántos días por
// semana. Uno hace 6 horas de lunes a sábados y otro 8 de lunes a viernes:
// con un solo número no se distinguen, y las horas semanales —que es lo que
// se compara— salen de multiplicarlos.
const JORNADA_DIAS = {
  5: 'Lunes a viernes',
  6: 'Lunes a sábados',
  7: 'Todos los días',
};
function diasLaboralesTexto(e) {
  const d = _num(e && e.dias_laborales) || 0;
  if (!d) return 'sin definir';
  return JORNADA_DIAS[d] || (d + (d === 1 ? ' día' : ' días') + ' por semana');
}
function horasSemanales(e) {
  return Math.round(_num(e && e.horas_diarias) * _num(e && e.dias_laborales) * 10) / 10;
}
function jornadaTexto(e) {
  const h = _num(e && e.horas_diarias);
  if (!h) return 'Jornada sin definir';
  const hs = horasSemanales(e);
  return h + ' h por día · ' + diasLaboralesTexto(e) + (hs ? ' · ' + hs + ' h semanales' : '');
}

// ── Estado de ajuste ────────────────────────────────────────────────────────
// Próxima fecha de ajuste = ingreso + N×3 meses, posterior al ÚLTIMO ajuste
// aplicado (o al ingreso si nunca se ajustó).
function ultimoAjusteDe(empId) {
  const lista = (AppData.empleadoAjustes || []).filter(a => a.empleado_id === empId);
  if (!lista.length) return null;
  return lista.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
}

// ── Postergaciones ──────────────────────────────────────────────────────────
// A veces la empresa decide no dar el aumento cuando toca. Antes eso no se
// registraba: el empleado quedaba "vencido" para siempre y nadie podía decir
// por qué. Ahora se posterga N meses CON justificación, la fecha del próximo
// ajuste se corre sola y el motivo queda a la vista en su tarjeta.
function postergacionesDe(empId) {
  return (AppData.empleadoPostergaciones || [])
    .filter(p => p.empleado_id === empId)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// La postergación que MANDA hoy: la más lejana de las decididas después del
// último aumento. Una vez que el aumento se aplica, las anteriores dejan de
// contar — el ciclo arranca de nuevo desde ese aumento.
function postergacionVigente(emp) {
  if (!emp) return null;
  const ult = ultimoAjusteDe(emp.id);
  const corte = ult ? String(ult.fecha).slice(0, 10) : String(emp.fecha_ingreso || '').slice(0, 10);
  const posts = postergacionesDe(emp.id)
    .filter(p => p.mes_nuevo && (!corte || String(p.fecha).slice(0, 10) >= corte));
  if (!posts.length) return null;
  return posts.slice().sort((a, b) => String(b.mes_nuevo).localeCompare(String(a.mes_nuevo)))[0];
}

// AAAA-MM → Date del día 1 de ese mes.
function _mesFecha(yyyymm) {
  const p = String(yyyymm || '').split('-');
  if (p.length < 2) return null;
  const d = new Date(+p[0], (+p[1]) - 1, 1);
  return isNaN(d.getTime()) ? null : d;
}
// AAAA-MM + n meses.
function _mesMas(yyyymm, n) {
  const d = _mesFecha(yyyymm);
  if (!d) return '';
  const x = new Date(d.getFullYear(), d.getMonth() + _num(n), 1);
  return _yyyymm(x);
}

function proximoAjuste(emp) {
  // Se ajusta 3 meses DESPUÉS del último aumento; si nunca tuvo uno, desde el
  // ingreso. El ciclo se cuenta POR MES: el día no importa, así que siempre
  // cae el 1º del mes que corresponde y dos personas del mismo mes ajustan
  // juntas (antes, quien entró un día 18 arrastraba ese día para siempre).
  const ult = ultimoAjusteDe(emp.id);
  const base = ult ? _empFecha(ult.fecha) : _empFecha(emp.fecha_ingreso);
  if (!base) return null;
  let prox = new Date(base.getFullYear(), base.getMonth() + RRHH_MESES_AJUSTE, 1);
  // Si se postergó, la fecha es la que dejó la postergación (nunca hacia atrás).
  const post = postergacionVigente(emp);
  if (post) {
    const d = _mesFecha(post.mes_nuevo);
    if (d && d > prox) prox = d;
  }
  return prox;
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
    localStorage.setItem('liq_empleado_postergaciones', JSON.stringify(AppData.empleadoPostergaciones));
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

// 'todos' | 'si' (en blanco) | 'no'. Se lee del <select> en cada render para
// que sobreviva al re-render de realtime, igual que el resto de los filtros.
let empFiltroReg = 'todos';
function setFiltroRegistrado(v) {
  empFiltroReg = v;
  const sel = document.getElementById('emp-filtro-registrado');
  if (sel) sel.value = v;
  renderEmpleados();
}

function renderEmpleados() {
  const cont = document.getElementById('emp-cards');
  if (!cont) return;
  const q = (document.getElementById('emp-search')?.value || '').toLowerCase().trim();
  const selReg = document.getElementById('emp-filtro-registrado');
  if (selReg) { if (selReg.value !== empFiltroReg) empFiltroReg = selReg.value || 'todos'; else selReg.value = empFiltroReg; }
  const todos = (AppData.empleados || []).filter(e => e.activo !== false);
  const lista = todos
    .filter(e => !q || String(e.nombre).toLowerCase().includes(q) || String(e.puesto || '').toLowerCase().includes(q) || String(e.area || '').toLowerCase().includes(q) || String(e.dni || '').includes(q))
    .filter(e => !empSoloAjuste || leTocaAjuste(e))
    .filter(e => empFiltroReg === 'todos' ||
                 (empFiltroReg === 'no' ? e.registrado === false : e.registrado !== false))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  // Resumen
  const nTocan = todos.filter(leTocaAjuste).length;
  const masaSalarial = todos.reduce((s, e) => s + _num(e.sueldo), 0);
  const noRegistrados = todos.filter(e => e.registrado === false).length;
  const res = document.getElementById('emp-resumen');
  if (res) res.innerHTML =
    '<div class="metric-card"' + (noRegistrados ? ' style="cursor:pointer" title="Ver solo los que no están registrados" onclick="setFiltroRegistrado(\'' + (empFiltroReg === 'no' ? 'todos' : 'no') + '\')"' : '') +
      '><div class="metric-ic"><i class="ic ic-user"></i></div><div class="metric-label">Empleados activos</div><div class="metric-value">' + todos.length + '</div>' +
      '<div class="metric-sub"' + (noRegistrados ? ' style="color:#9a3412;font-weight:600"' : '') + '>' + noRegistrados + ' sin registrar' +
      (noRegistrados ? (empFiltroReg === 'no' ? ' — mostrando solo esos' : ' — tocá para verlos') : '') + '</div></div>' +
    '<div class="metric-card"' + (nTocan ? ' style="border-color:#f5d97a"' : '') + '><div class="metric-ic"><i class="ic ic-alert"></i></div><div class="metric-label">Les toca ajuste</div><div class="metric-value"' + (nTocan ? ' style="color:#b45309"' : '') + '>' + nTocan + '</div><div class="metric-sub">cada ' + RRHH_MESES_AJUSTE + ' meses desde su ingreso</div></div>' +
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Masa salarial</div><div class="metric-value">' + fmtPeso(masaSalarial) + '</div><div class="metric-sub">suma de sueldos vigentes</div></div>';

  const cEl = document.getElementById('emp-count');
  if (cEl) cEl.textContent = lista.length + ' de ' + todos.length + ' empleados' +
    (empFiltroReg === 'si' ? ' · registrados' : empFiltroReg === 'no' ? ' · sin registrar' : '');

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
    const post = postergacionVigente(e);
    // Un ajuste postergado NO es un ajuste vencido: la fecha ya se corrió a
    // propósito y hay una justificación detrás. Se muestra como lo que es.
    const badgePost = post
      ? '<span class="badge" style="background:#fef9c3;color:#854d0e;border:1px solid #fde68a" title="' +
        String(post.motivo || '').replace(/"/g, '&quot;') + '"><i class="ic ic-calendar"></i> Postergado a ' +
        _mesTexto(post.mes_nuevo) + '</span>'
      : '';
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
    const nMov = historialEmpleado(e.id).length;
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
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + badgeReg + badgePost + badgeAjuste + '</div>' +
      // La justificación va COMPLETA en la tarjeta, no solo en un tooltip: es
      // la respuesta a "por qué este no cobró el aumento" y tiene que leerse
      // sin tener que abrir nada.
      (post
        ? '<div style="font-size:11px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:7px 10px;color:#854d0e">' +
          '<strong>Ajuste postergado ' + _mesesTexto(post.meses) + '</strong> (de ' + _mesTexto(post.mes_original) + ' a ' + _mesTexto(post.mes_nuevo) + ')' +
          '<div style="margin-top:2px">' + (post.motivo || 'sin justificación') + '</div>' +
          '<div style="font-size:10px;opacity:.8;margin-top:2px">' + _empFmt(post.fecha) + (post.creado_por ? ' · ' + post.creado_por : '') + '</div>' +
          '</div>'
        : '') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">' +
        '<div><div style="font-size:10px;color:var(--text-muted)">Ingreso</div><strong>' + _empFmt(e.fecha_ingreso) + '</strong><div style="font-size:10px;color:var(--text-muted)">' + antiguedadTexto(e) + '</div></div>' +
        '<div><div style="font-size:10px;color:var(--text-muted)">Sueldo</div><strong style="font-size:15px">' + fmtPeso(_num(e.sueldo)) + '</strong>' +
          (ult
            ? '<div style="font-size:10px;color:var(--text-muted)">últ. ajuste ' + _empFmt(ult.fecha) +
              (_num(ult.sueldo_anterior) > 0 ? ' · ' + fmtPeso(_num(ult.sueldo_anterior)) + ' → ' + fmtPeso(_num(ult.sueldo_nuevo)) : (ult.pct ? ' (+' + ult.pct + '%)' : '')) + '</div>'
            : '<div style="font-size:10px;color:var(--text-muted)">sin ajustes</div>') +
        '</div>' +
      '</div>' +
      // El historial completo: cuántos aumentos tuvo y cuándo. Un sueldo se
      // explica por lo que se le fue haciendo, no por el último renglón.
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" style="padding:3px 9px;font-size:11px" onclick="verHistorialEmpleado(' + e.id + ')" title="Todos sus aumentos y postergaciones, con fecha y motivo">' +
          '<i class="ic ic-file"></i> Historial' + (nMov ? ' · ' + nMov : '') + '</button>' +
        (leTocaAjuste(e)
          ? '<button class="btn btn-sm" style="padding:3px 9px;font-size:11px;border-color:#fcd34d;color:#92400e" onclick="abrirPostergarAjuste(' + e.id + ')" title="Si no se le da el aumento ahora, se posterga con una justificación">' +
            '<i class="ic ic-calendar"></i> Postergar</button>'
          : '') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-secondary);border-top:1px solid var(--border);padding-top:8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">' +
        '<span' + (_num(e.horas_diarias) ? '' : ' style="color:#b45309"') + '><i class="ic ic-calendar"></i> ' + jornadaTexto(e) + '</span>' +
        (e.telefono ? '<span>' + e.telefono + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════
//  POSTERGAR EL AJUSTE (con justificación) + HISTORIAL
// ════════════════════════════════════════════════════════════════════════
let _postergIds = [];   // a quién(es) se está postergando

// Abre el modal para uno o para un lote (los que quedaron sin ajustar).
function abrirPostergarAjuste(ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  const emps = lista.map(id => (AppData.empleados || []).find(e => e.id === id)).filter(Boolean);
  if (!emps.length) return;
  _postergIds = emps.map(e => e.id);
  const box = document.getElementById('mpost-quien');
  if (box) {
    box.innerHTML = emps.length === 1
      ? '<i class="ic ic-user"></i><div>Se posterga el ajuste de <strong>' + emps[0].nombre + '</strong>, que le toca en <strong>' +
        _mesTexto(_yyyymm(proximoAjuste(emps[0]) || new Date())) + '</strong>.</div>'
      : '<i class="ic ic-user"></i><div>Se posterga el ajuste de <strong>' + emps.length + ' empleado(s)</strong>: ' +
        emps.map(e => e.nombre).join(' · ') + '.</div>';
  }
  const m = document.getElementById('mpost-meses'); if (m) m.value = '1';
  const t = document.getElementById('mpost-motivo'); if (t) t.value = '';
  recalcPostergar();
  document.getElementById('modal-posterg-backdrop').style.display = 'flex';
}

function cerrarPostergar(e) {
  if (!e || e.target.id === 'modal-posterg-backdrop') {
    document.getElementById('modal-posterg-backdrop').style.display = 'none';
    _postergIds = [];
  }
}

function recalcPostergar() {
  const box = document.getElementById('mpost-preview');
  const btn = document.getElementById('mpost-guardar');
  if (!box) return;
  const meses = Math.max(1, parseInt(document.getElementById('mpost-meses')?.value, 10) || 0);
  const motivo = (document.getElementById('mpost-motivo')?.value || '').trim();
  if (btn) btn.disabled = !motivo;
  const emps = _postergIds.map(id => (AppData.empleados || []).find(e => e.id === id)).filter(Boolean);
  const filas = emps.map(e => {
    const orig = _yyyymm(proximoAjuste(e) || new Date());
    return '<div style="display:flex;justify-content:space-between;gap:10px">' +
      '<span>' + e.nombre + '</span>' +
      '<span><span class="muted">' + _mesTexto(orig) + '</span> → <strong>' + _mesTexto(_mesMas(orig, meses)) + '</strong></span></div>';
  }).join('');
  box.innerHTML = filas +
    '<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">' +
    (motivo ? 'La justificación queda en la ficha de cada uno y en su historial.'
            : '<span style="color:#b91c1c">Escribí la justificación para poder postergar.</span>') + '</div>';
}

async function guardarPostergacion() {
  const meses = Math.max(1, parseInt(document.getElementById('mpost-meses')?.value, 10) || 0);
  const motivo = (document.getElementById('mpost-motivo')?.value || '').trim();
  if (!motivo) { alert('La justificación es obligatoria: es lo que explica por qué no se dio el aumento.'); return; }
  const quien = (typeof currentUser !== 'undefined' && currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  const hoy = new Date().toISOString().slice(0, 10);
  let ok = 0;
  for (const id of _postergIds) {
    const e = (AppData.empleados || []).find(x => x.id === id); if (!e) continue;
    const orig = _yyyymm(proximoAjuste(e) || new Date());
    const rec = { empleado_id: id, fecha: hoy, mes_original: orig, meses,
                  mes_nuevo: _mesMas(orig, meses), motivo, creado_por: quien };
    try {
      if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
      const row = await DB.insertRow('empleado_postergaciones', rec);
      AppData.empleadoPostergaciones.push(Object.assign({ id: row && row.id }, rec));
      ok++;
    } catch (err) { console.warn('guardarPostergacion ' + id, err); }
  }
  persistirEmpleadosLocal();
  document.getElementById('modal-posterg-backdrop').style.display = 'none';
  _postergIds = [];
  renderEmpleados();
  if (document.getElementById('emp-tab-ajustes')?.style.display !== 'none') renderAjustesPanel();
  showToast(ok === 1 ? '⏸ Ajuste postergado ' + _mesesTexto(meses) : '⏸ ' + ok + ' ajuste(s) postergados ' + _mesesTexto(meses));
}

// Deshacer: vuelve a quedar como estaba, sin borrar el registro de las otras.
async function quitarPostergacion(id) {
  const p = (AppData.empleadoPostergaciones || []).find(x => x.id === id);
  if (!p) return;
  const e = (AppData.empleados || []).find(x => x.id === p.empleado_id);
  if (!confirm('¿Deshacer la postergación de ' + (e ? e.nombre : 'este empleado') + '?' + String.fromCharCode(10) +
    'El ajuste vuelve a ' + _mesTexto(p.mes_original) + '.')) return;
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.deleteWhere('empleado_postergaciones', 'id', id);
    AppData.empleadoPostergaciones = AppData.empleadoPostergaciones.filter(x => x.id !== id);
    persistirEmpleadosLocal();
    renderEmpleados();
    if (document.getElementById('emp-tab-ajustes')?.style.display !== 'none') renderAjustesPanel();
    if (document.getElementById('modal-backdrop')?.classList.contains('open')) verHistorialEmpleado(p.empleado_id);
    showToast('Postergación deshecha · el ajuste vuelve a ' + _mesTexto(p.mes_original));
  } catch (err) { console.warn('quitarPostergacion', err); alert('No se pudo deshacer: ' + (err.message || err)); }
}

// ── Historial: aumentos y postergaciones, en una sola línea de tiempo ─────
// Un sueldo se explica por lo que se le fue haciendo. Verlo salteado —solo el
// último aumento— no deja responder "¿hace cuánto que no le aumentan y por qué?".
function historialEmpleado(empId) {
  const ajustes = (AppData.empleadoAjustes || []).filter(a => a.empleado_id === empId)
    .map(a => ({ tipo: 'ajuste', fecha: String(a.fecha || '').slice(0, 10), row: a }));
  const posts = (AppData.empleadoPostergaciones || []).filter(p => p.empleado_id === empId)
    .map(p => ({ tipo: 'postergacion', fecha: String(p.fecha || '').slice(0, 10), row: p }));
  return ajustes.concat(posts).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

function verHistorialEmpleado(empId) {
  const e = (AppData.empleados || []).find(x => x.id === empId);
  if (!e) return;
  const hist = historialEmpleado(empId);
  const vig = postergacionVigente(e);
  const filas = hist.map(h => {
    if (h.tipo === 'ajuste') {
      const a = h.row;
      const de = _num(a.sueldo_anterior), aa = _num(a.sueldo_nuevo);
      const pct = de > 0 ? Math.round(((aa - de) / de) * 1000) / 10 : _num(a.pct);
      return '<tr>' +
        '<td class="mono" style="font-size:11px;white-space:nowrap">' + _empFmt(a.fecha) + '</td>' +
        '<td><span class="badge" style="background:#dcfce7;color:#166534">Aumento</span></td>' +
        '<td style="font-size:12px">' + (de > 0 ? fmtPeso(de) + ' → <strong>' + fmtPeso(aa) + '</strong>' : fmtPeso(aa)) +
          (pct ? ' <span class="muted">(+' + pct + '%)</span>' : '') +
          (a.motivo ? '<div style="font-size:10.5px;color:var(--text-muted)">' + a.motivo + '</div>' : '') + '</td>' +
        '<td class="muted" style="font-size:10.5px">' + (a.aplicado_por || '—') + '</td>' +
        '<td></td></tr>';
    }
    const p = h.row;
    const esVig = vig && vig.id === p.id;
    return '<tr' + (esVig ? '' : ' style="opacity:.62"') + '>' +
      '<td class="mono" style="font-size:11px;white-space:nowrap">' + _empFmt(p.fecha) + '</td>' +
      '<td><span class="badge" style="background:#fef9c3;color:#854d0e;border:1px solid #fde68a">Postergado</span></td>' +
      '<td style="font-size:12px">' + _mesTexto(p.mes_original) + ' → <strong>' + _mesTexto(p.mes_nuevo) + '</strong> ' +
        '<span class="muted">(' + _mesesTexto(p.meses) + ')</span>' +
        '<div style="font-size:10.5px;color:var(--text-secondary)">' + (p.motivo || 'sin justificación') + '</div></td>' +
      '<td class="muted" style="font-size:10.5px">' + (p.creado_por || '—') + '</td>' +
      '<td style="text-align:right">' + (esVig
        ? '<button class="btn btn-sm" style="padding:2px 7px;font-size:10px" onclick="quitarPostergacion(' + p.id + ')">Deshacer</button>' : '') + '</td></tr>';
  }).join('');

  const est = estadoAjuste(e);
  document.getElementById('modal-title').textContent = 'Historial de ' + e.nombre;
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">' +
      '<div>Ingreso: <strong>' + _empFmt(e.fecha_ingreso) + '</strong></div>' +
      '<div>Sueldo actual: <strong>' + fmtPeso(_num(e.sueldo)) + '</strong></div>' +
      '<div>Aumentos: <strong>' + hist.filter(h => h.tipo === 'ajuste').length + '</strong></div>' +
      '<div>Próximo ajuste: <strong>' + (est.fecha ? _mesTexto(_yyyymm(est.fecha)) : '—') + '</strong></div>' +
    '</div>' +
    (vig
      ? '<div class="alert" style="margin-bottom:12px;background:#fef9c3;color:#854d0e;border:1px solid #fde68a">' +
        '<i class="ic ic-calendar"></i><div><strong>Ajuste postergado ' + _mesesTexto(vig.meses) + '</strong> — de ' +
        _mesTexto(vig.mes_original) + ' a ' + _mesTexto(vig.mes_nuevo) + '.<br><em>' + (vig.motivo || 'sin justificación') + '</em></div></div>'
      : '') +
    (hist.length
      ? '<div class="table-wrap" style="max-height:46vh;overflow:auto"><table><thead><tr>' +
        '<th>Fecha</th><th>Qué pasó</th><th>Detalle</th><th>Quién</th><th></th>' +
        '</tr></thead><tbody>' + filas + '</tbody></table></div>'
      : '<div class="empty-state"><div class="empty-sub">Todavía no tiene aumentos ni postergaciones registrados.</div></div>') +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      (leTocaAjuste(e) ? '<button class="btn" onclick="closeModal(); abrirPostergarAjuste(' + e.id + ')"><i class="ic ic-calendar"></i> Postergar el ajuste</button>' : '') +
      '<button class="btn" onclick="closeModal()">Cerrar</button>' +
    '</div>';
  document.getElementById('modal-backdrop').classList.add('open');
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
  ['memp-nombre','memp-dni','memp-telefono','memp-email','memp-direccion','memp-puesto'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  poblarAreasEmpleado('');
  document.getElementById('memp-registrado').value = 'si';
  document.getElementById('memp-ingreso').value = '';
  document.getElementById('memp-sueldo').value = '';
  document.getElementById('memp-horas').value = 8;
  document.getElementById('memp-dias').value = '5';
  _previewJornada();
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
  document.getElementById('memp-registrado').value = e.registrado === false ? 'no' : 'si';
  document.getElementById('memp-ingreso').value = e.fecha_ingreso ? String(e.fecha_ingreso).slice(0, 10) : '';
  document.getElementById('memp-sueldo').value = _num(e.sueldo) || '';
  document.getElementById('memp-horas').value = _num(e.horas_diarias) || '';
  document.getElementById('memp-dias').value = String(_num(e.dias_laborales) || 5);
  _previewJornada();
  document.getElementById('modal-emp-backdrop').style.display = 'flex';
}

// Anticipa las horas semanales mientras se carga la jornada: es el número que
// después se compara entre empleados, y no se guarda —se calcula.
function _previewJornada() {
  const box = document.getElementById('memp-jornada');
  if (!box) return;
  const h = parseFloat(document.getElementById('memp-horas')?.value) || 0;
  const d = parseInt(document.getElementById('memp-dias')?.value, 10) || 0;
  box.innerHTML = (h && d)
    ? 'Son <strong>' + (Math.round(h * d * 10) / 10) + ' horas semanales</strong> (' + (JORNADA_DIAS[d] || d + ' días').toLowerCase() + ').'
    : 'Cargá las horas por día para ver las horas semanales.';
}
function closeEmpleadoModal(ev) {
  if (!ev || ev.target.id === 'modal-emp-backdrop') document.getElementById('modal-emp-backdrop').style.display = 'none';
}
async function guardarEmpleadoModal() {
  const nombre = (document.getElementById('memp-nombre').value || '').trim().toUpperCase();
  if (!nombre) { alert('El nombre es obligatorio.'); return; }
  let horas = parseFloat(document.getElementById('memp-horas').value);
  if (isNaN(horas) || horas < 0) horas = 0; if (horas > 24) horas = 24;
  const dias = parseInt(document.getElementById('memp-dias').value, 10) || 0;
  const rec = {
    nombre,
    dni: (document.getElementById('memp-dni').value || '').trim(),
    telefono: (document.getElementById('memp-telefono').value || '').trim(),
    email: (document.getElementById('memp-email').value || '').trim(),
    direccion: (document.getElementById('memp-direccion').value || '').trim(),
    puesto: (document.getElementById('memp-puesto').value || '').trim(),
    area: (document.getElementById('memp-area') || {}).value || '',
    registrado: document.getElementById('memp-registrado').value === 'si',
    fecha_ingreso: document.getElementById('memp-ingreso').value || null,
    sueldo: parseFloat(document.getElementById('memp-sueldo').value) || 0,
    horas_diarias: horas,
    dias_laborales: dias,
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
    cont.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">✓</div>' +
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
    const post = postergacionVigente(e);
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
        '<div style="font-size:10px;color:var(--text-muted)">' + (vencido ? 'atrasado ' + _mesesTexto(est.meses) : (est.meses === 0 ? 'le toca este mes' : 'en ' + _mesesTexto(est.meses))) + '</div>' +
        (post ? '<div style="font-size:10px;color:#854d0e;margin-top:2px" title="' + String(post.motivo || '').replace(/"/g, '&quot;') + '">' +
          '⏸ postergado ' + _mesesTexto(post.meses) + ' · ' + (post.motivo || 'sin motivo').slice(0, 40) + '</div>' : '') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(_num(e.sueldo)) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700" id="emp-prev-' + e.id + '">—</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn btn-sm" style="padding:2px 7px;font-size:10px" onclick="verHistorialEmpleado(' + e.id + ')" title="Aumentos y postergaciones">Historial</button> ' +
        '<button class="btn btn-sm" style="padding:2px 7px;font-size:10px;border-color:#fcd34d;color:#92400e" onclick="abrirPostergarAjuste(' + e.id + ')" title="No se le da el aumento ahora: se posterga con una justificación">Postergar</button>' +
      '</td>' +
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

  // Los que quedaron DESTILDADOS son, por definición, los que no se ajustaron
  // cuando les tocaba. Sin registrar por qué, quedan "vencidos" para siempre y
  // dentro de tres meses nadie va a poder decir si fue una decisión o un olvido.
  const fuera = Array.from(document.querySelectorAll('.emp-ajuste-chk'))
    .filter(c => !c.checked).map(c => parseInt(c.dataset.id, 10))
    .filter(id => { const e = (AppData.empleados || []).find(x => x.id === id); return e && !postergacionVigente(e); });
  if (fuera.length) {
    const nombres = fuera.map(id => (AppData.empleados.find(x => x.id === id) || {}).nombre).filter(Boolean);
    if (confirm(fuera.length + ' empleado(s) quedaron SIN ajustar:' + String.fromCharCode(10) +
      nombres.slice(0, 8).map(n => '· ' + n).join(String.fromCharCode(10)) +
      (nombres.length > 8 ? String.fromCharCode(10) + '…y ' + (nombres.length - 8) + ' más' : '') +
      String.fromCharCode(10) + String.fromCharCode(10) +
      'Si no se les da el aumento, conviene postergarlo con una justificación: si no, quedan vencidos y en tres meses nadie va a saber por qué.' +
      String.fromCharCode(10) + 'Aceptar = postergar ahora · Cancelar = dejarlos como están')) {
      abrirPostergarAjuste(fuera);
    }
  }
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
    // Sin liquidación cargada no hay forma de pago: se define al liquidar.
    const pctT = s ? _num(s.pct_transferencia) : null;
    const mT = s ? _num(s.monto_transferencia) : 0;
    const mE = s ? _num(s.monto_efectivo) : 0;
    const est = estadoAjuste(e);
    const leToca = leTocaAjuste(e);
    const post = postergacionVigente(e);
    totT += mT; totE += mE; totG += total;
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(e.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(e.nombre) + '</div><div><strong>' + e.nombre + '</strong>' +
        (e.registrado === false ? ' <span class="badge" style="background:#fff7ed;color:#9a3412;font-size:9px">no reg.</span>' : '') +
        (leToca ? ' <span class="badge" style="background:' + (est.estado === 'vencido' ? '#fee2e2;color:#b91c1c' : '#fef9c3;color:#854d0e') + ';font-size:9px" title="Le corresponde el aumento trimestral. Se puede aplicar desde acá.">' +
          (est.estado === 'vencido' ? 'ajuste vencido' : 'le toca ajuste') + '</span>' : '') +
        (post ? ' <span class="badge" style="background:#fef9c3;color:#854d0e;font-size:9px" title="' + String(post.motivo || '').replace(/"/g, '&quot;') + '">postergado a ' + _mesTexto(post.mes_nuevo) + '</span>' : '') +
        '<div class="muted" style="font-size:10px">' + (e.puesto || '') + '</div></div></div></td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(base) + '</td>' +
      '<td class="mono" style="text-align:right">' + (extras ? '+' + fmtPeso(extras) : '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + (bono ? '+' + fmtPeso(bono) : '—') + '</td>' +
      '<td class="mono" style="text-align:right;color:#b91c1c">' + (adel ? '-' + fmtPeso(adel) : '—') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(total) + '</td>' +
      '<td style="font-size:11px">' + (s
          ? fmtPeso(mT) + ' <span class="muted">transf. (' + pctT + '%)</span><br>' + fmtPeso(mE) + ' <span class="muted">efvo.</span>'
          : '<span class="muted">a definir al liquidar</span>') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">' +
        (leToca ? '<button class="btn btn-sm" style="padding:4px 7px;font-size:10.5px;border-color:#fcd34d;color:#92400e" onclick="abrirAjusteIndividual(' + e.id + ')" title="Aplicarle el aumento trimestral ahora, sin salir de esta pantalla">$ Ajustar</button>' +
          '<button class="btn btn-sm" style="padding:4px 7px;font-size:10.5px" onclick="abrirPostergarAjuste(' + e.id + ')" title="No se le da el aumento: se posterga con una justificación">Postergar</button>' : '') +
        (s && s.pagado
          ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ Pagado</span>'
          : '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="openSueldoModal(' + e.id + ')"><i class="ic ic-edit"></i> Liquidar</button>') +
        (s ? '<button class="btn btn-sm" style="padding:4px 6px;font-size:11px" onclick="openSueldoModal(' + e.id + ')" title="Editar"><i class="ic ic-edit"></i></button>' +
             '<button class="btn btn-sm" style="padding:4px 7px;font-size:10.5px" onclick="exportReciboSueldoPDF(' + e.id + ')" title="Recibo para firmar al momento del pago"><i class="ic ic-download"></i> Recibo</button>' : '') +
      '</div></td>' +
    '</tr>';
  }).join('');

  // Liquidar el mes es el momento en que se paga: si alguien tiene el aumento
  // pendiente, se le está por pagar de menos. Se avisa acá, no en otra solapa.
  const pend = lista.filter(leTocaAjuste);
  const av = document.getElementById('emp-sueldo-aviso');
  if (av) av.innerHTML = pend.length
    ? '<div class="alert" style="margin:0 0 14px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d">' +
      '<i class="ic ic-alert"></i><div><strong>' + pend.length + ' empleado(s) tienen el ajuste trimestral pendiente.</strong> ' +
      'Si se liquida así, se les paga con el sueldo viejo. Ajustalos o postergalos desde su fila: ' +
      pend.slice(0, 6).map(x => x.nombre).join(' · ') + (pend.length > 6 ? ' …y ' + (pend.length - 6) + ' más' : '') +
      '</div></div>'
    : '';

  // Transferencia y efectivo suman SOLO lo liquidado: de lo que falta liquidar
  // todavía no se sabe con qué corte se paga, y meterlo con un reparto supuesto
  // daría un número que nadie puede usar para preparar la plata.
  const sinLiq = lista.filter(e => !sueldoDe(e.id, periodo)).length;
  const tot = document.getElementById('emp-sueldos-total');
  if (tot) tot.innerHTML =
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-card"></i></div><div class="metric-label">Transferencia</div><div class="metric-value">' + fmtPeso(totT) + '</div>' +
      '<div class="metric-sub">de lo ya liquidado</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Efectivo</div><div class="metric-value">' + fmtPeso(totE) + '</div>' +
      '<div class="metric-sub">de lo ya liquidado</div></div>' +
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-file"></i></div><div class="metric-label">Total del mes</div><div class="metric-value">' + fmtPeso(totG) + '</div>' +
      '<div class="metric-sub">' + (sinLiq ? sinLiq + ' sin liquidar — su forma de pago se define al liquidar' : 'todo liquidado') + '</div></div>';
}

// ── Ajuste de UN empleado, desde la liquidación mensual ────────────────────
// El aumento se decide por lote en su propia solapa, pero cuando se está
// liquidando el mes y alguien tiene el ajuste pendiente hay que poder dárselo
// sin salir de acá: ir a la otra solapa y volver es donde se pierde.
let _aj1Id = null;

function abrirAjusteIndividual(empId) {
  const e = (AppData.empleados || []).find(x => x.id === empId); if (!e) return;
  _aj1Id = empId;
  const est = estadoAjuste(e);
  const box = document.getElementById('maj1-info');
  if (box) box.innerHTML = '<i class="ic ic-user"></i><div><strong>' + e.nombre + '</strong> · ' + (e.puesto || 'sin puesto') +
    '<br>Sueldo actual <strong>' + fmtPeso(_num(e.sueldo)) + '</strong> · ' +
    (est.estado === 'vencido' ? '<span style="color:#b91c1c">ajuste vencido desde ' + _mesTexto(_yyyymm(est.fecha)) + '</span>'
     : est.estado === 'toca' ? '<span style="color:#92400e">le toca este mes</span>'
     : 'próximo ajuste ' + (est.fecha ? _mesTexto(_yyyymm(est.fecha)) : '—')) + '</div>';
  ['maj1-pct', 'maj1-monto', 'maj1-motivo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  recalcAjusteIndividual();
  document.getElementById('modal-ajuste1-backdrop').style.display = 'flex';
}

function cerrarAjusteIndividual(e) {
  if (!e || e.target.id === 'modal-ajuste1-backdrop') {
    document.getElementById('modal-ajuste1-backdrop').style.display = 'none';
    _aj1Id = null;
  }
}

function recalcAjusteIndividual() {
  const box = document.getElementById('maj1-preview');
  const btn = document.getElementById('maj1-guardar');
  if (!box) return;
  const e = (AppData.empleados || []).find(x => x.id === _aj1Id);
  const pct = parseFloat(document.getElementById('maj1-pct')?.value) || 0;
  const monto = parseFloat(document.getElementById('maj1-monto')?.value) || 0;
  if (btn) btn.disabled = !e || (!pct && !monto);
  if (!e) { box.innerHTML = ''; return; }
  const nuevo = _nuevoSueldo(_num(e.sueldo), pct, monto);
  const periodo = (document.getElementById('emp-sueldo-periodo') || {}).value || '';
  const s = sueldoDe(e.id, periodo);
  box.innerHTML = (pct || monto)
    ? '<div style="display:flex;justify-content:space-between"><span>Sueldo</span>' +
      '<span><span class="muted">' + fmtPeso(_num(e.sueldo)) + '</span> a <strong>' + fmtPeso(nuevo) + '</strong> ' +
      '<span style="color:#166534">(+' + fmtPeso(nuevo - _num(e.sueldo)) + ')</span></span></div>' +
      '<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">El aumento se fecha en <strong>' + _mesTexto(periodo) +
      '</strong>, así el ciclo de ' + RRHH_MESES_AJUSTE + ' meses arranca en ese mes.</div>' +
      (s && s.pagado
        ? '<div style="margin-top:6px;font-size:11px;color:#b45309">Este mes ya está marcado como <strong>pagado</strong>: el aumento no lo cambia. Si corresponde pagarlo en este mes, reabrí la liquidación y volvé a liquidarla.</div>'
        : (s ? '<div style="margin-top:6px;font-size:11px;color:#0369a1">La liquidación de este mes ya está cargada: se actualiza con el sueldo nuevo.</div>' : ''))
    : '<span class="muted">Cargá el % o el monto del aumento.</span>';
}

async function aplicarAjusteIndividual() {
  const e = (AppData.empleados || []).find(x => x.id === _aj1Id); if (!e) return;
  const pct = parseFloat(document.getElementById('maj1-pct')?.value) || 0;
  const monto = parseFloat(document.getElementById('maj1-monto')?.value) || 0;
  if (!pct && !monto) { alert('Cargá el % de aumento o un monto fijo.'); return; }
  const motivo = (document.getElementById('maj1-motivo')?.value || '').trim();
  const periodo = (document.getElementById('emp-sueldo-periodo') || {}).value || '';
  const anterior = _num(e.sueldo);
  const nuevo = _nuevoSueldo(anterior, pct, monto);
  if (!confirm('¿Aumentar el sueldo de ' + e.nombre + '?' + String.fromCharCode(10) +
    fmtPeso(anterior) + ' a ' + fmtPeso(nuevo) + String.fromCharCode(10) + String.fromCharCode(10) +
    'Queda en su historial, fechado en ' + _mesTexto(periodo) + '.')) return;
  const quien = (typeof currentUser !== 'undefined' && currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  const rec = { empleado_id: e.id, fecha: (periodo ? periodo + '-01' : new Date().toISOString().slice(0, 10)),
                periodo, pct, sueldo_anterior: anterior, sueldo_nuevo: nuevo, motivo, aplicado_por: quien };
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.updateWhere('empleados', 'id', e.id, { sueldo: nuevo });
    const row = await DB.insertRow('empleado_ajustes', rec);
    e.sueldo = nuevo;
    AppData.empleadoAjustes.push(Object.assign({ id: row && row.id }, rec));
    // La liquidación del mes en curso, si está cargada y NO pagada, tiene que
    // quedar con el sueldo nuevo: si no, el recibo saldría con el viejo.
    const s = sueldoDe(e.id, periodo);
    if (s && !s.pagado) {
      const nuevoTotal = nuevo + _num(s.monto_horas_extra) + _num(s.bono_eficiencia) -
        (s.descuenta_adelanto ? _num(s.monto_adelanto) : 0);
      const mT = Math.round(nuevoTotal * _num(s.pct_transferencia) / 100);
      const campos = { sueldo_base: nuevo, total: nuevoTotal, monto_transferencia: mT, monto_efectivo: nuevoTotal - mT };
      await DB.updateWhere('empleado_sueldos', 'id', s.id, campos);
      Object.assign(s, campos);
    }
    persistirEmpleadosLocal();
    document.getElementById('modal-ajuste1-backdrop').style.display = 'none';
    _aj1Id = null;
    renderSueldosPanel();
    showToast('✅ ' + e.nombre + ': ' + fmtPeso(anterior) + ' a ' + fmtPeso(nuevo));
  } catch (err) { console.warn('aplicarAjusteIndividual', err); alert('No se pudo aplicar: ' + (err.message || err)); }
}

// Con qué corte se le pagó la última vez. Es el mejor punto de partida para
// el mes nuevo: el reparto no suele cambiar de un mes al otro, pero es una
// PROPUESTA, no un dato del legajo — se confirma al liquidar.
function ultimoPctTransferencia(empId) {
  const prev = (AppData.empleadoSueldos || [])
    .filter(s => s.empleado_id === empId)
    .sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)))[0];
  return prev ? _num(prev.pct_transferencia) : 100;
}

// ── Adelantos del empleado dentro de la liquidación de sueldo ───────────────
// Un adelanto al personal se cobra acá, igual que el del conductor se cobra en
// su liquidación semanal. Tildar una cuota la imputa al mes que se está
// liquidando; destildarla la deshace. Se aplica al guardar.
let sueldoCuotasPend = {};   // { adelantoId: true|false }

// Las cuotas del mes se imputan al último día del período (YYYY-MM → DD/MM/YYYY),
// que es cuando se paga el sueldo.
function _finDeMesDMY(periodo) {
  const [y, m] = String(periodo || '').split('-').map(Number);
  if (!y || !m) return isoToDMY(hoyISO());
  const ult = new Date(y, m, 0).getDate();
  return String(ult).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y;
}
function _cuotaDelPeriodo(adelantoId, periodo) {
  const pref = '/' + String(periodo || '').slice(5, 7) + '/' + String(periodo || '').slice(0, 4);
  return (AppData.adelantoCuotas || []).find(c => c.adelanto_id === adelantoId && String(c.fecha).endsWith(pref));
}

function renderAdelantosSueldoModal(empId, periodo) {
  const wrap = document.getElementById('msld-adelantos-wrap');
  const cont = document.getElementById('msld-adelantos-lista');
  if (!wrap || !cont) return;
  sueldoCuotasPend = {};
  // Además de los vigentes, los que ya tienen una cuota imputada a este mes
  // (si no, al reabrir la liquidación de un adelanto saldado desaparecería la
  // línea que explica el descuento).
  const vigentes = adelantosActivosEmpleado(empId);
  const conCuotaDelMes = (AppData.adelantos || []).filter(a =>
    adelantoEsEmpleado(a) && a.empleado_id === empId && esAutorizado(a) &&
    !vigentes.some(v => v.id === a.id) && _cuotaDelPeriodo(a.id, periodo));
  const lista = vigentes.concat(conCuotaDelMes);

  if (!lista.length) { wrap.style.display = 'none'; cont.innerHTML = ''; return; }
  wrap.style.display = '';
  cont.innerHTML = lista.map(a => {
    const ya = _cuotaDelPeriodo(a.id, periodo);
    const usd = adelantoEsUSD(a);
    const enPesos = ya ? cuotaAdelantoARS(ya) : (usd ? adelantoARS(a, a.monto_cuota) : _num(a.monto_cuota));
    const bloqueado = enPesos == null;   // dólares sin tipo de cambio pactado
    const pagadas = cuotasPagadasDe(a.id);
    const nro = Math.min(pagadas + (ya ? 0 : 1), _num(a.cuotas_total));
    sueldoCuotasPend[a.id] = !!ya;
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border);font-size:12px;' +
        (bloqueado ? 'opacity:0.6;cursor:not-allowed' : 'cursor:pointer') + '">' +
      '<input type="checkbox" ' + (ya ? 'checked' : '') + (bloqueado ? ' disabled' : '') +
        ' onchange="marcarCuotaSueldo(' + a.id + ',this.checked)">' +
      '<span style="flex:1"><strong>Cuota ' + nro + '/' + _num(a.cuotas_total) + '</strong>' +
        '<div style="font-size:10px;color:' + (bloqueado ? '#b45309' : 'var(--text-muted)') + '">' +
          fmtMoneda(_num(a.monto_total), a.moneda) + ' en ' + _num(a.cuotas_total) + ' cuotas' +
          (usd ? ' · ' + fmtUSD(a.monto_cuota) + (bloqueado ? ' — falta el tipo de cambio (cargalo en Adelantos)' : ' a $' + _num(a.tipo_cambio).toLocaleString('es-AR')) : '') +
        '</div></span>' +
      '<strong style="white-space:nowrap">' + (bloqueado ? '—' : '-' + fmtPeso(enPesos)) + '</strong>' +
    '</label>';
  }).join('');
}
function marcarCuotaSueldo(adelantoId, marcado) {
  sueldoCuotasPend[adelantoId] = !!marcado;
  recalcSueldoModal();
}
// Suma en pesos de las cuotas tildadas en el modal.
function _totalCuotasSueldo(periodo) {
  let tot = 0;
  Object.keys(sueldoCuotasPend).forEach(idTxt => {
    if (!sueldoCuotasPend[idTxt]) return;
    const a = (AppData.adelantos || []).find(x => x.id === parseInt(idTxt));
    if (!a) return;
    const ya = _cuotaDelPeriodo(a.id, periodo);
    const enPesos = ya ? cuotaAdelantoARS(ya) : (adelantoEsUSD(a) ? adelantoARS(a, a.monto_cuota) : _num(a.monto_cuota));
    tot += _num(enPesos);
  });
  return tot;
}
// Crea o borra las cuotas según lo tildado. Se llama al guardar el sueldo.
async function aplicarCuotasSueldo(periodo) {
  const fecha = _finDeMesDMY(periodo);
  for (const idTxt of Object.keys(sueldoCuotasPend)) {
    const id = parseInt(idTxt);
    const a = (AppData.adelantos || []).find(x => x.id === id);
    if (!a) continue;
    const quiere = !!sueldoCuotasPend[idTxt];
    const ya = _cuotaDelPeriodo(id, periodo);
    if (quiere && !ya) {
      const usd = adelantoEsUSD(a);
      const enPesos = usd ? adelantoARS(a, a.monto_cuota) : _num(a.monto_cuota);
      if (enPesos == null) continue;
      const nro = cuotasPagadasDe(id) + 1;
      const rec = { adelanto_id: id, nro, monto: _num(a.monto_cuota), fecha, fecha_date: fechaISOde(fecha),
                    moneda: usd ? 'USD' : 'ARS', tipo_cambio: usd ? _num(a.tipo_cambio) : 0, monto_ars: enPesos };
      try { const row = await DB.insertRow('adelanto_cuotas', rec); AppData.adelantoCuotas.push(Object.assign({ id: row && row.id }, rec)); }
      catch (e) { console.warn('imputar cuota adelanto empleado:', e); }
    } else if (!quiere && ya) {
      try { await DB.deleteWhere('adelanto_cuotas', 'id', ya.id); AppData.adelantoCuotas = AppData.adelantoCuotas.filter(c => c.id !== ya.id); }
      catch (e) { console.warn('deshacer cuota adelanto empleado:', e); }
    }
  }
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
  document.getElementById('msld-pct-transf').value = s ? _num(s.pct_transferencia) : ultimoPctTransferencia(empId);
  document.getElementById('msld-obs').value = s ? (s.obs || '') : '';
  renderAdelantosSueldoModal(empId, periodo);
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
  const adelManual = descAd ? (parseFloat(document.getElementById('msld-adelanto').value) || 0) : 0;
  // Al descuento escrito a mano se le suman las cuotas de adelanto tildadas.
  const periodoMod = document.getElementById('emp-sueldo-periodo')?.value || '';
  const adelCuotas = _totalCuotasSueldo(periodoMod);
  const adel = adelManual + adelCuotas;
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
  return { base, horas, vh, extras, bono, descAd: adel > 0, adel, adelManual, adelCuotas, pct, total, mT, mE };
}
async function guardarSueldo(marcarPagado, conRecibo) {
  if (sueldoModalEmpId == null) return;
  const _empIdRecibo = sueldoModalEmpId;
  const periodo = document.getElementById('emp-sueldo-periodo').value;
  // Primero se imputan/deshacen las cuotas, así el registro del sueldo se
  // guarda con el mismo descuento que muestra la pantalla.
  await aplicarCuotasSueldo(periodo);
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
    // El recibo se baja DESPUÉS de guardar: así sale con lo que quedó
    // registrado y no con lo que había en pantalla.
    if (conRecibo) { try { exportReciboSueldoPDF(_empIdRecibo, periodo); } catch (err) { console.warn('recibo', err); } }
    showToast(marcarPagado ? '✅ Sueldo liquidado y marcado como pagado' : '✅ Liquidación guardada');
  } catch (e) { console.warn('guardarSueldo', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

// ════════════════════════════════════════════════════════════════════════
//  RECIBO DE LIQUIDACIÓN — el papel que se firma al momento de pagar
//
//  Es un documento que SALE de la empresa hacia una persona, igual que la
//  liquidación del cliente: se arma con la marca (src/marca.js) y con los datos
//  del emisor. El período tiene que quedar sin ninguna ambigüedad —el mes en
//  letras Y el rango de días—, los conceptos discriminados en haberes y
//  descuentos, y el corte transferencia/efectivo, que es como se paga.
//  Lleva las dos firmas: sin eso no sirve como constancia de pago.
//
//  Ojo con jsPDF y WinAnsi: los acentos y el · entran, las flechas y los
//  símbolos no. Por eso no hay ni una flecha en este papel.
// ════════════════════════════════════════════════════════════════════════
const RECIBO = { izq: 14, der: 196, ancho: 182, pieRegla: 268 };

// Último día del mes, para escribir el período sin ambigüedad.
function _finDeMesISO(periodo) {
  const [y, m] = String(periodo || '').split('-').map(Number);
  if (!y || !m) return '';
  return String(new Date(y, m, 0).getDate()).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y;
}
function _iniDeMesISO(periodo) {
  const [y, m] = String(periodo || '').split('-').map(Number);
  if (!y || !m) return '';
  return '01/' + String(m).padStart(2, '0') + '/' + y;
}

// Los datos de la liquidación, vengan de un registro guardado o del sueldo
// vigente (para poder ver el recibo antes de guardarlo).
function _datosRecibo(e, periodo) {
  const s = sueldoDe(e.id, periodo);
  const base = s ? _num(s.sueldo_base) : _num(e.sueldo);
  const horas = s ? _num(s.horas_extra) : 0;
  const vh = s ? _num(s.valor_hora_extra) : 0;
  const extras = s ? _num(s.monto_horas_extra) : 0;
  const bono = s ? _num(s.bono_eficiencia) : 0;
  const adel = s && s.descuenta_adelanto ? _num(s.monto_adelanto) : 0;
  const total = s ? _num(s.total) : base;
  const pct = s ? _num(s.pct_transferencia) : ultimoPctTransferencia(e.id);
  const mT = s ? _num(s.monto_transferencia) : Math.round(total * pct / 100);
  const mE = s ? _num(s.monto_efectivo) : total - Math.round(total * pct / 100);
  return { s, base, horas, vh, extras, bono, adel, total, pct, mT, mE,
           obs: (s && s.obs) || '', pagado: !!(s && s.pagado) };
}

function _reciboEncabezado(doc, ctx) {
  const L = RECIBO.izq, R = RECIBO.der;
  try { doc.addImage(MARCA.logo, 'PNG', L, 12, 44, 44 / MARCA.logoRatio); } catch (err) {}
  _pdfTexto(doc, MARCA.navy); doc.setFont(undefined, 'bold'); doc.setFontSize(12.5);
  doc.text('RECIBO DE LIQUIDACIÓN DE SUELDO', R, 16.5, { align: 'right' });
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); _pdfTexto(doc, MARCA.gris);
  doc.text('N° ' + ctx.numero, R, 21.5, { align: 'right' });
  doc.text('Emitido el ' + ctx.emitido, R, 25.5, { align: 'right' });
  _pdfRelleno(doc, MARCA.navy); doc.rect(L, 29.5, RECIBO.ancho, 1.1, 'F');
  _pdfRelleno(doc, MARCA.azul); doc.rect(L, 29.5, 46, 1.1, 'F');
}

function _reciboFichas(doc, ctx) {
  const L = RECIBO.izq, W = 87, X2 = 109, Y = 35, H = 26;
  _pdfRelleno(doc, MARCA.azulPapel);
  doc.roundedRect(L, Y, W, H, 1.6, 1.6, 'F');
  doc.roundedRect(X2, Y, W, H, 1.6, 1.6, 'F');
  const ficha = (rotulo, titulo, lineas, x) => {
    _pdfTexto(doc, MARCA.azul); doc.setFont(undefined, 'bold'); doc.setFontSize(6.5);
    doc.text(_recorte(doc, rotulo, W - 10), x + 5, Y + 5.8);
    _pdfTexto(doc, MARCA.navy); doc.setFontSize(10);
    doc.text(_recorte(doc, titulo, W - 10), x + 5, Y + 12);
    doc.setFont(undefined, 'normal'); doc.setFontSize(7.5); _pdfTexto(doc, MARCA.texto);
    let ly = Y + 17;
    lineas.filter(Boolean).slice(0, 3).forEach(t => { doc.text(_recorte(doc, t, W - 10), x + 5, ly); ly += 3.9; });
  };
  ficha('EMPLEADO', ctx.nombre, ctx.datosEmp, L);
  ficha('PERÍODO LIQUIDADO', ctx.periodoTxt, ctx.datosPer, X2);
}

function _reciboPie(doc, ctx) {
  const L = RECIBO.izq, R = RECIBO.der, Y = RECIBO.pieRegla;
  // Las dos firmas: es lo que convierte el papel en constancia de pago.
  _pdfTrazo(doc, MARCA.linea); doc.setLineWidth(0.3);
  doc.line(L + 6, Y - 4, L + 76, Y - 4);
  doc.line(R - 76, Y - 4, R - 6, Y - 4);
  doc.setFont(undefined, 'normal'); doc.setFontSize(7.5); _pdfTexto(doc, MARCA.gris);
  doc.text('Firma del empleado', L + 41, Y, { align: 'center' });
  doc.text('Por ' + (empresaDato('empresa_razon') || empresaNombre()), R - 41, Y, { align: 'center' });
  doc.setFontSize(6.5);
  doc.text('Aclaración y DNI', L + 41, Y + 3.5, { align: 'center' });
  doc.text('Firma y sello', R - 41, Y + 3.5, { align: 'center' });

  _pdfTrazo(doc, MARCA.linea); doc.setLineWidth(0.2); doc.line(L, Y + 9, R, Y + 9);
  const fiscal = empresaLineaFiscal(), contacto = empresaLineaContacto();
  doc.setFont(undefined, 'bold'); doc.setFontSize(7); _pdfTexto(doc, MARCA.navy);
  if (fiscal) doc.text(doc.splitTextToSize(fiscal, 140)[0], L, Y + 13.5);
  doc.setFont(undefined, 'normal'); _pdfTexto(doc, MARCA.gris);
  if (contacto) doc.text(doc.splitTextToSize(contacto, 140)[0], L, Y + 17);
  doc.setFontSize(6.5);
  doc.text('Constancia interna de pago. No reemplaza al recibo de sueldo de ley.', L, Y + 20.5);
  doc.setFontSize(7.5);
  doc.text('Recibo ' + ctx.numero, R, Y + 13.5, { align: 'right' });
}

// Recibo de UN empleado. opts.doc encadena varios en un solo archivo.
function exportReciboSueldoPDF(empId, periodo, opts) {
  opts = opts || {};
  const e = (AppData.empleados || []).find(x => x.id === empId);
  if (!e) return;
  periodo = periodo || (document.getElementById('emp-sueldo-periodo') || {}).value || '';
  const d = _datosRecibo(e, periodo);
  const { jsPDF } = window.jspdf;
  const doc = opts.doc || new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  if (opts.doc && opts.nuevaPagina) doc.addPage();

  const ctx = {
    nombre: e.nombre,
    numero: 'LH-SUE-' + String(e.id) + '-' + String(periodo || '').replace('-', ''),
    emitido: _fechaCorta(new Date()),
    periodoTxt: _mesTexto(periodo),
    datosEmp: [
      (e.puesto || '') + (e.area ? '  ·  ' + e.area : ''),
      (e.dni ? 'DNI ' + e.dni : '') + (e.registrado === false ? (e.dni ? '  ·  ' : '') + 'No registrado' : ''),
      'Ingreso ' + _empFmt(e.fecha_ingreso) + '  ·  ' + antiguedadTexto(e)
    ],
    datosPer: [
      'Del ' + _iniDeMesISO(periodo) + ' al ' + _finDeMesISO(periodo),
      'Pago: ' + d.pct + '% transferencia  ·  ' + (100 - d.pct) + '% efectivo',
      d.pagado ? 'Abonado' : 'Pendiente de pago'
    ]
  };
  _reciboEncabezado(doc, ctx);
  _reciboFichas(doc, ctx);

  // ── Conceptos ────────────────────────────────────────────────────────────
  const body = [];
  body.push(['Sueldo básico', _mesTexto(periodo), fmtPeso(d.base), '']);
  if (d.extras) body.push(['Horas extras', d.horas + ' h x ' + fmtPeso(d.vh), fmtPeso(d.extras), '']);
  if (d.bono) body.push(['Bono de eficiencia', '', fmtPeso(d.bono), '']);
  if (d.adel) body.push(['Adelanto descontado', 'a cuenta de haberes', '', fmtPeso(d.adel)]);

  doc.autoTable({
    startY: 66,
    head: [['Concepto', 'Detalle', 'Haberes', 'Descuentos']],
    body: body,
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 2.6, bottom: 2.6, left: 3, right: 3 }, lineWidth: 0 },
    headStyles: { fillColor: MARCA.navy, textColor: 255, fontSize: 8, fontStyle: 'bold', cellPadding: { top: 3, bottom: 3, left: 3, right: 3 } },
    bodyStyles: { textColor: MARCA.texto },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { cellWidth: 'auto' }, 1: { cellWidth: 46 },
      2: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      3: { cellWidth: 30, halign: 'right', textColor: [185, 28, 28] }
    },
    margin: { left: RECIBO.izq, right: RECIBO.izq, top: 25, bottom: 40 }
  });

  let y = doc.lastAutoTable.finalY + 8;

  // Totales a la derecha
  const RX = 112;
  let ty = y + 3;
  const renglon = (lab, val, col) => {
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.5); _pdfTexto(doc, MARCA.gris);
    doc.text(lab, RX, ty);
    _pdfTexto(doc, col || MARCA.texto);
    doc.text(val, RECIBO.der, ty, { align: 'right' });
    ty += 5.4;
  };
  renglon('Total haberes', fmtPeso(d.base + d.extras + d.bono));
  if (d.adel) renglon('Total descuentos', '-' + fmtPeso(d.adel), [185, 28, 28]);
  _pdfTrazo(doc, MARCA.linea); doc.setLineWidth(0.2); doc.line(RX, ty - 3.2, RECIBO.der, ty - 3.2);
  _pdfRelleno(doc, MARCA.navy); doc.roundedRect(RX, ty, 84, 15, 1.8, 1.8, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont(undefined, 'bold'); doc.setFontSize(7.5);
  doc.text('NETO A COBRAR', RX + 5, ty + 5.5);
  doc.setFontSize(15);
  doc.text(fmtPeso(d.total), RECIBO.der - 5, ty + 11.8, { align: 'right' });

  // Forma de pago + observaciones, a la izquierda
  _pdfTexto(doc, MARCA.azul); doc.setFont(undefined, 'bold'); doc.setFontSize(6.5);
  doc.text('FORMA DE PAGO', RECIBO.izq, y + 3);
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); _pdfTexto(doc, MARCA.texto);
  let ly = y + 8;
  doc.text('Transferencia (' + d.pct + '%): ' + fmtPeso(d.mT), RECIBO.izq, ly); ly += 4.6;
  doc.text('Efectivo (' + (100 - d.pct) + '%): ' + fmtPeso(d.mE), RECIBO.izq, ly); ly += 4.6;
  if (empresaDato('empresa_pago')) {
    _pdfTexto(doc, MARCA.gris); doc.setFontSize(7);
    doc.splitTextToSize(empresaDato('empresa_pago'), 90).forEach(t => { doc.text(t, RECIBO.izq, ly); ly += 3.6; });
  }
  if (d.obs) {
    ly += 2;
    _pdfTexto(doc, MARCA.azul); doc.setFont(undefined, 'bold'); doc.setFontSize(6.5);
    doc.text('OBSERVACIONES', RECIBO.izq, ly); ly += 4.5;
    doc.setFont(undefined, 'normal'); doc.setFontSize(7.5); _pdfTexto(doc, MARCA.texto);
    doc.splitTextToSize(d.obs, 90).slice(0, 4).forEach(t => { doc.text(t, RECIBO.izq, ly); ly += 3.9; });
  }

  _reciboPie(doc, ctx);
  if (opts.doc) return doc;
  doc.save('Recibo_' + String(e.nombre).replace(/\s+/g, '_') + '_' + String(periodo).replace('-', '-') + '.pdf');
}

// Todos los recibos del mes en un solo archivo, uno por página: es lo que se
// imprime el día del pago para que cada uno firme el suyo.
function exportRecibosDelMes() {
  const periodo = (document.getElementById('emp-sueldo-periodo') || {}).value || '';
  const lista = (AppData.empleados || []).filter(e => e.activo !== false && sueldoDe(e.id, periodo))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  if (!lista.length) { alert('Todavía no hay ninguna liquidación cargada en ' + _mesTexto(periodo) + '.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  lista.forEach((e, i) => exportReciboSueldoPDF(e.id, periodo, { doc, nuevaPagina: i > 0 }));
  doc.save('Recibos_' + String(periodo) + '.pdf');
  showToast('📄 ' + lista.length + ' recibo(s) en un solo PDF');
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
    const pct = s ? _num(s.pct_transferencia) : ultimoPctTransferencia(e.id);
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
