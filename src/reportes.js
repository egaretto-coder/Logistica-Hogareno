// ═══ REPORTES POR ZONA Y POR CONDUCTOR (integrados en el Dashboard) ═════════
// Respetan el período seleccionado en el Dashboard (filtrarRecordsPorFecha).

// Etiqueta del período activo del Dashboard (para el encabezado de los PDF).
function dashPeriodoLabel() {
  const t = (document.getElementById('dash-fecha-label')?.textContent || '').replace(/^—\s*/, '').trim();
  return t || 'Todos los registros';
}

// ── Reporte por zona ────────────────────────────────────────────────────────
// Solo se ANALIZAN las zonas del TARIFARIO. Todo lo demás —una localidad suelta
// que el listado trajo como zona ("Turdera", "La Reja"), la misma con y sin
// tilde ("PLATANOS" / "PLÁTANOS"), un envío sin zona— no es una zona: es trabajo
// pendiente para el administrativo. Medido en producción: 73 zonas del tarifario
// con 60.873 envíos contra 59 "zonas" sueltas con 589 —el 0,96%—, así que la
// tabla mostraba 132 filas de las cuales casi la mitad eran ruido con menos del
// 1% del volumen, y no se podía leer.
// Se agrupan todas en UNA fila, "Fuera del tarifario", que se ve hasta que el
// administrativo las reasigna. No se esconden: son envíos que se pagaron.
//
// La zona se resuelve por ALIAS antes de comparar, igual que getPrecio: un envío
// en PRESIDENTE PERON está tarifado como GUERNICA y tiene que contar ahí, no
// caer como "fuera del tarifario" mostrando un problema que no existe.
const FUERA_TARIFARIO = 'Fuera del tarifario';

function computeZonaReport() {
  // MISMA fuente que los KPIs: período Y condición. Si el reporte se filtrara
  // solo por fecha, tildar "Titulares" dejaría los KPIs hablando de titulares y
  // la tabla de abajo mostrando a todos.
  const recs = (typeof recordsDelDashboard === 'function') ? recordsDelDashboard() : AppData.records;
  // Sin filtro, devuelve el MISMO array: pasarlo igual anulaba el caché de
  // calcLiquidaciones (solo cachea la base entera) y los dos reportes del
  // Dashboard recalculaban 47.684 envíos cada uno.
  const liq = calcLiquidaciones(recs === AppData.records ? undefined : recs);

  const delTarifario = new Set(
    (typeof zonasDelTarifario === 'function') ? zonasDelTarifario()
      : (AppData.tarifas || []).map(t => String(t.zona || '').trim().toUpperCase()));
  const canon = z => (typeof zonaCanonica === 'function') ? zonaCanonica(z) : String(z || '').trim().toUpperCase();

  const zonaData = {};
  const fuera = { zona: FUERA_TARIFARIO, count: 0, conductores: new Set(), total: 0,
                  sinZona: 0, sueltas: new Map() };
  // ¿A qué acumulador va esta zona canónica? Al del tarifario, o al de afuera.
  const bucket = z => {
    if (z && delTarifario.has(z)) {
      if (!zonaData[z]) zonaData[z] = { zona: z, count: 0, conductores: new Set(), total: 0 };
      return zonaData[z];
    }
    return fuera;
  };

  // 1) Cuántos envíos y qué conductores, desde los RECORRIDOS.
  recs.forEach(rec => {
    const z = canon(getZonaEfectiva(rec));
    const b = bucket(z);
    b.count++;
    const cond = conductorCanonico(rec.cadete);
    if (cond) b.conductores.add(cond);
    if (b === fuera) {
      if (!z) { fuera.sinZona++; return; }
      const s = fuera.sueltas.get(z) || { zona: z, count: 0, total: 0 };
      s.count++; fuera.sueltas.set(z, s);
    }
  });

  // 2) La plata, desde el MISMO cálculo que paga —una pasada por sus filas, igual
  // que antes—: si se sumara envío por envío habría dos cuentas para el mismo
  // número. Solo las filas que contabilizan tienen subtotal, que es lo correcto.
  Object.keys(liq).forEach(c => liq[c].filas.forEach(f => {
    const z = canon(f.zona);
    const b = bucket(z);
    b.total += _num(f.subtotal);
    if (b === fuera && z) {
      const s = fuera.sueltas.get(z) || { zona: z, count: 0, total: 0 };
      s.total += _num(f.subtotal); fuera.sueltas.set(z, s);
    }
  }));

  const zonas = Object.values(zonaData).sort((a, b) => b.total - a.total);
  const condTar = new Set();
  zonas.forEach(z => z.conductores.forEach(c => condTar.add(c)));
  const tot = {
    zonas: zonas.length,
    count: zonas.reduce((s, z) => s + z.count, 0),
    total: zonas.reduce((s, z) => s + z.total, 0),
    conductores: condTar.size
  };
  // El "costo variable promedio": lo que cuesta en promedio un recorrido de las
  // zonas tarifadas. Es el número del análisis, y por eso NO mezcla lo de afuera.
  tot.promedio = tot.count ? tot.total / tot.count : 0;

  return {
    zonas,
    fuera: fuera.count ? fuera : null,
    tot,
    // El general incluye lo de afuera: es lo que tiene que cerrar contra la
    // liquidación. Sin esta línea, un total que deja 589 envíos afuera parece
    // que perdió plata.
    general: { count: tot.count + fuera.count, total: tot.total + fuera.total }
  };
}

