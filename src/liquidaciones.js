// ════════════════════════════════════════════════════════════════════════
//  LIQUIDACIÓN DE CONDUCTORES — el circuito tiene DOS manos.
//    1) el ADMINISTRATIVO revisa los recorridos de la semana, imputa lo que
//       corresponda y marca la liquidación como LISTA;
//    2) el TESORERO baja las que están listas y las envía.
//  Es el mismo circuito que ya usa Liquidación de clientes. Sin ese estado el
//  tesorero no puede distinguir lo revisado de lo que todavía nadie miró, y
//  termina mandando PDFs de datos a medio corregir.
//
//  El período es la semana VIE→JUE, la misma con la que se le factura al
//  cliente: la condición NO cambia el ciclo de trabajo, dice qué DÍA se paga esa
//  semana (Titular y Semi Titular=viernes · Suplente=martes). Antes el
//  período era un filtro libre (Todo / Hoy / Este mes) y por eso una liquidación
//  no pertenecía a ninguna semana: no había a qué atarle el "lista".
// ════════════════════════════════════════════════════════════════════════

// Viernes que abre la semana que se está mirando (ISO).
function liqSemanaISO() {
  const el = document.getElementById('liq-semana');
  if (el && el.value) return el.value;
  const r = semanaClienteRango();
  return _liqISO(r.desdeD);
}
function _liqISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// El input acepta cualquier día y se corre al viernes de esa semana: si mostrara
// el martes que se tocó, habría que deducir a qué semana pertenece.
function cambiarSemanaLiq() {
  if (typeof snapSemanaCliente === 'function') snapSemanaCliente('liq-semana');
  renderLiquidaciones();
}
function moverSemanaLiq(n) {
  const el = document.getElementById('liq-semana'); if (!el) return;
  const r = semanaClienteRango(liqSemanaISO());
  const d = new Date(r.desdeD); d.setDate(d.getDate() + 7 * n);
  el.value = _liqISO(d);
  renderLiquidaciones();
}

// ── La semana de pago de CADA condición ─────────────────────────────────
// No es la misma para todos. La semana CIERRA el día anterior al día de pago,
// así el conductor cobra lo que cerró la víspera:
//   Titular      → paga viernes → cierra jueves → semana VIE→JUE
//   Semi Titular → paga viernes → cierra jueves → semana VIE→JUE
//   Suplente     → paga martes  → cierra lunes  → semana MAR→LUN
// Lo confirma la planilla que se usa hoy: "LIQUIDACION SUPLENTES SEMANA DEL
// 25/08 al 31/08" es martes a lunes. Liquidar a todos de viernes a jueves le
// mete a un suplente los envíos de otra semana.
// ÚNICA fuente del día de pago: de acá salen la semana, el chip de la fila y el
// PDF. Desde 09/2026 los SEMI TITULARES cobran los viernes, unificados con los
// titulares; antes cobraban los lunes.
const LIQ_DIA_PAGO = { 'TITULAR': 5, 'SEMI TITULAR': 5, 'SUPLENTE': 2 };   // 0=dom
const LIQ_DIA_NOMBRE = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
function liqDiaPagoTxt(condicion) {
  const d = LIQ_DIA_PAGO[String(condicion || '').toUpperCase()];
  return d === undefined ? '' : LIQ_DIA_NOMBRE[d];
}

// Día en que ARRANCA la semana de esa condición (= su día de pago).
function liqDiaInicioCond(condicion) {
  const d = LIQ_DIA_PAGO[String(condicion || '').toUpperCase()];
  return d === undefined ? 5 : d;   // sin condición se muestra con la de Titular
}

// La semana de esa condición que CONTIENE la fecha de referencia.
function semanaDeCondicion(condicion, isoRef) {
  const ini = liqDiaInicioCond(condicion);
  const d = isoRef ? new Date(isoRef + 'T12:00:00') : new Date();
  const atras = (d.getDay() - ini + 7) % 7;
  const desde = new Date(d); desde.setDate(d.getDate() - atras); desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde); hasta.setDate(desde.getDate() + 6); hasta.setHours(23, 59, 59, 999);
  return { desde, hasta };
}

