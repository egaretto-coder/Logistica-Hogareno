function renderZonaReport() {
  const zonaData = {};
  const liq = calcLiquidaciones();
  AppData.records.forEach(r => {
    const z = getZonaEfectiva(r);
    if (!z) return;
    if (!zonaData[z]) zonaData[z] = { zona: z, count: 0, conductores: new Set(), total: 0 };
    zonaData[z].count++;
    zonaData[z].conductores.add(r.cadete);
  });

  Object.keys(liq).forEach(c => {
    liq[c].filas.forEach(f => {
      if (zonaData[f.zona]) zonaData[f.zona].total += f.subtotal;
    });
  });

  const rows = Object.values(zonaData).sort((a,b) => b.total - a.total);
  const body = document.getElementById('zona-table-body');
  body.innerHTML = rows.length ? rows.map(z => {
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
  }).join('') : `<tr><td colspan="6"><div class="empty-state"><div class="empty-sub">Sin datos</div></div></td></tr>`;
}

// ===== REPORTE CONDUCTOR =====
function renderConductorReport() {
  const liq = calcLiquidaciones();
  const conductores = Object.keys(liq).sort((a,b) => liq[b].total - liq[a].total);
  const body = document.getElementById('rep-cond-body');
  body.innerHTML = conductores.length ? conductores.map(c => {
    const d = liq[c];
    const cat = AppData.panelConductores.find(x => x.nombre.toUpperCase() === c.toUpperCase());
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
      <td>${tieneSuper ? '<span class="tag super-sla">⭐ Sí</span>' : '—'}</td>
      <td><button class="btn btn-sm btn-primary" onclick="exportPDF('${c}')">PDF</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state"><div class="empty-sub">Sin datos</div></div></td></tr>`;
}

// ===== FILE UPLOAD =====