function renderZonaReport() {
  const rep = computeZonaReport();
  const rows = rep.zonas;
  // Buscador por nombre de zona.
  const q = (document.getElementById('zona-report-search')?.value || '').toLowerCase().trim();
  const rowsView = q ? rows.filter(z => String(z.zona).toLowerCase().includes(q)) : rows;
  // La fila de afuera sigue al buscador: aparece sin búsqueda, o si lo que se
  // busca es ella o alguna de las zonas que agrupa.
  const fueraVisible = rep.fuera && (!q ||
    FUERA_TARIFARIO.toLowerCase().includes(q) ||
    Array.from(rep.fuera.sueltas.keys()).some(z => String(z).toLowerCase().includes(q)));

  const cnt = document.getElementById('zona-report-count');
  if (cnt) cnt.textContent = q
    ? 'Mostrando ' + rowsView.length + ' de ' + rows.length + ' zonas'
    : rows.length + ' zona' + (rows.length !== 1 ? 's' : '') + ' del tarifario';

  const body = document.getElementById('zona-table-body');
  if (!body) return;

  const filaZona = z => {
    const tarifa = (AppData.tarifas || []).find(t => String(t.zona).toUpperCase() === String(z.zona).toUpperCase());
    const avg = z.count ? z.total / z.count : 0;
    return '<tr>' +
      '<td><strong>' + z.zona + '</strong></td>' +
      '<td><span class="badge badge-gray">' + ((tarifa && tarifa.categoria) || '—') + '</span></td>' +
      '<td class="mono">' + z.count.toLocaleString('es-AR') + '</td>' +
      '<td class="mono">' + z.conductores.size + '</td>' +
      '<td class="mono"><strong>' + fmtPeso(z.total) + '</strong></td>' +
      '<td class="mono">' + fmtPeso(avg) + '</td>' +
    '</tr>';
  };

  // La fila de afuera: qué son y cuántas, para que se sepa qué hay que reasignar.
  const filaFuera = () => {
    const f = rep.fuera;
    const detalle = [];
    if (f.sueltas.size) detalle.push(f.sueltas.size + ' zona(s) sin tarifa');
    if (f.sinZona) detalle.push(f.sinZona.toLocaleString('es-AR') + ' sin zona');
    detalle.push('no entran en el análisis');
    const top = Array.from(f.sueltas.values()).sort((a, b) => b.count - a.count).slice(0, 5)
      .map(x => x.zona + ' (' + x.count + ')').join(' · ');
    return '<tr style="background:#fffbeb" title="Se ven hasta que el administrativo les corrige la zona">' +
      '<td><strong style="color:#92400e">' + FUERA_TARIFARIO + '</strong>' +
        '<div style="font-size:10px;color:#92400e">' + detalle.join(' · ') + '</div>' +
        (top ? '<div style="font-size:10px;color:var(--text-muted)">' + top +
          (f.sueltas.size > 5 ? ' …' : '') + '</div>' : '') + '</td>' +
      '<td><span class="badge badge-gray">—</span></td>' +
      '<td class="mono">' + f.count.toLocaleString('es-AR') + '</td>' +
      '<td class="mono">' + f.conductores.size + '</td>' +
      '<td class="mono"><strong>' + fmtPeso(f.total) + '</strong></td>' +
      '<td class="mono">—</td>' +
    '</tr>';
  };

  body.innerHTML = (rowsView.length || fueraVisible)
    ? rowsView.map(filaZona).join('') + (fueraVisible ? filaFuera() : '')
    : '<tr><td colspan="6"><div class="empty-state"><div class="empty-sub">' +
      (q ? 'Ninguna zona coincide con “' + q + '”' : 'Sin datos en el período') + '</div></div></td></tr>';

  // ── El pie ────────────────────────────────────────────────────────────
  // Dos líneas y no una: el TOTAL DEL TARIFARIO es el número del análisis —y de
  // donde sale el costo promedio por recorrido—, y el GENERAL es el que tiene
  // que cerrar contra la liquidación. Con uno solo, o el análisis viene sucio o
  // el total parece que perdió plata.
  const foot = document.getElementById('zona-table-foot');
  if (!foot) return;
  if (!rows.length && !rep.fuera) { foot.innerHTML = ''; return; }

  // Con el buscador puesto el pie mide LO QUE SE ESTÁ VIENDO: un total que no
  // coincide con las filas de arriba es la peor forma de mostrar un número.
  const base = q ? rowsView : rows;
  const cV = base.reduce((s, z) => s + z.count, 0);
  const tV = base.reduce((s, z) => s + z.total, 0);
  const condV = new Set(); base.forEach(z => z.conductores.forEach(c => condV.add(c)));
  const promV = cV ? tV / cV : 0;

  foot.innerHTML =
    '<tr style="border-top:2px solid var(--border-strong)">' +
      '<td colspan="2" style="text-align:right;font-weight:700;padding-right:14px">' +
        (q ? 'TOTAL DE LO FILTRADO' : 'TOTAL DEL TARIFARIO') +
        '<div style="font-size:10px;font-weight:400;color:var(--text-muted)">' +
          base.length + ' zona(s)' + (q ? ' de ' + rows.length : '') + '</div></td>' +
      '<td class="mono" style="font-weight:700">' + cV.toLocaleString('es-AR') + '</td>' +
      '<td class="mono" style="font-weight:700">' + condV.size + '</td>' +
      '<td class="mono" style="font-weight:700">' + fmtPeso(tV) + '</td>' +
      '<td class="mono" style="font-weight:700">' + fmtPeso(promV) +
        '<div style="font-size:10px;font-weight:400;color:var(--text-muted)">costo promedio por recorrido</div></td>' +
    '</tr>' +
    (rep.fuera && !q
      ? '<tr><td colspan="2" style="text-align:right;font-weight:700;padding-right:14px">TOTAL GENERAL' +
          '<div style="font-size:10px;font-weight:400;color:var(--text-muted)">con lo que está fuera del tarifario</div></td>' +
        '<td class="mono" style="font-weight:700">' + rep.general.count.toLocaleString('es-AR') + '</td>' +
        '<td class="mono">—</td>' +
        '<td class="mono" style="font-weight:700">' + fmtPeso(rep.general.total) + '</td>' +
        '<td class="mono">—</td></tr>'
      : '');
}


