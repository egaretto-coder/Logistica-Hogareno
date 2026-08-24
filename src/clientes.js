// ════════════════════════════════════════════════════════════════════════
//  CLIENTES — facturación por cliente.
//  Cada cliente tiene un tarifario de VENTA por zona (lo que se le cobra por
//  envío entregado). La liquidación es semanal Viernes→Jueves (el jueves es el
//  corte). Se descarga en PDF.
//
//  IDENTIDAD = el CÓDIGO de cliente (registros.cliente_cod, columna
//  "Cod.Cliente" del listado). Viene en todas las filas y es único. El nombre
//  de fantasía (registros.cliente) es solo para mostrar: trae variantes
//  ("Bluemail" / "BLUEMAIL") que, usadas como clave, partirían al cliente en
//  dos — el mismo problema que resolvimos con los alias de conductores.
// ════════════════════════════════════════════════════════════════════════

let clienteEditId = null;

// ── Identidad ───────────────────────────────────────────────────────────────
function normCliente(s) { return normNombre(s); }

// Código de un registro. Si el envío es viejo y no lo trae, cae al nombre para
// no perderlo (esos envíos no se pueden facturar por código).
function clienteCodDeRegistro(r) {
  return String((r && r.cliente_cod) || '').trim().toUpperCase();
}
function clienteKey(cod) { return String(cod || '').trim().toUpperCase(); }

// Nombre para mostrar de un código: el del maestro si está cargado, si no el
// último nombre de fantasía visto en los envíos.
function clienteNombreDe(cod) {
  const k = clienteKey(cod);
  if (!k) return '(sin cliente)';
  const c = (AppData.clientes || []).find(x => clienteKey(x.codigo) === k);
  if (c && c.nombre) return c.nombre;
  const r = (AppData.records || []).find(x => clienteCodDeRegistro(x) === k && String(x.cliente || '').trim());
  return r ? String(r.cliente).trim() : k;
}

