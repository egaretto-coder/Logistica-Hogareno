// ════════════════════════════════════════════════════════════════════════
//  DESCUENTOS POR ÍTEM CON FECHA — combustible / extraviados / proveedores
//  Cada renglón es un descuento con fecha; se imputa automáticamente a la
//  liquidación del período en que cae (ver liquidaciones-pdf.js). Una sola
//  tabla (descuentos_items) con discriminador 'tipo'; la UI muestra una solapa
//  por tipo, todas manejadas por este módulo parametrizado.
// ════════════════════════════════════════════════════════════════════════

// Config por tipo: rótulo, ícono, color, campo de referencia y encabezados de
// la plantilla Excel. 'refLabel' null = el tipo no tiene campo de referencia.
const DESC_ITEMS = {
  combustible: {
    label: 'Combustible', emoji: '⛽', color: '#b45309', refLabel: null,
    headers: ['Conductor', 'Fecha', 'Monto', 'Detalle'],
    ejemplos: [
      ['ALEJO BRIEND', '15/07/2026', 15000, 'Carga de nafta ruta larga'],
      ['EMILIANO VENTURA', '16/07/2026', 8000, 'Combustible zona LA PLATA'],
    ],
  },
  extraviados: {
    label: 'Extraviados / Rotos', emoji: '📦', color: '#b91c1c', refLabel: 'Tracking / Envío',
    headers: ['Conductor', 'Fecha', 'Monto', 'Tracking / Envío', 'Detalle'],
    ejemplos: [
      ['EMILIANO VENTURA', '16/07/2026', 4500, '9410811899223344556677', 'Envío roto en reparto'],
      ['SERGIO MOLINA', '17/07/2026', 12000, '9410811899000011112222', 'Paquete extraviado'],
    ],
  },
  proveedores: {
    label: 'Servicio Proveedores', emoji: '🧾', color: '#4f46e5', refLabel: 'Proveedor',
    headers: ['Conductor', 'Fecha', 'Monto', 'Proveedor', 'Detalle'],
    ejemplos: [
      ['SERGIO MOLINA', '17/07/2026', 12000, 'Gomería El Rayo', 'Cambio de cubierta'],
      ['FEDERICO LABIGNAN', '18/07/2026', 9000, 'Taller Norte', 'Service preventivo'],
    ],
  },
};

let descItemModalTipo = null;

// Tipos que admiten cuotear el saldo (los demás se imputan enteros).
const TIPOS_CUOTEABLES = ['extraviados', 'proveedores'];
function esTipoCuoteable(tipo) { return TIPOS_CUOTEABLES.includes(tipo); }   // tipo del ítem que se está creando/editando
let descItemEditId = null;      // id del registro en edición (null = alta)
let descItemCandidatos = [];    // recorridos sugeridos para autocompletar el tracking (extravíos)

function tFecha(f) { const d = parseFechaReg(f); return d ? d.getTime() : 0; }

// ── Render de una solapa de ítem ────────────────────────────────────────────
// Mini dashboard del panel, con el mismo criterio que el de Adelantos: mide lo
// que se está VIENDO y lo dice. Con el buscador puesto los números son los del
// filtro y las tarjetas lo rotulan "(filtrado)" — un total que se mueve sin
// decir por qué se lee como si hubieran cambiado los datos.
// El contenedor existe solo donde se quiso: si una pantalla no lo tiene, esto
// no hace nada.
function _renderDescItemsKPIs(tipo, lista, filtrado) {
  const cont = document.getElementById('descitem-' + tipo + '-kpis');
  if (!cont) return;
  const f = filtrado ? ' (filtrado)' : '';
  const card = (cls, icono, etq, valor, sub, extra) =>
    '<div class="metric-card' + (cls ? ' ' + cls : '') + '"><div class="metric-ic"><i class="ic ' + icono + '"></i></div>' +
    '<div class="metric-label">' + etq + '</div><div class="metric-value">' + valor + '</div>' +
    '<div class="metric-sub">' + sub + '</div>' +
    (extra ? '<div class="metric-sub" style="color:var(--warning);font-weight:600">' + extra + '</div>' : '') +
    '</div>';
  // Un ítem sin estado es de antes del régimen de autorización: cuenta.
  const vivos = lista.filter(x => esAutorizado(x));
  const personas = new Set(vivos.map(x => (typeof conductorCanonico === 'function'
    ? conductorCanonico(x.conductor) : String(x.conductor || '').toUpperCase())).filter(Boolean));
  const total = vivos.reduce((s, x) => s + _num(x.monto), 0);
  const sinImputar = vivos.filter(x => x.imputar === false);
  const montoSinImputar = sinImputar.reduce((s, x) => s + _num(x.monto), 0);
  // Lo que espera autorización NO entra en ningún número de arriba —no se va a
  // descontar hasta que un supervisor lo apruebe— pero tiene que verse: es
  // plata cargada que el panel estaría escondiendo. Pasa en Extraviados, que es
  // el único de los tres que nace pendiente.
  const pend = lista.filter(x => (x.estado || 'autorizado') === 'pendiente');
  const avisoPend = pend.length
    ? pend.length + ' sin autorizar · ' + fmtPeso(pend.reduce((s, x) => s + _num(x.monto), 0))
    : '';

  let primera;
  if (esTipoCuoteable(tipo)) {
    // Lo que todavía no se descontó de los cuoteados: es la deuda viva del
    // panel, igual que el saldo de un adelanto. Los de pago único no tienen
    // saldo —se descuentan enteros en su semana— así que no entran acá.
    const enCuotas = vivos.filter(x => _num(x.cuotas_total) > 1 && !descItemSaldado(x));
    const saldo = enCuotas.reduce((s, x) => s + descItemSaldo(x), 0);
    primera = card('accent', 'ic-dollar', 'Saldo en cuotas' + f, fmtPeso(saldo),
      enCuotas.length ? enCuotas.length + ' servicio(s) todavía descontándose' : 'sin cuotas pendientes');
  } else {
    // Combustible se descuenta entero en la semana de su fecha: lo que importa
    // es cuánta plata va a salir del neto.
    const aDescontar = total - montoSinImputar;
    primera = card('accent', 'ic-dollar', 'A descontar' + f, fmtPeso(aDescontar),
      'se imputa en la liquidación de su semana');
  }

  cont.innerHTML = '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
    primera +
    card('', 'ic-users', 'Conductores' + f, String(personas.size),
      personas.size === 1 ? 'con registros' : 'con registros en el panel') +
    card('', 'ic-receipt', 'Total registrado' + f, fmtPeso(total),
      vivos.length + ' registro(s)' +
      (montoSinImputar > 0 ? ' · ' + fmtPeso(montoSinImputar) + ' sin imputar' : ''),
      avisoPend) +
  '</div>';
}