// ===== REPORTE CONDUCTOR =====
function computeConductorReport() {
  // MISMA fuente que los KPIs: período Y condición. Si el reporte se filtrara
  // solo por fecha, tildar "Titulares" dejaría los KPIs hablando de titulares y
  // la tabla de abajo mostrando a todos.
  const recs = (typeof recordsDelDashboard === 'function') ? recordsDelDashboard() : AppData.records;
  // Sin filtro, devuelve el MISMO array: pasarlo igual anulaba el caché de
  // calcLiquidaciones (solo cachea la base entera) y los dos reportes del
  // Dashboard recalculaban 47.684 envíos cada uno.
  const liq = calcLiquidaciones(recs === AppData.records ? undefined : recs);
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
  const rep = computeZonaReport();
  const rows = rep.zonas;
  if (!rows.length && !rep.fuera) { alert('Sin datos de zona para exportar en el período seleccionado.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Reporte por zona', 14, 17);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  doc.text('Período: ' + dashPeriodoLabel() + '   ·   Generado: ' + new Date().toLocaleString('es-AR'), 14, 23);
  const body = rows.map(z => {
    const tarifa = AppData.tarifas.find(t => t.zona.toUpperCase() === z.zona.toUpperCase());
    return [z.zona, tarifa?.categoria || '—', z.count, z.conductores.size, fmtPeso(z.total), fmtPeso(z.count ? z.total / z.count : 0)];
  });
  // El papel dice lo mismo que la pantalla, incluido lo que quedó afuera: si el
  // PDF mostrara solo el tarifario, su total no cerraría contra la liquidación.
  if (rep.fuera) body.push([FUERA_TARIFARIO, '—', rep.fuera.count, rep.fuera.conductores.size, fmtPeso(rep.fuera.total), '—']);
  doc.autoTable({
    startY: 28,
    head: [['Zona', 'Categoría', 'Recorridos', 'Conductores', 'Total liquidado', 'Prom./recorrido']],
    body,
    foot: [
      [{ content: 'TOTAL DEL TARIFARIO · ' + rep.tot.zonas + ' zonas · ' + rep.tot.count + ' recorridos', colSpan: 4, styles: { halign: 'right' } },
       fmtPeso(rep.tot.total), fmtPeso(rep.tot.promedio)],
      [{ content: rep.fuera ? 'TOTAL GENERAL · ' + rep.general.count + ' recorridos' : '', colSpan: 4, styles: { halign: 'right' } },
       rep.fuera ? fmtPeso(rep.general.total) : '', '']
    ],
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