// Códigos de cliente presentes en los envíos (con su nombre y cuántos envíos).
function clientesDeRegistros(rango) {
  const m = new Map();
  (AppData.records || []).forEach(r => {
    const k = clienteCodDeRegistro(r);
    if (!k) return;
    if (rango && (rango.desdeD || rango.hastaD)) {
      const f = parseFechaReg(r.fecha);
      if (!f) return;
      if (rango.desdeD && f < rango.desdeD) return;
      if (rango.hastaD && f > rango.hastaD) return;
    }
    let x = m.get(k);
    if (!x) { x = { cod: k, nombre: String(r.cliente || '').trim() || k, envios: 0 }; m.set(k, x); }
    x.envios++;
    if (!x.nombre && r.cliente) x.nombre = String(r.cliente).trim();
  });
  return Array.from(m.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Tarifa de venta de un cliente (por CÓDIGO) para una zona. 0 = sin cargar.
function clienteTarifaEnZona(cod, zona) {
  const k = clienteKey(cod), z = normNombre(zona);
  const t = (AppData.clienteTarifas || []).find(x =>
    (clienteKey(x.cliente_cod) === k || (!x.cliente_cod && normCliente(x.cliente) === normCliente(k))) &&
    normNombre(x.zona) === z);
  return t ? _num(t.precio) : 0;
}

// Lo que se le PAGA al conductor por ese envío (para el margen).
function precioPagadoConductor(r) {
  if (typeof precioManualDe === 'function') {
    const m = precioManualDe(r);
    if (m !== null && m !== undefined) return _num(m);
  }
  if (typeof precioAutoDe === 'function') return _num(precioAutoDe(r).precio);
  return 0;
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
  const cKey = clienteKey(cliente);
  const desde = rango && rango.desdeD ? rango.desdeD : null;
  const hasta = rango && rango.hastaD ? rango.hastaD : null;
  const porZona = {};
  let totalEnvios = 0, total = 0, sinTarifa = 0;
  AppData.records.forEach(r => {
    if (!cKey || clienteCodDeRegistro(r) !== cKey) return;
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    if (!contabilizaRegistro(r)) return;   // la visita fallida también se le factura al cliente
    if (desde || hasta) { const f = parseFechaReg(r.fecha); if (!f) return; if (desde && f < desde) return; if (hasta && f > hasta) return; }
    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim() || '(sin zona)';
    if (!porZona[zona]) porZona[zona] = { zona, count: 0, precio: clienteTarifaEnZona(cKey, zona), subtotal: 0, pagado: 0 };
    porZona[zona].pagado += precioPagadoConductor(r);   // para el margen
    porZona[zona].count++;
    porZona[zona].subtotal += porZona[zona].precio;
    if (porZona[zona].precio <= 0) sinTarifa++;
    totalEnvios++; total += porZona[zona].precio;
  });
  const filas = Object.values(porZona).sort((a, b) => b.subtotal - a.subtotal);
  const pagado = filas.reduce((s, f) => s + _num(f.pagado), 0);
  // Margen = lo que se le cobra al cliente menos lo que se le paga al conductor
  // por esos mismos envíos. Es el número que conecta las dos liquidaciones.
  return { filas, totalEnvios, total, sinTarifa, pagado, margen: total - pagado };
}

// Cantidad de zonas con tarifa cargada de un cliente.
function clienteNZonas(cod) {
  const k = clienteKey(cod);
  return (AppData.clienteTarifas || []).filter(t =>
    (clienteKey(t.cliente_cod) === k || (!t.cliente_cod && normCliente(t.cliente) === normCliente(k))) &&
    _num(t.precio) > 0).length;
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
// Ficha de cada cliente: identificación, contacto y cómo viene facturando.
// El administrativo necesita cotejar sin salir del panel: con quién hablar, con
// qué razón social se factura y —sobre todo— si hay zonas SIN TARIFA, que se
// facturan en $0 y se comen el margen sin avisar.
function renderClientes() {
  const cont = document.getElementById('cli-cards');
  if (!cont) return;
  const q = (document.getElementById('cli-search')?.value || '').toLowerCase().trim();

  // Semana en curso, para mostrar actividad reciente.
  const rango = semanaClienteRango();
  const conEnvios = clientesDeRegistros(rango);
  const porCod = new Map(conEnvios.map(c => [c.cod, c]));

  const lista = (AppData.clientes || [])
    .filter(c => !q || String(c.nombre).toLowerCase().includes(q) ||
                 String(c.codigo || '').toLowerCase().includes(q) ||
                 String(c.razon_social || '').toLowerCase().includes(q))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  const countEl = document.getElementById('cli-count');
  if (countEl) {
    const sinTarifa = (AppData.clientes || []).filter(c => clienteNZonas(c.codigo) === 0).length;
    countEl.textContent = (AppData.clientes || []).length + ' cliente(s)' +
      (sinTarifa ? ' · ' + sinTarifa + ' sin tarifario' : '');
  }

  // Clientes que aparecen en los envíos pero no están dados de alta.
  const faltantes = conEnvios.filter(c => !(AppData.clientes || []).some(x => clienteKey(x.codigo) === c.cod));
  const avisoEl = document.getElementById('cli-faltantes');
  if (avisoEl) {
    avisoEl.innerHTML = faltantes.length
      ? '<div class="alert alert-info" style="margin:0 0 12px"><i class="ic ic-alert"></i><div>' +
        '<strong>' + faltantes.length + ' cliente(s) con envíos esta semana no están dados de alta:</strong> ' +
        faltantes.slice(0, 8).map(f => f.nombre + ' (' + f.cod + ')').join(', ') +
        (faltantes.length > 8 ? ' y ' + (faltantes.length - 8) + ' más' : '') + '. ' +
        '<button class="btn btn-sm" style="margin-left:6px" onclick="altaClientesFaltantes()">Darlos de alta</button></div></div>'
      : '';
  }

  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="ic ic-building"></i></div>' +
      '<div class="empty-title">' + (q ? 'Ningún cliente coincide' : 'Sin clientes') + '</div>' +
      '<div class="empty-sub">' + (q ? 'Probá con otro texto' : 'Agregá uno con "+ Nuevo cliente" o importá el tarifario') + '</div></div>';
    return;
  }

  cont.innerHTML = lista.map(c => {
    const cod = clienteKey(c.codigo);
    const nz = clienteNZonas(cod);
    const act = porCod.get(cod);
    const liq = act ? calcLiquidacionCliente(cod, rango) : null;
    const margenPct = liq && liq.total > 0 ? (liq.margen * 100 / liq.total) : 0;
    const dato = (etq, val) =>
      '<div><span style="font-size:10px;color:var(--text-muted);display:block">' + etq + '</span>' +
      '<span style="font-size:12px;font-weight:600">' + val + '</span></div>';

    return '<div class="card"' + (c.activo === false ? ' style="opacity:.6"' : '') + '>' +
      '<div class="card-body">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
          '<div class="conductor-avatar" style="background:' + avatarColor(c.nombre) + ';width:38px;height:38px;font-size:13px">' + initials(c.nombre) + '</div>' +
          '<div style="min-width:0;flex:1">' +
            '<div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + c.nombre + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">' +
              (cod ? '<span class="tag" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;font-size:9.5px">' + cod + '</span> ' : '<span style="color:#b91c1c">sin código</span> ') +
              (c.cuit ? 'CUIT ' + c.cuit : '') + '</div>' +
          '</div>' +
        '</div>' +

        (c.razon_social || c.contacto || c.telefono || c.email
          ? '<div style="font-size:11px;color:var(--text-secondary);padding:8px 0;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:2px">' +
            (c.razon_social ? '<div><i class="ic ic-building"></i> ' + c.razon_social + '</div>' : '') +
            (c.contacto ? '<div><i class="ic ic-user"></i> ' + c.contacto + '</div>' : '') +
            (c.telefono ? '<div><i class="ic ic-phone"></i> ' + c.telefono + '</div>' : '') +
            (c.email ? '<div style="overflow:hidden;text-overflow:ellipsis"><i class="ic ic-mail"></i> ' + c.email + '</div>' : '') +
            '</div>'
          : '') +

        '<div style="display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)">' +
          dato('Zonas con tarifa', nz ? nz : '<span style="color:#b45309">ninguna</span>') +
          dato('Envíos esta semana', act ? act.envios : '—') +
          (liq ? dato('Se factura', fmtPeso(liq.total)) : '') +
          (liq ? dato('Margen', '<span style="color:' + (liq.margen >= 0 ? '#166534' : '#b91c1c') + '">' + fmtPeso(liq.margen) + ' · ' + margenPct.toFixed(0) + '%</span>') : '') +
        '</div>' +

        (liq && liq.sinTarifa
          ? '<div style="font-size:11px;color:#b45309;padding:6px 0"><i class="ic ic-alert"></i> ' + liq.sinTarifa + ' envío(s) en zonas sin tarifa — se facturan en $0</div>'
          : '') +
        (c.obs ? '<div style="font-size:10.5px;color:var(--text-muted);padding:4px 0;font-style:italic">' + c.obs + '</div>' : '') +

        '<div style="display:flex;gap:4px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border)">' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="openTarifasCliente(' + c.id + ')"><i class="ic ic-tag"></i> Tarifas' + (nz ? ' (' + nz + ')' : '') + '</button>' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:11px" onclick="verDetalleDeCliente(\'' + cod + '\')" title="Ver sus envíos y el margen"><i class="ic ic-list"></i> Detalle</button>' +
          '<button class="btn btn-sm" style="margin-left:auto" onclick="editCliente(' + c.id + ')" title="Editar datos"><i class="ic ic-edit"></i></button>' +
          '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarCliente(' + c.id + ')" title="Dar de baja"><i class="ic ic-trash"></i></button>' +
        '</div>' +
      '</div></div>';
  }).join('');
}

// Salta al detalle del cliente con el cliente ya elegido.
function verDetalleDeCliente(cod) {
  showPage('detalle-cliente');
  setTimeout(() => {
    const sel = document.getElementById('dcli-select');
    if (sel) { sel.value = cod; renderDetalleCliente(); }
  }, 80);
}

// Da de alta los clientes que aparecen en los envíos y no están en el maestro.
async function altaClientesFaltantes() {
  const rango = semanaClienteRango();
  const faltantes = clientesDeRegistros(rango)
    .filter(c => !(AppData.clientes || []).some(x => clienteKey(x.codigo) === c.cod));
  if (!faltantes.length) { showToast('No hay clientes nuevos'); return; }
  if (!confirm('¿Dar de alta ' + faltantes.length + ' cliente(s)?\n\n' +
    faltantes.slice(0, 12).map(f => '· ' + f.nombre + ' (' + f.cod + ')').join('\n') +
    (faltantes.length > 12 ? '\n…y ' + (faltantes.length - 12) + ' más' : '') +
    '\n\nDespués hay que cargarles el tarifario por zona.')) return;
  let ok = 0;
  for (const f of faltantes) {
    try {
      const row = await DB.insertRow('clientes', { nombre: f.nombre, codigo: f.cod, razon_social: '', cuit: '', activo: true });
      AppData.clientes.push({ id: row.id, nombre: f.nombre, codigo: f.cod, razon_social: '', cuit: '', contacto: '', telefono: '', email: '', obs: '', activo: true });
      ok++;
    } catch (e) { console.warn('alta cliente ' + f.cod, e); }
  }
  persistirClientesLocal();
  renderClientes();
  showToast('✅ ' + ok + ' cliente(s) dados de alta — cargales el tarifario');
}
function openAddClienteModal() {
  clienteEditId = null;
  document.getElementById('modal-cliente-title').textContent = 'Nuevo cliente';
  document.getElementById('mcli-nombre').value = '';
  ['mcli-codigo','mcli-razon','mcli-contacto','mcli-telefono','mcli-email','mcli-obs'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('mcli-cuit').value = '';
  document.getElementById('modal-cliente-backdrop').style.display = 'flex';
}
function editCliente(id) {
  const c = AppData.clientes.find(x => x.id === id);
  if (!c) return;
  clienteEditId = id;
  document.getElementById('modal-cliente-title').textContent = 'Editar cliente';
  document.getElementById('mcli-nombre').value = c.nombre || '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('mcli-codigo', c.codigo); set('mcli-razon', c.razon_social);
  set('mcli-contacto', c.contacto); set('mcli-telefono', c.telefono);
  set('mcli-email', c.email); set('mcli-obs', c.obs);
  document.getElementById('mcli-cuit').value = c.cuit || '';
  document.getElementById('modal-cliente-backdrop').style.display = 'flex';
}
function closeClienteModal(e) {
  if (!e || e.target.id === 'modal-cliente-backdrop') document.getElementById('modal-cliente-backdrop').style.display = 'none';
}
async function guardarClienteModal() {
  const nombre = document.getElementById('mcli-nombre').value.trim().toUpperCase();
  const codigo = (document.getElementById('mcli-codigo')?.value || '').trim().toUpperCase();
  const razon_social = document.getElementById('mcli-razon').value.trim();
  const cuit = document.getElementById('mcli-cuit').value.trim();
  const contacto = (document.getElementById('mcli-contacto')?.value || '').trim();
  const telefono = (document.getElementById('mcli-telefono')?.value || '').trim();
  const email = (document.getElementById('mcli-email')?.value || '').trim();
  const obs = (document.getElementById('mcli-obs')?.value || '').trim();
  if (!nombre) { alert('El nombre del cliente es obligatorio.'); return; }
  if (!codigo) { alert('El código es obligatorio: es lo que une al cliente con sus envíos (columna Cod.Cliente del listado).'); return; }
  const dupCod = AppData.clientes.find(c => clienteKey(c.codigo) === clienteKey(codigo) && c.id !== clienteEditId);
  if (dupCod) { alert('El código "' + codigo + '" ya lo usa ' + dupCod.nombre + '.'); return; }
  // Nombre único (por normalizado)
  const dup = AppData.clientes.find(c => normCliente(c.nombre) === normCliente(nombre) && c.id !== clienteEditId);
  if (dup) { alert('Ya existe un cliente "' + nombre + '".'); return; }
  try {
    if (clienteEditId != null) {
      await DB.updateWhere('clientes', 'id', clienteEditId, { nombre, codigo, razon_social, cuit, contacto, telefono, email, obs });
      const c = AppData.clientes.find(x => x.id === clienteEditId);
      if (c) Object.assign(c, { nombre, codigo, razon_social, cuit, contacto, telefono, email, obs });
    } else {
      const row = await DB.insertRow('clientes', { nombre, codigo, razon_social, cuit, contacto, telefono, email, obs, activo: true });
      AppData.clientes.push({ id: row.id, nombre, codigo, razon_social, cuit, contacto, telefono, email, obs, activo: true });
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
  // Se canoniza acá también: es el único punto por el que pasan TODAS las
  // tarifas que se guardan, venga del import o de una edición a mano.
  rows = rows.map(r => Object.assign({}, r, { zona: zonaCanonica(r.zona) }));
  const ids = await DB.insertRows('cliente_tarifas', rows);
  return rows.map((r, i) => ({ id: ids[i], cliente: r.cliente, cliente_cod: (r.cliente_cod || '').toUpperCase(), zona: r.zona, precio: _num(r.precio) }));
}

// ── Import Excel del tarifario (Cliente · Zona · Precio) ─────────────────────
// Baja el tarifario COMPLETO (no una plantilla vacía): el circuito real es
// descargar → actualizar precios / sumar zonas → volver a subir. Con una
// plantilla en blanco habría que recargar todo de cero cada vez.
function descargarPlantillaTarifario() {
  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por Cod.Cliente + Zona. El precio es lo que le COBRÁS al cliente por envío entregado en esa zona. El código es el que trae el listado de envíos (Cod.Cliente).'],
    ['Cod.Cliente', 'Cliente', 'Zona', 'Precio']
  ];

  const filas = [];
  (AppData.clienteTarifas || []).forEach(t => {
    const cod = clienteKey(t.cliente_cod);
    filas.push([cod, cod ? clienteNombreDe(cod) : (t.cliente || ''), t.zona || '', _num(t.precio)]);
  });
  // Clientes sin ninguna tarifa: van igual, con las zonas del tarifario en 0,
  // así se completan en el mismo archivo en vez de tener que agregarlos a mano.
  const zonas = (typeof zonasDelTarifario === 'function') ? zonasDelTarifario() : [];
  (AppData.clientes || []).forEach(c => {
    const cod = clienteKey(c.codigo);
    if (!cod || clienteNZonas(cod) > 0) return;
    if (zonas.length) zonas.forEach(z => filas.push([cod, c.nombre, z, 0]));
    else filas.push([cod, c.nombre, '', 0]);
  });

  if (filas.length) {
    filas.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2])));
    filas.forEach(f => aoa.push(f));
  } else {
    aoa.push(['BLUE', 'BLUEMAIL', 'QUILMES', 5000]);
    aoa.push(['BLUE', 'BLUEMAIL', 'LA PLATA', 6200]);
    aoa.push(['ART', 'ARTEC', 'CABA', 4800]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 22 }, { wch: 12 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tarifario');
  const hoy = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Tarifario_Clientes_' + hoy + '.xlsx');
  showToast(filas.length
    ? '📥 Tarifario descargado: ' + filas.length + ' fila(s) — actualizalo y volvé a subirlo'
    : '📥 Plantilla descargada (todavía no hay tarifas) — completala y subila');
}
// ── Importación de tarifarios ────────────────────────────────────────────────
// Acepta VARIOS archivos de una vez y dos formatos por archivo:
//   · tarifario completo      → Cod.Cliente · Cliente · Zona · Precio
//   · planilla de un cliente  → su nombre arriba y debajo las columnas ZONA y PRECIO
//
// En la planilla de un cliente el código NO viene en el archivo, y las tarifas
// se atan a cliente_cod. Se resuelve por nombre (maestro → envíos) y, si no
// aparece en ninguno, se le asigna uno PROVISIONAL derivado del nombre para que
// el cliente quede creado igual — que es lo que hace falta en la primera carga.
// El resumen final marca cuáles quedaron provisionales: un código que no matchea
// ningún envío factura en $0 sin que nadie lo note, así que hay que corregirlos.

// Código inventado a partir del nombre, único contra los ya usados. Se nota a
// simple vista que no es un código real (los de verdad son cortos: CIM, GMC),
// justamente para que salte a la vista que hay que revisarlo.
function _codigoProvisional(nombre, usados) {
  const base = String(normNombre(nombre) || '').replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'CLIENTE';
  let cod = base, n = 2;
  while (usados.has(cod)) { cod = base.slice(0, 10) + n; n++; }
  return cod;
}

function importTarifarioClientes(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  _procesarTarifarios(files).finally(() => { event.target.value = ''; });
}

async function _procesarTarifarios(files) {
  // Los códigos REALES salen de los envíos. Si todavía se están cargando, todos
  // los clientes quedarían con código provisional al pedo.
  if (AppData._cargandoRegistros) {
    if (!confirm('Los recorridos todavía se están cargando, así que los códigos de cliente pueden no encontrarse ' +
      'y quedar provisionales.\n\nConviene esperar unos segundos y reintentar.\n\n¿Importar igual?')) return;
  }
  const resultados = [];
  for (const file of files) {
    try { resultados.push(await _importarUnTarifario(file)); }
    catch (e) {
      console.warn('importar tarifario', file.name, e);
      resultados.push({ archivo: file.name, error: e.message || String(e), clientes: [] });
    }
  }
  persistirClientesLocal();
  renderClientes();
  _resumenImportTarifarios(resultados);
}

// Lee y aplica UN archivo. Devuelve qué hizo, para el resumen.
function _importarUnTarifario(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = async function (e) {
      try { resolve(await _aplicarTarifario(file.name, new Uint8Array(e.target.result))); }
      catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function _aplicarTarifario(nombreArchivo, bytes) {
  const wb = XLSX.read(bytes, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const res = { archivo: nombreArchivo, clientes: [], zonasDesconocidas: [], repetidas: 0, ignoradas: 0 };
  if (rows.length < 2) throw new Error('El archivo está vacío');

  const norm = x => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const esCod    = c => c.includes('codcliente') || c.includes('codigocliente') || c === 'codigo' || c === 'cod';
  const esCli    = c => (c.includes('cliente') || c.includes('empresa')) && !esCod(c);
  const esZona   = c => c.includes('zona') || c.includes('localidad');
  const esPrecio = c => c.includes('precio') || c.includes('tarifa') || c.includes('monto') || c.includes('valor');

  // Cada concepto en una columna DISTINTA. Sin esa condición, la fila del aviso
  // (que nombra "Cod.Cliente" y "Zona") se toma como encabezado y todo se
  // importa desde la misma columna — el bug que ya tuvimos en dimensiones.
  let h = -1, cols = null;
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const cells = (rows[r] || []).map(norm);
    const iCod = cells.findIndex(esCod);
    const iZona = cells.findIndex(esZona);
    const iPrecio = cells.findIndex(esPrecio);
    if (iCod >= 0 && iZona >= 0 && iPrecio >= 0 && iCod !== iZona && iZona !== iPrecio && iCod !== iPrecio) {
      h = r; cols = { iCod, iZona, iPrecio, iCli: cells.findIndex(esCli) };
      break;
    }
  }

  // Formato POR CLIENTE: nombre arriba (título) + columnas ZONA y PRECIO.
  let unico = null;
  if (h < 0) {
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const cells = (rows[r] || []).map(norm);
      const iZona = cells.findIndex(esZona);
      const iPrecio = cells.findIndex(esPrecio);
      const iCod = cells.findIndex(esCod);
      if (iZona >= 0 && iPrecio >= 0 && iZona !== iPrecio && iCod < 0) {
        let nombre = '';
        for (let k = r - 1; k >= 0 && !nombre; k--) {
          for (const celda of (rows[k] || [])) {
            const txt = String(celda || '').trim();
            if (txt) { nombre = txt; break; }
          }
        }
        // Sin título, el nombre del archivo suele ser el del cliente
        // ("MUNDO CIMA.xlsx"), que es mejor que la hoja ("Tarifario").
        if (!nombre) nombre = String(nombreArchivo || '').replace(/\.(xlsx?|csv)$/i, '').trim();
        if (!nombre) nombre = String(wb.SheetNames[0] || '').trim();
        unico = { h: r, iZona, iPrecio, nombre: nombre.toUpperCase() };
        break;
      }
    }
  }
  if (h < 0 && !unico) throw new Error('No se encontró la fila de encabezados (hacen falta ZONA y PRECIO en columnas distintas)');

  const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
  const zonasOk = new Set(((typeof zonasDelTarifario === 'function') ? zonasDelTarifario() : []).map(z => normNombre(z)));
  const desconocidas = new Set();
  const porCod = {};

  if (unico) {
    const zonas = {};
    for (let i = unico.h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const zona = zonaCanonica(r[unico.iZona]);
      const precio = parseNum(r[unico.iPrecio]);
      if (!zona) { if (r.some(c => String(c).trim())) res.ignoradas++; continue; }
      if (precio <= 0) continue;
      if (zonasOk.size && !zonasOk.has(normNombre(zona))) desconocidas.add(zona);
      if (zonas[zona] !== undefined) res.repetidas++;   // la última gana
      zonas[zona] = precio;
    }
    if (!Object.keys(zonas).length) throw new Error('No hay ninguna zona con precio');

    // Código: maestro → envíos → provisional.
    const clave = normCliente(unico.nombre);
    let cod = '', origen = '';
    const enMaestro = (AppData.clientes || []).find(c => normCliente(c.nombre) === clave && clienteKey(c.codigo));
    if (enMaestro) { cod = clienteKey(enMaestro.codigo); origen = 'del maestro'; }
    if (!cod) {
      const enEnvios = (typeof clientesDeRegistros === 'function' ? clientesDeRegistros() : [])
        .find(c => normCliente(c.nombre) === clave);
      if (enEnvios) { cod = clienteKey(enEnvios.cod); origen = 'de los envíos'; }
    }
    if (!cod) {
      const usados = new Set((AppData.clientes || []).map(c => clienteKey(c.codigo)).filter(Boolean));
      cod = _codigoProvisional(unico.nombre, usados);
      origen = 'provisional';
    }
    porCod[cod] = { nombre: unico.nombre, zonas, origen };
  } else {
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const cod = String(r[cols.iCod] || '').trim().toUpperCase();
      const nombre = cols.iCli >= 0 ? String(r[cols.iCli] || '').trim().toUpperCase() : '';
      const zona = zonaCanonica(r[cols.iZona]);
      const precio = parseNum(r[cols.iPrecio]);
      if (!cod || !zona) { if (r.some(c => String(c).trim())) res.ignoradas++; continue; }
      if (precio <= 0) continue;   // sin precio no se carga (así se puede dejar en 0 lo no acordado)
      if (zonasOk.size && !zonasOk.has(normNombre(zona))) desconocidas.add(zona);
      if (!porCod[cod]) porCod[cod] = { nombre: nombre || cod, zonas: {}, origen: 'del archivo' };
      if (nombre) porCod[cod].nombre = nombre;
      if (porCod[cod].zonas[zona] !== undefined) res.repetidas++;
      porCod[cod].zonas[zona] = precio;
    }
    if (!Object.keys(porCod).length) throw new Error('No se encontró ninguna tarifa válida (Cod.Cliente, Zona y Precio > 0)');
  }
  res.zonasDesconocidas = Array.from(desconocidas);

  for (const cod of Object.keys(porCod)) {
    const info = porCod[cod];
    let cli = (AppData.clientes || []).find(c => clienteKey(c.codigo) === cod);
    let nuevo = false;
    if (!cli) {
      // Si ya existe por nombre pero sin código, se le completa el código.
      cli = (AppData.clientes || []).find(c => !clienteKey(c.codigo) && normCliente(c.nombre) === normCliente(info.nombre));
      if (cli) {
        try { await DB.updateWhere('clientes', 'id', cli.id, { codigo: cod }); cli.codigo = cod; }
        catch (err) { console.warn('completar codigo', cod, err); }
      }
    }
    if (!cli) {
      const obs = info.origen === 'provisional'
        ? 'Código provisional puesto al importar el tarifario: verificar contra la columna Cod.Cliente del listado de envíos.'
        : '';
      const nuevoCli = { nombre: info.nombre, codigo: cod, razon_social: '', cuit: '', activo: true, obs };
      try {
        const row = await DB.insertRow('clientes', nuevoCli);
        cli = Object.assign({ id: row.id, contacto: '', telefono: '', email: '' }, nuevoCli);
        AppData.clientes.push(cli);
        nuevo = true;
      } catch (err) { console.warn('crear cliente import', cod, err); continue; }
    }
    const filas = Object.entries(info.zonas).map(([zona, precio]) => ({ cliente: cli.nombre, cliente_cod: cod, zona, precio }));
    try {
      await DB.deleteWhere('cliente_tarifas', 'cliente_cod', cod);   // reemplaza el tarifario de ESE cliente
      const inserted = await guardarClienteTarifas(filas);
      AppData.clienteTarifas = (AppData.clienteTarifas || []).filter(t => clienteKey(t.cliente_cod) !== cod).concat(inserted);
    } catch (err) { console.warn('tarifas import', cod, err); }
    res.clientes.push({ nombre: cli.nombre, cod, origen: info.origen, zonas: filas.length, nuevo });
  }
  return res;
}

// Zonas del tarifario del cliente que no existen del lado del costo. Casi
// siempre son la misma zona escrita distinta o partida en sub-zonas ("LA PLATA
// NORTE" cuando el envío siempre dice "LA PLATA"). Se ofrecen para vincular ahí
// mismo: si quedan sueltas, esas tarifas no se aplican a ningún envío y el
// cliente se factura en $0 sin que nadie lo note.
function _bloqueVincularZonas(desconocidas) {
  const zonas = (typeof zonasDelTarifario === 'function') ? zonasDelTarifario() : [];
  if (!zonas.length) {
    return '<div style="font-size:11px;color:#9a3412;margin-top:10px"><strong>' + desconocidas.length +
      ' zona(s) no están en el tarifario de costos</strong> (' + desconocidas.join(', ') + ').</div>';
  }
  const opciones = zonas.slice().sort().map(z => '<option value="' + z + '">' + z + '</option>').join('');
  const filas = desconocidas.map(z =>
    '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">' +
      '<span style="flex:1;font-weight:600">' + z + '</span>' +
      '<span style="color:var(--text-muted)">→</span>' +
      '<select class="zona-vincular" data-zona="' + String(z).replace(/"/g, '&quot;') + '" style="width:220px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px">' +
        '<option value="">— dejar como está —</option>' + opciones +
      '</select>' +
    '</div>').join('');
  return '<div style="margin-top:12px;padding:10px 12px;border:1px solid #fdba74;background:#fff7ed;border-radius:8px">' +
    '<div style="font-size:12px;color:#9a3412;margin-bottom:6px"><strong>' + desconocidas.length +
    ' zona(s) no están en el tarifario de costos.</strong> Mientras no coincidan con la zona que traen los envíos, ' +
    'esas tarifas no se aplican y esos envíos se facturan en $0. Vinculalas con la zona que corresponda:</div>' +
    filas +
    '<div style="text-align:right;margin-top:8px">' +
      '<button class="btn btn-sm btn-primary" onclick="vincularZonasDesconocidas()">Vincular zonas</button>' +
    '</div></div>';
}

// Guarda los alias elegidos y corrige las tarifas YA cargadas con esa grafía.
async function vincularZonasDesconocidas() {
  const pares = Array.from(document.querySelectorAll('.zona-vincular'))
    .map(s => ({ alias: s.dataset.zona, zona: s.value }))
    .filter(p => p.zona && normNombre(p.zona) !== normNombre(p.alias));
  if (!pares.length) { showToast('Elegí con qué zona vincular al menos una'); return; }

  let renombradas = 0, quitadas = 0; const conflictos = [];
  for (const { alias, zona } of pares) {
    try { await DB.insertRow('zona_alias', { alias, zona }); }
    catch (e) { console.warn('zona_alias', alias, e); }
    AppData.zonaAlias = (AppData.zonaAlias || [])
      .filter(x => normNombre(x.alias) !== normNombre(alias)).concat([{ alias, zona }]);

    // Las tarifas que ya se guardaron con la grafía vieja pasan a la canónica.
    const afectadas = (AppData.clienteTarifas || []).filter(t => normNombre(t.zona) === normNombre(alias));
    for (const t of afectadas) {
      const gemela = (AppData.clienteTarifas || []).find(x =>
        x.id !== t.id && clienteKey(x.cliente_cod) === clienteKey(t.cliente_cod) && normNombre(x.zona) === normNombre(zona));
      if (gemela && _num(gemela.precio) !== _num(t.precio)) {
        // Dos precios para la misma zona: no se elige por el operador.
        conflictos.push(clienteNombreDe(t.cliente_cod) + ': ' + zona + ' ' + fmtPeso(gemela.precio) + ' vs ' + fmtPeso(t.precio));
        continue;
      }
      if (gemela) {
        try { await DB.deleteWhere('cliente_tarifas', 'id', t.id); AppData.clienteTarifas = AppData.clienteTarifas.filter(x => x.id !== t.id); quitadas++; }
        catch (e) { console.warn('quitar tarifa duplicada', e); }
      } else {
        try { await DB.updateWhere('cliente_tarifas', 'id', t.id, { zona }); t.zona = zona; renombradas++; }
        catch (e) { console.warn('renombrar tarifa', e); }
      }
    }
  }
  persistirClientesLocal();
  renderClientes();
  document.getElementById('modal-backdrop').classList.remove('open');
  showToast('✅ ' + pares.length + ' zona(s) vinculadas' +
    (renombradas ? ' · ' + renombradas + ' tarifas actualizadas' : '') +
    (quitadas ? ' · ' + quitadas + ' duplicadas quitadas' : ''));
  if (conflictos.length) {
    alert('Estas tarifas quedaron sin tocar porque el cliente ya tenía esa zona con OTRO precio.\n' +
      'Revisá cuál corresponde y borrá la que sobra:\n\n' + conflictos.join('\n'));
  }
}

// Resumen de toda la tanda. Va en el modal y no en un alert porque con varios
// archivos hay que poder leerlo y saber cuáles quedaron para revisar.
function _resumenImportTarifarios(resultados) {
  const ok = resultados.filter(r => !r.error);
  const conError = resultados.filter(r => r.error);
  const clientes = ok.reduce((a, r) => a.concat(r.clientes), []);
  const provisionales = clientes.filter(c => c.origen === 'provisional');
  const zonasTotal = clientes.reduce((s, c) => s + c.zonas, 0);
  const nuevos = clientes.filter(c => c.nuevo).length;
  const repetidas = ok.reduce((s, r) => s + r.repetidas, 0);
  const desconocidas = Array.from(new Set(ok.reduce((a, r) => a.concat(r.zonasDesconocidas), [])));

  const badge = o => o === 'provisional'
    ? '<span class="badge" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74">provisional</span>'
    : '<span class="badge badge-gray">' + o + '</span>';

  const filas = clientes.map(c =>
    '<tr>' +
      '<td><strong>' + c.nombre + '</strong>' + (c.nuevo ? ' <span class="badge badge-green">nuevo</span>' : '') + '</td>' +
      '<td class="mono">' + c.cod + '</td>' +
      '<td>' + badge(c.origen) + '</td>' +
      '<td class="mono" style="text-align:right">' + c.zonas + '</td>' +
    '</tr>').join('');

  document.getElementById('modal-title').textContent = 'Tarifarios importados';
  document.getElementById('modal-body').innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:13px">' +
      '<div>Archivos: <strong>' + resultados.length + '</strong></div>' +
      '<div>Clientes: <strong>' + clientes.length + '</strong>' + (nuevos ? ' (' + nuevos + ' nuevos)' : '') + '</div>' +
      '<div>Tarifas: <strong>' + zonasTotal + '</strong></div>' +
    '</div>' +
    (provisionales.length
      ? '<div class="alert" style="margin-bottom:10px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74"><i class="ic ic-alert"></i><div><strong>' +
        provisionales.length + ' cliente(s) quedaron con código provisional.</strong> No se encontró su código en los envíos, ' +
        'así que se les puso uno derivado del nombre. <strong>Hay que corregirlo</strong> con el Cod.Cliente real: ' +
        'con un código que no matchea ningún envío, ese cliente se factura en $0. Editalos desde su tarjeta.</div></div>'
      : '') +
    (filas ? '<div class="table-wrap" style="max-height:44vh;overflow:auto"><table><thead><tr>' +
      '<th>Cliente</th><th>Código</th><th>De dónde</th><th style="text-align:right">Zonas</th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table></div>' : '') +
    (repetidas ? '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">' + repetidas +
      ' fila(s) con la zona repetida: quedó el último precio.</div>' : '') +
    (desconocidas.length ? _bloqueVincularZonas(desconocidas) : '') +
    (conError.length ? '<div style="font-size:11px;color:#b91c1c;margin-top:8px"><strong>No se pudieron leer:</strong><br>' +
      conError.map(r => '· ' + r.archivo + ' — ' + r.error).join('<br>') + '</div>' : '');
  document.getElementById('modal-backdrop').classList.add('open');

  showToast('✅ ' + clientes.length + ' tarifario(s) · ' + zonasTotal + ' tarifas' +
    (provisionales.length ? ' · ⚠️ ' + provisionales.length + ' con código provisional' : ''));
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
