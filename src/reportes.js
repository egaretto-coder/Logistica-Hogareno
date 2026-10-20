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
  // La TABLA y la DESCARGA salen del MISMO selector: filtrando cada una por su
  // cuenta, el archivo termina diciendo otra cosa que la pantalla (ver
  // vistaZonaReport, abajo, y el bug que eso ya causó).
  const vista = vistaZonaReport();
  const rep = vista.rep;
  const rows = rep.zonas;
  const q = vista.q;
  const rowsView = vista.rows;
  const fueraVisible = !!vista.fuera;

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

// El COSTO UNITARIO de cada conductor es su total dividido por LOS ENVÍOS QUE
// LO FORMAN (`filas`), igual que el KPI de arriba: los no entregados no se le
// pagan a nadie y meterlos en el denominador daría un unitario más barato que
// el real. Dividir un número por su propia cantidad es lo que impide que la
// tarjeta y la tabla se contradigan.
// La columna PDF se sacó: el papel del conductor se baja desde Liquidación de
// Conductores —que es donde se decide qué se le imputa y cuándo está lista— y
// acá invitaba a mandar uno armado sobre el período que el Dashboard tuviera
// puesto, que no es su semana de pago.
function renderConductorReport() {
  // Misma fuente que la descarga (ver vistaConductorReport).
  const vista = vistaConductorReport();
  const liq = vista.liq, conductores = vista.todos, q = vista.q, lista = vista.lista;
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
      <td class="mono">${d.filas.length ? fmtPeso(d.total / d.filas.length) : '—'}</td>
      <td>${tieneSuper ? '<span class="tag super-sla"><i class="ic ic-star"></i> Sí</span>' : '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state"><div class="empty-sub">${q ? 'Ningún conductor coincide con “' + q + '”' : 'Sin datos en el período'}</div></div></td></tr>`;
}

// ════════════════════════════════════════════════════════════════════════
//  LO QUE SE VE ES LO QUE SE BAJA
//
//  Los dos PDF que ya existían salían de computeZonaReport() /
//  computeConductorReport(), que NO aplican el buscador — ese filtro vivía
//  suelto dentro de cada render. Con "CABA" escrito, la pantalla mostraba una
//  fila y el papel traía las 73: un archivo que no dice lo que abarca es un
//  papel que miente, y es exactamente el bug que ya tuvo Liquidación de
//  conductores (la tabla filtraba y la descarga no).
//
//  Ahora la tabla y la descarga salen de ESTOS selectores, así no se pueden
//  desfasar, y cada archivo dice en su primera línea qué filtros tenía
//  puestos — mismo criterio que la descarga del plantel.
// ════════════════════════════════════════════════════════════════════════
function _repFechaArchivo() { return new Date().toLocaleDateString('es-AR').split('/').join('-'); }

// La línea que encabeza todo archivo: qué es, qué período y qué filtros. Sin
// esto, un archivo recortado no se distingue de uno completo.
function _repCabecera(titulo, filtros, extra) {
  return titulo + ' · ' + dashPeriodoLabel() + (extra ? ' · ' + extra : '') +
    (filtros && filtros.length ? ' · FILTRADO: ' + filtros.join(' · ') : '') +
    ' · Generado el ' + new Date().toLocaleString('es-AR');
}

// Los importes van como NÚMERO y no como texto con "$": el Excel se baja
// justamente para sumarlo.
function _repExcel(nombreArchivo, hojas) {
  const wb = XLSX.utils.book_new();
  hojas.forEach(h => {
    const ws = XLSX.utils.aoa_to_sheet(h.aoa);
    if (h.anchos) ws['!cols'] = h.anchos.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, h.nombre);
  });
  XLSX.writeFile(wb, nombreArchivo);
}

// El filtro por condición del Dashboard alcanza a los tres reportes menos a
// Clientes (lo que se le factura a un cliente no depende de quién se lo llevó).
function _repFiltroCondicion(ps) {
  if (typeof dashCondLabel === 'function' && dashCondLabel()) ps.push('solo ' + dashCondLabel());
  return ps;
}

