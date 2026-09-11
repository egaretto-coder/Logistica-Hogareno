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

// ── Política de la empresa: corridas vs salteadas ───────────────────────────
// Los días del art. 150 son CORRIDOS: incluyen sábados y domingos. La empresa
// exige que los primeros 7 se tomen de una vez, y el resto queda a elección:
// corrido o salteado. Tomarlos salteados no gasta los fines de semana, así que
// el mismo bloque de 7 corridos rinde 5 días salteados.
//
// Sin esta distinción el saldo daba mal: a quien tomó 7 corridos + 2 salteados
// le figuraban 5 pendientes cuando le quedan 3 (de los 5 salteados que valía su
// segundo bloque, usó 2).
const VAC_BLOQUE_OBLIG = 7;     // días corridos que van sí o sí juntos

// Días de trabajo por semana del empleado (los del panel Empleados). Es lo que
// decide la equivalencia: un bloque de 7 corridos rinde 5 salteados si trabaja
// de lunes a viernes, y 6 si trabaja de lunes a sábados — solo se "gastan" los
// días que iba a trabajar. Sin jornada cargada se asume la semana de 5.
function vacDiasTrabajaSemana(emp) {
  const d = _num(emp && emp.dias_laborales);
  if (!d || d < 1) return 5;
  return Math.min(7, d);
}
// Cuántos días SALTEADOS rinde un tramo de días corridos, para ESE empleado.
function vacCorridosASalteados(corridos, emp) {
  return Math.round(_num(corridos) * vacDiasTrabajaSemana(emp) / VAC_BLOQUE_OBLIG);
}
// "5 de cada 7" / "6 de cada 7", para poder explicarlo en pantalla.
function vacEquivalenciaTexto(emp) {
  const d = vacDiasTrabajaSemana(emp);
  return d + ' de cada ' + VAC_BLOQUE_OBLIG + (d === 7 ? '' : ' (trabaja ' + (typeof diasLaboralesTexto === 'function'
    ? String(diasLaboralesTexto(emp)).toLowerCase() : d + ' días por semana') + ')');
}
function vacEsSalteada(v) { return v && v.modalidad === 'salteada'; }

// ── Saldo por empleado y período ────────────────────────────────────────────
function vacacionesDe(empId, periodo) {
  return (AppData.vacaciones || []).filter(v => v.empleado_id === empId &&
    (periodo == null || _num(v.periodo) === _num(periodo)));
}
function vacTomados(empId, periodo) {
  return vacacionesDe(empId, periodo).filter(vacCuenta).reduce((s, v) => s + _num(v.dias), 0);
}

// El saldo se lleva en las DOS monedas porque el que queda depende de cómo se
// tome: lo que resta puede ser N corridos o los mismos días en salteados.
//   corridos      días del bloque obligatorio + cualquier otro bloque corrido
//   salteados     días sueltos ya tomados
//   obligPendiente  cuánto falta del bloque de 7 que va sí o sí
//   restoCorridos / restoSalteados  lo que queda, en cada moneda
function vacSaldo(emp, periodo) {
  const c = vacCorresponden(emp, periodo);
  const lics = vacacionesDe(emp.id, periodo).filter(vacCuenta);
  const corridos = lics.filter(v => !vacEsSalteada(v)).reduce((s, v) => s + _num(v.dias), 0);
  const salteados = lics.filter(vacEsSalteada).reduce((s, v) => s + _num(v.dias), 0);
  const tomados = corridos + salteados;

  // Con menos de 7 días (art. 153, quien entró a mitad de año) no hay bloque
  // obligatorio que imponer: se toman como se puedan.
  const oblig = Math.min(VAC_BLOQUE_OBLIG, c.dias);
  const obligPendiente = Math.max(0, oblig - corridos);
  const corridosExtra = Math.max(0, corridos - oblig);
  const restoCorridos = Math.max(0, c.dias - oblig - corridosExtra);
  const restoSalteados = Math.max(0, vacCorridosASalteados(restoCorridos, emp) - salteados);
  // Una vez que empezó a tomarlos salteados, lo que queda se cuenta así; si
  // todavía no eligió, se muestra en corridos (que es como los da la ley).
  const modoResto = salteados > 0 ? 'salteada' : (corridosExtra > 0 ? 'corrida' : '');
  const pendientes = obligPendiente + (modoResto === 'salteada' ? restoSalteados : restoCorridos);

  return {
    corresponden: c.dias, base: c.base, detalle: c.detalle,
    tomados, corridos, salteados,
    oblig, obligPendiente, obligCubierto: obligPendiente === 0 && oblig > 0,
    restoCorridos, restoSalteados, modoResto, pendientes,
    diasSemana: vacDiasTrabajaSemana(emp), equivalencia: vacEquivalenciaTexto(emp)
  };
}

