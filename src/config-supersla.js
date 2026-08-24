// Solo supervisor/analista pueden editar el precio de Super SLA directamente.
function puedeEditarSuperSLA() { return puedeAutorizar(); }

function renderSuperSLA() {
  if (typeof invalidarIndiceTarifas === 'function') invalidarIndiceTarifas(); // pudo cambiar el precio/zonas
  const todos = AppData.panelConductores.filter(c => c.categoria === 'super_sla');
  const wrap = document.getElementById('supersla-conductor-bloques');
  const countEl = document.getElementById('supersla-count');

  const editable = puedeEditarSuperSLA();
  aplicarLockSuperSLA(editable);            // candado: gate de la barra + aviso
  renderSuperSLASolicitudes(editable);      // pendientes de autorización

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

  const cols = 'grid-template-columns:1fr 160px 84px';
  wrap.innerHTML = conductoresSuperSLA.map(cond => {
    const nombre = cond.nombre;
    const color  = avatarColor(nombre);
    const reglas = AppData.superSLA.filter(
      r => r.conductor.toUpperCase().trim() === nombre.toUpperCase().trim()
    );

    const filasZonas = reglas.length
      ? reglas.map(r => {
          const realIdx = AppData.superSLA.indexOf(r);
          const precio = _num(r.precio || r.sla || 0);
          // ZONA: editable solo para autorizados.
          const zonaCell = editable
            ? zonaSelectSuperSLA(realIdx, r.zona, nombre)
            : `<span style="font-size:13px;font-weight:500">${r.zona || '<span style="color:var(--text-muted)">(sin zona)</span>'}</span>`;
          // PRECIO: input editable, o valor con candado.
          let precioCell, accionCell;
          if (editable) {
            precioCell = `<span style="font-size:12px;color:var(--text-muted);flex-shrink:0">$</span>
              <input type="number" value="${precio}" data-idx="${realIdx}" data-field="precio" style="border:none;background:none;font-size:14px;font-weight:600;width:100%;outline:none;text-align:right;color:var(--text-primary)" onchange="updateSuperSLA(this)" />`;
            accionCell = `<button style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;padding:8px;width:100%;height:100%" onclick="deleteSuperSLA(${realIdx})" title="Eliminar zona"><i class="ic ic-x"></i></button>`;
          } else {
            const pend = solicitudPendienteDe(nombre, r.zona);
            precioCell = `<span style="font-size:12px;color:var(--text-muted);flex-shrink:0">$</span>
              <span style="font-size:14px;font-weight:600;flex:1;text-align:right;color:var(--text-primary)">${precio.toLocaleString('es-AR')}</span>
              <i class="ic ic-lock" title="Solo supervisor/analista puede editar el precio" style="opacity:.45;margin-left:6px;width:14px;height:14px"></i>`;
            accionCell = pend
              ? `<span title="Cambio a $${_num(pend.precio_propuesto).toLocaleString('es-AR')} pendiente de autorización" style="font-size:10px;color:#854d0e;text-align:center;line-height:1.15">⏳ pendiente</span>`
              : `<button class="btn btn-sm" style="padding:3px 6px;font-size:10px;white-space:nowrap" onclick="solicitarCambioSuperSLA('${nombre.replace(/'/g, "\\'")}','${String(r.zona).replace(/'/g, "\\'")}',${precio})" title="Pedir autorización para cambiar el precio">Solicitar</button>`;
          }
          return `
          <div style="display:grid;${cols};gap:0;padding:0;border-bottom:1px solid var(--border);align-items:stretch">
            <div style="padding:10px 16px;display:flex;align-items:center">${zonaCell}</div>
            <div style="padding:10px 16px;border-left:1px solid var(--border);display:flex;align-items:center;gap:4px">${precioCell}</div>
            <div style="border-left:1px solid var(--border);display:flex;align-items:center;justify-content:center">${accionCell}</div>
          </div>`;
        }).join('')
      : `<div style="padding:24px 16px;text-align:center;font-size:13px;color:var(--text-muted)">Sin zonas especiales${editable ? ' — usá "+ Agregar zona" para cargar la primera.' : '.'}</div>`;

    const totalZonas = reglas.length;
    const accionesHeader = editable
      ? `<button class="btn btn-sm" onclick="addZonaSuperSLA('${nombre.replace(/'/g, "\\'")}')">+ Agregar zona</button>
         <button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarConductorSuperSLA('${nombre.replace(/'/g, "\\'")}')" title="Quitar de Super SLA"><i class="ic ic-trash"></i></button>`
      : '';

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
        ${accionesHeader}
      </div>

      <!-- Header columnas -->
      <div style="display:grid;${cols};gap:0;background:var(--surface-0);border-bottom:1px solid var(--border)">
        <div style="padding:8px 16px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Zona afectada</div>
        <div style="padding:8px 16px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;border-left:1px solid var(--border)">Tarifa Super SLA</div>
        <div style="border-left:1px solid var(--border)"></div>
      </div>

      <!-- Filas -->
      <div>${filasZonas}</div>

    </div>`;
  }).join('');
}

// Zonas válidas = las del tarifario. Se elige de una lista en vez de escribirla:
// una zona tipeada a mano que no exista en el tarifario no matchea ningún envío,
// y el conductor terminaría cobrando la tarifa estándar sin que nadie lo note.
function zonasDelTarifario() {
  return Array.from(new Set(
    (AppData.tarifas || []).map(t => String(t.zona || '').trim().toUpperCase()).filter(esZonaValida)
  )).sort();
}

function zonaSelectSuperSLA(realIdx, zonaActual, conductor) {
  const actual = String(zonaActual || '').trim().toUpperCase();
  // No ofrecemos las zonas que ese conductor ya tiene cargadas (evita duplicados),
  // pero sí la de esta misma fila.
  const yaUsadas = new Set(
    (AppData.superSLA || [])
      .filter(r => normNombre(r.conductor) === normNombre(conductor) && normNombre(r.zona) !== normNombre(actual))
      .map(r => normNombre(r.zona))
  );
  const disponibles = zonasDelTarifario().filter(z => !yaUsadas.has(normNombre(z)));
  // Una zona vieja que no esté en el tarifario (import antiguo) no se pierde:
  // se agrega como opción para que se vea y se pueda corregir.
  const fueraDeCatalogo = actual && !disponibles.some(z => normNombre(z) === normNombre(actual));

  const opciones =
    '<option value="" ' + (actual ? '' : 'selected') + '>— Elegí una zona —</option>' +
    (fueraDeCatalogo ? '<option value="' + actual.replace(/"/g, '&quot;') + '" selected>' + actual + ' (fuera del tarifario)</option>' : '') +
    disponibles.map(z =>
      '<option value="' + z.replace(/"/g, '&quot;') + '"' + (normNombre(z) === normNombre(actual) ? ' selected' : '') + '>' + z + '</option>'
    ).join('');

  const sinOpciones = !disponibles.length && !fueraDeCatalogo;
  return '<select data-idx="' + realIdx + '" data-field="zona" onchange="updateSuperSLA(this)"' +
    (sinOpciones ? ' disabled' : '') +
    ' title="' + (sinOpciones ? 'Este conductor ya tiene todas las zonas del tarifario' : 'Zonas del tarifario') + '"' +
    ' style="border:none;background:none;font-size:13px;font-weight:500;width:100%;outline:none;color:' + (actual ? 'var(--text-primary)' : 'var(--text-muted)') + ';cursor:pointer">' +
    (sinOpciones ? '<option value="">Sin zonas disponibles</option>' : opciones) +
    '</select>';
}

function addZonaSuperSLA(conductor) {
  if (!puedeEditarSuperSLA()) { showToast('🔒 Solo supervisor/analista puede editar Super SLA'); return; }
  AppData.superSLA.push({ conductor: conductor.toUpperCase(), zona: '', precio: 3500 });
  renderSuperSLA();
  setTimeout(() => {
    const inputs = document.querySelectorAll('[data-field="zona"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }, 50);
}

function updateSuperSLA(el) {
  if (!puedeEditarSuperSLA()) return;
  const i = parseInt(el.dataset.idx), f = el.dataset.field;
  AppData.superSLA[i][f] = f === 'zona' || f === 'conductor'
    ? el.value.toUpperCase()
    : parseFloat(el.value) || 0;
}

function deleteSuperSLA(i) {
  if (!puedeEditarSuperSLA()) { showToast('🔒 Solo supervisor/analista puede editar Super SLA'); return; }
  if (!confirm('¿Eliminar esta zona especial?')) return;
  AppData.superSLA.splice(i, 1);
  renderSuperSLA();
}

function saveSuperSLA() {
  if (!puedeEditarSuperSLA()) { showToast('🔒 Solo supervisor/analista puede editar Super SLA'); return; }

  // Una fila sin zona no se aplica a ningún envío: el conductor cobraría la
  // tarifa estándar y el error pasaría desapercibido hasta la liquidación.
  const sinZona = (AppData.superSLA || []).filter(r => !String(r.zona || '').trim());
  if (sinZona.length) {
    const quienes = Array.from(new Set(sinZona.map(r => r.conductor))).join(', ');
    const salto = String.fromCharCode(10);
    if (!confirm('Hay ' + sinZona.length + ' fila(s) sin zona elegida (' + quienes + ').' + salto + salto +
                 'Esas filas no le aplican precio especial a ningún envío. ¿Guardar igual?')) return;
  }

  localStorage.setItem('liq_supersla', JSON.stringify(AppData.superSLA));
  dbPush('super_sla');
  showToast('Tarifas Super SLA guardadas');
}

// Abre el modal para sumar a Super SLA un conductor ya existente del panel.
function openAgregarConductorSuperSLA() {
  if (!puedeEditarSuperSLA()) { showToast('🔒 Solo supervisor/analista puede editar Super SLA'); return; }
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
  if (!puedeEditarSuperSLA()) { showToast('🔒 Solo supervisor/analista puede editar Super SLA'); return; }
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
  if (!puedeEditarSuperSLA()) { showToast('🔒 Solo supervisor/analista puede editar Super SLA'); return; }
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
  if (!puedeEditarSuperSLA()) { showToast('🔒 Solo supervisor/analista puede editar Super SLA'); event.target.value = ''; return; }
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

// ════════════════════════════════════════════════════════════════════════
//  CANDADO + SOLICITUDES DE CAMBIO DE PRECIO (maker-checker)
//  Solo supervisor/analista editan el precio. Los demás lo ven con candado y
//  usan "Solicitar cambio"; el cambio queda pendiente hasta que un autorizado
//  lo apruebe (recién ahí se aplica al precio real).
// ════════════════════════════════════════════════════════════════════════

// Muestra/oculta los controles de edición de la barra según el rol + aviso.
function aplicarLockSuperSLA(editable) {
  ['sla-btn-agregar', 'sla-import-label', 'sla-btn-guardar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = editable ? '' : 'none';
  });
  const notice = document.getElementById('sla-lock-notice');
  if (notice) notice.style.display = editable ? 'none' : '';
}

function persistirSuperSLASolicitudesLocal() {
  try { localStorage.setItem('liq_supersla_solic', JSON.stringify(AppData.superSLASolicitudes)); } catch (e) {}
}

// Solicitud pendiente para un conductor+zona (o null).
function solicitudPendienteDe(conductor, zona) {
  return (AppData.superSLASolicitudes || []).find(s =>
    s.estado === 'pendiente' &&
    normNombre(s.conductor) === normNombre(conductor) &&
    normNombre(s.zona) === normNombre(zona));
}

// Render de las solicitudes pendientes (arriba del listado).
function renderSuperSLASolicitudes(editable) {
  const cont = document.getElementById('supersla-solicitudes');
  if (!cont) return;
  const pendientes = (AppData.superSLASolicitudes || []).filter(s => s.estado === 'pendiente');
  const yo = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  // A los NO autorizados solo les mostramos sus propias solicitudes.
  const visibles = editable ? pendientes : pendientes.filter(s => normNombre(s.solicitante) === normNombre(yo));
  if (!visibles.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
  cont.style.display = '';
  const filas = visibles.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(s => {
    const delta = _num(s.precio_propuesto) - _num(s.precio_anterior);
    const signo = delta > 0 ? '+' : '';
    const acciones = editable
      ? `<button class="btn btn-sm btn-primary" style="padding:4px 10px" onclick="autorizarSolicitudSuperSLA(${s.id})"><i class="ic ic-check"></i> Autorizar</button>
         <button class="btn btn-sm" style="padding:4px 10px;border-color:#fca5a5;color:#b91c1c" onclick="rechazarSolicitudSuperSLA(${s.id})">Rechazar</button>`
      : `<button class="btn btn-sm" style="padding:4px 10px" onclick="cancelarSolicitudSuperSLA(${s.id})">Cancelar</button>`;
    return `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border:1px solid #f5d97a;background:#fffbeb;border-radius:8px;margin-bottom:8px">
      <div style="flex:1;min-width:200px">
        <div style="font-size:13px;font-weight:600">${s.conductor} · ${s.zona}</div>
        <div style="font-size:12px;color:var(--text-secondary)">$${_num(s.precio_anterior).toLocaleString('es-AR')} → <strong>$${_num(s.precio_propuesto).toLocaleString('es-AR')}</strong> <span style="color:${delta > 0 ? '#166534' : '#b91c1c'}">(${signo}${delta.toLocaleString('es-AR')})</span></div>
        <div style="font-size:11px;color:var(--text-muted)">Pide: ${s.solicitante || '—'}${s.motivo ? ' · ' + s.motivo : ''}</div>
      </div>
      <div style="display:flex;gap:6px">${acciones}</div>
    </div>`;
  }).join('');
  const titulo = editable
    ? `<i class="ic ic-alert"></i> Solicitudes de cambio de precio pendientes (${visibles.length})`
    : `<i class="ic ic-alert"></i> Tus solicitudes pendientes (${visibles.length})`;
  cont.innerHTML = `<div style="font-size:13px;font-weight:700;margin-bottom:8px">${titulo}</div>${filas}`;
}

// Abre el modal para solicitar un cambio de precio (roles no autorizados).
let slaSolicitudCtx = null;
function solicitarCambioSuperSLA(conductor, zona, precioActual) {
  if (puedeEditarSuperSLA()) return; // los autorizados editan directo
  if (solicitudPendienteDe(conductor, zona)) { showToast('Ya hay una solicitud pendiente para esa zona'); return; }
  slaSolicitudCtx = { conductor, zona, precioActual: _num(precioActual) };
  document.getElementById('msla-conductor').textContent = conductor;
  document.getElementById('msla-zona').textContent = zona;
  document.getElementById('msla-precio-actual').textContent = '$' + _num(precioActual).toLocaleString('es-AR');
  document.getElementById('msla-precio-nuevo').value = '';
  document.getElementById('msla-motivo').value = '';
  document.getElementById('modal-sla-solicitud-backdrop').style.display = 'flex';
}
function closeSlaSolicitudModal(e) {
  if (!e || e.target.id === 'modal-sla-solicitud-backdrop') document.getElementById('modal-sla-solicitud-backdrop').style.display = 'none';
}
async function guardarSolicitudSuperSLA() {
  if (!slaSolicitudCtx) return;
  const nuevo = parseFloat(document.getElementById('msla-precio-nuevo').value);
  if (isNaN(nuevo) || nuevo < 0) { alert('Ingresá un precio válido.'); return; }
  const motivo = (document.getElementById('msla-motivo').value || '').trim();
  const rec = {
    conductor: slaSolicitudCtx.conductor, zona: slaSolicitudCtx.zona,
    precio_anterior: slaSolicitudCtx.precioActual, precio_propuesto: nuevo,
    motivo, solicitante: (currentUser && (currentUser.nombre || currentUser.usuario)) || '', estado: 'pendiente'
  };
  const local = Object.assign({ id: 'tmp-' + Date.now(), created_at: new Date().toISOString() }, rec);
  AppData.superSLASolicitudes = (AppData.superSLASolicitudes || []).concat(local);
  persistirSuperSLASolicitudesLocal();
  document.getElementById('modal-sla-solicitud-backdrop').style.display = 'none';
  renderSuperSLA();
  showToast('✅ Solicitud enviada — un supervisor/analista la va a autorizar');
  try {
    const row = await DB.insertRow('supersla_solicitudes', rec);
    if (row && row.id) { local.id = row.id; local.created_at = row.created_at || local.created_at; persistirSuperSLASolicitudesLocal(); }
  } catch (e) { console.warn('guardarSolicitudSuperSLA nube:', e); }
}

// Autoriza una solicitud: aplica el precio propuesto a la zona y la marca autorizada.
async function autorizarSolicitudSuperSLA(id) {
  if (!puedeEditarSuperSLA()) { showToast('⛔ Solo supervisor/analista puede autorizar'); return; }
  const s = (AppData.superSLASolicitudes || []).find(x => x.id === id);
  if (!s || s.estado !== 'pendiente') return;
  // Aplicar el precio a la regla existente (o crearla si la zona ya no está).
  let regla = AppData.superSLA.find(r => normNombre(r.conductor) === normNombre(s.conductor) && normNombre(r.zona) === normNombre(s.zona));
  if (regla) regla.precio = _num(s.precio_propuesto);
  else AppData.superSLA.push({ conductor: s.conductor, zona: s.zona, precio: _num(s.precio_propuesto) });
  const quien = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  s.estado = 'autorizado'; s.resuelto_por = quien;
  try {
    localStorage.setItem('liq_supersla', JSON.stringify(AppData.superSLA));
    persistirSuperSLASolicitudesLocal();
    dbPush('super_sla');
    if (typeof s.id === 'number') await DB.updateWhere('supersla_solicitudes', 'id', s.id, { estado: 'autorizado', resuelto_por: quien, resolved_at: new Date().toISOString() });
    renderSuperSLA();
    showToast('✅ Precio autorizado y aplicado: ' + s.conductor + ' · ' + s.zona + ' → $' + _num(s.precio_propuesto).toLocaleString('es-AR'));
  } catch (e) { console.warn('autorizarSolicitudSuperSLA:', e); showToast('⛔ No se pudo autorizar'); }
}

async function rechazarSolicitudSuperSLA(id) {
  if (!puedeEditarSuperSLA()) { showToast('⛔ Solo supervisor/analista puede rechazar'); return; }
  const s = (AppData.superSLASolicitudes || []).find(x => x.id === id);
  if (!s || s.estado !== 'pendiente') return;
  if (!confirm('¿Rechazar la solicitud de ' + s.conductor + ' · ' + s.zona + '? El precio no cambia.')) return;
  const quien = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  s.estado = 'rechazado'; s.resuelto_por = quien;
  persistirSuperSLASolicitudesLocal();
  try {
    if (typeof s.id === 'number') await DB.updateWhere('supersla_solicitudes', 'id', s.id, { estado: 'rechazado', resuelto_por: quien, resolved_at: new Date().toISOString() });
  } catch (e) { console.warn('rechazarSolicitudSuperSLA:', e); }
  renderSuperSLA();
  showToast('🚫 Solicitud rechazada');
}

// El solicitante cancela su propia solicitud pendiente.
async function cancelarSolicitudSuperSLA(id) {
  const s = (AppData.superSLASolicitudes || []).find(x => x.id === id);
  if (!s || s.estado !== 'pendiente') return;
  if (!confirm('¿Cancelar tu solicitud de cambio de precio para ' + s.conductor + ' · ' + s.zona + '?')) return;
  AppData.superSLASolicitudes = AppData.superSLASolicitudes.filter(x => x.id !== id);
  persistirSuperSLASolicitudesLocal();
  try {
    if (typeof s.id === 'number') await DB.deleteWhere('supersla_solicitudes', 'id', s.id);
  } catch (e) { console.warn('cancelarSolicitudSuperSLA:', e); }
  renderSuperSLA();
  showToast('Solicitud cancelada');
}

// ===== PANEL DE CONDUCTORES =====