function vistaZonaReport() {
  const rep = computeZonaReport();
  const el = document.getElementById('zona-report-search');
  const q = ((el && el.value) || '').toLowerCase().trim();
  const rows = q ? rep.zonas.filter(z => String(z.zona).toLowerCase().includes(q)) : rep.zonas;
  // La fila de afuera sigue al buscador: aparece sin búsqueda, o si lo que se
  // busca es ella o alguna de las zonas que agrupa.
  const fuera = (rep.fuera && (!q ||
    FUERA_TARIFARIO.toLowerCase().includes(q) ||
    Array.from(rep.fuera.sueltas.keys()).some(z => String(z).toLowerCase().includes(q)))) ? rep.fuera : null;
  const filtros = _repFiltroCondicion(q ? ['búsqueda "' + q + '"'] : []);
  return { rep: rep, q: q, rows: rows, fuera: fuera, filtros: filtros };
}

function vistaConductorReport() {
  const r = computeConductorReport();
  const el = document.getElementById('cond-report-search');
  const q = ((el && el.value) || '').toLowerCase().trim();
  const lista = q ? r.conductores.filter(c => String(c).toLowerCase().includes(q)) : r.conductores;
  const filtros = _repFiltroCondicion(q ? ['búsqueda "' + q + '"'] : []);
  return { liq: r.liq, todos: r.conductores, lista: lista, q: q, filtros: filtros };
}

// Clientes tiene DOS filtros propios —el buscador y la banda del semáforo— más
// el de ciclo. El de condición NO entra: es del lado del conductor.
function vistaClientesReport(data) {
  const d = data || dashFacturacionClientes();
  const todos = d.filas || [];
  const el = document.getElementById('dash-cli-search');
  const q = ((el && el.value) || '').toLowerCase().trim();
  const base = q
    ? todos.filter(x => String(x.nombre).toLowerCase().includes(q) || String(x.cod).toLowerCase().includes(q))
    : todos;
  const lista = dashRentaSem ? base.filter(x => dashBandaRenta(x) === dashRentaSem) : base;
  const filtros = [];
  if (q) filtros.push('búsqueda "' + q + '"');
  if (dashRentaSem) filtros.push('renta ' + _dashBandaDef(dashRentaSem).corto);
  if (dashPerFilter) filtros.push('clientes ' + String(DASH_PER_PLURAL[dashPerFilter] || '').toLowerCase());
  return { datos: d, todos: todos, base: base, lista: lista, q: q, filtros: filtros };
}

// ── Los números de cada fila, UNA sola vez ──────────────────────────────
// El PDF y el Excel tienen que decir lo mismo, así que arman la fila acá y
// cada uno la formatea a su manera (el papel con "$", la planilla con número).
function _repFilasZona(v) {
  return v.rows.map(z => {
    const t = (AppData.tarifas || []).find(x => String(x.zona).toUpperCase() === String(z.zona).toUpperCase());
    return { zona: z.zona, categoria: (t && t.categoria) || '', envios: z.count,
             conductores: z.conductores.size, total: z.total, prom: z.count ? z.total / z.count : 0 };
  });
}
function _repFilasConductor(v) {
  return v.lista.map(c => {
    const d = v.liq[c];
    const cat = panelConductorDe(c);
    const zonas = [...new Set(d.filas.map(f => f.zona))];
    return {
      nombre: c,
      categoria: cat ? tipoLabel(cat.categoria === 'super_sla' ? 'sla' : cat.categoria) : 'Sin categorizar',
      zonas: zonas, envios: d.filas.length, total: d.total,
      // El MISMO denominador que la tarjeta de arriba y que la tabla: dividir
      // un número por su propia cantidad es lo que impide que se contradigan.
      unit: d.filas.length ? d.total / d.filas.length : 0,
      superSLA: d.filas.some(f => f.es_super)
    };
  });
}
function _repFilasClientes(v) {
  return v.lista.map(x => ({
    cliente: x.nombre, cod: x.cod,
    periodo: (typeof periodoLabel === 'function') ? periodoLabel(x.dias) : '',
    envios: _num(x.envios), factura: _num(x.factura), costo: _num(x.costo), margen: _num(x.margen),
    pct: _num(x.factura) > 0 ? _num(x.margen) * 100 / _num(x.factura) : 0,
    sinTarifa: _num(x.sinTarifa)
  }));
}

