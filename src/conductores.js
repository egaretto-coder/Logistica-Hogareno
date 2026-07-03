function renderConductorSelect() {
  const liq = calcLiquidaciones();
  const conductores = Object.keys(liq).sort();
  const sel = document.getElementById('cond-select');
  sel.innerHTML = '<option value="">Seleccionar conductor...</option>' +
    conductores.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderConductorDetail() {
  const cond = document.getElementById('cond-select').value;
  const wrap = document.getElementById('conductor-detail-wrap');
  if (!cond) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🚗</div><div class="empty-title">Seleccioná un conductor</div></div>`;
    return;
  }
  wrap.innerHTML = buildConductorDetail(cond);
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
          <button class="btn" style="color:white;border-color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.1)" onclick="exportPDF('${cond}')">⬇ Exportar PDF</button>
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
                ? '<span class="tag" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a">📦 Dimensión Especial</span>'
                : '<span class="badge ' + (f.tipo === 's_colecta' ? 'badge-blue' : f.tipo === 'c_colecta' ? 'badge-green' : 'badge-gray') + '">' + tipoLabel(f.tipo) + '</span>';
              const notas = f.es_dim_especial
                ? '<div style="font-size:11px;line-height:1.35"><strong>' + (f.dim_condicion || '—') + '</strong>' + (f.dim_cliente ? '<br><span class="muted">Cliente: ' + f.dim_cliente + '</span>' : '') + '</div>'
                : (f.es_super ? '<span class="tag super-sla">⭐ Super SLA</span>' : f.sin_tarifa ? '<span class="tag" style="color:var(--accent)">Sin tarifa</span>' : '');
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
