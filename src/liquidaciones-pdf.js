let liqModalConductor = null;
let liqModalData = null;

function openLiqModal(conductor) {
  liqModalConductor = conductor;

  // Calcular con filtro de fechas activo del panel Liquidaciones
  const liqBase = calcLiquidacionesFiltradas();

  liqModalData = liqBase;
  const d = liqBase[conductor];
  if (!d) {
    alert('Sin datos para ' + conductor + ' en el período seleccionado.');
    return;
  }

  const panelCond = AppData.panelConductores.find(x => x.nombre.toUpperCase() === conductor.toUpperCase());
  const idLabel = panelCond?.id || '—';
  const condLabel = panelCond?.condicion || 'Sin asignar';

  // Rango de fechas activo del panel Liquidaciones
  const rango = getLiqFechaRango();
  const fmtF = date => date.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  let rangoTxt = 'Todos los registros disponibles';
  if (rango) {
    if (rango.desde && rango.hasta) rangoTxt = fmtF(rango.desde) + ' → ' + fmtF(rango.hasta);
    else if (rango.desde) rangoTxt = 'Desde ' + fmtF(rango.desde);
    else if (rango.hasta) rangoTxt = 'Hasta ' + fmtF(rango.hasta);
  }

  // Rellenar el modal
  document.getElementById('modal-liq-title').textContent = 'Generar liquidación · ' + conductor;
  document.getElementById('liq-modal-info').innerHTML =
    '<strong>' + conductor + '</strong> · ID: <span style="font-family:monospace">' + idLabel + '</span> · ' +
    condLabel +
    '<br><span style="color:#6b7280">📅 Período: ' + rangoTxt + '</span>';
  document.getElementById('liq-modal-recorridos-info').textContent =
    d.filas.length + ' entregados · ' + d.filas_excluidas.length + ' en otros estados';
  document.getElementById('liq-modal-total-bruto').textContent = fmtPeso(d.total);

  // Pre-cargar descuentos del panel "Descuento Conductores" si existen
  const descPre = findDescuentoConductor(conductor);
  const origenEl = document.getElementById('liq-desc-origen');
  if (descPre) {
    document.getElementById('liq-desc-combustible').value = descPre.combustible || '';
    document.getElementById('liq-desc-extraviados').value = descPre.extraviados || '';
    document.getElementById('liq-desc-adelantos').value = descPre.adelantos || '';
    document.getElementById('liq-desc-proveedores').value = descPre.proveedores || '';
    document.getElementById('liq-desc-obs').value = descPre.obs || '';
    if (origenEl) origenEl.textContent = 'Pre-cargado desde panel';
  } else {
    document.getElementById('liq-desc-combustible').value = '';
    document.getElementById('liq-desc-extraviados').value = '';
    document.getElementById('liq-desc-adelantos').value = '';
    document.getElementById('liq-desc-proveedores').value = '';
    document.getElementById('liq-desc-obs').value = '';
    if (origenEl) origenEl.textContent = '';
  }

  recalcLiqModal();
  document.getElementById('modal-liq-backdrop').style.display = 'flex';
}