// ── Un PDF se arma igual en los tres: mismo encabezado y misma tabla ────
function _repPDF(titulo, filtros, head, body, foot, columnStyles, archivo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(15); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text(titulo, 14, 15);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  // El período y los filtros van en el papel: un reporte recortado que no lo
  // dice se lee como el completo.
  const sub = 'Período: ' + dashPeriodoLabel() +
    (filtros.length ? '   ·   Filtrado: ' + filtros.join(' · ') : '') +
    '   ·   Generado: ' + new Date().toLocaleString('es-AR');
  doc.text(sub, 14, 21);
  doc.autoTable({
    startY: 26, head: [head], body: body, foot: foot,
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: columnStyles,
    margin: { left: 14, right: 14 }
  });
  doc.save(archivo);
}

// ════════════════════════════════════════════════════════════════════════
//  ZONAS
// ════════════════════════════════════════════════════════════════════════
function exportReporteZonaPDF() {
  const v = vistaZonaReport();
  const filas = _repFilasZona(v);
  if (!filas.length && !v.fuera) { alert('Sin datos de zona para exportar con lo que está puesto en pantalla.'); return; }
  const body = filas.map(z => [z.zona, z.categoria || '—', z.envios, z.conductores, fmtPeso(z.total), fmtPeso(z.prom)]);
  // El papel dice lo mismo que la pantalla, incluido lo que quedó afuera del
  // tarifario: mostrando solo el tarifario, el total no cerraría contra la
  // liquidación.
  if (v.fuera) body.push([FUERA_TARIFARIO, '—', v.fuera.count, v.fuera.conductores.size, fmtPeso(v.fuera.total), '—']);
  // El pie mide LO QUE SE ESTÁ VIENDO, igual que en la pantalla.
  const cV = filas.reduce((s, z) => s + z.envios, 0);
  const tV = filas.reduce((s, z) => s + z.total, 0);
  const condV = new Set(); v.rows.forEach(z => z.conductores.forEach(c => condV.add(c)));
  const foot = [[
    { content: (v.q ? 'TOTAL DE LO FILTRADO · ' : 'TOTAL DEL TARIFARIO · ') + filas.length +
        ' zona(s)' + (v.q ? ' de ' + v.rep.zonas.length : '') + ' · ' + cV.toLocaleString('es-AR') + ' envíos',
      colSpan: 4, styles: { halign: 'right' } },
    fmtPeso(tV), fmtPeso(cV ? tV / cV : 0)
  ]];
  if (v.fuera && !v.q) foot.push([
    { content: 'TOTAL GENERAL · ' + v.rep.general.count.toLocaleString('es-AR') + ' envíos', colSpan: 4, styles: { halign: 'right' } },
    fmtPeso(v.rep.general.total), ''
  ]);
  _repPDF('Reporte por zona', v.filtros,
    ['Zona', 'Categoría', 'Envíos', 'Conductores', 'Total liquidado', 'Prom./envío'],
    body, foot,
    { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    'Reporte_por_zona_' + _repFechaArchivo() + '.pdf');
  showToast('📥 Reporte por zona descargado');
}

function exportReporteZonaExcel() {
  const v = vistaZonaReport();
  const filas = _repFilasZona(v);
  if (!filas.length && !v.fuera) { alert('Sin datos de zona para exportar con lo que está puesto en pantalla.'); return; }
  const aoa = [
    [_repCabecera('Reporte por zona', v.filtros, filas.length + ' zona(s) del tarifario')],
    ['ZONA', 'CATEGORÍA', 'ENVÍOS', 'CONDUCTORES', 'TOTAL LIQUIDADO', 'PROM. POR ENVÍO']
  ];
  filas.forEach(z => aoa.push([z.zona, z.categoria, z.envios, z.conductores, z.total, Math.round(z.prom)]));
  if (v.fuera) aoa.push([FUERA_TARIFARIO, '', v.fuera.count, v.fuera.conductores.size, v.fuera.total, '']);
  const cV = filas.reduce((s, z) => s + z.envios, 0);
  const tV = filas.reduce((s, z) => s + z.total, 0);
  aoa.push([]);
  aoa.push([v.q ? 'TOTAL DE LO FILTRADO' : 'TOTAL DEL TARIFARIO', '', cV, '', tV, cV ? Math.round(tV / cV) : 0]);
  if (v.fuera && !v.q) aoa.push(['TOTAL GENERAL (con lo de afuera)', '', v.rep.general.count, '', v.rep.general.total, '']);

  const hojas = [{ nombre: 'Por zona', aoa: aoa, anchos: [26, 14, 10, 13, 16, 16] }];
  // Las zonas sueltas que no están en el tarifario: en la pantalla entran las
  // 5 más grandes en una línea, pero esta ES la lista de lo que hay que
  // corregir, así que en la planilla va entera.
  if (v.fuera && v.fuera.sueltas.size) {
    const det = [[_repCabecera('Fuera del tarifario', v.filtros, 'zonas que no están en el tarifario de costos')],
                 ['ZONA', 'ENVÍOS']];
    Array.from(v.fuera.sueltas.values()).sort((a, b) => b.count - a.count)
      .forEach(x => det.push([x.zona, x.count]));
    if (v.fuera.sinZona) det.push(['(sin zona)', v.fuera.sinZona]);
    hojas.push({ nombre: 'Fuera del tarifario', aoa: det, anchos: [30, 10] });
  }
  _repExcel('Reporte_por_zona_' + _repFechaArchivo() + '.xlsx', hojas);
  showToast('📥 Reporte por zona en Excel');
}

// ════════════════════════════════════════════════════════════════════════
//  CONDUCTORES
// ════════════════════════════════════════════════════════════════════════
function exportReporteConductorPDF() {
  const v = vistaConductorReport();
  const filas = _repFilasConductor(v);
  if (!filas.length) { alert('Sin datos de conductor para exportar con lo que está puesto en pantalla.'); return; }
  const body = filas.map(c => [
    c.nombre, c.categoria,
    c.zonas.slice(0, 3).join(', ') + (c.zonas.length > 3 ? ' +' + (c.zonas.length - 3) : ''),
    c.envios, fmtPeso(c.total), fmtPeso(c.unit), c.superSLA ? 'Sí' : '—'
  ]);
  const tot = filas.reduce((s, c) => s + c.total, 0);
  const env = filas.reduce((s, c) => s + c.envios, 0);
  const foot = [[
    { content: (v.q ? 'TOTAL DE LO FILTRADO · ' : 'TOTAL · ') + filas.length +
        ' conductor(es)' + (v.q ? ' de ' + v.todos.length : '') + ' · ' + env.toLocaleString('es-AR') + ' envíos',
      colSpan: 4, styles: { halign: 'right' } },
    fmtPeso(tot), fmtPeso(env ? tot / env : 0), ''
  ]];
  _repPDF('Reporte por conductor', v.filtros,
    ['Conductor', 'Categoría', 'Zonas visitadas', 'Total de envíos', 'Total liquidado', 'Costo unitario', 'Super SLA'],
    body, foot,
    { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'center' } },
    'Reporte_por_conductor_' + _repFechaArchivo() + '.pdf');
  showToast('📥 Reporte por conductor descargado');
}