// Cómo se lee el saldo en una línea. El número solo no alcanza: "le quedan 3"
// no significa lo mismo si son corridos o salteados.
function vacSaldoTexto(s) {
  if (!s.corresponden) return '';
  const partes = [];
  if (s.obligPendiente > 0) {
    partes.push('le falta el bloque obligatorio de ' + s.obligPendiente + ' día' + (s.obligPendiente === 1 ? '' : 's') + ' corrido' + (s.obligPendiente === 1 ? '' : 's'));
  } else if (s.oblig > 0) {
    partes.push('bloque obligatorio de ' + s.oblig + ' días corridos cumplido');
  }
  if (s.restoCorridos > 0 || s.restoSalteados > 0) {
    partes.push(s.modoResto === 'salteada'
      ? 'le quedan ' + s.restoSalteados + ' día' + (s.restoSalteados === 1 ? '' : 's') + ' salteado' + (s.restoSalteados === 1 ? '' : 's')
      : 'el resto son ' + s.restoCorridos + ' corridos o ' + s.restoSalteados + ' salteados (' + s.diasSemana + ' de cada 7)');
  } else if (!s.obligPendiente) {
    partes.push('sin días pendientes');
  }
  return partes.join(' · ');
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
  // El aviso de cargas repetidas va arriba de las solapas: tiene que verse desde
  // cualquiera, y esta función es la que corre después de cada cambio.
  renderVacRepetidas();
  ['saldos', 'calendario', 'historial', 'licencias', 'extras'].forEach(t => {
    const panel = document.getElementById('vac-tab-' + t);
    const btn = document.getElementById('vac-btn-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'saldos') renderVacSaldos();
  else if (tab === 'calendario') renderVacCalendario();
  else if (tab === 'extras') renderHorasExtra();
  else if (tab === 'licencias') renderLicencias();
  else renderVacHistorial();
}

// ════════════════════════════════════════════════════════════════════════
//  HORAS EXTRAS
//  Se registran el día que se hacen. La liquidación mensual las TRAE de acá
//  sumadas por mes y el valor de la hora sale del horario del empleado, así
//  que el mismo dato no se escribe dos veces ni se estima de memoria.
// ════════════════════════════════════════════════════════════════════════
const _DIAS_SEM_HS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function _hsMesActivo() {
  const el = document.getElementById('vac-hs-mes');
  if (el && !el.value) el.value = new Date().toISOString().slice(0, 7);
  return (el && el.value) || new Date().toISOString().slice(0, 7);
}

// Todas las horas extras de un empleado en un mes (AAAA-MM).
function horasExtraDe(empId, periodo) {
  const p = String(periodo || '').slice(0, 7);
  return (AppData.empleadoHorasExtra || [])
    .filter(h => h.empleado_id === empId && String(h.fecha).slice(0, 7) === p)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}
// Cuántas horas suman. Es lo que la liquidación trae del mes.
function horasExtraDelMes(empId, periodo) {
  return Math.round(horasExtraDe(empId, periodo).reduce((s, h) => s + _num(h.horas), 0) * 100) / 100;
}

function renderHorasExtra() {
  const cont = document.getElementById('vac-hs-rows');
  if (!cont) return;
  const periodo = _hsMesActivo();
  const q = (document.getElementById('vac-hs-search')?.value || '').toLowerCase().trim();
  const empDe = id => (AppData.empleados || []).find(e => e.id === id);

  const filas = (AppData.empleadoHorasExtra || [])
    .filter(h => String(h.fecha).slice(0, 7) === periodo)
    .map(h => ({ h, e: empDe(h.empleado_id) }))
    .filter(x => x.e && (!q || String(x.e.nombre).toLowerCase().includes(q)))
    .sort((a, b) => String(b.h.fecha).localeCompare(String(a.h.fecha)) || String(a.e.nombre).localeCompare(String(b.e.nombre)));

  const totHoras = filas.reduce((s, x) => s + _num(x.h.horas), 0);
  const totImporte = filas.reduce((s, x) => s + _num(x.h.horas) * (typeof valorHoraDe === 'function' ? valorHoraDe(x.e) : 0), 0);
  const nEmp = new Set(filas.map(x => x.e.id)).size;

  const info = document.getElementById('vac-hs-info');
  if (info) info.textContent = filas.length + ' registro(s) en ' + (typeof _mesTexto === 'function' ? _mesTexto(periodo) : periodo);

  const tot = document.getElementById('vac-hs-total');
  if (tot) tot.innerHTML =
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-calendar"></i></div><div class="metric-label">Horas extras del mes</div>' +
      '<div class="metric-value">' + (Math.round(totHoras * 100) / 100) + '</div><div class="metric-sub">' + nEmp + ' empleado(s)</div></div>' +
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Costo estimado</div>' +
      '<div class="metric-value">' + fmtPeso(totImporte) + '</div><div class="metric-sub">al valor hora de cada uno, sin recargo</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-file"></i></div><div class="metric-label">Se liquidan en</div>' +
      '<div class="metric-value" style="font-size:18px">' + (typeof _mesTexto === 'function' ? _mesTexto(periodo) : periodo) + '</div>' +
      '<div class="metric-sub">Empleados → Liquidación mensual</div></div>';

  if (!filas.length) {
    cont.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:30px">' +
      '<div class="empty-icon"><i class="ic ic-calendar"></i></div>' +
      '<div class="empty-title">Sin horas extras en ' + (typeof _mesTexto === 'function' ? _mesTexto(periodo) : periodo) + '</div>' +
      '<div class="empty-sub">Cargalas cuando pasan: al liquidar el mes se traen solas</div></div></td></tr>';
    return;
  }

  cont.innerHTML = filas.map(({ h, e }) => {
    const vh = (typeof valorHoraDe === 'function') ? valorHoraDe(e) : 0;
    const d = new Date(String(h.fecha) + 'T12:00:00');
    const dow = isNaN(d.getTime()) ? '' : _DIAS_SEM_HS[d.getDay()];
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(e.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(e.nombre) + '</div>' +
        '<div><strong>' + e.nombre + '</strong><div class="muted" style="font-size:10px">' + (e.puesto || '') + '</div></div></div></td>' +
      '<td style="font-size:12px">' + (typeof _empFmt === 'function' ? _empFmt(h.fecha) : h.fecha) +
        '<div class="muted" style="font-size:10px">' + dow + '</div></td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + (_num(h.horas)) + '</td>' +
      '<td class="mono" style="text-align:right">' + (vh ? fmtPeso(vh) : '<span class="muted" style="font-size:10.5px">sin horario</span>') + '</td>' +
      '<td class="mono" style="text-align:right">' + (vh ? fmtPeso(_num(h.horas) * vh) : '—') + '</td>' +
      '<td style="font-size:11.5px">' + (h.motivo || '<span class="muted">—</span>') +
        (h.creado_por ? '<div class="muted" style="font-size:10px">' + h.creado_por + '</div>' : '') + '</td>' +
      '<td style="text-align:right"><button class="btn btn-sm" style="padding:3px 7px;font-size:10px;border-color:#fca5a5;color:#b91c1c" onclick="borrarHoraExtra(' + h.id + ')" title="Quitar este registro"><i class="ic ic-trash"></i></button></td>' +
    '</tr>';
  }).join('');
}

// ── Alta ────────────────────────────────────────────────────────────────
function abrirHoraExtra(empId) {
  const sel = document.getElementById('mhse-empleado');
  if (sel) {
    const activos = (AppData.empleados || []).filter(e => e.activo !== false)
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    sel.innerHTML = '<option value="">— Elegí un empleado —</option>' +
      activos.map(e => '<option value="' + e.id + '">' + e.nombre + (e.puesto ? ' · ' + e.puesto : '') + '</option>').join('');
    if (empId) sel.value = String(empId);
  }
  const f = document.getElementById('mhse-fecha');
  if (f) {
    // Por defecto, un día del mes que se está mirando: lo normal es cargar
    // algo que pasó en ese mes, no hoy.
    const p = _hsMesActivo();
    const hoy = new Date().toISOString().slice(0, 10);
    f.value = hoy.slice(0, 7) === p ? hoy : (p + '-01');
  }
  const h = document.getElementById('mhse-horas'); if (h) h.value = '';
  const m = document.getElementById('mhse-motivo'); if (m) m.value = '';
  recalcHoraExtra();
  document.getElementById('modal-hsextra-backdrop').style.display = 'flex';
}

function cerrarHoraExtra(e) {
  if (!e || e.target.id === 'modal-hsextra-backdrop') {
    document.getElementById('modal-hsextra-backdrop').style.display = 'none';
  }
}

function recalcHoraExtra() {
  const box = document.getElementById('mhse-preview');
  const btn = document.getElementById('mhse-guardar');
  if (!box) return;
  const id = parseInt(document.getElementById('mhse-empleado')?.value, 10) || 0;
  const fecha = document.getElementById('mhse-fecha')?.value || '';
  const horas = parseFloat(document.getElementById('mhse-horas')?.value) || 0;
  const e = (AppData.empleados || []).find(x => x.id === id);
  if (btn) btn.disabled = !(e && fecha && horas > 0);
  if (!e || !fecha || !(horas > 0)) {
    box.innerHTML = '<span class="muted">Elegí el empleado, la fecha y cuántas horas.</span>';
    return;
  }
  const vh = (typeof valorHoraDe === 'function') ? valorHoraDe(e) : 0;
  const d = new Date(fecha + 'T12:00:00');
  const dow = isNaN(d.getTime()) ? '' : _DIAS_SEM_HS[d.getDay()];
  const yaMes = horasExtraDelMes(e.id, fecha.slice(0, 7));
  box.innerHTML =
    '<div><strong>' + horas + ' h</strong> el ' + (typeof _empFmt === 'function' ? _empFmt(fecha) : fecha) + ' (' + dow + ')</div>' +
    (vh
      ? '<div style="margin-top:3px">Al valor de su hora (' + fmtPeso(vh) + ') son <strong>' + fmtPeso(horas * vh) + '</strong> ' +
        '<span class="muted">sin recargo; el recargo se aplica al liquidar</span></div>'
      : '<div style="margin-top:3px;color:#b45309">No tiene horario cargado, así que todavía no se puede calcular el valor de su hora.</div>') +
    '<div style="margin-top:5px;font-size:11px;color:var(--text-muted)">Con esta carga, ' + e.nombre + ' queda con <strong>' +
      (Math.round((yaMes + horas) * 100) / 100) + ' h</strong> en ' + (typeof _mesTexto === 'function' ? _mesTexto(fecha.slice(0, 7)) : fecha.slice(0, 7)) +
      '. Se traen solas al liquidar ese mes.</div>';
}

async function guardarHoraExtra() {
  const id = parseInt(document.getElementById('mhse-empleado')?.value, 10) || 0;
  const fecha = document.getElementById('mhse-fecha')?.value || '';
  const horas = parseFloat(document.getElementById('mhse-horas')?.value) || 0;
  const motivo = (document.getElementById('mhse-motivo')?.value || '').trim();
  const e = (AppData.empleados || []).find(x => x.id === id);
  if (!e) { alert('Elegí un empleado.'); return; }
  if (!fecha) { alert('Cargá la fecha en que se hicieron.'); return; }
  if (!(horas > 0)) { alert('Cargá cuántas horas.'); return; }
  const quien = (typeof currentUser !== 'undefined' && currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  const rec = { empleado_id: id, fecha, horas, motivo, creado_por: quien };
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    const row = await DB.insertRow('empleado_horas_extra', rec);
    AppData.empleadoHorasExtra.push(Object.assign({ id: row && row.id }, rec));
    if (typeof persistirEmpleadosLocal === 'function') persistirEmpleadosLocal();
    document.getElementById('modal-hsextra-backdrop').style.display = 'none';
    renderHorasExtra();
    showToast('✅ ' + horas + ' h extras de ' + e.nombre + ' · se liquidan en ' +
      (typeof _mesTexto === 'function' ? _mesTexto(String(fecha).slice(0, 7)) : String(fecha).slice(0, 7)));
  } catch (err) { console.warn('guardarHoraExtra', err); alert('No se pudo guardar: ' + (err.message || err)); }
}

async function borrarHoraExtra(id) {
  const h = (AppData.empleadoHorasExtra || []).find(x => x.id === id);
  if (!h) return;
  const e = (AppData.empleados || []).find(x => x.id === h.empleado_id);
  if (!confirm('¿Quitar las ' + _num(h.horas) + ' h del ' + (typeof _empFmt === 'function' ? _empFmt(h.fecha) : h.fecha) +
    (e ? ' de ' + e.nombre : '') + '?')) return;
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.deleteWhere('empleado_horas_extra', 'id', id);
    AppData.empleadoHorasExtra = AppData.empleadoHorasExtra.filter(x => x.id !== id);
    if (typeof persistirEmpleadosLocal === 'function') persistirEmpleadosLocal();
    renderHorasExtra();
    showToast('Registro quitado');
  } catch (err) { console.warn('borrarHoraExtra', err); alert('No se pudo quitar: ' + (err.message || err)); }
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
      return '<span class="tag" style="background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.borde + ';font-size:10.5px" ' +
        'title="' + (vacEsSalteada(v) ? 'Días salteados: no gastan el fin de semana' : 'Bloque corrido: incluye sábados y domingos') + '">' +
        vacFmt(v.fecha_desde) + ' → ' + vacFmt(v.fecha_hasta) + ' · ' + v.dias + 'd ' +
        (vacEsSalteada(v) ? '<span style="opacity:.75">salt.</span>' : '<span style="opacity:.75">corr.</span>') + '</span>';
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
      '<div style="font-size:10.5px;color:var(--text-muted);margin-bottom:6px">' + s.detalle + '</div>' +
      // La política: por qué el pendiente es el que es. "Le quedan 3" no
      // significa lo mismo si son corridos o salteados, y el número solo no
      // deja reconstruir de dónde salió.
      (s.corresponden
        ? '<div style="font-size:10.5px;background:var(--surface-0);border:1px solid var(--border);border-radius:7px;padding:6px 9px;margin-bottom:8px">' +
          (s.obligCubierto
            ? '<span style="color:#166534">✓ Bloque de ' + s.oblig + ' días corridos cumplido</span>'
            : (s.oblig ? '<span style="color:#b45309">Faltan ' + s.obligPendiente + ' día(s) del bloque de ' + s.oblig + ' corridos (van juntos)</span>' : '')) +
          (s.restoCorridos > 0 || s.restoSalteados > 0
            ? '<div style="margin-top:2px">Resto: <strong>' + s.restoSalteados + ' salteados</strong>' +
              (s.modoResto === 'salteada' ? ' <span class="muted">(ya tomó ' + s.salteados + ')</span>' : ' o <strong>' + s.restoCorridos + ' corridos</strong>') +
              '<div class="muted" style="font-size:9.5px">salteados rinden ' + s.equivalencia + '</div></div>'
            : '<div style="margin-top:2px;color:#166534">Sin días pendientes</div>') +
          '</div>'
        : '') +
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

  // Las LICENCIAS (matrimonio, enfermedad…) también dejan a alguien afuera: el
  // calendario está para ver la superposición, y quien está enfermo falta
  // igual que quien está de vacaciones.
  const licMes = (AppData.empleadoLicencias || []).filter(l =>
    _vacFecha(l.fecha_desde) <= ultimo && _vacFecha(l.fecha_hasta) >= primero);

  const activos = (AppData.empleados || []).filter(e => e.activo !== false).length;
  // Se cuentan PERSONAS, no registros: alguien con vacaciones y una licencia
  // el mismo día (casi siempre, una carga doble) es una sola persona afuera.
  const afuera = Array.from({ length: nDias + 1 }, () => new Set());
  delMes.concat(licMes).forEach(v => {
    const a = _vacFecha(v.fecha_desde), b = _vacFecha(v.fecha_hasta);
    for (let d = 1; d <= nDias; d++) {
      const f = new Date(anio, mes - 1, d, 12);
      if (f >= a && f <= b) afuera[d].add(v.empleado_id);
    }
  });
  const porDia = afuera.map(s => s.size);
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
    grid += '<div title="' + d + '/' + mes + ': ' + n + ' afuera (vacaciones o licencias)" style="border:1px solid var(--border);border-radius:6px;padding:4px 2px;text-align:center;' +
      'background:' + bg + ';opacity:' + (dom ? '.55' : '1') + '">' +
      '<div style="font-size:9px;color:' + fgTenue + '">' + DOW[f.getDay()] + '</div>' +
      '<div style="font-size:12px;font-weight:600;color:' + fg + '">' + d + '</div>' +
      '<div style="font-size:10px;font-weight:700;color:' + (n ? '#7c2d12' : 'var(--text-muted)') + '">' + (n || '·') + '</div>' +
      '</div>';
  }

  const repVac = _vacIdsRepetidas();
  const filas = delMes.map(v => {
    const e = empleadoDeVac(v.empleado_id);
    const st = VAC_ESTADOS[v.estado] || VAC_ESTADOS.planificada;
    return '<tr>' +
      '<td><strong>' + _vacNombre(v.empleado_id) + '</strong>' +
        (repVac.has(v.id) ? ' <span class="tag" title="Hay otra carga de este empleado para las mismas fechas" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-size:9.5px">repetida</span>' : '') +
        (e && e.area ? '<div style="font-size:10.5px;color:var(--text-muted)">' + e.area + '</div>' : '') + '</td>' +
      '<td>' + vacFmt(v.fecha_desde) + ' → ' + vacFmt(v.fecha_hasta) + '</td>' +
      '<td style="text-align:right"><strong>' + v.dias + '</strong>' + '<div class="muted" style="font-size:9.5px">' + (vacEsSalteada(v) ? 'salteados' : 'corridos') + '</div></td>' +
      '<td>' + v.periodo + '</td>' +
      '<td><span class="tag" style="background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.borde + '">' + st.label + '</span></td>' +
      // La papelera también acá: el Calendario muestra el mes en curso, que es
      // donde se ve la carga de más, y antes solo tenía el lápiz.
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" title="Editar" onclick="openVacModal(' + v.id + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" title="Borrar esta carga" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarVacacion(' + v.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');

  const filasLic = licMes.slice().sort((a, b) => String(a.fecha_desde).localeCompare(String(b.fecha_desde))).map(l => {
    const e = empleadoDeVac(l.empleado_id);
    return '<tr>' +
      '<td><strong>' + _vacNombre(l.empleado_id) + '</strong>' +
        (e && e.area ? '<div style="font-size:10.5px;color:var(--text-muted)">' + e.area + '</div>' : '') + '</td>' +
      '<td>' + vacFmt(l.fecha_desde) + ' → ' + vacFmt(l.fecha_hasta) + '</td>' +
      '<td style="text-align:right"><strong>' + _num(l.dias) + '</strong><div class="muted" style="font-size:9.5px">corridos</div></td>' +
      '<td>—</td>' +
      '<td><span class="tag" style="background:#f5f3ff;color:#5b21b6;border:1px solid #ddd6fe">Licencia · ' + licTipo(l.tipo).label + '</span></td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" title="Editar" onclick="openLicenciaModal(' + l.id + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" title="Borrar" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarLicencia(' + l.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');

  cont.innerHTML =
    '<div class="card" style="margin-bottom:14px"><div class="card-header">' +
      '<span class="card-title">' + nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1) + '</span>' +
      '<span style="font-size:11px;color:var(--text-muted)">' +
        (pico ? 'Pico: ' + pico + ' de ' + activos + ' persona(s) afuera el mismo día' : 'Nadie afuera este mes') +
      '</span></div>' +
      '<div class="card-body"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:4px">' + grid + '</div>' +
      '<div style="font-size:10.5px;color:var(--text-muted);margin-top:8px">El número es cuánta gente está afuera ese día, de vacaciones o de licencia. ' +
      'Los domingos van atenuados: los días son <strong>corridos</strong>, así que cuentan igual.</div></div></div>' +
    ((delMes.length || licMes.length)
      ? '<div class="card"><div class="table-wrap"><table><thead><tr>' +
        '<th>Empleado</th><th>Período</th><th style="text-align:right">Días</th><th>Corresponde a</th><th>Estado</th><th></th>' +
        '</tr></thead><tbody>' + filas + filasLic + '</tbody></table></div></div>'
      : '<div class="empty-state"><div class="empty-icon"><i class="ic ic-calendar"></i></div>' +
        '<div class="empty-title">Nadie afuera en el mes</div>' +
        '<div class="empty-sub">Las vacaciones se cargan desde Saldos y las licencias desde su solapa</div></div>');
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

  const repVac = _vacIdsRepetidas();
  body.innerHTML = lista.map(v => {
    const e = empleadoDeVac(v.empleado_id);
    const st = VAC_ESTADOS[v.estado] || VAC_ESTADOS.planificada;
    return '<tr' + (e && e.activo === false ? ' style="opacity:.6"' : '') + '>' +
      '<td><strong>' + _vacNombre(v.empleado_id) + '</strong>' +
        (e && e.activo === false ? ' <span class="tag" style="background:#fef2f2;color:#991b1b;font-size:9.5px">baja</span>' : '') +
        (repVac.has(v.id) ? ' <span class="tag" title="Hay otra carga de este empleado para las mismas fechas" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-size:9.5px">repetida</span>' : '') + '</td>' +
      '<td>' + vacFmt(v.fecha_desde) + '</td>' +
      '<td>' + vacFmt(v.fecha_hasta) + '</td>' +
      '<td style="text-align:right"><strong>' + v.dias + '</strong>' + '<div class="muted" style="font-size:9.5px">' + (vacEsSalteada(v) ? 'salteados' : 'corridos') + '</div></td>' +
      '<td>' + v.periodo + '</td>' +
      '<td><span class="tag" style="background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.borde + '">' + st.label + '</span>' +
        (v.obs ? '<div style="font-size:10.5px;color:var(--text-muted)">' + v.obs + '</div>' : '') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" title="Editar" onclick="openVacModal(' + v.id + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" title="Borrar esta carga" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarVacacion(' + v.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════
//  MODAL — cargar / editar una licencia
// ════════════════════════════════════════════════════════════════════════
let vacEditId = null;
// Guardado en curso: ver guardarVacacion.
let _vacGuardando = false;

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
  // Al cargar una nueva se propone lo que manda la política: mientras falte el
  // bloque obligatorio, corridos; después, salteados, que es como se toma el
  // resto casi siempre.
  const mMod = document.getElementById('mvac-modalidad');
  if (mMod) {
    if (v) mMod.value = vacEsSalteada(v) ? 'salteada' : 'corrida';
    else {
      const emp = empleadoDeVac(v ? v.empleado_id : empIdSugerido);
      const sa = emp ? vacSaldo(emp, vacPeriodo) : null;
      mMod.value = (sa && sa.obligPendiente === 0) ? 'salteada' : 'corrida';
    }
  }
  document.getElementById('mvac-obs').value = v ? (v.obs || '') : '';
  document.getElementById('modal-vac-title').textContent = v ? 'Editar vacaciones' : 'Cargar vacaciones';
  // Borrar vive también acá: el lápiz es lo primero que se abre al ver una carga
  // de más, y la papelera estaba solo en el Historial.
  const bBorrar = document.getElementById('mvac-borrar');
  if (bBorrar) bBorrar.style.display = v ? '' : 'none';
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
  const salteada = (document.getElementById('mvac-modalidad') || {}).value === 'salteada';

  const elDias = document.getElementById('mvac-dias');
  if (elDias) elDias.textContent = dias > 0
    ? dias + (dias === 1 ? ' día' : ' días') + (salteada ? ' salteados' : ' corridos')
    : '—';

  const info = document.getElementById('mvac-info');
  if (!info) return;
  const emp = empleadoDeVac(empId);
  if (!emp || !periodo) { info.innerHTML = ''; return; }

  // El saldo se recalcula SIN esta licencia (al editar, sus propios días no
  // cuentan como ya tomados) y después se le aplica lo que se está cargando,
  // con la política: un bloque corrido gasta días corridos, los salteados
  // gastan del resto convertido a 5 de cada 7.
  const sinEsta = { corridos: 0, salteados: 0 };
  vacacionesDe(empId, periodo).filter(vacCuenta).forEach(v => {
    if (vacEditId != null && v.id === vacEditId) return;
    if (vacEsSalteada(v)) sinEsta.salteados += _num(v.dias); else sinEsta.corridos += _num(v.dias);
  });
  const s = vacSaldo(emp, periodo);
  const corridosNuevo = sinEsta.corridos + (cancelada || salteada ? 0 : dias);
  const salteadosNuevo = sinEsta.salteados + (cancelada || !salteada ? 0 : dias);
  const oblig = Math.min(VAC_BLOQUE_OBLIG, s.corresponden);
  const obligPend = Math.max(0, oblig - corridosNuevo);
  const extraCorr = Math.max(0, corridosNuevo - oblig);
  const restoCorr = Math.max(0, s.corresponden - oblig - extraCorr);
  const restoSalt = vacCorridosASalteados(restoCorr, emp) - salteadosNuevo;
  const tomadosOtros = sinEsta.corridos + sinEsta.salteados;

  const v154 = vacVentanaGoce(periodo);
  const fueraVentana = desde && (desde < v154.desde || desde > v154.hasta);

  let html = '<div style="font-size:11.5px;line-height:1.6">' +
    '<div>' + s.detalle + '</div>' +
    '<div>Le corresponden <strong>' + s.corresponden + '</strong> días corridos · ya tiene <strong>' + tomadosOtros + '</strong> cargados' +
    (sinEsta.salteados ? ' <span class="muted">(' + sinEsta.corridos + ' corridos + ' + sinEsta.salteados + ' salteados)</span>' : '') + '</div>';
  if (dias && !cancelada) {
    html += '<div style="margin-top:3px">Con esta licencia le quedarían: ' +
      (obligPend > 0 ? '<strong>' + obligPend + '</strong> del bloque obligatorio + ' : '') +
      '<strong>' + Math.max(0, restoSalt) + '</strong> salteados' +
      (salteadosNuevo === 0 ? ' <span class="muted">(o ' + restoCorr + ' corridos)</span>' : '') + '</div>';
  }
  if (dias && !cancelada && restoSalt < 0) {
    html += '<div style="color:#b91c1c;margin-top:4px"><strong>Se pasa por ' + Math.abs(restoSalt) + ' día(s) salteado(s)</strong> ' +
      'del período ' + periodo + '. Se puede guardar igual (puede ser un adelanto o una licencia de otro tipo), pero revisá el período.</div>';
  }
  // La política: el primer tramo va corrido. Cargar salteados antes de cubrirlo
  // no se bloquea —puede haber una excepción— pero se avisa.
  if (dias && !cancelada && salteada && obligPend > 0) {
    html += '<div style="color:#9a3412;margin-top:4px">Todavía le faltan <strong>' + obligPend + ' día(s)</strong> del ' +
      'bloque de <strong>' + oblig + ' corridos</strong> que va de una sola vez. Estos días salteados se cargan igual, pero el bloque sigue pendiente.</div>';
  }
  if (dias && !cancelada && !salteada && dias < oblig && obligPend > 0) {
    html += '<div style="color:#9a3412;margin-top:4px">Un bloque corrido de menos de <strong>' + oblig + ' días</strong> no cubre el ' +
      'tramo obligatorio. Si son días sueltos, marcalos como <strong>salteados</strong>: rinden más (' +
      vacDiasTrabajaSemana(emp) + ' de cada 7, porque ' + String(typeof diasLaboralesTexto === 'function' ? diasLaboralesTexto(emp) : '').toLowerCase() + ').</div>';
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
  // Un doble clic en Guardar grababa la carga DOS veces: la ventana sigue abierta
  // mientras se escribe en la nube, y el segundo clic no ve la primera carga,
  // que se suma a AppData recién cuando vuelve. Pasó de verdad: dos filas
  // idénticas de RUBEN QUIROZ grabadas con 22 microsegundos de diferencia.
  if (_vacGuardando) return;
  const empleado_id = parseInt(document.getElementById('mvac-empleado').value, 10);
  const periodo = parseInt(document.getElementById('mvac-periodo').value, 10);
  const fecha_desde = document.getElementById('mvac-desde').value;
  const fecha_hasta = document.getElementById('mvac-hasta').value;
  const estado = document.getElementById('mvac-estado').value;
  const modalidad = (document.getElementById('mvac-modalidad') || {}).value === 'salteada' ? 'salteada' : 'corrida';
  const obs = (document.getElementById('mvac-obs').value || '').trim();

  if (!empleado_id) { alert('Elegí el empleado.'); return; }
  if (!fecha_desde || !fecha_hasta) { alert('Cargá las dos fechas.'); return; }
  if (fecha_hasta < fecha_desde) { alert('La fecha de fin no puede ser anterior a la de inicio.'); return; }
  const dias = vacDiasEntre(fecha_desde, fecha_hasta);

  // Superposición con otras vacaciones del MISMO empleado: casi siempre es que se
  // cargó dos veces, y sumaría días de más al saldo. Al cargar una NUEVA se dice
  // qué pasa si se acepta: las copias de más que se encontraron eran correcciones
  // (del período, del estado) hechas cargando otra vez en vez de editar.
  const choca = (AppData.vacaciones || []).find(v => v.empleado_id === empleado_id && v.id !== vacEditId &&
    vacCuenta(v) && String(v.fecha_desde) <= fecha_hasta && String(v.fecha_hasta) >= fecha_desde);
  if (choca) {
    const NL = String.fromCharCode(10);
    const msg = _vacNombre(empleado_id) + ' ya tiene vacaciones cargadas del ' + vacFmt(choca.fecha_desde) + ' al ' +
      vacFmt(choca.fecha_hasta) + ', que se pisan con estas fechas.' + NL + NL +
      (vacEditId == null
        ? 'Guardar agrega una SEGUNDA carga y le descuenta esos días dos veces. Si lo que querés es corregir la que ya está ' +
          '(el período, el estado o la modalidad), cancelá y editala con el lápiz.' + NL + NL + '¿Agregar otra carga igual?'
        : '¿Guardar igual?');
    if (!confirm(msg)) return;
  }

  const rec = { empleado_id, periodo, fecha_desde, fecha_hasta, dias, estado, modalidad, obs };
  _vacGuardando = true;
  _btnGuardando('mvac-guardar', true);
  try {
    if (vacEditId != null) {
      await DB.updateWhere('vacaciones', 'id', vacEditId, rec);
      const v = AppData.vacaciones.find(x => x.id === vacEditId);
      if (v) Object.assign(v, rec);
    } else {
      const row = await DB.insertRow('vacaciones', rec);
      AppData.vacaciones.push(Object.assign({ id: row && row.id,
        created_at: (row && row.created_at) || new Date().toISOString() }, rec));
    }
    persistirVacacionesLocal();
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    closeVacModal();
    switchVacacionesTab(vacTab);
    showToast('✅ Vacaciones guardadas — ' + dias + ' día(s) ' + (modalidad === 'salteada' ? 'salteados' : 'corridos'));
  } catch (e) {
    console.warn('guardarVacacion', e); alert('No se pudo guardar: ' + (e.message || e));
  } finally {
    _vacGuardando = false;
    _btnGuardando('mvac-guardar', false);
  }
}

async function eliminarVacacion(id) {
  const v = (AppData.vacaciones || []).find(x => x.id === id);
  if (!v) return false;
  const NL = String.fromCharCode(10);
  // Si se pisa con otra carga del mismo empleado, lo que se borra es una copia y
  // no hay nada que conservar. Si es la única, conviene cancelarla: queda el registro.
  const otra = (AppData.vacaciones || []).some(x => x.id !== v.id && x.empleado_id === v.empleado_id && vacCuenta(x) &&
    String(x.fecha_desde) <= String(v.fecha_hasta) && String(x.fecha_hasta) >= String(v.fecha_desde));
  if (!confirm('¿Borrar las vacaciones de ' + _vacNombre(v.empleado_id) + ' del ' + vacFmt(v.fecha_desde) +
      ' al ' + vacFmt(v.fecha_hasta) + ' (' + v.dias + ' ' + (vacEsSalteada(v) ? 'salteados' : 'corridos') +
      ', corresponden a ' + v.periodo + ')?' + NL + NL +
      (otra ? 'Tiene otra carga para esas fechas: esa queda como está.'
            : 'Si la persona no llegó a tomarlas, conviene marcarlas como Canceladas en vez de borrarlas: así queda el registro.'))) return false;
  try {
    await DB.deleteWhere('vacaciones', 'id', id);
    AppData.vacaciones = AppData.vacaciones.filter(x => x.id !== id);
    persistirVacacionesLocal();
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    switchVacacionesTab(vacTab);
    showToast('Vacaciones borradas');
    return true;
  } catch (e) { console.warn('eliminarVacacion', e); alert('No se pudo borrar: ' + (e.message || e)); return false; }
}
// Borrar desde la ventana del lápiz, que se cierra solo si de verdad se borró.
async function borrarVacacionDelModal() {
  const id = vacEditId;
  if (id == null) return;
  if (await eliminarVacacion(id)) closeVacModal();
}
// Mientras se escribe en la nube el botón queda deshabilitado y lo dice: es lo
// que frena el segundo clic, y además se ve que algo está pasando.
function _btnGuardando(id, on) {
  const b = document.getElementById(id);
  if (!b) return;
  if (on) {
    if (b.dataset.html == null) b.dataset.html = b.innerHTML;
    b.disabled = true; b.textContent = 'Guardando…';
  } else {
    b.disabled = false;
    if (b.dataset.html != null) { b.innerHTML = b.dataset.html; delete b.dataset.html; }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  CARGAS REPETIDAS
//  El mismo empleado con dos o más vacaciones que se pisan. Nadie se toma dos
//  veces la misma semana: es una carga doble —un doble clic en Guardar, o una
//  carga nueva para "corregir" la anterior en vez de editarla— y cada copia le
//  descuenta días del saldo. Las canceladas no cuentan: ya no descuentan nada.
// ════════════════════════════════════════════════════════════════════════
function vacRepetidas() {
  const porEmp = {};
  (AppData.vacaciones || []).filter(vacCuenta).forEach(v => {
    (porEmp[v.empleado_id] = porEmp[v.empleado_id] || []).push(v);
  });
  const grupos = [];
  Object.keys(porEmp).forEach(k => {
    const lista = porEmp[k].slice().sort((a, b) =>
      String(a.fecha_desde).localeCompare(String(b.fecha_desde)) || (_num(a.id) - _num(b.id)));
    let g = null;
    lista.forEach(v => {
      // Se encadenan: si A se pisa con B y B con C es un solo grupo, aunque A y C no se toquen.
      if (g && String(v.fecha_desde) <= g.hasta) {
        g.filas.push(v);
        if (String(v.fecha_hasta) > g.hasta) g.hasta = String(v.fecha_hasta);
      } else {
        g = { empleado_id: v.empleado_id, desde: String(v.fecha_desde), hasta: String(v.fecha_hasta), filas: [v] };
        grupos.push(g);
      }
    });
  });
  return grupos.filter(x => x.filas.length > 1)
    .sort((a, b) => String(_vacNombre(a.empleado_id)).localeCompare(String(_vacNombre(b.empleado_id))));
}
function _vacIdsRepetidas() {
  const s = new Set();
  vacRepetidas().forEach(g => g.filas.forEach(v => s.add(v.id)));
  return s;
}
// Dos cargas IDÉNTICAS (mismo período, días, estado, modalidad y observación) no
// tienen nada que decidir: cualquiera de las dos sobra.
function _vacFirma(v) {
  return [v.empleado_id, v.periodo, v.fecha_desde, v.fecha_hasta, v.dias, v.estado,
    vacEsSalteada(v) ? 's' : 'c', String(v.obs || '').trim()].join('|');
}
// Cuándo se cargó: entre dos copias, es lo que dice cuál fue la primera.
function _vacCargadaEl(v) {
  if (!v || !v.created_at) return '';
  const d = new Date(v.created_at);
  if (isNaN(d)) return '';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function renderVacRepetidas() {
  const cont = document.getElementById('vac-repetidas');
  if (!cont) return;
  const grupos = vacRepetidas();
  if (!grupos.length) { cont.innerHTML = ''; return; }
  const bloques = grupos.map(g => {
    const vistas = {};
    const filas = g.filas.slice().sort((a, b) => _num(a.id) - _num(b.id)).map(v => {
      const st = VAC_ESTADOS[v.estado] || VAC_ESTADOS.planificada;
      const firma = _vacFirma(v);
      const identica = vistas[firma]; vistas[firma] = true;
      const cargada = _vacCargadaEl(v);
      return '<div class="vac-rep-fila" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 0;border-top:1px dashed #fdba74">' +
        '<span style="flex:1;min-width:220px">' + vacFmt(v.fecha_desde) + ' al ' + vacFmt(v.fecha_hasta) +
          ' · <strong>' + v.dias + ' ' + (vacEsSalteada(v) ? 'salteados' : 'corridos') + '</strong>' +
          ' · corresponden a ' + v.periodo + ' ' +
          '<span class="tag" style="background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.borde + '">' + st.label + '</span>' +
          (cargada ? ' <span style="font-size:11px;opacity:.8">cargada el ' + cargada + '</span>' : '') +
          (identica ? ' <span class="tag" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d">idéntica a otra</span>' : '') +
        '</span>' +
        '<button class="btn btn-sm" title="Editar" onclick="openVacModal(' + v.id + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" title="Borrar esta carga" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarVacacion(' + v.id + ')"><i class="ic ic-trash"></i> Borrar</button>' +
      '</div>';
    }).join('');
    return '<div style="margin-top:10px"><div style="margin-bottom:2px"><strong>' + _vacNombre(g.empleado_id) + '</strong> — ' +
      g.filas.length + ' cargas que se pisan, del ' + vacFmt(g.desde) + ' al ' + vacFmt(g.hasta) + '</div>' + filas + '</div>';
  }).join('');
  cont.innerHTML = '<div class="alert" style="margin:0 0 14px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
    '<i class="ic ic-alert"></i><div style="flex:1;min-width:0">' +
    '<strong>' + (grupos.length === 1 ? '1 empleado tiene' : grupos.length + ' empleados tienen') +
    ' vacaciones cargadas más de una vez para las mismas fechas.</strong> ' +
    'Cada carga le descuenta días del saldo: dejá la que corresponde y borrá las demás. Si no sabés cuál vale, abrila con el lápiz.' +
    bloques + '</div></div>';
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

// ════════════════════════════════════════════════════════════════════════
//  LICENCIAS — todo lo que NO son vacaciones
//
//  Matrimonio, nacimiento, fallecimiento de un familiar, examen (art. 158
//  LCT), enfermedad (art. 208), accidente de trabajo, maternidad, donación de
//  sangre y los permisos sin goce. Hasta ahora no había dónde anotarlas: se
//  sabía que alguien había faltado una semana, pero no por qué ni si trajo el
//  acta.
//
//  Van en su propia tabla (`empleado_licencias`) y NO en `vacaciones`: las
//  vacaciones tienen su saldo anual (art. 150), y mezclarlas haría que una
//  licencia por enfermedad le descuente días de vacaciones a alguien.
//
//  Al elegir el tipo se PROPONE lo que da la ley —matrimonio 10 días corridos,
//  nacimiento 2, fallecimiento 3— pero se puede cambiar: un convenio puede dar
//  más, y lo que se registra es la licencia que efectivamente se tomó. Si no
//  coincide con la ley se avisa, no se bloquea.
//
//  El COMPROBANTE (acta, certificado médico, constancia) queda registrado: la
//  pregunta de RRHH a fin de mes es "¿quién no trajo el certificado?", y sin
//  el dato hay que ir a preguntarle a cada uno.
// ════════════════════════════════════════════════════════════════════════
const LIC_TIPOS = [
  { key: 'matrimonio', label: 'Matrimonio', dias: 10, goce: true,
    regla: '10 días corridos', norma: 'art. 158 b LCT', comprobante: 'acta de matrimonio' },
  { key: 'nacimiento', label: 'Nacimiento de hijo/a', dias: 2, goce: true, habil: true,
    regla: '2 días corridos', norma: 'art. 158 a LCT', comprobante: 'partida de nacimiento' },
  { key: 'fallecimiento', label: 'Fallecimiento de cónyuge, hijo/a o padres', dias: 3, goce: true, habil: true,
    regla: '3 días corridos', norma: 'art. 158 c LCT', comprobante: 'acta de defunción' },
  { key: 'fallecimiento_hermano', label: 'Fallecimiento de hermano/a', dias: 1, goce: true, habil: true,
    regla: '1 día', norma: 'art. 158 d LCT', comprobante: 'acta de defunción' },
  { key: 'examen', label: 'Examen', dias: 2, goce: true, topeAnual: 10,
    regla: '2 días corridos por examen, hasta 10 por año', norma: 'art. 158 e LCT', comprobante: 'constancia de examen' },
  { key: 'enfermedad', label: 'Enfermedad', dias: null, goce: true,
    regla: 'los días que indique el certificado médico', norma: 'art. 208 LCT', comprobante: 'certificado médico' },
  { key: 'accidente', label: 'Accidente de trabajo (ART)', dias: null, goce: true,
    regla: 'los días que indique la ART', norma: 'Ley 24.557', comprobante: 'denuncia a la ART',
    nota: 'Los primeros 10 días los paga la empresa; desde el día 11, la ART.' },
  { key: 'maternidad', label: 'Maternidad', dias: 90, goce: false,
    regla: '90 días: 45 antes y 45 después del parto', norma: 'art. 177 LCT', comprobante: 'certificado médico',
    nota: 'La paga ANSES (asignación por maternidad), no la empresa.' },
  { key: 'donacion', label: 'Donación de sangre', dias: 1, goce: true,
    regla: '1 día', norma: 'Ley 22.990', comprobante: 'constancia de donación' },
  { key: 'sin_goce', label: 'Permiso sin goce de sueldo', dias: null, goce: false,
    regla: '', norma: '', comprobante: '' },
  { key: 'otra', label: 'Otra', dias: null, goce: true, regla: '', norma: '', comprobante: '' }
];

// Un tipo que ya no está en la lista no se pierde: se muestra con su nombre.
function licTipo(key) {
  return LIC_TIPOS.find(t => t.key === key) ||
    { key: key || 'otra', label: key ? String(key) : 'Otra', dias: null, goce: true, regla: '', norma: '', comprobante: '' };
}
function persistirLicenciasLocal() {
  try { localStorage.setItem('liq_empleado_licencias', JSON.stringify(AppData.empleadoLicencias || [])); } catch (e) {}
}
// Las observaciones son texto libre y van al HTML: se escapan.
function _licHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _licVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function _licSet(id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
// Una licencia es del año en que EMPIEZA.
function _licAnio(l) { return parseInt(String((l && l.fecha_desde) || '').slice(0, 4), 10) || 0; }
function _licMasDias(iso, n) {
  const d = _vacFecha(iso);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Días de un tipo que el empleado ya tiene en el año, sin la que se edita.
function licDiasDelAnio(empId, tipo, anio, excluirId) {
  return (AppData.empleadoLicencias || []).filter(l => l.empleado_id === empId && l.tipo === tipo &&
    _licAnio(l) === anio && l.id !== excluirId).reduce((s, l) => s + _num(l.dias), 0);
}

// ¿El rango toca al menos un día que esa persona trabaja? El art. 160 exige
// computar un día hábil cuando la licencia cae entera en domingo o feriado.
// Los feriados la app no los conoce: esto mira los días de SU semana laboral.
function _licTocaDiaHabil(emp, desde, hasta) {
  const a = _vacFecha(desde), b = _vacFecha(hasta);
  if (!a || !b || b < a) return true;
  const trabaja = (typeof vacDiasTrabajaSemana === 'function') ? vacDiasTrabajaSemana(emp) : 5;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();           // 0 = domingo, 6 = sábado
    if (dow === 0) { if (trabaja >= 7) return true; continue; }
    if (dow === 6) { if (trabaja >= 6) return true; continue; }
    return true;
  }
  return false;
}

// Con qué se superpone: sus vacaciones y sus otras licencias. Casi siempre es
// una carga doble.
function _licSuperposiciones(empId, desde, hasta, excluirId) {
  const out = [];
  (AppData.vacaciones || []).forEach(v => {
    if (v.empleado_id !== empId || !vacCuenta(v)) return;
    if (String(v.fecha_desde) <= hasta && String(v.fecha_hasta) >= desde)
      out.push('sus vacaciones del ' + vacFmt(v.fecha_desde) + ' al ' + vacFmt(v.fecha_hasta));
  });
  (AppData.empleadoLicencias || []).forEach(l => {
    if (l.empleado_id !== empId || l.id === excluirId) return;
    if (String(l.fecha_desde) <= hasta && String(l.fecha_hasta) >= desde)
      out.push('otra licencia (' + licTipo(l.tipo).label + ') del ' + vacFmt(l.fecha_desde) + ' al ' + vacFmt(l.fecha_hasta));
  });
  return out;
}

// Quién paga esos días. Maternidad no es "sin goce": la cubre ANSES.
function _licPagoTxt(l) {
  const t = licTipo(l.tipo);
  if (l.con_goce) {
    return 'paga la empresa' + (t.key === 'accidente'
      ? '<div style="font-size:10px;color:var(--text-muted)">desde el día 11, la ART</div>' : '');
  }
  if (t.key === 'maternidad') return 'la paga ANSES';
  return '<span style="color:#b45309">sin goce de sueldo</span>';
}
function _licFaltaComprobante(l) { return !!licTipo(l.tipo).comprobante && !l.comprobante; }

// ── La solapa ─────────────────────────────────────────────────────────────
function renderLicencias() {
  const cont = document.getElementById('vac-lic-rows');
  if (!cont) return;
  const selT = document.getElementById('vac-lic-tipo');
  if (selT && !selT.options.length) {
    selT.innerHTML = '<option value="">Todos los tipos</option>' +
      LIC_TIPOS.map(t => '<option value="' + t.key + '">' + t.label + '</option>').join('');
  }
  const tipo = selT ? selT.value : '';
  const q = (_licVal('vac-lic-search') || '').toLowerCase().trim();
  const soloSinComp = !!(document.getElementById('vac-lic-sincomp') || {}).checked;
  const anio = vacPeriodo;

  const delAnio = (AppData.empleadoLicencias || []).filter(l => _licAnio(l) === anio);
  const lista = delAnio
    .filter(l => !tipo || l.tipo === tipo)
    .filter(l => !q || _vacNombre(l.empleado_id).toLowerCase().includes(q))
    .filter(l => !soloSinComp || _licFaltaComprobante(l))
    .sort((a, b) => String(b.fecha_desde).localeCompare(String(a.fecha_desde)));

  const info = document.getElementById('vac-lic-info');
  if (info) info.textContent = 'Licencias que empiezan en ' + anio + ' · ' +
    (lista.length === delAnio.length ? lista.length : lista.length + ' de ' + delAnio.length);

  // Arriba, el año entero (sin filtros): cuántas, cuántos días de enfermedad
  // y a quién le falta el comprobante, que es lo que hay que salir a pedir.
  const enf = delAnio.filter(l => l.tipo === 'enfermedad');
  const sinComp = delAnio.filter(_licFaltaComprobante);
  const kpis = document.getElementById('vac-lic-kpis');
  const card = (ic, label, valor, sub, color) =>
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-' + ic + '"></i></div>' +
      '<div class="metric-label">' + label + '</div>' +
      '<div class="metric-value"' + (color ? ' style="color:' + color + '"' : '') + '>' + valor + '</div>' +
      '<div class="metric-sub">' + sub + '</div></div>';
  if (kpis) kpis.innerHTML =
    card('file', 'Licencias en ' + anio, String(delAnio.length),
      delAnio.reduce((s, l) => s + _num(l.dias), 0) + ' días en total') +
    card('alert', 'Días por enfermedad', String(enf.reduce((s, l) => s + _num(l.dias), 0)),
      enf.length + ' licencia(s) · ' + new Set(enf.map(l => l.empleado_id)).size + ' persona(s)') +
    card('check-circle', 'Sin comprobante', String(sinComp.length),
      sinComp.length ? 'hay que pedírselo' : 'todos presentados', sinComp.length ? '#b45309' : '');

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon"><i class="ic ic-file"></i></div>' +
      '<div class="empty-title">' + (delAnio.length ? 'Ninguna coincide con el filtro' : 'Sin licencias en ' + anio) + '</div>' +
      '<div class="empty-sub">' + (delAnio.length ? 'Probá con otro tipo o sacá el buscador' : 'Registrá una con el botón de arriba') +
      '</div></div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(l => {
    const t = licTipo(l.tipo);
    const e = empleadoDeVac(l.empleado_id);
    const comp = !t.comprobante
      ? '<span class="muted">—</span>'
      : l.comprobante
        ? '<span style="color:#166534">✓ presentado</span>'
        : '<span style="color:#b45309">falta ' + t.comprobante + '</span>' +
          '<div style="margin-top:3px"><button class="btn btn-sm" style="padding:2px 8px;font-size:10px" onclick="marcarComprobanteLicencia(' + l.id + ')">Marcar presentado</button></div>';
    // Si los días no coinciden con la ley se dice en la fila: puede ser un
    // convenio que da más, o un error de carga, y las dos cosas hay que verlas.
    const difLey = t.dias && t.key !== 'examen' && _num(l.dias) !== t.dias;
    return '<tr>' +
      '<td><strong>' + _vacNombre(l.empleado_id) + '</strong>' +
        (e && e.area ? '<div style="font-size:10.5px;color:var(--text-muted)">' + e.area + '</div>' : '') + '</td>' +
      '<td>' + t.label + (t.norma ? '<div style="font-size:10px;color:var(--text-muted)">' + t.norma + '</div>' : '') + '</td>' +
      '<td>' + vacFmt(l.fecha_desde) + ' → ' + vacFmt(l.fecha_hasta) + '</td>' +
      '<td style="text-align:right"><strong>' + _num(l.dias) + '</strong>' +
        (difLey ? '<div style="font-size:9.5px;color:#92400e">la ley da ' + t.dias + '</div>' : '') + '</td>' +
      '<td style="font-size:11.5px">' + _licPagoTxt(l) + '</td>' +
      '<td style="font-size:11.5px">' + comp + '</td>' +
      '<td style="font-size:11.5px;color:var(--text-secondary);max-width:220px">' + _licHtml(l.obs) + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="openLicenciaModal(' + l.id + ')" title="Editar"><i class="ic ic-edit"></i></button> ' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarLicencia(' + l.id + ')" title="Borrar"><i class="ic ic-trash"></i></button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

// ── El modal ──────────────────────────────────────────────────────────────
let licEditId = null;
let _licGuardando = false;

function openLicenciaModal(id, empIdSugerido) {
  licEditId = id != null ? id : null;
  const l = id != null ? (AppData.empleadoLicencias || []).find(x => x.id === id) : null;

  // Mismo criterio que vacaciones: el plantel sale de Empleados, y alguien
  // dado de baja con una licencia vieja se agrega igual para poder editarla.
  const sel = document.getElementById('mlic-empleado');
  if (sel) {
    const activos = (AppData.empleados || []).filter(e => e.activo !== false)
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    let html = '<option value="">— Elegí un empleado —</option>' +
      activos.map(e => '<option value="' + e.id + '">' + e.nombre + (e.area ? ' · ' + e.area : '') + '</option>').join('');
    const elegido = l ? l.empleado_id : empIdSugerido;
    if (elegido && !activos.some(e => e.id === elegido)) {
      html += '<option value="' + elegido + '">' + _vacNombre(elegido) + ' (dado de baja)</option>';
    }
    sel.innerHTML = html;
    sel.value = elegido ? String(elegido) : '';
  }
  const st = document.getElementById('mlic-tipo');
  if (st) {
    st.innerHTML = '<option value="">— Elegí el tipo —</option>' +
      LIC_TIPOS.map(t => '<option value="' + t.key + '">' + t.label + '</option>').join('') +
      (l && !LIC_TIPOS.some(t => t.key === l.tipo)
        ? '<option value="' + _licHtml(l.tipo) + '">' + _licHtml(l.tipo) + ' (fuera de la lista)</option>' : '');
    st.value = l ? l.tipo : '';
  }
  _licSet('mlic-desde', l ? l.fecha_desde : '');
  _licSet('mlic-hasta', l ? l.fecha_hasta : '');
  const goce = document.getElementById('mlic-goce');
  if (goce) goce.checked = l ? !!l.con_goce : true;
  const comp = document.getElementById('mlic-comprobante');
  if (comp) comp.checked = l ? !!l.comprobante : false;
  _licSet('mlic-obs', l ? l.obs : '');
  const tit = document.getElementById('modal-lic-title');
  if (tit) tit.textContent = l ? 'Editar licencia' : 'Registrar licencia';
  const bBorrar = document.getElementById('mlic-borrar');
  if (bBorrar) bBorrar.style.display = l ? '' : 'none';
  document.getElementById('modal-lic-backdrop').style.display = 'flex';
  _licEtiquetaComprobante();
  recalcLicenciaModal();
}

function closeLicenciaModal(ev) {
  if (ev && ev.target !== ev.currentTarget) return;
  document.getElementById('modal-lic-backdrop').style.display = 'none';
  licEditId = null;
}

function _licEtiquetaComprobante() {
  const t = licTipo(_licVal('mlic-tipo'));
  const wrap = document.getElementById('mlic-comprobante-wrap');
  const lab = document.getElementById('mlic-comprobante-label');
  if (wrap) wrap.style.display = t.comprobante ? '' : 'none';
  if (lab) lab.textContent = 'Ya presentó el comprobante' + (t.comprobante ? ': ' + t.comprobante : '');
}

// Elegir el tipo propone sus condiciones: quién paga y hasta cuándo va.
function cambioTipoLicencia() {
  const t = licTipo(_licVal('mlic-tipo'));
  const goce = document.getElementById('mlic-goce');
  if (goce) goce.checked = !!t.goce;
  const desde = _licVal('mlic-desde');
  if (t.dias && desde) _licSet('mlic-hasta', _licMasDias(desde, t.dias - 1));
  _licEtiquetaComprobante();
  recalcLicenciaModal();
}
// Con días fijos el fin sale solo; sin ellos, el fin no puede quedar antes.
function cambioDesdeLicencia() {
  const t = licTipo(_licVal('mlic-tipo'));
  const desde = _licVal('mlic-desde'), hasta = _licVal('mlic-hasta');
  if (t.dias && desde) _licSet('mlic-hasta', _licMasDias(desde, t.dias - 1));
  else if (desde && (!hasta || hasta < desde)) _licSet('mlic-hasta', desde);
  recalcLicenciaModal();
}

// El efecto ANTES de guardar: cuántos días son, si coinciden con la ley, si se
// superpone con algo, y qué pasa con el sueldo de esos días.
function recalcLicenciaModal() {
  const empId = parseInt(_licVal('mlic-empleado'), 10);
  const tipoKey = _licVal('mlic-tipo');
  const t = licTipo(tipoKey);
  const desde = _licVal('mlic-desde'), hasta = _licVal('mlic-hasta');
  const dias = (desde && hasta && hasta >= desde) ? vacDiasEntre(desde, hasta) : 0;
  const goce = !!(document.getElementById('mlic-goce') || {}).checked;
  const comp = !!(document.getElementById('mlic-comprobante') || {}).checked;

  const regla = document.getElementById('mlic-regla');
  if (regla) regla.innerHTML = !tipoKey
    ? 'Al elegir el tipo se proponen los días que da la ley y quién paga.'
    : (t.regla ? 'La ley da: <strong>' + t.regla + '</strong>' + (t.norma ? ' (' + t.norma + ')' : '') + '.' : '') +
      (t.nota ? ' ' + t.nota : '');

  const elDias = document.getElementById('mlic-dias');
  if (elDias) elDias.textContent = dias
    ? dias + (dias === 1 ? ' día corrido' : ' días corridos') + ' · del ' + vacFmt(desde) + ' al ' + vacFmt(hasta)
    : (desde && hasta && hasta < desde ? 'La fecha de fin es anterior al inicio' : '—');

  const info = document.getElementById('mlic-info');
  if (!info) return;
  const emp = empleadoDeVac(empId);
  const anio = desde ? parseInt(desde.slice(0, 4), 10) : 0;
  const av = [];
  const ambar = s => '<div style="color:#9a3412;margin-top:4px">' + s + '</div>';

  if (tipoKey && dias && t.dias && t.key !== 'examen' && dias !== t.dias) {
    av.push(ambar('La ley da <strong>' + t.regla + '</strong>; estás cargando <strong>' + dias + '</strong>. ' +
      'Se puede guardar igual si el convenio o la empresa dan otra cosa.'));
  }
  if (t.key === 'examen' && dias) {
    if (dias > 2) av.push(ambar('Por examen corresponden <strong>2 días corridos</strong>.'));
    if (emp) {
      const prev = licDiasDelAnio(empId, 'examen', anio, licEditId);
      if (prev + dias > t.topeAnual) av.push(ambar('Con esta suma <strong>' + (prev + dias) + ' días de examen</strong> en ' + anio +
        ': la ley da hasta <strong>' + t.topeAnual + ' por año</strong>.'));
    }
  }
  if (t.habil && emp && dias && !_licTocaDiaHabil(emp, desde, hasta)) {
    av.push(ambar('La licencia cae entera en días que no trabaja. El <strong>art. 160</strong> exige computar ' +
      '<strong>al menos un día hábil</strong>: extendela hasta su próximo día de trabajo.'));
  }
  if (emp && dias) {
    const sup = _licSuperposiciones(empId, desde, hasta, licEditId);
    if (sup.length) av.push('<div style="color:#b91c1c;margin-top:4px">Se superpone con ' + sup.join(' y con ') + '.</div>');
  }
  if (t.key === 'enfermedad' && emp && dias) {
    av.push('<div style="margin-top:4px">Con esta, <strong>' + (licDiasDelAnio(empId, 'enfermedad', anio, licEditId) + dias) +
      ' días de enfermedad</strong> en ' + anio + '.</div>');
  }
  if (tipoKey && dias && !goce) {
    av.push(ambar(t.key === 'maternidad'
      ? 'La empresa no paga el sueldo de estos días: los cubre ANSES.'
      : '<strong>Estos días no se pagan</strong>: descontalos al liquidar el sueldo del mes.'));
  }
  if (tipoKey && t.comprobante && !comp) {
    av.push('<div style="color:var(--text-muted);margin-top:4px">Queda marcada como <strong>falta ' + t.comprobante +
      '</strong> hasta que lo presente.</div>');
  }
  info.innerHTML = av.length ? '<div style="font-size:11.5px;line-height:1.55">' + av.join('') + '</div>' : '';
}

async function guardarLicencia() {
  // Mismo resguardo que guardarVacacion: un doble clic grababa dos veces.
  if (_licGuardando) return;
  const empleado_id = parseInt(_licVal('mlic-empleado'), 10);
  const tipo = _licVal('mlic-tipo');
  const fecha_desde = _licVal('mlic-desde'), fecha_hasta = _licVal('mlic-hasta');
  const t = licTipo(tipo);
  const con_goce = !!(document.getElementById('mlic-goce') || {}).checked;
  const comprobante = t.comprobante ? !!(document.getElementById('mlic-comprobante') || {}).checked : false;
  const obs = (_licVal('mlic-obs') || '').trim();

  if (!empleado_id) { alert('Elegí el empleado.'); return; }
  if (!tipo) { alert('Elegí el tipo de licencia.'); return; }
  if (!fecha_desde || !fecha_hasta) { alert('Cargá las dos fechas.'); return; }
  if (fecha_hasta < fecha_desde) { alert('La fecha de fin no puede ser anterior a la de inicio.'); return; }
  const dias = vacDiasEntre(fecha_desde, fecha_hasta);

  const sup = _licSuperposiciones(empleado_id, fecha_desde, fecha_hasta, licEditId);
  const NL = String.fromCharCode(10);
  if (sup.length && !confirm('Se superpone con ' + sup.join(' y con ') + '.' + NL + NL +
      'Casi siempre es una carga doble. ¿Guardar igual?')) return;

  const rec = { empleado_id, tipo, fecha_desde, fecha_hasta, dias, con_goce, comprobante, obs };
  _licGuardando = true;
  _btnGuardando('mlic-guardar', true);
  try {
    if (licEditId != null) {
      await DB.updateWhere('empleado_licencias', 'id', licEditId, rec);
      const l = (AppData.empleadoLicencias || []).find(x => x.id === licEditId);
      if (l) Object.assign(l, rec);
    } else {
      const quien = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.nombre || currentUser.usuario || '') : '';
      const nuevo = Object.assign({}, rec, { creado_por: quien });
      const row = await DB.insertRow('empleado_licencias', nuevo);
      AppData.empleadoLicencias = (AppData.empleadoLicencias || []).concat([Object.assign({ id: row && row.id }, nuevo)]);
    }
    persistirLicenciasLocal();
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    closeLicenciaModal();
    switchVacacionesTab(vacTab);
    showToast('✅ Licencia registrada — ' + t.label + ' · ' + dias + ' día(s)');
  } catch (e) {
    console.warn('guardarLicencia', e); alert('No se pudo guardar: ' + (e.message || e));
  } finally {
    _licGuardando = false;
    _btnGuardando('mlic-guardar', false);
  }
}

async function eliminarLicencia(id) {
  const l = (AppData.empleadoLicencias || []).find(x => x.id === id);
  if (!l) return false;
  if (!confirm('¿Borrar la licencia por ' + licTipo(l.tipo).label.toLowerCase() + ' de ' + _vacNombre(l.empleado_id) +
    ' del ' + vacFmt(l.fecha_desde) + ' al ' + vacFmt(l.fecha_hasta) + '?')) return false;
  try {
    await DB.deleteWhere('empleado_licencias', 'id', id);
    AppData.empleadoLicencias = (AppData.empleadoLicencias || []).filter(x => x.id !== id);
    persistirLicenciasLocal();
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    switchVacacionesTab(vacTab);
    showToast('Licencia borrada');
    return true;
  } catch (e) { console.warn('eliminarLicencia', e); alert('No se pudo borrar: ' + (e.message || e)); return false; }
}
async function borrarLicenciaDelModal() {
  const id = licEditId;
  if (id == null) return;
  if (await eliminarLicencia(id)) closeLicenciaModal();
}

// Registrar que trajo el acta o el certificado, sin abrir el modal.
async function marcarComprobanteLicencia(id) {
  const l = (AppData.empleadoLicencias || []).find(x => x.id === id);
  if (!l) return;
  try {
    await DB.updateWhere('empleado_licencias', 'id', id, { comprobante: true });
    l.comprobante = true;
    persistirLicenciasLocal();
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    renderLicencias();
    showToast('✅ Comprobante registrado — ' + _vacNombre(l.empleado_id));
  } catch (e) { console.warn('marcarComprobanteLicencia', e); alert('No se pudo guardar: ' + (e.message || e)); }
}
