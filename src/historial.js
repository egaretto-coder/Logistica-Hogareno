// ════════════════════════════════════════════════════════════════════════
//  HISTORIAL DE LIQUIDACIONES — conductores y clientes
//  Los dos paneles de liquidación trabajan sobre UNA semana: son la herramienta
//  del día de pago. Lo que ya se pagó y lo que ya se facturó no se podía
//  consultar en ningún lado, y al ARCHIVAR los envíos desaparecía de la
//  pantalla —el panel recalcula desde los registros vivos—. Acá se listan las
//  liquidaciones cerradas, por mes, con lo que salió de cada una, y el PDF se
//  rearma del DETALLE CONGELADO (`liquidacion_detalle`): es el mismo papel que
//  se descargó ese día aunque los envíos ya estén archivados y el tarifario
//  haya cambiado —las tarifas de conductor no tienen vigencia, así que
//  recalcular una semana vieja con el tarifario de hoy da otro número—.
//
//  Va como SOLAPA de cada panel y NO como pantalla nueva: así hereda los
//  permisos que el panel ya tiene. Una pantalla nueva hay que habilitarla rol
//  por rol en Gestión de permisos, y un rol que ya tiene filas en `rol_permisos`
//  no hereda las nuevas: el tesorero se habría quedado sin verla.
// ════════════════════════════════════════════════════════════════════════

let histTab = { conductor: 'semana', cliente: 'semana' };
// El detalle se trae de a uno y se recuerda: abrir la ficha y después el PDF
// del mismo son dos idas a la nube por el mismo dato.
const _histCache = new Map();

function _histMesInicial() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function _histEsConductor(tipo) { return tipo === 'conductor'; }
function _histId(tipo, sufijo) { return (_histEsConductor(tipo) ? 'liq' : 'cliq') + '-hist-' + sufijo; }
function _histVal(tipo, sufijo) {
  const el = document.getElementById(_histId(tipo, sufijo));
  return el ? el.value : '';
}

// Solapas de cada panel. El render de la semana ya existe en cada uno.
function switchLiqTab(tab) { _histSwitch('conductor', tab); }
function switchCliqTab(tab) { _histSwitch('cliente', tab); }
function _histSwitch(tipo, tab) {
  histTab[tipo] = (tab === 'historial') ? 'historial' : 'semana';
  const pre = _histEsConductor(tipo) ? 'liq' : 'cliq';
  ['semana', 'historial'].forEach(t => {
    const panel = document.getElementById(pre + '-tab-' + t);
    const btn = document.getElementById(pre + '-btn-' + t);
    if (panel) panel.style.display = (t === histTab[tipo]) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === histTab[tipo]);
  });
  // Los controles que son de la solapa SEMANA se esconden en el Historial: un
  // botón que dice "Descargar las 0 listas" mientras abajo hay 427 liquidaciones
  // se lee como que el historial está vacío.
  ['acciones-semana', 'acciones-descarga'].forEach(k => {
    const el = document.getElementById(pre + '-' + k);
    if (el) el.style.display = (histTab[tipo] === 'historial') ? 'none' : 'flex';
  });
  if (histTab[tipo] === 'historial') {
    const mes = document.getElementById(_histId(tipo, 'mes'));
    if (mes && !mes.value) mes.value = _histMesInicial();
    renderHistorial(tipo);
  } else if (_histEsConductor(tipo)) {
    if (typeof renderLiquidaciones === 'function') renderLiquidaciones();
  } else if (typeof renderClienteLiquidaciones === 'function') {
    renderClienteLiquidaciones();
  }
}

// Las liquidaciones cerradas de ese lado, filtradas por mes y por el buscador.
// El mes se cruza con el PERÍODO: una semana que empieza en un mes y termina en
// el otro aparece en los dos, porque en los dos es cierta —lo contrario sería
// que la semana del 28/09 no figure en ningún lado.
function histLiquidaciones(tipo) {
  // Con un cliente elegido el mes y el buscador NO se aplican: el caso es "me
  // reclaman una factura vieja" y nadie sabe de qué mes era. Filtrar por el mes
  // en curso la escondería y parecería que esa liquidación no existe.
  const sel = _histClaveSel(tipo);
  const mes = sel ? '' : _histVal(tipo, 'mes');
  const q = sel ? '' : String(_histVal(tipo, 'search') || '').toLowerCase().trim();
  const filas = (_histEsConductor(tipo) ? (AppData.conductorLiquidaciones || []) : (AppData.clienteLiquidaciones || []))
    .map(x => {
      const clave = _histEsConductor(tipo) ? (x.conductor || '') : (x.cliente_cod || '');
      const nombre = _histEsConductor(tipo) ? clave
        : (typeof clienteNombreDe === 'function' ? clienteNombreDe(clave) : clave);
      return {
        id: x.id, clave, nombre,
        desde: String(x.semana_desde || '').slice(0, 10),
        hasta: String(x.semana_hasta || '').slice(0, 10),
        monto: _num(x.monto), bruto: _num(x.bruto), envios: _num(x.envios),
        tieneDetalle: !!x.tiene_detalle,
        armada_por: x.armada_por || '', armada_en: x.armada_en || ''
      };
    })
    .filter(x => !sel || x.clave === sel)
    .filter(x => !mes || (x.desde.slice(0, 7) === mes || x.hasta.slice(0, 7) === mes))
    .filter(x => !q || x.nombre.toLowerCase().includes(q) || x.clave.toLowerCase().includes(q));
  return filas.sort((a, b) => b.desde.localeCompare(a.desde) || b.monto - a.monto);
}