function exportReporteConductorExcel() {
  const v = vistaConductorReport();
  const filas = _repFilasConductor(v);
  if (!filas.length) { alert('Sin datos de conductor para exportar con lo que está puesto en pantalla.'); return; }
  const aoa = [
    [_repCabecera('Reporte por conductor', v.filtros, filas.length + ' conductor(es)')],
    ['CONDUCTOR', 'CATEGORÍA', 'ZONAS', 'ZONAS VISITADAS', 'TOTAL DE ENVÍOS', 'TOTAL LIQUIDADO', 'COSTO UNITARIO', 'SUPER SLA']
  ];
  // En la planilla las zonas van ENTERAS: en la pantalla entran tres porque no
  // hay lugar, pero acá no hay motivo para recortarlas.
  filas.forEach(c => aoa.push([c.nombre, c.categoria, c.zonas.length, c.zonas.join(' · '),
    c.envios, c.total, Math.round(c.unit), c.superSLA ? 'Sí' : 'No']));
  const tot = filas.reduce((s, c) => s + c.total, 0);
  const env = filas.reduce((s, c) => s + c.envios, 0);
  aoa.push([]);
  aoa.push([v.q ? 'TOTAL DE LO FILTRADO' : 'TOTAL', '', '', '', env, tot, env ? Math.round(tot / env) : 0, '']);
  _repExcel('Reporte_por_conductor_' + _repFechaArchivo() + '.xlsx',
    [{ nombre: 'Por conductor', aoa: aoa, anchos: [26, 15, 8, 40, 15, 16, 15, 11] }]);
  showToast('📥 Reporte por conductor en Excel');
}

