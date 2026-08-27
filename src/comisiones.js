// ════════════════════════════════════════════════════════════════════════
//  COMISIONES — comisiones de vendedores por clientes nuevos.
//
//  Regla de negocio:
//   • Un cliente NUEVO se asigna a un VENDEDOR.
//   • Se evalúan las PRIMERAS 4 LIQUIDACIONES del cliente (semanas Vie→Jue):
//     la facturación total de esas 4 semanas define, según la ESCALA importada
//     (rango de facturación → categoría → monto fijo), un MONTO FIJO mensual.
//   • Ese monto se paga al vendedor durante 5 MESES (los primeros 5 del cliente).
//   • El SUPERVISOR único cobra un % (default 30%) del total comisionado por
//     todo el equipo de vendedores.
//   • Al cierre de cada mes se marcan las comisiones como pagadas y se descarga
//     el PDF. (La app registra el pago; no mueve plata.)
//
//  Depende de helpers de clientes.js (calcLiquidacionCliente, semanaClienteRango,
//  normCliente) y de core.js (fmtPeso, avatarColor, initials, parseFechaReg, _num).
// ════════════════════════════════════════════════════════════════════════

const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// ── Helpers de mes (YYYY-MM) ────────────────────────────────────────────────
function isoDeFecha(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function mesDeFechaD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function mesActualYYYYMM() { return mesDeFechaD(new Date()); }
function addMeses(yyyymm, n) {
  const p = String(yyyymm || '').split('-'); const y = +p[0], m = +p[1];
  if (!y || !m) return yyyymm;
  const d = new Date(y, (m - 1) + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function mesLabel(yyyymm) {
  const p = String(yyyymm || '').split('-'); const y = +p[0], m = +p[1];
  if (!y || !m) return '—';
  return (MESES_ES[m - 1] || '?') + ' ' + y;
}

// ── Config del supervisor ───────────────────────────────────────────────────
function supervisorName() { return (AppData.config && AppData.config.comision_supervisor) || ''; }
function supervisorPct() { const n = parseFloat(AppData.config && AppData.config.comision_supervisor_pct); return isNaN(n) ? 30 : n; }

// ── Evaluación de un cliente: sus 4 PRIMERAS FACTURAS ───────────────────────
// Se evaluaba por calendario —4 semanas desde el primer envío— y eso no es lo
// que se evalúa: lo que cuenta son las 4 primeras FACTURAS emitidas, que el
// operador contabiliza desde "Liquidación de clientes". Un cliente quincenal, o
// uno que tuvo una semana sin envíos, nunca cerraba bien su evaluación con la
// cuenta por calendario, y encima esa cuenta se movía sola: cualquier corrección
// de zona meses después cambiaba la facturación evaluada y podía recategorizarlo.
const FACTURAS_EVALUACION = 4;

// El código con el que factura un cliente del régimen de comisiones. La fila de
// comisión guarda el NOMBRE y las liquidaciones el código, así que se resuelve
// por el maestro y se lleva a la cuenta canónica: un cliente con varias cuentas
// factura junto y sus facturas tienen que contar juntas.
function comisionCodDe(cliente) {
  const c = (AppData.clientes || []).find(x => normCliente(x.nombre) === normCliente(cliente));
  return clienteCodCanonico(clienteKey(c ? c.codigo : cliente));
}

// La fila de comisión de un cliente, buscada por su código de facturación.
function comisionPorCod(cod) {
  const k = clienteCodCanonico(clienteKey(cod));
  return (AppData.comisionClientes || []).find(c => comisionCodDe(c.cliente) === k) || null;
}

// Las liquidaciones contabilizadas de un cliente, de la más vieja a la más nueva.
function facturasComisionDe(cliente) {
  const k = comisionCodDe(cliente);
  return (AppData.clienteLiquidaciones || [])
    .filter(x => x.cuenta_comision && clienteCodCanonico(clienteKey(x.cliente_cod)) === k)
    .sort((a, b) => String(a.semana_hasta).localeCompare(String(b.semana_hasta)));
}

// Categoría (y monto) que le corresponde a una facturación según la escala.
function categoriaDeFacturacion(fact) {
  const cats = AppData.comisionCategorias.slice().sort((a, b) => a.fact_desde - b.fact_desde);
  let match = null;
  cats.forEach(c => {
    const okDesde = fact >= _num(c.fact_desde);
    const okHasta = (c.fact_hasta === null || c.fact_hasta === undefined || c.fact_hasta === '') ? true : fact <= _num(c.fact_hasta);
    if (okDesde && okHasta) match = c; // en orden asc, gana el de mayor fact_desde
  });
  return match;
}

// Evaluación en vivo: cuántas facturas lleva contabilizadas, cuánto suman y qué
// categoría le tocaría. Cierra recién en la 4.ª.
function evalComisionCliente(cliente) {
  const tieneEscala = AppData.comisionCategorias.length > 0;
  const todas = facturasComisionDe(cliente);
  const usadas = todas.slice(0, FACTURAS_EVALUACION);
  const facturacion = usadas.reduce((s, f) => s + _num(f.monto), 0);
  const completo = usadas.length >= FACTURAS_EVALUACION;
  const cat = completo ? categoriaDeFacturacion(facturacion) : null;
  return {
    facturacion, facturas: usadas.length, faltan: Math.max(0, FACTURAS_EVALUACION - usadas.length),
    ultima: usadas.length ? usadas[usadas.length - 1] : null,
    desde: usadas.length ? String(usadas[0].semana_desde || '').slice(0, 10) : '',
    hasta: usadas.length ? String(usadas[usadas.length - 1].semana_hasta || '').slice(0, 10) : '',
    categoria: cat ? cat.categoria : '', monto: cat ? _num(cat.monto) : 0,
    completo, tieneEscala,
  };
}

// Primer mes de pago por defecto: el mes SIGUIENTE al de la 4.ª factura. La
// evaluación puede cerrar a mitad de mes y ese mes ya está corriendo, así que
// se abona siempre desde el siguiente.
function mesInicioDefaultCliente(cliente) {
  const ev = evalComisionCliente(cliente);
  if (!ev.completo || !ev.hasta) return addMeses(mesActualYYYYMM(), 1);
  return addMeses(ev.hasta.slice(0, 7), 1);
}

// Los 5 meses de pago de una fila de comisión.
function mesesPagoComision(row) {
  const mi = row.mes_inicio || mesInicioDefaultCliente(row.cliente);
  const arr = [];
  for (let i = 0; i < 5; i++) arr.push(addMeses(mi, i));
  return arr;
}
// Último mes que se cobra (el 5.º). Después de ese mes la comisión ya no corre.
function mesFinComision(row) { return addMeses(row.mes_inicio || mesInicioDefaultCliente(row.cliente), 4); }

// Cuántos de los 5 pagos le faltan, contado desde el mes en curso. Es lo que se
// mira para saber a quién se le está por terminar la comisión: sobre 40 filas,
// restar meses a ojo no es algo que nadie vaya a hacer.
function pagosRestantes(row) {
  if (!row.bloqueado) return null;
  const meses = mesesPagoComision(row);
  const hoy = mesActualYYYYMM();
  if (hoy < meses[0]) return { estado: 'porArrancar', quedan: 5, mes: meses[0] };
  if (hoy > meses[4]) return { estado: 'terminado', quedan: 0, mes: meses[4] };
  const i = meses.indexOf(hoy);
  return { estado: 'enCurso', quedan: 5 - i, nro: i + 1 };
}

// ── Estado del cliente en comisión ──────────────────────────────────────────
// `activo` comisiona; `baja` es el cliente que se perdió: deja de comisionar
// desde su mes de baja (inclusive) pero la fila NO se borra. El vendedor tiene
// que poder ver POR QUÉ dejó de cobrar por ese cliente, y quitarlo del registro
// haría desaparecer la explicación junto con el dato.
function comisionEsBaja(row) { return String(row.estado || 'activo').toLowerCase() === 'baja'; }

// Desde qué mes deja de comisionar, según CUÁNDO se dio de baja el cliente.
// Antes del 15 el mes no se paga; del 15 en adelante el cliente estuvo la mitad
// del mes y esa comisión se cobra, así que el corte pasa al mes siguiente.
const BAJA_DIA_CORTE = 15;
function mesBajaDeFecha(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const mes = s.slice(0, 7);
  return (+s.slice(8, 10) < BAJA_DIA_CORTE) ? mes : addMeses(mes, 1);
}
// ¿Corresponde comisión de esta fila en `periodo`?
function comisionaEnMes(row, periodo) {
  if (!mesesPagoComision(row).includes(periodo)) return false;
  if (!comisionEsBaja(row)) return true;
  const mb = row.mes_baja || '';
  return mb ? periodo < mb : false;   // sin mes cargado, la baja corta desde siempre
}

// ── Cálculo de comisiones de un mes (solo filas confirmadas/bloqueadas) ─────
function calcComisionesMes(periodo) {
  const porVend = {};
  const bajas = [];
  const fuera = [];
  AppData.comisionClientes.forEach(row => {
    if (!row.bloqueado) return;
    const meses = mesesPagoComision(row);
    // Un cliente fuera de su ventana simplemente no aparecía, así que comparar
    // contra la planilla vieja dejaba faltantes imposibles de rastrear. Se
    // listan aparte con el motivo: o todavía no arrancó, o ya cumplió sus 5.
    if (!meses.includes(periodo)) {
      fuera.push({ cliente: row.cliente, vendedor: row.vendedor || '(sin vendedor)',
        monto: _num(row.monto), categoria: row.categoria || '',
        desde: meses[0], hasta: meses[4], antes: periodo < meses[0] });
      return;
    }
    const v = row.vendedor || '(sin vendedor)';
    const nroMes = meses.indexOf(periodo) + 1;
    // Los de baja caen dentro de la ventana de 5 meses pero cobran $0. Se listan
    // igual, como en la planilla: un renglón que desaparece se lee como un error
    // de cálculo, y el vendedor no tendría dónde ver que perdió al cliente.
    if (!comisionaEnMes(row, periodo)) {
      bajas.push({ vendedor: v, cliente: row.cliente, categoria: row.categoria || '', nroMes, mesBaja: row.mes_baja || '', motivo: row.motivo_baja || '' });
      return;
    }
    const monto = _num(row.monto);
    if (monto <= 0) return;
    if (!porVend[v]) porVend[v] = { vendedor: v, clientes: [], monto: 0 };
    porVend[v].clientes.push({ cliente: row.cliente, monto, categoria: row.categoria, nroMes });
    porVend[v].monto += monto;
  });
  const vendedores = Object.values(porVend).sort((a, b) => b.monto - a.monto);
  const totalVendedores = vendedores.reduce((s, v) => s + v.monto, 0);
  const pct = supervisorPct();
  const supNombre = supervisorName();
  // Sin redondear: el % del equipo cae en centavos y el pago registrado tiene que
  // guardar lo que realmente corresponde (fmtPeso ya redondea al mostrarlo).
  const supMonto = totalVendedores * pct / 100;
  bajas.sort((a, b) => String(a.vendedor).localeCompare(String(b.vendedor)) || String(a.cliente).localeCompare(String(b.cliente)));
  fuera.sort((a, b) => (a.antes === b.antes ? 0 : (a.antes ? -1 : 1)) || String(a.desde).localeCompare(String(b.desde)) || String(a.cliente).localeCompare(String(b.cliente)));
  return { vendedores, totalVendedores, supNombre, supMonto, pct, total: totalVendedores + supMonto, bajas, fuera };
}

// El supervisor puede ser TAMBIÉN vendedor (cobra por sus propios clientes y
// además el % del equipo), así que el pago se identifica por su TIPO: sin eso,
// marcar uno de los dos como pagado dejaba el otro tildado sin haberlo abonado.
function comisionPagoDe(periodo, beneficiario, tipo) {
  return AppData.comisionPagos.find(p => p.periodo === periodo
    && normNombre(p.beneficiario) === normNombre(beneficiario)
    && (tipo ? (p.tipo || 'vendedor') === tipo : true));
}

// ── Persistencia local ──────────────────────────────────────────────────────
function persistirComisionesLocal() {
  try {
    localStorage.setItem('liq_vendedores', JSON.stringify(AppData.vendedores));
    localStorage.setItem('liq_comision_categorias', JSON.stringify(AppData.comisionCategorias));
    localStorage.setItem('liq_comision_clientes', JSON.stringify(AppData.comisionClientes));
    localStorage.setItem('liq_comision_pagos', JSON.stringify(AppData.comisionPagos));
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════════════════
//  SOLAPAS
// ════════════════════════════════════════════════════════════════════════
function switchComisionesTab(tab) {
  ['vend', 'clientes', 'cierre'].forEach(t => {
    const panel = document.getElementById('com-tab-' + t);
    const btn = document.getElementById('com-btn-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'vend') renderVendedoresYEscala();
  else if (tab === 'clientes') renderComisionClientes();
  else renderCierreMensual();
}

function renderComisiones() { switchComisionesTab('vend'); }

// ════════════════════════════════════════════════════════════════════════
//  TAB 1 — VENDEDORES + SUPERVISOR + ESCALA
// ════════════════════════════════════════════════════════════════════════
function renderVendedoresYEscala() {
  // Supervisor
  const sn = document.getElementById('com-sup-nombre');
  const sp = document.getElementById('com-sup-pct');
  if (sn && document.activeElement !== sn) sn.value = supervisorName();
  if (sp && document.activeElement !== sp) sp.value = supervisorPct();

  // Vendedores
  const cont = document.getElementById('com-vend-rows');
  if (cont) {
    const lista = AppData.vendedores.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    const cEl = document.getElementById('com-vend-count');
    if (cEl) cEl.textContent = AppData.vendedores.length + ' vendedor' + (AppData.vendedores.length !== 1 ? 'es' : '');
    if (!lista.length) {
      cont.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="empty-icon"><i class="ic ic-user"></i></div><div class="empty-title">Sin vendedores</div><div class="empty-sub">Agregá uno con "+ Nuevo vendedor"</div></div></td></tr>';
    } else {
      cont.innerHTML = lista.map(v => {
        const nCli = AppData.comisionClientes.filter(c => normNombre(c.vendedor) === normNombre(v.nombre)).length;
        return '<tr' + (v.activo === false ? ' style="opacity:.55"' : '') + '>' +
          '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(v.nombre) + ';width:28px;height:28px;font-size:10px">' + initials(v.nombre) + '</div><strong>' + v.nombre + '</strong></div></td>' +
          '<td class="mono" style="text-align:right">' + nCli + ' cliente' + (nCli !== 1 ? 's' : '') + '</td>' +
          '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
            '<button class="btn btn-sm" onclick="editVendedor(' + v.id + ')" title="Editar"><i class="ic ic-edit"></i></button>' +
            '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarVendedor(' + v.id + ')"><i class="ic ic-trash"></i></button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    }
  }

  // Escala
  const esc = document.getElementById('com-escala-rows');
  if (esc) {
    const cats = AppData.comisionCategorias.slice().sort((a, b) => _num(a.fact_desde) - _num(b.fact_desde));
    if (!cats.length) {
      esc.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon"><i class="ic ic-tag"></i></div><div class="empty-title">Sin escala cargada</div><div class="empty-sub">Importá la escala de categorización (Categoría · Desde · Hasta · Monto)</div></div></td></tr>';
    } else {
      esc.innerHTML = cats.map(c =>
        '<tr>' +
          '<td><strong>' + c.categoria + '</strong></td>' +
          '<td class="mono" style="text-align:right">' + fmtPeso(_num(c.fact_desde)) + '</td>' +
          '<td class="mono" style="text-align:right">' + ((c.fact_hasta === null || c.fact_hasta === undefined || c.fact_hasta === '') ? '<span class="muted">sin tope</span>' : fmtPeso(_num(c.fact_hasta))) + '</td>' +
          '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(_num(c.monto)) + '</td>' +
        '</tr>').join('');
    }
  }
}

async function guardarSupervisorConfig() {
  const nombre = (document.getElementById('com-sup-nombre').value || '').trim().toUpperCase();
  let pct = parseFloat(document.getElementById('com-sup-pct').value);
  if (isNaN(pct) || pct < 0) pct = 30;
  try {
    await DB.setConfig('comision_supervisor', nombre);
    await DB.setConfig('comision_supervisor_pct', String(pct));
    AppData.config.comision_supervisor = nombre;
    AppData.config.comision_supervisor_pct = String(pct);
    try { localStorage.setItem('liq_config', JSON.stringify(AppData.config)); } catch (e) {}
    showToast('✅ Supervisor guardado (' + (nombre || 'sin nombre') + ' · ' + pct + '%)');
  } catch (e) { console.warn('guardarSupervisorConfig', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

// ── ABM vendedor ─────────────────────────────────────────────────────────────
let vendedorEditId = null;
function openAddVendedorModal() {
  vendedorEditId = null;
  document.getElementById('modal-vendedor-title').textContent = 'Nuevo vendedor';
  document.getElementById('mven-nombre').value = '';
  document.getElementById('modal-vendedor-backdrop').style.display = 'flex';
}
function editVendedor(id) {
  const v = AppData.vendedores.find(x => x.id === id);
  if (!v) return;
  vendedorEditId = id;
  document.getElementById('modal-vendedor-title').textContent = 'Editar vendedor';
  document.getElementById('mven-nombre').value = v.nombre || '';
  document.getElementById('modal-vendedor-backdrop').style.display = 'flex';
}
function closeVendedorModal(e) {
  if (!e || e.target.id === 'modal-vendedor-backdrop') document.getElementById('modal-vendedor-backdrop').style.display = 'none';
}
async function guardarVendedorModal() {
  const nombre = (document.getElementById('mven-nombre').value || '').trim().toUpperCase();
  if (!nombre) { alert('El nombre del vendedor es obligatorio.'); return; }
  const dup = AppData.vendedores.find(v => normNombre(v.nombre) === normNombre(nombre) && v.id !== vendedorEditId);
  if (dup) { alert('Ya existe un vendedor "' + nombre + '".'); return; }
  try {
    if (vendedorEditId != null) {
      const anterior = AppData.vendedores.find(x => x.id === vendedorEditId);
      const nombreAnterior = anterior ? anterior.nombre : '';
      await DB.updateWhere('vendedores', 'id', vendedorEditId, { nombre });
      if (anterior) anterior.nombre = nombre;
      // Propagar el rename a las asignaciones de comisión.
      if (nombreAnterior && normNombre(nombreAnterior) !== normNombre(nombre)) {
        for (const cc of AppData.comisionClientes.filter(c => normNombre(c.vendedor) === normNombre(nombreAnterior))) {
          try { await DB.updateWhere('comision_clientes', 'id', cc.id, { vendedor: nombre }); cc.vendedor = nombre; } catch (e) {}
        }
      }
    } else {
      const row = await DB.insertRow('vendedores', { nombre, activo: true });
      AppData.vendedores.push({ id: row.id, nombre, activo: true });
    }
    persistirComisionesLocal();
    vendedorEditId = null;
    document.getElementById('modal-vendedor-backdrop').style.display = 'none';
    renderVendedoresYEscala();
    showToast('✅ Vendedor guardado');
  } catch (e) { console.warn('guardarVendedorModal', e); alert('No se pudo guardar: ' + (e.message || e)); }
}
async function eliminarVendedor(id) {
  const v = AppData.vendedores.find(x => x.id === id);
  if (!v) return;
  const nCli = AppData.comisionClientes.filter(c => normNombre(c.vendedor) === normNombre(v.nombre)).length;
  if (!confirm('¿Eliminar al vendedor ' + v.nombre + '?' + (nCli ? '\nTiene ' + nCli + ' cliente(s) asignado(s); esas asignaciones quedarán sin vendedor válido.' : ''))) return;
  try {
    await DB.deleteWhere('vendedores', 'id', id);
    AppData.vendedores = AppData.vendedores.filter(x => x.id !== id);
    persistirComisionesLocal();
    renderVendedoresYEscala();
    showToast('🗑 Vendedor eliminado');
  } catch (e) { console.warn('eliminarVendedor', e); showToast('⛔ No se pudo eliminar'); }
}

// ── Import de la escala de categorización ────────────────────────────────────
function descargarPlantillaEscala() {
  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por categoría. "Desde/Hasta" = rango de facturación de las 4 primeras liquidaciones. "Hasta" vacío = sin tope. "Monto" = comisión fija mensual.'],
    ['Categoria', 'Desde', 'Hasta', 'Monto'],
    ['A', 0, 500000, 30000],
    ['B', 500000, 1500000, 60000],
    ['C', 1500000, '', 100000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  ws['!rows'] = [{ hpx: 42 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Escala');
  XLSX.writeFile(wb, 'Plantilla_Escala_Comisiones.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importEscalaComision(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }
      let h = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(x => String(x).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('categoria') && cells.some(c => c.includes('desde')) && cells.some(c => c.includes('monto'))) { h = r; break; }
      }
      if (h < 0) { alert('No se encontraron las columnas "Categoria", "Desde" y "Monto". Descargá la plantilla oficial.'); return; }
      const header = rows[h].map(x => String(x).toLowerCase().trim());
      const iCat = header.findIndex(x => x.includes('categor'));
      const iDesde = header.findIndex(x => x.includes('desde') || x.includes('min'));
      const iHasta = header.findIndex(x => x.includes('hasta') || x.includes('max'));
      const iMonto = header.findIndex(x => x.includes('monto') || x.includes('comisi') || x.includes('valor') || x.includes('importe'));
      if (iCat < 0 || iDesde < 0 || iMonto < 0) { alert('Faltan columnas Categoria / Desde / Monto.'); return; }
      const parseNum = v => { if (typeof v === 'number') return v; const s = String(v || '').replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'); const n = parseFloat(s); return isNaN(n) ? 0 : n; };
      const nuevas = [];
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i];
        const categoria = String(r[iCat] || '').trim();
        if (!categoria) continue;
        const desde = parseNum(r[iDesde]);
        const hastaRaw = iHasta >= 0 ? String(r[iHasta] || '').trim() : '';
        const hasta = (hastaRaw === '' ) ? null : parseNum(r[iHasta]);
        const monto = parseNum(r[iMonto]);
        nuevas.push({ categoria, fact_desde: desde, fact_hasta: hasta, monto });
      }
      if (!nuevas.length) { alert('No se importó ninguna categoría válida.'); return; }
      // Reemplazo total de la escala.
      await deleteAllComisionCategorias();
      const ids = await DB.insertRows('comision_categorias', nuevas);
      AppData.comisionCategorias = nuevas.map((n, i) => ({ id: ids[i], categoria: n.categoria, fact_desde: n.fact_desde, fact_hasta: n.fact_hasta, monto: n.monto }));
      persistirComisionesLocal();
      renderVendedoresYEscala();
      showToast('✅ Escala importada: ' + nuevas.length + ' categoría(s)');
    } catch (err) { console.error(err); alert('Error al importar la escala: ' + err.message); }
    finally { event.target.value = ''; }
  };
  reader.readAsArrayBuffer(file);
}
// Borra todas las filas de la escala (id no nulo).
async function deleteAllComisionCategorias() {
  for (const c of AppData.comisionCategorias.slice()) {
    try { await DB.deleteWhere('comision_categorias', 'id', c.id); } catch (e) {}
  }
  AppData.comisionCategorias = [];
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 2 — CLIENTES EN COMISIÓN
// ════════════════════════════════════════════════════════════════════════
function renderComisionClientes() {
  // Datalists de los modales
  const dlCli = document.getElementById('mcc-clientes-list');
  if (dlCli) dlCli.innerHTML = AppData.clientes.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))).map(c => '<option value="' + String(c.nombre).replace(/"/g, '&quot;') + '">').join('');
  const dlVen = document.getElementById('mcc-vendedores-list');
  if (dlVen) dlVen.innerHTML = AppData.vendedores.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))).map(v => '<option value="' + String(v.nombre).replace(/"/g, '&quot;') + '">').join('');

  const cont = document.getElementById('com-cli-rows');
  if (!cont) return;
  _comSelectoresFiltro();
  const q = (document.getElementById('com-cli-search')?.value || '').toLowerCase().trim();
  const fVend = document.getElementById('com-cli-vend')?.value || '';
  const fCat = document.getElementById('com-cli-cat')?.value || '';
  const orden = document.getElementById('com-cli-orden')?.value || 'restantes';

  const lista = AppData.comisionClientes
    .filter(c => !q || String(c.cliente).toLowerCase().includes(q) || String(c.vendedor).toLowerCase().includes(q))
    .filter(c => !fVend || normNombre(c.vendedor) === normNombre(fVend))
    .filter(c => !fCat || String(c.categoria || '') === fCat);

  // El orden por defecto es "los que están por terminar": es la pregunta que se
  // le hace a esta tabla. Los que ya terminaron y los que no arrancaron van al
  // final, porque no hay nada que hacer con ellos este mes.
  const _rank = c => { const p = pagosRestantes(c); if (!p) return 900; if (p.estado === 'enCurso') return p.quedan; return p.estado === 'porArrancar' ? 100 : 200; };
  const _ini = c => c.mes_inicio || '';
  if (orden === 'restantes') lista.sort((a, b) => _rank(a) - _rank(b) || String(a.cliente).localeCompare(String(b.cliente)));
  else if (orden === 'inicio') lista.sort((a, b) => String(_ini(b)).localeCompare(String(_ini(a))) || String(a.cliente).localeCompare(String(b.cliente)));
  else if (orden === 'antiguos') lista.sort((a, b) => String(_ini(a)).localeCompare(String(_ini(b))) || String(a.cliente).localeCompare(String(b.cliente)));
  else if (orden === 'monto') lista.sort((a, b) => _num(b.monto) - _num(a.monto) || String(a.cliente).localeCompare(String(b.cliente)));
  else lista.sort((a, b) => String(a.cliente).localeCompare(String(b.cliente)));

  // Contador + clientes sin asignar
  const total = AppData.comisionClientes.length;
  const filtrando = !!(q || fVend || fCat);
  const asignados = new Set(AppData.comisionClientes.map(c => normCliente(c.cliente)));
  const sinAsignar = AppData.clientes.filter(c => !asignados.has(normCliente(c.nombre))).length;
  const cEl = document.getElementById('com-cli-count');
  if (cEl) cEl.textContent = (filtrando ? lista.length + ' de ' + total : total + ' en comisión') +
    (sinAsignar ? ' · ' + sinAsignar + ' cliente(s) sin asignar' : '');
  const bLimpiar = document.getElementById('com-cli-limpiar');
  if (bLimpiar) bLimpiar.style.display = filtrando ? '' : 'none';

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon"><i class="ic ic-user"></i></div><div class="empty-title">' +
      (filtrando ? 'Ningún cliente con esos filtros' : 'Sin clientes en comisión') + '</div><div class="empty-sub">' +
      (filtrando ? 'Probá con otro vendedor o categoría, o limpiá los filtros.' : 'Asigná un cliente nuevo a un vendedor con "+ Asignar cliente"') + '</div></div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(row => {
    const ev = evalComisionCliente(row.cliente);
    const bloq = !!row.bloqueado;
    const fact = bloq ? _num(row.facturacion_eval) : ev.facturacion;
    const cat = bloq ? (row.categoria || '—') : (ev.categoria || '—');
    const monto = bloq ? _num(row.monto) : ev.monto;
    // 5 meses de pago: desde row.mes_inicio, o el mes siguiente al fin de evaluación.
    const miDefault = mesInicioDefaultCliente(row.cliente);
    const mi = row.mes_inicio || miDefault;
    const meses = [0, 4].map(i => addMeses(mi, i));
    // Los 5 pagos arrancan el mes SIGUIENTE al cierre de la evaluación, así que
    // el mes en que cierra es mi − 1. Se muestra al lado porque es la columna
    // "Mes Inicio" de la planilla: sin eso, copiar ese mes al campo de la app
    // corre los 5 pagos un mes para atrás.
    // Mientras la evaluación no cierre no hay ventana que mostrar: un rango
    // provisorio se lee como un compromiso que todavía no existe.
    const mesesTxt = (!bloq && !ev.completo)
      ? '<span class="muted">se define al cerrar la evaluación</span>'
      : mesLabel(meses[0]) + ' → ' + mesLabel(meses[1]) +
        '<div class="muted" style="font-size:10px">evaluado hasta ' + mesLabel(addMeses(mi, -1)) + '</div>';

    let estadoHtml, acciones;
    const baja = comisionEsBaja(row);
    if (baja) {
      estadoHtml = '<span class="badge" style="background:#fee2e2;color:#b91c1c"' +
        (row.fecha_baja ? ' title="Se dio de baja el ' + cargoFechaTxt(row.fecha_baja) + '"' : '') + '>Baja' +
        (row.mes_baja ? ' · sin comisión desde ' + mesLabel(row.mes_baja) : '') + '</span>' +
        (row.fecha_baja ? '<div class="muted" style="font-size:10px;margin-top:2px">baja el ' + cargoFechaTxt(row.fecha_baja) + '</div>' : '') +
        (row.motivo_baja ? '<div class="muted" style="font-size:10px">' + row.motivo_baja + '</div>' : '');
      acciones = '<button class="btn btn-sm" style="white-space:nowrap" onclick="reactivarComisionCliente(' + row.id + ')" title="Vuelve a comisionar los meses que le queden">↺ Reactivar</button>';
    } else if (bloq) {
      estadoHtml = '<span class="badge" style="background:#dcfce7;color:#166534">✓ Activo</span>';
      acciones = '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c;white-space:nowrap" onclick="darDeBajaComisionCliente(' + row.id + ')" title="El cliente se dio de baja: deja de comisionar">Dar de baja</button>';
    } else if (!ev.tieneEscala) {
      estadoHtml = '<span class="badge" style="background:#fee2e2;color:#b91c1c">Falta escala</span>';
      acciones = '';
    } else if (!ev.completo) {
      estadoHtml = '<span class="badge" style="background:#fef9c3;color:#854d0e">' + ev.facturas + ' de ' + FACTURAS_EVALUACION + ' facturas</span>' +
        '<div class="muted" style="font-size:10px;margin-top:2px">faltan ' + ev.faltan + '</div>';
      acciones = '<button class="btn btn-sm" style="white-space:nowrap" onclick="abrirFacturasComision(' + row.id + ')" title="Elegir qué facturas entran en la evaluación"><i class="ic ic-receipt"></i> Facturas</button>';
    } else {
      estadoHtml = '<span class="badge" style="background:#e0e7ff;color:#3730a3">Listo p/ confirmar</span>';
      acciones = '<button class="btn btn-sm" style="white-space:nowrap" onclick="abrirFacturasComision(' + row.id + ')" title="Ver las facturas que se evaluaron"><i class="ic ic-receipt"></i> Facturas</button>' +
        '<button class="btn btn-sm btn-primary" onclick="confirmarComisionCliente(' + row.id + ')" title="Congela el monto y arranca los 5 pagos"><i class="ic ic-check"></i> Confirmar</button>';
    }
    const warnTarifa = '';

    // La fila de baja se atenúa y el monto va tachado: la comisión existió y hoy
    // no corre, que es distinto de no haber tenido nunca.
    const trStyle = baja ? ' style="opacity:.6"' : (bloq ? '' : ' style="background:var(--surface-0)"');
    const montoTxt = monto > 0 ? (baja ? '<s>' + fmtPeso(monto) + '</s>' : fmtPeso(monto)) : '—';
    return '<tr' + trStyle + '>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(row.cliente) + ';width:26px;height:26px;font-size:9px">' + initials(row.cliente) + '</div><strong>' + row.cliente + '</strong></div></td>' +
      '<td>' + (row.vendedor || '<span class="muted">—</span>') + '</td>' +
      '<td class="mono" style="text-align:right">' + fmtPeso(fact) + warnTarifa + '</td>' +
      '<td style="text-align:center">' + cat + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + montoTxt + '</td>' +
      '<td style="font-size:11px;color:var(--text-secondary)">' + mesesTxt + '</td>' +
      '<td style="text-align:center">' + _comCeldaQuedan(row, baja) + '</td>' +
      '<td style="text-align:center">' + estadoHtml + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' + acciones +
        '<button class="btn btn-sm" onclick="editComisionCliente(' + row.id + ')" title="Editar"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="quitarComisionCliente(' + row.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');

}

// Chip de cuántos pagos quedan. Se pinta en ámbar cuando quedan 2 o menos: es
// el aviso de que hay que ir a buscar un cliente nuevo para ese vendedor.
function _comCeldaQuedan(row, baja) {
  if (baja) return '<span class="muted" style="font-size:11px">—</span>';
  const p = pagosRestantes(row);
  if (!p) return '<span class="muted" style="font-size:11px">—</span>';
  if (p.estado === 'terminado') return '<span class="muted" style="font-size:10.5px">terminó ' + mesLabel(p.mes) + '</span>';
  if (p.estado === 'porArrancar') return '<span style="font-size:10.5px;color:#854d0e">arranca ' + mesLabel(p.mes) + '</span>';
  const alerta = p.quedan <= 2;
  return '<span class="badge" style="font-size:10.5px;' +
    (alerta ? 'background:#fef3c7;color:#92400e' : 'background:var(--surface-0);color:var(--text-secondary)') + '">' +
    p.quedan + ' de 5</span>';
}

// Llena los selectores de vendedor y categoría con lo que realmente hay cargado,
// conservando lo elegido: los repinta el render y si se reconstruyeran en blanco
// el filtro se perdería a cada tecla del buscador.
function _comSelectoresFiltro() {
  const esc = s => String(s).replace(/"/g, '&quot;');
  const selV = document.getElementById('com-cli-vend');
  if (selV) {
    const prev = selV.value;
    const vends = Array.from(new Set((AppData.comisionClientes || []).map(c => String(c.vendedor || '').trim()).filter(Boolean))).sort();
    selV.innerHTML = '<option value="">Todos los vendedores</option>' +
      vends.map(v => '<option value="' + esc(v) + '"' + (v === prev ? ' selected' : '') + '>' + v + '</option>').join('');
  }
  const selC = document.getElementById('com-cli-cat');
  if (selC) {
    const prev = selC.value;
    const orden = (AppData.comisionCategorias || []).slice().sort((a, b) => _num(b.fact_desde) - _num(a.fact_desde)).map(c => c.categoria);
    const usadas = new Set((AppData.comisionClientes || []).map(c => String(c.categoria || '').trim()).filter(Boolean));
    const cats = orden.filter(c => usadas.has(c)).concat(Array.from(usadas).filter(c => !orden.includes(c)).sort());
    selC.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => '<option value="' + esc(c) + '"' + (c === prev ? ' selected' : '') + '>Categoría ' + c + '</option>').join('');
  }
}

function limpiarFiltrosComision() {
  ['com-cli-search', 'com-cli-vend', 'com-cli-cat'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderComisionClientes();
}

// ── Facturas de la evaluación ───────────────────────────────────────────────
// La contabilización vive en Comisiones y no en "Liquidación de clientes": ese
// panel es del tesorero, que descarga, y meterle controles de comisión le agrega
// ruido a otra tarea. Acá se ve en un solo lugar qué facturas entran, cuánto
// suman y qué categoría dan.
let facturasComisionId = null;

// Las liquidaciones CERRADAS del cliente, contabilizadas o no, de la más vieja
// a la más nueva: son las candidatas a entrar en la evaluación.
function liquidacionesDeClienteComision(cliente) {
  const k = comisionCodDe(cliente);
  return (AppData.clienteLiquidaciones || [])
    .filter(x => clienteCodCanonico(clienteKey(x.cliente_cod)) === k)
    .sort((a, b) => String(a.semana_hasta).localeCompare(String(b.semana_hasta)));
}

// El rango de una liquidación guardada, para poder recalcular su total cuando
// quedó sin monto congelado (liquidaciones cerradas antes de que existiera).
function _rangoDeLiquidacion(x) {
  const d1 = new Date(String(x.semana_desde || '').slice(0, 10) + 'T00:00:00');
  const d2 = new Date(String(x.semana_hasta || '').slice(0, 10) + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return null;
  d2.setHours(23, 59, 59, 999);
  const fmt = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  return { desdeD: d1, hastaD: d2, desde: fmt(d1), hasta: fmt(d2) };
}

// Lo facturado en esa liquidación: el valor congelado al cerrarla y, si no lo
// tiene, lo que da recalcularla. Se congela en cuanto se contabiliza.
function montoDeLiquidacion(x, cod) {
  const m = _num(x.monto);
  if (m > 0) return m;
  const r = _rangoDeLiquidacion(x);
  return r ? _num(calcLiquidacionCliente(cod, r).total) : 0;
}

function abrirFacturasComision(id) {
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (!row) return;
  facturasComisionId = id;
  document.getElementById('mfac-title').textContent = 'Facturas de ' + row.cliente;
  renderFacturasComision();
  document.getElementById('modal-facturas-backdrop').style.display = 'flex';
}

function cerrarFacturasComision(e) {
  if (!e || e.target.id === 'modal-facturas-backdrop') {
    document.getElementById('modal-facturas-backdrop').style.display = 'none';
    facturasComisionId = null;
  }
}

function renderFacturasComision() {
  const row = AppData.comisionClientes.find(x => x.id === facturasComisionId);
  const cont = document.getElementById('mfac-lista');
  if (!row || !cont) return;
  const cod = comisionCodDe(row.cliente);
  const liqs = liquidacionesDeClienteComision(row.cliente);
  const ev = evalComisionCliente(row.cliente);

  if (!liqs.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:22px"><div class="empty-icon"><i class="ic ic-receipt"></i></div>' +
      '<div class="empty-title">Todavía no tiene facturas cerradas</div>' +
      '<div class="empty-sub">Aparecen acá cuando se marca su liquidación como lista en Detalle de cliente.</div></div>';
  } else {
    // Las que entran son las 4 primeras CONTABILIZADAS; una 5.ª tildada queda
    // registrada pero no mueve el número, y se atenúa para que no parezca que suma.
    const cuentan = liqs.filter(x => x.cuenta_comision).slice(0, FACTURAS_EVALUACION).map(x => x.id);
    cont.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto">' +
      liqs.map(x => {
        const dentro = cuentan.includes(x.id);
        const extra = x.cuenta_comision && !dentro;
        const r = _rangoDeLiquidacion(x);
        return '<label style="display:flex;align-items:center;gap:9px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;' +
          (dentro ? 'background:var(--surface-0)' : extra ? 'opacity:.55' : '') + '">' +
          '<input type="checkbox"' + (x.cuenta_comision ? ' checked' : '') +
            ' onchange="toggleFacturaComision(' + x.id + ')">' +
          '<div style="flex:1;font-size:12px">' +
            '<strong>' + (r ? r.desde + ' → ' + r.hasta : String(x.semana_hasta).slice(0, 10)) + '</strong>' +
            (dentro ? ' <span class="badge" style="background:#dcfce7;color:#166534;font-size:9.5px">entra ' + (cuentan.indexOf(x.id) + 1) + '.ª</span>' : '') +
            (extra ? ' <span class="muted" style="font-size:10px">· fuera de las ' + FACTURAS_EVALUACION + ' que evalúan</span>' : '') +
          '</div>' +
          '<div class="mono" style="font-size:12px;font-weight:600">' + fmtPeso(montoDeLiquidacion(x, cod)) + '</div>' +
        '</label>';
      }).join('') + '</div>';
  }

  const res = document.getElementById('mfac-resumen');
  const btn = document.getElementById('mfac-confirmar');
  if (!ev.tieneEscala) {
    res.innerHTML = '<span style="color:#b91c1c">⚠ No hay escala de categorización cargada.</span>';
    if (btn) btn.style.display = 'none';
    return;
  }
  if (ev.completo) {
    const m1 = addMeses(ev.hasta.slice(0, 7), 1);
    res.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">' +
        '<div><div class="muted" style="font-size:10px">Facturación evaluada</div><div style="font-weight:700">' + fmtPeso(ev.facturacion) + '</div></div>' +
        '<div><div class="muted" style="font-size:10px">Categoría</div><div style="font-weight:700;font-size:17px">' + ev.categoria + '</div></div>' +
        '<div><div class="muted" style="font-size:10px">Comisión</div><div style="font-weight:700">' + fmtPeso(ev.monto) + '/mes</div></div>' +
      '</div>' +
      '<div style="margin-top:7px;font-size:11.5px;border-top:1px solid var(--border);padding-top:7px">' +
        'La 4.ª factura cierra el <strong>' + cargoFechaTxt(ev.hasta) + '</strong> · los 5 pagos van de <strong>' +
        mesLabel(m1) + '</strong> a <strong>' + mesLabel(addMeses(m1, 4)) + '</strong>.</div>';
    if (btn) btn.style.display = row.bloqueado ? 'none' : '';
  } else {
    res.innerHTML = '<div style="font-size:12.5px"><strong>' + ev.facturas + ' de ' + FACTURAS_EVALUACION + '</strong> facturas contabilizadas' +
      (ev.facturacion > 0 ? ' · ' + fmtPeso(ev.facturacion) + ' acumulados' : '') + '.</div>' +
      '<div class="muted" style="font-size:11px;margin-top:3px">Faltan ' + ev.faltan +
      ' para cerrar la evaluación y categorizarlo.</div>';
    if (btn) btn.style.display = 'none';
  }
}

async function toggleFacturaComision(liqId) {
  const row = AppData.comisionClientes.find(x => x.id === facturasComisionId);
  const liq = (AppData.clienteLiquidaciones || []).find(x => x.id === liqId);
  if (!row || !liq) return;
  if (row.bloqueado) { showToast('La comisión ya está confirmada'); renderFacturasComision(); return; }
  const cod = comisionCodDe(row.cliente);
  const nuevo = !liq.cuenta_comision;
  // Se congela el monto al contabilizarla: si más adelante se corrige una zona,
  // la evaluación no se mueve para atrás.
  const monto = nuevo ? montoDeLiquidacion(liq, cod) : _num(liq.monto);
  try {
    await DB.updateWhere('cliente_liquidaciones', 'id', liqId, { cuenta_comision: nuevo, monto });
    liq.cuenta_comision = nuevo; liq.monto = monto;
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    renderFacturasComision();
    renderComisionClientes();
  } catch (e) { console.warn('toggleFacturaComision', e); showToast('⛔ No se pudo guardar'); renderFacturasComision(); }
}

async function confirmarDesdeFacturas() {
  const id = facturasComisionId;
  if (id == null) return;
  await confirmarComisionCliente(id);
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (row && row.bloqueado) cerrarFacturasComision();
  else renderFacturasComision();
}

// ── Asignar / editar cliente en comisión ─────────────────────────────────────
let comisionClienteEditId = null;
function openAddComisionClienteModal() {
  comisionClienteEditId = null;
  document.getElementById('modal-cc-title').textContent = 'Asignar cliente a vendedor';
  document.getElementById('mcc-cliente').value = '';
  document.getElementById('mcc-cliente').removeAttribute('disabled');
  document.getElementById('mcc-vendedor').value = '';
  document.getElementById('mcc-fecha').value = '';
  _mccResetMesPago('');
  _mccCategorias(''); document.getElementById('mcc-facturacion').value = '';
  _setEstadoComisionModal('activo', '', '');
  renderComisionClientes(); // refresca datalists
  actualizarPreviewComisionCliente();
  document.getElementById('modal-cc-backdrop').style.display = 'flex';
}
function editComisionCliente(id) {
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (!row) return;
  comisionClienteEditId = id;
  document.getElementById('modal-cc-title').textContent = 'Editar asignación';
  const cliInput = document.getElementById('mcc-cliente');
  cliInput.value = row.cliente || '';
  cliInput.setAttribute('disabled', 'disabled'); // no se cambia el cliente al editar
  document.getElementById('mcc-vendedor').value = row.vendedor || '';
  document.getElementById('mcc-fecha').value = row.fecha_alta && /^\d{4}-\d{2}-\d{2}$/.test(row.fecha_alta) ? row.fecha_alta : '';
  _mccResetMesPago(row.bloqueado ? (row.mes_inicio || '') : '');
  _mccCategorias(row.bloqueado ? (row.categoria || '') : '');
  document.getElementById('mcc-facturacion').value = row.bloqueado && _num(row.facturacion_eval) > 0 ? _num(row.facturacion_eval) : '';
  _setEstadoComisionModal(row.estado || 'activo', row.mes_baja || '', row.motivo_baja || '');
  actualizarPreviewComisionCliente();
  document.getElementById('modal-cc-backdrop').style.display = 'flex';
}
// Categorías de la escala para declarar a mano la evaluación de un cliente que
// ya venía comisionando de antes. Sin esto, un cliente sin envíos en la ventana
// que carga la app se quedaba "En evaluación" para siempre y nunca comisionaba.
function _mccCategorias(actual) {
  const sel = document.getElementById('mcc-categoria');
  if (!sel) return;
  const cats = (AppData.comisionCategorias || []).slice().sort((a, b) => _num(b.fact_desde) - _num(a.fact_desde));
  const esc = s => String(s).replace(/"/g, '&quot;');
  sel.innerHTML = '<option value="">Que la evalúe la app (4 primeras liquidaciones)</option>' +
    cats.map(c => '<option value="' + esc(c.categoria) + '"' + (c.categoria === actual ? ' selected' : '') + '>' +
      c.categoria + ' · ' + fmtPeso(_num(c.monto)) + '/mes</option>').join('');
}

// Estado del cliente dentro del modal (activo / baja + desde cuándo y por qué).
function _setEstadoComisionModal(estado, mesBaja, motivo) {
  const sel = document.getElementById('mcc-estado');
  if (!sel) return;
  sel.value = String(estado || 'activo').toLowerCase() === 'baja' ? 'baja' : 'activo';
  const mb = document.getElementById('mcc-mesbaja'); if (mb) mb.value = mesBaja || '';
  const mo = document.getElementById('mcc-motivobaja'); if (mo) mo.value = motivo || '';
  toggleBajaComisionCliente();
}
function toggleBajaComisionCliente() {
  const sel = document.getElementById('mcc-estado');
  const box = document.getElementById('mcc-baja-box');
  if (!sel || !box) return;
  const esBaja = sel.value === 'baja';
  box.style.display = esBaja ? 'block' : 'none';
  const mb = document.getElementById('mcc-mesbaja');
  if (esBaja && mb && !mb.value) mb.value = mesActualYYYYMM();
}
function closeComisionClienteModal(e) {
  if (!e || e.target.id === 'modal-cc-backdrop') document.getElementById('modal-cc-backdrop').style.display = 'none';
}
// Deja el campo escondido de vuelta, con la corrección previa si la había: una
// fila ya confirmada puede tener un mes puesto a mano y editarla no debe
// borrarlo en silencio.
function _mccResetMesPago(valor) {
  const inp = document.getElementById('mcc-mesinicio');
  const btn = document.getElementById('mcc-mesinicio-btn');
  if (inp) { inp.value = valor || ''; inp.style.display = valor ? '' : 'none'; }
  if (btn) btn.style.display = valor ? 'none' : '';
}

// Muestra el 1.er mes de pago que sale de la evaluación. El operador no lo
// escribe: es una cuenta que la app ya sabe hacer y pedírsela es pedirle que la
// repita. El input sigue existiendo, escondido, como corrección puntual.
function _mccPintarMesPago(cliente) {
  const txt = document.getElementById('mcc-mesinicio-txt');
  const inp = document.getElementById('mcc-mesinicio');
  if (!txt || !inp) return '';
  const manual = (inp.value || '').trim();
  const mi = manual || (cliente ? mesInicioDefaultCliente(cliente) : '');
  txt.innerHTML = mi
    ? mesLabel(mi) + (manual ? ' <span class="muted" style="font-weight:400;font-size:11px">· corregido a mano</span>' : '')
    : '<span class="muted" style="font-weight:400">se define al cerrar la evaluación</span>';
  return mi;
}

function mostrarCorreccionMesPago() {
  const inp = document.getElementById('mcc-mesinicio');
  const btn = document.getElementById('mcc-mesinicio-btn');
  if (!inp) return;
  inp.style.display = '';
  if (btn) btn.style.display = 'none';
  const cliente = (document.getElementById('mcc-cliente').value || '').trim();
  if (!inp.value && cliente) inp.value = mesInicioDefaultCliente(cliente);
  inp.focus();
  actualizarPreviewComisionCliente();
}

function actualizarPreviewComisionCliente() {
  const cliente = (document.getElementById('mcc-cliente').value || '').trim();
  const box = document.getElementById('mcc-preview');
  const miInput = document.getElementById('mcc-mesinicio');
  _mccPintarMesPago(cliente);
  if (!box) return;
  // Categoría declarada a mano: manda sobre la evaluación automática y el
  // preview tiene que decir eso mismo, para que nadie espere que la app la mueva.
  const catManual = (document.getElementById('mcc-categoria') || {}).value || '';
  if (catManual) {
    const c = (AppData.comisionCategorias || []).find(x => x.categoria === catManual);
    const mi = ((miInput && miInput.value) || '') || (cliente ? mesInicioDefaultCliente(cliente) : '');
    box.innerHTML =
      '<div><strong>Categoría ' + catManual + '</strong> declarada a mano · ' +
      fmtPeso(_num(c && c.monto)) + '/mes durante 5 meses.</div>' +
      '<div style="margin-top:4px;font-size:11px">' +
      (mi ? 'Cobra de <strong>' + mesLabel(mi) + '</strong> a <strong>' + mesLabel(addMeses(mi, 4)) + '</strong>.' : '') +
      '</div>';
    return;
  }
  if (!cliente) { box.innerHTML = '<span class="muted">Elegí un cliente para ver la evaluación de sus primeras 4 liquidaciones.</span>'; return; }
  const ev = evalComisionCliente(cliente);
  if (miInput && !miInput.value) miInput.placeholder = mesInicioDefaultCliente(cliente) + ' (por defecto)';
  if (!ev.tieneEscala) { box.innerHTML = '<span style="color:#b91c1c">⚠ No hay escala de categorización cargada. Importala en la solapa "Vendedores y escala".</span>'; return; }
  const estado = ev.completo
    ? '<span style="color:#166534">Las ' + FACTURAS_EVALUACION + ' facturas están contabilizadas ✓</span>'
    : '<span style="color:#854d0e">Lleva <strong>' + ev.facturas + ' de ' + FACTURAS_EVALUACION + '</strong> facturas · faltan ' + ev.faltan +
      '. Se contabilizan desde <strong>Liquidación de clientes</strong>.</span>';
  // El pago arranca el mes SIGUIENTE al de la 4.ª factura: la evaluación puede
  // cerrar a mitad de mes y ese mes ya está corriendo.
  const cronograma = !ev.completo ? '' :
    (function () {
      const m1 = addMeses(ev.hasta.slice(0, 7), 1);
      return '<div style="margin-top:6px;font-size:11px;border-top:1px solid var(--border);padding-top:6px">' +
        'La 4.ª factura cierra el <strong>' + cargoFechaTxt(ev.hasta) + '</strong> · los 5 pagos van de <strong>' +
        mesLabel(m1) + '</strong> a <strong>' + mesLabel(addMeses(m1, 4)) + '</strong>.</div>';
    })();
  box.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center">' +
      '<div><div class="muted" style="font-size:10px">Facturas</div><div style="font-weight:700">' + ev.facturas + ' de ' + FACTURAS_EVALUACION + '</div></div>' +
      '<div><div class="muted" style="font-size:10px">Facturación</div><div style="font-weight:700">' + fmtPeso(ev.facturacion) + '</div></div>' +
      '<div><div class="muted" style="font-size:10px">Categoría</div><div style="font-weight:700">' + (ev.categoria || '—') + '</div></div>' +
      '<div><div class="muted" style="font-size:10px">Monto fijo/mes</div><div style="font-weight:700">' + (ev.monto > 0 ? fmtPeso(ev.monto) : '—') + '</div></div>' +
    '</div>' +
    '<div style="margin-top:6px;font-size:11px">' + estado + '</div>' +
    cronograma;
}
async function guardarComisionClienteModal() {
  const cliente = (document.getElementById('mcc-cliente').value || '').trim().toUpperCase();
  const vendedor = (document.getElementById('mcc-vendedor').value || '').trim().toUpperCase();
  const fecha_alta = document.getElementById('mcc-fecha').value || '';
  // Sin corrección a mano, el mes sale del cálculo. Solo se persiste cuando la
  // fila queda confirmada: mientras esté en evaluación se recalcula sola, así
  // sigue el movimiento de las facturas.
  const mesManual = document.getElementById('mcc-mesinicio').value || '';
  const catManual = (document.getElementById('mcc-categoria')?.value || '').trim();
  const factManual = parseFloat(document.getElementById('mcc-facturacion')?.value);
  const estado = (document.getElementById('mcc-estado')?.value === 'baja') ? 'baja' : 'activo';
  const mes_baja = estado === 'baja' ? (document.getElementById('mcc-mesbaja')?.value || '') : '';
  const motivo_baja = estado === 'baja' ? (document.getElementById('mcc-motivobaja')?.value || '').trim() : '';
  if (estado === 'baja' && !mes_baja) { alert('Indicá desde qué mes el cliente deja de comisionar. Para cargar la fecha exacta usá "Dar de baja" en el listado.'); return; }
  if (!cliente) { alert('Elegí un cliente.'); return; }
  if (!vendedor) { alert('Elegí o escribí un vendedor.'); return; }
  const mes_inicio = mesManual || (catManual ? mesInicioDefaultCliente(cliente) : '');
  const dup = AppData.comisionClientes.find(c => normCliente(c.cliente) === normCliente(cliente) && c.id !== comisionClienteEditId);
  if (dup) { alert('El cliente "' + cliente + '" ya está asignado a ' + dup.vendedor + '.'); return; }
  try {
    // Crear el vendedor si no existe.
    if (!AppData.vendedores.find(v => normNombre(v.nombre) === normNombre(vendedor))) {
      try { const vr = await DB.insertRow('vendedores', { nombre: vendedor, activo: true }); AppData.vendedores.push({ id: vr.id, nombre: vendedor, activo: true }); } catch (e) {}
    }
    if (comisionClienteEditId != null) {
      const campos = { vendedor, fecha_alta, mes_inicio, estado, mes_baja, motivo_baja };
      Object.assign(campos, _camposCategoriaManual(catManual, factManual, AppData.comisionClientes.find(x => x.id === comisionClienteEditId)));
      await DB.updateWhere('comision_clientes', 'id', comisionClienteEditId, campos);
      const row = AppData.comisionClientes.find(x => x.id === comisionClienteEditId);
      if (row) Object.assign(row, campos);
    } else {
      const rec = Object.assign(
        { cliente, vendedor, fecha_alta, mes_inicio, categoria: '', facturacion_eval: 0, monto: 0, bloqueado: false, estado, mes_baja, motivo_baja },
        _camposCategoriaManual(catManual, factManual, null));
      const r = await DB.insertRow('comision_clientes', rec);
      AppData.comisionClientes.push(Object.assign({ id: r.id }, rec));
    }
    persistirComisionesLocal();
    comisionClienteEditId = null;
    document.getElementById('modal-cc-backdrop').style.display = 'none';
    renderComisionClientes();
    showToast('✅ Asignación guardada');
  } catch (e) { console.warn('guardarComisionClienteModal', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

// Qué campos escribe la categoría elegida a mano. Vacía = vuelve a manos de la
// app (se desconfirma para que la evalúe); elegida = se congela igual que una
// evaluación confirmada, porque eso es: una evaluación hecha por fuera.
function _camposCategoriaManual(catManual, factManual, filaPrevia) {
  if (!catManual) {
    // Solo desconfirma lo que se había declarado a mano: una evaluación que hizo
    // la app se reabre desde su propio botón, no borrando el select.
    return (filaPrevia && filaPrevia.bloqueado) ? {} : { bloqueado: false };
  }
  const c = (AppData.comisionCategorias || []).find(x => x.categoria === catManual);
  return {
    categoria: catManual,
    monto: _num(c && c.monto),
    facturacion_eval: isNaN(factManual) ? _num(filaPrevia && filaPrevia.facturacion_eval) : factManual,
    bloqueado: true,
  };
}

// Confirma la evaluación: congela facturación/categoría/monto/mes_inicio y arranca los 5 pagos.
async function confirmarComisionCliente(id) {
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (!row) return;
  const ev = evalComisionCliente(row.cliente);
  if (!ev.tieneEscala) { alert('No hay escala de categorización cargada.'); return; }
  if (!ev.completo) { if (!confirm('Lleva ' + ev.facturas + ' de ' + FACTURAS_EVALUACION + ' facturas contabilizadas. ¿Confirmar igual con lo facturado hasta acá (' + fmtPeso(ev.facturacion) + ')?')) return; }
  if (ev.monto <= 0) { if (!confirm('La categoría evaluada da monto $0 (facturación ' + fmtPeso(ev.facturacion) + '). ¿Confirmar igual?')) return; }
  const mesInicio = row.mes_inicio || mesInicioDefaultCliente(row.cliente);
  const campos = { categoria: ev.categoria, facturacion_eval: ev.facturacion, monto: ev.monto, mes_inicio: mesInicio, bloqueado: true };
  try {
    await DB.updateWhere('comision_clientes', 'id', id, campos);
    Object.assign(row, campos);
    persistirComisionesLocal();
    renderComisionClientes();
    showToast('✅ ' + row.cliente + ' confirmado · ' + fmtPeso(ev.monto) + '/mes × 5 (' + mesLabel(mesInicio) + '→' + mesLabel(addMeses(mesInicio, 4)) + ')');
  } catch (e) { console.warn('confirmarComisionCliente', e); alert('No se pudo confirmar: ' + (e.message || e)); }
}
// El cliente se dio de baja: deja de comisionar desde el mes elegido (ese mes ya
// no se paga). La fila NO se borra — el registro tiene que explicar por qué el
// vendedor dejó de cobrar por ese cliente.
let bajaComisionId = null;

function darDeBajaComisionCliente(id) {
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (!row) return;
  bajaComisionId = id;
  document.getElementById('mbaja-title').textContent = 'Baja de ' + row.cliente;
  const info = document.getElementById('mbaja-cliente');
  if (info) {
    const meses = mesesPagoComision(row);
    info.innerHTML = '<strong style="color:var(--text-primary)">' + row.cliente + '</strong> · ' + (row.vendedor || '—') +
      ' · ' + fmtPeso(_num(row.monto)) + '/mes' +
      '<div style="margin-top:2px">Sus 5 pagos: ' + mesLabel(meses[0]) + ' → ' + mesLabel(meses[4]) + '</div>';
  }
  const hoy = new Date();
  document.getElementById('mbaja-fecha').value = row.fecha_baja ||
    (hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0'));
  document.getElementById('mbaja-motivo').value = row.motivo_baja || '';
  recalcBajaComision();
  document.getElementById('modal-baja-backdrop').style.display = 'flex';
}

function cerrarBajaComision(e) {
  if (!e || e.target.id === 'modal-baja-backdrop') {
    document.getElementById('modal-baja-backdrop').style.display = 'none';
    bajaComisionId = null;
  }
}

// Anticipa el efecto ANTES de guardar: qué mes corta, si el mes de la baja se
// cobra o no y cuántos pagos se pierden. Es una decisión sobre cinco meses de
// comisión y el vendedor va a preguntar por qué le falta uno.
function recalcBajaComision() {
  const row = AppData.comisionClientes.find(x => x.id === bajaComisionId);
  const box = document.getElementById('mbaja-resumen');
  if (!row || !box) return;
  const f = (document.getElementById('mbaja-fecha') || {}).value || '';
  const m = mesBajaDeFecha(f);
  if (!m) { box.innerHTML = '<span style="color:#b45309">Elegí la fecha en que se dio de baja el cliente.</span>'; return; }
  const dia = +String(f).slice(8, 10);
  const antes = dia < BAJA_DIA_CORTE;
  const meses = mesesPagoComision(row);
  const pagos = meses.filter(x => x < m).length;          // los que se cobran igual
  const perdidos = meses.length - pagos;
  box.innerHTML =
    '<div>Baja el <strong>' + cargoFechaTxt(f) + '</strong> — ' +
      (antes ? 'antes del ' + BAJA_DIA_CORTE + ': <strong>' + mesLabel(f.slice(0, 7)) + ' NO se paga</strong>.'
             : 'del ' + BAJA_DIA_CORTE + ' en adelante: <strong>' + mesLabel(f.slice(0, 7)) + ' se cobra</strong> y corta el siguiente.') +
    '</div>' +
    '<div style="margin-top:5px;border-top:1px solid var(--border);padding-top:5px">' +
      'Deja de comisionar desde <strong>' + mesLabel(m) + '</strong>. ' +
      (perdidos > 0
        ? 'Cobra <strong>' + pagos + '</strong> de sus 5 pagos y se pierden <strong>' + perdidos + '</strong> (' + fmtPeso(perdidos * _num(row.monto)) + ').'
        : 'Ya había cobrado sus 5 pagos: no cambia nada.') +
    '</div>';
}

async function guardarBajaComision() {
  const id = bajaComisionId;
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (!row) return;
  const f = (document.getElementById('mbaja-fecha') || {}).value || '';
  const m = mesBajaDeFecha(f);
  if (!m) { alert('Elegí la fecha en que se dio de baja el cliente.'); return; }
  const campos = {
    estado: 'baja', fecha_baja: f, mes_baja: m,
    motivo_baja: ((document.getElementById('mbaja-motivo') || {}).value || '').trim()
  };
  try {
    await DB.updateWhere('comision_clientes', 'id', id, campos);
    Object.assign(row, campos);
    persistirComisionesLocal();
    document.getElementById('modal-baja-backdrop').style.display = 'none';
    bajaComisionId = null;
    renderComisionClientes();
    showToast('✔ ' + row.cliente + ' dado de baja · sin comisión desde ' + mesLabel(m));
  } catch (e) { console.warn('guardarBajaComision', e); alert('No se pudo dar de baja: ' + (e.message || e)); }
}
async function reactivarComisionCliente(id) {
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (!row) return;
  if (!confirm('¿Reactivar a ' + row.cliente + '?\nVuelve a comisionar los meses que le queden de los 5.')) return;
  const campos = { estado: 'activo', mes_baja: '', motivo_baja: '', fecha_baja: '' };
  try {
    await DB.updateWhere('comision_clientes', 'id', id, campos);
    Object.assign(row, campos);
    persistirComisionesLocal();
    renderComisionClientes();
    showToast('↺ ' + row.cliente + ' reactivado');
  } catch (e) { console.warn('reactivarComisionCliente', e); alert('No se pudo reactivar: ' + (e.message || e)); }
}
async function quitarComisionCliente(id) {
  const row = AppData.comisionClientes.find(x => x.id === id);
  if (!row) return;
  if (!confirm('¿Quitar a ' + row.cliente + ' del régimen de comisiones?')) return;
  try {
    await DB.deleteWhere('comision_clientes', 'id', id);
    AppData.comisionClientes = AppData.comisionClientes.filter(x => x.id !== id);
    persistirComisionesLocal();
    renderComisionClientes();
    showToast('🗑 Quitado de comisiones');
  } catch (e) { console.warn('quitarComisionCliente', e); showToast('⛔ No se pudo quitar'); }
}

// ── Import de asignaciones (Cliente · Vendedor · [Fecha alta]) ────────────────
function descargarPlantillaAsignaciones() {
  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por cliente nuevo. "Vendedor" se crea solo si no existe. "Fecha alta" es opcional (DD/MM/AAAA).'],
    ['Cliente', 'Vendedor', 'Fecha alta'],
    ['MERCADO LIBRE', 'JUAN PEREZ', '01/08/2026'],
    ['TIENDA XYZ', 'ANA GOMEZ', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 22 }, { wch: 14 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asignaciones');
  XLSX.writeFile(wb, 'Plantilla_Asignaciones_Comisiones.xlsx');
  showToast('📥 Plantilla descargada');
}
function importAsignacionesComision(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }
      let h = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(x => String(x).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('cliente') && cells.includes('vendedor')) { h = r; break; }
      }
      if (h < 0) { alert('No se encontraron las columnas "Cliente" y "Vendedor". Descargá la plantilla oficial.'); return; }
      const header = rows[h].map(x => String(x).toLowerCase().trim());
      const iCli = header.findIndex(x => x.includes('cliente'));
      const iVen = header.findIndex(x => x.includes('vendedor'));
      const iFec = header.findIndex(x => x.includes('fecha') || x.includes('alta'));
      let nuevos = 0, actualizados = 0, vendNuevos = 0;
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i];
        const cliente = String(r[iCli] || '').trim().toUpperCase();
        const vendedor = String(r[iVen] || '').trim().toUpperCase();
        const fecha_alta = iFec >= 0 ? String(r[iFec] || '').trim() : '';
        if (!cliente || !vendedor) continue;
        // Crear vendedor si no existe.
        if (!AppData.vendedores.find(v => normNombre(v.nombre) === normNombre(vendedor))) {
          try { const vr = await DB.insertRow('vendedores', { nombre: vendedor, activo: true }); AppData.vendedores.push({ id: vr.id, nombre: vendedor, activo: true }); vendNuevos++; } catch (e) {}
        }
        const existente = AppData.comisionClientes.find(c => normCliente(c.cliente) === normCliente(cliente));
        if (existente) {
          try { await DB.updateWhere('comision_clientes', 'id', existente.id, { vendedor, fecha_alta }); existente.vendedor = vendedor; existente.fecha_alta = fecha_alta; actualizados++; } catch (e) {}
        } else {
          const rec = { cliente, vendedor, fecha_alta, mes_inicio: '', categoria: '', facturacion_eval: 0, monto: 0, bloqueado: false };
          try { const rr = await DB.insertRow('comision_clientes', rec); AppData.comisionClientes.push(Object.assign({ id: rr.id }, rec)); nuevos++; } catch (e) {}
        }
      }
      persistirComisionesLocal();
      renderComisionClientes();
      showToast('✅ Asignaciones: ' + nuevos + ' nueva(s), ' + actualizados + ' actualizada(s)' + (vendNuevos ? ' · ' + vendNuevos + ' vendedor(es) nuevo(s)' : ''));
    } catch (err) { console.error(err); alert('Error al importar asignaciones: ' + err.message); }
    finally { event.target.value = ''; }
  };
  reader.readAsArrayBuffer(file);
}

// ════════════════════════════════════════════════════════════════════════
//  TAB 3 — CIERRE MENSUAL
// ════════════════════════════════════════════════════════════════════════
function renderCierreMensual() {
  const mesInput = document.getElementById('com-cierre-mes');
  if (mesInput && !mesInput.value) mesInput.value = mesActualYYYYMM();
  const periodo = (mesInput && mesInput.value) || mesActualYYYYMM();
  const body = document.getElementById('com-cierre-body');
  if (!body) return;

  const r = calcComisionesMes(periodo);
  const lbl = document.getElementById('com-cierre-periodo');
  if (lbl) lbl.textContent = mesLabel(periodo);

  if (!r.vendedores.length && !r.bajas.length) {
    body.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon"><i class="ic ic-file"></i></div><div class="empty-title">Sin comisiones en ' + mesLabel(periodo) + '</div><div class="empty-sub">No hay clientes confirmados con pago en este mes. Confirmá asignaciones en "Clientes en comisión".</div></div>';
    return;
  }

  const filasVend = r.vendedores.map(v => {
    const pago = comisionPagoDe(periodo, v.vendedor, 'vendedor');
    // De mayor a menor: lo que más pesa en su liquidación va primero.
    const clientes = v.clientes.slice().sort((a, b) => b.monto - a.monto);
    const detalle =
      '<details style="margin-top:5px">' +
        '<summary style="cursor:pointer;font-size:11px;color:var(--text-secondary);user-select:none">' +
          'Ver el detalle · ' + clientes.length + ' cliente(s)</summary>' +
        '<div style="display:grid;grid-template-columns:1fr auto auto;gap:3px 12px;font-size:11px;margin:6px 0 2px;max-width:520px">' +
          clientes.map(c =>
            '<div>' + c.cliente + '</div>' +
            '<div class="muted" style="white-space:nowrap">' + (c.categoria || '?') + ' · mes ' + c.nroMes + '/5</div>' +
            '<div class="mono" style="text-align:right;white-space:nowrap">' + fmtPeso(c.monto) + '</div>').join('') +
          '<div style="border-top:1px solid var(--border);padding-top:3px;font-weight:600">Total</div>' +
          '<div style="border-top:1px solid var(--border)"></div>' +
          '<div class="mono" style="border-top:1px solid var(--border);padding-top:3px;text-align:right;font-weight:700">' + fmtPeso(v.monto) + '</div>' +
        '</div>' +
      '</details>';
    return '<tr>' +
      '<td><div class="conductor-cell" style="align-items:flex-start"><div class="conductor-avatar" style="background:' + avatarColor(v.vendedor) + ';width:26px;height:26px;font-size:9px;flex:0 0 auto">' + initials(v.vendedor) + '</div><div><strong>' + v.vendedor + '</strong>' + detalle + '</div></div></td>' +
      '<td class="mono" style="text-align:right">' + v.clientes.length + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(v.monto) + '</td>' +
      '<td style="text-align:center">' + (pago
        ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ Pagado</span> <button class="btn btn-sm" onclick="deshacerPagoComision(\'' + periodo + '\',' + jsStr(v.vendedor) + ',\'vendedor\')" title="Deshacer">↺</button>'
        : '<button class="btn btn-sm btn-primary" onclick="marcarPagoComision(\'' + periodo + '\',' + jsStr(v.vendedor) + ',\'vendedor\',' + v.monto + ')"><i class="ic ic-check"></i> Marcar pagado</button>') + '</td>' +
    '</tr>';
  }).join('');

  // Fila supervisor
  const supNombre = r.supNombre || '(supervisor sin definir)';
  const pagoSup = r.supNombre ? comisionPagoDe(periodo, r.supNombre, 'supervisor') : null;
  const filaSup = '<tr style="background:var(--surface-0)">' +
    '<td><strong>' + supNombre + '</strong> <span class="muted" style="font-size:11px">· supervisor (' + r.pct + '% del equipo)</span></td>' +
    '<td class="mono" style="text-align:right">—</td>' +
    '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(r.supMonto) + '</td>' +
    '<td style="text-align:center">' + (!r.supNombre
      ? '<span class="muted" style="font-size:11px">definí el supervisor</span>'
      : (pagoSup
        ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ Pagado</span> <button class="btn btn-sm" onclick="deshacerPagoComision(\'' + periodo + '\',' + jsStr(r.supNombre) + ',\'supervisor\')" title="Deshacer">↺</button>'
        : '<button class="btn btn-sm btn-primary" onclick="marcarPagoComision(\'' + periodo + '\',' + jsStr(r.supNombre) + ',\'supervisor\',' + r.supMonto + ')"><i class="ic ic-check"></i> Marcar pagado</button>')) + '</td>' +
  '</tr>';

  // Clientes de baja que caen dentro de sus 5 meses: se listan en $0. Si la fila
  // desapareciera, el vendedor vería su total bajar sin ninguna explicación.
  const bloqueBajas = !r.bajas.length ? '' :
    '<div class="card" style="margin-top:12px"><div class="table-wrap"><table>' +
      '<thead><tr><th colspan="4" style="background:var(--surface-0);font-weight:700">Clientes de baja — no comisionan en ' + mesLabel(periodo) + '</th></tr>' +
      '<tr><th>Cliente</th><th>Vendedor</th><th>Baja</th><th style="text-align:right">Comisión</th></tr></thead><tbody>' +
      r.bajas.map(b => '<tr style="opacity:.65">' +
        '<td><s>' + b.cliente + '</s>' + (b.categoria ? ' <span class="muted" style="font-size:10px">(' + b.categoria + ' · mes ' + b.nroMes + '/5)</span>' : '') + '</td>' +
        '<td>' + b.vendedor + '</td>' +
        '<td style="font-size:11px">' + (b.mesBaja ? mesLabel(b.mesBaja) : '—') + (b.motivo ? ' · ' + b.motivo : '') + '</td>' +
        '<td class="mono" style="text-align:right">$0</td>' +
      '</tr>').join('') +
    '</tbody></table></div></div>';

  // Los que no cobran este mes, con el motivo. Va plegado: es material de
  // control, no la liquidación. Lo que resuelve es la pregunta "¿por qué me
  // falta este cliente?", que sin esto no se puede contestar desde la pantalla.
  const nAntes = r.fuera.filter(f => f.antes).length;
  const nDespues = r.fuera.length - nAntes;
  const bloqueFuera = !r.fuera.length ? '' :
    '<details style="margin-top:12px" class="card">' +
      '<summary style="cursor:pointer;padding:10px 14px;font-size:12.5px;font-weight:600">' +
        r.fuera.length + ' cliente(s) en comisión no cobran en ' + mesLabel(periodo) +
        '<span class="muted" style="font-weight:400"> · ' +
          (nAntes ? nAntes + ' todavía no arrancan' : '') + (nAntes && nDespues ? ' · ' : '') +
          (nDespues ? nDespues + ' ya cumplieron sus 5 pagos' : '') + '</span>' +
      '</summary>' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>Cliente</th><th>Vendedor</th><th>Sus 5 pagos</th><th style="text-align:right">Monto</th></tr></thead><tbody>' +
        r.fuera.map(f => '<tr style="opacity:.7">' +
          '<td>' + f.cliente + (f.categoria ? ' <span class="muted" style="font-size:10px">(' + f.categoria + ')</span>' : '') + '</td>' +
          '<td>' + f.vendedor + '</td>' +
          '<td style="font-size:11px">' + mesLabel(f.desde) + ' → ' + mesLabel(f.hasta) +
            ' <span style="color:' + (f.antes ? '#854d0e' : '#64748b') + '">· ' +
            (f.antes ? 'arranca en ' + mesLabel(f.desde) : 'terminó en ' + mesLabel(f.hasta)) + '</span></td>' +
          '<td class="mono" style="text-align:right">' + fmtPeso(f.monto) + '</td>' +
        '</tr>').join('') +
      '</tbody></table></div>' +
      '<div style="padding:8px 14px;font-size:11px;color:var(--text-muted)">' +
        'Cada cliente cobra <strong>5 meses</strong>, del mes siguiente al cierre de su evaluación en adelante. ' +
        'Si alguno debería estar cobrando este mes, corregile el <strong>1.er mes de pago</strong> en "Clientes en comisión".' +
      '</div>' +
    '</details>';

  body.innerHTML =
    '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-user"></i></div><div class="metric-label">Comisión vendedores</div><div class="metric-value">' + fmtPeso(r.totalVendedores) + '</div><div class="metric-sub">' + r.vendedores.length + ' vendedor(es)</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-shield"></i></div><div class="metric-label">Supervisor (' + r.pct + '%)</div><div class="metric-value">' + fmtPeso(r.supMonto) + '</div><div class="metric-sub">' + (r.supNombre || 'sin definir') + '</div></div>' +
      '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Total a pagar</div><div class="metric-value">' + fmtPeso(r.total) + '</div><div class="metric-sub">' + mesLabel(periodo) + '</div></div>' +
    '</div>' +
    '<div class="card"><div class="table-wrap"><table>' +
      '<thead><tr><th>Beneficiario</th><th style="text-align:right">Clientes</th><th style="text-align:right">Monto</th><th style="text-align:center;width:170px">Estado</th></tr></thead>' +
      '<tbody>' + filasVend + filaSup + '</tbody>' +
      '<tfoot><tr style="font-weight:700;background:var(--surface-0)"><td>TOTAL</td><td></td><td class="mono" style="text-align:right">' + fmtPeso(r.total) + '</td><td></td></tr></tfoot>' +
    '</table></div></div>' + bloqueBajas + bloqueFuera;
}

// Escapa un string para incrustarlo como argumento JS en un onclick.
function jsStr(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

async function marcarPagoComision(periodo, beneficiario, tipo, monto) {
  if (comisionPagoDe(periodo, beneficiario, tipo)) { renderCierreMensual(); return; }
  const rec = { periodo, beneficiario, tipo, monto: _num(monto), detalle: '' };
  try {
    const r = await DB.insertRow('comision_pagos', rec);
    AppData.comisionPagos.push(Object.assign({ id: r.id, pagado_en: new Date().toISOString() }, rec));
    persistirComisionesLocal();
    renderCierreMensual();
    showToast('✅ Pago registrado: ' + beneficiario + ' · ' + fmtPeso(monto));
  } catch (e) { console.warn('marcarPagoComision', e); alert('No se pudo registrar el pago: ' + (e.message || e)); }
}
async function deshacerPagoComision(periodo, beneficiario, tipo) {
  const pago = comisionPagoDe(periodo, beneficiario, tipo);
  if (!pago) return;
  if (!confirm('¿Deshacer el pago registrado de ' + beneficiario + ' (' + mesLabel(periodo) + ')?')) return;
  try {
    await DB.deleteWhere('comision_pagos', 'id', pago.id);
    AppData.comisionPagos = AppData.comisionPagos.filter(p => p.id !== pago.id);
    persistirComisionesLocal();
    renderCierreMensual();
    showToast('↺ Pago deshecho');
  } catch (e) { console.warn('deshacerPagoComision', e); showToast('⛔ No se pudo deshacer'); }
}

// ── PDF del cierre mensual ───────────────────────────────────────────────────
function exportComisionesMesPDF() {
  const periodo = document.getElementById('com-cierre-mes')?.value || mesActualYYYYMM();
  const r = calcComisionesMes(periodo);
  if (!r.vendedores.length && !r.bajas.length) { alert('No hay comisiones en ' + mesLabel(periodo) + '.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Liquidación de comisiones', 14, 18);
  doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 50, 70);
  doc.text(mesLabel(periodo), 14, 26);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  doc.text('Generado: ' + new Date().toLocaleString('es-AR'), 14, 31);

  const body = r.vendedores.map(v => [
    v.vendedor,
    v.clientes.map(c => c.cliente + ' (' + (c.categoria || '?') + ')').join(', '),
    v.clientes.length,
    fmtPeso(v.monto)
  ]);
  body.push([{ content: (r.supNombre || 'Supervisor') + ' — supervisor (' + r.pct + '% del equipo)', colSpan: 2, styles: { fontStyle: 'bold' } }, '', fmtPeso(r.supMonto)]);

  doc.autoTable({
    startY: 37,
    head: [['Beneficiario', 'Clientes', 'Cant.', 'Monto']],
    body,
    foot: [[{ content: 'TOTAL A PAGAR', colSpan: 3, styles: { halign: 'right' } }, fmtPeso(r.total)]],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 1: { cellWidth: 78, fontSize: 7 }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });
  // Las bajas van en su propia tabla, en $0: el vendedor tiene que ver que el
  // cliente salió, no que el renglón desapareció.
  if (r.bajas.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Cliente de baja', 'Vendedor', 'Baja', 'Comisión']],
      body: r.bajas.map(b => [
        b.cliente + (b.categoria ? ' (' + b.categoria + ')' : ''),
        b.vendedor,
        (b.mesBaja ? mesLabel(b.mesBaja) : '—') + (b.motivo ? ' · ' + b.motivo : ''),
        '$0'
      ]),
      theme: 'grid',
      headStyles: { fillColor: [140, 30, 30], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5, textColor: [90, 100, 115] },
      columnStyles: { 3: { halign: 'right' } },
      margin: { left: 14, right: 14 }
    });
  }
  doc.save('Comisiones_' + periodo + '.pdf');
  showToast('📥 Comisiones de ' + mesLabel(periodo) + ' descargadas');
}