// ── EL HISTORIAL DE UNO SOLO ────────────────────────────────────────────
// La pregunta de este panel no es solo "qué se cerró este mes": es "el cliente
// llama preguntando por una factura de hace cuatro meses". Para eso hay que
// poder ELEGIRLO y ver todo lo suyo de una, con la fecha en que se armó, el
// período, lo facturado y el PDF a mano. La tabla cruzada por mes obligaba a
// adivinar el mes y a buscarlo entre 427 filas.
function _histEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
function _histClaveSel(tipo) { return String(_histVal(tipo, 'cliente') || ''); }

// Quiénes tienen liquidaciones cerradas, con cuántas tiene cada uno. Solo esos:
// ofrecer el padrón entero haría buscar entre clientes que no cerraron nada.
function _histConLiquidaciones(tipo) {
  const esCond = _histEsConductor(tipo);
  const filas = esCond ? (AppData.conductorLiquidaciones || []) : (AppData.clienteLiquidaciones || []);
  const m = new Map();
  filas.forEach(x => {
    const clave = esCond ? (x.conductor || '') : (x.cliente_cod || '');
    if (!clave) return;
    let o = m.get(clave);
    if (!o) {
      o = { clave, n: 0,
            nombre: esCond ? clave : (typeof clienteNombreDe === 'function' ? clienteNombreDe(clave) : clave) };
      m.set(clave, o);
    }
    o.n++;
  });
  return Array.from(m.values()).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
}

// El selector CONSERVA lo elegido: lo repinta el re-render de la sincronización
// en vivo, y reconstruirlo en blanco le sacaría al operador el cliente que está
// mirando — el mismo criterio que renderConductorSelect() con el conductor.
function _histPoblarSelector(tipo) {
  const sel = document.getElementById(_histId(tipo, 'cliente'));
  if (!sel) return;
  const lista = _histConLiquidaciones(tipo);
  const firma = lista.map(x => x.clave + ':' + x.n).join('|');
  if (sel.dataset.firma === firma) return;
  const actual = sel.value;
  sel.dataset.firma = firma;
  sel.innerHTML = '<option value="">Todos los ' + (_histEsConductor(tipo) ? 'conductores' : 'clientes') + '</option>' +
    lista.map(x => '<option value="' + _histEsc(x.clave) + '">' + _histEsc(x.nombre) + ' (' + x.n + ')</option>').join('');
  sel.value = actual;   // si ya no está en la lista, queda en "todos"
}

function _histVerTodos(tipo) {
  const sel = document.getElementById(_histId(tipo, 'cliente'));
  if (sel) sel.value = '';
  renderHistorial(tipo);
}

// Los años y los MESES se pliegan: un año de semanas son 52 filas, y la pregunta
// que se hace acá es "la factura de septiembre", no "las 52 del año". Arrancan
// abiertos el año más nuevo y, dentro de cada año que se abre, su mes más nuevo.
const _histAnios = {};
const _histMesesAbiertos = {};
function _histAnioAbierto(tipo, anio, i) {
  const k = tipo + '|' + anio;
  return (k in _histAnios) ? _histAnios[k] : (i === 0);
}
function _histToggleAnio(tipo, anio, i) {
  _histAnios[tipo + '|' + anio] = !_histAnioAbierto(tipo, anio, i);
  renderHistorial(tipo);
}
function _histMesAbierto(tipo, ym, i) {
  const k = tipo + '|' + ym;
  return (k in _histMesesAbiertos) ? _histMesesAbiertos[k] : (i === 0);
}
function _histToggleMes(tipo, ym, i) {
  _histMesesAbiertos[tipo + '|' + ym] = !_histMesAbierto(tipo, ym, i);
  renderHistorial(tipo);
}
const _HIST_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function _histMesNombre(mm) { return _HIST_MESES[(+mm) - 1] || mm; }

