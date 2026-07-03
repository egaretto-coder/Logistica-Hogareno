function renderSuperSLA() {
  const conductoresSuperSLA = AppData.panelConductores.filter(c => c.categoria === 'super_sla');
  const wrap = document.getElementById('supersla-conductor-bloques');

  if (!conductoresSuperSLA.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:60px 20px">
        <div class="empty-icon">⭐</div>
        <div class="empty-title">No hay conductores con categoría Super SLA</div>
        <div class="empty-sub">Asigná la categoría "Super SLA" a un conductor en el <strong>Panel de conductores</strong> para configurar sus zonas especiales acá.</div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" onclick="showPage('panel-conductores')">Ir al Panel de conductores ↗</button>
        </div>
      </div>`;
    return;
  }

  wrap.innerHTML = conductoresSuperSLA.map(cond => {
    const nombre = cond.nombre;
    const color  = avatarColor(nombre);
    const reglas = AppData.superSLA.filter(
      r => r.conductor.toUpperCase().trim() === nombre.toUpperCase().trim()
    );

    const filasZonas = reglas.length
      ? reglas.map(r => {
          const realIdx = AppData.superSLA.indexOf(r);
          return `
          <div style="display:grid;grid-template-columns:1fr 160px 36px;gap:0;padding:0;border-bottom:1px solid var(--border);align-items:stretch">
            <div style="padding:10px 16px;display:flex;align-items:center">
              <input type="text" value="${r.zona}" data-idx="${realIdx}" data-field="zona"
                placeholder="Ej: PILAR"
                style="border:none;background:none;font-size:13px;font-weight:500;width:100%;outline:none;color:var(--text-primary)"
                onchange="updateSuperSLA(this)" />
            </div>
            <div style="padding:10px 16px;border-left:1px solid var(--border);display:flex;align-items:center;gap:4px">
              <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">$</span>
              <input type="number" value="${r.precio || r.sla || 0}" data-idx="${realIdx}" data-field="precio"
                style="border:none;background:none;font-size:14px;font-weight:600;width:100%;outline:none;text-align:right;color:var(--text-primary)"
                onchange="updateSuperSLA(this)" />
            </div>
            <div style="border-left:1px solid var(--border);display:flex;align-items:center;justify-content:center">
              <button style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;padding:8px;width:100%;height:100%"
                onclick="deleteSuperSLA(${realIdx})" title="Eliminar zona">✕</button>
            </div>
          </div>`;
        }).join('')
      : `<div style="padding:24px 16px;text-align:center;font-size:13px;color:var(--text-muted)">
           Sin zonas especiales — usá "+ Agregar zona" para cargar la primera.
         </div>`;

    // Total de zonas configuradas para el resumen
    const totalZonas = reglas.length;

    return `
    <div class="card" style="margin-bottom:16px;overflow:hidden">

      <!-- Header conductor -->
      <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)">
        <div class="conductor-avatar" style="background:${color};width:38px;height:38px;font-size:13px;flex-shrink:0">${initials(nombre)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600">${nombre}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${cond.id ? `<span style="font-family:monospace;background:var(--surface-0);padding:1px 6px;border-radius:3px;border:1px solid var(--border)">${cond.id}</span>` : ''}
            <span class="tag super-sla">⭐ Super SLA</span>
            <span>${totalZonas} zona${totalZonas !== 1 ? 's' : ''} especial${totalZonas !== 1 ? 'es' : ''} configurada${totalZonas !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <button class="btn btn-sm" onclick="addZonaSuperSLA('${nombre}')">+ Agregar zona</button>
      </div>

      <!-- Header columnas -->
      <div style="display:grid;grid-template-columns:1fr 160px 36px;gap:0;background:var(--surface-0);border-bottom:1px solid var(--border)">
        <div style="padding:8px 16px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Zona afectada</div>
        <div style="padding:8px 16px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;border-left:1px solid var(--border)">Tarifa Super SLA</div>
        <div style="border-left:1px solid var(--border)"></div>
      </div>

      <!-- Filas -->
      <div>${filasZonas}</div>

    </div>`;
  }).join('');
}

function addZonaSuperSLA(conductor) {
  AppData.superSLA.push({ conductor: conductor.toUpperCase(), zona: '', precio: 3500 });
  renderSuperSLA();
  setTimeout(() => {
    const inputs = document.querySelectorAll('[data-field="zona"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }, 50);
}

function updateSuperSLA(el) {
  const i = parseInt(el.dataset.idx), f = el.dataset.field;
  AppData.superSLA[i][f] = f === 'zona' || f === 'conductor'
    ? el.value.toUpperCase()
    : parseFloat(el.value) || 0;
}

function deleteSuperSLA(i) {
  if (!confirm('¿Eliminar esta zona especial?')) return;
  AppData.superSLA.splice(i, 1);
  renderSuperSLA();
}

function saveSuperSLA() {
  localStorage.setItem('liq_supersla', JSON.stringify(AppData.superSLA));
  dbPush('super_sla');
  showToast('Tarifas Super SLA guardadas');
}

// Abre el modal para sumar a Super SLA un conductor ya existente del panel.
function openAgregarConductorSuperSLA() {
  const elegibles = AppData.panelConductores
    .filter(c => (c.categoria || '') !== 'super_sla')
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  if (!elegibles.length) {
    showToast('Todos los conductores del panel ya están en Super SLA');
    return;
  }

  const sel = document.getElementById('supersla-nuevo-conductor');
  sel.innerHTML = elegibles.map(c => {
    const cat = c.categoria ? ((CATEGORIA_INFO[c.categoria] && CATEGORIA_INFO[c.categoria].label) || c.categoria) : 'Sin categoría';
    return `<option value="${c.id}">${c.nombre} — ${cat}</option>`;
  }).join('');

  document.getElementById('modal-supersla-backdrop').style.display = 'flex';
}

function closeAgregarConductorSuperSLA(e) {
  if (!e || e.target.id === 'modal-supersla-backdrop') {
    document.getElementById('modal-supersla-backdrop').style.display = 'none';
  }
}

// Pasa el conductor elegido a categoría Super SLA (se refleja también en el panel).
function confirmarAgregarConductorSuperSLA() {
  const sel = document.getElementById('supersla-nuevo-conductor');
  const id = sel && sel.value;
  const cond = AppData.panelConductores.find(c => String(c.id) === String(id));
  if (!cond) { showToast('Seleccioná un conductor'); return; }

  cond.categoria = 'super_sla';
  localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
  dbPush('panel_conductores');

  document.getElementById('modal-supersla-backdrop').style.display = 'none';
  renderSuperSLA();
  showToast('✅ ' + cond.nombre + ' agregado a Super SLA — cargale sus zonas con "+ Agregar zona"');
}

// ===== PANEL DE CONDUCTORES =====

