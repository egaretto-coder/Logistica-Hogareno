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
  const conductores = conductoresFiltradosLiq();
  conductores.forEach(c => { if (marcado) liqSeleccion.add(c); else liqSeleccion.delete(c); });
  document.querySelectorAll('.liq-row-check').forEach(ch => { ch.checked = !!marcado; });
  actualizarBotonDescargaLiq(conductores);
}

// Lo que se va a descargar: los tildados que estén dentro del filtro; si no hay
// ninguno tildado, todo lo que muestra la tabla.
function seleccionParaDescargar(liq) {
  const filtrados = conductoresFiltradosLiq(liq).filter(c => !liq || (liq[c] && liq[c].filas.length));
  const elegidos = filtrados.filter(c => liqSeleccion.has(c));
  return { filtrados, conductores: elegidos.length ? elegidos : filtrados, haySeleccion: elegidos.length > 0 };
}

function actualizarBotonDescargaLiq(conductores) {
  const filtrados = conductores || conductoresFiltradosLiq();
  const nSel = filtrados.filter(c => liqSeleccion.has(c)).length;
  const btn = document.getElementById('liq-btn-descargar');
  if (btn) btn.innerHTML = '<i class="ic ic-download"></i> ' + (nSel
    ? 'Descargar ' + nSel + ' seleccionada' + (nSel > 1 ? 's' : '') + ' (PDF)'
    : 'Descargar las ' + filtrados.length + ' (PDF)');
  const unico = document.getElementById('liq-btn-unpdf');
  if (unico) unico.style.display = (nSel || filtrados.length) > 1 ? '' : 'none';
  // El "todas" de la cabecera refleja lo que hay tildado dentro del filtro.
  const all = document.getElementById('liq-check-all');
  if (all) {
    all.checked = filtrados.length > 0 && nSel === filtrados.length;
    all.indeterminate = nSel > 0 && nSel < filtrados.length;
  }
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
  const conductores = conductoresFiltradosLiq(liq);

  const body = document.getElementById('liq-table-body');
  if (!conductores.length) {
    body.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="empty-icon"><i class="ic ic-dollar"></i></div><div class="empty-title">Sin liquidaciones</div><div class="empty-sub">Importá una base de datos</div></div></td></tr>`;
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
  actualizarBotonDescargaLiq(conductores);
  body.innerHTML = conductores.map(c => {
    const d = liq[c];
    const cEsc = String(c).replace(/'/g, "\\'");
    const { imp, neto } = netos[c];
    // Debajo del neto se dice qué lo movió: sin esa línea, un total distinto al
    // bruto parece un error de cálculo en vez de un descuento aplicado.
    const partes = [];
    if (imp.km > 0) partes.push('<span style="color:#059669">+' + fmtPeso(imp.km) + ' km</span>');
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