function recalcLiqModal() {
  if (!liqModalData || !liqModalConductor) return;
  const d = liqModalData[liqModalConductor];
  if (!d) return;

  const combustible = parseFloat(document.getElementById('liq-desc-combustible').value) || 0;
  const extraviados = parseFloat(document.getElementById('liq-desc-extraviados').value) || 0;
  const adelantos = parseFloat(document.getElementById('liq-desc-adelantos').value) || 0;
  const proveedores = parseFloat(document.getElementById('liq-desc-proveedores').value) || 0;
  const totalDesc = combustible + extraviados + adelantos + proveedores;

  // Adicional por km de desvío del período filtrado (suma al neto, igual que el PDF)
  const kmAd = kmAdicionalConductor(liqModalConductor, getLiqRangoFechasLabel());
  const kmMonto = kmAd.monto;
  const kmWrap = document.getElementById('liq-modal-linea-km-wrap');
  if (kmWrap) {
    kmWrap.style.display = kmMonto > 0 ? 'flex' : 'none';
    if (kmMonto > 0) {
      document.getElementById('liq-modal-linea-km-label').textContent =
        'Adicional km de desvío' + (kmAd.km > 0 ? ' (' + kmAd.km + ' km)' : '');
      document.getElementById('liq-modal-linea-km').textContent = '+' + fmtPeso(kmMonto);
    }
  }

  const totalNeto = d.total + kmMonto - totalDesc;

  document.getElementById('liq-modal-linea-bruto').textContent = fmtPeso(d.total);
  document.getElementById('liq-modal-linea-desc').textContent = '-' + fmtPeso(totalDesc);
  document.getElementById('liq-modal-total-neto').textContent = fmtPeso(totalNeto);
}

function closeLiqModal(e) {
  if (!e || e.target.id === 'modal-liq-backdrop') {
    document.getElementById('modal-liq-backdrop').style.display = 'none';
    liqModalConductor = null;
    liqModalData = null;
  }
}

function verDetalleDesdeModal() {
  if (!liqModalConductor) return;
  const c = liqModalConductor;
  document.getElementById('modal-liq-backdrop').style.display = 'none';
  showConductorModal(c);
}

