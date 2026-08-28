// Condiciones tildadas para acotar el listado de conductores (vacío = todas).
let condFiltroCondiciones = new Set();
const CONDICIONES = [
  { valor: 'Titular',      id: 'Titular' },
  { valor: 'Semi Titular', id: 'SemiTitular' },
  { valor: 'Suplente',     id: 'Suplente' },
  { valor: '',             id: 'Sin' }   // los que todavía no tienen condición cargada
];

function condicionDe(conductor) {
  const p = panelConductorDe(conductor);
  return String((p && p.condicion) || '').trim();
}

function toggleFiltroCondicion(cond) {
  if (condFiltroCondiciones.has(cond)) condFiltroCondiciones.delete(cond);
  else condFiltroCondiciones.add(cond);
  renderConductorSelect();
}

function renderConductorSelect() {
  // Lista de conductores (canónicos) con recorridos. Evitamos calcLiquidaciones()
  // completo (que recorre precios de las ~10k filas) solo para listar nombres.
  const set = new Set();
  AppData.records.forEach(r => { const c = conductorCanonico(r.cadete); if (c) set.add(c); });
  const todos = Array.from(set).sort();
  // Filtro por condición (día de pago): titular / semi titular / suplente.
  const conductores = condFiltroCondiciones.size
    ? todos.filter(c => condFiltroCondiciones.has(condicionDe(c)))
    : todos;

  const sel = document.getElementById('cond-select');
  if (!sel) return;

  // OJO: esta función se vuelve a llamar cada vez que entra un cambio por
  // realtime (propio o de otro usuario). Si no guardáramos el elegido, el
  // operador perdería el conductor que está corrigiendo a mitad de trabajo.
  const elegido = sel.value;

  sel.innerHTML = '<option value="">Seleccionar conductor...</option>' +
    conductores.map(c => `<option value="${String(c).replace(/"/g, '&quot;')}">${c}</option>`).join('');

  if (elegido) {
    const estaEnLista = conductores.some(c => c === elegido);
    if (!estaEnLista) {
      // Quedó fuera por el filtro de condición (o se fue del período): lo
      // agregamos igual para no sacarlo de la pantalla mientras trabaja.
      const motivo = todos.some(c => c === elegido) ? ' (fuera del filtro)' : ' (sin recorridos)';
      sel.insertAdjacentHTML('beforeend',
        `<option value="${String(elegido).replace(/"/g, '&quot;')}">${elegido}${motivo}</option>`);
    }
    sel.value = elegido;
  }

  // Chips de condición: marcados y con el total de cada una.
  CONDICIONES.forEach(({ valor, id }) => {
    const btn = document.getElementById('cond-cond-' + id);
    if (!btn) return;
    const activo = condFiltroCondiciones.has(valor);
    const cuantos = todos.filter(c => condicionDe(c) === valor).length;
    btn.style.borderColor = activo ? '#0ea5e9' : '';
    btn.style.background = activo ? '#e0f2fe' : '';
    btn.style.color = activo ? '#075985' : '';
    btn.style.fontWeight = activo ? '700' : '';
    const badge = btn.querySelector('.cond-cond-count');
    if (badge) badge.textContent = cuantos ? (' · ' + cuantos) : '';
  });
  const info = document.getElementById('cond-select-count');
  if (info) info.textContent = condFiltroCondiciones.size
    ? (conductores.length + ' de ' + todos.length + ' conductores')
    : '';
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

// Días plegados en el detalle del conductor. El operador trabaja un día por vez,
// así que arrancan TODOS CERRADOS: se ve la lista de días con su subtotal y se
// abre solo el que se va a tocar (antes había que scrollear cientos de filas).
// Se guarda a qué conductor pertenece para no arrastrar la selección al cambiar.
let condDiasAbiertos = new Set();
let condDiasDe = null;
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
  // Cambió el conductor: el plegado de días arranca de cero.
  if (condDiasDe !== cond) { condDiasDe = cond; condDiasAbiertos = new Set(); }
  const wrap = document.getElementById('conductor-detail-wrap');
  if (!cond) {
    // Sin conductor elegido el buscador no hacía NADA: para encontrar un envío
    // había que saber de antemano quién lo llevó. Como el operador de clientes
    // no es el mismo que el de conductores, eso obligaba a que se preguntaran
    // entre ellos por cada tracking. Ahora la búsqueda resuelve el conductor.
    if (_buscarEnvioSinConductor(wrap)) return;
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="ic ic-truck"></i></div><div class="empty-title">Seleccioná un conductor</div><div class="empty-sub">…o buscá un envío por <strong>tracking</strong>, destinatario o zona y te llevamos al conductor que lo hizo</div></div>`;
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
    const contabiliza = contabilizaRegistro(r);
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

  // Resumen por día (para los separadores): envíos, cuántos contabilizan y subtotal.
  const resumenDia = new Map();
  idxsVista.forEach(i => {
    const r = AppData.records[i];
    const dia = (r.fecha || '').trim() || 'Sin fecha';
    let x = resumenDia.get(dia);
    if (!x) { x = { envios: 0, contab: 0, total: 0 }; resumenDia.set(dia, x); }
    x.envios++;
    const est = (r.estado || '').toUpperCase().trim();
    if (contabilizaRegistro(r)) {
      x.contab++;
      const m = precioManualDe(r);
      x.total += (m !== null ? m : precioAutoDe(r).precio);
    }
  });
  const diasTrabajados = Array.from(resumenDia.entries()).filter(([, v]) => v.contab > 0).length;

  let _diaPrev = null;
  const filas = idxsVista.map(i => {
    const r = AppData.records[i];
    // Separador al empezar cada día (los envíos ya vienen ordenados por fecha).
    const _dia = (r.fecha || '').trim() || 'Sin fecha';
    let separador = '';
    if (_dia !== _diaPrev) {
      _diaPrev = _dia;
      const rd = resumenDia.get(_dia) || { envios: 0, contab: 0, total: 0 };
      const fd = parseFechaReg(_dia);
      const dow = fd && typeof DIAS_SEM !== 'undefined' ? DIAS_SEM[fd.getDay()] + ' ' : '';
      const _diaAttr = _dia.replace(/"/g, '&quot;');
      const _abierto = condDiasAbiertos.has(_dia);
      separador =
        '<tr class="cond-dia-head" style="background:var(--surface-0);cursor:pointer" title="Tocá para abrir o cerrar el día" data-dia="' + _diaAttr + '" onclick="toggleDiaConductor(this.dataset.dia)">' +
          '<td colspan="6" style="padding:8px 12px;border-top:2px solid var(--border)">' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px">' +
              '<span class="cond-dia-chev' + (_abierto ? ' abierto' : '') + '" data-dia="' + _diaAttr + '"><i class="ic ic-chevrons-down"></i></span>' +
              '<strong style="font-size:13px"><i class="ic ic-calendar"></i> ' + dow + _dia + '</strong>' +
              '<span class="muted">' + rd.contab + ' de ' + rd.envios + ' contabilizan</span>' +
              '<span class="muted cond-dia-hint"' + (_abierto ? ' style="display:none"' : '') + '>· tocá para ver los ' + rd.envios + '</span>' +
              _btnRecorridoEspecial(cond, _dia, _diaAttr) +
              '<strong style="margin-left:auto;font-family:monospace;order:9">' + fmtPeso(rd.total) + '</strong>' +
            '</div>' +
          '</td>' +
        '</tr>';
    }
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = contabilizaRegistro(r);
    const auto = precioAutoDe(r);
    const manual = precioManualDe(r);
    const esCanonico = ['ENTREGADO', 'NO ENTREGADO'].includes(estadoNorm);
    return separador + `
      <tr class="cond-fila-dia" data-dia="${_dia.replace(/"/g, '&quot;')}" style="${condDiasAbiertos.has(_dia) ? '' : 'display:none;'}${contabiliza ? '' : 'background:#fdf6f6;'}${manual !== null ? 'box-shadow:inset 3px 0 0 #f59e0b;' : ''}">
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
          ${visitaPagaHTML(i, r)}
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
          <div class="conductor-meta"><strong>${diasTrabajados} día${diasTrabajados === 1 ? '' : 's'} trabajado${diasTrabajados === 1 ? '' : 's'}</strong> · ${idxs.length} recorridos en el período · ${entregados} contabilizan · ${noEntregados} no suman${corregidos ? ' · ✏️ ' + corregidos + ' corregidos a mano' : ''}</div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-size:11px;opacity:0.85;text-transform:uppercase;letter-spacing:.04em">Total del período</div>
          <div style="font-size:24px;font-weight:700">${fmtPeso(total)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted)">
        <span>Los días arrancan cerrados — tocá uno para ver y corregir sus envíos.</span>
        <button class="btn btn-sm" style="margin-left:auto;padding:3px 8px;font-size:10.5px" onclick="abrirTodosLosDias(true)">Abrir todos</button>
        <button class="btn btn-sm" style="padding:3px 8px;font-size:10.5px" onclick="abrirTodosLosDias(false)">Cerrar todos</button>
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