// La semana de UN conductor, según la condición que tenga cargada.
function semanaDeConductor(conductor, isoRef) {
  const pan = panelConductorDe(conductor);
  return semanaDeCondicion((pan && pan.condicion) || '', isoRef || liqSemanaISO());
}

// El rango de referencia del encabezado: la semana del Titular (VIE→JUE), que
// es la que ancla el resto. Cada fila muestra la suya cuando difiere.
function getLiqFechaRango() {
  return semanaDeCondicion('TITULAR', liqSemanaISO());
}

// ── Estado "lista para enviar" ──────────────────────────────────────────
// Misma forma que liquidacionArmada() del lado de clientes: la clave es el
// conductor CANÓNICO más el viernes que abre la semana.
function liqConductorArmada(conductor, semanaISO) {
  const k = normNombre(typeof conductorCanonico === 'function' ? conductorCanonico(conductor) : conductor);
  // La clave es la semana DE ESE CONDUCTOR: dos condiciones distintas que se
  // liquidan el mismo dia de referencia tienen semanas distintas.
  const sem = semanaISO || _liqISO(semanaDeConductor(conductor).desde);
  return (AppData.conductorLiquidaciones || []).find(x =>
    normNombre(x.conductor) === k && String(x.semana_desde).slice(0, 10) === sem) || null;
}

async function marcarLiqConductorLista(conductor) {
  const cond = (typeof conductorCanonico === 'function' ? conductorCanonico(conductor) : conductor) || conductor;
  const semC = semanaDeConductor(cond);
  const sem = _liqISO(semC.desde);
  if (liqConductorArmada(cond, sem)) return;
  const r = { desdeD: semC.desde, hastaD: semC.hasta };
  const liq = calcLiquidacionesFiltradas();
  const rec = {
    conductor: cond,
    semana_desde: sem,
    semana_hasta: _liqISO(r.hastaD),
    armada_por: (currentUser && (currentUser.nombre || currentUser.usuario)) || '',
    armada_en: new Date().toISOString(),
    // El neto que el administrativo dio por bueno. El PDF se sigue calculando en
    // vivo —una corrección posterior tiene que reflejarse— pero guardar el número
    // deja ver si algo se movió después de darla por lista.
    // Misma cuenta que muestra la tabla: bruto + adicionales − descuentos imputados.
    monto: liq[cond]
      ? _num(netoLiquidacion(liq[cond].total, imputacionesConductor(cond, (typeof getLiqRangoFechasLabel === 'function' ? getLiqRangoFechasLabel() : null))))
      : 0
  };
  try {
    const row = await DB.insertRow('conductor_liquidaciones', rec);
    AppData.conductorLiquidaciones = (AppData.conductorLiquidaciones || []).concat([Object.assign({ id: row && row.id }, rec)]);
    persistirLiqConductorLocal();
    showToast('✅ ' + cond + ' — liquidación lista, el tesorero ya puede descargarla');
    renderLiquidaciones();
  } catch (e) { console.warn('marcarLiqConductorLista', e); showToast('⛔ No se pudo marcar'); }
}

async function desarmarLiqConductor(conductor) {
  const a = liqConductorArmada(conductor);
  if (!a) return;
  if (!confirm('¿Reabrir la liquidación de ' + conductor + '?' + String.fromCharCode(10) + String.fromCharCode(10) +
    'Vuelve a quedar pendiente y el tesorero deja de verla como lista para enviar.')) return;
  try {
    await DB.deleteWhere('conductor_liquidaciones', 'id', a.id);
    AppData.conductorLiquidaciones = (AppData.conductorLiquidaciones || []).filter(x => x.id !== a.id);
    persistirLiqConductorLocal();
    showToast('↩ Liquidación reabierta');
    renderLiquidaciones();
  } catch (e) { console.warn('desarmarLiqConductor', e); showToast('⛔ No se pudo reabrir'); }
}

