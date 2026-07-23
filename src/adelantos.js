// ════════════════════════════════════════════════════════════════════════
//  ADELANTOS (préstamos a conductores devueltos en cuotas)
//  Se registra el adelanto (monto + cantidad de cuotas). Cada cuota se
//  "descuenta" registrándola con una fecha; esa cuota aparece automáticamente
//  como deducción en la liquidación de esa semana (ver liquidaciones-pdf.js).
// ════════════════════════════════════════════════════════════════════════

// Fecha (DD/MM/YYYY) a la que se imputa la cuota — la del selector del panel.
function fechaDescuentoAdelanto() {
  const iso = document.getElementById('adelantos-fecha')?.value || hoyISO();
  return isoToDMY(iso);
}

function renderAdelantos() {
  const cont = document.getElementById('adelantos-rows');
  if (!cont) return;

  const fInput = document.getElementById('adelantos-fecha');
  if (fInput && !fInput.value) fInput.value = hoyISO();

  const search = (document.getElementById('adelantos-search')?.value || '').toLowerCase().trim();
  const lista = AppData.adelantos
    .filter(a => !search || String(a.conductor).toLowerCase().includes(search))
    .sort((a, b) => (adelantoSaldado(a) ? 1 : 0) - (adelantoSaldado(b) ? 1 : 0)
                 || String(a.conductor).localeCompare(String(b.conductor)));

  const countEl = document.getElementById('adelantos-count');
  const activos = AppData.adelantos.filter(a => !adelantoSaldado(a)).length;
  if (countEl) countEl.textContent = AppData.adelantos.length + ' adelantos · ' + activos + ' activos';

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">💳</div><div class="empty-title">Sin adelantos</div><div class="empty-sub">Registrá uno con "+ Nuevo adelanto"</div></div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(a => {
    const pagadas = cuotasPagadasDe(a.id);
    const saldado = pagadas >= a.cuotas_total;
    const pct = a.cuotas_total ? Math.round(pagadas / a.cuotas_total * 100) : 0;
    const saldo = saldoAdelanto(a);
    return '<tr style="' + (saldado ? 'opacity:0.6;' : '') + '">' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(a.conductor) + ';width:28px;height:28px;font-size:10px">' + initials(a.conductor) + '</div><strong>' + a.conductor + '</strong></div></td>' +
      '<td class="mono muted">' + (a.fecha || '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(a.monto_total) + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(a.monto_cuota) + '</td>' +
      '<td style="min-width:150px"><div style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:7px;background:var(--surface-0);border-radius:99px;overflow:hidden;border:1px solid var(--border)"><div style="height:100%;width:' + pct + '%;background:' + (saldado ? '#166534' : '#2d4fa1') + '"></div></div>' +
        '<span style="font-size:12px;font-weight:600;white-space:nowrap">' + pagadas + '/' + a.cuotas_total + '</span>' +
      '</div></td>' +
      '<td class="mono" style="text-align:right;font-weight:700;color:' + (saldo > 0 ? '#b45309' : '#166534') + '">' + (saldo > 0 ? fmtPeso(saldo) : '✓ Saldado') + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        (saldado ? '' : '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="descontarCuota(' + a.id + ')" title="Registrar la próxima cuota en la fecha elegida arriba">− Cuota</button>') +
        '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="verHistorialAdelanto(' + a.id + ')" title="Ver cuotas">📋</button>' +
        '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5" onclick="eliminarAdelanto(' + a.id + ')">🗑</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// Registra la próxima cuota de un adelanto en la fecha elegida (la de su semana).
async function descontarCuota(adelantoId) {
  const a = AppData.adelantos.find(x => x.id === adelantoId);
  if (!a) return;
  if (adelantoSaldado(a)) { showToast('Ese adelanto ya está saldado'); return; }
  const nro = cuotasPagadasDe(a.id) + 1;
  const fecha = fechaDescuentoAdelanto();
  if (!confirm('¿Descontar la cuota ' + nro + '/' + a.cuotas_total + ' (' + fmtPeso(a.monto_cuota) + ') de ' + a.conductor + ' en la semana del ' + fecha + '?\nAparecerá en su liquidación de esa fecha.')) return;
  try {
    const row = await DB.insertRow('adelanto_cuotas', { adelanto_id: adelantoId, nro, monto: a.monto_cuota, fecha, fecha_date: fechaISOde(fecha) });
    AppData.adelantoCuotas.push({ id: row.id, adelanto_id: adelantoId, nro, monto: a.monto_cuota, fecha });
    renderAdelantos();
    showToast('✅ Cuota ' + nro + '/' + a.cuotas_total + ' de ' + a.conductor + ' descontada (' + fecha + ')');
  } catch (e) { console.warn('descontarCuota:', e); showToast('⛔ No se pudo registrar la cuota'); }
}

// Descuenta la próxima cuota de TODOS los adelantos activos, misma fecha (rutina semanal).
async function descontarCuotaSemanal() {
  const activos = AppData.adelantos.filter(a => !adelantoSaldado(a));
  if (!activos.length) { showToast('No hay adelantos activos'); return; }
  const fecha = fechaDescuentoAdelanto();
  if (!confirm('¿Descontar una cuota a los ' + activos.length + ' adelantos activos en la semana del ' + fecha + '?\nCada cuota aparecerá en la liquidación de esa semana del conductor.')) return;
  let ok = 0;
  for (const a of activos) {
    const nro = cuotasPagadasDe(a.id) + 1;
    try {
      const row = await DB.insertRow('adelanto_cuotas', { adelanto_id: a.id, nro, monto: a.monto_cuota, fecha, fecha_date: fechaISOde(fecha) });
      AppData.adelantoCuotas.push({ id: row.id, adelanto_id: a.id, nro, monto: a.monto_cuota, fecha });
      ok++;
    } catch (e) { console.warn('cuota masiva', a.conductor, e); }
  }
  renderAdelantos();
  showToast('✅ ' + ok + ' cuota(s) descontadas para la semana del ' + fecha);
}

// ── Modal "nuevo adelanto" ──────────────────────────────────────────────
function openAddAdelantoModal() {
  document.getElementById('madv-conductor').value = '';
  document.getElementById('madv-monto').value = '';
  document.getElementById('madv-cuotas').value = '';
  document.getElementById('madv-fecha').value = hoyISO();
  document.getElementById('madv-obs').value = '';
  poblarConductoresAdelantoDatalist();
  actualizarPreviewCuota();
  document.getElementById('modal-adelanto-backdrop').style.display = 'flex';
}
function closeAdelantoModal(e) {
  if (!e || e.target.id === 'modal-adelanto-backdrop') document.getElementById('modal-adelanto-backdrop').style.display = 'none';
}
function poblarConductoresAdelantoDatalist() {
  const dl = document.getElementById('madv-conductores-list');
  if (!dl) return;
  const nombres = AppData.panelConductores.map(c => c.nombre);
  dl.innerHTML = Array.from(new Set(nombres)).sort().map(n => '<option value="' + n + '">').join('');
}
function actualizarPreviewCuota() {
  const monto = parseFloat(document.getElementById('madv-monto').value) || 0;
  const cuotas = parseInt(document.getElementById('madv-cuotas').value) || 0;
  const el = document.getElementById('madv-preview');
  if (el) el.textContent = (monto > 0 && cuotas > 0)
    ? 'Cada cuota: ' + fmtPeso(Math.round(monto / cuotas)) + '  ×  ' + cuotas + ' cuotas'
    : 'Cada cuota: —';
}
async function guardarAdelantoModal() {
  const conductor = document.getElementById('madv-conductor').value.trim().toUpperCase();
  const monto_total = parseFloat(document.getElementById('madv-monto').value) || 0;
  const cuotas_total = parseInt(document.getElementById('madv-cuotas').value) || 0;
  const iso = document.getElementById('madv-fecha').value;
  const obs = document.getElementById('madv-obs').value.trim();
  if (!conductor) { alert('El conductor es obligatorio.'); return; }
  if (monto_total <= 0) { alert('El monto del adelanto debe ser mayor a 0.'); return; }
  if (cuotas_total < 1) { alert('Ingresá la cantidad de cuotas (1 o más).'); return; }
  const monto_cuota = Math.round(monto_total / cuotas_total);
  const fecha = iso ? isoToDMY(iso) : isoToDMY(hoyISO());
  try {
    const row = await DB.insertRow('adelantos', { conductor, monto_total, cuotas_total, monto_cuota, fecha, obs });
    AppData.adelantos.push({ id: row.id, conductor, monto_total, cuotas_total, monto_cuota, fecha, obs });
    document.getElementById('modal-adelanto-backdrop').style.display = 'none';
    renderAdelantos();
    showToast('✅ Adelanto de ' + conductor + ': ' + fmtPeso(monto_total) + ' en ' + cuotas_total + ' cuotas de ' + fmtPeso(monto_cuota));
  } catch (e) { console.warn('guardarAdelantoModal:', e); alert('No se pudo guardar el adelanto: ' + (e.message || e)); }
}

async function eliminarAdelanto(id) {
  const a = AppData.adelantos.find(x => x.id === id);
  if (!a) return;
  if (!confirm('¿Eliminar el adelanto de ' + a.conductor + '?\nSe borran también sus cuotas descontadas (afecta liquidaciones de esas semanas).')) return;
  try {
    await DB.deleteWhere('adelantos', 'id', id); // cascade borra las cuotas
    AppData.adelantos = AppData.adelantos.filter(x => x.id !== id);
    AppData.adelantoCuotas = AppData.adelantoCuotas.filter(c => c.adelanto_id !== id);
    renderAdelantos();
    showToast('🗑 Adelanto eliminado');
  } catch (e) { console.warn('eliminarAdelanto:', e); showToast('⛔ No se pudo eliminar'); }
}

// Deshace la última cuota descontada (por si se cargó de más).
async function deshacerUltimaCuota(adelantoId) {
  const cuotas = cuotasDeAdelanto(adelantoId).sort((x, y) => y.nro - x.nro);
  if (!cuotas.length) { showToast('No hay cuotas para deshacer'); return; }
  const ult = cuotas[0];
  if (!confirm('¿Deshacer la cuota ' + ult.nro + ' (' + fmtPeso(ult.monto) + ', semana del ' + ult.fecha + ')?')) return;
  try {
    await DB.deleteWhere('adelanto_cuotas', 'id', ult.id);
    AppData.adelantoCuotas = AppData.adelantoCuotas.filter(c => c.id !== ult.id);
    verHistorialAdelanto(adelantoId);
    renderAdelantos();
    showToast('↩ Cuota deshecha');
  } catch (e) { console.warn('deshacerUltimaCuota:', e); showToast('⛔ No se pudo deshacer'); }
}

// Modal detalle: cuotas del adelanto (pagadas y pendientes).
function verHistorialAdelanto(adelantoId) {
  const a = AppData.adelantos.find(x => x.id === adelantoId);
  if (!a) return;
  const cuotas = cuotasDeAdelanto(adelantoId);
  document.getElementById('modal-title').textContent = 'Adelanto · ' + a.conductor;
  const filas = [];
  for (let i = 1; i <= a.cuotas_total; i++) {
    const c = cuotas.find(x => x.nro === i);
    filas.push('<tr>' +
      '<td class="mono">' + i + '/' + a.cuotas_total + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(c ? c.monto : a.monto_cuota) + '</td>' +
      '<td>' + (c ? '<span class="badge badge-green">✓ Descontada</span>' : '<span class="badge badge-gray">Pendiente</span>') + '</td>' +
      '<td class="mono muted">' + (c ? c.fecha : '—') + '</td>' +
    '</tr>');
  }
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">' +
      '<div>Monto total: <strong>' + fmtPeso(a.monto_total) + '</strong></div>' +
      '<div>Cuota: <strong>' + fmtPeso(a.monto_cuota) + '</strong></div>' +
      '<div>Pagadas: <strong>' + cuotasPagadasDe(adelantoId) + '/' + a.cuotas_total + '</strong></div>' +
      '<div>Saldo: <strong style="color:' + (saldoAdelanto(a) > 0 ? '#b45309' : '#166534') + '">' + fmtPeso(saldoAdelanto(a)) + '</strong></div>' +
    '</div>' +
    (a.obs ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">📝 ' + a.obs + '</div>' : '') +
    '<div class="table-wrap" style="max-height:46vh;overflow:auto"><table><thead><tr><th>Cuota</th><th style="text-align:right">Monto</th><th>Estado</th><th>Semana</th></tr></thead><tbody>' + filas.join('') + '</tbody></table></div>' +
    (cuotasPagadasDe(adelantoId) ? '<div style="margin-top:10px;text-align:right"><button class="btn btn-sm" style="color:#b91c1c;border-color:#fca5a5" onclick="deshacerUltimaCuota(' + adelantoId + ')">↩ Deshacer última cuota</button></div>' : '');
  document.getElementById('modal-backdrop').classList.add('open');
}

// ── Plantilla + importación de Excel (crea adelantos; las cuotas se descuentan aparte) ──
function descargarPlantillaAdelantos() {
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Completá desde la fila 3 (una fila por adelanto). La cuota se calcula sola = Monto total / Cuotas. Las cuotas se descuentan después con "− Cuota".'],
    ['Conductor', 'Monto total', 'Cuotas', 'Fecha', 'Observación'],
    ['ALEJO BRIEND', 1000000, 10, '15/07/2026', 'Adelanto acordado'],
    ['FEDERICO LABIGNAN', 500000, 5, '16/07/2026', 'Anticipo quincenal'],
    ['NOMBRE APELLIDO', '', '', '', ''],
    ['NOMBRE APELLIDO', '', '', '', ''],
    ['NOMBRE APELLIDO', '', '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 30 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Adelantos');
  XLSX.writeFile(wb, 'Plantilla_Adelantos.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importAdelantos(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío o no tiene datos suficientes.'); return; }

      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('conductor') || cells.includes('cadete') || cells.includes('nombre')) { headerRowIdx = r; break; }
      }
      if (headerRowIdx < 0) { alert('No se encontró una fila de encabezados válida (falta la columna "Conductor").\nDescargá la plantilla oficial.'); return; }

      const header = rows[headerRowIdx].map(h => String(h).toLowerCase().trim());
      const idx = {
        conductor: header.findIndex(h => h.includes('conductor') || h.includes('cadete') || h.includes('nombre')),
        monto:     header.findIndex(h => h.includes('monto') || h.includes('total') || h.includes('importe')),
        cuotas:    header.findIndex(h => h.includes('cuota')),
        fecha:     header.findIndex(h => h.includes('fecha')),
        obs:       header.findIndex(h => h.includes('observ') || h.includes('nota') || h.includes('detalle') || h.includes('comentar')),
      };
      if (idx.conductor < 0) { alert('No se encontró la columna "Conductor".'); return; }

      const parseNum = v => {
        if (v === '' || v == null) return 0;
        if (typeof v === 'number') return v;
        const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? 0 : n;
      };

      const nuevos = [];
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const conductor = String(r[idx.conductor] || '').trim().toUpperCase();
        if (!conductor || conductor === 'NOMBRE APELLIDO') continue;
        const monto_total = idx.monto >= 0 ? parseNum(r[idx.monto]) : 0;
        const cuotas_total = idx.cuotas >= 0 ? Math.round(parseNum(r[idx.cuotas])) : 0;
        if (monto_total <= 0 || cuotas_total < 1) continue;
        const fecha = idx.fecha >= 0 ? fechaCeldaExcel(r[idx.fecha]) : '';
        const obs = idx.obs >= 0 ? String(r[idx.obs] || '').trim() : '';
        nuevos.push({ conductor, monto_total, cuotas_total, monto_cuota: Math.round(monto_total / cuotas_total), fecha, obs });
      }

      if (!nuevos.length) { alert('No se importó ningún adelanto válido (revisá Conductor, Monto total y Cuotas).'); return; }

      let ok = 0;
      for (const a of nuevos) {
        try {
          const row = await DB.insertRow('adelantos', a);
          AppData.adelantos.push({ id: row.id, ...a });
          ok++;
        } catch (err) { console.warn('importAdelantos fila', a.conductor, err); }
      }
      renderAdelantos();
      showToast('✅ Importados ' + ok + ' adelantos');
    } catch (err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}
