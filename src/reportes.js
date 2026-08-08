// ═══ REPORTES POR ZONA Y POR CONDUCTOR (integrados en el Dashboard) ═════════
// Respetan el período seleccionado en el Dashboard (filtrarRecordsPorFecha).

// Etiqueta del período activo del Dashboard (para el encabezado de los PDF).
function dashPeriodoLabel() {
  const t = (document.getElementById('dash-fecha-label')?.textContent || '').replace(/^—\s*/, '').trim();
  return t || 'Todos los registros';
}

// Datos del reporte por zona (ordenados por total desc) del período del Dashboard.
function computeZonaReport() {
  const recs = (typeof filtrarRecordsPorFecha === 'function') ? filtrarRecordsPorFecha(AppData.records) : AppData.records;
  const liq = calcLiquidaciones(recs);
  const zonaData = {};
  recs.forEach(r => {
    const z = getZonaEfectiva(r);
    if (!z) return;
    if (!zonaData[z]) zonaData[z] = { zona: z, count: 0, conductores: new Set(), total: 0 };
    zonaData[z].count++;
    zonaData[z].conductores.add(conductorCanonico(r.cadete));
  });
  Object.keys(liq).forEach(c => {
    liq[c].filas.forEach(f => { if (zonaData[f.zona]) zonaData[f.zona].total += f.subtotal; });
  });
  return Object.values(zonaData).sort((a, b) => b.total - a.total);
}