function persistirLiqConductorLocal() {
  try { localStorage.setItem('liq_conductor_liquidaciones', JSON.stringify(AppData.conductorLiquidaciones || [])); } catch (e) {}
}

// Marcar/reabrir TODO lo que se está viendo: con 102 conductores, hacerlo de a
// uno es media hora de clics.
async function marcarTodasLiqConductor() {
  const liq = calcLiquidacionesFiltradas();
  const cs = conductoresFiltradosLiq(liq).filter(c => liq[c] && liq[c].filas.length && !liqConductorArmada(c));
  if (!cs.length) { showToast('No hay ninguna sin armar en lo que estás viendo'); return; }
  if (!confirm('¿Marcar como listas las ' + cs.length + ' liquidaciones que estás viendo?' + String.fromCharCode(10) +
    'El tesorero va a poder descargarlas y enviarlas.')) return;
  for (const c of cs) await marcarLiqConductorLista(c);
}

// Los envíos de la semana de pago de CADA conductor. No se puede filtrar por un
// rango único: la semana del suplente (mar→lun) no es la del titular (vie→jue),
// y filtrar a todos por la misma le mete a uno los envíos de otra semana.
function filtrarRecordsLiq(records) {
  const iso = liqSemanaISO();
  const cache = new Map();   // condición -> {desde, hasta}, para no recalcular por envío
  return records.filter(r => {
    const cond = conductorCanonico(r.cadete); if (!cond) return false;
    const pan = panelConductorDe(cond);
    const c = (pan && pan.condicion) || '';
    let sem = cache.get(c); if (!sem) { sem = semanaDeCondicion(c, iso); cache.set(c, sem); }
    const fch = parseFechaReg(r.fecha);
    if (!fch) return false;
    return fch >= sem.desde && fch <= sem.hasta;
  });
}

// Liquidación completa calculada SOLO sobre los registros del período filtrado
// en el panel Liquidaciones (incluye dimensiones especiales y Super SLA).
// La usan el modal individual y las exportaciones masivas de PDFs, para que
// TODOS los PDFs respeten el mismo período que se ve en pantalla.
function calcLiquidacionesFiltradas() {
  const liqBase = {};
  filtrarRecordsLiq(AppData.records).forEach(r => {
    const cond = conductorCanonico(r.cadete); if (!cond) return;
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = contabilizaRegistro(r);
    if (!liqBase[cond]) liqBase[cond] = { total:0, filas:[], filas_excluidas:[], conductor: cond };
    if (contabiliza) {
      // Dimensión especial ASIGNADA a mano al envío (catálogo por cliente; el
      // precio sale de la zona de entrega). Reemplaza la tarifa, no la suma.
      const dim = dimensionAsignada(r);
      let precio, tipo, es_super=false, sin_tarifa=false, es_dim_especial=false, dim_cliente='', dim_condicion='';
      if (dim) {
        precio = dim.precio; tipo = 'dim_especial'; es_dim_especial=true;
        sin_tarifa = dim.sinPrecioZona;
        dim_cliente = dim.cliente||''; dim_condicion = dim.nombre||'';
      } else {
        const p = getPrecio(cond, zona);
        precio=p.precio; tipo=p.tipo; es_super=p.es_super; sin_tarifa=p.sin_tarifa;
      }
      // Corrección manual del operador (pantalla Conductores): pisa todo cálculo.
      if (precioManualDe(r) !== null) { precio = precioManualDe(r); tipo = 'manual'; sin_tarifa = false; }
      liqBase[cond].total += precio;
      liqBase[cond].filas.push({
        tracking: r.tracking, zona, zona_precio: r.zona_precio||'', fecha: r.fecha, estado: r.estado,
        tipo, precio, subtotal: precio, es_super, sin_tarifa, es_dim_especial, dim_cliente, dim_condicion,
        manual: !!r.manual, zona_manual: !!r.zona_manual,
        precio_corregido: precioManualDe(r) !== null, corregido: esCorregidoRegistro(r)
      });
    } else {
      liqBase[cond].filas_excluidas.push({ tracking: r.tracking, zona, fecha: r.fecha, estado: r.estado });
    }
  });
  return liqBase;
}

