// ════════════════════════════════════════════════════════════════════════
//  CLIENTES — facturación por cliente.
//  Cada cliente tiene un tarifario de VENTA por zona (lo que se le cobra por
//  envío entregado). La liquidación es semanal Viernes→Jueves (el jueves es el
//  corte). Se descarga en PDF. El cliente viene en el Excel de recorridos
//  (columna 'cliente' en registros) y se matchea por nombre normalizado.
// ════════════════════════════════════════════════════════════════════════

let clienteEditId = null;

// ── Helpers de cálculo ──────────────────────────────────────────────────────
function normCliente(s) { return normNombre(s); }

// Tarifa de venta de un cliente para una zona (0 si no está cargada).
function clienteTarifaEnZona(cliente, zona) {
  const c = normCliente(cliente), z = normNombre(zona);
  const t = AppData.clienteTarifas.find(x => normCliente(x.cliente) === c && normNombre(x.zona) === z);
  return t ? _num(t.precio) : 0;
}

// Semana de facturación Viernes→Jueves que CONTIENE la fecha dada (ISO o Date).
function semanaClienteRango(iso) {
  const d = iso ? new Date(iso + 'T12:00:00') : new Date();
  const desdeViernes = (d.getDay() - 5 + 7) % 7;      // días transcurridos desde el viernes
  const vie = new Date(d); vie.setDate(d.getDate() - desdeViernes); vie.setHours(0, 0, 0, 0);
  const jue = new Date(vie); jue.setDate(vie.getDate() + 6); jue.setHours(23, 59, 59, 999);
  const fmt = x => String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear();
  return { desde: fmt(vie), hasta: fmt(jue), desdeD: vie, hastaD: jue };
}

// Liquidación de un cliente en un rango { desdeD, hastaD }: envíos ENTREGADOS
// agrupados por zona × tarifa de venta de esa zona.
function calcLiquidacionCliente(cliente, rango) {
  const cKey = normCliente(cliente);
  const desde = rango && rango.desdeD ? rango.desdeD : null;
  const hasta = rango && rango.hastaD ? rango.hastaD : null;
  const porZona = {};
  let totalEnvios = 0, total = 0, sinTarifa = 0;
  AppData.records.forEach(r => {
    if (!cKey || normCliente(r.cliente) !== cKey) return;
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    if (!contabilizaRegistro(r)) return;   // la visita fallida también se le factura al cliente
    if (desde || hasta) { const f = parseFechaReg(r.fecha); if (!f) return; if (desde && f < desde) return; if (hasta && f > hasta) return; }
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim() || '(sin zona)';
    if (!porZona[zona]) porZona[zona] = { zona, count: 0, precio: clienteTarifaEnZona(cliente, zona), subtotal: 0 };
    porZona[zona].count++;
    porZona[zona].subtotal += porZona[zona].precio;
    if (porZona[zona].precio <= 0) sinTarifa++;
    totalEnvios++; total += porZona[zona].precio;
  });
  const filas = Object.values(porZona).sort((a, b) => b.subtotal - a.subtotal);
  return { filas, totalEnvios, total, sinTarifa };
}

// Cantidad de zonas con tarifa cargada de un cliente.
function clienteNZonas(cliente) {
  const c = normCliente(cliente);
  return AppData.clienteTarifas.filter(t => normCliente(t.cliente) === c && _num(t.precio) > 0).length;
}

// ── Persistencia ────────────────────────────────────────────────────────────
function persistirClientesLocal() {
  try {
    localStorage.setItem('liq_clientes', JSON.stringify(AppData.clientes));
    localStorage.setItem('liq_cliente_tarifas', JSON.stringify(AppData.clienteTarifas));
  } catch (e) {}
}