// La fecha de armado con AÑO: en el historial se miran liquidaciones viejas y
// "02/10 09:19" no dice de qué año es.
function _histFmtCuandoLargo(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' +
    d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Todo el historial de uno, agrupado por año y de lo más nuevo a lo más viejo.
function _histVistaDeUno(tipo, clave, filas) {
  const esCond = _histEsConductor(tipo);
  const nombre = esCond ? clave : (typeof clienteNombreDe === 'function' ? clienteNombreDe(clave) : clave);
  const volver = '<button class="btn btn-sm" onclick="_histVerTodos(\'' + tipo + '\')">' +
    '<i class="ic ic-undo"></i> Ver todos los ' + (esCond ? 'conductores' : 'clientes') + '</button>';
  if (!filas.length) {
    return '<div class="card"><div class="empty-state"><div class="empty-icon"><i class="ic ic-file"></i></div>' +
      '<div class="empty-title">' + _histEsc(nombre) + ' no tiene liquidaciones cerradas</div>' +
      '<div class="empty-sub">Acá aparecen las que se marcan como listas.</div>' +
      '<div style="margin-top:12px">' + volver + '</div></div></div>';
  }
  const orden = filas.slice().sort((a, b) => String(b.desde).localeCompare(String(a.desde)));
  const total = orden.reduce((s, x) => s + x.monto, 0);
  const envios = orden.reduce((s, x) => s + x.envios, 0);
  const vieja = orden[orden.length - 1], nueva = orden[0];

  let html = '<div class="card" style="margin-bottom:12px"><div class="card-body" ' +
    'style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
    '<div class="conductor-avatar" style="background:' + avatarColor(nombre) + ';width:42px;height:42px;font-size:14px">' +
      initials(nombre) + '</div>' +
    '<div style="min-width:0;flex:1">' +
      '<div style="font-size:16px;font-weight:700">' + _histEsc(nombre) + '</div>' +
      '<div style="font-size:11.5px;color:var(--text-muted)">' + orden.length + ' liquidación(es) · ' +
        'de ' + _histFmtFecha(vieja.desde) + ' a ' + _histFmtFecha(nueva.hasta) + ' · ' +
        envios.toLocaleString('es-AR') + ' envíos</div>' +
    '</div>' +
    '<div style="text-align:right">' +
      '<div style="font-size:10.5px;color:var(--text-muted);letter-spacing:.04em">' +
        (esCond ? 'PAGADO EN TOTAL' : 'FACTURADO EN TOTAL') + '</div>' +
      '<div class="mono" style="font-size:18px;font-weight:700">' + fmtPeso(total) + '</div>' +
    '</div>' + volver +
  '</div></div>';

  // Año → mes → liquidaciones. El período es lo que ubica a la liquidación, así
  // que manda la fecha en que ABRE: una semana que cruza de mes pertenece al mes
  // en que empezó, igual que la factura.
  const porAnio = new Map();
  orden.forEach(x => {
    const ym = String(x.desde || x.hasta || '').slice(0, 7);
    const a = ym.slice(0, 4) || '—';
    if (!porAnio.has(a)) porAnio.set(a, new Map());
    const meses = porAnio.get(a);
    if (!meses.has(ym)) meses.set(ym, []);
    meses.get(ym).push(x);
  });
  const chevron = ab => '<i class="ic ic-chevrons-down" style="transition:transform .15s' +
    (ab ? '' : ';transform:rotate(-90deg)') + '"></i>';

  Array.from(porAnio.keys()).forEach((anio, i) => {
    const meses = porAnio.get(anio);
    const delAnio = Array.from(meses.values()).reduce((s, g) => s.concat(g), []);
    const abierto = _histAnioAbierto(tipo, anio, i);
    const sub = delAnio.reduce((s, x) => s + x.monto, 0);
    html += '<div class="card" style="margin-bottom:10px">' +
      '<button onclick="_histToggleAnio(\'' + tipo + '\',\'' + anio + '\',' + i + ')" ' +
        'style="width:100%;display:flex;align-items:center;gap:10px;padding:12px 16px;background:none;' +
        'border:0;border-radius:var(--radius);cursor:pointer;text-align:left;font:inherit;color:inherit">' +
        chevron(abierto) +
        '<strong style="font-size:14px">' + anio + '</strong>' +
        '<span style="font-size:12px;color:var(--text-muted)">' + delAnio.length + ' liquidación(es) · ' +
          meses.size + ' mes(es)</span>' +
        '<span class="mono" style="margin-left:auto;font-weight:700">' + fmtPeso(sub) + '</span>' +
      '</button>' +
      '<div style="display:' + (abierto ? '' : 'none') + '">' +
      Array.from(meses.keys()).map((ym, j) => {
        const grupo = meses.get(ym);
        const abM = _histMesAbierto(tipo, ym, j);
        const subM = grupo.reduce((s, x) => s + x.monto, 0);
        return '<div style="border-top:1px solid var(--border)">' +
          '<button onclick="_histToggleMes(\'' + tipo + '\',\'' + ym + '\',' + j + ')" ' +
            'style="width:100%;display:flex;align-items:center;gap:10px;padding:9px 16px 9px 30px;background:none;' +
            'border:0;cursor:pointer;text-align:left;font:inherit;color:inherit">' +
            chevron(abM) +
            '<span style="font-size:13px;font-weight:600;text-transform:capitalize">' + _histMesNombre(ym.slice(5, 7)) + '</span>' +
            '<span style="font-size:11.5px;color:var(--text-muted)">' + grupo.length + ' liquidación(es)</span>' +
            '<span class="mono" style="margin-left:auto;font-size:12.5px;font-weight:600">' + fmtPeso(subM) + '</span>' +
          '</button>' +
          '<div style="display:' + (abM ? '' : 'none') + '"><div class="table-wrap"><table>' +
          '<thead><tr><th>Período</th><th>Armada</th><th style="text-align:right">Envíos</th>' +
            '<th style="text-align:right">' + (esCond ? 'Neto pagado' : 'Facturado') + '</th>' +
            '<th style="width:160px"></th></tr></thead><tbody>' +
          grupo.map(x => {
            const esc = jsAttr(x.clave);
            return '<tr>' +
              '<td style="font-size:12.5px;font-weight:600;white-space:nowrap">' + _histFmtFecha(x.desde) + ' → ' + _histFmtFecha(x.hasta) +
                (x.tieneDetalle ? '' : '<div style="font-size:10.5px;font-weight:400;color:var(--warning)">solo consta el total</div>') + '</td>' +
              '<td style="font-size:11.5px;color:var(--text-muted)">' + (x.armada_por ? _histEsc(x.armada_por) : '—') +
                (x.armada_en ? '<div>' + _histFmtCuandoLargo(x.armada_en) + '</div>' : '') + '</td>' +
              '<td class="mono" style="text-align:right">' + (x.envios ? x.envios.toLocaleString('es-AR') : (x.tieneDetalle ? '0' : '—')) + '</td>' +
              '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.monto) +
                (esCond && x.bruto ? '<div style="font-size:10.5px;font-weight:400;color:var(--text-muted)">bruto ' + fmtPeso(x.bruto) + '</div>' : '') + '</td>' +
              '<td style="text-align:right;white-space:nowrap">' +
                '<button class="btn btn-sm" onclick="verDetalleLiq(\'' + tipo + '\',\'' + esc + '\',\'' + x.desde + '\')" title="Ver lo que consta de esta liquidación"><i class="ic ic-search"></i> Ver</button>' +
                // Sin snapshot NO se ofrece el PDF: rearmarlo sería recalcular con
                // los datos de hoy y saldría con el formato del original sin serlo.
                (x.tieneDetalle
                  ? ' <button class="btn btn-sm" onclick="pdfDesdeHistorial(\'' + tipo + '\',\'' + esc + '\',\'' + x.desde + '\')" title="El mismo PDF que se descargó ese día"><i class="ic ic-download"></i> PDF</button>'
                  : '') +
              '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div></div></div>';
      }).join('') +
      '</div></div>';
  });
  return html;
}

function _histFmtFecha(iso) {
  if (!iso) return '—';
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}
function _histFmtCuando(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function renderHistorial(tipo) {
  const body = document.getElementById(_histId(tipo, 'rows'));
  if (!body) return;
  _histPoblarSelector(tipo);
  const esCond = _histEsConductor(tipo);
  const sel = _histClaveSel(tipo);
  const filas = histLiquidaciones(tipo);
  const mes = sel ? '' : _histVal(tipo, 'mes');
  const q = sel ? '' : String(_histVal(tipo, 'search') || '').trim();

  // Con uno elegido, el mes y el buscador no se aplican: se esconden en vez de
  // quedar a la vista sin hacer nada, que hace creer que el filtro está puesto.
  const filtros = document.getElementById(_histId(tipo, 'filtros'));
  if (filtros) filtros.style.display = sel ? 'none' : 'flex';
  const ayuda = document.getElementById(_histId(tipo, 'ayuda'));
  if (ayuda) {
    if (!ayuda.dataset.base) ayuda.dataset.base = ayuda.innerHTML;
    ayuda.innerHTML = sel
      ? 'Todo su historial, de lo más nuevo a lo más viejo. El mes y el buscador no se aplican: una liquidación vieja no se busca por mes.'
      : ayuda.dataset.base;
  }

  const total = filas.reduce((s, x) => s + x.monto, 0);
  const envios = filas.reduce((s, x) => s + x.envios, 0);
  const sinDetalle = filas.filter(x => !x.tieneDetalle).length;

  // Con uno elegido, su propia ficha reemplaza a los KPI: repetir los mismos
  // tres números arriba y abajo no agrega nada.
  const kpis = document.getElementById(_histId(tipo, 'kpis'));
  if (kpis) kpis.style.display = sel ? 'none' : '';
  if (kpis && !sel) kpis.innerHTML =
    '<div class="metric-card"><div class="metric-label">Liquidaciones</div>' +
      '<div class="metric-value">' + filas.length + '</div>' +
      '<div class="metric-sub">' + (mes ? 'en el mes elegido' : 'todo el historial') + (q ? ' · ' + q : '') + '</div></div>' +
    '<div class="metric-card"><div class="metric-label">Envíos</div>' +
      '<div class="metric-value">' + envios.toLocaleString('es-AR') + '</div>' +
      '<div class="metric-sub">' + (sinDetalle ? sinDetalle + ' sin detalle guardado' : 'de las liquidaciones listadas') + '</div></div>' +
    '<div class="metric-card accent"><div class="metric-label">' + (esCond ? 'Pagado (neto)' : 'Facturado') + '</div>' +
      '<div class="metric-value">' + fmtPeso(total) + '</div>' +
      '<div class="metric-sub">' + (esCond ? 'lo que cobraron los conductores' : 'lo que se le facturó a los clientes') + '</div></div>';

  // Las cerradas antes de que existiera el historial no tienen detalle: se
  // pueden reconstruir mientras sus envíos sigan en la base viva.
  const aviso = document.getElementById(_histId(tipo, 'aviso'));
  // De las cerradas antes del 18/09/2026 consta el TOTAL y no el desglose, y
  // eso es todo lo que se puede decir con honestidad. Rearmarlas recalculando
  // con los datos de hoy daba un papel con el formato y el número de documento
  // del original SIN serlo —entre medio se cargaron listas de precios sin fecha,
  // que pisan el precio hacia atrás, y se corrigieron zonas, anulaciones y
  // envíos a mano—, y para cotejar contra lo que el cliente tiene en la mano eso
  // es peor que no tener PDF. Por eso no hay botón para reconstruirlas.
  if (aviso) aviso.innerHTML = sinDetalle
    ? '<div class="alert" style="margin:0 0 14px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
      '<i class="ic ic-alert"></i><div><strong>De ' + sinDetalle + ' liquidación(es) consta el total, no el desglose</strong> — se cerraron antes de que ' +
      'el sistema guardara el detalle congelado (18/09/2026). El importe es el que se facturó y no se recalcula; ' +
      'lo que no se puede reponer es el envío por envío, así que esas no ofrecen PDF: ' +
      'para cotejarlas hay que usar el que se le mandó al cliente.</div></div>'
    : '';

  // La tabla cruzada y la vista de uno solo son excluyentes.
  const tabla = document.getElementById(_histId(tipo, 'tabla'));
  const caja = document.getElementById(_histId(tipo, 'cajacli'));
  if (tabla) tabla.style.display = sel ? 'none' : '';
  if (caja) {
    caja.style.display = sel ? '' : 'none';
    caja.innerHTML = sel ? _histVistaDeUno(tipo, sel, filas) : '';
  }
  if (sel) return;

  if (!filas.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-file"></i></div>' +
      '<div class="empty-title">Sin liquidaciones cerradas</div><div class="empty-sub">' +
      (q ? 'Probá con otro nombre' : mes ? 'Nadie cerró liquidaciones en ese mes — probá otro o borrá el mes para ver todo' :
        'Acá aparecen las que se marcan como listas') + '</div></div></td></tr>';
    return;
  }

  body.innerHTML = filas.map(x => {
    const esc = jsAttr(x.clave);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(x.nombre) + '</div>' +
        '<strong>' + x.nombre + '</strong></div></td>' +
      '<td style="font-size:12px">' + _histFmtFecha(x.desde) + ' → ' + _histFmtFecha(x.hasta) + '</td>' +
      '<td class="mono" style="text-align:right">' + (x.envios ? x.envios.toLocaleString('es-AR') : (x.tieneDetalle ? '0' : '—')) + '</td>' +
      (esCond ? '<td class="mono" style="text-align:right;color:var(--text-muted)">' + (x.bruto ? fmtPeso(x.bruto) : '—') + '</td>' : '') +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.monto) + '</td>' +
      '<td style="font-size:11px;color:var(--text-muted)">' + (x.armada_por || '—') +
        (x.armada_en ? '<div>' + _histFmtCuando(x.armada_en) + '</div>' : '') + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn btn-sm" onclick="verDetalleLiq(\'' + tipo + '\',\'' + esc + '\',\'' + x.desde + '\')" title="Ver lo que consta de esta liquidación"><i class="ic ic-search"></i> Ver</button>' +
        (x.tieneDetalle
          ? ' <button class="btn btn-sm" onclick="pdfDesdeHistorial(\'' + tipo + '\',\'' + esc + '\',\'' + x.desde + '\')" title="El mismo PDF que se descargó ese día"><i class="ic ic-download"></i> PDF</button>'
          : '') +
      '</td>' +
    '</tr>';
  }).join('');
}

// El detalle se trae de la nube (no se hidrata con el resto: son decenas de MB).
async function _histDetalle(tipo, clave, semanaISO) {
  const k = tipo + '|' + clave + '|' + semanaISO;
  if (_histCache.has(k)) return _histCache.get(k);
  const row = await DB.selectDetalleLiq(tipo, clave, semanaISO);
  _histCache.set(k, row);
  return row;
}

function _histRango(snap) {
  const r = (snap && snap.rango) || {};
  return {
    desde: r.desde || '', hasta: r.hasta || '',
    desdeD: r.desde ? parseFechaReg(r.desde) : null,
    hastaD: r.hasta ? parseFechaReg(r.hasta) : null
  };
}

// Rearma el PDF con lo congelado: el mismo papel que se descargó ese día.
async function pdfDesdeHistorial(tipo, clave, semanaISO) {
  try {
    const row = await _histDetalle(tipo, clave, semanaISO);
    if (!row || !row.detalle) {
      alert('Esta liquidación no tiene detalle guardado: se cerró antes de que existiera el historial.' +
        String.fromCharCode(10) + 'Probá "Reconstruir las que se puedan".');
      return;
    }
    const snap = row.detalle;
    const rango = _histRango(snap);
    if (tipo === 'conductor') {
      exportPDF(clave, {
        liqData: liqDesdeSnapshot(clave, snap),
        rangoFechas: { desde: rango.desde, hasta: rango.hasta },
        descuentos: Object.assign({ obs: '' }, (snap.imp && snap.imp.items) || {}),
        imputaciones: snap.imp || null
      });
    } else {
      exportLiquidacionClientePDF(clave, rango, { liq: liqClienteDesdeSnapshot(snap) });
    }
    showToast('📄 PDF rearmado con el detalle de esa liquidación');
  } catch (e) {
    console.warn('pdfDesdeHistorial', e);
    alert('No se pudo traer el detalle: ' + (e.message || e));
  }
}

// La ficha de una liquidación cerrada: los números que salieron y de dónde.
async function verDetalleLiq(tipo, clave, semanaISO) {
  const esCond = tipo === 'conductor';
  const nombre = esCond ? clave : (typeof clienteNombreDe === 'function' ? clienteNombreDe(clave) : clave);
  document.getElementById('modal-title').textContent = 'Liquidación · ' + nombre;
  document.getElementById('modal-body').innerHTML = '<div class="muted" style="padding:16px">Trayendo el detalle…</div>';
  document.getElementById('modal-backdrop').classList.add('open');
  let row = null;
  try { row = await _histDetalle(tipo, clave, semanaISO); }
  catch (e) {
    document.getElementById('modal-body').innerHTML =
      '<div class="alert" style="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5"><i class="ic ic-alert"></i>' +
      '<div>No se pudo traer el detalle: ' + (e.message || e) + '</div></div>';
    return;
  }
  if (!row || !row.detalle) {
    // Lo que SÍ consta: el total congelado al cerrarla y quién la armó. Se
    // muestra eso en vez de ofrecer rearmarla: el desglose de hoy no es el que
    // se le mandó al cliente y no hay forma de saber cuánto se corrió.
    const fila = (esCond ? (AppData.conductorLiquidaciones || []) : (AppData.clienteLiquidaciones || []))
      .find(x => (esCond ? x.conductor : x.cliente_cod) === clave &&
                 String(x.semana_desde || '').slice(0, 10) === semanaISO);
    document.getElementById('modal-body').innerHTML =
      '<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">Período <strong>' +
        _histFmtFecha(semanaISO) + ' → ' + _histFmtFecha(String((fila || {}).semana_hasta || '').slice(0, 10)) + '</strong>' +
        ((fila || {}).armada_por ? ' · armada por ' + _histEsc(fila.armada_por) : '') +
        ((fila || {}).armada_en ? ' · ' + _histFmtCuandoLargo(fila.armada_en) : '') + '</div>' +
      '<div class="metrics-grid" style="grid-template-columns:1fr;margin-bottom:14px">' +
        '<div class="metric-card accent"><div class="metric-label">' + (esCond ? 'Neto pagado' : 'Facturado') + '</div>' +
        '<div class="metric-value">' + fmtPeso(_num((fila || {}).monto)) + '</div>' +
        '<div class="metric-sub">el importe con el que se cerró, congelado</div></div>' +
      '</div>' +
      '<div class="alert" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i>' +
      '<div>De esta liquidación <strong>consta el total, no el desglose</strong>: se cerró antes de que el sistema ' +
      'guardara el detalle congelado (18/09/2026). Rearmar el envío por envío con los datos de hoy daría un papel ' +
      'que <strong>no es el que se le mandó al cliente</strong> —entre medio se cargaron listas de precios sin fecha ' +
      'y se corrigieron envíos a mano—, así que no se ofrece. Para cotejar, el documento válido es el que se envió.</div></div>';
    return;
  }
  const snap = row.detalle;
  const rango = _histRango(snap);
  const kpi = (etq, val, sub) => '<div class="metric-card"><div class="metric-label">' + etq + '</div>' +
    '<div class="metric-value">' + val + '</div>' + (sub ? '<div class="metric-sub">' + sub + '</div>' : '') + '</div>';

  let html = '<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">' +
    'Período <strong>' + (rango.desde || '—') + ' → ' + (rango.hasta || '—') + '</strong>' +
    (row.armada_por ? ' · armada por ' + row.armada_por : '') +
    (row.reconstruido ? ' · <span style="color:#9a3412">reconstruida después: los precios salen del tarifario de hoy</span>' : '') +
    '</div>';

  if (esCond) {
    const imp = snap.imp || {};
    const items = imp.items || {};
    html += '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      kpi('Bruto', fmtPeso(snap.bruto), _num(snap.envios).toLocaleString('es-AR') + ' envíos entregados') +
      kpi('Neto pagado', fmtPeso(snap.neto), 'lo que cobró') +
      kpi('Diferencia', fmtPeso(_num(snap.neto) - _num(snap.bruto)), 'adicionales − descuentos') +
    '</div>';
    const mov = [
      ['Adicional km de desvío', _num(imp.km && imp.km.monto), '+'],
      ['Recorridos especiales', _num(imp.especial && imp.especial.monto), '+'],
      ['Combustible', _num(items.combustible), '−'],
      ['Extraviados / rotos', _num(items.extraviados), '−'],
      ['Servicio proveedores', _num(items.proveedores), '−'],
      ['Cuota de adelanto', _num(imp.adelanto && imp.adelanto.monto), '−'],
      ['Cuota de saldo', _num(imp.extravio && imp.extravio.monto), '−'],
    ].filter(x => x[1] > 0);
    html += mov.length
      ? '<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>Movimiento</th><th style="text-align:right">Importe</th></tr></thead><tbody>' +
        mov.map(m => '<tr><td>' + m[0] + '</td><td class="mono" style="text-align:right;color:' + (m[2] === '+' ? '#166534' : '#b91c1c') + '">' +
          m[2] + fmtPeso(m[1]) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="muted" style="font-size:12px;margin-bottom:12px">Sin adicionales ni descuentos imputados.</div>';
    // Por zona: es como se lee una liquidación de un vistazo.
    const porZona = new Map();
    (snap.ent || []).forEach(a => {
      const z = a[2] || '(sin zona)';
      const g = porZona.get(z) || { n: 0, monto: 0 };
      g.n++; g.monto += _num(a[3]); porZona.set(z, g);
    });
    const zonas = Array.from(porZona.entries()).sort((x, y) => y[1].monto - x[1].monto);
    html += '<div class="table-wrap" style="max-height:38vh;overflow:auto"><table><thead><tr>' +
      '<th>Zona</th><th style="text-align:right">Envíos</th><th style="text-align:right">Total</th></tr></thead><tbody>' +
      zonas.map(z => '<tr><td>' + z[0] + '</td><td class="mono" style="text-align:right">' + z[1].n + '</td>' +
        '<td class="mono" style="text-align:right">' + fmtPeso(z[1].monto) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (_num(snap.noent && snap.noent.length) ? '<div class="muted" style="font-size:11.5px;margin-top:8px">' +
        snap.noent.length + ' recorrido(s) en otros estados, que no se pagaron.</div>' : '');
  } else {
    const cargos = snap.cargos || [];
    html += '<div class="metrics-grid" style="grid-template-columns:repeat(' + (cargos.length ? 3 : 1) +
      ',1fr);margin-bottom:14px">' +
      kpi('Facturado', fmtPeso(snap.total), _num(snap.envios).toLocaleString('es-AR') + ' envíos' +
        (cargos.length ? ' + ' + cargos.length + ' cargo(s)' : '')) +
      (cargos.length
        ? kpi('Por envíos', fmtPeso(snap.totalEnvio), 'a la tarifa de cada zona') +
          kpi('Cargos', fmtPeso(snap.totalCargos), 'colecta, viaje particular u otro')
        : '') +
    '</div>';
    const zonas = (snap.zonas || []).slice().sort((a, b) => _num(b.subtotal) - _num(a.subtotal));
    html += '<div class="table-wrap" style="max-height:38vh;overflow:auto"><table><thead><tr>' +
      '<th>Zona</th><th style="text-align:right">Envíos</th><th style="text-align:right">Tarifa</th><th style="text-align:right">Total</th></tr></thead><tbody>' +
      (zonas.length ? zonas.map(f => '<tr><td>' + f.zona + '</td>' +
        '<td class="mono" style="text-align:right">' + _num(f.count) + '</td>' +
        '<td class="mono" style="text-align:right">' + (_num(f.precio) > 0 ? fmtPeso(f.precio) : '—') + '</td>' +
        '<td class="mono" style="text-align:right">' + fmtPeso(_num(f.subtotal)) + '</td></tr>').join('')
        : '<tr><td colspan="4" class="muted" style="text-align:center;padding:12px">Sin envíos: solo cargos</td></tr>') +
      '</tbody></table></div>' +
      // Los cargos van discriminados con su concepto y su fecha, igual que en la
      // factura: diluidos en un total no se puede explicar de qué eran.
      (cargos.length ? '<div class="table-wrap" style="margin-top:10px"><table><thead><tr>' +
        '<th>Cargo que no viene de un envío</th><th style="text-align:right">Importe</th></tr></thead><tbody>' +
        cargos.map(c => '<tr><td>' +
          _histEsc(typeof cargoLabel === 'function' ? cargoLabel(c.concepto) : (c.concepto || 'Cargo')) +
          ((typeof cargoDatosTxt === 'function' && cargoDatosTxt(c))
            ? '<div style="font-size:11px;color:var(--text-muted)">' + _histEsc(cargoDatosTxt(c)) + '</div>' : '') +
          '</td><td class="mono" style="text-align:right">' + fmtPeso(_num(c.monto)) + '</td></tr>').join('') +
        '</tbody></table></div>' : '') +
      (_num(snap.anulados) ? '<div class="muted" style="font-size:11.5px;margin-top:8px">' + _num(snap.anulados) +
        ' envío(s) con el cobro anulado · ' + fmtPeso(snap.bonificado) + ' bonificados.</div>' : '');
  }

  html += '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
    '<button class="btn btn-primary btn-sm" onclick="pdfDesdeHistorial(\'' + tipo + '\',\'' + jsAttr(clave) + '\',\'' + semanaISO + '\')">' +
    '<i class="ic ic-download"></i> Descargar el PDF</button></div>';
  document.getElementById('modal-body').innerHTML = html;
}

// ── Por qué NO hay "reconstruir" ───────────────────────────────────────────
// Existió y se sacó. Rehacer el detalle con los envíos y el tarifario de hoy
// produce un PDF con el formato, el membrete y el número de documento del
// original sin serlo, y el panel lo ofrecía como la acción destacada. Para el
// uso real —el cliente llama reclamando una factura— eso es peor que no tener
// PDF. Dos mecanismos medidos lo garantizan en esta base: hasta el 19/09/2026
// se cargaron listas de precios con el centinela "desde siempre", que pisan el
// precio de semanas ya facturadas, y los envíos de esas semanas acumulan 729
// zonas corregidas, 126 cobros anulados y 224 altas a mano posteriores al
// cierre. Lo que consta de esas liquidaciones es el MONTO congelado, y con eso
// alcanza para cotejar contra el papel que se envió.