function confirmarYDescargarPDF() {
  if (!liqModalConductor || !liqModalData) return;

  const descuentos = {
    combustible: parseFloat(document.getElementById('liq-desc-combustible').value) || 0,
    extraviados: parseFloat(document.getElementById('liq-desc-extraviados').value) || 0,
    adelantos:   parseFloat(document.getElementById('liq-desc-adelantos').value) || 0,
    proveedores: parseFloat(document.getElementById('liq-desc-proveedores').value) || 0,
    obs:         document.getElementById('liq-desc-obs').value || ''
  };

  // Rango de fechas del panel Liquidaciones al momento
  const rangoFechas = getLiqRangoFechasLabel();

  try {
    exportPDF(liqModalConductor, {
      descuentos,
      rangoFechas,
      liqData: liqModalData
    });
    document.getElementById('modal-liq-backdrop').style.display = 'none';
    showToast('✅ PDF de liquidación descargado');
  } catch(err) {
    console.error(err);
    alert('Error al generar PDF: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════

function guardarDescuentosEnPanel() {
  if (!liqModalConductor) return;

  const combustible = parseFloat(document.getElementById('liq-desc-combustible').value) || 0;
  const extraviados = parseFloat(document.getElementById('liq-desc-extraviados').value) || 0;
  const adelantos = parseFloat(document.getElementById('liq-desc-adelantos').value) || 0;
  const proveedores = parseFloat(document.getElementById('liq-desc-proveedores').value) || 0;
  const obs = document.getElementById('liq-desc-obs').value.trim();

  const entry = {
    conductor: liqModalConductor.toUpperCase().trim(),
    combustible, extraviados, adelantos, proveedores, obs
  };

  // Buscar existente y actualizar/agregar
  const idx = AppData.descuentosConductores.findIndex(d =>
    String(d.conductor).toUpperCase().trim() === entry.conductor
  );
  if (idx >= 0) {
    AppData.descuentosConductores[idx] = entry;
  } else {
    AppData.descuentosConductores.push(entry);
  }

  saveDescuentos();
  const origenEl = document.getElementById('liq-desc-origen');
  if (origenEl) origenEl.textContent = 'Guardado en panel ✓';
  showToast('✅ Descuentos guardados en el panel Descuento Conductores');
}

function exportPDF(conductor, opts) {
  opts = opts || {};
  // Si no vienen descuentos explícitos (exportación masiva), usar los cargados
  // en el panel "Descuento Conductores" para ese conductor.
  const descuentos = opts.descuentos || findDescuentoConductor(conductor) ||
    { combustible: 0, extraviados: 0, adelantos: 0, proveedores: 0, obs: '' };
  let rangoFechas = opts.rangoFechas || null; // { desde: 'DD/MM/YYYY', hasta: 'DD/MM/YYYY' } — si no se pasa, se calcula a partir de los registros liquidados

  const { jsPDF } = window.jspdf;
  // compress:true achica el PDF (los streams van comprimidos con flate)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  // Usar liquidación filtrada por rango si aplica, sino la global
  const liq = opts.liqData || calcLiquidaciones();
  const d = liq[conductor];
  if (!d) { alert('Sin datos para ' + conductor); return; }

  // Si no se pasó un rango de fechas explícito (filtro del dashboard/liquidaciones),
  // lo calculamos a partir de la primera y la última fecha efectivamente liquidadas
  // para que el conductor siempre vea el período exacto que se le está contabilizando.
  if (!rangoFechas && d.filas && d.filas.length) {
    let fechaMin = null, fechaMax = null;
    d.filas.forEach(f => {
      const fd = parseFechaReg(f.fecha);
      if (!fd) return;
      if (!fechaMin || fd < fechaMin) fechaMin = fd;
      if (!fechaMax || fd > fechaMax) fechaMax = fd;
    });
    if (fechaMin && fechaMax) {
      const fmtF = fd => String(fd.getDate()).padStart(2,'0') + '/' + String(fd.getMonth()+1).padStart(2,'0') + '/' + fd.getFullYear();
      rangoFechas = { desde: fmtF(fechaMin), hasta: fmtF(fechaMax) };
    }
  }

  const panelCond = AppData.panelConductores.find(x => x.nombre.toUpperCase() === conductor.toUpperCase());

  // ===== COLORES LOGÍSTICA HOGAREÑO =====
  const LH_NAVY  = [26, 39, 68];    // Azul marino oscuro
  const LH_BLUE  = [45, 79, 161];   // Azul eléctrico LH
  const LH_LIGHT = [235, 240, 252]; // Azul muy claro para filas alternas
  const LH_WHITE = [255, 255, 255];
  const LH_GRAY  = [100, 110, 130];
  const LH_GREEN = [22, 120, 70];
  const LH_GREEN_BG = [220, 245, 232];
  const LH_RED_BG   = [250, 235, 235];
  const LH_RED      = [180, 50, 50];
  const LH_ORANGE   = [190, 100, 10];
  const LH_EMERALD  = [4, 130, 96];
  const LH_INDIGO   = [79, 70, 229];
  const W = 210, MARGIN = 14;

  // Ícono en forma de "chip" (cuadrado redondeado de color + letra blanca).
  // Los emojis (⛽📦💵🧾) no se renderizan de forma confiable con las fuentes
  // estándar de jsPDF: en su lugar dibujamos un ícono vectorial simple y
  // garantizado de ver en cualquier lector de PDF.
  const drawDescIcon = (letter, x, yBaseline, size, color) => {
    doc.setFillColor(...color);
    doc.roundedRect(x, yBaseline - size, size, size, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(size * 2.05);
    doc.text(letter, x + size / 2, yBaseline - size * 0.24, { align: 'center' });
  };

  // ===== LOGO BASE64 =====
  const LOGO_B64 = 'data:image/png;base64,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';

  // ===== FUNCIONES HELPERS =====
  const addPageHeader = (pageNum, totalPages) => {
    // Franja azul marino superior
    doc.setFillColor(...LH_NAVY);
    doc.rect(0, 0, W, 22, 'F');
    // Logo a la derecha (proporción 1:1 — la imagen original es cuadrada, estirarla la deforma).
    // El alias 'lh-logo' hace que jsPDF incruste la imagen UNA sola vez aunque
    // se dibuje en todas las páginas (sin alias, cada página duplicaba la imagen
    // y el archivo pesaba decenas de MB).
    try { doc.addImage(LOGO_B64, 'PNG', W - 30, 2, 18, 18, 'lh-logo', 'FAST'); } catch(e) {}
    // Título izquierda
    doc.setTextColor(...LH_WHITE);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text('LIQUIDACIÓN SEMANAL', MARGIN, 9);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(conductor.toUpperCase(), MARGIN, 16);
    // Línea azul eléctrica separadora
    doc.setFillColor(...LH_BLUE);
    doc.rect(0, 22, W, 1.5, 'F');
  };

  const addPageFooter = (pageNum, totalPages) => {
    doc.setFillColor(...LH_NAVY);
    doc.rect(0, 285, W, 12, 'F');
    doc.setTextColor(...LH_WHITE);
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.text('Logística Hogareño — Sistema de Liquidaciones', MARGIN, 292);
    doc.text(`Pág ${pageNum} / ${totalPages}`, W - MARGIN, 292, { align: 'right' });
  };

  // ===== PÁGINA 1: ENCABEZADO CON DATOS DEL CONDUCTOR =====
  addPageHeader(1, 1);

  let Y = 30;

  // Bloque de datos del conductor
  doc.setFillColor(...LH_LIGHT);
  doc.roundedRect(MARGIN, Y, W - MARGIN*2, 28, 2, 2, 'F');
  doc.setDrawColor(...LH_BLUE);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, Y, W - MARGIN*2, 28, 2, 2, 'S');

  doc.setTextColor(...LH_NAVY);
  doc.setFontSize(7);
  doc.setFont(undefined, 'normal');
  doc.text('CONDUCTOR', MARGIN + 4, Y + 6);
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text(conductor.toUpperCase(), MARGIN + 4, Y + 13);

  const idLabel = panelCond?.id || '—';
  const condLabel = panelCond?.condicion || '—';
  const catLabel = panelCond ? tipoLabel(panelCond.categoria === 'super_sla' ? 'sla' : panelCond.categoria) : '—';

  const metaItems = [
    ['ID', idLabel],
    ['CONDICIÓN', condLabel],
    ['CATEGORÍA', catLabel],
    ['GENERADO', new Date().toLocaleDateString('es-AR')],
  ];
  let mx = MARGIN + 4;
  metaItems.forEach(([label, val]) => {
    doc.setFontSize(6.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...LH_GRAY);
    doc.text(label, mx, Y + 20);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...LH_NAVY);
    doc.text(val, mx, Y + 26);
    mx += 45;
  });

  Y += 34;

  // ===== BLOQUE DE PERÍODO (rango de fechas) — SIEMPRE visible al principio de la hoja =====
  // El conductor necesita ver, sin ambigüedad, desde/hasta qué fecha se está contabilizando su trabajo.
  {
    doc.setFillColor(...LH_BLUE);
    doc.roundedRect(MARGIN, Y, W - MARGIN*2, 10, 2, 2, 'F');
    doc.setTextColor(...LH_WHITE);
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.text('PERÍODO LIQUIDADO', MARGIN + 4, Y + 4);
    doc.setFontSize(9.5);
    doc.setFont(undefined, 'bold');
    // OJO: solo caracteres Latin-1 acá. Símbolos como '→' o '✓' no existen en
    // las fuentes estándar de jsPDF y corrompen el texto de toda la línea.
    let rangoTxt;
    if (rangoFechas && rangoFechas.desde && rangoFechas.hasta) {
      rangoTxt = rangoFechas.desde + '  -  ' + rangoFechas.hasta;
    } else if (rangoFechas && rangoFechas.desde) {
      rangoTxt = 'Desde ' + rangoFechas.desde;
    } else if (rangoFechas && rangoFechas.hasta) {
      rangoTxt = 'Hasta ' + rangoFechas.hasta;
    } else {
      rangoTxt = 'Todos los registros disponibles (sin filtro de fecha aplicado)';
    }
    doc.text(rangoTxt, MARGIN + 4, Y + 8.5);
    Y += 14;
  }

  // ===== CAJAS DE RESUMEN =====
  const totalEntregados = d.filas.length;
  const totalNoEntregados = d.filas_excluidas.length;
  const totalPesos = d.total;

  const summaryBoxes = [
    { label: 'ENTREGADOS', sub: 'contabilizan', val: totalEntregados, unit: 'envíos', color: LH_GREEN, bg: LH_GREEN_BG, isNum: false },
    { label: 'NO ENTREGADOS', sub: 'no contabilizan', val: totalNoEntregados, unit: 'envíos', color: LH_RED, bg: LH_RED_BG, isNum: false },
    { label: 'TOTAL A LIQUIDAR', sub: 'período semanal', val: totalPesos, unit: '', color: LH_BLUE, bg: LH_LIGHT, isNum: true },
  ];

  const boxW = (W - MARGIN*2 - 8) / 3;
  let bx = MARGIN;
  summaryBoxes.forEach((box, i) => {
    doc.setFillColor(...box.bg);
    doc.roundedRect(bx, Y, boxW, 22, 2, 2, 'F');
    doc.setDrawColor(...box.color);
    doc.setLineWidth(0.8);
    doc.line(bx, Y + 22, bx + boxW, Y + 22);
    doc.setFillColor(...box.color);
    doc.rect(bx, Y, 2.5, 22, 'F');

    doc.setTextColor(...LH_GRAY);
    doc.setFontSize(6.5);
    doc.setFont(undefined, 'normal');
    doc.text(box.label, bx + 5, Y + 6);
    doc.setTextColor(...box.color);
    doc.setFontSize(box.isNum ? 13 : 16);
    doc.setFont(undefined, 'bold');
    const valStr = box.isNum ? fmtPeso(box.val) : String(box.val);
    doc.text(valStr, bx + 5, Y + 15);
    doc.setFontSize(6.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...LH_GRAY);
    doc.text(box.sub, bx + 5, Y + 20);
    bx += boxW + 4;
  });

  Y += 28;

  // ===== TABLA 1: ENTREGADOS =====
  doc.setFontSize(8.5);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...LH_NAVY);
  doc.text('RECORRIDOS ENTREGADOS — contabilizan para el pago', MARGIN, Y + 5);
  doc.setDrawColor(...LH_GREEN);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, Y + 6.5, W - MARGIN, Y + 6.5);
  Y += 10;

  // Separar dimensiones especiales de recorridos normales
  const filasDimEsp = d.filas.filter(f => f.es_dim_especial);
  const filasNormales = d.filas.filter(f => !f.es_dim_especial);

  const totalNormales = filasNormales.reduce((s, f) => s + f.precio, 0);
  const totalDimEsp = filasDimEsp.reduce((s, f) => s + f.precio, 0);

  // ─── TABLA 1a: RECORRIDOS NORMALES ───
  // Sin columna "TIPO / TARIFA": esa información es interna y no debe verse
  // en la liquidación que recibe el conductor.
  const entRows = filasNormales.map(f => [
    String(f.tracking || '—'),
    f.fecha || '—',
    (f.zona || '—').toUpperCase(),
    fmtPeso(f.precio),
  ]);

  doc.autoTable({
    startY: Y,
    head: [['TRACKING', 'FECHA', 'ZONA', 'PRECIO']],
    body: entRows.length ? entRows : [['—','—','Sin recorridos entregados','—']],
    theme: 'plain',
    headStyles: {
      fillColor: LH_NAVY, textColor: LH_WHITE,
      fontStyle: 'bold', fontSize: 7.5, cellPadding: 3,
    },
    bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: [40,50,70] },
    alternateRowStyles: { fillColor: LH_LIGHT },
    columnStyles: {
      0: { cellWidth: 44, fontStyle: 'bold' },
      1: { cellWidth: 30 },
      2: { cellWidth: 74 },
      3: { halign: 'right', cellWidth: 34, fontStyle: 'bold' },
    },
    foot: [[
      { content: 'SUBTOTAL — ' + filasNormales.length + ' envíos', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold', fontSize: 8, fillColor: LH_NAVY, textColor: LH_WHITE } },
      { content: fmtPeso(totalNormales), styles: { halign: 'right', fontStyle: 'bold', fontSize: 9, fillColor: LH_BLUE, textColor: LH_WHITE } },
    ]],
    footStyles: { cellPadding: 3 },
    didDrawPage: (data) => {
      addPageHeader(data.pageNumber, 99);
      addPageFooter(data.pageNumber, 99);
    },
    margin: { left: MARGIN, right: MARGIN, top: 27, bottom: 18 },
  });

  // ─── TABLA 1b: DIMENSIONES ESPECIALES (si hay) ───
  if (filasDimEsp.length > 0) {
    let dimY = doc.lastAutoTable.finalY + 8;
    if (dimY > 235) { doc.addPage(); dimY = 30; }

    // Título con fondo amarillo LH
    doc.setFillColor(254, 243, 199);
    doc.roundedRect(MARGIN, dimY, W - MARGIN*2, 8, 2, 2, 'F');
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.4);
    doc.roundedRect(MARGIN, dimY, W - MARGIN*2, 8, 2, 2, 'S');
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('DIMENSIONES ESPECIALES — trackings con valor especial que reemplaza la tarifa', MARGIN + 3, dimY + 5.5);

    const dimRows = filasDimEsp.map(f => [
      String(f.tracking || '—'),
      f.fecha || '—',
      (f.zona || '—').toUpperCase(),
      f.dim_cliente || '—',
      f.dim_condicion || 'Dimensión Especial',
      fmtPeso(f.precio),
    ]);

    doc.autoTable({
      startY: dimY + 10,
      head: [['TRACKING', 'FECHA', 'ZONA', 'CLIENTE', 'CONDICIÓN ESPECIAL', 'VALOR']],
      body: dimRows,
      theme: 'plain',
      headStyles: {
        fillColor: [146, 64, 14], textColor: LH_WHITE,
        fontStyle: 'bold', fontSize: 7, cellPadding: 3,
      },
      bodyStyles: { fontSize: 7, cellPadding: 2.5, textColor: [40,50,70], fillColor: [254, 249, 195] },
      columnStyles: {
        0: { cellWidth: 28, fontStyle: 'bold' },
        1: { cellWidth: 18 },
        2: { cellWidth: 32 },
        3: { cellWidth: 36 },
        4: { cellWidth: 46, fontStyle: 'bold', textColor: [146, 64, 14] },
        5: { halign: 'right', cellWidth: 22, fontStyle: 'bold' },
      },
      foot: [[
        { content: 'SUBTOTAL — ' + filasDimEsp.length + ' dim.esp.', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold', fontSize: 8, fillColor: [146, 64, 14], textColor: LH_WHITE } },
        { content: fmtPeso(totalDimEsp), styles: { halign: 'right', fontStyle: 'bold', fontSize: 9, fillColor: [245, 158, 11], textColor: LH_WHITE } },
      ]],
      footStyles: { cellPadding: 3 },
      didDrawPage: (data) => {
        addPageHeader(data.pageNumber, 99);
        addPageFooter(data.pageNumber, 99);
      },
      margin: { left: MARGIN, right: MARGIN, top: 27, bottom: 18 },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ═════════════ BLOQUE DE DESCUENTOS + TOTAL NETO ═══════════════════════
  // ═══════════════════════════════════════════════════════════════════════
  const totalDescuentos = (descuentos.combustible || 0) + (descuentos.extraviados || 0) + (descuentos.adelantos || 0) + (descuentos.proveedores || 0);

  // Adicional por km de desvío del período liquidado: compensación por retiros
  // de mercadería fuera de ruta. SUMA al total. Cada desvío ya tiene su monto
  // congelado a la tarifa vigente cuando se cargó.
  const kmAd = kmAdicionalConductor(conductor, rangoFechas);
  const kmMonto = kmAd.monto;
  const kmKms = kmAd.km;
  const kmOffset = kmMonto > 0 ? 6 : 0; // renglón extra en la caja si hay adicional

  const totalNeto = d.total + kmMonto - totalDescuentos;

  let descY = doc.lastAutoTable.finalY + 8;
  // Si no cabe el bloque en la página actual, saltar de página
  if (descY > 220 - kmOffset) { doc.addPage(); descY = 30; }

  // Título del bloque
  doc.setFontSize(8.5);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...LH_NAVY);
  doc.text('ADICIONALES, DESCUENTOS Y TOTAL NETO A PAGAR', MARGIN, descY + 5);
  doc.setDrawColor(...LH_BLUE);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, descY + 6.5, W - MARGIN, descY + 6.5);
  descY += 11;

  // Caja con fondo claro (altura dinámica según cantidad de ítems de descuento)
  const descItemsCount = 4;
  const boxH = 22 + descItemsCount * 6 + 10 + kmOffset;
  doc.setFillColor(248, 249, 252);
  doc.roundedRect(MARGIN, descY, W - MARGIN*2, boxH, 2, 2, 'F');
  doc.setDrawColor(220, 226, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, descY, W - MARGIN*2, boxH, 2, 2, 'S');

  // Renglón: Total Bruto
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...LH_GRAY);
  doc.text('Total Bruto (recorridos entregados)', MARGIN + 6, descY + 8);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...LH_NAVY);
  doc.text(fmtPeso(d.total), W - MARGIN - 6, descY + 8, { align: 'right' });

  // Renglón: Adicional por km de desvío (suma al total)
  if (kmMonto > 0) {
    drawDescIcon('K', MARGIN + 6, descY + 15.6, 4.4, LH_GREEN);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...LH_GRAY);
    doc.text('Adicional km de desvío' + (kmKms > 0 ? ' (' + kmKms + ' km)' : ''), MARGIN + 13, descY + 14);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...LH_GREEN);
    doc.text('+' + fmtPeso(kmMonto), W - MARGIN - 6, descY + 14, { align: 'right' });
  }

  // Separador
  doc.setDrawColor(220, 226, 240);
  doc.setLineWidth(0.2);
  doc.line(MARGIN + 6, descY + 11 + kmOffset, W - MARGIN - 6, descY + 11 + kmOffset);

  // Descuentos individuales (mismos conceptos que en el detalle previo a descargar)
  const descItems = [
    { letter: 'C', color: LH_ORANGE,  label: 'Combustible', val: descuentos.combustible || 0 },
    { letter: 'P', color: LH_RED,     label: 'Envíos extraviados / rotos', val: descuentos.extraviados || 0 },
    { letter: 'A', color: LH_EMERALD, label: 'Adelantos', val: descuentos.adelantos || 0 },
    { letter: 'S', color: LH_INDIGO,  label: 'Servicio proveedores', val: descuentos.proveedores || 0 },
  ];
  let dY = descY + 17 + kmOffset;
  descItems.forEach(item => {
    drawDescIcon(item.letter, MARGIN + 6, dY + 1.6, 4.4, item.color);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...LH_GRAY);
    doc.text(item.label, MARGIN + 13, dY);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(item.val > 0 ? 180 : 150, item.val > 0 ? 50 : 150, item.val > 0 ? 50 : 150);
    doc.text('-' + fmtPeso(item.val), W - MARGIN - 6, dY, { align: 'right' });
    dY += 6;
  });

  // Separador
  doc.setDrawColor(...LH_NAVY);
  doc.setLineWidth(0.3);
  doc.line(MARGIN + 6, dY, W - MARGIN - 6, dY);
  dY += 5;

  // Total descuentos
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...LH_GRAY);
  doc.text('Total descuentos', MARGIN + 6, dY);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...LH_RED);
  doc.text('-' + fmtPeso(totalDescuentos), W - MARGIN - 6, dY, { align: 'right' });

  descY += boxH + 4;

  // ===== CAJA DESTACADA: TOTAL NETO =====
  doc.setFillColor(...LH_NAVY);
  doc.roundedRect(MARGIN, descY, W - MARGIN*2, 16, 2, 2, 'F');
  doc.setFillColor(...LH_BLUE);
  doc.rect(MARGIN, descY, 3, 16, 'F');

  doc.setTextColor(...LH_WHITE);
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.text('TOTAL NETO A PAGAR', MARGIN + 8, descY + 6);
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.text(fmtPeso(totalNeto), W - MARGIN - 6, descY + 11, { align: 'right' });

  descY += 20;

  // Observaciones
  if (descuentos.obs && descuentos.obs.trim()) {
    doc.setFontSize(7);
    doc.setFont(undefined, 'italic');
    doc.setTextColor(...LH_GRAY);
    doc.text('Observaciones:', MARGIN, descY + 4);
    doc.setFont(undefined, 'normal');
    const obsLines = doc.splitTextToSize(descuentos.obs, W - MARGIN*2);
    doc.text(obsLines, MARGIN, descY + 8);
    descY += 8 + (obsLines.length * 3.5);
  }

  // ===== TABLA 2: NO ENTREGADOS =====
  if (d.filas_excluidas.length > 0) {
    let finalY = descY + 4;
    if (finalY > 255) { doc.addPage(); finalY = 30; }

    doc.setFontSize(8.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...LH_RED);
    doc.text('RECORRIDOS NO ENTREGADOS — no contabilizan para el pago', MARGIN, finalY + 5);
    doc.setDrawColor(...LH_RED);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, finalY + 6.5, W - MARGIN, finalY + 6.5);

    const noEntRows = d.filas_excluidas.map(f => [
      String(f.tracking || '—'),
      f.fecha || '—',
      (f.zona || '—').toUpperCase(),
      f.estado || '—',
    ]);

    doc.autoTable({
      startY: finalY + 10,
      head: [['TRACKING', 'FECHA', 'ZONA', 'ESTADO']],
      body: noEntRows,
      theme: 'plain',
      headStyles: {
        fillColor: [80, 80, 85], textColor: LH_WHITE,
        fontStyle: 'bold', fontSize: 7.5, cellPadding: 3,
      },
      bodyStyles: { fontSize: 7.5, cellPadding: 2.5, textColor: [100,100,100] },
      alternateRowStyles: { fillColor: [250, 248, 248] },
      columnStyles: {
        // Total = 182mm (ancho útil A4 con márgenes de 14mm)
        0: { cellWidth: 34, fontStyle: 'bold' },
        1: { cellWidth: 22 },
        2: { cellWidth: 50 },
        3: { cellWidth: 76 },
      },
      didDrawPage: (data) => {
        addPageHeader(data.pageNumber, 99);
        addPageFooter(data.pageNumber, 99);
      },
      margin: { left: MARGIN, right: MARGIN, top: 27, bottom: 18 },
    });
  }

  // ===== FOOTER EN TODAS LAS PÁGINAS =====
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(i, totalPages);
  }

  doc.save(`LH_Liquidacion_${conductor.replace(/\s+/g,'_')}_${new Date().toLocaleDateString('es-AR').replace(/\//g,'-')}.pdf`);
}

function exportAllPDFs() {
  // Respeta el período filtrado en el panel Liquidaciones (igual que el modal).
  const liq = calcLiquidacionesFiltradas();
  const rangoFechas = getLiqRangoFechasLabel();
  const conductores = Object.keys(liq).filter(c => liq[c].filas.length);
  if (!conductores.length) { alert('Sin datos para exportar en el período seleccionado.'); return; }
  conductores.forEach(c => exportPDF(c, { rangoFechas, liqData: liq }));
}


