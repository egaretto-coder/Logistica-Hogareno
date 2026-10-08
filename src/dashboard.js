function getZonaEfectiva(r) {
  return (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
}

// ── Filtro por condición ────────────────────────────────────────────────────
// El filtro existía pero solo repintaba la tarjeta "Conductores por condición":
// los KPIs de arriba, el reporte por conductor y el de zonas seguían mostrando
// a TODOS. Filtrar Titulares y ver "Total liquidado" con la plata de todo el
// mundo es peor que no tener el filtro, porque el número parece el del filtro y
// no lo es. Ahora filtra los ENVÍOS, y todo lo que cuelga de ahí lo sigue.
let dashCondFilter = '';
const DASH_COND_PLURAL = { 'Titular': 'Titulares', 'Semi Titular': 'Semi Titulares', 'Suplente': 'Suplentes' };
function dashCondLabel() { return dashCondFilter ? (DASH_COND_PLURAL[dashCondFilter] || dashCondFilter) : ''; }

// Los botones se pintan contra el FILTRO, no contra el que se tocó: el mismo
// grupo está en Conductores y en Zonas, y marcando solo el clickeado el otro
// grupo quedaba mostrando "Todos" mientras el panel filtraba por Titulares.
function _pintarBotonesCond() {
  document.querySelectorAll('.dash-cond-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.cond || '') === dashCondFilter));
}
function setDashCondFilter(btn, cond) {
  dashCondFilter = cond;
  _pintarBotonesCond();
  renderDashboard(); // re-renderiza respetando el filtro de fechas activo
}

// Torta (anillo) de la distribución por categorización. SVG a mano: el proyecto
// no lleva librerías y una de gráficos entera para un donut de 4 porciones no
// se paga. Cada porción es un arco de un mismo círculo —`stroke-dasharray` le da
// el largo y `stroke-dashoffset` lo corre hasta donde terminó el anterior—, así
// que no hay que calcular paths ni ángulos.
// Las barras de al lado NO se van: la torta muestra la proporción de un vistazo
// y las barras dan el número exacto de cada una, que es lo que se copia a un
// informe. Son dos lecturas de lo mismo y ninguna reemplaza a la otra.
// `partes`: [{ label, color, cnt }] — `cnt` puede ser una cantidad (conductores)
// o plata (facturación): la torta solo reparte proporciones. `centro` es lo que
// va adentro ya formateado, porque "89" y "$130.448.162" no se escriben igual, y
// `fmt` cómo se nombra cada porción en su tooltip.
function _dashDonut(partes, total, centro, fmt) {
  const R_ = 54, C = 2 * Math.PI * R_;
  const anillo = '<circle cx="70" cy="70" r="' + R_ + '" fill="none" stroke="var(--surface-0)" stroke-width="22"/>';
  const etq = (centro && centro.etiqueta) || '';
  if (!total || !partes.length) {
    return '<svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Sin datos">' + anillo + '</svg>';
  }
  const nombrar = fmt || (v => String(v));
  let acum = 0;
  const arcos = partes.map(p => {
    const largo = C * (p.cnt / total);
    const el = '<circle cx="70" cy="70" r="' + R_ + '" fill="none" stroke="' + p.color + '" stroke-width="22"' +
      ' stroke-dasharray="' + largo.toFixed(2) + ' ' + Math.max(0, C - largo).toFixed(2) + '"' +
      ' stroke-dashoffset="' + (-acum).toFixed(2) + '" transform="rotate(-90 70 70)">' +
      '<title>' + p.label + ': ' + nombrar(p.cnt) + ' (' + Math.round(p.cnt / total * 100) + '%)</title></circle>';
    acum += largo;
    return el;
  }).join('');
  return '<svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="' + (etq || 'Distribución') + '">' +
    anillo + arcos +
    '<text x="70" y="66" text-anchor="middle" style="font-size:' + ((centro && centro.chico) ? 13 : 22) +
      'px;font-weight:700;fill:var(--text-primary)">' + ((centro && centro.valor) || total) + '</text>' +
    '<text x="70" y="84" text-anchor="middle" style="font-size:10px;fill:var(--text-muted)">' + etq + '</text>' +
    '</svg>';
}

// Los colores de las porciones de clientes: son identidades sin categoría, así
// que el color no significa nada y solo tiene que distinguirlas entre sí.
const _DASH_TORTA_COLORES = ['#8b5cf6', '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#06b6d4', '#9ca3af'];

function renderDashConductoresPanel(liqParam) {
  // liqParam viene de renderDashboard ya filtrado por fecha
  // Si se llama directo (ej: desde setDashCondFilter), recalcula completo
  const liq = liqParam || calcLiquidaciones();
  const total = AppData.panelConductores.length;
  const filtrados = dashCondFilter
    ? AppData.panelConductores.filter(c => c.condicion === dashCondFilter)
    : AppData.panelConductores;
  const cantidad = filtrados.length;
  // Anillo conductores: cuando es Todos → conductores con liq / conductores panel
  // cuando es por condición → filtrados / total panel
  const totalConLiq = Object.keys(liq).length;
  const pct = dashCondFilter
    ? (total ? Math.round(cantidad / total * 100) : 0)
    : (totalConLiq > 0 ? 100 : 0); // Todos siempre es 100% del universo

  const CAT_INFO = {
    's_colecta': { label: 'S/ Colecta', color: '#3b82f6' },
    'c_colecta': { label: 'C/ Colecta', color: '#10b981' },
    'sla':       { label: 'SLA Cumplido', color: '#8b5cf6' },
    'super_sla': { label: 'Super SLA', color: '#f59e0b' },
    'sin_cat':   { label: 'Sin categorizar', color: '#9ca3af' }
  };

  const condLabel = dashCondFilter || 'Todos';
  const condEmoji = dashCondFilter === 'Titular' ? '🔵' : dashCondFilter === 'Semi Titular' ? '🟡' : dashCondFilter === 'Suplente' ? '🟣' : '⚪';

  const body = document.getElementById('dash-conductores-panel-body');
  if (!total) {
    body.innerHTML = '<div class="empty-state"><div class="empty-sub">Sin conductores en el panel</div></div>';
    return;
  }

  // ── Distribución por categorización (headcount) ──────────────────────────
  // El universo depende del filtro:
  // - Con condición → solo conductores del panel con esa condición (filtrados)
  // - Sin filtro (Todos) → todos los conductores que tienen liquidación en el XLS;
  //   los que no están en el panel se cuentan como "Sin categorizar"
  const catCount = {};

  if (dashCondFilter) {
    // Filtro por condición: solo los del panel filtrados
    filtrados.forEach(c => {
      const cat = c.categoria || 'sin_cat';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
  } else {
    // Todos: usar los conductores reales del XLS (los que tienen liquidación)
    // Armar mapa nombre→categoría desde el panel
    const panelMap = {};
    AppData.panelConductores.forEach(c => {
      panelMap[c.nombre.toUpperCase().trim()] = c.categoria || 'sin_cat';
    });
    // Recorrer todos los conductores con liquidación
    Object.keys(liq).forEach(nombre => {
      const nNorm = nombre.toUpperCase().trim();
      const cat = panelMap[nNorm] || 'sin_cat';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
  }

  // Total real para los porcentajes: conductores únicos con liquidación (filtro Todos)
  // o cantidad de filtrados (filtro por condición)
  const totalParaPct = dashCondFilter ? cantidad : Object.keys(liq).length;

  // ── Facturación ──────────────────────────────────────────────────────────
  // Monto total general = TODOS los conductores con liquidación (base real)
  const totalMontoGeneral = Object.values(liq).reduce((s, d) => s + d.total, 0);

  let montoGrupo = 0;
  const liqPorConductor = []; // { nombre, monto }

  if (!dashCondFilter) {
    // Filtro "Todos": monto grupo = total general, incluir todos los conductores con liq
    montoGrupo = totalMontoGeneral;
    Object.entries(liq).forEach(([nombre, d]) => {
      liqPorConductor.push({ nombre, monto: d.total });
    });
  } else {
    // Filtro por condición: solo conductores del panel con esa condición
    const nombresFilterSet = new Set(filtrados.map(c => c.nombre.toUpperCase().trim()));
    Object.entries(liq).forEach(([nombre, d]) => {
      if (nombresFilterSet.has(nombre.toUpperCase().trim())) {
        montoGrupo += d.total;
        liqPorConductor.push({ nombre, monto: d.total });
      }
    });
  }

  const pctFacturacion = totalMontoGeneral > 0 ? Math.round(montoGrupo / totalMontoGeneral * 100) : 0;
  liqPorConductor.sort((a, b) => b.monto - a.monto);
  const maxMonto = liqPorConductor.length ? liqPorConductor[0].monto : 1;
  const top8 = liqPorConductor.slice(0, 8);

  // ── Distribución por categorización (torta + barras) ─────────────────────
  const catOrden = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
  const catPartes = catOrden.map(([cat, cnt]) => {
    const info = CAT_INFO[cat] || { label: cat, color: '#9ca3af' };
    return { label: info.label, color: info.color, cnt: cnt };
  });
  const catRows = catOrden
    .map(([cat, cnt]) => {
      const info = CAT_INFO[cat] || { label: cat, color: '#9ca3af' };
      const catPct = totalParaPct ? Math.round(cnt / totalParaPct * 100) : 0;
      return `<div class="dash-bar-row">
        <span class="lbl"><span class="dot" style="background:${info.color}"></span>${info.label}</span>
        <span class="dash-bar-track"><span class="dash-bar-fill" style="width:${catPct}%;background:${info.color}"></span></span>
        <span class="meta"><b style="color:${info.color}">${catPct}%</b><span>${cnt}</span></span>
      </div>`;
    }).join('');

  // ── Participación en facturación por conductor (ranking) ─────────────────
  const factRows = top8.length ? top8.map(({ nombre, monto }) => {
    const partPct = montoGrupo > 0 ? Math.round(monto / montoGrupo * 100) : 0;
    return `<div class="dash-rank-row">
      <div class="conductor-avatar" style="background:${avatarColor(nombre)};width:26px;height:26px;font-size:9px;flex-shrink:0">${initials(nombre)}</div>
      <span class="nom">${nombre}</span>
      <span class="amt">${fmtPeso(monto)}<span>${partPct}%</span></span>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:var(--text-muted);padding:10px 0">Sin liquidaciones para esta condición</div>';

  body.innerHTML = `
    <div class="dash-cond-grid">
      <div>
        <div class="dash-subtitle">Distribución por categorización · <b style="color:var(--text-secondary)">${dashCondFilter ? cantidad : totalConLiq} conductores</b></div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div style="flex-shrink:0">${_dashDonut(catPartes, totalParaPct, { valor: totalParaPct, etiqueta: 'conductores' })}</div>
          <div style="flex:1;min-width:200px">${catRows || '<div style="color:var(--text-muted);font-size:12px">Sin conductores</div>'}</div>
        </div>
      </div>
      <div>
        <div class="dash-subtitle">Participación en facturación${dashCondFilter ? ' · ' + condLabel : ''} · <b style="color:var(--text-secondary)">${fmtPeso(montoGrupo)}</b></div>
        ${factRows}
        ${liqPorConductor.length > 8 ? '<div style="font-size:11px;color:var(--text-muted);margin-top:10px;text-align:center">+ ' + (liqPorConductor.length - 8) + ' conductores más</div>' : ''}
      </div>
    </div>`;
}

// ── Estado filtro de fechas del dashboard ───────────────────────────────────
// Arranca en EL MES EN CURSO, no en "Todo". El Dashboard es la pantalla del
// "cómo venimos", y esa pregunta casi siempre es sobre el mes: con "Todo" el
// primer número que se ve son $130.448.162 de toda la historia cargada, que no
// se puede comparar con nada y no dice si el mes viene bien o mal. Los demás
// atajos y el rango a mano siguen igual: el default es un punto de partida, no
// una restricción.
let dashFechaPreset = 'mes'; // 'todo' | 'hoy' | 'semana' | 'mes' | 'personalizado'
// QUÉ mes se está mirando (AAAA-MM). Vacío = el corriente. Antes "Este mes" era
// siempre el de hoy y para ver el anterior había que armar el rango a mano;
// comparar contra el mes pasado es la mitad de las preguntas que se le hacen a
// este panel.
let dashMes = '';
// Los nombres van acá y no se toman prestados de otro módulo: la etiqueta de
// este panel no puede depender de que empleados.js esté cargado — el banco lo
// agarró mostrando "2026-08" donde tenía que decir "Agosto 2026".
const _DASH_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function _dashMesTexto(yyyymm) {
  const n = _DASH_MESES[(+String(yyyymm).slice(5, 7)) - 1];
  if (!n) return String(yyyymm || '');
  return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + String(yyyymm).slice(0, 4);
}
function _dashMesActivo() {
  if (/^\d{4}-\d{2}$/.test(dashMes)) return dashMes;
  const h = new Date();
  return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0');
}
// Mover de a un mes, y saltar a uno cualquiera. Los dos ponen el período en
// "mes": tocar el navegador es elegir un mes, no hace falta apretar nada más.
function dashMoverMes(n) {
  const m = _dashMesActivo();
  const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + _num(n), 1);
  dashMes = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  dashFechaPreset = 'mes';
  renderDashboard();
}
function dashElegirMes(v) {
  if (!/^\d{4}-\d{2}$/.test(String(v || ''))) return;   // vaciarlo no cambia nada
  dashMes = v;
  dashFechaPreset = 'mes';
  renderDashboard();
}

// Convierte DD/MM/YYYY → objeto Date (mediodia para evitar problemas de TZ)
function parseFechaReg(fechaStr) {
  if (!fechaStr) return null;
  try {
    if (String(fechaStr).includes('/')) {
      const parts = String(fechaStr).split('/');
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d, 12, 0, 0);
      }
    }
    // YYYY-MM-DD (desde input date nativo)
    if (String(fechaStr).match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [y, m, d] = fechaStr.split('-').map(Number);
      return new Date(y, m - 1, d, 12, 0, 0);
    }
    const parsed = new Date(fechaStr);
    return isNaN(parsed) ? null : parsed;
  } catch(e) { return null; }
}

// Convierte YYYY-MM-DD (valor de input nativo) a Date al inicio del día
function parseFechaInput(val) {
  if (!val) return null;
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0);
}

function getDashFechaRango() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (dashFechaPreset === 'todo') return null;
  if (dashFechaPreset === 'hoy') {
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
    return { desde: hoy, hasta: fin };
  }
  if (dashFechaPreset === 'semana') {
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);
    const dom = new Date(lunes);
    dom.setDate(lunes.getDate() + 6);
    dom.setHours(23, 59, 59);
    return { desde: lunes, hasta: dom };
  }
  if (dashFechaPreset === 'mes') {
    const m = _dashMesActivo();
    const a = +m.slice(0, 4), mm = +m.slice(5, 7) - 1;
    const ini = new Date(a, mm, 1, 0, 0, 0);
    const fin = new Date(a, mm + 1, 0, 23, 59, 59);   // día 0 del siguiente = último de este
    return { desde: ini, hasta: fin };
  }
  if (dashFechaPreset === 'personalizado') {
    const desdeEl = document.getElementById('dash-fecha-desde');
    const hastaEl = document.getElementById('dash-fecha-hasta');
    const desdeVal = desdeEl ? desdeEl.value : '';
    const hastaVal = hastaEl ? hastaEl.value : '';
    if (!desdeVal && !hastaVal) return null;
    const desde = desdeVal ? parseFechaInput(desdeVal) : null;
    const hasta = hastaVal ? new Date(new Date(parseFechaInput(hastaVal)).setHours(23, 59, 59)) : null;
    return { desde, hasta };
  }
  return null;
}

// Devuelve una referencia ESTABLE para el mismo rango y la misma base: el
// Dashboard y su reporte por zona/conductor lo llaman por separado dentro del
// mismo render, y si cada uno recibiera un array nuevo el caché de
// calcLiquidaciones (que va por identidad) no daría nunca y se recalcularían los
// 47.684 envíos dos veces.
let _filtroCache = null;
// La llama invalidarLiquidaciones: el filtro se apoya en la fecha de cada envío,
// así que cualquier cambio en los registros lo deja viejo igual que al cálculo.
function invalidarFiltroFecha() { _filtroCache = null; _filtroCondCache = null; }
// Envíos de los conductores con ESA condición. Un envío sin chofer, o de un
// cadete que no está en el panel, no tiene condición: queda afuera de cualquier
// filtro por condición (que es lo correcto — no es titular ni suplente).
// Devuelve la MISMA referencia cuando no hay filtro: es lo que hace que
// calcLiquidaciones dé en su caché y las tres pasadas del render no recalculen
// 47.684 envíos cada una.
let _filtroCondCache = null;
function filtrarRecordsPorCondicion(records) {
  const cond = dashCondFilter;
  if (!cond) return records;
  if (_filtroCondCache && _filtroCondCache.cond === cond && _filtroCondCache.src === records
      && _filtroCondCache.n === records.length) return _filtroCondCache.out;
  const out = records.filter(r => {
    const c = conductorCanonico(r.cadete);
    if (!c) return false;
    const p = panelConductorDe(c);
    return !!p && String(p.condicion || '').trim() === cond;
  });
  _filtroCondCache = { cond, src: records, n: records.length, out };
  return out;
}

// Los envíos que el Dashboard está mirando: período Y condición. Es la única
// fuente de los KPIs y de los dos reportes, así que no pueden desfasarse.
function recordsDelDashboard() {
  const porFecha = (typeof filtrarRecordsPorFecha === 'function')
    ? filtrarRecordsPorFecha(AppData.records) : AppData.records;
  return filtrarRecordsPorCondicion(porFecha);
}

function filtrarRecordsPorFecha(records) {
  const rango = getDashFechaRango();
  if (!rango) return records;
  const clave = (rango.desde ? rango.desde.getTime() : 0) + '|' + (rango.hasta ? rango.hasta.getTime() : 0);
  if (_filtroCache && _filtroCache.clave === clave && _filtroCache.src === records
      && _filtroCache.n === records.length) return _filtroCache.out;
  const out = records.filter(r => {
    const f = parseFechaReg(r.fecha);
    if (!f) return false;
    if (rango.desde && f < rango.desde) return false;
    if (rango.hasta && f > rango.hasta) return false;
    return true;
  });
  _filtroCache = { clave, src: records, n: records.length, out };
  return out;
}

function setDashFechaPreset(btn, preset) {
  dashFechaPreset = preset;
  renderDashboard();   // _pintarPresetFecha marca el que corresponde
}

// Se marca contra el ESTADO, no contra el botón que se tocó: tocar el navegador
// de mes tiene que apagar el preset que estuviera marcado, y marcar solo el
// clickeado ya dejó una vez un grupo de botones diciendo una cosa mientras el
// panel filtraba otra (el filtro por condición).
function _pintarPresetFecha() {
  document.querySelectorAll('.dash-fecha-btn').forEach(b => {
    const m = /setDashFechaPreset\(this,'([a-z]+)'\)/.exec(b.getAttribute('onclick') || '');
    b.classList.toggle('active', !!m && m[1] === dashFechaPreset);
  });
  const custom = document.getElementById('dash-fecha-custom');
  if (custom) custom.style.display = dashFechaPreset === 'personalizado' ? 'flex' : 'none';
  // El navegador de mes se resalta cuando es el que manda, y muestra siempre el
  // mes que se está viendo —si no, se queda mostrando otro y el operador cree
  // que está mirando ese.
  const inp = document.getElementById('dash-mes');
  if (inp && inp.value !== _dashMesActivo()) inp.value = _dashMesActivo();
  const nav = document.getElementById('dash-mes-nav');
  if (nav) {
    const on = dashFechaPreset === 'mes';
    nav.style.borderColor = on ? 'var(--accent)' : '';
    nav.style.boxShadow = on ? '0 0 0 3px var(--accent-light)' : '';
  }
}

// ════════════════════════════════════════════════════════════════════════
//  EL RECORRIDO ESPECIAL ES COSTO DE CONDUCTOR; EL KM DE DESVÍO NO.
//  Un recorrido especial es el PRECIO PACTADO por hacer ese reparto —5 a 10
//  direcciones dispersas a un monto fijo—, así que es lo que cuesta mover esos
//  envíos y tiene que estar en el costo. El km de desvío, en cambio, es el
//  reintegro de un gasto, no el precio del trabajo, y queda afuera.
//  Tampoco entran los descuentos: el adelanto es un préstamo (plata ya
//  entregada, no un costo menor del mes) y el combustible, los proveedores y
//  los extravíos son RECUPEROS de algo que la empresa pagó por fuera y que
//  tampoco está en este panel — contar una sola punta inventaría un ahorro.
//  No se mete en la solapa de Clientes: un recorrido especial no es de ningún
//  cliente, y repartirlo a prorrata sería inventar una atribución que no
//  existe en ningún registro. Tampoco en la de Zonas: no tiene zona.
// ════════════════════════════════════════════════════════════════════════
function _dashEspecialesPorDia(rango, conductores) {
  const porDia = new Map();
  let total = 0, n = 0;
  const desde = rango && rango.desde ? new Date(rango.desde) : null;
  const hasta = rango && rango.hasta ? new Date(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  (AppData.recorridosEspeciales || []).forEach(d => {
    // Lo mismo que exige la liquidación: pendiente de aprobación no se paga.
    if (d.imputar === false || !esAutorizado(d)) return;
    // Y el MISMO universo de conductores que los KPI, así el filtro por
    // condición mueve las dos cosas: con "Suplentes" puesto, un especial de un
    // titular no puede sumar a un total que dice ser solo de suplentes.
    if (conductores && !conductores.has(conductorKey(d.conductor))) return;
    const f = parseFechaReg(d.fecha);
    if (!f) return;
    if (desde && f < desde) return;
    if (hasta && f > hasta) return;
    const iso = fechaISOde(d.fecha);
    if (!iso || _dashEsDomingo(iso)) return;   // el domingo no se grafica
    const m = _num(d.monto);
    porDia.set(iso, _num(porDia.get(iso)) + m);
    total += m; n++;
  });
  return { porDia, total, n };
}

function renderDashboard() {
  const rango = getDashFechaRango();
  const recordsFiltrados = recordsDelDashboard();

  // Las liquidaciones del período salen del MISMO cálculo que usa la pantalla de
  // Liquidaciones (calcLiquidaciones). Antes el Dashboard tenía su propia cuenta
  // en línea que solo miraba getPrecio + precio_manual y NO la dimensión especial
  // asignada al envío: los 73 envíos con condición cargada se contaban a la tarifa
  // común de la zona, así que el "Total a pagar" del Dashboard no coincidía con la
  // suma de lo que se liquida de verdad. Dos cuentas para el mismo número siempre
  // terminan discrepando; ahora hay una sola.
  // Sin filtro de fecha se pasa undefined a propósito: es lo único que calcLiquidaciones
  // cachea, y así el reporte por zona/conductor reusa esta misma pasada.
  const liqFecha = calcLiquidaciones(recordsFiltrados === AppData.records ? undefined : recordsFiltrados);
  const conductores = Object.keys(liqFecha);
  const totalMonto = Object.values(liqFecha).reduce((s, v) => s + v.total, 0);
  // COSTO VARIABLE UNITARIO: lo que cuesta cada envío que se paga.
  // El denominador son LOS MISMOS envíos que forman el total —las filas que
  // contabilizan—, no todos los recorridos del período: los no entregados no
  // se le pagan a nadie y meterlos abajo daría un unitario más barato que el
  // real. Dividir un número por su propia cantidad es lo que hace que esta
  // tarjeta no pueda contradecir a la de al lado.
  const enviosPagos = Object.values(liqFecha).reduce((s, v) => s + v.filas.length, 0);
  // El recorrido especial se paga además de la tarifa, así que forma parte del
  // costo de conductores. Va en las tres tarjetas y en el gráfico, no en una
  // sola: un "Total liquidado" que lo incluya con un unitario que no lo
  // incluya son dos tarjetas contradiciéndose.
  const esp = _dashEspecialesPorDia(rango, new Set(conductores.map(c => conductorKey(c))));
  const totalConEspecial = totalMonto + esp.total;
  const costoUnitario = enviosPagos ? totalConEspecial / enviosPagos : 0;
  const totalRecs = recordsFiltrados.length;
  const totalEntregados = recordsFiltrados.filter(r => esEstadoEntregado(r.estado)).length;
  const totalExcluidos = totalRecs - totalEntregados;

  // Etiqueta del período seleccionado
  const fmt = d => d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  let labelPeriodo = '';
  if (dashFechaPreset === 'todo') {
    labelPeriodo = '— todos los registros';
  } else if (dashFechaPreset === 'mes') {
    // "Octubre 2026" se lee de un vistazo; "01/10/2026 → 31/10/2026" hay que
    // leerlo dos veces para darse cuenta de que es un mes entero.
    labelPeriodo = _dashMesTexto(_dashMesActivo());
  } else if (rango) {
    if (rango.desde && rango.hasta) {
      labelPeriodo = fmt(rango.desde) + ' → ' + fmt(rango.hasta);
    } else if (rango.desde) {
      labelPeriodo = 'Desde ' + fmt(rango.desde);
    } else if (rango.hasta) {
      labelPeriodo = 'Hasta ' + fmt(rango.hasta);
    }
  } else if (dashFechaPreset === 'personalizado') {
    labelPeriodo = 'Seleccioná un rango de fechas';
  }
  _pintarBotonesCond();
  _pintarPresetFecha();
  if (dashCondLabel()) labelPeriodo = (labelPeriodo ? labelPeriodo + ' · ' : '') + 'solo ' + dashCondLabel();
  if (dashTab === 'clientes' && dashPerFilter)
    labelPeriodo = (labelPeriodo ? labelPeriodo + ' · ' : '') + 'clientes ' + DASH_PER_PLURAL[dashPerFilter].toLowerCase();
  const labelEl = document.getElementById('dash-fecha-label');
  if (labelEl) labelEl.textContent = labelPeriodo;

  const promedioPorConductor = conductores.length ? Math.round(totalConEspecial / conductores.length) : 0;

  document.getElementById('metric-total').textContent = fmtPeso(totalConEspecial);
  // Si el número incluye algo que no son envíos, hay que decirlo: si no, no
  // cierra contra la cuenta de "envíos x tarifa" que alguien pueda rehacer.
  document.getElementById('metric-sub-total').textContent =
    totalEntregados + ' entregados · ' + totalExcluidos + ' en otros estados' +
    (esp.total > 0 ? ' · incluye ' + fmtPeso(esp.total) + ' de ' + esp.n +
      (esp.n === 1 ? ' recorrido especial' : ' recorridos especiales') : '');
  document.getElementById('metric-cvu').textContent = fmtPeso(costoUnitario);
  const cvuSub = document.getElementById('metric-cvu-sub');
  if (cvuSub) cvuSub.textContent = enviosPagos
    ? 'por envío pagado · ' + enviosPagos.toLocaleString('es-AR') + ' envíos'
    : 'sin envíos pagados en el período';
  document.getElementById('metric-conductores').textContent = conductores.length;
  document.getElementById('metric-promedio').textContent = fmtPeso(promedioPorConductor);
  document.getElementById('metric-promedio-sub').textContent = conductores.length + ' conductores en el período';
  // "Conductores en panel" también sigue al filtro: si dice 102 mientras los
  // demás KPIs hablan de 30 titulares, el promedio no se puede leer contra nada.
  const enPanel = dashCondFilter
    ? (AppData.panelConductores || []).filter(c => String(c.condicion || '').trim() === dashCondFilter).length
    : (AppData.panelConductores || []).length;
  document.getElementById('metric-panel-total').textContent = enPanel;
  const panelSub = document.getElementById('metric-panel-sub');
  if (panelSub) panelSub.textContent = dashCondFilter
    ? dashCondLabel() + ' de ' + (AppData.panelConductores || []).length
    : 'Registrados en el sistema';
  document.getElementById('sidebar-conductor-count').textContent = conductores.length + ' conductores';
  document.getElementById('sidebar-record-count').textContent = AppData.records.length
    ? (AppData.records.length + ' registros' + (AppData.historialCompleto ? ' (historial completo)' : ' · últimos ' + VENTANA_DIAS_REGISTROS + ' días'))
    : 'Sin datos cargados';
  document.getElementById('no-data-alert').style.display = AppData.records.length ? 'none' : 'flex';

  // SOLO la solapa que se está viendo. Antes se recalculaban las tres en cada
  // render, y la de Clientes es la cara de todas: con 47.684 envíos, entrar al
  // Dashboard tardaba 23 s y cambiar de solapa 18 s, con la pantalla congelada.
  // Las otras dos se recalculan al mostrarlas (switchDashTab), que es cuando
  // hacen falta — y siguen leyendo el MISMO período, así que no se desfasan.
  // El día a día, con los mismos envíos que acaban de dar los KPI de arriba:
  // si tuviera su propia pasada podrían discrepar, que es el bug que este
  // panel ya tuvo con el "Total a pagar".
  renderDashGraficoDiario(recordsFiltrados, labelPeriodo, esp.porDia);

  if (dashTab === 'conductores') {
    renderDashConductoresPanel(liqFecha);
    if (typeof renderConductorReport === 'function') renderConductorReport();
  } else if (dashTab === 'zonas') {
    if (typeof renderZonaReport === 'function') renderZonaReport();
  } else {
    if (typeof renderDashClientes === 'function') renderDashClientes();
  }
}

// ===== LIQUIDACIONES =====
// ── Estado filtro fechas de liquidaciones ────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD · SOLAPA CLIENTES — la renta del negocio.
//  Es el ÚNICO lugar donde se mira el margen: los paneles de Facturación
//  arman y descargan lo que se le factura al cliente, y mezclar ahí el costo
//  del conductor solo agrega ruido a esa tarea. Acá, en cambio, la pregunta
//  es justamente cuánto deja cada cliente.
// ════════════════════════════════════════════════════════════════════════

let dashTab = 'clientes';

function switchDashTab(tab) {
  dashTab = ['clientes', 'conductores', 'zonas'].indexOf(tab) >= 0 ? tab : 'clientes';
  ['clientes', 'conductores', 'zonas'].forEach(t => {
    const panel = document.getElementById('dash-tab-' + t);
    const btn = document.getElementById('dash-btn-' + t);
    if (panel) panel.style.display = (t === dashTab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === dashTab);
  });
  renderDashboard();
}

// ════════════════════════════════════════════════════════════════════════
//  LO QUE SE MOVIÓ CON CADA CLIENTE
//  Esta solapa cuenta los envíos ENTREGADOS en las fechas elegidas, con lo que
//  se le factura al cliente y lo que se le paga al conductor. El rango se usa
//  TAL CUAL: no se corre a ningún cierre, así que el mismo rango da siempre el
//  mismo número —antes se estiraba sola al jueves cuando hoy caía dentro de esa
//  semana, y el mismo rango daba $54.506.279 un miércoles y $0 dos días después.
//  Un día suelto, media semana o un mes se miran igual.
//
//  No cuenta "los períodos que CIERRAN en estas fechas", que es otra pregunta
//  —cuánto entra de plata— y vive en Liquidación de clientes y en su Historial.
//  Con ese criterio un día suelto daba $0 porque ninguna semana cierra ahí.
//
//  El filtro de abajo quedó como lo que es: un corte por CICLO del cliente
//  (semanal / quincenal / mensual), para mirar un segmento de la cartera.
// ════════════════════════════════════════════════════════════════════════
let dashPerFilter = 0;   // 0 = todos · 7 semanales · 14 quincenales · 28 mensuales
const DASH_PER_PLURAL = { 7: 'Semanales', 14: 'Quincenales', 28: 'Mensuales' };

function setDashPerFilter(dias) {
  dashPerFilter = DASH_PER_PLURAL[_num(dias)] ? _num(dias) : 0;
  renderDashboard();   // también repinta la etiqueta del período
}

function _isoDash(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _ddmmIso(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : ''; }

// NO hay ventana de cierre. El Dashboard cuenta LO QUE SE MOVIÓ entre las
// fechas elegidas —cada envío por su día de entrega, con lo que se le factura
// al cliente y lo que se le paga al conductor—, igual que las solapas de
// Conductores y de Zonas.
//
// Antes contaba el período del cliente que CERRABA dentro de las fechas. Eso
// contesta "cuánto entra de plata", que es una pregunta real, pero no la de
// este panel: un rango de un día, o media semana, daba $0 porque ninguna semana
// cierra ahí —se reportó como "el filtro por fecha no funciona"— y mirar del
// 25/09 al 30/09 mostraba $18.140.789 de cinco quincenales mientras 101
// clientes con $54.506.279 entregados quedaban en un aviso aparte. El Dashboard
// es la pantalla de lo que PASÓ. La cobranza se mira en Liquidación de clientes
// y en su Historial, que son los paneles de las facturas.
//
// De paso, el margen deja de poder mentir: facturación y costo salen ahora del
// MISMO conjunto de envíos (los entregados en el rango), así que el porcentaje
// compara dos números del mismo universo.

// Una fila de la tabla a partir de las liquidaciones de sus períodos.
function _filaRenta(cod, liqs) {
  const s = campo => liqs.reduce((t, l) => t + _num(l && l[campo]), 0);
  return {
    cod, nombre: clienteNombreDe(cod), dias: periodoDiasDe(cod),
    envios: s('totalEnvios'), factura: s('total'), costo: s('pagado'), margen: s('margen'), sinTarifa: s('sinTarifa')
  };
}

// Rango del filtro del dashboard en el formato que usa la facturación.
function _dashRangoCliente() {
  const r = getDashFechaRango();
  return { desdeD: r && r.desde ? r.desde : null, hastaD: r && r.hasta ? r.hasta : null };
}

// Renta por cliente en el período: lo facturado, lo que costó y la diferencia.
function dashRentaClientes() { return dashFacturacionClientes().filas; }

// Lo que se movió con cada cliente en las fechas elegidas: sus envíos
// entregados ahí, lo que se le factura por ellos y lo que costaron.
function dashFacturacionClientes() {
  const rango = _dashRangoCliente();
  const v = (rango.desdeD || rango.hastaD)
    ? { desde: rango.desdeD ? _isoDash(rango.desdeD) : '', hasta: rango.hastaD ? _isoDash(rango.hastaD) : '' }
    : null;
  // Una SOLA pasada agrupando los envíos por cliente, en vez de que cada
  // calcLiquidacionCliente vuelva a recorrer los 47.684. Con 121 clientes eran
  // 5,8 millones de vueltas por render y el Dashboard se congelaba 23 s.
  // El agrupado se arma acá y se descarta al terminar: nada queda cacheado, así
  // que corregir el cliente de un envío no puede quedar desfasado.
  const porCliente = new Map();
  (AppData.records || []).forEach(r => {
    const k = clienteCodDeRegistro(r);
    if (!k) return;
    let a = porCliente.get(k); if (!a) { a = []; porCliente.set(k, a); }
    a.push(r);
  });
  const vacio = [];
  const clientes = (typeof clientesDeRegistros === 'function') ? clientesDeRegistros(null) : [];
  const deEseCiclo = cod => !dashPerFilter || periodoDiasDe(cod) === dashPerFilter;
  const filas = clientes.filter(c => deEseCiclo(c.cod)).map(c => {
    const k = clienteKey(c.cod);
    // porFecha: el arrastre no mueve el envío de día —mueve en qué factura se
    // cobra— y los cargos entran por la fecha del servicio.
    return _filaRenta(k, [calcLiquidacionCliente(k, v ? rango : null,
      { registros: porCliente.get(k) || vacio, porFecha: true })]);
  }).filter(x => x.envios > 0 || x.factura > 0).sort((a, b) => b.margen - a.margen);
  return { filas, ventana: v };
}

// Qué período se está facturando en la fila: "Quincenal · 11/09 → 24/09".
// El ciclo con el que factura el cliente. Ya no se muestran fechas de período:
// la fila es lo entregado en el rango elegido, que está arriba y es el mismo
// para todos — repetirlo por fila solo haría pensar que cada uno tiene el suyo.
function _txtPeriodoFila(x) { return periodoLabel(x.dias); }

// Los botones Todos / Semanales / Quincenales y qué se está contando.
function _renderDashPerFiltro(data) {
  const cont = document.getElementById('dash-cli-per');
  if (!cont) return;
  // Mensuales solo si hay alguno: un botón que siempre da vacío es ruido.
  const hayMensual = (AppData.clientes || []).some(c => _num(c.periodo_dias) === 28) || dashPerFilter === 28;
  const opciones = [[0, 'Todos'], [7, 'Semanales'], [14, 'Quincenales']].concat(hayMensual ? [[28, 'Mensuales']] : []);
  const v = data.ventana;
  const txt = v
    ? 'Lo <strong>entregado</strong>' +
      (v.desde && v.hasta ? ' entre el ' + _ddmmIso(v.desde) + ' y el ' + _ddmmIso(v.hasta)
        : v.desde ? ' desde el ' + _ddmmIso(v.desde) : ' hasta el ' + _ddmmIso(v.hasta)) +
      ': lo que se le factura al cliente y lo que costó, por fecha de entrega — no importa si su liquidación ya cerró. ' +
      'Los botones acotan a los clientes de ese ciclo.'
    : 'Todo lo entregado. Elegí fechas para acotarlo: cuenta por <strong>día de entrega</strong>, así se puede mirar un día suelto o media semana.';
  cont.innerHTML = '<div class="card" style="margin-bottom:14px;padding:10px 14px">' +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:12.5px;font-weight:600;color:var(--text-secondary)"><i class="ic ic-calendar"></i> Facturación</span>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + opciones.map(o =>
        '<button class="btn btn-sm dash-per-btn' + (dashPerFilter === o[0] ? ' active' : '') + '" data-per="' + o[0] + '" onclick="setDashPerFilter(' + o[0] + ')">' + o[1] + '</button>'
      ).join('') + '</div>' +
      '<span style="font-size:11.5px;color:var(--text-muted);flex:1;min-width:260px">' + txt + '</span>' +
    '</div></div>';
}

function renderDashClientes() {
  const body = document.getElementById('dash-cli-body');
  if (!body) return;
  renderDashFuga();   // lo que se paga y no se cobra, antes de la renta
  const data = dashFacturacionClientes();
  const todos = data.filas;
  const v = data.ventana;
  _renderDashPerFiltro(data);
  const q = (document.getElementById('dash-cli-search')?.value || '').toLowerCase().trim();
  const lista = todos.filter(x => !q || x.nombre.toLowerCase().includes(q) || x.cod.toLowerCase().includes(q));

  const factura = todos.reduce((s, x) => s + x.factura, 0);
  const costo = todos.reduce((s, x) => s + x.costo, 0);
  const margen = factura - costo;
  const pct = factura > 0 ? (margen * 100 / factura) : 0;
  const quienes = dashPerFilter ? DASH_PER_PLURAL[dashPerFilter].toLowerCase() : '';

  const kpis = document.getElementById('dash-cli-kpis');
  if (kpis) kpis.innerHTML =
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div>' +
      '<div class="metric-label">Facturación</div><div class="metric-value">' + fmtPeso(factura) + '</div>' +
      '<div class="metric-sub">' + todos.length + ' cliente(s)' + (quienes ? ' ' + quienes : '') +
        ' con envíos entregados' + '</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-truck"></i></div>' +
      '<div class="metric-label">Costo</div><div class="metric-value">' + fmtPeso(costo) + '</div>' +
      '<div class="metric-sub">lo que se les paga a los conductores</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-trend"></i></div>' +
      '<div class="metric-label">Margen</div>' +
      '<div class="metric-value" style="color:' + (margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(margen) + '</div>' +
      '<div class="metric-sub">' + pct.toFixed(1) + '% de lo facturado</div></div>';

  // ── Quién trae la facturación ────────────────────────────────────────────
  // Con 110 clientes, una torta de 110 porciones no se lee. La pregunta real es
  // la CONCENTRACIÓN —cuánto del mes depende de los primeros— así que van los 6
  // más grandes y el resto junto en "Otros": esconderlos daría porcentajes que
  // no suman 100 y la torta mentiría.
  const torta = document.getElementById('dash-cli-torta');
  if (torta) {
    const conFactura = todos.filter(x => x.factura > 0).sort((a, b) => b.factura - a.factura);
    const TOP = 6;
    const cabeza = conFactura.slice(0, TOP);
    const resto = conFactura.slice(TOP);
    const restoMonto = resto.reduce((s, x) => s + x.factura, 0);
    const partes = cabeza.map((x, i) => ({ label: x.nombre, color: _DASH_TORTA_COLORES[i], cnt: x.factura }));
    if (restoMonto > 0) partes.push({ label: 'Otros (' + resto.length + ' clientes)', color: _DASH_TORTA_COLORES[6], cnt: restoMonto });
    const totTorta = partes.reduce((s, p) => s + p.cnt, 0);
    torta.innerHTML = !totTorta ? '' :
      '<div class="card" style="margin-top:16px"><div class="card-header"><span class="card-title">' +
        '<i class="ic ic-bar-chart"></i> Quién trae la facturación</span></div>' +
      '<div class="card-body" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">' +
        '<div style="flex-shrink:0">' +
          _dashDonut(partes, totTorta, { valor: fmtPeso(totTorta), etiqueta: 'facturado', chico: true }, fmtPeso) +
        '</div>' +
        '<div style="flex:1;min-width:220px">' +
          partes.map(p => {
            const pp = Math.round(p.cnt / totTorta * 100);
            return '<div class="dash-bar-row">' +
              '<span class="lbl"><span class="dot" style="background:' + p.color + '"></span>' + p.label + '</span>' +
              '<span class="dash-bar-track"><span class="dash-bar-fill" style="width:' + pp + '%;background:' + p.color + '"></span></span>' +
              '<span class="meta"><b style="color:' + p.color + '">' + pp + '%</b><span>' + fmtPeso(p.cnt) + '</span></span>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div></div>';
  }

  // El filtro por condición es del lado del CONDUCTOR y acá no aplica: lo que se
  // le factura a un cliente no depende de quién se lo llevó, y filtrarlo daría
  // una "facturación" que no existe en ninguna factura. Se dice, en vez de
  // dejar que el operador crea que el filtro está puesto y no hizo nada.
  const nota = document.getElementById('dash-cli-nota');
  if (nota) nota.innerHTML = dashCondFilter
    ? '<div class="alert" style="margin:0 0 14px;background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd">' +
      '<i class="ic ic-alert"></i><div>El filtro <strong>' + dashCondLabel() + '</strong> es del lado del conductor y ' +
      'acá no se aplica: lo que se le factura a un cliente no depende de quién se lo llevó. Estos números son los del período completo.</div></div>'
    : '';

  const countEl = document.getElementById('dash-cli-count');
  if (countEl) countEl.textContent = lista.length === todos.length
    ? todos.length + ' cliente(s)'
    : lista.length + ' de ' + todos.length + ' cliente(s)';

  if (!lista.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="ic ic-building"></i></div>' +
      '<div class="empty-title">' + (todos.length ? 'Sin coincidencias' : AppData._cargandoRegistros ? 'Cargando los envíos…' : v ? 'Sin envíos en estas fechas' : 'Sin clientes con envíos') + '</div>' +
      '<div class="empty-sub">' + (todos.length ? 'Ajustá el buscador'
        : AppData._cargandoRegistros ? 'La facturación se completa sola cuando terminan de bajar.'
        : v ? 'Ningún ' + (quienes ? 'cliente ' + quienes.replace(/es$/, '') : 'cliente') +
          ' tuvo envíos entregados en estas fechas. Probá con otras.'
        : 'No hay envíos con cliente en el período elegido') + '</div></div></td></tr>';
    return;
  }

  body.innerHTML = lista.map(x => {
    const p = x.factura > 0 ? Math.round(x.margen * 100 / x.factura) : 0;
    const codEsc = jsAttr(x.cod);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.nombre) + ';width:26px;height:26px;font-size:9px">' + initials(x.nombre) + '</div>' +
        '<div><strong>' + x.nombre + '</strong>' +
        (x.sinTarifa ? '<div style="font-size:10px;color:#b45309">⚠ ' + x.sinTarifa + ' sin tarifa</div>' : '') +
        '</div></div></td>' +
      '<td style="font-size:12px">' + _txtPeriodoFila(x) + '</td>' +
      '<td class="mono" style="text-align:right">' + x.envios + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(x.factura) + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--text-muted)">' + fmtPeso(x.costo) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700;color:' + (x.margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(x.margen) +
        '<div style="font-size:10px;color:var(--text-muted);font-weight:400">' + p + '%</div></td>' +
      '<td style="text-align:right"><button class="btn btn-sm" onclick="verRentaCliente(\'' + codEsc + '\')">Ver</button></td>' +
    '</tr>';
  }).join('');
}

// Renta de UN cliente, abierta por zona: dónde gana y dónde pierde. El total no
// alcanza — un cliente puede cerrar con buen margen y aun así estar perdiendo
// plata en dos zonas puntuales.
// Suma las liquidaciones de varios períodos de un cliente en una sola, juntando
// las zonas iguales (misma zona, mismo precio y misma condición especial).
function _sumarLiqsCliente(liqs) {
  if (liqs.length === 1) return liqs[0];
  const porZona = new Map();
  const out = { total: 0, pagado: 0, margen: 0, totalEnvios: 0, sinTarifa: 0, totalEnvio: 0, totalCargos: 0, filas: [] };
  liqs.forEach(l => {
    ['total', 'pagado', 'margen', 'totalEnvios', 'sinTarifa', 'totalEnvio', 'totalCargos']
      .forEach(c => { out[c] += _num(l[c]); });
    (l.filas || []).forEach(f => {
      const clave = f.zona + '|' + _num(f.precio) + '|' + (f.dim || '');
      const a = porZona.get(clave);
      if (!a) { porZona.set(clave, Object.assign({}, f)); return; }
      a.count = _num(a.count) + _num(f.count);
      a.subtotal = _num(a.subtotal) + _num(f.subtotal);
      a.pagado = _num(a.pagado) + _num(f.pagado);
    });
  });
  out.filas = Array.from(porZona.values());
  return out;
}
function verRentaCliente(cod) {
  const k = clienteKey(cod);
  // Exactamente lo mismo que la fila: las mismas fechas y el mismo criterio.
  // Si el detalle por zona mirara otra ventana, los dos totales no cerrarían y
  // el operador no tendría forma de saber cuál de los dos creer.
  const rango = _dashRangoCliente();
  const liqs = [calcLiquidacionCliente(k, (rango.desdeD || rango.hastaD) ? rango : null,
    { registros: (AppData.records || []).filter(r => clienteCodDeRegistro(r) === k), porFecha: true })];
  const liq = _sumarLiqsCliente(liqs);
  const fila = _filaRenta(k, liqs);
  const subtitulo = periodoLabel(fila.dias) + ' · ' + dashPeriodoLabel();
  const pct = liq.total > 0 ? (liq.margen * 100 / liq.total) : 0;

  const filas = liq.filas.slice().sort((a, b) => (b.subtotal - b.pagado) - (a.subtotal - a.pagado));
  const cuerpo = filas.length ? filas.map(f => {
    const m = _num(f.subtotal) - _num(f.pagado);
    const p = f.subtotal > 0 ? Math.round(m * 100 / f.subtotal) : 0;
    return '<tr>' +
      '<td>' + f.zona + (f.dim ? ' <span class="badge" style="background:#fef3c7;color:#92400e;font-size:9px">especial</span>' : '') + '</td>' +
      '<td class="mono" style="text-align:right">' + f.count + '</td>' +
      '<td class="mono" style="text-align:right">' + (f.precio > 0 ? fmtPeso(f.precio) : '<span style="color:#b45309">sin tarifa</span>') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(f.subtotal) + '</td>' +
      '<td class="mono" style="text-align:right;color:var(--text-muted)">' + fmtPeso(f.pagado) + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700;color:' + (m >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(m) +
        '<div style="font-size:10px;font-weight:400;color:var(--text-muted)">' + p + '%</div></td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">Sin envíos en el período</td></tr>';

  // Lo que vale CADA envío, de los dos lados. Es el número con el que se discute
  // una tarifa: los totales dependen del volumen y no se comparan entre clientes
  // ni entre meses, y el promedio sí.
  // El denominador son los envíos, así que arriba va lo facturado POR ENVÍOS
  // (`totalEnvio`) y no el total: una colecta o un viaje particular no son un
  // envío, y meterlos subiría un "precio por envío" que nadie cobró.
  const nEnv = _num(liq.totalEnvios);
  const ventaProm = nEnv ? _num(liq.totalEnvio) / nEnv : 0;
  const costoProm = nEnv ? _num(liq.pagado) / nEnv : 0;
  const hayCargos = _num(liq.totalCargos) > 0;

  document.getElementById('modal-title').textContent = 'Renta · ' + clienteNombreDe(k);
  document.getElementById('modal-body').innerHTML =
    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">' + subtitulo + '</div>' +
    '<div class="metrics-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:14px">' +
      '<div class="metric-card"><div class="metric-label">Facturación</div><div class="metric-value">' + fmtPeso(liq.total) + '</div>' +
        '<div class="metric-sub">' + liq.totalEnvios + ' envíos' +
        (hayCargos ? ' + ' + fmtPeso(liq.totalCargos) + ' en cargos' : '') + '</div></div>' +
      '<div class="metric-card"><div class="metric-label">Costo</div><div class="metric-value">' + fmtPeso(liq.pagado) + '</div>' +
        '<div class="metric-sub">a los conductores</div></div>' +
      '<div class="metric-card accent"><div class="metric-label">Margen</div>' +
        '<div class="metric-value" style="color:' + (liq.margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(liq.margen) + '</div>' +
        '<div class="metric-sub">' + pct.toFixed(1) + '% de lo facturado</div></div>' +
      '<div class="metric-card"><div class="metric-label">Venta promedio</div>' +
        '<div class="metric-value">' + fmtPeso(ventaProm) + '</div>' +
        '<div class="metric-sub">por envío' + (hayCargos ? ' · sin los cargos' : '') + '</div></div>' +
      '<div class="metric-card"><div class="metric-label">Costo promedio</div>' +
        '<div class="metric-value">' + fmtPeso(costoProm) + '</div>' +
        '<div class="metric-sub">por envío, al conductor</div></div>' +
    '</div>' +
    (liq.sinTarifa ? '<div class="alert" style="margin:0 0 10px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-size:12px">' +
      '<i class="ic ic-alert"></i><div><strong>' + liq.sinTarifa + ' envío(s) en zonas sin tarifa de venta.</strong> ' +
      'Se facturan en $0 pero igual se le paga al conductor: hunden el margen sin que se note.</div></div>' : '') +
    '<div class="table-wrap" style="max-height:52vh;overflow:auto"><table>' +
      '<thead><tr><th>Zona</th><th style="text-align:right">Envíos</th><th style="text-align:right">Tarifa</th>' +
      '<th style="text-align:right">Factura</th><th style="text-align:right">Costo</th><th style="text-align:right">Margen</th></tr></thead>' +
      '<tbody>' + cuerpo + '</tbody></table></div>';
  const cont = document.getElementById('modal-content');
  if (cont) cont.classList.add('modal-ancho');
  document.getElementById('modal-backdrop').classList.add('open');
}

// ════════════════════════════════════════════════════════════════════════
//  CONTROL DE FUGA — lo que se paga y no se cobra
//  Un envío entregado siempre se le paga al conductor. Que se le facture a
//  alguien depende de tres cargas separadas (que el envío traiga cliente, que
//  el cliente esté de alta y que tenga tarifa en esa zona). Si falla una, el
//  envío se factura $0 y NO aparece en la liquidación de ningún cliente: no hay
//  ningún lugar donde se note el faltante. Por eso el control va acá arriba,
//  antes de la renta, y no escondido en un filtro.
// ════════════════════════════════════════════════════════════════════════
let dashFugaAbierto = false;
function toggleDashFuga() { dashFugaAbierto = !dashFugaAbierto; renderDashFuga(); }

function renderDashFuga() {
  const cont = document.getElementById('dash-fuga');
  if (!cont || typeof conciliacionCobro !== 'function') return;
  const c = conciliacionCobro(_dashRangoCliente());

  if (!c.envios) { cont.innerHTML = ''; return; }
  // El reverso: envíos que se facturan pero cuyo conductor no tiene día de pago,
  // así que no entran en ningún lote de liquidación. Se muestra siempre, aunque
  // del otro lado esté todo bien: son dos fugas distintas.
  const rev = _bloqueSinPagar(c.sinPagar);
  if (!c.fugaEnvios) {
    cont.innerHTML = '<div class="alert" style="margin:16px 0 0;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0">' +
      '<i class="ic ic-check-circle"></i><div><strong>Todo lo que se paga se cobra</strong> — ' +
      'los ' + c.envios.toLocaleString('es-AR') + ' envíos del período se le facturan a un cliente.</div></div>' + rev;
    return;
  }

  const pct = (c.fugaEnvios * 100 / c.envios);
  const motivos = Object.entries(c.porMotivo).filter(([, v]) => v.envios > 0)
    .sort((a, b) => b[1].pagado - a[1].pagado)
    .map(([k, v]) => {
      const m = FUGA_MOTIVOS[k] || { label: k, detalle: '', color: '#b45309' };
      return '<div style="border-left:3px solid ' + m.color + ';padding:2px 0 2px 8px">' +
        '<div style="font-size:12px;font-weight:700">' + m.label + ' · ' + v.envios.toLocaleString('es-AR') + ' envío(s)</div>' +
        '<div style="font-size:11px;opacity:.85">' + fmtPeso(v.pagado) + ' pagados · ' + m.detalle + '</div></div>';
    }).join('');

  const filas = c.clientes.slice(0, 12).map(x => {
    const zonas = Array.from(x.zonas.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([z, n]) => z + ' (' + n + ')').join(', ');
    const etq = Array.from(x.motivos).map(m => (FUGA_MOTIVOS[m] || {}).label || m).join(' · ');
    return '<tr>' +
      '<td><strong>' + x.nombre + '</strong>' + (x.cod !== x.nombre ? '<div style="font-size:10px;color:var(--text-muted)">' + x.cod + '</div>' : '') + '</td>' +
      '<td style="font-size:11px">' + etq + '</td>' +
      '<td style="font-size:11px;color:var(--text-muted)">' + (zonas || '—') + '</td>' +
      '<td class="mono" style="text-align:right">' + x.envios.toLocaleString('es-AR') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.pagado) + '</td>' +
      '</tr>';
  }).join('');

  cont.innerHTML =
    '<div class="alert" style="margin:16px 0 0;background:#fff7ed;color:#9a3412;border:1px solid #fdba74">' +
    '<i class="ic ic-alert"></i><div>' +
      '<strong>' + c.fugaEnvios.toLocaleString('es-AR') + ' de ' + c.envios.toLocaleString('es-AR') +
      ' envíos (' + pct.toFixed(1) + '%) se pagan y no se le facturan a nadie</strong> — ' +
      '<strong>' + fmtPeso(c.fugaPagado) + '</strong> pagados a conductores que no se cobran. ' +
      'Esos envíos no salen en la liquidación de ningún cliente, así que no aparecen como faltante en ningún lado.' +
      '<div style="display:grid;gap:6px;margin:10px 0">' + motivos + '</div>' +
      '<button class="btn btn-sm" onclick="toggleDashFuga()">' +
        (dashFugaAbierto ? 'Ocultar el detalle' : 'Ver qué clientes son') + '</button>' +
      (dashFugaAbierto
        ? '<div class="table-wrap" style="margin-top:10px;background:var(--surface-1);border-radius:8px">' +
          '<table><thead><tr><th>Cliente</th><th>Falta</th><th>Zonas</th>' +
          '<th style="text-align:right">Envíos</th><th style="text-align:right">Pagado</th></tr></thead>' +
          '<tbody>' + filas + '</tbody></table>' +
          (c.clientes.length > 12 ? '<div style="padding:6px 10px;font-size:11px;color:var(--text-muted)">…y ' + (c.clientes.length - 12) + ' cliente(s) más</div>' : '') +
          '</div>'
        : '') +
    '</div></div>' + rev;
}

// Bloque del reverso: envíos que se facturan pero que no entran en ninguna
// liquidación de conductor. La condición (día de pago) se carga a mano en el
// Panel de conductores; sin ella el cadete no cae en ningún lote y el operador,
// que liquida por condición, nunca lo ve.
// Envíos entregados que se le facturan al cliente y que NO entran en la
// liquidación de ningún conductor. Son DOS situaciones distintas y se muestran
// separadas: el cadete sin día de pago (un dato que falta, se carga y cobra) y
// el envío sin chofer (política: no se paga, se cobra igual).
function _bloqueSinPagar(sp) {
  const mensual = _bloqueSinChofer();
  if (!sp || !sp.envios) return mensual;
  const filas = sp.conductores.slice(0, 10).map(x =>
    '<tr>' +
    '<td><strong>' + x.conductor + '</strong></td>' +
    '<td style="font-size:11px">' + (x.enPanel ? 'está en el panel, sin condición' : 'no está en el Panel de conductores') + '</td>' +
    '<td class="mono" style="text-align:right">' + x.envios.toLocaleString('es-AR') + '</td>' +
    '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(x.cobrado) + '</td>' +
    '</tr>').join('');
  return '<div class="alert" style="margin:12px 0 0;background:#eff6ff;color:#1e3a8a;border:1px solid #93c5fd">' +
    '<i class="ic ic-truck"></i><div>' +
      '<strong>' + sp.envios.toLocaleString('es-AR') + ' envíos entregados no entran en ninguna liquidación de conductor</strong> — ' +
      'se le facturan al cliente (' + fmtPeso(sp.cobrado) + ') pero el cadete que los hizo <strong>no tiene día de pago</strong>. ' +
      'La condición (Titular y Semi Titular=viernes · Suplente=martes) se carga en <strong>Panel de conductores</strong>; ' +
      'sin ella no cae en ningún lote y el operador que liquida por condición no lo ve.' +
      '<div class="table-wrap" style="margin-top:10px;background:var(--surface-1);border-radius:8px">' +
      '<table><thead><tr><th>Conductor</th><th>Qué falta</th>' +
      '<th style="text-align:right">Envíos</th><th style="text-align:right">Se factura</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table>' +
      (sp.conductores.length > 10 ? '<div style="padding:6px 10px;font-size:11px;color:var(--text-muted)">…y ' + (sp.conductores.length - 10) + ' conductor(es) más</div>' : '') +
      '</div>' +
    '</div></div>' + mensual;
}

// ── SIN CHOFER, mes a mes ───────────────────────────────────────────────
// No es un problema a resolver: es la política —asignarse el envío es
// responsabilidad del chofer, así que no se le paga a nadie y se le factura al
// cliente igual—. Lo que hace falta es el número: cuántos son cada mes y cuánta
// plata mueven. Va sobre TODA la base cargada, no sobre el filtro de arriba,
// porque lo que se mira es la tendencia — y por eso dice qué ventana está
// midiendo: con los últimos 14 días, "por mes" es medio mes.
function _bloqueSinChofer() {
  if (typeof enviosSinChoferPorMes !== 'function') return '';
  const d = enviosSinChoferPorMes();
  if (!d.envios) return '';
  const completo = !!AppData.historialCompleto;
  const ventana = completo
    ? 'Sobre el historial completo.'
    : 'Sobre los últimos ' + (typeof VENTANA_DIAS_REGISTROS !== 'undefined' ? VENTANA_DIAS_REGISTROS : 14) +
      ' días cargados — para ver los meses enteros hace falta el historial completo.';
  const filas = d.meses.slice(0, 12).map(m => {
    const top = Array.from(m.clientes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([n, c]) => n + ' (' + c + ')').join(', ');
    return '<tr>' +
      '<td><strong>' + _mesLargo(m.mes) + '</strong></td>' +
      '<td class="mono" style="text-align:right">' + m.envios.toLocaleString('es-AR') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(m.cobrado) + '</td>' +
      '<td style="font-size:11px;color:var(--text-muted)">' + (top || '—') + '</td>' +
      '</tr>';
  }).join('');
  return '<div class="alert" style="margin:12px 0 0;background:#faf5ff;color:#5b21b6;border:1px solid #d8b4fe">' +
    '<i class="ic ic-truck"></i><div>' +
      '<strong>' + d.envios.toLocaleString('es-AR') + ' envíos entregados llegaron SIN chofer asignado</strong> — ' +
      'se le facturan al cliente (' + fmtPeso(d.cobrado) + ') y <strong>no se le pagan a nadie</strong>. ' +
      'Asignarse el envío es responsabilidad del chofer: no hay nada que corregir acá, ' +
      'pero sí hay que ver cuánto pesa mes a mes.' +
      '<div style="font-size:11px;opacity:.8;margin-top:4px">' + ventana +
      (completo ? '' : ' <button class="btn btn-sm" style="padding:1px 7px;font-size:10px;margin-left:4px" onclick="cargarHistorialCompleto(this)">Cargar historial completo</button>') +
      '</div>' +
      '<div class="table-wrap" style="margin-top:10px;background:var(--surface-1);border-radius:8px">' +
      '<table><thead><tr><th>Mes</th><th style="text-align:right">Envíos</th>' +
      '<th style="text-align:right">Se factura</th><th>Clientes</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
    '</div></div>';
}

const _MESES_LARGO = ['enero','febrero','marzo','abril','mayo','junio','julio',
  'agosto','septiembre','octubre','noviembre','diciembre'];
function _mesLargo(yyyymm) {
  const p = String(yyyymm || '').split('-');
  if (p.length < 2) return yyyymm || '—';
  return _MESES_LARGO[(+p[1]) - 1] + ' ' + p[0];
}


// ════════════════════════════════════════════════════════════════════════
//  EL DÍA A DÍA DEL PERÍODO
//
//  Los KPI de arriba contestan "cuánto" y la tabla "quién", pero ninguno
//  contesta CUÁNDO: un mes que cierra bien puede tener una semana muerta y
//  otra desbordada, y en el total eso no se ve. Este gráfico es esa lectura.
//
//  Sigue a la SOLAPA, porque cada una ya pregunta otra cosa y el día a día
//  tiene que preguntar lo mismo:
//    · Clientes    — barra: margen + costo (que suman la facturación del día),
//                    línea: el margen %. Es la única solapa donde vive el margen.
//    · Conductores — barra: lo que se paga ese día, línea: el costo por envío.
//                    Mismo par que las dos tarjetas de arriba, día por día.
//    · Zonas       — barra: lo que se paga, partido en DENTRO y FUERA del
//                    tarifario, línea: el costo promedio por envío. Es el corte
//                    del reporte de zonas, que separa lo analizable del ruido.
//
//  Sale de `recordsDelDashboard()` —período Y condición— y de las MISMAS
//  funciones que pagan y facturan (`calcLiquidaciones` por conductor no sirve
//  acá porque agrupa por persona, así que se usa `precioPagadoConductor`, que
//  es lo que esa cuenta usa por envío). Si el gráfico tuviera su propia cuenta
//  terminaría contradiciendo a las tarjetas de arriba, que es exactamente el
//  bug que ya tuvo este panel.
// ════════════════════════════════════════════════════════════════════════

// Una pasada por los envíos del período, agrupando por DÍA. Devuelve los días
// en orden con todo lo que las tres solapas necesitan, para no recorrer tres
// veces los 47.684 envíos.
function _dashSerieDiaria(records) {
  const porDia = new Map();
  let sinFecha = 0;
  const dom = { n: 0, envios: 0, factura: 0, costo: 0, dias: new Set() };
  (records || []).forEach(r => {
    if (!contabilizaRegistro(r)) return;          // lo no entregado no se paga ni se cobra
    const iso = fechaISOde(r.fecha);
    // Un envío sin fecha no se puede ubicar en ningún día, pero los KPI de
    // arriba SÍ lo cuentan: si el gráfico lo salteara en silencio, su total
    // no coincidiría con la tarjeta y no habría dónde ver por qué. Se cuenta
    // y se avisa — es el mismo criterio que "cuántos envíos el tarifario no
    // alcanza" en el simulador.
    if (!iso) { sinFecha++; return; }
    const cod = (typeof clienteCodDeRegistro === 'function') ? clienteCodDeRegistro(r) : '';
    const venta = cod ? _num(precioVentaEnvio(cod, r)) : 0;
    const pago  = _num(precioPagadoConductor(r));
    // EL DOMINGO NO ES UN DÍA OPERADO. Se reparte los otros seis, y lo poco que
    // cae en domingo deforma el gráfico entero: medido en producción son el
    // 0,01% al 0,11% del volumen, y el domingo 04/10/2026 tuvo UN envío que
    // hundió la línea de margen de ~50% a -2,9% y se quedó con el rótulo "peor
    // margen" del mes. Una lectura del mes construida sobre un envío.
    // Pero la liquidación del cliente SÍ los cobra —la semana Vie→Jue son los 7
    // días de calendario—, así que no se descartan en silencio: se acumulan y
    // el gráfico dice cuánto dejó afuera.
    if (_dashEsDomingo(iso)) {
      dom.n++; dom.envios++; dom.factura += venta; dom.costo += pago;
      dom.dias.add(iso);
      return;
    }
    let d = porDia.get(iso);
    if (!d) { d = { iso, envios: 0, factura: 0, costo: 0, especial: 0, enviosLiq: 0, zonas: new Map() }; porDia.set(iso, d); }
    d.envios++;
    d.factura += venta;
    d.costo += pago;
    // EL DENOMINADOR DEL COSTO UNITARIO es el MISMO que el de la tarjeta de
    // arriba: los envíos que FORMAN la liquidación, o sea los que contabilizan
    // y tienen conductor (calcLiquidaciones saltea los que no). Contando solo
    // los que pagaron más de $0, un envío en una zona sin tarifa entraba en la
    // tarjeta y no en la línea, y las dos daban unitarios distintos para el
    // mismo día.
    const cond = (typeof conductorCanonico === 'function')
      ? conductorCanonico(r.cadete) : String((r && r.cadete) || '').trim();
    if (cond) d.enviosLiq++;
    // El corte de la solapa de Zonas: cuánto se pagó en cada una ese día. La
    // zona se resuelve por ALIAS, igual que getPrecio — si no, un envío en
    // PRESIDENTE PERON abriría una zona propia en vez de contar en GUERNICA.
    // Un envío SIN zona no se esconde: se agrupa como tal, porque es plata que
    // se pagó y en algún lugar tiene que verse.
    const z = normNombre(zonaCanonica((r.zona || '').trim() || (r.localidad || '').trim())) || '(sin zona)';
    d.zonas.set(z, _num(d.zonas.get(z)) + pago);
  });
  const dias = Array.from(porDia.values()).sort((a, b) => a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0);
  dias.sinFecha = sinFecha;
  dias.domingos = dom;
  return dias;
}

function _dashEsDomingo(iso) { return new Date(iso + 'T12:00:00').getDay() === 0; }

const _DIA_INICIAL = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
function _dashDiaInfo(iso) {
  const d = new Date(iso + 'T12:00:00');
  return { num: d.getDate(), inicial: _DIA_INICIAL[d.getDay()], domingo: d.getDay() === 0 };
}

// Las zonas que se apilan. Con 73 zonas una barra de 73 pedazos no se lee, así
// que van las más grandes del período y el resto junto — el mismo criterio que
// la torta de clientes, y por eso la misma paleta: un color significa lo mismo
// en todo el panel. Esconder la cola daría barras que no suman el total.
const _DASH_ZONAS_TOP = 5;
function _dashSeriesZonas(dias) {
  const tot = new Map();
  (dias || []).forEach(d => d.zonas.forEach((v, z) => tot.set(z, _num(tot.get(z)) + _num(v))));
  const orden = Array.from(tot.entries()).sort((a, b) => b[1] - a[1]);
  const top = orden.slice(0, _DASH_ZONAS_TOP).filter(x => x[1] > 0).map(x => x[0]);
  const resto = orden.slice(top.length).filter(x => x[1] > 0).map(x => x[0]);
  const series = top.map((z, i) => ({
    nombre: z, color: _DASH_TORTA_COLORES[i % _DASH_TORTA_COLORES.length],
    v: d => _num(d.zonas.get(z))
  }));
  if (resto.length) {
    // El resto se suma acá. Así la barra sigue siendo el total pagado del día y
    // no una parte sin rótulo.
    const set = new Set(resto);
    series.push({
      nombre: 'Otras (' + resto.length + ' zona' + (resto.length === 1 ? '' : 's') + ')',
      color: _DASH_TORTA_COLORES[_DASH_TORTA_COLORES.length - 1],
      v: d => { let a = 0; d.zonas.forEach((v2, z2) => { if (set.has(z2)) a += _num(v2); }); return a; }
    });
  }
  return series.length ? series : [{ nombre: 'Se paga', color: '#3b82f6', v: d => d.costo }];
}

// Qué grafica cada solapa. Devuelve las series apiladas (plata) y la línea.
function _dashGraficoDef(tab, dias) {
  if (tab === 'conductores') {
    // El recorrido especial va en SU PROPIA porción y no sumado adentro: es un
    // monto pactado a mano, se aprueba de a uno, y diluirlo en la barra haría
    // imposible ver un día en que pesó.
    const hayEsp = (dias || []).some(d => _num(d.especial) > 0);
    const series = [{ nombre: 'Por envío', color: '#3b82f6', v: d => d.costo }];
    if (hayEsp) series.push({ nombre: 'Recorridos especiales', color: '#8b5cf6', v: d => _num(d.especial) });
    return {
      titulo: 'Lo que se paga por día',
      series: hayEsp ? series : [{ nombre: 'Se paga', color: '#3b82f6', v: d => d.costo }],
      linea: {
        nombre: 'Costo por envío', color: '#f59e0b',
        // Con el especial adentro, igual que el "costo variable unitario" de
        // arriba: si uno lo incluyera y el otro no, la tarjeta y la línea
        // dirían dos números distintos para la misma cosa.
        v: d => d.enviosLiq ? (d.costo + _num(d.especial)) / d.enviosLiq : 0,
        fmt: v => fmtPeso(v),
        peor: 'max', peorRotulo: 'Envío más caro',
      },
      total: d => d.costo + _num(d.especial), totalRotulo: 'Se paga',
      nota: 'La barra es lo que se le paga a los conductores ese día: la tarifa de cada envío y, aparte, los recorridos especiales (el monto pactado por una ruta). El km de desvío NO entra, porque es el reintegro de un gasto y no el precio del trabajo. La línea es cuánto cuesta cada envío pagado — la misma cuenta que la tarjeta de arriba, día por día.',
    };
  }
  if (tab === 'zonas') {
    return {
      titulo: 'Lo que se paga por día, por zona',
      series: _dashSeriesZonas(dias),
      linea: {
        nombre: 'Costo promedio por envío', color: '#f59e0b',
        v: d => d.enviosLiq ? d.costo / d.enviosLiq : 0,
        fmt: v => fmtPeso(v),
        peor: 'max', peorRotulo: 'Envío más caro',
      },
      total: d => d.costo, totalRotulo: 'Se paga',
      // Lo que cae en una zona que no está en el tarifario se paga $0, así que
      // acá no se vería: eso se mira en el reporte de abajo, que lo cuenta por
      // envíos en su fila "Fuera del tarifario". Una serie en $0 haría creer
      // que no hay nada que corregir.
      nota: 'La barra entera es lo que se paga ese día, repartido por zona. Los recorridos especiales no aparecen acá: son una ruta pactada a monto fijo y no tienen una zona a la que atribuirlos — se ven en la solapa Conductores. Para ver qué cayó en zonas que no están en el tarifario, el reporte de abajo lo cuenta aparte.',
    };
  }
  return {
    titulo: 'Facturación por día',
    series: [
      { nombre: 'Costo',  color: '#3b82f6', v: d => d.costo },
      { nombre: 'Margen', color: '#10b981', v: d => Math.max(0, d.factura - d.costo) },
    ],
    linea: {
      nombre: 'Margen %', color: '#f59e0b',
      v: d => d.factura > 0 ? (d.factura - d.costo) / d.factura * 100 : 0,
      fmt: v => v.toFixed(1).replace('.', ',') + '%',
      peor: 'min', peorRotulo: 'Peor margen',
    },
    total: d => d.factura, totalRotulo: 'Facturado',
    nota: 'La barra entera es lo que se le factura a los clientes ese día: abajo lo que costó y arriba lo que quedó. El costo es la tarifa de los envíos de ese cliente; los recorridos especiales no son de ningún cliente y se miran en la solapa Conductores. La línea es el margen del día — un día puede facturar mucho y dejar poco.',
  };
}

// El gráfico. SVG a mano, igual que el donut: el proyecto no lleva librerías y
// una de gráficos entera por un combinado de barras y línea no se paga.
function _dashGraficoDiario(datos, def, periodoTxt) {
  const n = datos.length;
  if (!n) {
    return '<div class="card" style="padding:28px;text-align:center;color:var(--text-muted)">' +
      (datos.sinFecha
        ? datos.sinFecha + ' envío(s) del período no tienen fecha, así que no se pueden ubicar en ningún día.'
        : (datos.domingos && datos.domingos.envios)
          ? 'En el período solo hubo envíos en domingo, que no es un día operado y no se grafica.'
          : 'Sin envíos en el período para graficar.') + '</div>';
  }
  // Geometría. El ancho es fijo y el SVG escala solo (viewBox): así una barra
  // no cambia de grosor según el tamaño de la ventana.
  const W = 1000, H = 300, mT = 28, mB = 34, mL = 72, mR = 64;
  const ancho = W - mL - mR, alto = H - mT - mB;
  const paso = ancho / n;
  const wBarra = Math.max(3, Math.min(34, paso * 0.62));

  // La PILA es lo que se dibuja; el TOTAL es lo que ese día vale de verdad.
  // Coinciden siempre salvo un día a pérdida en la solapa de Clientes.
  const pilaDe  = d => def.series.reduce((s, x) => s + _num(x.v(d)), 0);
  const totalDe = d => def.total ? _num(def.total(d)) : pilaDe(d);
  const maxBarra = Math.max(1, ...datos.map(pilaDe));
  const valLinea = datos.map(d => _num(def.linea.v(d)));
  const maxLinea = Math.max(1, ...valLinea);

  // Escalas "lindas": el tope sube al siguiente número redondo para que las
  // guías caigan en valores que se puedan leer.
  const techo = v => { const e = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / (e / 2)) * (e / 2); };
  const topB = techo(maxBarra), topL = techo(maxLinea * 1.12);
  const yB = v => mT + alto - (v / topB) * alto;
  const yL = v => mT + alto - (v / topL) * alto;
  const xC = i => mL + paso * i + paso / 2;

  // Guías horizontales con su valor a los dos lados.
  const LINEAS = 4;
  let guias = '';
  for (let g = 0; g <= LINEAS; g++) {
    const y = mT + alto - (alto * g / LINEAS);
    guias += '<line x1="' + mL + '" y1="' + y.toFixed(1) + '" x2="' + (W - mR) + '" y2="' + y.toFixed(1) +
      '" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>' +
      '<text x="' + (mL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" style="font-size:10px;fill:var(--text-muted)">' +
        _dashMiles(topB * g / LINEAS) + '</text>' +
      '<text x="' + (W - mR + 8) + '" y="' + (y + 3.5).toFixed(1) + '" style="font-size:10px;fill:' + def.linea.color + '">' +
        def.linea.fmt(topL * g / LINEAS) + '</text>';
  }

  // Barras apiladas. Cada una lleva su <title>: el detalle del día sin salir
  // del gráfico, que es lo que se consulta cuando una barra llama la atención.
  // El total va ARRIBA de la barra: el apilado dice de qué está hecho el día,
  // pero la pregunta es cuánto facturó, y leerlo contra el eje es aproximar.
  // Se escribe completo si entra, abreviado si no, y con muchos días no se
  // escribe: el tooltip lo sigue teniendo y 30 números pisados no se leen.
  const rotTotal = paso >= 86 ? (v => fmtPeso(v)) : paso >= 40 ? (v => _dashMiles(v)) : null;
  let barras = '', etqTotal = '';
  datos.forEach((d, i) => {
    const x = xC(i) - wBarra / 2;
    let acum = 0;
    const pila = pilaDe(d), tot = totalDe(d);
    // Si lo facturado no llega a cubrir lo que costó, el día fue a pérdida: la
    // barra es el costo y decirlo es la única forma de que el número de arriba
    // y el dibujo no se contradigan.
    const perdida = Math.round(tot) < Math.round(pila);
    const det = def.series.map(s => s.nombre + ': ' + fmtPeso(_num(s.v(d)))).join(' · ');
    def.series.forEach(s => {
      const val = _num(s.v(d));
      if (val <= 0) return;
      const h = (val / topB) * alto;
      acum += h;
      barras += '<rect x="' + x.toFixed(1) + '" y="' + (mT + alto - acum).toFixed(1) + '" width="' + wBarra.toFixed(1) +
        '" height="' + h.toFixed(1) + '" fill="' + s.color + '" rx="1">' +
        '<title>' + _dashFechaLarga(d.iso) + ' — ' + (def.totalRotulo || 'Total') + ': ' + fmtPeso(tot) +
          ' · ' + det + ' · ' + d.envios + ' envíos · ' +
          def.linea.nombre + ': ' + def.linea.fmt(_num(def.linea.v(d))) +
          (perdida ? ' · a pérdida: se facturó menos de lo que costó' : '') + '</title></rect>';
    });
    if (rotTotal && tot > 0) {
      etqTotal += '<text x="' + xC(i).toFixed(1) + '" y="' + (mT + alto - acum - 6).toFixed(1) +
        '" text-anchor="middle" style="font-size:9.5px;font-weight:600;fill:' +
        (perdida ? 'var(--warning)' : 'var(--text-secondary)') + '">' +
        (perdida ? '⚠ ' : '') + rotTotal(tot) + '</text>';
    }
  });

  // La línea del eje derecho, con su punto por día.
  const pts = datos.map((d, D) => xC(D).toFixed(1) + ',' + yL(valLinea[D]).toFixed(1)).join(' ');
  const linea = '<polyline points="' + pts + '" fill="none" stroke="' + def.linea.color + '" stroke-width="1.8"/>' +
    datos.map((d, i) => '<circle cx="' + xC(i).toFixed(1) + '" cy="' + yL(valLinea[i]).toFixed(1) +
      '" r="2.8" fill="' + def.linea.color + '"><title>' + _dashFechaLarga(d.iso) + ' — ' +
      def.linea.nombre + ': ' + def.linea.fmt(valLinea[i]) + '</title></circle>').join('');

  // Las etiquetas de abajo llevan la INICIAL del día: con 26 barras, "7" no
  // dice si fue lunes o sábado, y el pico de los lunes es media lectura del
  // gráfico. Con muchos días se saltean para que no se pisen.
  const cadaN = Math.ceil(n / 32);
  const etiquetas = datos.map((d, i) => {
    if (i % cadaN !== 0) return '';
    const inf = _dashDiaInfo(d.iso);
    return '<text x="' + xC(i).toFixed(1) + '" y="' + (H - mB + 20) + '" text-anchor="middle" ' +
      'style="font-size:10px;fill:var(--text-muted)">' + inf.inicial + ' ' + inf.num + '</text>';
  }).join('');

  const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" ' +
    'aria-label="' + def.titulo + '" style="display:block">' +
    // El rótulo va DESPUÉS de la línea: dibujado antes, el punto naranja le
    // pasa por encima y el número del día queda tapado justo en los días que
    // más llaman la atención.
    guias + barras + linea + etqTotal + etiquetas +
    '<line x1="' + mL + '" y1="' + (mT + alto) + '" x2="' + (W - mR) + '" y2="' + (mT + alto) +
      '" stroke="var(--border)" stroke-width="1"/></svg>';

  // El pie: el día que más movió y el que peor salió. Son las dos preguntas que
  // se le hacen a un gráfico así, y leerlas de las barras a ojo no se puede.
  // Qué es "peor" depende de la línea y lo dice la solapa: el margen más bajo,
  // pero el costo por envío más ALTO. Con el mínimo para las dos, la solapa de
  // conductores rotulaba como peor día el más barato.
  const peorAlto = def.linea.peor === 'max';
  let mejorI = 0, peorI = 0;
  datos.forEach((d, i) => {
    if (totalDe(d) > totalDe(datos[mejorI])) mejorI = i;
    if (peorAlto ? valLinea[i] > valLinea[peorI] : valLinea[i] < valLinea[peorI]) peorI = i;
  });
  const pico = datos[mejorI];
  const leyenda = def.series.map(s =>
    '<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px">' +
      '<span style="width:10px;height:10px;border-radius:2px;background:' + s.color + ';display:inline-block"></span>' +
      s.nombre + '</span>').join('') +
    '<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' + def.linea.color + ';display:inline-block"></span>' +
      def.linea.nombre + ' (eje derecho)</span>';

  // Lo que el gráfico no pudo ubicar en ningún día. Va arriba, al lado del
  // período: es lo que explica que la suma de las barras no dé exactamente el
  // número de la tarjeta.
  const avisoSF = datos.sinFecha
    ? '<span style="font-size:11.5px;color:var(--warning)"><i class="ic ic-alert"></i> ' +
        datos.sinFecha + (datos.sinFecha === 1 ? ' envío sin fecha no se grafica' : ' envíos sin fecha no se grafican') +
        ' (sí cuentan en las tarjetas de arriba)</span>'
    : '';

  // Los domingos quedaron afuera por no ser días operados, pero se facturan y
  // se pagan igual: se dice cuánto fue, con el mismo criterio que los envíos
  // sin fecha. Si no hubo ninguno, no se dice nada — un aviso que aparece
  // siempre deja de leerse.
  const dom = datos.domingos;
  const avisoDom = (dom && dom.envios)
    ? '<span style="font-size:11.5px;color:var(--text-muted)" title="El domingo no es un día operado: se excluye para que lo poco que cae ahí no deforme el gráfico. La liquidación del cliente sí los cobra.">' +
        'No se grafican los domingos (' + dom.dias.size + (dom.dias.size === 1 ? ' domingo · ' : ' domingos · ') +
        dom.envios + (dom.envios === 1 ? ' envío · ' : ' envíos · ') +
        (def.total && def.totalRotulo === 'Facturado' ? fmtPeso(dom.factura) : fmtPeso(dom.costo)) + ')</span>'
    : '';

  return '<div class="card" style="margin-bottom:14px;padding:14px 16px">' +
    '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px">' +
      '<strong style="font-size:14px"><i class="ic ic-trend"></i> ' + def.titulo + '</strong>' +
      '<span style="font-size:12px;color:var(--text-muted)">' + periodoTxt + ' · ' + n +
        (n === 1 ? ' día' : ' días') + ' · pico ' + fmtPeso(totalDe(pico)) + '</span>' +
      avisoSF + avisoDom +
    '</div>' +
    svg +
    '<div style="font-size:11.5px;color:var(--text-secondary);margin-top:8px">' + leyenda +
      '<span style="color:var(--text-muted)">' + def.nota + '</span></div>' +
    '<div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">' +
      'Día más movido: <strong>' + _dashFechaLarga(pico.iso) + '</strong> (' + fmtPeso(totalDe(pico)) + ')' +
      (n > 1 ? ' · ' + (def.linea.peorRotulo || 'Peor ' + def.linea.nombre.toLowerCase()) + ': <strong>' + _dashFechaLarga(datos[peorI].iso) +
        '</strong> (' + def.linea.fmt(valLinea[peorI]) + ')' : '') +
    '</div></div>';
}

// $1.234.567 → "1,2 M" para el eje, que con el número entero no entra.
function _dashMiles(v) {
  const n = _num(v);
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + ' M';
  if (n >= 1000) return Math.round(n / 1000) + ' k';
  return String(Math.round(n));
}
const _DASH_MESES_L = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function _dashFechaLarga(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.getDate() + ' de ' + _DASH_MESES_L[d.getMonth()];
}

// Lo pinta en el contenedor que vive arriba de las solapas. Se llama desde
// renderDashboard con los MISMOS envíos que alimentan los KPI.
function renderDashGraficoDiario(records, periodoTxt, especialesPorDia) {
  const cont = document.getElementById('dash-grafico-dia');
  if (!cont) return;
  const datos = _dashSerieDiaria(records);
  // Los recorridos especiales se cargan por conductor y día, no por envío, así
  // que no salen de la pasada por los recorridos: se pegan acá, al día que les
  // corresponde. Un especial en un día sin envíos no abre un día nuevo —no
  // habría contra qué leerlo— y queda contado igual en el KPI de arriba.
  if (especialesPorDia && especialesPorDia.size) {
    datos.forEach(d => { d.especial = _num(especialesPorDia.get(d.iso)); });
  }
  cont.innerHTML = _dashGraficoDiario(datos, _dashGraficoDef(dashTab, datos), periodoTxt || '');
}