// ════════════════════════════════════════════════════════════════════════
//  CLIENTES — el que faltaba
//  Zonas y Conductores ya se podían bajar; la renta por cliente no, y es la
//  única de las tres que trae el MARGEN, que es con lo que se discute una
//  tarifa. Sale de vistaClientesReport, o sea de las mismas filas que la
//  pantalla: el buscador, la banda del semáforo y el ciclo van incluidos.
// ════════════════════════════════════════════════════════════════════════
function exportReporteClientesPDF() {
  const v = vistaClientesReport();
  const filas = _repFilasClientes(v);
  if (!filas.length) { alert('Sin clientes para exportar con lo que está puesto en pantalla.'); return; }
  const body = filas.map(c => [
    c.cliente, c.periodo, c.envios.toLocaleString('es-AR'),
    fmtPeso(c.factura), fmtPeso(c.costo), fmtPeso(c.margen),
    // El cliente que NO factura no es un 0%: se le paga al conductor y no se le
    // cobra nada. Decir "0%" lo haría pasar por un caso neutro.
    c.factura > 0 ? c.pct.toFixed(1) + '%' : 'no factura'
  ]);
  const f = filas.reduce((s, c) => s + c.factura, 0);
  const co = filas.reduce((s, c) => s + c.costo, 0);
  const en = filas.reduce((s, c) => s + c.envios, 0);
  const foot = [[
    { content: (v.filtros.length ? 'TOTAL DE LO FILTRADO · ' : 'TOTAL · ') + filas.length +
        ' cliente(s)' + (filas.length !== v.todos.length ? ' de ' + v.todos.length : '') +
        ' · ' + en.toLocaleString('es-AR') + ' envíos',
      colSpan: 3, styles: { halign: 'right' } },
    fmtPeso(f), fmtPeso(co), fmtPeso(f - co), f > 0 ? ((f - co) * 100 / f).toFixed(1) + '%' : '—'
  ]];
  _repPDF('Renta por cliente', v.filtros,
    ['Cliente', 'Período', 'Envíos', 'Facturación', 'Costo', 'Margen', 'Margen %'],
    body, foot,
    { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    'Renta_por_cliente_' + _repFechaArchivo() + '.pdf');
  showToast('📥 Renta por cliente descargada');
}

function exportReporteClientesExcel() {
  const v = vistaClientesReport();
  const filas = _repFilasClientes(v);
  if (!filas.length) { alert('Sin clientes para exportar con lo que está puesto en pantalla.'); return; }
  const aoa = [
    [_repCabecera('Renta por cliente', v.filtros,
      filas.length + ' cliente(s)' + (filas.length !== v.todos.length ? ' de ' + v.todos.length : ''))],
    ['CLIENTE', 'CÓDIGO', 'PERÍODO', 'ENVÍOS', 'FACTURACIÓN', 'COSTO', 'MARGEN', 'MARGEN %', 'ENVÍOS SIN TARIFA']
  ];
  filas.forEach(c => aoa.push([c.cliente, c.cod, c.periodo, c.envios, c.factura, c.costo, c.margen,
    c.factura > 0 ? Math.round(c.pct * 10) / 10 : '', c.sinTarifa || '']));
  const f = filas.reduce((s, c) => s + c.factura, 0);
  const co = filas.reduce((s, c) => s + c.costo, 0);
  const en = filas.reduce((s, c) => s + c.envios, 0);
  aoa.push([]);
  aoa.push([v.filtros.length ? 'TOTAL DE LO FILTRADO' : 'TOTAL', '', '', en, f, co, f - co,
    f > 0 ? Math.round((f - co) * 1000 / f) / 10 : '', '']);
  _repExcel('Renta_por_cliente_' + _repFechaArchivo() + '.xlsx',
    [{ nombre: 'Renta por cliente', aoa: aoa, anchos: [30, 16, 12, 10, 16, 16, 16, 11, 17] }]);
  showToast('📥 Renta por cliente en Excel');
}

// ===== FILE UPLOAD =====