// ── Solapas ────────────────────────────────────────────────────────────────
function switchClientesTab(tab) {
  ['lista', 'liq'].forEach(t => {
    const panel = document.getElementById('cli-tab-' + t);
    const btn = document.getElementById('cli-btn-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'lista') renderClientes();
  else renderLiquidacionClienteSelect();
}

// ── Render lista de clientes ────────────────────────────────────────────────
function renderClientes() {
  const cont = document.getElementById('cli-rows');
  if (!cont) return;
  const q = (document.getElementById('cli-search')?.value || '').toLowerCase().trim();
  const lista = AppData.clientes
    .filter(c => !q || String(c.nombre).toLowerCase().includes(q) || String(c.razon_social || '').toLowerCase().includes(q))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  const countEl = document.getElementById('cli-count');
  if (countEl) countEl.textContent = AppData.clientes.length + ' cliente' + (AppData.clientes.length !== 1 ? 's' : '');

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="empty-icon"><i class="ic ic-building"></i></div><div class="empty-title">Sin clientes</div><div class="empty-sub">Agregá uno con "+ Nuevo cliente" o subí el tarifario</div></div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(c => {
    const nz = clienteNZonas(c.nombre);
    return '<tr' + (c.activo === false ? ' style="opacity:0.55"' : '') + '>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(c.nombre) + ';width:28px;height:28px;font-size:10px">' + initials(c.nombre) + '</div><strong>' + c.nombre + '</strong></div></td>' +
      '<td class="muted" style="font-size:12px">' + (c.razon_social || '—') + (c.cuit ? ' · CUIT ' + c.cuit : '') + '</td>' +
      '<td class="mono" style="text-align:right">' + (nz ? nz + ' zona' + (nz !== 1 ? 's' : '') : '<span style="color:#b45309">sin tarifas</span>') + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="openTarifasCliente(' + c.id + ')" title="Editar tarifario por zona"><i class="ic ic-tag"></i> Tarifas</button>' +
        '<button class="btn btn-sm" onclick="editCliente(' + c.id + ')" title="Editar datos"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarCliente(' + c.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── ABM cliente ──────────────────────────────────────────────────────────────
function openAddClienteModal() {
  clienteEditId = null;
  document.getElementById('modal-cliente-title').textContent = 'Nuevo cliente';
  document.getElementById('mcli-nombre').value = '';
  document.getElementById('mcli-razon').value = '';
  document.getElementById('mcli-cuit').value = '';
  document.getElementById('modal-cliente-backdrop').style.display = 'flex';
}
function editCliente(id) {
  const c = AppData.clientes.find(x => x.id === id);
  if (!c) return;
  clienteEditId = id;
  document.getElementById('modal-cliente-title').textContent = 'Editar cliente';
  document.getElementById('mcli-nombre').value = c.nombre || '';
  document.getElementById('mcli-razon').value = c.razon_social || '';
  document.getElementById('mcli-cuit').value = c.cuit || '';
  document.getElementById('modal-cliente-backdrop').style.display = 'flex';
}
function closeClienteModal(e) {
  if (!e || e.target.id === 'modal-cliente-backdrop') document.getElementById('modal-cliente-backdrop').style.display = 'none';
}
async function guardarClienteModal() {
  const nombre = document.getElementById('mcli-nombre').value.trim().toUpperCase();
  const razon_social = document.getElementById('mcli-razon').value.trim();
  const cuit = document.getElementById('mcli-cuit').value.trim();
  if (!nombre) { alert('El nombre del cliente es obligatorio.'); return; }
  // Nombre único (por normalizado)
  const dup = AppData.clientes.find(c => normCliente(c.nombre) === normCliente(nombre) && c.id !== clienteEditId);
  if (dup) { alert('Ya existe un cliente "' + nombre + '".'); return; }
  try {
    if (clienteEditId != null) {
      await DB.updateWhere('clientes', 'id', clienteEditId, { nombre, razon_social, cuit });
      const c = AppData.clientes.find(x => x.id === clienteEditId);
      if (c) { c.nombre = nombre; c.razon_social = razon_social; c.cuit = cuit; }
    } else {
      const row = await DB.insertRow('clientes', { nombre, razon_social, cuit, activo: true });
      AppData.clientes.push({ id: row.id, nombre, razon_social, cuit, activo: true });
    }
    persistirClientesLocal();
    clienteEditId = null;
    document.getElementById('modal-cliente-backdrop').style.display = 'none';
    renderClientes();
    showToast('✅ Cliente guardado');
  } catch (e) { console.warn('guardarClienteModal:', e); alert('No se pudo guardar: ' + (e.message || e)); }
}
async function eliminarCliente(id) {
  const c = AppData.clientes.find(x => x.id === id);
  if (!c) return;
  if (!confirm('¿Eliminar el cliente ' + c.nombre + '?\nSe borra también su tarifario. Los recorridos NO se tocan.')) return;
  try {
    await DB.deleteWhere('cliente_tarifas', 'cliente', c.nombre);
    await DB.deleteWhere('clientes', 'id', id);
    AppData.clientes = AppData.clientes.filter(x => x.id !== id);
    AppData.clienteTarifas = AppData.clienteTarifas.filter(t => normCliente(t.cliente) !== normCliente(c.nombre));
    persistirClientesLocal();
    renderClientes();
    showToast('🗑 Cliente eliminado');
  } catch (e) { console.warn('eliminarCliente:', e); showToast('⛔ No se pudo eliminar'); }
}

// ── Editor de tarifas por zona (por cliente) ────────────────────────────────
let tarifasClienteNombre = '';
function openTarifasCliente(id) {
  const c = AppData.clientes.find(x => x.id === id);
  if (!c) return;
  tarifasClienteNombre = c.nombre;
  document.getElementById('modal-cli-tarifas-title').textContent = 'Tarifario de venta · ' + c.nombre;
  // Zonas: las del tarifario base (AppData.tarifas) + las que ya tenga el cliente.
  const zonas = new Set(AppData.tarifas.map(t => String(t.zona || '').toUpperCase().trim()).filter(Boolean));
  AppData.clienteTarifas.filter(t => normCliente(t.cliente) === normCliente(c.nombre))
    .forEach(t => zonas.add(String(t.zona || '').toUpperCase().trim()));
  const precioDe = z => {
    const t = AppData.clienteTarifas.find(x => normCliente(x.cliente) === normCliente(c.nombre) && normNombre(x.zona) === normNombre(z));
    return t ? _num(t.precio) : '';
  };
  const rows = Array.from(zonas).sort().map(z =>
    '<div style="display:grid;grid-template-columns:1fr 130px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:13px">' + z + '</span>' +
      '<div style="display:flex;align-items:center;gap:6px"><span class="muted" style="font-size:12px">$</span>' +
        '<input type="number" min="0" step="1" data-zona="' + z.replace(/"/g, '&quot;') + '" value="' + (precioDe(z) === '' ? '' : precioDe(z)) + '" placeholder="0" style="width:110px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;text-align:right;font-family:monospace">' +
      '</div>' +
    '</div>').join('');
  document.getElementById('mcli-tarifas-body').innerHTML = rows || '<div class="muted" style="padding:10px">No hay zonas en el tarifario base. Cargá zonas en Tarifas primero, o subí el tarifario por Excel.</div>';
  document.getElementById('modal-cli-tarifas-backdrop').style.display = 'flex';
}
function closeCliTarifasModal(e) {
  if (!e || e.target.id === 'modal-cli-tarifas-backdrop') document.getElementById('modal-cli-tarifas-backdrop').style.display = 'none';
}
async function guardarTarifasCliente() {
  const nombre = tarifasClienteNombre;
  const inputs = Array.from(document.querySelectorAll('#mcli-tarifas-body input[data-zona]'));
  const nuevas = inputs.map(inp => ({ cliente: nombre, zona: inp.getAttribute('data-zona'), precio: parseFloat(inp.value) || 0 }))
    .filter(t => t.precio > 0);
  try {
    // Reemplaza el tarifario del cliente (borrar + insertar).
    await DB.deleteWhere('cliente_tarifas', 'cliente', nombre);
    let inserted = [];
    if (nuevas.length) inserted = await guardarClienteTarifas(nuevas);
    AppData.clienteTarifas = AppData.clienteTarifas.filter(t => normCliente(t.cliente) !== normCliente(nombre)).concat(inserted);
    persistirClientesLocal();
    document.getElementById('modal-cli-tarifas-backdrop').style.display = 'none';
    renderClientes();
    showToast('✅ Tarifario de ' + nombre + ' guardado (' + nuevas.length + ' zonas)');
  } catch (e) { console.warn('guardarTarifasCliente:', e); alert('No se pudo guardar el tarifario: ' + (e.message || e)); }
}
// Inserta filas de cliente_tarifas y devuelve las filas con id.
async function guardarClienteTarifas(rows) {
  const ids = await DB.insertRows('cliente_tarifas', rows);
  return rows.map((r, i) => ({ id: ids[i], cliente: r.cliente, zona: r.zona, precio: _num(r.precio) }));
}

// ── Import Excel del tarifario (Cliente · Zona · Precio) ─────────────────────
function descargarPlantillaTarifario() {
  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por Cliente+Zona. El precio es lo que le COBRÁS al cliente por envío entregado en esa zona.'],
    ['Cliente', 'Zona', 'Precio'],
    ['MERCADO LIBRE', 'LA PLATA', 3200],
    ['MERCADO LIBRE', 'CABA', 2100],
    ['EMPRESA XYZ', 'QUILMES', 2600],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 22 }, { wch: 12 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tarifario');
  XLSX.writeFile(wb, 'Plantilla_Tarifario_Clientes.xlsx');
  showToast('📥 Plantilla descargada — completá y volvé a subirla sin tocar los encabezados');
}

function importTarifarioClientes(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }

      let headerRowIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const cells = rows[r].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
        if (cells.includes('cliente') && (cells.includes('zona') || cells.includes('localidad'))) { headerRowIdx = r; break; }
      }
      if (headerRowIdx < 0) { alert('No se encontraron las columnas "Cliente" y "Zona". Descargá la plantilla oficial.'); return; }
      const header = rows[headerRowIdx].map(h => String(h).toLowerCase().trim());
      const iCli = header.findIndex(h => h.includes('cliente') || h.includes('empresa'));
      const iZona = header.findIndex(h => h.includes('zona') || h.includes('localidad'));
      const iPrecio = header.findIndex(h => h.includes('precio') || h.includes('tarifa') || h.includes('monto') || h.includes('valor'));
      if (iCli < 0 || iZona < 0 || iPrecio < 0) { alert('Faltan columnas Cliente / Zona / Precio.'); return; }

      const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
      // Agrupar por cliente
      const porCliente = {};
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const cliente = String(r[iCli] || '').trim().toUpperCase();
        const zona = String(r[iZona] || '').trim().toUpperCase();
        const precio = parseNum(r[iPrecio]);
        if (!cliente || !zona || precio <= 0) continue;
        if (!porCliente[cliente]) porCliente[cliente] = {};
        porCliente[cliente][zona] = precio; // última gana
      }
      const nombresCli = Object.keys(porCliente);
      if (!nombresCli.length) { alert('No se importó ninguna tarifa válida (Cliente, Zona y Precio > 0).'); return; }

      let clientesNuevos = 0, zonasTotal = 0;
      for (const nombre of nombresCli) {
        // Crear el cliente si no existe
        let cli = AppData.clientes.find(c => normCliente(c.nombre) === normCliente(nombre));
        if (!cli) {
          try {
            const row = await DB.insertRow('clientes', { nombre, razon_social: '', cuit: '', activo: true });
            cli = { id: row.id, nombre, razon_social: '', cuit: '', activo: true };
            AppData.clientes.push(cli);
            clientesNuevos++;
          } catch (err) { console.warn('crear cliente import', nombre, err); continue; }
        }
        // Reemplazar sus tarifas
        const filas = Object.entries(porCliente[nombre]).map(([zona, precio]) => ({ cliente: nombre, zona, precio }));
        try {
          await DB.deleteWhere('cliente_tarifas', 'cliente', nombre);
          const inserted = await guardarClienteTarifas(filas);
          AppData.clienteTarifas = AppData.clienteTarifas.filter(t => normCliente(t.cliente) !== normCliente(nombre)).concat(inserted);
          zonasTotal += filas.length;
        } catch (err) { console.warn('tarifas import', nombre, err); }
      }
      persistirClientesLocal();
      renderClientes();
      showToast('✅ Tarifario importado: ' + nombresCli.length + ' cliente(s) · ' + zonasTotal + ' tarifas' + (clientesNuevos ? ' · ' + clientesNuevos + ' nuevo(s)' : ''));
    } catch (err) {
      console.error(err);
      alert('Error al importar el tarifario: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Liquidación de cliente ───────────────────────────────────────────────────
function renderLiquidacionClienteSelect() {
  const sel = document.getElementById('cli-liq-cliente');
  if (sel) {
    const actual = sel.value;
    sel.innerHTML = '<option value="">Elegí un cliente…</option>' +
      AppData.clientes.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
        .map(c => '<option value="' + String(c.nombre).replace(/"/g, '&quot;') + '">' + c.nombre + '</option>').join('');
    sel.value = actual;
  }
  const f = document.getElementById('cli-liq-fecha');
  if (f && !f.value) f.value = hoyISO();
  renderLiquidacionCliente();
}

function renderLiquidacionCliente() {
  const body = document.getElementById('cli-liq-body');
  if (!body) return;
  const cliente = document.getElementById('cli-liq-cliente')?.value || '';
  const iso = document.getElementById('cli-liq-fecha')?.value || hoyISO();
  const rango = semanaClienteRango(iso);
  const perEl = document.getElementById('cli-liq-periodo');
  if (perEl) perEl.textContent = 'Semana ' + rango.desde + ' → ' + rango.hasta;

  if (!cliente) {
    body.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon"><i class="ic ic-file"></i></div><div class="empty-title">Elegí un cliente</div><div class="empty-sub">Y la semana (jueves de corte) para ver su liquidación</div></div>';
    return;
  }
  const liq = calcLiquidacionCliente(cliente, rango);
  const filasHtml = liq.filas.length ? liq.filas.map(f =>
    '<tr>' +
      '<td><strong>' + f.zona + '</strong></td>' +
      '<td class="mono" style="text-align:right">' + f.count + '</td>' +
      '<td class="mono" style="text-align:right">' + (f.precio > 0 ? fmtPeso(f.precio) : '<span style="color:#b45309">sin tarifa</span>') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(f.subtotal) + '</td>' +
    '</tr>').join('')
    : '<tr><td colspan="4"><div class="empty-state"><div class="empty-sub">Sin envíos entregados de este cliente en la semana</div></div></td></tr>';

  body.innerHTML =
    '<div class="metrics-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-dollar"></i></div><div class="metric-label">Total a facturar</div><div class="metric-value">' + fmtPeso(liq.total) + '</div><div class="metric-sub">' + rango.desde + ' → ' + rango.hasta + '</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-box"></i></div><div class="metric-label">Envíos entregados</div><div class="metric-value">' + liq.totalEnvios + '</div><div class="metric-sub">' + liq.filas.length + ' zona(s)</div></div>' +
      '<div class="metric-card"><div class="metric-ic"><i class="ic ic-alert"></i></div><div class="metric-label">Envíos sin tarifa</div><div class="metric-value"' + (liq.sinTarifa ? ' style="color:#b45309"' : '') + '>' + liq.sinTarifa + '</div><div class="metric-sub">cargá esas zonas en el tarifario</div></div>' +
    '</div>' +
    '<div class="card"><div class="table-wrap"><table>' +
      '<thead><tr><th>Zona</th><th style="text-align:right">Envíos</th><th style="text-align:right">Tarifa</th><th style="text-align:right">Subtotal</th></tr></thead>' +
      '<tbody>' + filasHtml + '</tbody>' +
      (liq.filas.length ? '<tfoot><tr style="font-weight:700;background:var(--surface-0)"><td>TOTAL</td><td class="mono" style="text-align:right">' + liq.totalEnvios + '</td><td></td><td class="mono" style="text-align:right">' + fmtPeso(liq.total) + '</td></tr></tfoot>' : '') +
    '</table></div></div>';
}

function exportLiquidacionClientePDF() {
  const cliente = document.getElementById('cli-liq-cliente')?.value || '';
  if (!cliente) { alert('Elegí un cliente primero.'); return; }
  const iso = document.getElementById('cli-liq-fecha')?.value || hoyISO();
  const rango = semanaClienteRango(iso);
  const liq = calcLiquidacionCliente(cliente, rango);
  if (!liq.filas.length) { alert('Sin envíos entregados de este cliente en la semana ' + rango.desde + ' → ' + rango.hasta + '.'); return; }
  const cli = AppData.clientes.find(c => normCliente(c.nombre) === normCliente(cliente));
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 39, 68);
  doc.text('Liquidación de cliente', 14, 18);
  doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 50, 70);
  doc.text(cliente, 14, 26);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(110);
  let sub = 'Semana ' + rango.desde + ' → ' + rango.hasta + ' (corte jueves)';
  if (cli && (cli.razon_social || cli.cuit)) sub = (cli.razon_social || '') + (cli.cuit ? ' · CUIT ' + cli.cuit : '') + '   ·   ' + sub;
  doc.text(sub, 14, 31);
  doc.text('Generado: ' + new Date().toLocaleString('es-AR'), 14, 35.5);

  const body = liq.filas.map(f => [f.zona, f.count, f.precio > 0 ? fmtPeso(f.precio) : 'sin tarifa', fmtPeso(f.subtotal)]);
  doc.autoTable({
    startY: 41,
    head: [['Zona', 'Envíos', 'Tarifa', 'Subtotal']],
    body,
    foot: [[{ content: 'TOTAL · ' + liq.totalEnvios + ' envíos', colSpan: 3, styles: { halign: 'right' } }, fmtPeso(liq.total)]],
    theme: 'striped',
    headStyles: { fillColor: [26, 39, 68], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    footStyles: { fillColor: [37, 79, 161], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8.5, textColor: [40, 50, 70] },
    alternateRowStyles: { fillColor: [244, 247, 252] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  });
  if (liq.sinTarifa) {
    const y = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(8); doc.setTextColor(180, 83, 9);
    doc.text('⚠ ' + liq.sinTarifa + ' envío(s) sin tarifa de venta cargada — no suman al total. Cargá esas zonas en el tarifario del cliente.', 14, y);
  }
  doc.save('Liquidacion_' + cliente.replace(/\s+/g, '_') + '_' + rango.hasta.replace(/\//g, '-') + '.pdf');
  showToast('📥 Liquidación de ' + cliente + ' descargada');
}
