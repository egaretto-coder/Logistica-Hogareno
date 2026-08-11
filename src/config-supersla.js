function renderSuperSLA() {
  const todos = AppData.panelConductores.filter(c => c.categoria === 'super_sla');
  const wrap = document.getElementById('supersla-conductor-bloques');
  const countEl = document.getElementById('supersla-count');

  if (!todos.length) {
    if (countEl) countEl.textContent = '';
    wrap.innerHTML = `
      <div class="empty-state" style="padding:60px 20px">
        <div class="empty-icon"><i class="ic ic-star"></i></div>
        <div class="empty-title">No hay conductores con categoría Super SLA</div>
        <div class="empty-sub">Asigná la categoría "Super SLA" a un conductor en el <strong>Panel de conductores</strong> para configurar sus zonas especiales acá.</div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" onclick="showPage('panel-conductores')">Ir al Panel de conductores ↗</button>
        </div>
      </div>`;
    return;
  }

  // Filtro del buscador: por nombre o ID del conductor.
  const q = (document.getElementById('supersla-search')?.value || '').toLowerCase().trim();
  const conductoresSuperSLA = q
    ? todos.filter(c =>
        String(c.nombre).toLowerCase().includes(q) ||
        String(c.id).toLowerCase().includes(q))
    : todos;

  if (countEl) countEl.textContent = conductoresSuperSLA.length + ' de ' + todos.length + ' conductores';

  if (!conductoresSuperSLA.length) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:40px 20px">
        <div class="empty-icon"><i class="ic ic-search"></i></div>
        <div class="empty-title">Sin resultados</div>
        <div class="empty-sub">Ningún conductor Super SLA coincide con “${q}”.</div>
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
                onclick="deleteSuperSLA(${realIdx})" title="Eliminar zona"><i class="ic ic-x"></i></button>
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
            <span class="tag super-sla"><i class="ic ic-star"></i> Super SLA</span>
            <span>${totalZonas} zona${totalZonas !== 1 ? 's' : ''} especial${totalZonas !== 1 ? 'es' : ''} configurada${totalZonas !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <button class="btn btn-sm" onclick="addZonaSuperSLA('${nombre.replace(/'/g, "\\'")}')">+ Agregar zona</button>
        <button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarConductorSuperSLA('${nombre.replace(/'/g, "\\'")}')" title="Quitar de Super SLA"><i class="ic ic-trash"></i></button>
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
  // Deja una zona vacía lista para completar (renderiza y enfoca el campo Zona).
  addZonaSuperSLA(cond.nombre);
  showToast('✅ ' + cond.nombre + ' agregado a Super SLA — completá la zona y guardá');
}

// Quita un conductor de Super SLA: pasa a categoría "SLA Cumplido" (el estándar
// que usaría igual en las zonas no especiales) y borra sus zonas especiales.
function eliminarConductorSuperSLA(nombre) {
  const key = normNombre(nombre);
  const cond = AppData.panelConductores.find(c => normNombre(c.nombre) === key);
  const reglas = AppData.superSLA.filter(r => normNombre(r.conductor) === key);
  if (!confirm('¿Quitar a ' + nombre + ' de Super SLA?\n\n' +
    'Pasa a categoría "SLA Cumplido" y se eliminan sus ' + reglas.length + ' zona(s) especial(es). ' +
    'Podés volver a agregarlo cuando quieras.')) return;
  if (cond) cond.categoria = 'sla';
  AppData.superSLA = AppData.superSLA.filter(r => normNombre(r.conductor) !== key);
  invalidarIndicePanel();
  try {
    localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
    localStorage.setItem('liq_supersla', JSON.stringify(AppData.superSLA));
  } catch (e) {}
  dbPush('panel_conductores');
  dbPush('super_sla');
  renderSuperSLA();
  showToast('🗑 ' + nombre + ' quitado de Super SLA (pasó a SLA Cumplido)');
}

