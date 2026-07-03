let liqFechaPreset = 'todo';

function setLiqFechaPreset(btn, preset) {
  liqFechaPreset = preset;
  document.querySelectorAll('.liq-fecha-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const customDiv = document.getElementById('liq-fecha-custom');
  customDiv.style.display = preset === 'personalizado' ? 'flex' : 'none';
  renderLiquidaciones();
}

function getLiqFechaRango() {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  if (liqFechaPreset === 'todo') return null;
  if (liqFechaPreset === 'hoy') {
    return { desde: hoy, hasta: new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23,59,59) };
  }
  if (liqFechaPreset === 'semana') {
    const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay()+6)%7)); lunes.setHours(0,0,0,0);
    const dom = new Date(lunes); dom.setDate(lunes.getDate()+6); dom.setHours(23,59,59);
    return { desde: lunes, hasta: dom };
  }
  if (liqFechaPreset === 'mes') {
    return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1, 0,0,0),
             hasta: new Date(hoy.getFullYear(), hoy.getMonth()+1, 0, 23,59,59) };
  }
  if (liqFechaPreset === 'personalizado') {
    const dEl = document.getElementById('liq-fecha-desde');
    const hEl = document.getElementById('liq-fecha-hasta');
    const dVal = dEl ? dEl.value : ''; const hVal = hEl ? hEl.value : '';
    if (!dVal && !hVal) return null;
    const desde = dVal ? parseFechaInput(dVal) : null;
    const hasta = hVal ? new Date(parseFechaInput(hVal).setHours(23,59,59)) : null;
    return { desde, hasta };
  }
  return null;
}

function filtrarRecordsLiq(records) {
  const rango = getLiqFechaRango();
  if (!rango) return records;
  return records.filter(r => {
    const f = parseFechaReg(r.fecha);
    if (!f) return false;
    if (rango.desde && f < rango.desde) return false;
    if (rango.hasta && f > rango.hasta) return false;
    return true;
  });
}

function renderLiquidaciones() {
  // Calcular liquidaciones sobre los registros filtrados por fecha
  const recordsFiltrados = filtrarRecordsLiq(AppData.records);
  const liqBase = {};
  recordsFiltrados.forEach(r => {
    const cond = (r.cadete || '').trim(); if (!cond) return;
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = estadoNorm === ESTADO_CONTABILIZA || ESTADOS_CONTABILIZAN.has(estadoNorm);
    if (!liqBase[cond]) liqBase[cond] = { total:0, filas:[], filas_excluidas:[], conductor: cond };
    if (contabiliza) {
      const p = getPrecio(cond, zona);
      liqBase[cond].total += p.precio;
      liqBase[cond].filas.push({ zona, precio: p.precio, subtotal: p.precio, tipo: p.tipo, es_super: p.es_super });
    } else {
      liqBase[cond].filas_excluidas.push({ zona, estado: r.estado });
    }
  });

  // Actualizar label de período
  const rango = getLiqFechaRango();
  const fmt = d => d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  let labelP = '— todos los registros';
  if (rango) {
    if (rango.desde && rango.hasta) labelP = fmt(rango.desde) + ' → ' + fmt(rango.hasta);
    else if (rango.desde) labelP = 'Desde ' + fmt(rango.desde);
    else if (rango.hasta) labelP = 'Hasta ' + fmt(rango.hasta);
  } else if (liqFechaPreset === 'personalizado') { labelP = 'Seleccioná un rango'; }
  const labelEl = document.getElementById('liq-fecha-label');
  if (labelEl) labelEl.textContent = labelP;

  const liq = liqBase;
  const search = document.getElementById('liq-search').value.toLowerCase();
  const filterCondicion = document.getElementById('liq-filter-condicion').value;
  let conductores = Object.keys(liq).filter(c => c.toLowerCase().includes(search));

  // Filtrar por condición del panel de conductores
  if (filterCondicion) {
    conductores = conductores.filter(c => {
      const panelEntry = AppData.panelConductores.find(x => x.nombre.toUpperCase() === c.toUpperCase());
      if (filterCondicion === 'sin_asignar') {
        return !panelEntry || !panelEntry.condicion;
      }
      return panelEntry && panelEntry.condicion === filterCondicion;
    });
  }

  const body = document.getElementById('liq-table-body');
  if (!conductores.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">Sin liquidaciones</div><div class="empty-sub">Importá una base de datos</div></div></td></tr>`;
    return;
  }

  conductores.sort((a, b) => liq[b].total - liq[a].total);
  body.innerHTML = conductores.map(c => {
    const d = liq[c];
    const sSin = d.filas.filter(f => f.tipo === 's_colecta');
    const sCon = d.filas.filter(f => f.tipo === 'c_colecta');
    const sSLA = d.filas.filter(f => f.tipo === 'sla');
    const sSuper = d.filas.filter(f => f.es_super);
    const cat = AppData.panelConductores.find(x => x.nombre.toUpperCase() === c.toUpperCase());
    return `<tr>
      <td>
        <div class="conductor-cell">
          <div class="conductor-avatar" style="background:${avatarColor(c)}">${initials(c)}</div>
          <strong>${c}</strong>
        </div>
      </td>
      <td><span class="badge ${cat ? 'badge-blue' : 'badge-gray'}">${cat ? tipoLabel(cat.categoria === 'super_sla' ? 'sla' : cat.categoria) : 'Sin categorizar'}</span></td>
      <td class="mono">${d.filas.length} <span class="muted" style="font-size:11px">(${d.filas_excluidas.length} no entreg.)</span></td>
      <td class="mono">${sSin.length} — ${fmtPeso(sSin.reduce((s,f) => s+f.subtotal,0))}</td>
      <td class="mono">${sCon.length} — ${fmtPeso(sCon.reduce((s,f) => s+f.subtotal,0))}</td>
      <td class="mono">${sSLA.length} — ${fmtPeso(sSLA.reduce((s,f) => s+f.subtotal,0))}</td>
      <td class="mono">${sSuper.length ? `<span class="tag super-sla">⭐ ${sSuper.length} recorridos</span>` : '<span class="muted">—</span>'}</td>
      <td class="mono"><strong>${fmtPeso(d.total)}</strong></td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="showConductorModal('${c}')">Ver detalle</button>
          <button class="btn btn-sm btn-primary" onclick="openLiqModal('${c}')">📄 Generar</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ===== CONDUCTOR SELECT & DETAIL =====