function renderDescItems(tipo) {
  const cfg = DESC_ITEMS[tipo];
  const cont = document.getElementById('descitem-' + tipo + '-rows');
  if (!cfg || !cont) return;
  const conRef = !!cfg.refLabel;
  const conCuotas = esTipoCuoteable(tipo); // columna de cuotas/progreso
  const ncols = 5 + (conRef ? 1 : 0) + (conCuotas ? 1 : 0);

  const fInput = document.getElementById('descitem-' + tipo + '-fecha-nuevo');
  if (fInput && !fInput.value) fInput.value = hoyISO();
  if (tipo === 'extraviados') {
    const semEl = document.getElementById('extravios-fecha');
    if (semEl && !semEl.value) semEl.value = hoyISO();
  }

  // El mes manda solo donde está el control (hoy, Extraviados). Donde no existe,
  // _panelMesActivo no se consulta y la lista es la de siempre.
  const conMes = !!document.getElementById('descitem-' + tipo + '-mes-nav');
  if (conMes) _pintarPanelMes('descitem-' + tipo);
  const todos = conMes
    ? filtrarPorMesPanel('descitem-' + tipo, AppData.descItems.filter(x => x.tipo === tipo))
    : AppData.descItems.filter(x => x.tipo === tipo);
  const search = (document.getElementById('descitem-' + tipo + '-search')?.value || '').toLowerCase().trim();
  const lista = todos
    .filter(x => !search
      || String(x.conductor || '').toLowerCase().includes(search)
      || String(x.referencia || '').toLowerCase().includes(search))
    .sort((a, b) => tFecha(b.fecha) - tFecha(a.fecha));

  const totalAll = todos.reduce((s, x) => s + _num(x.monto), 0);
  const countEl = document.getElementById('descitem-' + tipo + '-count');
  // Con el buscador puesto el contador dice cuántos de cuántos: si siguiera
  // mostrando el total de todos, contradiría a las tarjetas de arriba, que
  // miden lo filtrado.
  if (countEl) countEl.textContent = (search && lista.length !== todos.length)
    ? lista.length + ' de ' + todos.length + ' registros · Total ' + fmtPeso(lista.reduce((s, x) => s + _num(x.monto), 0))
    : todos.length + ' registros · Total ' + fmtPeso(totalAll);
  _renderDescItemsKPIs(tipo, lista, !!search && lista.length !== todos.length);

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="' + ncols + '"><div class="empty-state"><div class="empty-icon">' + cfg.emoji + '</div><div class="empty-title">Sin registros</div><div class="empty-sub">' +
      (todos.length ? 'Ajustá el buscador' : 'Agregá uno manual o importá un Excel') + '</div></div></td></tr>';
    return;
  }

  const esExtravioTipo = esTipoCuoteable(tipo);
  const puedeAut = puedeAutorizar();
  cont.innerHTML = lista.map(x => {
    const cuoteado = _num(x.cuotas_total) > 1;
    const estado = x.estado || 'autorizado';
    const pendiente = esExtravioTipo && estado === 'pendiente';
    const rechazado = esExtravioTipo && estado === 'rechazado';
    const estadoBadge = pendiente
      ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i> Pendiente</span>'
      : rechazado ? '<span class="badge badge-red">Rechazado</span>' : '';

    const refCell = conRef
      ? '<td class="mono muted" style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">' + (x.referencia || '—') + '</td>'
      : '';

    // Columna de cuotas/progreso (solo extravíos)
    let cuotasCell = '';
    if (conCuotas) {
      if (pendiente) {
        cuotasCell = '<td class="muted" style="font-size:11px">— (pendiente)</td>';
      } else if (cuoteado) {
        const pagadas = descItemCuotasPagadas(x.id);
        const pct = x.cuotas_total ? Math.round(pagadas / x.cuotas_total * 100) : 0;
        const saldado = pagadas >= x.cuotas_total;
        cuotasCell = '<td style="min-width:150px"><div style="display:flex;align-items:center;gap:8px">' +
          '<div style="flex:1;height:7px;background:var(--surface-0);border-radius:99px;overflow:hidden;border:1px solid var(--border)"><div style="height:100%;width:' + pct + '%;background:' + (saldado ? '#166534' : '#b45309') + '"></div></div>' +
          '<span style="font-size:11px;font-weight:600;white-space:nowrap">' + pagadas + '/' + x.cuotas_total + '</span>' +
          '</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + (saldado ? '✓ Saldado' : 'Saldo ' + fmtPeso(descItemSaldo(x)) + ' · cuota ' + fmtPeso(_num(x.monto_cuota))) + '</div></td>';
      } else {
        cuotasCell = '<td class="muted" style="font-size:11px">Pago único</td>';
      }
    }

    // Acciones según estado de autorización
    let acciones = '';
    if (pendiente) {
      acciones = puedeAut
        ? '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;background:#16a34a;border-color:#16a34a;color:#fff" onclick="autorizarExtravio(' + x.id + ')"><i class="ic ic-check"></i> Autorizar</button>' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5" onclick="rechazarExtravio(' + x.id + ')" title="Rechazar"><i class="ic ic-x"></i></button>'
        : '<span style="font-size:11px;color:#9a3412;white-space:nowrap">Esperando autorización</span>' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5" onclick="eliminarDescItem(\'' + tipo + '\',' + x.id + ')" title="Cancelar mi solicitud"><i class="ic ic-trash"></i></button>';
    } else if (rechazado) {
      acciones = (puedeAut ? '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="autorizarExtravio(' + x.id + ')" title="Autorizar igual"><i class="ic ic-check"></i></button>' : '') +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDescItem(\'' + tipo + '\',' + x.id + ')"><i class="ic ic-trash"></i></button>';
    } else {
      if (cuoteado) {
        const saldado = descItemSaldado(x);
        acciones += saldado ? '' : '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:11px" onclick="descontarCuotaExtravio(' + x.id + ')" title="Registrar la próxima cuota en la semana elegida arriba">− Cuota</button>';
        acciones += '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="verHistorialExtravio(' + x.id + ')" title="Ver cuotas"><i class="ic ic-list"></i></button>';
      } else {
        // Imputar o no en la liquidación (misma decisión que en el modal de Liquidaciones).
        acciones += x.imputar === false
          ? '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px;border-color:#fdba74;background:#fff7ed;color:#9a3412" onclick="toggleImputarDescItem(\'' + tipo + '\',' + x.id + ')" title="Excluido: NO se descuenta en la liquidación. Tocá para volver a imputarlo."><i class="ic ic-x"></i> No imputa</button>'
          : '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="toggleImputarDescItem(\'' + tipo + '\',' + x.id + ')" title="Se descuenta en la liquidación del período. Tocá para excluirlo."><i class="ic ic-check"></i> Imputa</button>';
        acciones += '<button class="btn btn-sm" onclick="editDescItem(\'' + tipo + '\',' + x.id + ')"><i class="ic ic-edit"></i></button>';
      }
      acciones += '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDescItem(\'' + tipo + '\',' + x.id + ')"><i class="ic ic-trash"></i></button>';
    }

    const rowStyle = pendiente ? 'background:#fff7ed;' : (rechazado ? 'opacity:0.55;' : (cuoteado && descItemSaldado(x) ? 'opacity:0.6;' : ''));
    return '<tr' + (rowStyle ? ' style="' + rowStyle + '"' : '') + '>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.conductor || 'LH') + ';width:28px;height:28px;font-size:10px">' + initials(x.conductor || 'LH') + '</div><div style="min-width:0"><strong>' + (x.conductor || 'La empresa') + '</strong>' + (estadoBadge ? '<div style="margin-top:3px">' + estadoBadge + '</div>' : '') + (esExtravioTipo ? _chipsExtravio(x) : '') + '</div></div></td>' +
      '<td class="mono muted">' + (x.fecha || '—') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:600;color:' + (_num(x.monto) > 0 ? '#b91c1c' : '#9ca3af') + '">' + fmtPeso(_num(x.monto)) + (cuoteado ? '<div style="font-size:10px;color:var(--text-muted);font-weight:400">en ' + x.cuotas_total + ' cuotas</div>' : '') + '</td>' +
      cuotasCell +
      refCell +
      '<td class="muted" style="font-size:11px;max-width:220px">' + (x.detalle || '—') + '</td>' +
      '<td><div style="display:flex;gap:4px">' + acciones + '</div></td>' +
    '</tr>';
  }).join('');
}

// Cómo quedó cargado: qué pasó, quién lo paga y si el cliente tiene su crédito.
// Van en la fila porque son las preguntas que se le hacen a esta tabla, y
// abrirlas de a una con el lápiz es donde el operador deja de mirarlas.
function _chipsExtravio(x) {
  const chip = (txt, bg, col, bd) => '<span class="badge" style="background:' + bg + ';color:' + col +
    ';border:1px solid ' + bd + ';font-size:9.5px;padding:1px 6px">' + txt + '</span>';
  const p = [];
  const d = danoLabel(x.dano);
  if (d) p.push(chip(d, x.dano === 'roto' ? '#fef2f2' : '#fff7ed', x.dano === 'roto' ? '#991b1b' : '#9a3412',
                     x.dano === 'roto' ? '#fecaca' : '#fdba74'));
  const resp = descItemResponsable(x);
  if (resp === 'empleado') p.push(chip('empleado', '#eef2ff', '#3730a3', '#c7d2fe'));
  if (resp === 'ninguno')  p.push(chip('lo absorbe la empresa', '#f1f5f9', '#475569', '#cbd5e1'));
  if (x.acredita_cliente && x.cliente_cod) {
    const c = _cargoCreditoDe(x.id);
    // Si el tilde está puesto pero el cargo no está, el cliente NO tiene su
    // crédito: decirlo es la única forma de que alguien lo note.
    p.push(c ? chip('acreditado a ' + clienteNombreDe(x.cliente_cod), '#ecfdf5', '#065f46', '#a7f3d0')
             : chip('⚠ falta acreditarle al cliente', '#fff7ed', '#9a3412', '#fdba74'));
  }
  return p.length ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">' + p.join('') + '</div>' : '';
}

// Autoriza / rechaza un extravío pendiente (solo supervisor/analista).
async function autorizarExtravio(id) {
  if (!puedeAutorizar()) { showToast('⛔ Solo un supervisor puede autorizar'); return; }
  const it = AppData.descItems.find(x => x.id === id);
  if (!it) return;
  const cuando = new Date().toISOString();
  const quien = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  try {
    await DB.updateWhere('descuentos_items', 'id', id, { estado: 'autorizado', autorizado_por: quien, autorizado_en: cuando });
    it.estado = 'autorizado'; it.autorizado_por = quien; it.autorizado_en = cuando;
    renderDescItems('extraviados');
    showToast('✅ Extravío de ' + it.conductor + ' autorizado — ya impacta la liquidación');
  } catch (e) { console.warn('autorizarExtravio:', e); showToast('⛔ No se pudo autorizar'); }
}

async function rechazarExtravio(id) {
  if (!puedeAutorizar()) { showToast('⛔ Solo un supervisor puede rechazar'); return; }
  const it = AppData.descItems.find(x => x.id === id);
  if (!it) return;
  if (!confirm('¿Rechazar el extravío de ' + it.conductor + ' (' + fmtPeso(_num(it.monto)) + ')? No impactará ninguna liquidación.')) return;
  const quien = (currentUser && (currentUser.nombre || currentUser.usuario)) || '';
  try {
    await DB.updateWhere('descuentos_items', 'id', id, { estado: 'rechazado', autorizado_por: quien, autorizado_en: new Date().toISOString() });
    it.estado = 'rechazado';
    renderDescItems('extraviados');
    showToast('🚫 Extravío de ' + it.conductor + ' rechazado');
  } catch (e) { console.warn('rechazarExtravio:', e); showToast('⛔ No se pudo rechazar'); }
}

// Incluir / excluir un ítem de las liquidaciones sin borrarlo. Es la MISMA
// decisión que se puede tomar desde el modal de Liquidaciones (un solo campo en
// la base), así que lo que se marca acá se ve allá y viceversa.
async function toggleImputarDescItem(tipo, id) {
  const it = AppData.descItems.find(x => x.id === id);
  if (!it) return;
  const nuevo = !(it.imputar !== false);   // invierte el estado actual
  const etiqueta = (DESC_ITEMS[tipo] && DESC_ITEMS[tipo].label) || tipo;
  if (!nuevo && !confirm('¿Excluir este ' + etiqueta.toLowerCase() + ' de ' + it.conductor + ' (' + fmtPeso(_num(it.monto)) + ')?\n\nNO se va a descontar en la liquidación. El registro se conserva y podés volver a incluirlo cuando quieras.')) return;
  const antes = it.imputar;
  it.imputar = nuevo;                       // optimista: la UI responde al toque
  renderDescItems(tipo);
  try {
    await DB.updateWhere('descuentos_items', 'id', id, { imputar: nuevo });
    try { localStorage.setItem('liq_desc_items', JSON.stringify(AppData.descItems)); } catch (e) {}
    showToast(nuevo ? '✅ Se imputará en la liquidación' : '🚫 Excluido de la liquidación');
  } catch (e) {
    it.imputar = antes; renderDescItems(tipo);   // revertir si la nube falló
    console.warn('toggleImputarDescItem:', e);
    showToast('⛔ No se pudo guardar el cambio');
  }
}

// ── Modal alta / edición ────────────────────────────────────────────────────
function poblarConductoresDescItemDatalist() {
  const dl = document.getElementById('mditem-conductores-list');
  if (!dl) return;
  const nombres = AppData.panelConductores.map(c => c.nombre)
    .concat(Object.keys(calcLiquidaciones()));
  dl.innerHTML = Array.from(new Set(nombres)).sort().map(n => '<option value="' + n + '">').join('');
}

function configDescItemModal(tipo) {
  const cfg = DESC_ITEMS[tipo];
  document.getElementById('mditem-tipo-emoji').textContent = cfg.emoji;
  const esExtravio = (tipo === 'extraviados');
  const esProv = (tipo === 'proveedores');

  // En extravíos la referencia es el TRACKING y sale de su propio bloque, así
  // que el campo "Referencia" de siempre se esconde: dos lugares para el mismo
  // dato terminan con uno de los dos en blanco.
  const refWrap = document.getElementById('mditem-ref-wrap');
  if (cfg.refLabel && !esExtravio) {
    refWrap.style.display = '';
    document.getElementById('mditem-ref-label').textContent = cfg.refLabel;
    document.getElementById('mditem-ref').placeholder = cfg.refLabel;
  } else {
    refWrap.style.display = 'none';
  }
  // En proveedores la referencia se ELIGE de la lista cargada.
  const inp = document.getElementById('mditem-ref');
  const sel = document.getElementById('mditem-ref-select');
  const ayuda = document.getElementById('mditem-ref-ayuda');
  if (inp) inp.style.display = esProv ? 'none' : '';
  if (sel) { sel.style.display = esProv ? '' : 'none'; if (esProv) poblarProveedoresSelect(inp ? inp.value : ''); }
  if (ayuda) ayuda.style.display = esProv ? '' : 'none';

  // El conductor significa otra cosa en extravíos: es QUIEN LO LLEVÓ, con el
  // que se buscan sus trackings, y no necesariamente quien lo paga.
  const cLbl = document.getElementById('mditem-conductor-label');
  if (cLbl) cLbl.textContent = esExtravio ? 'Conductor que llevó el envío' : 'Conductor';
  const cAyuda = document.getElementById('mditem-conductor-ayuda');
  if (cAyuda) cAyuda.style.display = esExtravio ? '' : 'none';
  const mLbl = document.getElementById('mditem-monto-label');
  if (mLbl) mLbl.textContent = esExtravio ? 'Valor de la mercadería ($)' : 'Monto ($)';
  const dLbl = document.getElementById('mditem-detalle-label');
  if (dLbl) dLbl.textContent = esExtravio ? 'Observación (opcional)' : 'Detalle / Observación (opcional)';

  // Los bloques propios del extravío.
  const bloque = (id, mostrar, display) => {
    const el = document.getElementById(id);
    if (el) el.style.display = mostrar ? (display || '') : 'none';
  };
  bloque('mditem-extravio-extra', esExtravio, 'flex');
  bloque('mditem-dano-wrap', esExtravio, 'flex');
  bloque('mditem-resp-wrap', esExtravio, 'flex');
  bloque('mditem-acredita-wrap', esExtravio, 'flex');
  if (esExtravio) { poblarClientesDescItem(); poblarEmpleadosDescItem(); _cambiarResponsableExtravio(); }

  const cuoteBlock = document.getElementById('mditem-cuotear-block');
  if (cuoteBlock) cuoteBlock.style.display = esTipoCuoteable(tipo) ? '' : 'none';
  // El texto nombra lo que se está cargando: "este extravío" en un servicio de
  // proveedor no dice nada.
  const cuoteLbl = document.getElementById('mditem-cuotear-label');
  const cuoteAyuda = document.getElementById('mditem-cuotear-ayuda');
  const comoSeLlama = esProv ? 'este servicio' : (esExtravio ? 'este extravío' : 'este descuento');
  if (cuoteLbl) cuoteLbl.textContent = 'Cuotear ' + comoSeLlama + ' (pagarlo en cuotas)';
  if (cuoteAyuda) cuoteAyuda.textContent = esExtravio
    ? 'Las cuotas se descuentan de a una: de su liquidación semanal si lo paga un conductor, o del sueldo del mes si lo paga un empleado.'
    : 'Las cuotas se descuentan de a una en las liquidaciones siguientes: se tildan en el modal de Liquidaciones, o con el botón "− Cuota" de esta misma solapa.';
}

// Llena el desplegable de proveedores. Si el registro trae uno que ya no está
// en la lista (se dio de baja), se agrega marcado para no perderlo.
function poblarProveedoresSelect(actual) {
  const sel = document.getElementById('mditem-ref-select');
  if (!sel) return;
  const activos = (AppData.proveedores || []).filter(p => p.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const act = String(actual || '').trim();
  const estaEnLista = activos.some(p => normNombre(p.nombre) === normNombre(act));
  sel.innerHTML = '<option value="">— Elegí el proveedor —</option>' +
    activos.map(p => '<option value="' + String(p.nombre).replace(/"/g, '&quot;') + '">' +
      p.nombre + (p.rubro ? ' · ' + p.rubro : '') + '</option>').join('') +
    (act && !estaEnLista ? '<option value="' + act.replace(/"/g, '&quot;') + '">' + act + ' (dado de baja)</option>' : '');
  sel.value = act;
  if (!activos.length) {
    sel.innerHTML = '<option value="">No hay proveedores cargados</option>';
  }
}

// El cliente sale del LISTADO, no de un campo libre. Escrito a mano no matchea
// ningún código y entonces no se puede ni filtrar sus trackings ni acreditarle
// nada: el crédito quedaría colgado de un cliente que no existe.
// Se ofrecen los del maestro MÁS los que aparecen en los envíos, porque un
// cliente recién importado todavía puede no estar de alta y su paquete se
// pierde igual.
function poblarClientesDescItem(actual) {
  const sel = document.getElementById('mditem-cliente-sel');
  if (!sel) return;
  const m = new Map();
  (AppData.clientes || []).forEach(c => {
    const k = clienteKey(c.codigo);
    if (k && esClienteValido(k)) m.set(k, c.nombre || k);
  });
  (AppData.records || []).forEach(r => {
    const k = (typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '';
    if (k && esClienteValido(k) && !m.has(k)) m.set(k, String(r.cliente || '').trim() || k);
  });
  const lista = Array.from(m.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const act = clienteKey(actual || '');
  sel.innerHTML = '<option value="">— Todos los clientes —</option>' +
    lista.map(([k, nom]) => '<option value="' + jsAttr(k) + '">' + _dEsc(nom) + '</option>').join('') +
    (act && !m.has(act) ? '<option value="' + jsAttr(act) + '">' + _dEsc(act) + ' (no está en el maestro)</option>' : '');
  sel.value = act || '';
}

// Los empleados del legajo, para cuando la pérdida es de alguien de adentro.
function poblarEmpleadosDescItem(actualId) {
  const sel = document.getElementById('mditem-empleado');
  if (!sel) return;
  const activos = (AppData.empleados || []).filter(e => e.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const act = actualId || null;
  const estaEnLista = activos.some(e => e.id === act);
  const viejo = act && !estaEnLista ? (AppData.empleados || []).find(e => e.id === act) : null;
  sel.innerHTML = '<option value="">— Elegí el empleado —</option>' +
    activos.map(e => '<option value="' + e.id + '">' + _dEsc(e.nombre) + (e.puesto ? ' · ' + _dEsc(e.puesto) : '') + '</option>').join('') +
    (viejo ? '<option value="' + viejo.id + '">' + _dEsc(viejo.nombre) + ' (dado de baja)</option>' : '');
  sel.value = act ? String(act) : '';
  if (!activos.length && !viejo) sel.innerHTML = '<option value="">No hay empleados cargados</option>';
}
function _dEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

// El valor de la referencia: el tracking elegido en extravíos, el proveedor de
// la lista en proveedores, el input en el resto.
function _valorReferenciaModal(tipo) {
  if (tipo === 'extraviados') {
    const wrap = document.getElementById('mditem-track-manual-wrap');
    const man = document.getElementById('mditem-track-manual');
    if (wrap && wrap.style.display !== 'none' && man && man.value.trim()) return man.value.trim();
    const sel = document.getElementById('mditem-track-sel');
    const r = _candidatoElegido();
    return r ? String(r.tracking || '').trim() : (sel ? String(sel.value || '').trim() && '' : '');
  }
  if (tipo === 'proveedores') {
    const sel = document.getElementById('mditem-ref-select');
    return sel ? String(sel.value || '').trim() : '';
  }
  const inp = document.getElementById('mditem-ref');
  return inp ? String(inp.value || '').trim() : '';
}
// El envío elegido en el desplegable. El valor es la POSICIÓN dentro de
// `descItemCandidatos`, que es una foto local tomada al buscar y de la que solo
// se LEE: no es AppData.records, así que la re-hidratación no la mueve.
function _candidatoElegido() {
  const sel = document.getElementById('mditem-track-sel');
  if (!sel || sel.value === '') return null;
  const i = parseInt(sel.value);
  return (i >= 0 && i < descItemCandidatos.length) ? descItemCandidatos[i] : null;
}

function openAddDescItemModal(tipo) {
  descItemModalTipo = tipo;
  descItemEditId = null;
  const cfg = DESC_ITEMS[tipo];
  document.getElementById('modal-descitem-title').textContent = 'Agregar ' + cfg.label.toLowerCase();
  document.getElementById('mditem-conductor').value = '';
  document.getElementById('mditem-fecha').value = hoyISO();
  document.getElementById('mditem-monto').value = '';
  document.getElementById('mditem-ref').value = '';
  document.getElementById('mditem-detalle').value = '';
  resetExtravioModalExtra();
  configDescItemModal(tipo);
  poblarConductoresDescItemDatalist();
  if (tipo === 'extraviados') buscarTrackingsExtravio();
  document.getElementById('modal-descitem-backdrop').style.display = 'flex';
}

// Resetea los campos propios del extravío.
function resetExtravioModalExtra() {
  descItemCandidatos = [];
  const cli = document.getElementById('mditem-cliente-sel'); if (cli) cli.value = '';
  const filtro = document.getElementById('mditem-track-filtro'); if (filtro) filtro.value = '';
  const tsel = document.getElementById('mditem-track-sel'); if (tsel) tsel.innerHTML = '';
  const tman = document.getElementById('mditem-track-manual'); if (tman) tman.value = '';
  const tmw = document.getElementById('mditem-track-manual-wrap'); if (tmw) tmw.style.display = 'none';
  document.querySelectorAll('input[name="mditem-dano"]').forEach(r => { r.checked = false; });
  // El responsable vuelve a "el conductor" en CADA alta: los radios conservan
  // lo último elegido, así que sin esto quien cargó uno de un empleado se lo
  // llevaba puesto al siguiente y el descuento caía en el legajo equivocado.
  document.querySelectorAll('input[name="mditem-resp"]').forEach(r => { r.checked = (r.value === 'conductor'); });
  const emp = document.getElementById('mditem-empleado'); if (emp) emp.value = '';
  const acr = document.getElementById('mditem-acredita'); if (acr) acr.checked = false;
  const chk = document.getElementById('mditem-cuotear'); if (chk) { chk.checked = false; chk.disabled = false; }
  const cuotasInput = document.getElementById('mditem-cuotas'); if (cuotasInput) { cuotasInput.value = ''; cuotasInput.disabled = false; }
  const wrap = document.getElementById('mditem-cuotas-wrap'); if (wrap) wrap.style.display = 'none';
  const prev = document.getElementById('mditem-cuota-preview'); if (prev) prev.textContent = '';
  _pintarAvisoAcredita();
}

function _danoElegido() {
  const r = document.querySelector('input[name="mditem-dano"]:checked');
  return r ? r.value : '';
}
function _respElegido() {
  const r = document.querySelector('input[name="mditem-resp"]:checked');
  return r ? r.value : 'conductor';
}
function _cambiarResponsableExtravio() {
  const resp = _respElegido();
  const w = document.getElementById('mditem-empleado-wrap');
  if (w) w.style.display = (resp === 'empleado') ? '' : 'none';
  const ay = document.getElementById('mditem-resp-ayuda');
  if (ay) ay.textContent = resp === 'empleado'
    ? 'Se le descuenta del SUELDO del mes, en su propio renglón del recibo.'
    : resp === 'ninguno'
      ? 'No se le descuenta a nadie: queda registrado como pérdida que absorbe la empresa. El crédito al cliente, si corresponde, se marca igual abajo.'
      : 'Se le descuenta de su liquidación semanal.';
  // Cuotear no tiene sentido si no hay a quién cobrarle.
  const cuote = document.getElementById('mditem-cuotear-block');
  if (cuote) cuote.style.display = (resp === 'ninguno') ? 'none' : '';
  if (resp === 'ninguno') {
    const chk = document.getElementById('mditem-cuotear');
    if (chk) chk.checked = false;
    const wr = document.getElementById('mditem-cuotas-wrap');
    if (wr) wr.style.display = 'none';
  }
}

// Qué se le acredita al cliente y en qué factura cae. Se dice ANTES de guardar:
// un crédito que aparece solo en la liquidación, semanas después, no se puede
// cotejar contra nada.
function _pintarAvisoAcredita() {
  const info = document.getElementById('mditem-acredita-info');
  if (!info) return;
  const chk = document.getElementById('mditem-acredita');
  const cod = (document.getElementById('mditem-cliente-sel') || {}).value || '';
  const monto = parseFloat((document.getElementById('mditem-monto') || {}).value) || 0;
  if (!chk || !chk.checked) {
    info.innerHTML = 'Sin tildar, al cliente no se le descuenta nada: la pérdida la absorbe quien figure arriba.';
    return;
  }
  if (!cod) { info.innerHTML = '<span style="color:var(--warning)">Elegí el cliente arriba: sin él no hay a quién acreditarle.</span>'; return; }
  if (monto <= 0) { info.innerHTML = '<span style="color:var(--warning)">Cargá el valor de la mercadería.</span>'; return; }
  const iso = (document.getElementById('mditem-fecha') || {}).value || '';
  let donde = '';
  try {
    const rango = (typeof periodoClienteRango === 'function') ? periodoClienteRango(cod, iso) : null;
    if (rango) donde = ' · entra en su liquidación del ' + rango.desde + ' al ' + rango.hasta;
  } catch (e) {}
  info.innerHTML = 'Se le acredita <strong>' + fmtPeso(monto) + '</strong> a ' + _dEsc(clienteNombreDe(cod)) +
    donde + '. Sale como una línea propia en su factura, en negativo.';
}

function editDescItem(tipo, id) {
  const x = AppData.descItems.find(r => r.id === id && r.tipo === tipo);
  if (!x) return;
  descItemModalTipo = tipo;
  descItemEditId = id;
  const cfg = DESC_ITEMS[tipo];
  document.getElementById('modal-descitem-title').textContent = 'Editar ' + cfg.label.toLowerCase() + ' — ' + x.conductor;
  document.getElementById('mditem-fecha').value = dmyToISO(x.fecha) || hoyISO();
  document.getElementById('mditem-monto').value = x.monto || '';
  document.getElementById('mditem-ref').value = x.referencia || '';
  if (x.tipo === 'proveedores') poblarProveedoresSelect(x.referencia || '');
  document.getElementById('mditem-detalle').value = x.detalle || '';
  resetExtravioModalExtra(); // los cuoteados no se editan por acá (pago único)

  if (tipo === 'extraviados') {
    // El conductor que LLEVÓ el envío sale del propio envío, no del
    // beneficiario: si lo paga un empleado, `conductor` guarda su nombre.
    const resp = descItemResponsable(x);
    const env = (AppData.records || []).find(r => String(r.tracking || '').trim() &&
      String(r.tracking).trim() === String(x.referencia || '').trim());
    document.getElementById('mditem-conductor').value =
      (env && String(env.cadete || '').toUpperCase().trim()) || (resp === 'conductor' ? (x.conductor || '') : '');
    poblarClientesDescItem(x.cliente_cod || '');
    poblarEmpleadosDescItem(x.empleado_id || null);
    document.querySelectorAll('input[name="mditem-resp"]').forEach(r => { r.checked = (r.value === resp); });
    document.querySelectorAll('input[name="mditem-dano"]').forEach(r => { r.checked = (r.value === x.dano); });
    const acr = document.getElementById('mditem-acredita'); if (acr) acr.checked = !!x.acredita_cliente;
  } else {
    document.getElementById('mditem-conductor').value = x.conductor || '';
  }

  configDescItemModal(tipo);
  poblarConductoresDescItemDatalist();
  if (tipo === 'extraviados') {
    buscarTrackingsExtravio();
    // Si el envío ya no está entre los cargados (la ventana de días no llega
    // tan atrás), el tracking guardado se muestra a mano en vez de perderse.
    const sel = document.getElementById('mditem-track-sel');
    const i = descItemCandidatos.findIndex(r => String(r.tracking || '').trim() === String(x.referencia || '').trim());
    if (i >= 0 && sel) { sel.value = String(i); }
    else if (x.referencia) {
      const tmw = document.getElementById('mditem-track-manual-wrap');
      const tman = document.getElementById('mditem-track-manual');
      if (tmw) tmw.style.display = '';
      if (tman) tman.value = x.referencia;
    }
    _pintarAvisoAcredita();
  }
  document.getElementById('modal-descitem-backdrop').style.display = 'flex';
}

function closeDescItemModal(e) {
  if (!e || e.target.id === 'modal-descitem-backdrop') {
    document.getElementById('modal-descitem-backdrop').style.display = 'none';
  }
}

async function guardarDescItemModal() {
  const tipo = descItemModalTipo;
  const cfg = DESC_ITEMS[tipo];
  if (!cfg) return;
  const esExtravio = (tipo === 'extraviados');
  const quienLoLlevo = document.getElementById('mditem-conductor').value.trim().toUpperCase();
  const iso = document.getElementById('mditem-fecha').value;
  const monto = parseFloat(document.getElementById('mditem-monto').value) || 0;
  const referencia = (cfg.refLabel || esExtravio) ? _valorReferenciaModal(tipo) : '';
  const detalle = document.getElementById('mditem-detalle').value.trim();

  if (!iso) { alert('La fecha es obligatoria (define a qué liquidación se imputa).'); return; }
  if (monto <= 0) { alert('Ingresá un monto mayor a 0.'); return; }
  // El proveedor sale de la lista: sin elegirlo no se sabe a quién se le pagó.
  if (tipo === 'proveedores' && !referencia) { alert('Elegí el proveedor de la lista.'); return; }

  // ── Quién lo paga ──────────────────────────────────────────────────────
  // `conductor` guarda el NOMBRE del responsable en los tres casos, igual que
  // los adelantos, así el buscador y el historial siguen sirviendo.
  let beneficiario_tipo = 'conductor', empleado_id = null, conductor = quienLoLlevo;
  let dano = '', cliente_cod = '', acredita_cliente = false;
  if (esExtravio) {
    beneficiario_tipo = _respElegido();
    dano = _danoElegido();
    cliente_cod = clienteKey((document.getElementById('mditem-cliente-sel') || {}).value || '');
    acredita_cliente = !!(document.getElementById('mditem-acredita') || {}).checked;

    if (!quienLoLlevo) { alert('Poné el conductor que llevó el envío: con él se buscan sus trackings.'); return; }
    if (!referencia) { alert('Elegí el envío de la lista (o escribí el tracking a mano si no aparece).'); return; }
    // Obligatorio: el panel se llama "Extraviados / Rotos" y sin esto no se
    // puede saber de cuál de los dos se está hablando.
    if (!dano) { alert('Marcá qué pasó con el envío: extraviado o roto.'); return; }
    if (beneficiario_tipo === 'empleado') {
      empleado_id = parseInt((document.getElementById('mditem-empleado') || {}).value) || null;
      const emp = (AppData.empleados || []).find(e => e.id === empleado_id);
      if (!emp) { alert('Elegí el empleado al que se le cobra.'); return; }
      conductor = emp.nombre;
    } else if (beneficiario_tipo === 'ninguno') {
      conductor = '';
    }
    if (acredita_cliente && !cliente_cod) { alert('Para acreditarle al cliente hay que elegirlo arriba.'); return; }
  } else if (!quienLoLlevo) {
    alert('El conductor es obligatorio.'); return;
  }

  // Cuotear: solo si hay a quién cobrarle, y solo en el alta.
  let cuotas_total = 1, monto_cuota = 0;
  if (esTipoCuoteable(tipo) && descItemEditId == null && beneficiario_tipo !== 'ninguno') {
    const chk = document.getElementById('mditem-cuotear');
    if (chk && chk.checked) {
      cuotas_total = parseInt(document.getElementById('mditem-cuotas').value) || 0;
      if (cuotas_total < 2) { alert('Para cuotear, ingresá 2 o más cuotas (o destildá "Cuotear").'); return; }
      monto_cuota = Math.round(monto / cuotas_total);
    }
  }

  const fecha = isoToDMY(iso);
  const fila = { tipo, conductor, fecha, fecha_date: fechaISOde(fecha), monto, referencia, detalle, cuotas_total, monto_cuota,
                 dano: dano || null, beneficiario_tipo, empleado_id, cliente_cod, acredita_cliente };

  try {
    let itemId = descItemEditId;
    if (descItemEditId != null) {
      // Edición: preservar el estado de autorización (no re-autorizar por editar).
      const prev = AppData.descItems.find(r => r.id === descItemEditId);
      fila.estado = (prev && prev.estado) || 'autorizado';
      fila.autorizado_por = (prev && prev.autorizado_por) || '';
      fila.autorizado_en = (prev && prev.autorizado_en) || '';
      await DB.updateWhere('descuentos_items', 'id', descItemEditId, fila);
      const i = AppData.descItems.findIndex(r => r.id === descItemEditId);
      if (i >= 0) AppData.descItems[i] = { id: descItemEditId, ...fila };
    } else {
      // Solo los EXTRAVÍOS pasan por autorización; beneficios (combustible/proveedores) directo.
      fila.estado = esExtravio ? estadoNuevaOperacion() : 'autorizado';
      const row = await DB.insertRow('descuentos_items', fila);
      itemId = row.id;
      AppData.descItems.push({ id: row.id, ...fila });
    }
    // El crédito al cliente se sincroniza DESPUÉS de tener el id: es un cargo
    // atado a este extravío, y si quedara suelto nadie podría explicarlo.
    let credito = null;
    if (esExtravio) credito = await _sincronizarCreditoExtravio(itemId);

    descItemEditId = null;
    document.getElementById('modal-descitem-backdrop').style.display = 'none';
    renderDescItems(tipo);
    const quien = beneficiario_tipo === 'ninguno' ? 'lo absorbe la empresa' : conductor;
    showToast((fila.estado === 'pendiente'
      ? '📋 ' + (danoLabel(dano) || 'Extravío') + ' cargado como PENDIENTE — falta que un supervisor lo autorice'
      : cuotas_total > 1
        ? '✅ ' + (danoLabel(dano) || cfg.label) + ' cuoteado: ' + fmtPeso(monto) + ' en ' + cuotas_total + ' cuotas de ' + fmtPeso(monto_cuota) + ' (' + quien + ')'
        : '✅ ' + (danoLabel(dano) || cfg.label) + ' guardado: ' + fmtPeso(monto) + ' (' + quien + ', ' + fecha + ')')
      + (credito ? ' · se le acreditaron ' + fmtPeso(monto) + ' a ' + clienteNombreDe(cliente_cod) : ''));
  } catch (e) {
    console.warn('guardarDescItemModal:', e);
    alert('No se pudo guardar: ' + (e.message || e));
  }
}

// ── El crédito al cliente ───────────────────────────────────────────────────
// Viaja como un cargo NEGATIVO y no como un número calculado al vuelo: así se
// imputa a un período concreto, el cliente lo VE discriminado en el PDF y el
// operador lo puede mover de factura cuando el reclamo llega tarde. Queda
// atado al extravío por `origen_item_id` para que los dos no se desincronicen:
// si cambia el monto o se saca el tilde, el cargo sigue.
function _cargoCreditoDe(itemId) {
  return (AppData.clienteCargos || []).find(c => c.origen_item_id === itemId) || null;
}
async function _sincronizarCreditoExtravio(itemId) {
  const x = (AppData.descItems || []).find(r => r.id === itemId);
  if (!x) return null;
  const ya = _cargoCreditoDe(itemId);
  const quiere = !!x.acredita_cliente && !!x.cliente_cod && _num(x.monto) > 0;

  if (!quiere) {
    if (ya) {
      try {
        await DB.deleteWhere('cliente_cargos', 'id', ya.id);
        AppData.clienteCargos = AppData.clienteCargos.filter(c => c.id !== ya.id);
        await _reabrirSiHaceFalta(ya.cliente_cod, ya.semana, 'se quitó el crédito por un envío ' + (danoLabel(x.dano) || '').toLowerCase());
      } catch (e) { console.warn('quitar crédito extravío:', e); }
    }
    return null;
  }

  const cod = clienteKey(x.cliente_cod);
  const isoEnvio = fechaISOde(x.fecha);
  const rango = (typeof periodoClienteRango === 'function') ? periodoClienteRango(cod, isoEnvio) : null;
  const semana = rango ? fechaISOde(rango.desde) : isoEnvio;
  const concepto = 'credito';
  const monto = -Math.abs(_num(x.monto));
  const detalleTxt = (danoLabel(x.dano) || 'Extravío') + (x.referencia ? ' · ' + x.referencia : '');
  const rec = { cliente_cod: cod, semana, concepto, fecha: isoEnvio, direccion: detalleTxt, zona: '',
                cantidad: 1, precio_unitario: monto, monto, origen_item_id: itemId,
                creado_por: (typeof _operadorActual === 'function' ? _operadorActual() : '') || '' };
  try {
    if (ya) {
      await DB.updateWhere('cliente_cargos', 'id', ya.id, rec);
      const i = AppData.clienteCargos.findIndex(c => c.id === ya.id);
      if (i >= 0) AppData.clienteCargos[i] = Object.assign({ id: ya.id }, rec);
    } else {
      const row = await DB.insertRow('cliente_cargos', rec);
      AppData.clienteCargos.push(Object.assign({ id: row && row.id }, rec));
    }
    await _reabrirSiHaceFalta(cod, semana, 'se le acreditó un envío ' + (danoLabel(x.dano) || '').toLowerCase());
    return rec;
  } catch (e) {
    console.warn('acreditar extravío al cliente:', e);
    // El extravío ya se guardó: avisar con alert y no con un toast, porque lo
    // que falta es plata que el cliente espera ver en su factura.
    alert('El extravío se guardó, pero NO se pudo acreditar al cliente: ' + (e.message || e));
    return null;
  }
}
// Una liquidación ya cerrada que ahora tiene un crédito más no está lista por
// definición: el tesorero bajaría un PDF que ya no coincide.
async function _reabrirSiHaceFalta(cod, semanaISO, queCambio) {
  if (typeof _reabrirPorCambio !== 'function' || typeof periodoClienteRango !== 'function') return;
  try { await _reabrirPorCambio(cod, periodoClienteRango(cod, semanaISO), queCambio); }
  catch (e) { console.warn('_reabrirSiHaceFalta', e); }
}

// ── Extravíos: el tracking sale de los envíos del conductor ─────────────────
// No se escribe: con el conductor, la fecha y el cliente se arma la lista de lo
// que llevó ese día y el operador elige. Tipeado a mano entra con un dígito de
// menos, no matchea ningún envío, y después no hay forma de saber qué se perdió.
function buscarTrackingsExtravio() {
  const cont = document.getElementById('mditem-track-aviso');
  const sel = document.getElementById('mditem-track-sel');
  if (!sel) return;
  const conductor = document.getElementById('mditem-conductor').value.trim();
  const cod = clienteKey((document.getElementById('mditem-cliente-sel') || {}).value || '');
  const iso = document.getElementById('mditem-fecha').value;
  const fechaDMY = iso ? isoToDMY(iso) : '';
  const manualWrap = document.getElementById('mditem-track-manual-wrap');

  if (!conductor) {
    descItemCandidatos = [];
    sel.innerHTML = '<option value="">— Poné el conductor para ver sus envíos —</option>';
    if (cont) cont.textContent = '';
    if (manualWrap) manualWrap.style.display = 'none';
    return;
  }
  // Por conductorKey y no por el texto crudo: el recorrido puede venir con un
  // alias o con otra grafía, y comparando el texto el conductor "no tendría"
  // ningún envío.
  const key = conductorKey(conductor);
  descItemCandidatos = (AppData.records || []).filter(r => {
    if (conductorKey(r.cadete) !== key) return false;
    if (fechaDMY && String(r.fecha || '').trim() !== fechaDMY) return false;
    if (cod && ((typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '') !== cod) return false;
    return !!(r.tracking || r.direccion);
  }).slice(0, 400);

  _pintarTrackingsSelect();
}

// Lo que se ve en el desplegable: los candidatos filtrados por lo que el
// operador va tipeando (tracking o destinatario).
function _pintarTrackingsSelect() {
  const sel = document.getElementById('mditem-track-sel');
  const cont = document.getElementById('mditem-track-aviso');
  const manualWrap = document.getElementById('mditem-track-manual-wrap');
  if (!sel) return;
  const q = String((document.getElementById('mditem-track-filtro') || {}).value || '').trim().toLowerCase();
  const vistos = descItemCandidatos
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !q ||
      String(r.tracking || '').toLowerCase().includes(q) ||
      String(r.destinatario || '').toLowerCase().includes(q));

  if (!descItemCandidatos.length) {
    sel.innerHTML = '<option value="">— Sin envíos de ese conductor —</option>';
    // La causa más común no es que no existan: es que ese día quedó fuera de la
    // ventana de días que la app tiene cargada. Decirlo evita que el operador
    // concluya que el envío se borró.
    if (cont) cont.innerHTML = '<span style="color:var(--warning)">No hay envíos cargados de ese conductor con esa fecha y ese cliente. ' +
      'Puede estar fuera de los días que la app tiene cargados (' +
      (typeof textoVentanaCargada === 'function' ? textoVentanaCargada() : 'ventana limitada') + ').</span>';
    if (manualWrap) manualWrap.style.display = '';
    return;
  }
  if (manualWrap && manualWrap.style.display !== 'none') {
    const tman = document.getElementById('mditem-track-manual');
    if (!tman || !tman.value.trim()) manualWrap.style.display = 'none';
  }
  if (!vistos.length) {
    sel.innerHTML = '<option value="">— Ninguno coincide con "' + _dEsc(q) + '" —</option>';
    if (cont) cont.textContent = descItemCandidatos.length + ' envío(s) ese día; ninguno coincide con lo tipeado.';
    return;
  }
  sel.innerHTML = '<option value="">— Elegí el envío (' + vistos.length + ') —</option>' +
    vistos.map(({ r, i }) => {
      const t = String(r.tracking || '').trim() || '(sin tracking)';
      const extra = [r.destinatario, r.zona || r.localidad, r.estado].filter(Boolean).join(' · ');
      return '<option value="' + i + '">' + _dEsc(t) + (extra ? ' — ' + _dEsc(extra) : '') + '</option>';
    }).join('');
  if (cont) cont.textContent = vistos.length + ' de ' + descItemCandidatos.length + ' envío(s) de ese conductor' +
    (q ? ' coinciden con lo tipeado' : '') + '.';
}

function seleccionarTrackingExtravio() {
  const r = _candidatoElegido();
  if (!r) return;
  // El envío dice de qué cliente es: si estaba en "todos", se completa solo.
  const cliSel = document.getElementById('mditem-cliente-sel');
  const cod = (typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '';
  if (cliSel && !cliSel.value && cod) { poblarClientesDescItem(cod); }
  const det = document.getElementById('mditem-detalle');
  if (det && !det.value.trim()) det.value = [r.destinatario, r.direccion].filter(Boolean).join(' · ');
  _pintarAvisoAcredita();
  // El monto queda en blanco a propósito: lo escribe el operador con el valor real del paquete.
  const mEl = document.getElementById('mditem-monto');
  if (mEl) mEl.focus();
}

// ── Extravíos: cuotear ──────────────────────────────────────────────────────
function toggleCuotearExtravio() {
  const chk = document.getElementById('mditem-cuotear');
  const wrap = document.getElementById('mditem-cuotas-wrap');
  if (wrap) wrap.style.display = (chk && chk.checked) ? 'flex' : 'none';
  actualizarPreviewCuotaExtravio();
}

function actualizarPreviewCuotaExtravio() {
  const chk = document.getElementById('mditem-cuotear');
  const prev = document.getElementById('mditem-cuota-preview');
  if (!prev) return;
  const monto = parseFloat(document.getElementById('mditem-monto').value) || 0;
  const cuotas = parseInt(document.getElementById('mditem-cuotas').value) || 0;
  prev.textContent = (chk && chk.checked && monto > 0 && cuotas >= 2)
    ? 'Cada cuota: ' + fmtPeso(Math.round(monto / cuotas)) + '  ×  ' + cuotas + ' cuotas'
    : '';
}

// ── Cuotas (imputadas a la liquidación de su semana) ────────────────────────
// Se pueden cuotear los saldos que el conductor devuelve de a poco: extravíos y
// servicios de proveedores. Combustible y km se imputan enteros.

function fechaSemanaExtravio() {
  const iso = document.getElementById('extravios-fecha')?.value || hoyISO();
  return isoToDMY(iso);
}

async function descontarCuotaExtravio(itemId) {
  const it = AppData.descItems.find(x => x.id === itemId && esTipoCuoteable(x.tipo));
  if (!it) return;
  if (!esAutorizado(it)) { showToast('⏳ Pendiente de autorización — no se puede imputar todavía'); return; }
  if (descItemSaldado(it)) { showToast('Ese saldo ya está saldado'); return; }
  const nro = descItemCuotasPagadas(it.id) + 1;
  const fecha = fechaSemanaExtravio();
  if (!confirm('¿Descontar la cuota ' + nro + '/' + it.cuotas_total + ' (' + fmtPeso(it.monto_cuota) + ') de ' + it.conductor + ' en la semana del ' + fecha + '?\nAparecerá en su liquidación de esa fecha.')) return;
  try {
    const row = await DB.insertRow('descuento_cuotas', { item_id: itemId, nro, monto: it.monto_cuota, fecha, fecha_date: fechaISOde(fecha) });
    AppData.descItemCuotas.push({ id: row.id, item_id: itemId, nro, monto: it.monto_cuota, fecha });
    renderDescItems(it.tipo);
    showToast('✅ Cuota ' + nro + '/' + it.cuotas_total + ' de ' + it.conductor + ' descontada (' + fecha + ')');
  } catch (e) { console.warn('descontarCuotaExtravio:', e); showToast('⛔ No se pudo registrar la cuota'); }
}

async function descontarCuotaSemanalExtravios() {
  const activos = AppData.descItems.filter(x => x.tipo === 'extraviados' && _num(x.cuotas_total) > 1 && !descItemSaldado(x) && esAutorizado(x));
  if (!activos.length) { showToast('No hay extravíos cuoteados activos autorizados'); return; }
  const fecha = fechaSemanaExtravio();
  if (!confirm('¿Descontar una cuota a los ' + activos.length + ' extravíos cuoteados activos en la semana del ' + fecha + '?')) return;
  let ok = 0;
  for (const it of activos) {
    const nro = descItemCuotasPagadas(it.id) + 1;
    try {
      const row = await DB.insertRow('descuento_cuotas', { item_id: it.id, nro, monto: it.monto_cuota, fecha, fecha_date: fechaISOde(fecha) });
      AppData.descItemCuotas.push({ id: row.id, item_id: it.id, nro, monto: it.monto_cuota, fecha });
      ok++;
    } catch (e) { console.warn('cuota masiva extravío', it.conductor, e); }
  }
  renderDescItems('extraviados');
  showToast('✅ ' + ok + ' cuota(s) descontadas para la semana del ' + fecha);
}

async function deshacerUltimaCuotaExtravio(itemId) {
  const cuotas = descItemCuotasDe(itemId).sort((a, b) => b.nro - a.nro);
  if (!cuotas.length) { showToast('No hay cuotas para deshacer'); return; }
  const ult = cuotas[0];
  if (!confirm('¿Deshacer la cuota ' + ult.nro + ' (' + fmtPeso(ult.monto) + ', semana del ' + ult.fecha + ')?')) return;
  try {
    await DB.deleteWhere('descuento_cuotas', 'id', ult.id);
    AppData.descItemCuotas = AppData.descItemCuotas.filter(c => c.id !== ult.id);
    verHistorialExtravio(itemId);
    renderDescItems('extraviados');
    showToast('↩ Cuota deshecha');
  } catch (e) { console.warn('deshacerUltimaCuotaExtravio:', e); showToast('⛔ No se pudo deshacer'); }
}

function verHistorialExtravio(itemId) {
  const it = AppData.descItems.find(x => x.id === itemId);
  if (!it) return;
  const cuotas = descItemCuotasDe(itemId);
  document.getElementById('modal-title').textContent = 'Extravío cuoteado · ' + it.conductor;
  const filas = [];
  for (let i = 1; i <= it.cuotas_total; i++) {
    const c = cuotas.find(x => x.nro === i);
    filas.push('<tr><td class="mono">' + i + '/' + it.cuotas_total + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(c ? c.monto : it.monto_cuota) + '</td>' +
      '<td>' + (c ? '<span class="badge badge-green"><i class="ic ic-check"></i> Descontada</span>' : '<span class="badge badge-gray">Pendiente</span>') + '</td>' +
      '<td class="mono muted">' + (c ? c.fecha : '—') + '</td></tr>');
  }
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">' +
      '<div>Tracking: <strong>' + (it.referencia || '—') + '</strong></div>' +
      '<div>Total: <strong>' + fmtPeso(it.monto) + '</strong></div>' +
      '<div>Cuota: <strong>' + fmtPeso(it.monto_cuota) + '</strong></div>' +
      '<div>Pagadas: <strong>' + descItemCuotasPagadas(itemId) + '/' + it.cuotas_total + '</strong></div>' +
      '<div>Saldo: <strong style="color:' + (descItemSaldo(it) > 0 ? '#b45309' : '#166534') + '">' + fmtPeso(descItemSaldo(it)) + '</strong></div>' +
    '</div>' +
    (it.detalle ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">📝 ' + it.detalle + '</div>' : '') +
    '<div class="table-wrap" style="max-height:46vh;overflow:auto"><table><thead><tr><th>Cuota</th><th style="text-align:right">Monto</th><th>Estado</th><th>Semana</th></tr></thead><tbody>' + filas.join('') + '</tbody></table></div>' +
    (descItemCuotasPagadas(itemId) ? '<div style="margin-top:10px;text-align:right"><button class="btn btn-sm" style="color:#b91c1c;border-color:#fca5a5" onclick="deshacerUltimaCuotaExtravio(' + itemId + ')"><i class="ic ic-undo"></i> Deshacer última cuota</button></div>' : '');
  document.getElementById('modal-backdrop').classList.add('open');
}

async function eliminarDescItem(tipo, id) {
  const x = AppData.descItems.find(r => r.id === id && r.tipo === tipo);
  if (!x) return;
  const credito = _cargoCreditoDe(id);
  const quien = x.conductor || 'la empresa';
  if (!confirm('¿Eliminar este descuento de ' + quien + ' (' + fmtPeso(_num(x.monto)) + ', ' + x.fecha + ')?' +
      (credito ? String.fromCharCode(10,10) + 'También se le quita el crédito de ' + fmtPeso(Math.abs(_num(credito.monto))) +
        ' que tiene ' + clienteNombreDe(credito.cliente_cod) + ' en su liquidación.' : ''))) return;
  try {
    // El crédito primero: si se borra el extravío y después falla esto, al
    // cliente le queda una nota de crédito sin nada que la explique.
    if (credito) {
      await DB.deleteWhere('cliente_cargos', 'id', credito.id);
      AppData.clienteCargos = AppData.clienteCargos.filter(c => c.id !== credito.id);
      await _reabrirSiHaceFalta(credito.cliente_cod, credito.semana, 'se borró el crédito por un envío ' + (danoLabel(x.dano) || '').toLowerCase());
    }
    await DB.deleteWhere('descuentos_items', 'id', id);
    AppData.descItems = AppData.descItems.filter(r => r.id !== id);
    renderDescItems(tipo);
    showToast('🗑 Registro eliminado' + (credito ? ' · y su crédito al cliente' : ''));
  } catch (e) { console.warn('eliminarDescItem:', e); showToast('⛔ No se pudo eliminar'); }
}

async function limpiarDescItems(tipo) {
  const cfg = DESC_ITEMS[tipo];
  const ids = AppData.descItems.filter(x => x.tipo === tipo).map(x => x.id);
  if (!ids.length) { showToast('No hay registros para limpiar'); return; }
  if (!confirm('¿Eliminar TODOS los registros de ' + cfg.label + '? (' + ids.length + ' registros)')) return;
  try {
    await DB.deleteIn('descuentos_items', 'id', ids);
    AppData.descItems = AppData.descItems.filter(x => x.tipo !== tipo);
    renderDescItems(tipo);
    showToast('🗑 Todos los registros de ' + cfg.label + ' eliminados');
  } catch (e) { console.warn('limpiarDescItems:', e); showToast('⛔ No se pudo limpiar'); }
}

// ── Plantilla Excel + importación (append) ──────────────────────────────────
function descargarPlantillaDescItems(tipo) {
  const cfg = DESC_ITEMS[tipo];
  const ncol = cfg.headers.length;
  const placeholder = Array(ncol).fill('');
  placeholder[0] = 'NOMBRE APELLIDO';
  const aoa = [
    ['⚠ NO MODIFIQUES NI REORDENES LOS ENCABEZADOS DE LA FILA 2. Completá los datos a partir de la fila 3 (una fila por descuento). Fecha en formato DD/MM/AAAA — define a qué liquidación se imputa.'],
    cfg.headers,
    ...cfg.ejemplos,
    placeholder.slice(), placeholder.slice(), placeholder.slice(), placeholder.slice(), placeholder.slice(),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cfg.headers.map((h, i) => ({ wch: i === 0 ? 26 : (h.length > 12 ? 22 : 14) }));
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ncol - 1 } }];
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!sheetPr'] = { pane: { ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 28));
  XLSX.writeFile(wb, 'Plantilla_' + cfg.label.replace(/[^A-Za-z]/g, '_') + '.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importDescItems(tipo, event) {
  const cfg = DESC_ITEMS[tipo];
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

      // Detectar la fila de encabezados (exige la columna "Conductor").
      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('conductor') || cells.includes('cadete') || cells.includes('nombre')) { headerRowIdx = r; break; }
      }
      if (headerRowIdx < 0) { alert('No se encontró una fila de encabezados válida (falta la columna "Conductor").\nDescargá la plantilla oficial.'); return; }

      const header = rows[headerRowIdx].map(h => String(h).toLowerCase().trim());
      const idx = {
        conductor: header.findIndex(h => h.includes('conductor') || h.includes('cadete') || h.includes('nombre')),
        fecha:     header.findIndex(h => h.includes('fecha')),
        monto:     header.findIndex(h => h.includes('monto') || h.includes('importe') || h.includes('valor')),
        ref:       cfg.refLabel ? header.findIndex(h => h.includes('tracking') || h.includes('envio') || h.includes('envío') || h.includes('proveedor')) : -1,
        detalle:   header.findIndex(h => h.includes('detalle') || h.includes('observ') || h.includes('nota') || h.includes('comentar')),
      };
      if (idx.conductor < 0) { alert('No se encontró la columna "Conductor".'); return; }

      const parseNum = v => {
        if (v === '' || v == null) return 0;
        if (typeof v === 'number') return v;
        const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? 0 : n;
      };
      const parseFechaCell = v => {
        if (v instanceof Date) {
          return String(v.getDate()).padStart(2, '0') + '/' + String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear();
        }
        const s = String(v || '').trim();
        const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + y; }
        return '';
      };

      // Índice de duplicados exactos ya existentes (conductor|fecha|monto|ref).
      const claveDup = r => [r.conductor, r.fecha, _num(r.monto), r.referencia || ''].join('|');
      const yaExisten = new Set(AppData.descItems.filter(x => x.tipo === tipo).map(claveDup));

      const nuevos = [];
      let salteados = 0;
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const conductor = String(r[idx.conductor] || '').trim().toUpperCase();
        if (!conductor || conductor === 'NOMBRE APELLIDO') continue;
        const monto = idx.monto >= 0 ? parseNum(r[idx.monto]) : 0;
        if (monto <= 0) continue;
        const fecha = idx.fecha >= 0 ? parseFechaCell(r[idx.fecha]) : '';
        const referencia = idx.ref >= 0 ? String(r[idx.ref] || '').trim() : '';
        const detalle = idx.detalle >= 0 ? String(r[idx.detalle] || '').trim() : '';
        const fila = { tipo, conductor, fecha, fecha_date: fechaISOde(fecha), monto, referencia, detalle,
          estado: (tipo === 'extraviados') ? estadoNuevaOperacion() : 'autorizado' };
        if (yaExisten.has(claveDup(fila))) { salteados++; continue; }
        yaExisten.add(claveDup(fila));
        nuevos.push(fila);
      }

      if (!nuevos.length) {
        alert('No se importó ningún registro nuevo' + (salteados ? ' (' + salteados + ' duplicados exactos salteados).' : ' válido.'));
        return;
      }

      const ids = await DB.insertRows('descuentos_items', nuevos);
      nuevos.forEach((n, k) => AppData.descItems.push({
        id: ids[k], tipo: n.tipo, conductor: n.conductor, fecha: n.fecha,
        monto: n.monto, referencia: n.referencia, detalle: n.detalle
      }));
      renderDescItems(tipo);
      showToast('✅ Importados ' + nuevos.length + ' registros de ' + cfg.label +
        (salteados ? ' · ' + salteados + ' duplicados salteados' : ''));
    } catch (err) {
      console.error(err);
      alert('Error al importar: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ════════════════════════════════════════════════════════════════════════
//  PROVEEDORES DE SERVICIO (lista cerrada)
//  El proveedor se elige, no se escribe: escrito a mano el mismo proveedor
//  entra como "Ruedas Bojanich", "ruedas bojanich" y "R. Bojanich", y después
//  no hay forma de saber cuánto se le pagó a cada uno.
// ════════════════════════════════════════════════════════════════════════
function abrirGestionProveedores() {
  document.getElementById('modal-prov-backdrop').style.display = 'flex';
  renderProveedores();
  setTimeout(() => document.getElementById('mprov-nombre')?.focus(), 60);
}

function cerrarGestionProveedores(e) {
  if (!e || e.target.id === 'modal-prov-backdrop') {
    document.getElementById('modal-prov-backdrop').style.display = 'none';
    // Al volver, el desplegable del alta refleja los cambios.
    if (descItemModalTipo === 'proveedores') poblarProveedoresSelect(_valorReferenciaModal('proveedores'));
  }
}

function renderProveedores() {
  const cont = document.getElementById('mprov-lista');
  if (!cont) return;
  const lista = (AppData.proveedores || []).slice()
    .sort((a, b) => (a.activo === b.activo ? String(a.nombre).localeCompare(String(b.nombre)) : (a.activo === false ? 1 : -1)));
  if (!lista.length) {
    cont.innerHTML = '<div class="muted" style="text-align:center;padding:18px;font-size:12px">Todavía no hay proveedores cargados</div>';
    return;
  }
  cont.innerHTML = lista.map(p => {
    // Cuánto se le pagó: sirve para decidir si conviene darlo de baja.
    const items = (AppData.descItems || []).filter(x => x.tipo === 'proveedores' && normNombre(x.referencia) === normNombre(p.nombre));
    const total = items.reduce((s, x) => s + _num(x.monto), 0);
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border)' +
        (p.activo === false ? ';opacity:.55' : '') + '">' +
      '<div class="conductor-avatar" style="background:' + avatarColor(p.nombre) + ';width:28px;height:28px;font-size:10px">' + initials(p.nombre) + '</div>' +
      '<div style="min-width:0;flex:1">' +
        '<div style="font-size:13px;font-weight:600">' + p.nombre +
          (p.activo === false ? ' <span class="badge" style="background:#fee2e2;color:#b91c1c;font-size:9px">dado de baja</span>' : '') + '</div>' +
        '<div style="font-size:10.5px;color:var(--text-muted)">' +
          [p.rubro, p.telefono].filter(Boolean).join(' · ') +
          (items.length ? (p.rubro || p.telefono ? ' · ' : '') + items.length + ' servicio(s) · ' + fmtPeso(total) : '') +
        '</div>' +
      '</div>' +
      (p.activo === false
        ? '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px" onclick="reactivarProveedor(' + p.id + ')">Reactivar</button>'
        : '<button class="btn btn-sm" style="padding:3px 7px;font-size:10px;border-color:#fca5a5;color:#b91c1c" onclick="bajaProveedor(' + p.id + ')" title="Deja de ofrecerse al cargar servicios; los ya cargados se conservan">Dar de baja</button>') +
    '</div>';
  }).join('');
}

async function agregarProveedor() {
  const nombre = (document.getElementById('mprov-nombre').value || '').trim();
  const rubro = (document.getElementById('mprov-rubro').value || '').trim();
  const telefono = (document.getElementById('mprov-telefono').value || '').trim();
  if (!nombre) { alert('Escribí el nombre del proveedor.'); return; }
  const dup = (AppData.proveedores || []).find(p => normNombre(p.nombre) === normNombre(nombre));
  if (dup) {
    if (dup.activo === false) { await reactivarProveedor(dup.id); return; }
    alert('"' + dup.nombre + '" ya está en la lista.');
    return;
  }
  try {
    const row = await DB.insertRow('proveedores', { nombre, rubro, telefono, obs: '', activo: true });
    AppData.proveedores.push({ id: row.id, nombre, rubro, telefono, obs: '', activo: true });
    ['mprov-nombre', 'mprov-rubro', 'mprov-telefono'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderProveedores();
    showToast('✅ ' + nombre + ' agregado');
    document.getElementById('mprov-nombre')?.focus();
  } catch (e) { console.warn('agregarProveedor:', e); alert('No se pudo agregar: ' + (e.message || e)); }
}

// Baja lógica: los servicios ya cargados a ese proveedor se conservan.
async function bajaProveedor(id) {
  const p = (AppData.proveedores || []).find(x => x.id === id);
  if (!p) return;
  if (!confirm('¿Dar de baja a ' + p.nombre + '?\nDeja de aparecer al cargar servicios nuevos; los ya cargados se conservan.')) return;
  try {
    await DB.updateWhere('proveedores', 'id', id, { activo: false });
    p.activo = false;
    renderProveedores();
    showToast('Proveedor dado de baja');
  } catch (e) { console.warn('bajaProveedor:', e); showToast('⛔ No se pudo dar de baja'); }
}

async function reactivarProveedor(id) {
  const p = (AppData.proveedores || []).find(x => x.id === id);
  if (!p) return;
  try {
    await DB.updateWhere('proveedores', 'id', id, { activo: true });
    p.activo = true;
    renderProveedores();
    showToast('✅ ' + p.nombre + ' reactivado');
  } catch (e) { console.warn('reactivarProveedor:', e); showToast('⛔ No se pudo reactivar'); }
}
