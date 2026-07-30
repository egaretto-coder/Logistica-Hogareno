function renderConductorSelect() {
  const liq = calcLiquidaciones();
  const conductores = Object.keys(liq).sort();
  const sel = document.getElementById('cond-select');
  sel.innerHTML = '<option value="">Seleccionar conductor...</option>' +
    conductores.map(c => `<option value="${c}">${c}</option>`).join('');
}

// ════════════════════════════════════════════════════════════════════════
//  EDITOR DE CONDUCTOR (control por supervisión humana)
//  El operador filtra conductor + rango de fechas y corrige a mano:
//  tracking, zona, precio (pisa el calculado) y estado (contabiliza o no).
//  Los cambios se guardan solos en la nube e impactan en liquidación y PDF.
// ════════════════════════════════════════════════════════════════════════

let condEditPendientes = false;
let condEditTimer = null;

// Precio automático de un registro (dimensión especial > tarifas/Super SLA).
function precioAutoDe(r) {
  const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
  const dim = r.tracking ? findDimensionEspecial(r.tracking) : null;
  if (dim) return { precio: dim.valor, etiqueta: 'Dimensión Especial' };
  const p = getPrecio((r.cadete || '').trim(), zona);
  return { precio: p.precio, etiqueta: tipoLabel(p.tipo) + (p.es_super ? ' ⭐' : '') + (p.sin_tarifa ? ' (sin tarifa)' : '') };
}

// Filtro "solo envíos incompletos": los que tienen zona vacía o precio efectivo 0.
// Esos envíos NO contabilizan hasta que el operador los complete a mano.
let condSoloIncompletos = false;
function envioIncompleto(r) {
  const sinZona = !String(r.zona || '').trim();
  const manual = precioManualDe(r);
  const precioEf = manual !== null ? manual : precioAutoDe(r).precio;
  return sinZona || !(precioEf > 0);
}
function toggleFiltroIncompletos() {
  condSoloIncompletos = !condSoloIncompletos;
  renderConductorDetail();
}