// Rango de fechas activo del panel Liquidaciones, formateado DD/MM/YYYY
// para mostrarse en los PDFs. Devuelve null si no hay filtro aplicado.
function getLiqRangoFechasLabel() {
  const rango = getLiqFechaRango();
  if (!rango) return null;
  const fmtF = date => date.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  return {
    desde: rango.desde ? fmtF(rango.desde) : '',
    hasta: rango.hasta ? fmtF(rango.hasta) : ''
  };
}

// Lista de días (DD/MM/YYYY) ordenada cronológicamente, para el tooltip.
function diasLista(setDias) {
  return Array.from(setDias || [])
    .sort((a, b) => {
      const fa = parseFechaReg(a), fb = parseFechaReg(b);
      return (fa ? fa.getTime() : 0) - (fb ? fb.getTime() : 0);
    })
    .join(' · ');
}

// ═══════════════════════════════════════════════════════════════════════
//  FILTRO Y SELECCIÓN PARA DESCARGAR
//  La tabla y la descarga masiva salen de ESTA función, no cada una por su
//  lado: antes el listado aplicaba buscador y condición pero la descarga solo
//  el período, así que filtrando por "Titular" se bajaban igual las
//  liquidaciones de todos los conductores (bug real).
// ═══════════════════════════════════════════════════════════════════════
function conductoresFiltradosLiq(liq) {
  const base = liq || calcLiquidacionesFiltradas();
  const search = (document.getElementById('liq-search')?.value || '').toLowerCase();
  const filterCondicion = document.getElementById('liq-filter-condicion')?.value || '';
  let conductores = Object.keys(base).filter(c => c.toLowerCase().includes(search));
  if (filterCondicion) {
    conductores = conductores.filter(c => {
      const panelEntry = panelConductorDe(c);
      if (filterCondicion === 'sin_asignar') return !panelEntry || !panelEntry.condicion;
      return panelEntry && panelEntry.condicion === filterCondicion;
    });
  }
  return conductores;
}

// Conductores tildados a mano. Se conserva al re-renderizar (el realtime
// re-dibuja la tabla y perder la selección a mitad de armado sería un fastidio),
// pero al descargar SIEMPRE se cruza con el filtro: lo que no está a la vista
// no se baja, aunque haya quedado tildado de un filtro anterior.
let liqSeleccion = new Set();

function toggleLiqSel(conductor, marcado) {
  if (marcado) liqSeleccion.add(conductor); else liqSeleccion.delete(conductor);
  actualizarBotonDescargaLiq();
}
function toggleLiqSelTodos(marcado) {
  const conductores = conductoresFiltradosLiq().filter(c => liqConductorArmada(c));
  conductores.forEach(c => { if (marcado) liqSeleccion.add(c); else liqSeleccion.delete(c); });
  document.querySelectorAll('.liq-row-check').forEach(ch => { ch.checked = !!marcado; });
  actualizarBotonDescargaLiq(conductores);
}

// Lo que se va a descargar: los tildados que estén dentro del filtro; si no hay
// ninguno tildado, todo lo que muestra la tabla.
// Lo que se va a descargar. La regla nueva: el tesorero baja SOLO lo que el
// administrativo dio por listo. Una liquidación sin armar es una que nadie
// revisó todavía, y mandarla es el error que este circuito viene a evitar.
// Si el operador tildó conductores a mano, igual se cruzan con el filtro y con
// el estado: tildar no puede saltear el control.
function seleccionParaDescargar(liq) {
  const filtrados = conductoresFiltradosLiq(liq).filter(c => !liq || (liq[c] && liq[c].filas.length));
  const listas = filtrados.filter(c => liqConductorArmada(c));
  const elegidos = listas.filter(c => liqSeleccion.has(c));
  return {
    filtrados, listas,
    conductores: elegidos.length ? elegidos : listas,
    haySeleccion: elegidos.length > 0,
    // Cuántas quedaron afuera por no estar armadas: el botón lo dice, si no
    // parecería que la descarga se comió conductores.
    sinArmar: filtrados.length - listas.length
  };
}