function renderZonaReport() {
  const rows = computeZonaReport();
  // Buscador por nombre de zona.
  const q = (document.getElementById('zona-report-search')?.value || '').toLowerCase().trim();
  const rowsView = q ? rows.filter(z => String(z.zona).toLowerCase().includes(q)) : rows;
  const cnt = document.getElementById('zona-report-count');
  if (cnt) cnt.textContent = q ? ('Mostrando ' + rowsView.length + ' de ' + rows.length + ' zonas') : (rows.length + ' zona' + (rows.length !== 1 ? 's' : ''));

  const body = document.getElementById('zona-table-body');
  if (!body) return;
  body.innerHTML = rowsView.length ? rowsView.map(z => {
    const tarifa = AppData.tarifas.find(t => t.zona.toUpperCase() === z.zona.toUpperCase());
    const avgPerRec = z.count ? z.total / z.count : 0;
    return `<tr>
      <td><strong>${z.zona}</strong></td>
      <td><span class="badge badge-gray">${tarifa?.categoria || '—'}</span></td>
      <td class="mono">${z.count}</td>
      <td class="mono">${z.conductores.size}</td>
      <td class="mono"><strong>${fmtPeso(z.total)}</strong></td>
      <td class="mono">${fmtPeso(avgPerRec)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6"><div class="empty-state"><div class="empty-sub">${q ? 'Ninguna zona coincide con “' + q + '”' : 'Sin datos en el período'}</div></div></td></tr>`;
}

// ===== REPORTE CONDUCTOR =====
function computeConductorReport() {
  const recs = (typeof filtrarRecordsPorFecha === 'function') ? filtrarRecordsPorFecha(AppData.records) : AppData.records;
  const liq = calcLiquidaciones(recs);
  const conductores = Object.keys(liq).sort((a, b) => liq[b].total - liq[a].total);
  return { liq, conductores };
}

function renderConductorReport() {
  const { liq, conductores } = computeConductorReport();

  // Buscador por nombre de conductor.
  const q = (document.getElementById('cond-report-search')?.value || '').toLowerCase().trim();
  const lista = q ? conductores.filter(c => String(c).toLowerCase().includes(q)) : conductores;
  const cnt = document.getElementById('cond-report-count');
  if (cnt) cnt.textContent = q ? ('Mostrando ' + lista.length + ' de ' + conductores.length + ' conductores') : (conductores.length + ' conductor' + (conductores.length !== 1 ? 'es' : ''));

  const body = document.getElementById('rep-cond-body');
  if (!body) return;
  body.innerHTML = lista.length ? lista.map(c => {
    const d = liq[c];
    const cat = panelConductorDe(c);
    const zonas = [...new Set(d.filas.map(f => f.zona))];
    const tieneSuper = d.filas.some(f => f.es_super);
    return `<tr>
      <td>
        <div class="conductor-cell">
          <div class="conductor-avatar" style="background:${avatarColor(c)}">${initials(c)}</div>
          <strong>${c}</strong>
        </div>
      </td>
      <td><span class="badge ${cat ? 'badge-blue' : 'badge-gray'}">${cat ? tipoLabel(cat.categoria === 'super_sla' ? 'sla' : cat.categoria) : 'Sin categorizar'}</span></td>
      <td class="muted" style="font-size:12px">${zonas.slice(0,3).join(', ')}${zonas.length > 3 ? ` +${zonas.length-3}` : ''}</td>
      <td class="mono">${d.filas.length}</td>
      <td class="mono"><strong>${fmtPeso(d.total)}</strong></td>
      <td>${tieneSuper ? '<span class="tag super-sla"><i class="ic ic-star"></i> Sí</span>' : '—'}</td>
      <td><button class="btn btn-sm btn-primary" onclick="exportPDFConductor('${c}')">PDF</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state"><div class="empty-sub">${q ? 'Ningún conductor coincide con “' + q + '”' : 'Sin datos en el período'}</div></div></td></tr>`;
}

// ── Export PDF de los reportes (tabla) — respetan el período del Dashboard ──
function exportReporteZonaPDF() {
  const rows = computeZonaReport();
  if (!rows.length) { alert('Sin datos de zona para exportar en el período seleccionado.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Reporte por zona', 14, 17);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  doc.text('Período: ' + dashPeriodoLabel() + '   ·   Generado: ' + new Date().toLocaleString('es-AR'), 14, 23);
  const totalGeneral = rows.reduce((s, z) => s + z.total, 0);
  const totalRec = rows.reduce((s, z) => s + z.count, 0);
  const body = rows.map(z => {
    const tarifa = AppData.tarifas.find(t => t.zona.toUpperCase() === z.zona.toUpperCase());
    return [z.zona, tarifa?.categoria || '—', z.count, z.conductores.size, fmtPeso(z.total), fmtPeso(z.count ? z.total / z.count : 0)];
  });
  doc.autoTable({
    startY: 28,
    head: [['Zona', 'Categoría', 'Recorridos', 'Conductores', 'Total liquidado', 'Prom./recorrido']],
    body,
    foot: [[{ content: 'TOTAL · ' + rows.length + ' zonas · ' + totalRec + ' recorridos', colSpan: 4, styles: { halign: 'right' } }, fmtPeso(totalGeneral), '']],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });
  doc.save('Reporte_por_zona_' + new Date().toLocaleDateString('es-AR').replace(/\//g, '-') + '.pdf');
  showToast('📥 Reporte por zona descargado');
}

function exportReporteConductorPDF() {
  const { liq, conductores } = computeConductorReport();
  if (!conductores.length) { alert('Sin datos de conductor para exportar en el período seleccionado.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Reporte por conductor', 14, 17);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  doc.text('Período: ' + dashPeriodoLabel() + '   ·   Generado: ' + new Date().toLocaleString('es-AR'), 14, 23);
  const totalGeneral = conductores.reduce((s, c) => s + liq[c].total, 0);
  const body = conductores.map(c => {
    const d = liq[c];
    const cat = panelConductorDe(c);
    const zonas = [...new Set(d.filas.map(f => f.zona))];
    return [
      c,
      cat ? tipoLabel(cat.categoria === 'super_sla' ? 'sla' : cat.categoria) : 'Sin categorizar',
      zonas.slice(0, 3).join(', ') + (zonas.length > 3 ? ' +' + (zonas.length - 3) : ''),
      d.filas.length,
      fmtPeso(d.total),
      d.filas.some(f => f.es_super) ? 'Sí' : '—'
    ];
  });
  doc.autoTable({
    startY: 28,
    head: [['Conductor', 'Categoría', 'Zonas visitadas', 'Recorridos', 'Total liquidado', 'Super SLA']],
    body,
    foot: [[{ content: 'TOTAL · ' + conductores.length + ' conductores', colSpan: 4, styles: { halign: 'right' } }, fmtPeso(totalGeneral), '']],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' } },
    margin: { left: 14, right: 14 }
  });
  doc.save('Reporte_por_conductor_' + new Date().toLocaleDateString('es-AR').replace(/\//g, '-') + '.pdf');
  showToast('📥 Reporte por conductor descargado');
}

// ===== FILE UPLOAD =====