// Exporta los conductores Super SLA con sus zonas y tarifas a Excel.
// Una fila por Conductor+Zona; los conductores sin zonas salen con Zona vacía
// (para preservar la membresía al reimportar).
function exportarSuperSLA() {
  const conductores = AppData.panelConductores
    .filter(c => c.categoria === 'super_sla')
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  if (!conductores.length) { showToast('No hay conductores Super SLA para exportar'); return; }
  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por Conductor+Zona. El ID ayuda a re-vincular. Una fila con Zona vacía deja al conductor en Super SLA sin zonas.'],
    ['Conductor', 'ID', 'Zona', 'Precio'],
  ];
  conductores.forEach(c => {
    const reglas = AppData.superSLA.filter(r => normNombre(r.conductor) === normNombre(c.nombre));
    if (reglas.length) reglas.forEach(r => aoa.push([c.nombre, c.id || '', r.zona || '', _num(r.precio || r.sla || 0)]));
    else aoa.push([c.nombre, c.id || '', '', '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 22 }, { wch: 12 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Super SLA');
  XLSX.writeFile(wb, 'Super_SLA.xlsx');
  showToast('📥 Super SLA exportado (' + conductores.length + ' conductores)');
}

// Genera un ID libre para un conductor nuevo que llega por import sin ID.
function generarIdSuperSLA() {
  let n = 90000 + Math.floor(Math.random() * 9999);
  let id = 'LH' + n;
  while (AppData.panelConductores.some(c => c.id === id)) { n++; id = 'LH' + n; }
  return id;
}

// Importa conductores Super SLA desde Excel (Conductor · ID · Zona · Precio).
// Para cada conductor del archivo: lo marca como Super SLA (lo crea en el panel
// si no existe) y REEMPLAZA sus zonas por las del archivo. Los conductores que
// NO están en el archivo no se tocan (para quitar uno, usá el botón eliminar).
function importarSuperSLA(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }

      let h = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(x => String(x).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('conductor') && cells.some(c => c.includes('zona'))) { h = r; break; }
      }
      if (h < 0) { alert('No se encontraron las columnas "Conductor" y "Zona". Exportá primero para usar el formato correcto.'); return; }
      const header = rows[h].map(x => String(x).toLowerCase().trim());
      const iCond = header.findIndex(x => x.includes('conductor') || x.includes('nombre'));
      const iId = header.findIndex(x => x === 'id' || x === 'legajo');
      const iZona = header.findIndex(x => x.includes('zona'));
      const iPrecio = header.findIndex(x => x.includes('precio') || x.includes('tarifa') || x.includes('monto') || x.includes('valor'));
      if (iCond < 0 || iZona < 0) { alert('Faltan columnas Conductor / Zona.'); return; }

      const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
      const porCond = {}; // normNombre -> { nombre, id, zonas:[{zona,precio}] }
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i];
        const nombre = String(r[iCond] || '').trim().toUpperCase();
        if (!nombre) continue;
        const id = iId >= 0 ? String(r[iId] || '').trim().toUpperCase() : '';
        const zona = String(r[iZona] || '').trim().toUpperCase();
        const precio = iPrecio >= 0 ? parseNum(r[iPrecio]) : 0;
        const k = normNombre(nombre);
        if (!porCond[k]) porCond[k] = { nombre, id, zonas: [] };
        if (!porCond[k].id && id) porCond[k].id = id;
        if (zona) porCond[k].zonas.push({ zona, precio });
      }
      const claves = Object.keys(porCond);
      if (!claves.length) { alert('No se importó ningún conductor válido.'); return; }

      let nuevos = 0, actualizados = 0, zonasTotal = 0;
      claves.forEach(k => {
        const info = porCond[k];
        let cond = AppData.panelConductores.find(c => normNombre(c.nombre) === k);
        if (cond) { cond.categoria = 'super_sla'; actualizados++; }
        else {
          cond = { id: info.id || generarIdSuperSLA(), nombre: info.nombre, condicion: '', categoria: 'super_sla', alias: '' };
          AppData.panelConductores.push(cond);
          nuevos++;
        }
        // Reemplazar las zonas del conductor por las del archivo.
        AppData.superSLA = AppData.superSLA.filter(r => normNombre(r.conductor) !== k);
        info.zonas.forEach(z => { AppData.superSLA.push({ conductor: info.nombre, zona: z.zona, precio: z.precio }); zonasTotal++; });
      });

      invalidarIndicePanel();
      try {
        localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
        localStorage.setItem('liq_supersla', JSON.stringify(AppData.superSLA));
      } catch (e) {}
      dbPush('panel_conductores');
      dbPush('super_sla');
      renderSuperSLA();
      showToast('✅ Super SLA importado: ' + actualizados + ' actualizado(s), ' + nuevos + ' nuevo(s) · ' + zonasTotal + ' zona(s)');
    } catch (err) { console.error(err); alert('Error al importar Super SLA: ' + err.message); }
    finally { event.target.value = ''; }
  };
  reader.readAsArrayBuffer(file);
}

// ===== PANEL DE CONDUCTORES =====