function actualizarBotonDescargaLiq(conductores) {
  // Con una descarga en curso el botón muestra el avance: un re-render del
  // realtime en el medio le borraría el "Descargando 12 de 44".
  if (window._liqDescargando) return;
  const filtrados = conductores || conductoresFiltradosLiq();
  const listas = filtrados.filter(c => liqConductorArmada(c));
  const nSel = listas.filter(c => liqSeleccion.has(c)).length;
  const sinArmar = filtrados.length - listas.length;
  const btn = document.getElementById('liq-btn-descargar');
  if (btn) btn.innerHTML = '<i class="ic ic-download"></i> ' + (nSel
    ? 'Descargar ' + nSel + ' seleccionada' + (nSel > 1 ? 's' : '') + ' (PDF)'
    : 'Descargar las ' + listas.length + ' listas (PDF)');
  if (btn) btn.disabled = !(nSel || listas.length);
  // Lo que queda afuera por no estar armado se dice al lado del botón, no se esconde.
  const av = document.getElementById('liq-aviso-sinarmar');
  if (av) av.innerHTML = sinArmar
    ? '<span style="font-size:11px;color:#b45309">' + sinArmar + ' sin armar no se descargan</span>'
    : '';
  const unico = document.getElementById('liq-btn-unpdf');
  if (unico) unico.style.display = (nSel || listas.length) > 1 ? '' : 'none';
  // El "todas" de la cabecera refleja lo que hay tildado dentro del filtro.
  const all = document.getElementById('liq-check-all');
  if (all) {
    all.checked = listas.length > 0 && nSel === listas.length;
    all.indeterminate = nSel > 0 && nSel < listas.length;
  }
}

