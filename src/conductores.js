function renderConductorSelect() {
  // Lista de conductores (canónicos) con recorridos. Evitamos calcLiquidaciones()
  // completo (que recorre precios de las ~10k filas) solo para listar nombres.
  const set = new Set();
  AppData.records.forEach(r => { const c = conductorCanonico(r.cadete); if (c) set.add(c); });
  const conductores = Array.from(set).sort();
  const sel = document.getElementById('cond-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccionar conductor...</option>' +
    conductores.map(c => `<option value="${String(c).replace(/"/g, '&quot;')}">${c}</option>`).join('');
}

// ════════════════════════════════════════════════════════════════════════
//  EDITOR DE CONDUCTOR (control por supervisión humana)
//  El operador filtra conductor + rango de fechas y corrige a mano:
//  tracking, zona, precio (pisa el calculado) y estado (contabiliza o no).
//  Los cambios se guardan solos en la nube e impactan en liquidación y PDF.
// ════════════════════════════════════════════════════════════════════════

let condEditPendientes = false;
let condEditTimer = null;

// Precio automático de un registro (dimensión especial asignada > tarifas/Super SLA).
function precioAutoDe(r) {
  const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
  const dim = dimensionAsignada(r);
  if (dim) return { precio: dim.precio, etiqueta: 'Dimensión: ' + dim.nombre + (dim.sinPrecioZona ? ' (sin precio en ' + (zona || 'zona') + ')' : '') };
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

// Filtro "solo corregidos a mano": envíos con zona definida a mano, precio pisado
// o cargados a mano. Sirve para revisar rápido lo que se tocó.
let condSoloCorregidos = false;
function toggleFiltroCorregidos() {
  condSoloCorregidos = !condSoloCorregidos;
  renderConductorDetail();
}

// Índices (en AppData.records) de los registros del conductor dentro del rango.
function indicesConductorFiltrados(cond) {
  const key = normNombre(cond);
  const dISO = document.getElementById('cond-fecha-desde')?.value || '';
  const hISO = document.getElementById('cond-fecha-hasta')?.value || '';
  const desde = dISO ? new Date(dISO + 'T00:00:00') : null;
  const hasta = hISO ? new Date(hISO + 'T23:59:59') : null;
  const out = [];
  AppData.records.forEach((r, i) => {
    // Unifica por identidad canónica: incluye los recorridos con cualquier alias
    // del conductor, no solo los que coinciden exacto por nombre.
    if (normNombre(conductorCanonico(r.cadete)) !== key) return;
    if (desde || hasta) {
      const f = parseFechaReg(r.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    out.push(i);
  });
  // ORDEN POR FECHA DE ENVÍO (no por orden de importación). Si un día se carga
  // tarde, sus envíos igual quedan en su lugar cronológico y no al final.
  // Los que no tienen fecha parseable van al final; empate = orden estable.
  const tsPorIdx = new Map();
  out.forEach(i => {
    const f = parseFechaReg(AppData.records[i].fecha);
    tsPorIdx.set(i, f ? f.getTime() : Infinity);
  });
  out.sort((a, b) => (tsPorIdx.get(a) - tsPorIdx.get(b)) || (a - b));
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
    if (esCorregidoRegistro(r)) corregidos++;
    if (contabiliza) { entregados++; total += manual !== null ? manual : precioAutoDe(r).precio; }
    else noEntregados++;
  });

  // Buscador: filtra SOLO la tabla (no cambia los totales del período de arriba).
  const fCli = (document.getElementById('cond-filtro-cliente')?.value || '').toLowerCase().trim();
  const fTrk = (document.getElementById('cond-filtro-tracking')?.value || '').toLowerCase().trim();
  const fZona = (document.getElementById('cond-filtro-zona')?.value || '').toLowerCase().trim();
  const hayFiltro = !!(fCli || fTrk || fZona || condSoloIncompletos || condSoloCorregidos);

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

  // Contar envíos corregidos a mano del período, para el badge del botón.
  let corregidosCount = 0;
  idxs.forEach(i => { if (esCorregidoRegistro(AppData.records[i])) corregidosCount++; });
  const btnCor = document.getElementById('cond-filtro-corregidos');
  if (btnCor) {
    btnCor.style.borderColor = condSoloCorregidos ? '#6366f1' : '';
    btnCor.style.background = condSoloCorregidos ? '#eef2ff' : '';
    btnCor.style.color = condSoloCorregidos ? '#4338ca' : (corregidosCount ? '#4f46e5' : '');
    btnCor.style.fontWeight = condSoloCorregidos ? '700' : '';
    const badgeC = document.getElementById('cond-corregidos-count');
    if (badgeC) badgeC.textContent = corregidosCount ? (' · ' + corregidosCount) : '';
  }

  const idxsVista = !hayFiltro ? idxs : idxs.filter(i => {
    const r = AppData.records[i];
    if (condSoloIncompletos && !envioIncompleto(r)) return false;
    if (condSoloCorregidos && !esCorregidoRegistro(r)) return false;
    if (fTrk && !String(r.tracking || '').toLowerCase().includes(fTrk)) return false;
    if (fZona && !String(r.zona || r.localidad || '').toLowerCase().includes(fZona)) return false;
    if (fCli && !String(r.destinatario || '').toLowerCase().includes(fCli)) return false;
    return true;
  });
  const cntEl = document.getElementById('cond-filtro-count');
  if (cntEl) cntEl.textContent = hayFiltro ? ('Mostrando ' + idxsVista.length + ' de ' + idxs.length + ' recorridos') : '';

  const zonaCat = zonaCatalogoDe(cond); // catálogo de zonas válidas (una vez por render)
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
        <td>${zonaSelectHTML(zonaCat, i, r.zona, cond)}</td>
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
          <div>${r.manual ? '<span class="tag" title="Envío cargado a mano desde este panel" style="background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;margin-right:4px"><i class="ic ic-plus"></i> Manual</span>' : ''}${r.zona_manual ? '<span class="tag" title="La zona fue definida/corregida a mano" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;margin-right:4px"><i class="ic ic-pin"></i> Zona a mano</span>' : ''}${manual !== null
            ? '<span class="tag" style="background:#fffbeb;color:#92400e;border:1px solid #fde68a"><i class="ic ic-edit"></i> Corregido (auto: ' + fmtPeso(auto.precio) + ')</span>'
            : auto.etiqueta}</div>
          <div style="margin-top:5px">${r.dim_especial
            ? '<span class="tag" style="background:#fef9c3;color:#92400e;border:1px solid #fde68a" title="Dimensión especial asignada — precio por zona de entrega"><i class="ic ic-box"></i> ' + r.dim_especial + '</span> <button class="btn btn-sm" style="padding:2px 6px;font-size:10px" onclick="openDimAsignarModal(' + i + ')" title="Cambiar dimensión"><i class="ic ic-edit"></i></button> <button class="btn btn-sm" style="padding:2px 6px;font-size:10px;border-color:#fca5a5;color:#b91c1c" onclick="quitarDimensionEnvio(' + i + ')" title="Quitar dimensión">✕</button>'
            : '<button class="btn btn-sm" style="padding:2px 8px;font-size:10px" onclick="openDimAsignarModal(' + i + ')" title="Asignar una dimensión especial del catálogo"><i class="ic ic-box"></i> Dimensión</button>'}</div>
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
  condSoloCorregidos = false;
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
  invalidarLiquidaciones();   // cambió un envío: los totales se recalculan
  condEditPendientes = true;
  actualizarEstadoEdicion('Cambios sin guardar…');
  renderConductorDetail();
  // Autoguardado con espera corta: agrupa varias ediciones en un solo guardado.
  clearTimeout(condEditTimer);
  condEditTimer = setTimeout(guardarEdicionConductores, 2500);
}

// ── Confirmación de zona en 2 pasos ─────────────────────────────────────────
// Elegir una zona NO la aplica: queda "pendiente" (con vista previa del precio)
// hasta que el operador toca Confirmar. Así evitamos que un tipeo/selección
// errónea entre a la liquidación sin querer. Keyed por índice global del record.
let _zonaPendiente = {};

function stageZonaConductor(idx, value) {
  const r = AppData.records[idx];
  if (!r) return;
  if (r._historico) { showToast('🗄️ Registro archivado (solo lectura): no se puede editar'); renderConductorDetail(); return; }
  const actual = String(r.zona || '').toUpperCase().trim();
  const nuevo = String(value || '').toUpperCase().trim();
  if (nuevo === actual) delete _zonaPendiente[idx];   // volvió a la original → sin cambio
  else _zonaPendiente[idx] = nuevo;
  renderConductorDetail();
}

function confirmarZonaConductor(idx) {
  const z = _zonaPendiente[idx];
  if (z === undefined) return;
  delete _zonaPendiente[idx];
  const r = AppData.records[idx];
  if (r) r.zona_manual = z !== '';   // marca la zona como definida a mano (o desmarca si se vació)
  editarRegistroConductor(idx, 'zona', z);   // aplica + guarda + re-render
}

function cancelarZonaConductor(idx) {
  delete _zonaPendiente[idx];
  renderConductorDetail();
}

function actualizarEstadoEdicion(txt) {
  const el = document.getElementById('cond-edit-estado');
  if (el) el.textContent = txt || '';
  const btn = document.getElementById('cond-guardar-btn');
  if (btn) btn.style.display = condEditPendientes ? '' : 'none';
}

// ── Asignar una DIMENSIÓN ESPECIAL a un envío (catálogo por cliente + zona) ──
// Flujo: elegir Cliente → aparecen solo las dimensiones de ese cliente → al
// elegir una, el precio del envío pasa a ser el de esa dimensión en su zona.
let dimAsignarIdx = -1;
function _dimJs(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

function openDimAsignarModal(idx) {
  const r = AppData.records[idx];
  if (!r) return;
  if (r._historico) { showToast('🗄️ Registro archivado (solo lectura)'); return; }
  dimAsignarIdx = idx;
  const zona = (r.zona && r.zona.trim()) ? r.zona.trim().toUpperCase() : (r.localidad || '').trim().toUpperCase();
  const info = document.getElementById('mda-envio');
  if (info) info.innerHTML = 'Tracking <strong>' + (r.tracking || '—') + '</strong> · Zona <strong>' + (zona || '—') + '</strong>';
  // Clientes con dimensiones en el catálogo (+ el del envío, si no estuviera).
  const clientes = dimClientes();
  const rc = r.dim_cliente || r.cliente || '';
  if (rc && !clientes.some(c => normNombre(c) === normNombre(rc))) clientes.unshift(rc);
  const sel = document.getElementById('mda-cliente');
  if (sel) {
    const preferido = rc;
    sel.innerHTML = '<option value="">— Elegí un cliente —</option>' + clientes.map(c =>
      '<option value="' + String(c).replace(/"/g, '&quot;') + '"' + (preferido && normNombre(preferido) === normNombre(c) ? ' selected' : '') + '>' + c + '</option>').join('');
  }
  renderDimAsignarOpciones();
  document.getElementById('modal-dim-asignar-backdrop').style.display = 'flex';
}

function renderDimAsignarOpciones() {
  const cont = document.getElementById('mda-opciones');
  const r = AppData.records[dimAsignarIdx];
  if (!cont || !r) return;
  const cliente = document.getElementById('mda-cliente')?.value || '';
  const zona = (r.zona && r.zona.trim()) ? r.zona.trim().toUpperCase() : (r.localidad || '').trim().toUpperCase();
  if (!cliente) { cont.innerHTML = '<div class="muted" style="padding:12px">Elegí primero un cliente para ver sus dimensiones.</div>'; return; }
  const nombres = dimNombresDe(cliente);
  if (!nombres.length) { cont.innerHTML = '<div class="muted" style="padding:12px">Ese cliente no tiene dimensiones en el catálogo. Cargalas en el panel <strong>Dimensiones Especiales</strong>.</div>'; return; }
  cont.innerHTML = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Dimensiones de <strong>' + cliente + '</strong> para la zona <strong>' + (zona || '—') + '</strong>:</div>' +
    nombres.map(n => {
      const precio = dimPrecioEnZona(cliente, n, zona);
      const asignada = normNombre(r.dim_especial) === normNombre(n) && normNombre(r.dim_cliente || r.cliente) === normNombre(cliente);
      if (precio == null) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;opacity:.55"><span><i class="ic ic-box"></i> <strong>' + n + '</strong></span><span class="muted" style="font-size:11px">sin precio en ' + (zona || 'esta zona') + '</span></div>';
      }
      return '<button class="btn" style="display:flex;justify-content:space-between;align-items:center;width:100%;padding:10px 12px;margin-bottom:6px;' + (asignada ? 'border-color:#16a34a;background:#f0fdf4' : '') + '" onclick="aplicarDimensionEnvio(' + _dimJs(cliente) + ',' + _dimJs(n) + ')"><span><i class="ic ic-box"></i> <strong>' + n + '</strong></span><span class="mono" style="font-weight:700">' + fmtPeso(precio) + (asignada ? ' ✓' : '') + '</span></button>';
    }).join('');
}

function closeDimAsignarModal(e) {
  if (!e || e.target.id === 'modal-dim-asignar-backdrop') document.getElementById('modal-dim-asignar-backdrop').style.display = 'none';
}

function aplicarDimensionEnvio(cliente, nombre) {
  const r = AppData.records[dimAsignarIdx];
  if (!r) return;
  r.dim_cliente = String(cliente).toUpperCase();
  r.dim_especial = String(nombre).toUpperCase();
  document.getElementById('modal-dim-asignar-backdrop').style.display = 'none';
  _marcarDimDirty(r);
  showToast('✅ Dimensión "' + nombre + '" asignada al envío');
}

function quitarDimensionEnvio(idx) {
  const r = AppData.records[idx];
  if (!r) return;
  if (r._historico) { showToast('🗄️ Registro archivado (solo lectura)'); return; }
  r.dim_especial = ''; r.dim_cliente = '';
  _marcarDimDirty(r);
  showToast('Dimensión quitada del envío');
}

// Marca el registro como sucio y agenda el autoguardado (igual que las ediciones).
function _marcarDimDirty(r) {
  if (r.id) condEditIdsSucios.add(r.id);
  else console.warn('Registro sin id de nube (no se podrá sincronizar la dimensión):', r.tracking);
  invalidarLiquidaciones();   // cambió el precio del envío por la dimensión
  condEditPendientes = true;
  actualizarEstadoEdicion('Cambios sin guardar…');
  renderConductorDetail();
  clearTimeout(condEditTimer);
  condEditTimer = setTimeout(guardarEdicionConductores, 1500);
}

// Sincroniza SOLO las filas editadas (update por id) — no reescribe la base.
async function guardarEdicionConductores() {
  if (!condEditPendientes || !condEditIdsSucios.size) return;
  clearTimeout(condEditTimer);
  if (!window.DB || !DB.ready) { actualizarEstadoEdicion('⚠️ Sin conexión — reintentá con el botón'); return; }
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
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
        zona_manual: !!r.zona_manual,
        dim_especial: r.dim_especial || '', dim_cliente: r.dim_cliente || '',
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

// ════════════════════════════════════════════════════════════════════════
//  AGREGAR ENVÍOS A MANO (masivo) — para sumar recorridos que no figuran
//  en la importación pero el conductor hizo. Se guardan como registros
//  'Entregado' (contabilizan) y la fecha los imputa a la liquidación de esa
//  semana. Inserta en la nube (append, sin borrar por clave: son agregados).
// ════════════════════════════════════════════════════════════════════════
// Catálogo de zonas válidas para un conductor = zonas del panel Tarifas + las de
// su Super SLA. Devuelve [{ val, label }] (label con el precio que le corresponde).
// Se computa UNA vez por render y se reutiliza (getPrecio solo se llama por zona).
function zonaCatalogoDe(conductor) {
  const key = conductorKey(conductor);
  const zonas = new Set();
  AppData.tarifas.forEach(t => { const z = String(t.zona || '').toUpperCase().trim(); if (z) zonas.add(z); });
  AppData.superSLA.forEach(s => {
    if (conductorKey(s.conductor) === key) { const z = String(s.zona || '').toUpperCase().trim(); if (z) zonas.add(z); }
  });
  return Array.from(zonas).sort().map(z => {
    const p = getPrecio(conductor, z);
    return { val: z, label: z + ' · ' + (p.precio > 0 ? fmtPeso(p.precio) : 's/tarifa') + (p.es_super ? ' · Super SLA' : '') };
  });
}

// Opciones (<option>) para el modal "Agregar envío". Sincronizadas con el tarifario.
let _aeZonaOpts = '';
function zonaOptionsHTML(conductor) {
  let html = '<option value="">— Elegir zona —</option>';
  zonaCatalogoDe(conductor).forEach(o => { html += '<option value="' + o.val.replace(/"/g, '&quot;') + '">' + o.label + '</option>'; });
  return html;
}

// <select> de zona para una fila de la tabla de edición del conductor. Solo deja
// elegir zonas del tarifario (validación de datos). Si la zona actual está fuera
// del tarifario (o vacía), la marca en ámbar y la muestra como "sin tarifa" para
// que el operador la reemplace por una válida.
function zonaSelectHTML(catalogo, idx, current, cond) {
  const pend = _zonaPendiente[idx];               // zona elegida pero aún NO confirmada
  const tienePend = pend !== undefined;
  const cur = String(current || '').toUpperCase().trim();
  const shown = tienePend ? pend : cur;           // el select refleja lo pendiente
  const enLista = catalogo.some(o => o.val === shown);
  const alerta = !shown || !enLista;
  let opts = '<option value=""' + (shown === '' ? ' selected' : '') + '>— Elegir zona —</option>';
  if (shown && !enLista) opts += '<option value="' + shown.replace(/"/g, '&quot;') + '" selected>' + shown + ' · sin tarifa</option>';
  catalogo.forEach(o => { opts += '<option value="' + o.val.replace(/"/g, '&quot;') + '"' + (o.val === shown ? ' selected' : '') + '>' + o.label + '</option>'; });
  const borde = tienePend ? '#6366f1' : (alerta ? '#f59e0b' : 'var(--border)');
  const fondo = tienePend ? '#eef2ff' : (alerta ? '#fffbeb' : 'var(--surface-1)');
  let html = '<select onchange="stageZonaConductor(' + idx + ',this.value)" ' +
    'style="width:100%;max-width:210px;padding:5px 8px;border:1px solid ' + borde + ';border-radius:6px;font-size:12px;background:' + fondo + ';">' + opts + '</select>';
  // Paso 2: mientras hay una zona pendiente, mostramos el precio que tomaría y
  // pedimos confirmación explícita. Recién al confirmar entra a la liquidación.
  if (tienePend) {
    let preview;
    if (!pend) {
      preview = '<span style="color:#b91c1c;font-weight:600">Zona vacía (no suma)</span>';
    } else {
      const p = getPrecio(cond, pend);
      preview = p.sin_tarifa
        ? '<span style="color:#b91c1c;font-weight:600">' + pend + ' · sin tarifa · ' + fmtPeso(p.precio) + '</span>'
        : '<span style="color:#15803d;font-weight:600">' + pend + ' · ' + fmtPeso(p.precio) + '</span>';
    }
    html += '<div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px">' +
      '<span style="color:var(--text-muted)">→</span>' + preview +
      '<button class="btn btn-sm" title="Confirmar esta zona" onclick="confirmarZonaConductor(' + idx + ')" ' +
        'style="padding:2px 8px;font-size:11px;background:#16a34a;color:#fff;border-color:#16a34a"><i class="ic ic-check"></i> Confirmar</button>' +
      '<button class="btn btn-sm" title="Cancelar" onclick="cancelarZonaConductor(' + idx + ')" ' +
        'style="padding:2px 6px;font-size:11px"><i class="ic ic-x"></i></button>' +
    '</div>';
  }
  return html;
}

function envioRowHTML(fechaISO) {
  return '<div class="addenvio-row" style="display:grid;grid-template-columns:130px 1fr 1fr 110px 34px;gap:8px;align-items:center">' +
    '<input type="date" class="ae-fecha" value="' + (fechaISO || '') + '" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px">' +
    '<input type="text" class="ae-tracking" placeholder="Nº tracking" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:monospace">' +
    '<select class="ae-zona" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:var(--surface-1);max-width:100%">' + _aeZonaOpts + '</select>' +
    '<input type="number" class="ae-precio" placeholder="auto" min="0" step="1" title="Vacío = precio automático de la zona elegida" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;text-align:right;font-family:monospace">' +
    '<button class="btn btn-sm" onclick="removeEnvioRow(this)" title="Quitar fila" style="padding:5px 8px"><i class="ic ic-x"></i></button>' +
  '</div>';
}

function openAddEnvioModal() {
  const conductor = document.getElementById('cond-select').value;
  if (!conductor) { alert('Primero seleccioná un conductor arriba.'); return; }
  document.getElementById('addenvio-conductor').textContent = conductor;
  // Opciones de zona sincronizadas con Tarifas + Super SLA de ESTE conductor.
  _aeZonaOpts = zonaOptionsHTML(conductor);
  // Fecha por defecto: el "Desde" del período que se está liquidando (o hoy).
  const desde = document.getElementById('cond-fecha-desde')?.value || hoyISO();
  const cont = document.getElementById('addenvio-rows');
  cont.innerHTML = envioRowHTML(desde) + envioRowHTML(desde) + envioRowHTML(desde);
  const est = document.getElementById('addenvio-estado'); if (est) est.textContent = '';
  document.getElementById('modal-addenvio-backdrop').style.display = 'flex';
}

function addEnvioRow() {
  const desde = document.getElementById('cond-fecha-desde')?.value || hoyISO();
  document.getElementById('addenvio-rows').insertAdjacentHTML('beforeend', envioRowHTML(desde));
}

function removeEnvioRow(btn) {
  const row = btn.closest('.addenvio-row');
  const cont = document.getElementById('addenvio-rows');
  if (cont && cont.querySelectorAll('.addenvio-row').length > 1) row.remove();
  else { // no dejar 0 filas: limpiar la última
    row.querySelectorAll('input').forEach(i => { if (i.type !== 'date') i.value = ''; });
  }
}

function closeAddEnvioModal(e) {
  if (!e || e.target.id === 'modal-addenvio-backdrop') {
    document.getElementById('modal-addenvio-backdrop').style.display = 'none';
  }
}

async function guardarEnviosModal() {
  const conductor = document.getElementById('cond-select').value;
  if (!conductor) { alert('Seleccioná un conductor.'); return; }
  if (!window.DB || !DB.ready) { alert('Sin conexión con la nube: no se pueden agregar envíos ahora (se perderían al recargar). Reintentá con conexión.'); return; }

  const filas = Array.from(document.querySelectorAll('#addenvio-rows .addenvio-row'));
  const recs = [];
  let faltaFecha = 0;
  filas.forEach(row => {
    const iso = row.querySelector('.ae-fecha').value;
    const tracking = row.querySelector('.ae-tracking').value.trim();
    const zona = row.querySelector('.ae-zona').value.trim().toUpperCase();
    const precioV = row.querySelector('.ae-precio').value.trim();
    row.querySelector('.ae-fecha').style.borderColor = 'var(--border)';
    // Fila sin datos reales (solo la fecha por defecto) → se ignora.
    const tieneContenido = tracking || zona || precioV !== '';
    if (!tieneContenido) return;
    if (!iso) { faltaFecha++; row.querySelector('.ae-fecha').style.borderColor = '#e11d48'; return; }
    recs.push({
      cadete: conductor, tracking, fecha: isoToDMY(iso),
      localidad: zona, zona: zona, zona_precio: '',
      direccion: '', destinatario: '',
      estado: 'Entregado', precio_bd: 0,
      carga_fecha: isoToDMY(hoyISO()),
      manual: true, // cargado a mano → chip "Manual" en la tabla
      precio_manual: precioV === '' ? null : (parseFloat(precioV) || 0)
    });
  });

  if (faltaFecha) { showToast('Completá la fecha en las filas marcadas en rojo'); return; }
  if (!recs.length) { showToast('No cargaste ningún envío'); return; }

  const btn = document.getElementById('addenvio-guardar');
  const est = document.getElementById('addenvio-estado');
  btn.disabled = true;
  if (est) est.textContent = 'Guardando ' + recs.length + ' envío(s)…';
  try {
    const ids = await DB.insertRows('registros', recs.map(filaRegistroNube));
    recs.forEach((r, i) => { r.id = ids[i]; });
    AppData.records.push(...recs);
    document.getElementById('modal-addenvio-backdrop').style.display = 'none';
    renderConductorDetail();
    showToast('✅ ' + recs.length + ' envío(s) agregados a la liquidación de ' + conductor);
  } catch (e) {
    console.warn('guardarEnviosModal:', e);
    if (est) est.textContent = '';
    alert('No se pudieron guardar los envíos: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

function buildConductorDetail(cond) {
  const liq = calcLiquidaciones();
  const d = liq[cond];
  if (!d) return '<div class="empty-state"><div class="empty-sub">Sin datos</div></div>';

  const cat = panelConductorDe(cond);
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
          <button class="btn" style="color:white;border-color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.1)" onclick="exportPDFConductor('${cond}')"><i class="ic ic-download"></i> Exportar PDF</button>
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
