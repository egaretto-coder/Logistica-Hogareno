function renderTarifas() {
  const cats = ['Muy cerca', 'Cerca', 'Intermedio', 'Lejos', 'Muy Lejos'];
  document.getElementById('tarifas-rows').innerHTML = AppData.tarifas.map((t, i) => `
    <div style="display:grid;grid-template-columns:2fr 1fr 90px 90px 90px 40px;gap:0;padding:8px 16px;border-bottom:1px solid var(--border);align-items:center">
      <input type="text" value="${t.zona}" data-idx="${i}" data-field="zona" style="border:none;background:none;font-weight:500;padding:0;font-size:13px" onchange="updateTarifa(this)" />
      <select data-idx="${i}" data-field="categoria" onchange="updateTarifa(this)" style="border:none;background:none;font-size:12px;padding:0">
        ${cats.map(c => `<option ${c === t.categoria ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <input type="number" value="${t.s_colecta}" data-idx="${i}" data-field="s_colecta" style="width:80px;text-align:right;font-size:12px" onchange="updateTarifa(this)" />
      <input type="number" value="${t.c_colecta}" data-idx="${i}" data-field="c_colecta" style="width:80px;text-align:right;font-size:12px" onchange="updateTarifa(this)" />
      <input type="number" value="${t.sla}" data-idx="${i}" data-field="sla" style="width:80px;text-align:right;font-size:12px" onchange="updateTarifa(this)" />
      <button class="btn btn-sm" style="border:none;color:var(--text-muted)" onclick="deleteTarifa(${i})">✕</button>
    </div>
  `).join('');
}

function updateTarifa(el) {
  const i = parseInt(el.dataset.idx);
  const f = el.dataset.field;
  AppData.tarifas[i][f] = f === 'zona' || f === 'categoria' ? el.value : parseFloat(el.value) || 0;
}

function addZonaRow() {
  AppData.tarifas.push({ zona: 'NUEVA ZONA', categoria: 'Intermedio', s_colecta: 2600, c_colecta: 3100, sla: 2600 });
  renderTarifas();
}

function deleteTarifa(i) {
  if (!confirm('¿Eliminar esta zona?')) return;
  AppData.tarifas.splice(i, 1);
  renderTarifas();
}

function saveTarifas() {
  localStorage.setItem('liq_tarifas', JSON.stringify(AppData.tarifas));
  dbPush('tarifas');
  showToast('Tarifas guardadas');
}

// ===== CONFIG SUPER SLA =====