// La celda de estado: lista (con quién y cuándo) o sin armar, con el botón que
// corresponde. El día de pago se muestra acá porque es lo que cambia entre
// conductores dentro de la MISMA semana.
function _liqCeldaEstado(c) {
  const a = liqConductorArmada(c);
  const cEsc = String(c).replace(/'/g, "\\'");
  const pan = panelConductorDe(c);
  const cond = (pan && pan.condicion) || '';
  const dia = liqDiaPagoTxt(cond).slice(0, 3);   // del MISMO mapa que usa la semana
  // Sin condición no hay día de pago y por lo tanto no se liquida: se dice acá,
  // que es donde el operador está por darla por lista.
  const chipCond = cond
    ? '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">' + cond + (dia ? ' · ' + dia : '') + '</div>'
    : '<div style="font-size:10px;color:#b91c1c;margin-top:3px">sin condición · no se liquida</div>';
  if (a) {
    const quien = a.armada_por ? ' por ' + a.armada_por : '';
    return '<span class="tag" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;font-size:10px">' +
      '<i class="ic ic-check"></i> Lista para enviar</span>' +
      '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">armada' + quien + '</div>' +
      '<button class="btn btn-sm" style="margin-top:4px;padding:2px 6px;font-size:10px" onclick="desarmarLiqConductor(\'' + cEsc + '\')">Reabrir</button>' +
      chipCond;
  }
  return '<span class="tag" style="background:var(--surface-2);color:var(--text-muted);font-size:10px">⏳ Sin armar</span>' +
    '<button class="btn btn-sm" style="margin-top:4px;padding:2px 6px;font-size:10px" onclick="marcarLiqConductorLista(\'' + cEsc + '\')">Marcar lista</button>' +
    chipCond;
}

// Los tres números de arriba, iguales a los de Liquidación de clientes: el
// tesorero tiene que ver de un vistazo qué puede mandar y qué falta armar.
function _liqPintarKPIs(liq, conductores) {
  const cont = document.getElementById('liq-kpis');
  if (!cont) return;
  const conRec = conductores.filter(c => liq[c] && liq[c].filas.length);
  const listas = conRec.filter(c => liqConductorArmada(c));
  const rangoImput = (typeof getLiqRangoFechasLabel === 'function') ? getLiqRangoFechasLabel() : null;
  const montoListas = listas.reduce((s, c) =>
    s + netoLiquidacion(liq[c].total, imputacionesConductor(c, rangoImput)), 0);
  const sinArmar = conRec.length - listas.length;
  cont.innerHTML =
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-check-circle"></i></div>' +
      '<div class="metric-label">Listas para enviar</div><div class="metric-value">' + listas.length + '</div>' +
      '<div class="metric-sub">' + fmtPeso(montoListas) + ' a pagar</div></div>' +
    '<div class="metric-card"' + (sinArmar ? ' style="border-color:#fdba74"' : '') + '><div class="metric-ic"><i class="ic ic-alert"></i></div>' +
      '<div class="metric-label">Sin armar</div><div class="metric-value">' + sinArmar + '</div>' +
      '<div class="metric-sub">las revisa y marca el administrativo</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-truck"></i></div>' +
      '<div class="metric-label">Conductores con recorridos</div><div class="metric-value">' + conRec.length + '</div>' +
      '<div class="metric-sub">en la semana elegida</div></div>';
}

function renderLiquidaciones() {
  // Calcular liquidaciones sobre los registros filtrados por fecha
  const recordsFiltrados = filtrarRecordsLiq(AppData.records);
  const liqBase = {};
  recordsFiltrados.forEach(r => {
    const cond = conductorCanonico(r.cadete); if (!cond) return;
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = contabilizaRegistro(r);
    if (!liqBase[cond]) liqBase[cond] = { total:0, filas:[], filas_excluidas:[], conductor: cond, corregidos: 0, dias: new Set() };
    if (esCorregidoRegistro(r)) liqBase[cond].corregidos++;
    if (contabiliza) {
      // Precio de la dimensión especial asignada, si tiene; si no, tarifa/Super SLA.
      const dim = dimensionAsignada(r);
      const p = dim ? { precio: dim.precio, tipo: 'dim_especial', es_super: false } : getPrecio(cond, zona);
      const precio = precioManualDe(r) !== null ? precioManualDe(r) : p.precio;
      liqBase[cond].total += precio;
      liqBase[cond].filas.push({ zona, precio, subtotal: precio, tipo: p.tipo, es_super: p.es_super });
      // Días trabajados = fechas distintas con al menos un envío entregado.
      if (r.fecha) liqBase[cond].dias.add(String(r.fecha).trim());
    } else {
      liqBase[cond].filas_excluidas.push({ zona, estado: r.estado });
    }
  });

  // Etiqueta del período: la semana que se está liquidando. El día de pago no va
  // acá sino por conductor, que es donde cambia según su condición.
  const rango = getLiqFechaRango();
  const fmt = d => d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  const labelEl = document.getElementById('liq-fecha-label');
  if (labelEl) labelEl.textContent = 'Viernes a jueves · ' + fmt(rango.desde) + ' → ' + fmt(rango.hasta);
  // El input arranca en la semana en curso; el operador la mueve con ‹ ›.
  const semEl = document.getElementById('liq-semana');
  if (semEl && !semEl.value) semEl.value = liqSemanaISO();

  const liq = liqBase;
  const conductores = conductoresFiltradosLiq(liq);

  const body = document.getElementById('liq-table-body');
  if (!conductores.length) {
    body.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="empty-icon"><i class="ic ic-dollar"></i></div><div class="empty-title">Sin liquidaciones</div><div class="empty-sub">Importá una base de datos</div></div></td></tr>`;
    _liqPintarKPIs(liq, []);
    actualizarBotonDescargaLiq(conductores);
    return;
  }

  // Neto de cada conductor: el bruto no es lo que se le paga si tiene
  // imputaciones. Se calcula ANTES de ordenar para poder ordenar por lo que
  // realmente se cobra, y con el mismo rango que usa la descarga del PDF.
  const rangoImput = (typeof getLiqRangoFechasLabel === 'function') ? getLiqRangoFechasLabel() : null;
  const netos = {};
  conductores.forEach(c => {
    const imp = imputacionesConductor(c, rangoImput);
    netos[c] = { imp, neto: netoLiquidacion(liq[c].total, imp) };
  });

  conductores.sort((a, b) => netos[b].neto - netos[a].neto);
  _liqPintarKPIs(liq, conductores);
  actualizarBotonDescargaLiq(conductores);
  body.innerHTML = conductores.map(c => {
    const d = liq[c];
    const cEsc = String(c).replace(/'/g, "\\'");
    const { imp, neto } = netos[c];
    // Debajo del neto se dice qué lo movió: sin esa línea, un total distinto al
    // bruto parece un error de cálculo en vez de un descuento aplicado.
    const partes = [];
    if (imp.km > 0) partes.push('<span style="color:#059669">+' + fmtPeso(imp.km) + ' km</span>');
    if (imp.especial > 0) partes.push('<span style="color:#059669">+' + fmtPeso(imp.especial) + ' recorrido especial</span>');
    if (imp.descuentos > 0) partes.push('<span style="color:#b91c1c">−' + fmtPeso(imp.descuentos) + '</span>');
    const subTotal = imp.hay
      ? '<div style="font-size:10px;color:var(--text-muted);white-space:nowrap">bruto ' + fmtPeso(d.total) + ' · ' + partes.join(' ') + '</div>'
      : '<div style="font-size:10px;color:var(--text-muted)">sin imputaciones</div>';
    const sSin = d.filas.filter(f => f.tipo === 's_colecta');
    const sCon = d.filas.filter(f => f.tipo === 'c_colecta');
    const sSLA = d.filas.filter(f => f.tipo === 'sla');
    const sSuper = d.filas.filter(f => f.es_super);
    const cat = panelConductorDe(c);
    return `<tr>
      <td><input type="checkbox" class="liq-row-check" ${liqSeleccion.has(c) ? 'checked' : ''} onchange="toggleLiqSel('${cEsc}',this.checked)" title="Elegir esta liquidación para descargar"></td>
      <td>
        <div class="conductor-cell">
          <div class="conductor-avatar" style="background:${avatarColor(c)}">${initials(c)}</div>
          <div>
            <strong>${c}</strong>
            ${d.corregidos ? `<div style="margin-top:2px"><span class="tag" title="Envíos corregidos a mano (zona, precio o cargados a mano). Vé al detalle para ubicarlos." style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:10px"><i class="ic ic-edit"></i> ${d.corregidos} corregido${d.corregidos > 1 ? 's' : ''} a mano</span></div>` : ''}
          </div>
        </div>
      </td>
      <td><span class="badge ${cat ? 'badge-blue' : 'badge-gray'}">${cat ? tipoLabel(cat.categoria === 'super_sla' ? 'sla' : cat.categoria) : 'Sin categorizar'}</span></td>
      <td class="mono" title="${diasLista(d.dias)}"><strong>${d.dias.size}</strong> <span class="muted" style="font-size:11px">día${d.dias.size === 1 ? '' : 's'}</span></td>
      <td class="mono">${d.filas.length} <span class="muted" style="font-size:11px">(${d.filas_excluidas.length} no entreg.)</span></td>
      <td class="mono">${sSin.length} — ${fmtPeso(sSin.reduce((s,f) => s+f.subtotal,0))}</td>
      <td class="mono">${sCon.length} — ${fmtPeso(sCon.reduce((s,f) => s+f.subtotal,0))}</td>
      <td class="mono">${sSLA.length} — ${fmtPeso(sSLA.reduce((s,f) => s+f.subtotal,0))}</td>
      <td class="mono">${sSuper.length ? `<span class="tag super-sla"><i class="ic ic-star"></i> ${sSuper.length} recorridos</span>` : '<span class="muted">—</span>'}</td>
      <td>${_liqCeldaEstado(c)}</td>
      <td class="mono"><strong style="font-size:14px">${fmtPeso(neto)}</strong>${subTotal}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="showConductorModal('${c}')">Ver detalle</button>
          <button class="btn btn-sm btn-primary" onclick="openLiqModal('${c}')"><i class="ic ic-file"></i> Generar</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ===== CONDUCTOR SELECT & DETAIL =====