// Índices (en AppData.records) de los registros del conductor dentro del rango.
function indicesConductorFiltrados(cond) {
  const key = cond.toUpperCase().trim();
  const dISO = document.getElementById('cond-fecha-desde')?.value || '';
  const hISO = document.getElementById('cond-fecha-hasta')?.value || '';
  const desde = dISO ? new Date(dISO + 'T00:00:00') : null;
  const hasta = hISO ? new Date(hISO + 'T23:59:59') : null;
  const out = [];
  AppData.records.forEach((r, i) => {
    if ((r.cadete || '').toUpperCase().trim() !== key) return;
    if (desde || hasta) {
      const f = parseFechaReg(r.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    out.push(i);
  });
  return out;
}

function renderConductorDetail() {
  const cond = document.getElementById('cond-select').value;
  const wrap = document.getElementById('conductor-detail-wrap');
  if (!cond) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="ic ic-truck"></i></div><div class="empty-title">Seleccioná un conductor</div><div class="empty-sub">Vas a poder revisar y corregir sus recorridos antes de liquidar</div></div>`;
    const cEl = document.getElementById('cond-filtro-count'); if (cEl) cEl.textContent = '';
    const bEl = document.getElementById('cond-incompletos-count'); if (bEl) bEl.textContent = '';
    return;
  }

  const idxs = indicesConductorFiltrados(cond);
  const color = avatarColor(cond);

  // Totales con correcciones aplicadas
  let entregados = 0, noEntregados = 0, total = 0, corregidos = 0;
  idxs.forEach(i => {
    const r = AppData.records[i];
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = estadoNorm === ESTADO_CONTABILIZA || ESTADOS_CONTABILIZAN.has(estadoNorm);
    const manual = precioManualDe(r);
    if (manual !== null) corregidos++;
    if (contabiliza) { entregados++; total += manual !== null ? manual : precioAutoDe(r).precio; }
    else noEntregados++;
  });

  // Buscador: filtra SOLO la tabla (no cambia los totales del período de arriba).
  const fCli = (document.getElementById('cond-filtro-cliente')?.value || '').toLowerCase().trim();
  const fTrk = (document.getElementById('cond-filtro-tracking')?.value || '').toLowerCase().trim();
  const fZona = (document.getElementById('cond-filtro-zona')?.value || '').toLowerCase().trim();
  const hayFiltro = !!(fCli || fTrk || fZona || condSoloIncompletos);

  // Contar envíos incompletos (sin zona o sin precio) del período, para el badge del botón.
  let incompletosCount = 0;
  idxs.forEach(i => { if (envioIncompleto(AppData.records[i])) incompletosCount++; });
  const btnInc = document.getElementById('cond-filtro-incompletos');
  if (btnInc) {
    btnInc.style.borderColor = condSoloIncompletos ? '#f59e0b' : '';
    btnInc.style.background = condSoloIncompletos ? '#fffbeb' : '';
    btnInc.style.color = condSoloIncompletos ? '#92400e' : (incompletosCount ? '#b45309' : '');
    btnInc.style.fontWeight = condSoloIncompletos ? '700' : '';
    const badge = document.getElementById('cond-incompletos-count');
    if (badge) badge.textContent = incompletosCount ? (' · ' + incompletosCount) : '';
  }

  const idxsVista = !hayFiltro ? idxs : idxs.filter(i => {
    const r = AppData.records[i];
    if (condSoloIncompletos && !envioIncompleto(r)) return false;
    if (fTrk && !String(r.tracking || '').toLowerCase().includes(fTrk)) return false;
    if (fZona && !String(r.zona || r.localidad || '').toLowerCase().includes(fZona)) return false;
    if (fCli && !String(r.destinatario || '').toLowerCase().includes(fCli)) return false;
    return true;
  });
  const cntEl = document.getElementById('cond-filtro-count');
  if (cntEl) cntEl.textContent = hayFiltro ? ('Mostrando ' + idxsVista.length + ' de ' + idxs.length + ' recorridos') : '';

  const filas = idxsVista.map(i => {
    const r = AppData.records[i];
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = estadoNorm === ESTADO_CONTABILIZA || ESTADOS_CONTABILIZAN.has(estadoNorm);
    const auto = precioAutoDe(r);
    const manual = precioManualDe(r);
    const esCanonico = ['ENTREGADO', 'NO ENTREGADO'].includes(estadoNorm);
    return `
      <tr style="${contabiliza ? '' : 'background:#fdf6f6;'}${manual !== null ? 'box-shadow:inset 3px 0 0 #f59e0b;' : ''}">
        <td><input type="text" value="${r.tracking || ''}" onchange="editarRegistroConductor(${i},'tracking',this.value)"
          class="mono" style="width:130px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:11.5px">${r.destinatario ? '<div class="muted" style="font-size:10px;margin-top:3px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + String(r.destinatario).replace(/"/g,'&quot;') + '"><i class="ic ic-user"></i> ' + r.destinatario + '</div>' : ''}</td>
        <td class="muted mono" style="font-size:12px">${r.fecha || '—'}</td>
        <td><input type="text" value="${(r.zona || '').replace(/"/g,'&quot;')}" onchange="editarRegistroConductor(${i},'zona',this.value)"
          style="width:150px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;text-transform:uppercase"></td>
        <td>
          <select onchange="editarRegistroConductor(${i},'estado',this.value)"
            style="padding:5px 8px;border:1px solid ${contabiliza ? '#86efac' : '#fca5a5'};border-radius:6px;font-size:12px;background:${contabiliza ? '#f0fdf4' : '#fef2f2'};color:${contabiliza ? '#166534' : '#b91c1c'};font-weight:600">
            ${!esCanonico ? `<option value="${(r.estado || '').replace(/"/g,'&quot;')}" selected>${r.estado || '—'}</option>` : ''}
            <option value="Entregado" ${estadoNorm === 'ENTREGADO' ? 'selected' : ''}><i class="ic ic-check"></i> Entregado (contabiliza)</option>
            <option value="No entregado" ${estadoNorm === 'NO ENTREGADO' ? 'selected' : ''}><i class="ic ic-x"></i> No entregado (no suma)</option>
          </select>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:4px">
            <span class="muted" style="font-size:11px">$</span>
            <input type="number" value="${manual !== null ? manual : ''}" placeholder="${auto.precio}"
              onchange="editarRegistroConductor(${i},'precio_manual',this.value)"
              title="Vacío = precio automático (${auto.etiqueta}: ${fmtPeso(auto.precio)})"
              style="width:90px;padding:5px 8px;border:1px solid ${manual !== null ? '#f59e0b' : 'var(--border)'};border-radius:6px;font-size:12px;text-align:right;font-family:monospace;${manual !== null ? 'background:#fffbeb;font-weight:700' : ''}">
          </div>
        </td>
        <td style="font-size:11px;color:var(--text-muted)">
          ${manual !== null
            ? '<span class="tag" style="background:#fffbeb;color:#92400e;border:1px solid #fde68a"><i class="ic ic-edit"></i> Corregido (auto: ' + fmtPeso(auto.precio) + ')</span>'
            : auto.etiqueta}
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="card">
      <div class="conductor-header" style="background: linear-gradient(135deg, ${color} 0%, ${color}cc 100%)">
        <div class="big-avatar" style="background:rgba(255,255,255,0.25)">${initials(cond)}</div>
        <div>
          <div class="conductor-name">${cond}</div>
          <div class="conductor-meta">${idxs.length} recorridos en el período · ${entregados} contabilizan · ${noEntregados} no suman${corregidos ? ' · ✏️ ' + corregidos + ' corregidos a mano' : ''}</div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-size:11px;opacity:0.85;text-transform:uppercase;letter-spacing:.04em">Total del período</div>
          <div style="font-size:24px;font-weight:700">${fmtPeso(total)}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tracking</th><th>Fecha</th><th>Zona</th><th>Estado (contabiliza)</th><th>Precio</th><th>Origen del precio</th>
            </tr>
          </thead>
          <tbody>
            ${filas || `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">${(condSoloIncompletos && !fCli && !fTrk && !fZona) ? '✅ No hay envíos sin zona ni precio en este período' : hayFiltro ? '🔎 Ningún envío coincide con el filtro (revisá cliente / tracking / zona, o tocá Limpiar)' : 'Sin recorridos del conductor en el período elegido'}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div style="padding:10px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
        💡 Dejá el precio <strong>vacío</strong> para volver al cálculo automático. Las filas con borde naranja tienen precio corregido a mano.
      </div>
    </div>`;
}

// Limpia los filtros del buscador (cliente / tracking / zona) y re-renderiza.
// También se usa al cambiar de conductor, para no arrastrar un filtro viejo.
function limpiarFiltrosConductor() {
  ['cond-filtro-cliente', 'cond-filtro-tracking', 'cond-filtro-zona'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  condSoloIncompletos = false;
  renderConductorDetail();
}

// Ids (de nube) de los registros editados y aún no sincronizados.
const condEditIdsSucios = new Set();

// Aplica una edición a un registro y programa el guardado automático.
function editarRegistroConductor(idx, campo, valor) {
  const r = AppData.records[idx];
  if (!r) return;
  if (r._historico) {
    showToast('🗄️ Registro archivado (solo lectura): no se puede editar');
    renderConductorDetail();
    return;
  }
  if (campo === 'tracking') r.tracking = String(valor).trim();
  if (campo === 'zona') r.zona = String(valor).trim().toUpperCase();
  if (campo === 'estado') r.estado = valor;
  if (campo === 'precio_manual') {
    const v = String(valor).trim();
    r.precio_manual = v === '' ? null : (parseFloat(v) || 0);
  }
  if (r.id) condEditIdsSucios.add(r.id);
  else console.warn('Registro sin id de nube (no se podrá sincronizar):', r.tracking);
  condEditPendientes = true;
  actualizarEstadoEdicion('Cambios sin guardar…');
  renderConductorDetail();
  // Autoguardado con espera corta: agrupa varias ediciones en un solo guardado.
  clearTimeout(condEditTimer);
  condEditTimer = setTimeout(guardarEdicionConductores, 2500);
}

function actualizarEstadoEdicion(txt) {
  const el = document.getElementById('cond-edit-estado');
  if (el) el.textContent = txt || '';
  const btn = document.getElementById('cond-guardar-btn');
  if (btn) btn.style.display = condEditPendientes ? '' : 'none';
}

// Sincroniza SOLO las filas editadas (update por id) — no reescribe la base.
async function guardarEdicionConductores() {
  if (!condEditPendientes || !condEditIdsSucios.size) return;
  clearTimeout(condEditTimer);
  if (!window.DB || !DB.ready) { actualizarEstadoEdicion('⚠️ Sin conexión — reintentá con el botón'); return; }
  actualizarEstadoEdicion('☁️ Guardando…');
  const ids = Array.from(condEditIdsSucios);
  let fallos = 0;
  for (const id of ids) {
    const r = AppData.records.find(x => x.id === id);
    if (!r) { condEditIdsSucios.delete(id); continue; }
    try {
      await DB.updateWhere('registros', 'id', id, {
        tracking: r.tracking || '', zona: r.zona || '', estado: r.estado || '',
        fecha_date: fechaISOde(r.fecha), clave: claveRegistro(r),
        precio_manual: (r.precio_manual === null || r.precio_manual === undefined || r.precio_manual === '') ? null : parseFloat(r.precio_manual)
      });
      condEditIdsSucios.delete(id);
    } catch (e) {
      console.warn('No se pudo guardar la fila ' + id + ':', e);
      fallos++;
    }
  }
  if (!fallos) {
    condEditPendientes = false;
    const h = new Date();
    actualizarEstadoEdicion('✓ Guardado ' + String(h.getHours()).padStart(2,'0') + ':' + String(h.getMinutes()).padStart(2,'0'));
  } else {
    actualizarEstadoEdicion('⚠️ ' + fallos + ' cambio(s) sin guardar — reintentá con el botón');
  }
}

function buildConductorDetail(cond) {
  const liq = calcLiquidaciones();
  const d = liq[cond];
  if (!d) return '<div class="empty-state"><div class="empty-sub">Sin datos</div></div>';

  const cat = AppData.panelConductores.find(x => x.nombre.toUpperCase() === cond.toUpperCase());
  const color = avatarColor(cond);

  const sinCol = d.filas.filter(f => f.tipo === 's_colecta');
  const conCol = d.filas.filter(f => f.tipo === 'c_colecta');
  const sla = d.filas.filter(f => f.tipo === 'sla');

  return `
    <div class="card">
      <div class="conductor-header" style="background: linear-gradient(135deg, ${color} 0%, ${color}cc 100%)">
        <div class="big-avatar" style="background:rgba(255,255,255,0.25)">${initials(cond)}</div>
        <div>
          <div class="conductor-name">Liquidación · ${cond}</div>
          <div class="conductor-meta">${cat ? 'Categoría: ' + tipoLabel(cat.categoria === 'super_sla' ? 'sla' : cat.categoria) : 'Sin categorizar'} · ${d.filas.length} entregados liquidados · ${d.filas_excluidas.length} en otros estados</div>
        </div>
        <div style="margin-left:auto">
          <button class="btn" style="color:white;border-color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.1)" onclick="exportPDF('${cond}')"><i class="ic ic-download"></i> Exportar PDF</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--border)">
        ${[
          ['S/ Colecta', sinCol.length, sinCol.reduce((s,f)=>s+f.subtotal,0)],
          ['C/ Colecta', conCol.length, conCol.reduce((s,f)=>s+f.subtotal,0)],
          ['SLA Cumplido', sla.length, sla.reduce((s,f)=>s+f.subtotal,0)],
          ['Total liquidado', d.filas.length, d.total],
        ].map(([label, cnt, tot]) => `
          <div style="padding:14px 18px;border-right:1px solid var(--border);${label==='Total liquidado'?'background:var(--surface-0);':''}">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">${label}</div>
            <div style="font-size:20px;font-weight:600;${label==='Total liquidado'?'color:var(--accent)':''}">${fmtPeso(tot)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${cnt} entregados</div>
          </div>
        `).join('')}
      </div>
      <div style="padding:14px 20px 4px;font-size:12px;font-weight:600;color:var(--text-secondary)">Recorridos entregados (contabilizan)</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tracking</th><th>Fecha</th><th>Zona</th><th>Tipo</th><th>Precio</th><th>Subtotal</th><th>Notas</th>
            </tr>
          </thead>
          <tbody>
            ${d.filas.length ? d.filas.map(f => {
              // Estilo especial para dimensiones
              const bgDim = f.es_dim_especial ? 'background:#fef9c3' : '';
              const tipoBadge = f.es_dim_especial
                ? '<span class="tag" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a"><i class="ic ic-box"></i> Dimensión Especial</span>'
                : '<span class="badge ' + (f.tipo === 's_colecta' ? 'badge-blue' : f.tipo === 'c_colecta' ? 'badge-green' : 'badge-gray') + '">' + tipoLabel(f.tipo) + '</span>';
              const notas = f.es_dim_especial
                ? '<div style="font-size:11px;line-height:1.35"><strong>' + (f.dim_condicion || '—') + '</strong>' + (f.dim_cliente ? '<br><span class="muted">Cliente: ' + f.dim_cliente + '</span>' : '') + '</div>'
                : (f.es_super ? '<span class="tag super-sla"><i class="ic ic-star"></i> Super SLA</span>' : f.sin_tarifa ? '<span class="tag" style="color:var(--accent)">Sin tarifa</span>' : '');
              return '<tr style="' + bgDim + '">' +
                '<td class="mono muted" style="font-size:11px">' + f.tracking + '</td>' +
                '<td class="muted">' + (f.fecha || '—') + '</td>' +
                '<td><strong>' + f.zona + '</strong></td>' +
                '<td>' + tipoBadge + '</td>' +
                '<td class="mono">' + fmtPeso(f.precio) + '</td>' +
                '<td class="mono"><strong>' + fmtPeso(f.subtotal) + '</strong></td>' +
                '<td>' + notas + '</td>' +
                '</tr>';
            }).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">Sin recorridos entregados</td></tr>`}
          </tbody>
        </table>
      </div>
      ${d.filas_excluidas.length ? `
        <div style="padding:14px 20px 4px;font-size:12px;font-weight:600;color:var(--text-muted);border-top:1px solid var(--border);margin-top:4px">No entregados — visibles, no suman al total (${d.filas_excluidas.length})</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Tracking</th><th>Fecha</th><th>Zona</th><th>Estado</th></tr>
            </thead>
            <tbody>
              ${d.filas_excluidas.map(f => `
                <tr style="opacity:0.65">
                  <td class="mono muted" style="font-size:11px">${f.tracking}</td>
                  <td class="muted">${f.fecha || '—'}</td>
                  <td class="muted">${f.zona || '—'}</td>
                  <td><span class="badge badge-gray">${f.estado || '—'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function showConductorModal(cond) {
  document.getElementById('modal-title').textContent = 'Detalle · ' + cond;
  document.getElementById('modal-body').innerHTML = buildConductorDetail(cond);
  document.getElementById('modal-backdrop').classList.add('open');
}

function closeModal(e) {
  if (!e || e.target.id === 'modal-backdrop') {
    document.getElementById('modal-backdrop').classList.remove('open');
  }
}

// ===== REPORTE ZONA =====