// ─── Visita hecha sin entrega ───────────────────────────────────────────────
// El conductor fue al domicilio y no pudo entregar por una causa ajena a él. Se
// le paga la visita, pero el ESTADO del envío no se toca: sigue diciendo "no
// entregado", que es la verdad. Distinto de corregir el estado a "Entregado",
// que es para cuando el conductor se olvidó de marcarlo.
function visitaPagaHTML(i, r) {
  const entregado = esEstadoEntregado(r.estado);
  if (entregado) return '';   // ya contabiliza por estado: no hace falta
  if (r.contabiliza_manual) {
    return '<div style="margin-top:5px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
      '<span class="tag" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:9.5px" title="Visita paga — ' +
        String(r.motivo_contab || '').replace(/"/g, '&quot;') + '"><i class="ic ic-check"></i> Se paga la visita</span>' +
      '<button class="btn btn-sm" style="padding:1px 5px;font-size:9.5px" onclick="abrirMotivoVisita(' + i + ')" title="Cambiar el motivo">' +
        (r.motivo_contab ? String(r.motivo_contab).slice(0, 22) + (String(r.motivo_contab).length > 22 ? '…' : '') : 'sin motivo') + '</button>' +
      '<button class="btn btn-sm" style="padding:1px 5px;font-size:9.5px;border-color:#fca5a5;color:#b91c1c" onclick="quitarVisitaPaga(' + i + ')" title="Dejar de pagar esta visita">✕</button>' +
    '</div>';
  }
  return '<div style="margin-top:5px">' +
    '<button class="btn btn-sm" style="padding:2px 7px;font-size:10px" onclick="abrirMotivoVisita(' + i + ')" ' +
      'title="El conductor fue al domicilio pero no pudo entregar: se le paga la visita sin cambiar el estado del envío">' +
      '<i class="ic ic-truck"></i> Pagar visita</button>' +
  '</div>';
}

// ── Recorrido especial ─────────────────────────────────────────────────────
// Rutas de envíos problemáticos (5 a 10 direcciones muy dispersas) que se pactan
// a un monto fijo por recorrido. Lo que se guarda es el DIFERENCIAL contra lo que
// ese día ya paga por tarifa de zona: así el conductor termina cobrando la ruta
// completa y en la liquidación se ve de dónde salió.
function _btnRecorridoEspecial(cond, dia, diaAttr) {
  if (!dia || dia === 'Sin fecha') return '';
  const re = recorridoEspecialDe(cond, dia);
  const attr = 'data-dia="' + diaAttr + '" onclick="event.stopPropagation();abrirRecorridoEspecial(this.dataset.dia)"';
  return re
    ? '<button class="btn btn-sm" style="padding:1px 7px;font-size:10px;border-color:#86efac;color:#15803d;white-space:nowrap" ' +
      'title="Recorrido especial · ruta pactada en ' + fmtPeso(_num(re.valor_ruta)) + '" ' + attr + '>' +
      '⚡ especial +' + fmtPeso(_num(re.monto)) + '</button>'
    : '<button class="btn btn-sm" style="padding:1px 7px;font-size:10px;white-space:nowrap" ' +
      'title="Ruta de envíos problemáticos pactada a monto fijo: se paga la diferencia" ' + attr + '>+ Recorrido especial</button>';
}

// Lo que ese día ya paga por tarifa: la base del diferencial. Sale de los mismos
// recorridos que muestra el panel, no de la vista filtrada: un filtro de
// búsqueda puesto no puede cambiar lo que se le paga al conductor.
function _baseDelDiaConductor(cond, dia) {
  let total = 0, n = 0;
  indicesConductorFiltrados(cond).forEach(i => {
    const r = AppData.records[i];
    if (String(r.fecha || '').trim() !== String(dia).trim()) return;
    if (!contabilizaRegistro(r)) return;
    const m = precioManualDe(r);
    total += (m !== null ? m : precioAutoDe(r).precio);
    n++;
  });
  return { total, n };
}

let respDia = null, respBase = 0;

function abrirRecorridoEspecial(dia) {
  const cond = document.getElementById('cond-select')?.value || '';
  if (!cond || !dia) return;
  respDia = dia;
  const b = _baseDelDiaConductor(cond, dia);
  respBase = b.total;
  const re = recorridoEspecialDe(cond, dia);
  document.getElementById('mresp-title').textContent = 'Recorrido especial · ' + dia;
  document.getElementById('mresp-ctx').innerHTML =
    '<strong style="color:var(--text-primary)">' + cond + '</strong> · ' + dia +
    '<div style="margin-top:2px">Los envíos de ese día suman <strong>' + fmtPeso(b.total) + '</strong> (' + b.n + ' contabilizan).</div>';
  document.getElementById('mresp-valor').value = re ? _num(re.valor_ruta) : '';
  document.getElementById('mresp-detalle').value = re ? (re.detalle || '') : '';
  document.getElementById('mresp-quitar').style.display = re ? '' : 'none';
  recalcRecorridoEspecial();
  document.getElementById('modal-resp-backdrop').style.display = 'flex';
}

function cerrarRecorridoEspecial(e) {
  if (!e || e.target.id === 'modal-resp-backdrop') {
    document.getElementById('modal-resp-backdrop').style.display = 'none';
    respDia = null;
  }
}

function recalcRecorridoEspecial() {
  const box = document.getElementById('mresp-calc');
  if (!box) return;
  const valor = parseFloat(document.getElementById('mresp-valor').value);
  if (isNaN(valor) || valor <= 0) { box.innerHTML = '<span class="muted">Poné cuánto se pactó por la ruta.</span>'; return; }
  const dif = valor - respBase;
  box.innerHTML =
    '<div style="display:flex;justify-content:space-between"><span>Ruta pactada</span><strong class="mono">' + fmtPeso(valor) + '</strong></div>' +
    '<div style="display:flex;justify-content:space-between;color:var(--text-muted)"><span>Ya paga el día</span><span class="mono">− ' + fmtPeso(respBase) + '</span></div>' +
    '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:5px;padding-top:5px">' +
      '<strong>Diferencial a pagar</strong>' +
      '<strong class="mono" style="color:' + (dif > 0 ? '#15803d' : '#b45309') + '">' + (dif > 0 ? '+' : '') + fmtPeso(dif) + '</strong></div>' +
    (dif <= 0 ? '<div style="margin-top:5px;color:#b45309;font-size:11px">El día ya paga eso o más: no hay diferencia que agregar.</div>' : '');
}

async function guardarRecorridoEspecial() {
  const cond = document.getElementById('cond-select')?.value || '';
  const dia = respDia;
  if (!cond || !dia) return;
  const valor = parseFloat(document.getElementById('mresp-valor').value);
  if (isNaN(valor) || valor <= 0) { alert('Poné el valor pactado de la ruta.'); return; }
  const dif = valor - respBase;
  if (dif <= 0) { alert('El día ya paga ' + fmtPeso(respBase) + ': con una ruta de ' + fmtPeso(valor) + ' no hay diferencia que agregar.'); return; }
  const detalle = (document.getElementById('mresp-detalle').value || '').trim();
  const rec = {
    conductor: cond, fecha: dia, valor_ruta: valor, base: respBase, monto: dif,
    detalle, imputar: true,
    creado_por: (typeof currentUser !== 'undefined' && currentUser && currentUser.usuario) || ''
  };
  const previo = recorridoEspecialDe(cond, dia);
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    if (previo) {
      await DB.updateWhere('recorrido_especial', 'id', previo.id, rec);
      Object.assign(previo, rec);
    } else {
      const row = await DB.insertRow('recorrido_especial', rec);
      AppData.recorridosEspeciales.push(Object.assign({ id: row && row.id }, rec));
    }
    _persistirRecEspLocal();
    document.getElementById('modal-resp-backdrop').style.display = 'none';
    respDia = null;
    if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
    renderConductorDetail();
    showToast('⚡ Recorrido especial de ' + dia + ' · se le suman ' + fmtPeso(dif));
  } catch (e) { console.warn('guardarRecorridoEspecial', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

async function quitarRecorridoEspecial() {
  const cond = document.getElementById('cond-select')?.value || '';
  const dia = respDia;
  const re = recorridoEspecialDe(cond, dia);
  if (!re) return;
  if (!confirm('¿Quitar el recorrido especial del ' + dia + '?' + String.fromCharCode(10) +
    'Deja de sumarse ' + fmtPeso(_num(re.monto)) + ' a la liquidación.')) return;
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.deleteWhere('recorrido_especial', 'id', re.id);
    AppData.recorridosEspeciales = AppData.recorridosEspeciales.filter(x => x.id !== re.id);
    _persistirRecEspLocal();
    document.getElementById('modal-resp-backdrop').style.display = 'none';
    respDia = null;
    if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
    renderConductorDetail();
    showToast('Recorrido especial quitado');
  } catch (e) { console.warn('quitarRecorridoEspecial', e); alert('No se pudo quitar: ' + (e.message || e)); }
}

function _persistirRecEspLocal() {
  try { localStorage.setItem('liq_recorridos_especiales', JSON.stringify(AppData.recorridosEspeciales || [])); } catch (e) {}
}

// Qué registro se está marcando. Se guarda el ID además del índice: el índice
// apunta a una posición de AppData.records, y esa lista se reemplaza entera cada
// vez que se re-hidrata desde la nube. Si eso pasa con el modal abierto, el
// índice queda apuntando a OTRO envío y la visita se le pagaría al equivocado.
let visitaPagaIdx = -1, visitaPagaId = null;

// El registro del modal, resuelto por id (y por índice si todavía no tiene id).
function _registroVisita() {
  if (visitaPagaId != null) {
    const r = AppData.records.find(x => x.id === visitaPagaId);
    if (r) return r;
  }
  return AppData.records[visitaPagaIdx] || null;
}

// Guarda la marca EN EL MOMENTO. No va por el autosave de 2,5 s: pagar una
// visita es una decisión sobre plata que se toma una vez, no una tecla en un
// campo de texto, y en esa ventana cambiar de panel o recargar la perdía sin
// ningún aviso — el envío quedaba en $0 y parecía que el panel no sincronizaba.
async function _persistirVisita(r) {
  if (!r) return false;
  if (!r.id) { alert('Este envío todavía no está sincronizado con la nube. Reintentá en unos segundos.'); return false; }
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.updateWhere('registros', 'id', r.id, {
      contabiliza_manual: !!r.contabiliza_manual,
      motivo_contab: r.motivo_contab || '',
      // La clave cambia con la marca: una visita pagada pasa a V:tracking|fecha
      // para que ningún listado posterior la reemplace. Si no se reescribe acá,
      // el borrado por clave del próximo import se la lleva puesta.
      clave: claveRegistro(r)
    });
    if (typeof condEditIdsSucios !== 'undefined') condEditIdsSucios.delete(r.id);
    return true;
  } catch (e) {
    console.warn('_persistirVisita', e);
    return false;
  }
}

function abrirMotivoVisita(i) {
  const r = AppData.records[i];
  if (!r) return;
  if (r._historico) { showToast('🗄️ Registro archivado (solo lectura)'); return; }
  visitaPagaIdx = i;
  visitaPagaId = r.id != null ? r.id : null;
  const sel = document.getElementById('mvisita-motivo');
  if (sel) {
    sel.innerHTML = MOTIVOS_CONTAB.map(m => '<option value="' + m.replace(/"/g, '&quot;') + '">' + m + '</option>').join('');
    if (r.motivo_contab && MOTIVOS_CONTAB.includes(r.motivo_contab)) sel.value = r.motivo_contab;
  }
  const det = document.getElementById('mvisita-detalle');
  if (det) det.value = (r.motivo_contab && !MOTIVOS_CONTAB.includes(r.motivo_contab)) ? r.motivo_contab : '';
  const info = document.getElementById('mvisita-envio');
  if (info) info.textContent = (r.tracking || 's/tracking') + ' · ' + (r.destinatario || '') + ' · ' + (r.zona || '');
  const est = document.getElementById('mvisita-estado');
  if (est) est.textContent = r.estado || '—';
  document.getElementById('modal-visita-backdrop').style.display = 'flex';
}

function cerrarMotivoVisita(e) {
  if (!e || e.target.id === 'modal-visita-backdrop') {
    document.getElementById('modal-visita-backdrop').style.display = 'none';
    visitaPagaIdx = -1; visitaPagaId = null;
  }
}

async function guardarMotivoVisita() {
  const r = _registroVisita();
  if (!r) return;
  const i = AppData.records.indexOf(r);
  const sel = document.getElementById('mvisita-motivo');
  const det = document.getElementById('mvisita-detalle');
  let motivo = (sel && sel.value) || '';
  const libre = (det && det.value || '').trim();
  if (motivo === 'Otro') {
    if (!libre) { alert('Escribí el motivo.'); return; }
    motivo = libre;
  } else if (libre) {
    motivo = motivo + ' — ' + libre;
  }
  r.contabiliza_manual = true;
  r.motivo_contab = motivo;
  document.getElementById('modal-visita-backdrop').style.display = 'none';
  visitaPagaIdx = -1; visitaPagaId = null;

  const ok = await _persistirVisita(r);
  if (!ok) {
    // Si no se guardó, la pantalla no puede decir que sí: se revierte.
    r.contabiliza_manual = false; r.motivo_contab = '';
    if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
    _repintarPanelDeEnvios();
    alert('No se pudo guardar la visita en la nube. El envío NO quedó marcado — reintentá.');
    return;
  }
  if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
  _repintarPanelDeEnvios();
  _avisarImpactoCobro(r, 'Se paga la visita');
  if (typeof reabrirLiquidacionDeEnvio === 'function') reabrirLiquidacionDeEnvio(r, 'una visita pagada');
}

async function quitarVisitaPaga(i) {
  const r = AppData.records[i];
  if (!r) return;
  if (!confirm('¿Dejar de pagar esta visita? El envío deja de contabilizar en la liquidación.')) return;
  const motivoPrevio = r.motivo_contab || '';
  r.contabiliza_manual = false;
  r.motivo_contab = '';
  const ok = await _persistirVisita(r);
  if (!ok) {
    r.contabiliza_manual = true; r.motivo_contab = motivoPrevio;
    alert('No se pudo guardar el cambio en la nube. La visita sigue pagada — reintentá.');
    return;
  }
  if (typeof invalidarLiquidaciones === 'function') invalidarLiquidaciones();
  _repintarPanelDeEnvios();
  _avisarImpactoCobro(r, 'Visita quitada');
  if (typeof reabrirLiquidacionDeEnvio === 'function') reabrirLiquidacionDeEnvio(r, 'una visita quitada');
}

// ─── Plegado por día ────────────────────────────────────────────────────────
// Se muestra/oculta sin volver a renderizar: así no se pierde lo que el operador
// esté tipeando en un input de otra fila.
function toggleDiaConductor(dia) {
  if (!dia) return;
  if (condDiasAbiertos.has(dia)) condDiasAbiertos.delete(dia);
  else condDiasAbiertos.add(dia);
  aplicarPlegadoDias();
}

function aplicarPlegadoDias() {
  const wrap = document.getElementById('conductor-detail-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('tr.cond-fila-dia').forEach(tr => {
    tr.style.display = condDiasAbiertos.has(tr.dataset.dia) ? '' : 'none';
  });
  wrap.querySelectorAll('.cond-dia-chev').forEach(el => {
    el.classList.toggle('abierto', condDiasAbiertos.has(el.dataset.dia));
  });
  wrap.querySelectorAll('tr.cond-dia-head').forEach(tr => {
    const hint = tr.querySelector('.cond-dia-hint');
    if (hint) hint.style.display = condDiasAbiertos.has(tr.dataset.dia) ? 'none' : '';
  });
}

function abrirTodosLosDias(abrir) {
  const wrap = document.getElementById('conductor-detail-wrap');
  if (!wrap) return;
  condDiasAbiertos = new Set();
  if (abrir) wrap.querySelectorAll('tr.cond-dia-head').forEach(tr => condDiasAbiertos.add(tr.dataset.dia));
  aplicarPlegadoDias();
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
    _repintarPanelDeEnvios();
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
  _repintarPanelDeEnvios();
  _avisarImpactoCobro(r);     // el envío quedó pago pero ¿se le cobra a alguien?
  // Si la liquidación de ese cliente ya estaba cerrada, se reabre sola.
  if (typeof reabrirLiquidacionDeEnvio === 'function') reabrirLiquidacionDeEnvio(r, 'un envío (' + campo + ')');
  // Autoguardado con espera corta: agrupa varias ediciones en un solo guardado.
  clearTimeout(condEditTimer);
  condEditTimer = setTimeout(guardarEdicionConductores, 2500);
}

// Los envíos se editan desde DOS paneles (Conductores y Detalle de cliente) y
// son los mismos `registros`. Repintar siempre el de Conductores dejaba al
// operador del panel de cliente sin ver nada: elegía una zona, quedaba
// pendiente, pero la fila no se volvía a dibujar y el botón "Confirmar" nunca
// aparecía — el cambio se quedaba trabado sin ningún aviso (bug real).
function _repintarPanelDeEnvios() {
  const pagina = (typeof paginaActivaId === 'function') ? paginaActivaId() : null;
  if (pagina === 'detalle-cliente' && typeof renderDetalleCliente === 'function') { renderDetalleCliente(); return; }
  renderConductorDetail();
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
  _repintarPanelDeEnvios();
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
  _repintarPanelDeEnvios();
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
  _marcarDimDirty(r, 'Dimensión "' + nombre + '" asignada');
}

function quitarDimensionEnvio(idx) {
  const r = AppData.records[idx];
  if (!r) return;
  if (r._historico) { showToast('🗄️ Registro archivado (solo lectura)'); return; }
  r.dim_especial = ''; r.dim_cliente = '';
  _marcarDimDirty(r, 'Dimensión quitada');
}

// Marca el registro como sucio y agenda el autoguardado (igual que las ediciones).
// `accion` describe qué se hizo; va en el MISMO toast que el impacto. Dos
// toasts seguidos se apilan en el mismo lugar y el segundo tapa al primero,
// justo el aviso de que el envío quedó a pérdida.
function _marcarDimDirty(r, accion) {
  if (r.id) condEditIdsSucios.add(r.id);
  else console.warn('Registro sin id de nube (no se podrá sincronizar la dimensión):', r.tracking);
  invalidarLiquidaciones();   // cambió el precio del envío por la dimensión
  condEditPendientes = true;
  actualizarEstadoEdicion('Cambios sin guardar…');
  renderConductorDetail();
  _avisarImpactoCobro(r, accion);   // la dimensión cambia lo que se paga: ¿sigue cobrándose?
  if (typeof reabrirLiquidacionDeEnvio === 'function') reabrirLiquidacionDeEnvio(r, 'una dimensión especial');
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
        contabiliza_manual: !!r.contabiliza_manual, motivo_contab: r.motivo_contab || '',
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
// `previewFn` decide qué precio se muestra al confirmar. Por defecto el del
// CONDUCTOR (este panel), pero Detalle de cliente le pasa el de VENTA: ahí el
// costo del cadete no va —es el otro lado del mostrador— y encima arrastraba su
// categoría ("MATANZA SUR · $3.400 · Super SLA"), que no significa nada para el
// cliente y hacía parecer que el tarifario del cliente estaba mal cargado.
function zonaSelectHTML(catalogo, idx, current, cond, previewFn) {
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
    } else if (typeof previewFn === 'function') {
      preview = previewFn(pend);
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

// Opciones de cliente para el alta manual: los del maestro más los que solo
// aparecen en los envíos. Sin cliente el envío se le paga al conductor pero no
// se le factura a nadie, así que se elige de una lista y no se tipea.
let _aeClienteOpts = '';
function clienteOptionsHTML() {
  const vistos = new Map();
  (AppData.clientes || []).forEach(c => {
    const k = clienteKey(c.codigo);
    if (k) vistos.set(k, c.nombre || k);
  });
  (typeof clientesDeRegistros === 'function' ? clientesDeRegistros() : []).forEach(c => {
    if (!vistos.has(clienteKey(c.cod))) vistos.set(clienteKey(c.cod), c.nombre);
  });
  return '<option value="">— sin cliente —</option>' +
    Array.from(vistos.entries())
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([cod, nombre]) => '<option value="' + String(cod).replace(/"/g, '&quot;') + '">' + nombre + '</option>').join('');
}

function envioRowHTML(fechaISO) {
  return '<div class="addenvio-row" style="display:grid;grid-template-columns:120px 1fr 1fr 1fr 100px 34px;gap:8px;align-items:center">' +
    '<input type="date" class="ae-fecha" value="' + (fechaISO || '') + '" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px">' +
    '<input type="text" class="ae-tracking" placeholder="Nº tracking" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:monospace">' +
    '<select class="ae-zona" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:var(--surface-1);max-width:100%">' + _aeZonaOpts + '</select>' +
    '<select class="ae-cliente" title="A quién se le factura este envío" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:var(--surface-1);max-width:100%">' + _aeClienteOpts + '</select>' +
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
  _aeClienteOpts = clienteOptionsHTML();
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
    const clienteCod = (row.querySelector('.ae-cliente')?.value || '').trim().toUpperCase();
    row.querySelector('.ae-fecha').style.borderColor = 'var(--border)';
    // Fila sin datos reales (solo la fecha por defecto) → se ignora.
    const tieneContenido = tracking || zona || precioV !== '' || clienteCod;
    if (!tieneContenido) return;
    if (!iso) { faltaFecha++; row.querySelector('.ae-fecha').style.borderColor = '#e11d48'; return; }
    recs.push({
      cadete: conductor, tracking, fecha: isoToDMY(iso),
      localidad: zona, zona: zona, zona_precio: '',
      direccion: '', destinatario: '',
      // A quién se le factura. cliente_cod es la IDENTIDAD (el nombre
      // normalizado); sin esto el envío se le paga al conductor pero no aparece
      // en la liquidación de ningún cliente.
      cliente: clienteCod ? clienteNombreDe(clienteCod) : '',
      cliente_cod: clienteCod,
      estado: 'Entregado', precio_bd: 0,
      carga_fecha: isoToDMY(hoyISO()),
      manual: true, // cargado a mano → chip "Manual" en la tabla
      precio_manual: precioV === '' ? null : (parseFloat(precioV) || 0)
    });
  });

  if (faltaFecha) { showToast('Completá la fecha en las filas marcadas en rojo'); return; }
  if (!recs.length) { showToast('No cargaste ningún envío'); return; }

  // Un envío sin cliente se le paga al conductor y no se le factura a NADIE: no
  // aparece en la liquidación de ningún cliente, así que no hay dónde se note el
  // faltante. Se avisa ACÁ, que es el único momento en que el operador tiene el
  // dato a mano; puede seguir igual (a veces la empresa lo absorbe).
  const sinCliente = recs.filter(r => !r.cliente_cod);
  if (sinCliente.length) {
    const lista = sinCliente.slice(0, 5).map(r => '· ' + (r.tracking || '(sin tracking)') + ' — ' + (r.zona || 'sin zona')).join(String.fromCharCode(10));
    if (!confirm(sinCliente.length + ' de los ' + recs.length + ' envíos NO tienen cliente:' + String.fromCharCode(10) +
      lista + (sinCliente.length > 5 ? String.fromCharCode(10) + '…y ' + (sinCliente.length - 5) + ' más' : '') +
      String.fromCharCode(10) + String.fromCharCode(10) +
      'Se le van a pagar al conductor pero no se le facturan a nadie.' + String.fromCharCode(10) +
      'Aceptar = guardarlos igual · Cancelar = volver y elegir el cliente')) return;
  }

  const btn = document.getElementById('addenvio-guardar');
  const est = document.getElementById('addenvio-estado');
  btn.disabled = true;
  if (est) est.textContent = 'Guardando ' + recs.length + ' envío(s)…';
  try {
    const ids = await DB.insertRows('registros', recs.map(filaRegistroNube));
    recs.forEach((r, i) => { r.id = ids[i]; });
    AppData.records.push(...recs);
    // Un envío nuevo cambia el total del cliente: si su liquidación de ese
    // período ya estaba cerrada, se reabre sola.
    if (typeof reabrirLiquidacionDeEnvio === 'function') {
      const vistos = new Set();
      for (const r of recs) {
        const clave = (r.cliente_cod || '') + '|' + r.fecha;
        if (!r.cliente_cod || vistos.has(clave)) continue;
        vistos.add(clave);
        await reabrirLiquidacionDeEnvio(r, 'un envío cargado a mano');
      }
    }
    document.getElementById('modal-addenvio-backdrop').style.display = 'none';
    renderConductorDetail();
    // Cuánto de lo que se acaba de cargar se le factura a alguien.
    let seCobran = 0, noSeCobran = 0;
    if (typeof diagnosticoCobroEnvio === 'function') {
      recs.forEach(r => { const d = diagnosticoCobroEnvio(r); if (d.cobra) seCobran++; else noSeCobran++; });
    }
    showToast('✅ ' + recs.length + ' envío(s) agregados a la liquidación de ' + conductor +
      (noSeCobran ? ' — ⚠️ ' + noSeCobran + ' no se le factura(n) a nadie' : (seCobran ? ' · se facturan todos' : '')));
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

// ── Aviso de impacto al corregir un envío a mano ────────────────────────────
// Cada corrección manual mueve plata de los dos lados: lo que se le paga al
// conductor y lo que se le factura al cliente. El operador corrige mirando UN
// lado y no tiene forma de ver el otro. Este aviso lo dice en el momento, que
// es cuando se puede arreglar: si el envío quedó pago pero sin nadie a quien
// cobrarle, avisa POR QUÉ y qué falta cargar.
function _avisarImpactoCobro(r, accion) {
  if (typeof diagnosticoCobroEnvio !== 'function') return;
  let d;
  try { d = diagnosticoCobroEnvio(r); } catch (e) { return; }
  if (!d) return;
  const tk = r.tracking ? (' ' + r.tracking) : '';
  const pre = accion ? (accion + ' — envío' + tk) : ('Envío' + tk);
  // Dejó de contabilizar: sale de las DOS liquidaciones a la vez. Conviene
  // decirlo — el operador de clientes que cambia un estado acaba de sacarle
  // plata a la factura y al conductor, y no tiene el otro panel a la vista.
  if (d.noContabiliza) {
    showToast('ℹ️ ' + pre + ': ya no contabiliza — no se le factura al cliente ni se le paga al conductor');
    return;
  }
  if (d.cobra) {
    // El espejo de la fuga: el envío se cobra pero al conductor se le paga $0.
    // Pasa cuando la dimensión asignada no tiene precio en la zona nueva —
    // el cadete hizo el viaje y no cobra nada, y en la fila solo se ve un
    // discreto "(sin precio en …)".
    if (!(d.pagado > 0)) {
      showToast('⚠️ ' + pre + ': se factura ' + fmtPeso(d.cobrado) +
        ' pero al conductor NO se le paga nada — revisá el precio de ' +
        (r.dim_especial ? ('"' + r.dim_especial + '" en ' + (d.zona || 'esa zona')) : ('la zona ' + (d.zona || ''))));
      return;
    }
    // Se cobra, pero ¿alcanza? Una dimensión asignada puede subir lo que se le
    // paga al cadete sin que exista el precio de venta equivalente: el envío
    // sigue facturándose por la tarifa común de la zona y queda a pérdida.
    if (d.cobrado < d.pagado) {
      showToast('⚠️ ' + pre + ': se paga ' + fmtPeso(d.pagado) + ' y se factura ' + fmtPeso(d.cobrado) +
        ' — queda a pérdida de ' + fmtPeso(d.pagado - d.cobrado));
      return;
    }
    showToast('✅ ' + pre + ': se paga ' + fmtPeso(d.pagado) + ' · se factura ' + fmtPeso(d.cobrado));
    return;
  }
  const comoArreglar = {
    sin_zona:    'cargale la zona',
    sin_cliente: 'asignale el cliente',
    no_alta:     'dalo de alta en Clientes y tarifas',
    sin_tarifa:  'cargá la tarifa de ' + (d.zona || 'esa zona') + ' en su tarifario'
  }[d.motivo] || 'revisalo';
  showToast('⚠️ ' + pre + ': se paga ' + fmtPeso(d.pagado) +
    ' y NO se le factura a nadie (' + d.texto + ') — ' + comoArreglar);
}

// ── Buscar un envío SIN saber quién lo llevó ────────────────────────────────
// El operador de clientes ve un envío con problema en Detalle de cliente y
// necesita corregirlo acá, pero no tiene por qué saber el conductor. Busca por
// tracking (o destinatario / zona) y esta función resuelve el resto:
//   · un solo conductor  → lo selecciona y muestra su detalle ya filtrado
//   · varios             → los lista con cuántos envíos matchean cada uno
//   · ninguno            → lo dice, y avisa si puede estar fuera de la ventana
//                          de días cargada (por defecto 14), que es la causa
//                          más común de "ese tracking no aparece".
// Devuelve true si se hizo cargo de pintar el panel.
function _buscarEnvioSinConductor(wrap) {
  const fCli = (document.getElementById('cond-filtro-cliente')?.value || '').toLowerCase().trim();
  const fTrk = (document.getElementById('cond-filtro-tracking')?.value || '').toLowerCase().trim();
  const fZona = (document.getElementById('cond-filtro-zona')?.value || '').toLowerCase().trim();
  if (!fCli && !fTrk && !fZona) return false;

  const porConductor = new Map();
  let total = 0;
  (AppData.records || []).forEach(r => {
    if (fTrk && !String(r.tracking || '').toLowerCase().includes(fTrk)) return;
    if (fZona && !String(r.zona || r.localidad || '').toLowerCase().includes(fZona)) return;
    if (fCli && !(String(r.destinatario || '').toLowerCase().includes(fCli) ||
                  String(r.cliente || '').toLowerCase().includes(fCli))) return;
    total++;
    const c = conductorCanonico(r.cadete) || '(sin conductor)';
    let x = porConductor.get(c);
    if (!x) { x = { cond: c, envios: 0, ejemplo: r }; porConductor.set(c, x); }
    x.envios++;
  });

  const cnt = document.getElementById('cond-filtro-count');

  if (!total) {
    if (cnt) cnt.textContent = '';
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="ic ic-search"></i></div>' +
      '<div class="empty-title">Ningún envío coincide</div>' +
      '<div class="empty-sub">La app tiene cargados los <strong>últimos ' + (typeof VENTANA_DIAS_REGISTROS !== 'undefined' ? VENTANA_DIAS_REGISTROS : 14) +
      ' días</strong>. Si el envío es más viejo, traelo desde <strong>Importar datos → Archivo</strong> ' +
      'o cargá el historial completo desde el Dashboard.</div></div>';
    return true;
  }

  const lista = Array.from(porConductor.values()).sort((a, b) => b.envios - a.envios);

  // Un solo conductor: lo elegimos y mostramos su detalle, que es lo que el
  // operador quería. El filtro de texto sigue puesto, así que ve justo el envío.
  if (lista.length === 1 && lista[0].cond !== '(sin conductor)') {
    const sel = document.getElementById('cond-select');
    if (sel) {
      if (!Array.from(sel.options).some(o => o.value === lista[0].cond)) {
        sel.insertAdjacentHTML('beforeend', '<option value="' + String(lista[0].cond).replace(/"/g, '&quot;') + '">' + lista[0].cond + '</option>');
      }
      sel.value = lista[0].cond;
      renderConductorDetail();     // ahora sí hay conductor: pinta el detalle
      abrirTodosLosDias(true);
      return true;
    }
  }

  // Varios conductores (o envíos sin conductor): que elija.
  if (cnt) cnt.textContent = total + ' envío(s) en ' + lista.length + ' conductor(es)';
  wrap.innerHTML = '<div class="card"><div class="card-header">' +
    '<span class="card-title"><i class="ic ic-search"></i> ' + total + ' envío(s) encontrados</span>' +
    '<span style="font-size:11px;color:var(--text-muted)">elegí el conductor para verlos y corregirlos</span></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:6px">' +
    lista.map(x => {
      const esc = String(x.cond).replace(/'/g, "\'");
      const r = x.ejemplo;
      return '<button class="btn" style="justify-content:flex-start;text-align:left" onclick="_irAConductorDeEnvio(\'' + esc + '\')">' +
        '<strong>' + x.cond + '</strong>' +
        '<span style="margin-left:8px;font-size:11px;color:var(--text-muted)">' + x.envios + ' envío(s)' +
        (r.tracking ? ' · ej. ' + r.tracking : '') + (r.fecha ? ' · ' + r.fecha : '') + '</span></button>';
    }).join('') +
    '</div></div>';
  return true;
}

function _irAConductorDeEnvio(cond) {
  const sel = document.getElementById('cond-select');
  if (!sel) return;
  if (!Array.from(sel.options).some(o => o.value === cond)) {
    sel.insertAdjacentHTML('beforeend', '<option value="' + String(cond).replace(/"/g, '&quot;') + '">' + cond + '</option>');
  }
  sel.value = cond;
  renderConductorDetail();
  abrirTodosLosDias(true);
}
