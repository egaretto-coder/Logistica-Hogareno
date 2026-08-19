function getZonaEfectiva(r) {
  return (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
}

// Estado del filtro de condición en dashboard
let dashCondFilter = '';

function setDashCondFilter(btn, cond) {
  dashCondFilter = cond;
  document.querySelectorAll('.dash-cond-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderDashboard(); // re-renderiza respetando el filtro de fechas activo
}

function renderDashConductoresPanel(liqParam) {
  // liqParam viene de renderDashboard ya filtrado por fecha
  // Si se llama directo (ej: desde setDashCondFilter), recalcula completo
  const liq = liqParam || calcLiquidaciones();
  const total = AppData.panelConductores.length;
  const filtrados = dashCondFilter
    ? AppData.panelConductores.filter(c => c.condicion === dashCondFilter)
    : AppData.panelConductores;
  const cantidad = filtrados.length;
  // Anillo conductores: cuando es Todos → conductores con liq / conductores panel
  // cuando es por condición → filtrados / total panel
  const totalConLiq = Object.keys(liq).length;
  const pct = dashCondFilter
    ? (total ? Math.round(cantidad / total * 100) : 0)
    : (totalConLiq > 0 ? 100 : 0); // Todos siempre es 100% del universo

  const CAT_INFO = {
    's_colecta': { label: 'S/ Colecta', color: '#3b82f6' },
    'c_colecta': { label: 'C/ Colecta', color: '#10b981' },
    'sla':       { label: 'SLA Cumplido', color: '#8b5cf6' },
    'super_sla': { label: 'Super SLA', color: '#f59e0b' },
    'sin_cat':   { label: 'Sin categorizar', color: '#9ca3af' }
  };

  const condLabel = dashCondFilter || 'Todos';
  const condEmoji = dashCondFilter === 'Titular' ? '🔵' : dashCondFilter === 'Semi Titular' ? '🟡' : dashCondFilter === 'Suplente' ? '🟣' : '⚪';

  const body = document.getElementById('dash-conductores-panel-body');
  if (!total) {
    body.innerHTML = '<div class="empty-state"><div class="empty-sub">Sin conductores en el panel</div></div>';
    return;
  }

  // ── Distribución por categorización (headcount) ──────────────────────────
  // El universo depende del filtro:
  // - Con condición → solo conductores del panel con esa condición (filtrados)
  // - Sin filtro (Todos) → todos los conductores que tienen liquidación en el XLS;
  //   los que no están en el panel se cuentan como "Sin categorizar"
  const catCount = {};

  if (dashCondFilter) {
    // Filtro por condición: solo los del panel filtrados
    filtrados.forEach(c => {
      const cat = c.categoria || 'sin_cat';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
  } else {
    // Todos: usar los conductores reales del XLS (los que tienen liquidación)
    // Armar mapa nombre→categoría desde el panel
    const panelMap = {};
    AppData.panelConductores.forEach(c => {
      panelMap[c.nombre.toUpperCase().trim()] = c.categoria || 'sin_cat';
    });
    // Recorrer todos los conductores con liquidación
    Object.keys(liq).forEach(nombre => {
      const nNorm = nombre.toUpperCase().trim();
      const cat = panelMap[nNorm] || 'sin_cat';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
  }

  // Total real para los porcentajes: conductores únicos con liquidación (filtro Todos)
  // o cantidad de filtrados (filtro por condición)
  const totalParaPct = dashCondFilter ? cantidad : Object.keys(liq).length;

  // ── Facturación ──────────────────────────────────────────────────────────
  // Monto total general = TODOS los conductores con liquidación (base real)
  const totalMontoGeneral = Object.values(liq).reduce((s, d) => s + d.total, 0);

  let montoGrupo = 0;
  const liqPorConductor = []; // { nombre, monto }

  if (!dashCondFilter) {
    // Filtro "Todos": monto grupo = total general, incluir todos los conductores con liq
    montoGrupo = totalMontoGeneral;
    Object.entries(liq).forEach(([nombre, d]) => {
      liqPorConductor.push({ nombre, monto: d.total });
    });
  } else {
    // Filtro por condición: solo conductores del panel con esa condición
    const nombresFilterSet = new Set(filtrados.map(c => c.nombre.toUpperCase().trim()));
    Object.entries(liq).forEach(([nombre, d]) => {
      if (nombresFilterSet.has(nombre.toUpperCase().trim())) {
        montoGrupo += d.total;
        liqPorConductor.push({ nombre, monto: d.total });
      }
    });
  }

  const pctFacturacion = totalMontoGeneral > 0 ? Math.round(montoGrupo / totalMontoGeneral * 100) : 0;
  liqPorConductor.sort((a, b) => b.monto - a.monto);
  const maxMonto = liqPorConductor.length ? liqPorConductor[0].monto : 1;
  const top8 = liqPorConductor.slice(0, 8);

  // ── Distribución por categorización (barras) ─────────────────────────────
  const catRows = Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, cnt]) => {
      const info = CAT_INFO[cat] || { label: cat, color: '#9ca3af' };
      const catPct = totalParaPct ? Math.round(cnt / totalParaPct * 100) : 0;
      return `<div class="dash-bar-row">
        <span class="lbl"><span class="dot" style="background:${info.color}"></span>${info.label}</span>
        <span class="dash-bar-track"><span class="dash-bar-fill" style="width:${catPct}%;background:${info.color}"></span></span>
        <span class="meta"><b style="color:${info.color}">${catPct}%</b><span>${cnt}</span></span>
      </div>`;
    }).join('');

  // ── Participación en facturación por conductor (ranking) ─────────────────
  const factRows = top8.length ? top8.map(({ nombre, monto }) => {
    const partPct = montoGrupo > 0 ? Math.round(monto / montoGrupo * 100) : 0;
    return `<div class="dash-rank-row">
      <div class="conductor-avatar" style="background:${avatarColor(nombre)};width:26px;height:26px;font-size:9px;flex-shrink:0">${initials(nombre)}</div>
      <span class="nom">${nombre}</span>
      <span class="amt">${fmtPeso(monto)}<span>${partPct}%</span></span>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:var(--text-muted);padding:10px 0">Sin liquidaciones para esta condición</div>';

  body.innerHTML = `
    <div class="dash-cond-grid">
      <div>
        <div class="dash-subtitle">Distribución por categorización · <b style="color:var(--text-secondary)">${dashCondFilter ? cantidad : totalConLiq} conductores</b></div>
        ${catRows || '<div style="color:var(--text-muted);font-size:12px">Sin conductores</div>'}
      </div>
      <div>
        <div class="dash-subtitle">Participación en facturación${dashCondFilter ? ' · ' + condLabel : ''} · <b style="color:var(--text-secondary)">${fmtPeso(montoGrupo)}</b></div>
        ${factRows}
        ${liqPorConductor.length > 8 ? '<div style="font-size:11px;color:var(--text-muted);margin-top:10px;text-align:center">+ ' + (liqPorConductor.length - 8) + ' conductores más</div>' : ''}
      </div>
    </div>`;
}

// ── Estado filtro de fechas del dashboard ───────────────────────────────────
let dashFechaPreset = 'todo'; // 'todo' | 'hoy' | 'semana' | 'mes' | 'personalizado'

// Convierte DD/MM/YYYY → objeto Date (mediodia para evitar problemas de TZ)
function parseFechaReg(fechaStr) {
  if (!fechaStr) return null;
  try {
    if (String(fechaStr).includes('/')) {
      const parts = String(fechaStr).split('/');
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d, 12, 0, 0);
      }
    }
    // YYYY-MM-DD (desde input date nativo)
    if (String(fechaStr).match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [y, m, d] = fechaStr.split('-').map(Number);
      return new Date(y, m - 1, d, 12, 0, 0);
    }
    const parsed = new Date(fechaStr);
    return isNaN(parsed) ? null : parsed;
  } catch(e) { return null; }
}

// Convierte YYYY-MM-DD (valor de input nativo) a Date al inicio del día
function parseFechaInput(val) {
  if (!val) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0);
}

function getDashFechaRango() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (dashFechaPreset === 'todo') return null;
  if (dashFechaPreset === 'hoy') {
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
    return { desde: hoy, hasta: fin };
  }
  if (dashFechaPreset === 'semana') {
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);
    const dom = new Date(lunes);
    dom.setDate(lunes.getDate() + 6);
    dom.setHours(23, 59, 59);
    return { desde: lunes, hasta: dom };
  }
  if (dashFechaPreset === 'mes') {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1, 0, 0, 0);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);
    return { desde: ini, hasta: fin };
  }
  if (dashFechaPreset === 'personalizado') {
    const desdeEl = document.getElementById('dash-fecha-desde');
    const hastaEl = document.getElementById('dash-fecha-hasta');
    const desdeVal = desdeEl ? desdeEl.value : '';
    const hastaVal = hastaEl ? hastaEl.value : '';
    if (!desdeVal && !hastaVal) return null;
    const desde = desdeVal ? parseFechaInput(desdeVal) : null;
    const hasta = hastaVal ? new Date(new Date(parseFechaInput(hastaVal)).setHours(23, 59, 59)) : null;
    return { desde, hasta };
  }
  return null;
}

function filtrarRecordsPorFecha(records) {
  const rango = getDashFechaRango();
  if (!rango) return records;
  return records.filter(r => {
    const f = parseFechaReg(r.fecha);
    if (!f) return false;
    if (rango.desde && f < rango.desde) return false;
    if (rango.hasta && f > rango.hasta) return false;
    return true;
  });
}

function setDashFechaPreset(btn, preset) {
  dashFechaPreset = preset;
  document.querySelectorAll('.dash-fecha-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const customDiv = document.getElementById('dash-fecha-custom');
  customDiv.style.display = preset === 'personalizado' ? 'flex' : 'none';
  renderDashboard();
}

function renderDashboard() {
  const rango = getDashFechaRango();
  const recordsFiltrados = filtrarRecordsPorFecha(AppData.records);

  // Recalcular liquidaciones solo sobre registros del período
  // Formato compatible con calcLiquidaciones(): { conductor: { total, filas, ... } }
  const liqFecha = {};
  recordsFiltrados.forEach(r => {
    const cond = conductorCanonico(r.cadete);
    if (!cond) return;
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = contabilizaRegistro(r);
    if (!liqFecha[cond]) liqFecha[cond] = { total: 0, filas: [], filas_excluidas: [] };
    if (contabiliza) {
      const p = getPrecio(cond, zona);
      const precio = precioManualDe(r) !== null ? precioManualDe(r) : p.precio;
      liqFecha[cond].total += precio;
      liqFecha[cond].filas.push({ zona, precio });
    } else {
      liqFecha[cond].filas_excluidas.push({ zona, estado: r.estado });
    }
  });

  const conductores = Object.keys(liqFecha);
  const totalMonto = Object.values(liqFecha).reduce((s, v) => s + v.total, 0);
  const totalRecs = recordsFiltrados.length;
  const totalEntregados = recordsFiltrados.filter(r => esEstadoEntregado(r.estado)).length;
  const totalExcluidos = totalRecs - totalEntregados;

  // Etiqueta del período seleccionado
  const fmt = d => d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  let labelPeriodo = '';
  if (dashFechaPreset === 'todo') {
    labelPeriodo = '— todos los registros';
  } else if (rango) {
    if (rango.desde && rango.hasta) {
      labelPeriodo = fmt(rango.desde) + ' → ' + fmt(rango.hasta);
    } else if (rango.desde) {
      labelPeriodo = 'Desde ' + fmt(rango.desde);
    } else if (rango.hasta) {
      labelPeriodo = 'Hasta ' + fmt(rango.hasta);
    }
  } else if (dashFechaPreset === 'personalizado') {
    labelPeriodo = 'Seleccioná un rango de fechas';
  }
  const labelEl = document.getElementById('dash-fecha-label');
  if (labelEl) labelEl.textContent = labelPeriodo;

  const promedioPorConductor = conductores.length ? Math.round(totalMonto / conductores.length) : 0;

  document.getElementById('metric-total').textContent = fmtPeso(totalMonto);
  document.getElementById('metric-sub-total').textContent = totalEntregados + ' entregados · ' + totalExcluidos + ' en otros estados';
  document.getElementById('metric-conductores').textContent = conductores.length;
  document.getElementById('metric-promedio').textContent = fmtPeso(promedioPorConductor);
  document.getElementById('metric-promedio-sub').textContent = conductores.length + ' conductores en el período';
  document.getElementById('metric-panel-total').textContent = AppData.panelConductores.length;
  document.getElementById('sidebar-conductor-count').textContent = conductores.length + ' conductores';
  document.getElementById('sidebar-record-count').textContent = AppData.records.length
    ? (AppData.records.length + ' registros' + (AppData.historialCompleto ? ' (historial completo)' : ' · últimos ' + VENTANA_DIAS_REGISTROS + ' días'))
    : 'Sin datos cargados';
  document.getElementById('no-data-alert').style.display = AppData.records.length ? 'none' : 'flex';

  // Panel conductores por condición (pasa liqFecha para usar el período)
  renderDashConductoresPanel(liqFecha);

  // Reportes integrados (por zona / por conductor), respetan el mismo período.
  if (typeof renderZonaReport === 'function') renderZonaReport();
  if (typeof renderConductorReport === 'function') renderConductorReport();
}

// ===== LIQUIDACIONES =====
// ── Estado filtro fechas de liquidaciones ────────────────────────────────────
