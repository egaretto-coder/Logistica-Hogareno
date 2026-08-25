// ════════════════════════════════════════════════════════════════════════
//  DIMENSIONES ESPECIALES — CATÁLOGO (base de datos por cliente)
//  El panel es SOLO un catálogo: cada dimensión de un cliente tiene un precio
//  por zona. La asignación a un envío se hace a mano desde el panel Conductores
//  (botón "Dimensión"), y el precio aplicado sale de la zona de entrega.
// ════════════════════════════════════════════════════════════════════════
let dimEditIdx = -1;

// DOS tarifarios para la misma dimensión: lo que se le PAGA al conductor por
// llevarla y lo que se le COBRA al cliente por ese envío. No tienen por qué
// coincidir, y con una sola lista o el conductor cobraba de más o al cliente se
// le facturaba de menos. La solapa activa decide sobre cuál se trabaja.
let dimTipo = 'conductor';
function dimEsTipo(d) { return ((d && d.tipo) || 'conductor') === dimTipo; }

function switchDimTab(tipo) {
  dimTipo = (tipo === 'cliente') ? 'cliente' : 'conductor';
  ['conductor', 'cliente'].forEach(t => {
    const b = document.getElementById('dim-btn-' + t);
    if (b) b.classList.toggle('active', t === dimTipo);
  });
  const s = document.getElementById('dim-search'); if (s) s.value = '';
  renderDimensionesEspeciales();
}

function saveDimCatalogo() {
  try { localStorage.setItem('liq_dim_catalogo', JSON.stringify(AppData.dimCatalogo)); } catch (e) {}
  dbPush('dimensiones_catalogo');
}

function renderDimensionesEspeciales() {
  const search = (document.getElementById('dim-search')?.value || '').toLowerCase().trim();
  const cat = (AppData.dimCatalogo || []).filter(dimEsTipo);

  // Contador de cada solapa y ayuda según la que esté activa.
  ['conductor', 'cliente'].forEach(t => {
    const el = document.getElementById('dim-count-' + t);
    if (el) {
      const n = (AppData.dimCatalogo || []).filter(d => ((d.tipo || 'conductor') === t)).length;
      el.textContent = n ? '(' + n + ')' : '';
    }
  });
  const ayuda = document.getElementById('dim-ayuda');
  if (ayuda) ayuda.innerHTML = '<i class="ic ic-box"></i><div>' + (dimTipo === 'cliente'
    ? 'Lo que se le <strong>COBRA AL CLIENTE</strong> por un envío con esa condición especial. Reemplaza la tarifa de venta de su zona: ' +
      'cuando el administrativo asigna la dimensión a un envío desde <strong>Conductores</strong>, la liquidación de ese cliente pasa a facturar este precio, ' +
      'discriminado en su propia línea. Si una zona no tiene precio acá, ese envío se factura con la tarifa común de la zona.'
    : 'Lo que se le <strong>PAGA AL CONDUCTOR</strong> por llevar esa condición especial. Reemplaza la tarifa de su zona cuando se le asigna la dimensión al envío ' +
      'desde <strong>Conductores</strong> (botón <strong>Dimensión</strong>).<br>' +
      '<strong>Importar:</strong> subí directamente la <strong>planilla de la empresa</strong> ("PLANILLA DE CARGA PARA CONDUCTORES"). ' +
      'Se leen <em>Cliente · Zona · Condición especial · Precio</em>; la columna <em>Detalle</em> y los títulos se ignoran.') +
    '</div>';
  // Nos guardamos el índice real acá: buscarlo con indexOf() dentro del map era
  // O(n²) y con un catálogo completo (~2.700 precios) trababa el panel entero.
  // OJO: el índice tiene que ser el de AppData.dimCatalogo (editar/borrar
  // trabajan sobre él), no el de la lista filtrada por solapa.
  const list = [];
  (AppData.dimCatalogo || []).forEach((d, i) => {
    if (!dimEsTipo(d)) return;
    if (!search ||
      String(d.cliente || '').toLowerCase().includes(search) ||
      String(d.nombre || '').toLowerCase().includes(search) ||
      String(d.zona || '').toLowerCase().includes(search)) list.push({ d, i });
  });

  const countEl = document.getElementById('dim-count');
  if (countEl) {
    const nClientes = new Set(cat.map(d => normNombre(d.cliente))).size;
    const nDims = new Set(cat.map(d => normNombre(d.cliente) + '|' + normNombre(d.nombre))).size;
    countEl.textContent = cat.length + ' precio(s) · ' + nDims + ' dimensión(es) · ' + nClientes + ' cliente(s)';
  }

  const body = document.getElementById('dim-table-body');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon"><i class="ic ic-box"></i></div><div class="empty-title">Sin dimensiones en el catálogo</div><div class="empty-sub">' +
      (cat.length ? 'Ajustá el buscador' : 'Agregá una con "+ Nueva dimensión" o importá el Excel (Cliente · Dimensión · Zona · Precio)') +
      '</div></div></td></tr>';
    return;
  }

  // Orden: cliente, dimensión, zona.
  const ordenada = list.slice().sort((x, y) =>
    String(x.d.cliente).localeCompare(String(y.d.cliente)) ||
    String(x.d.nombre).localeCompare(String(y.d.nombre)) ||
    String(x.d.zona).localeCompare(String(y.d.zona)));

  // El catálogo completo son miles de precios: pintarlos todos no sirve para
  // leerlos y hace lento cada render. Se muestran los primeros y el resto se
  // encuentra con el buscador.
  const TOPE = 500;
  const recortada = ordenada.slice(0, TOPE);
  const avisoEl = document.getElementById('dim-recorte');
  if (avisoEl) avisoEl.textContent = ordenada.length > TOPE
    ? 'Mostrando ' + TOPE + ' de ' + ordenada.length + ' — usá el buscador para encontrar una dimensión puntual'
    : '';

  body.innerHTML = recortada.map(({ d, i: realIdx }) => {
    return '<tr>' +
      '<td><strong>' + (d.cliente || '—') + '</strong></td>' +
      '<td><span class="tag" style="background:#fef3c7;color:#92400e"><i class="ic ic-box"></i> ' + (d.nombre || '—') + '</span></td>' +
      '<td>' + (d.zona || '—') + '</td>' +
      '<td class="mono" style="text-align:right"><strong>' + fmtPeso(_num(d.precio)) + '</strong></td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="editDimension(' + realIdx + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="eliminarDimension(' + realIdx + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// Datalists del modal: clientes (catálogo + recorridos), dimensiones y zonas (tarifario).
function _dimDatalists() {
  const cli = document.getElementById('md-clientes-list');
  if (cli) {
    const set = new Map();
    AppData.dimCatalogo.forEach(d => { const k = normNombre(d.cliente); if (k && !set.has(k)) set.set(k, d.cliente); });
    AppData.records.forEach(r => { const k = normNombre(r.cliente); if (k && !set.has(k)) set.set(k, r.cliente); });
    cli.innerHTML = Array.from(set.values()).sort().map(c => '<option value="' + String(c).replace(/"/g, '&quot;') + '">').join('');
  }
  const nom = document.getElementById('md-nombres-list');
  if (nom) {
    const set = new Set(AppData.dimCatalogo.map(d => d.nombre).filter(Boolean));
    nom.innerHTML = Array.from(set).sort().map(n => '<option value="' + String(n).replace(/"/g, '&quot;') + '">').join('');
  }
  const zon = document.getElementById('md-zonas-list');
  if (zon) {
    const set = new Set(AppData.tarifas.map(t => String(t.zona || '').toUpperCase().trim()).filter(Boolean));
    zon.innerHTML = Array.from(set).sort().map(z => '<option value="' + z.replace(/"/g, '&quot;') + '">').join('');
  }
}

// Zonas del tarifario (mismo criterio que Super SLA).
function _dimZonasTarifario() {
  if (typeof zonasDelTarifario === 'function') return zonasDelTarifario();
  return Array.from(new Set(
    (AppData.tarifas || []).map(t => String(t.zona || '').trim().toUpperCase()).filter(Boolean)
  )).sort();
}

// "Mismo precio en todas las zonas": el campo Zona deja de aplicar.
function toggleDimTodasZonas() {
  const chk = document.getElementById('md-todas-zonas');
  const todas = !!(chk && chk.checked);
  const zonaWrap = document.getElementById('md-zona-wrap');
  const zonaInput = document.getElementById('md-zona');
  const label = document.getElementById('md-precio-label');
  if (zonaWrap) zonaWrap.style.display = todas ? 'none' : '';
  if (zonaInput) zonaInput.disabled = todas;
  if (label) label.innerHTML = todas
    ? '<i class="ic ic-dollar"></i> Precio para TODAS las zonas ($) *'
    : '<i class="ic ic-dollar"></i> Precio en esa zona ($) *';
  const hint = document.getElementById('md-todas-hint');
  if (hint) hint.textContent = todas
    ? '— se carga una fila por cada una de las ' + _dimZonasTarifario().length + ' zonas del tarifario'
    : '— si el cliente cerró un valor fijo (' + _dimZonasTarifario().length + ' zonas)';
}

function openAddDimensionModal() {
  dimEditIdx = -1;
  document.getElementById('modal-dim-title').textContent = 'Nueva dimensión (catálogo)';
  document.getElementById('md-cliente').value = '';
  document.getElementById('md-nombre').value = '';
  document.getElementById('md-zona').value = '';
  document.getElementById('md-precio').value = '';
  const chk = document.getElementById('md-todas-zonas');
  if (chk) chk.checked = false;
  const wrap = document.getElementById('md-todas-wrap');
  if (wrap) wrap.style.display = '';      // solo tiene sentido al dar de alta
  toggleDimTodasZonas();
  _dimDatalists();
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function editDimension(idx) {
  const d = AppData.dimCatalogo[idx];
  if (!d) return;
  dimEditIdx = idx;
  document.getElementById('modal-dim-title').textContent = 'Editar dimensión (catálogo)';
  document.getElementById('md-cliente').value = d.cliente || '';
  document.getElementById('md-nombre').value = d.nombre || '';
  document.getElementById('md-zona').value = d.zona || '';
  document.getElementById('md-precio').value = _num(d.precio) || '';
  const chkE = document.getElementById('md-todas-zonas');
  if (chkE) chkE.checked = false;
  const wrapE = document.getElementById('md-todas-wrap');
  if (wrapE) wrapE.style.display = 'none';   // editar es de UNA zona
  toggleDimTodasZonas();
  _dimDatalists();
  document.getElementById('modal-dim-backdrop').style.display = 'flex';
}

function closeDimModal(e) {
  if (!e || e.target.id === 'modal-dim-backdrop') document.getElementById('modal-dim-backdrop').style.display = 'none';
}

function guardarDimensionModal() {
  try {
    const cliente = document.getElementById('md-cliente').value.trim().toUpperCase();
    const nombre = document.getElementById('md-nombre').value.trim().toUpperCase();
    const zona = document.getElementById('md-zona').value.trim().toUpperCase();
    const precio = parseFloat(document.getElementById('md-precio').value);
    const todasZonas = !!(document.getElementById('md-todas-zonas') || {}).checked && dimEditIdx < 0;
    if (!cliente) { alert('Elegí el cliente.'); return; }
    if (!nombre) { alert('Ingresá el nombre de la dimensión.'); return; }
    if (!todasZonas && !zona) { alert('Elegí la zona.'); return; }
    if (isNaN(precio) || precio < 0) { alert('Ingresá un precio válido.'); return; }

    // Precio único cerrado con el cliente: una fila por cada zona del tarifario.
    if (todasZonas) {
      const zonas = _dimZonasTarifario();
      if (!zonas.length) { alert('El tarifario no tiene zonas cargadas: no se puede aplicar a todas.'); return; }
      const yaCargadas = zonas.filter(z => AppData.dimCatalogo.some(x =>
        dimEsTipo(x) &&
        normNombre(x.cliente) === normNombre(cliente) &&
        normNombre(x.nombre) === normNombre(nombre) &&
        normNombre(x.zona) === normNombre(z)));
      const nuevas = zonas.length - yaCargadas.length;
      const salto = String.fromCharCode(10);
      if (!confirm('"' + nombre + '" de ' + cliente + ' a ' + fmtPeso(precio) + ' en las ' + zonas.length + ' zonas del tarifario.' + salto + salto +
                   '· ' + nuevas + ' zona(s) nueva(s)' + salto +
                   '· ' + yaCargadas.length + ' con el precio actualizado' + salto + salto + '¿Confirmás?')) return;

      zonas.forEach(z => {
        const i = AppData.dimCatalogo.findIndex(x =>
          dimEsTipo(x) &&
          normNombre(x.cliente) === normNombre(cliente) &&
          normNombre(x.nombre) === normNombre(nombre) &&
          normNombre(x.zona) === normNombre(z));
        if (i >= 0) AppData.dimCatalogo[i].precio = precio;
        else AppData.dimCatalogo.push({ cliente, nombre, zona: z, precio, tipo: dimTipo });
      });

      saveDimCatalogo();
      dimEditIdx = -1;
      document.getElementById('modal-dim-backdrop').style.display = 'none';
      renderDimensionesEspeciales();
      showToast('✅ ' + nombre + ' cargada en ' + zonas.length + ' zonas a ' + fmtPeso(precio));
      return;
    }

    const entry = { cliente, nombre, zona, precio, tipo: dimTipo };
    const dupIdx = AppData.dimCatalogo.findIndex((x, i) => i !== dimEditIdx && dimEsTipo(x) &&
      normNombre(x.cliente) === normNombre(cliente) && normNombre(x.nombre) === normNombre(nombre) && normNombre(x.zona) === normNombre(zona));

    if (dimEditIdx >= 0) {
      if (dupIdx >= 0) { alert('Ya existe ese cliente + dimensión + zona.'); return; }
      AppData.dimCatalogo[dimEditIdx] = Object.assign({}, AppData.dimCatalogo[dimEditIdx], entry);
    } else if (dupIdx >= 0) {
      if (!confirm('Ya existe "' + nombre + '" de ' + cliente + ' en ' + zona + '. ¿Actualizar su precio?')) return;
      AppData.dimCatalogo[dupIdx].precio = precio;
    } else {
      AppData.dimCatalogo.push(entry);
    }

    saveDimCatalogo();
    dimEditIdx = -1;
    document.getElementById('modal-dim-backdrop').style.display = 'none';
    renderDimensionesEspeciales();
    showToast('✅ Dimensión guardada en el catálogo');
  } catch (err) { console.error(err); alert('Error al guardar: ' + err.message); }
}

function eliminarDimension(idx) {
  const d = AppData.dimCatalogo[idx];
  if (!d) return;
  if (!confirm('Eliminar del catálogo: ' + d.nombre + ' de ' + d.cliente + ' en ' + d.zona + '?')) return;
  AppData.dimCatalogo.splice(idx, 1);
  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('🗑 Dimensión eliminada del catálogo');
}

function limpiarDimensiones() {
  const propias = (AppData.dimCatalogo || []).filter(dimEsTipo);
  const etq = dimTipo === 'cliente' ? 'de CLIENTES' : 'de CONDUCTOR';
  if (!propias.length) { showToast('El catálogo ' + etq + ' ya está vacío'); return; }
  const salto = String.fromCharCode(10);
  if (!confirm('¿Vaciar el tarifario ' + etq + '? (' + propias.length + ' filas)' + salto + salto + 'El otro tarifario no se toca.')) return;
  AppData.dimCatalogo = (AppData.dimCatalogo || []).filter(d => !dimEsTipo(d));
  saveDimCatalogo();
  renderDimensionesEspeciales();
  showToast('🗑 Tarifario ' + etq + ' vaciado');
}

function descargarPlantillaDimensiones() {
  // La planilla NO es una plantilla vacía: baja con TODO el catálogo cargado.
  // El circuito real es descargar → agregar las condiciones nuevas → volver a
  // subir. Con una plantilla en blanco habría que recargar todo de cero.
  const cat = (AppData.dimCatalogo || []).filter(dimEsTipo).slice().sort((a, b) =>
    String(a.cliente).localeCompare(String(b.cliente)) ||
    String(a.nombre).localeCompare(String(b.nombre)) ||
    String(a.zona).localeCompare(String(b.zona)));

  const aoa = [
    ['⚠ NO MODIFIQUES LOS ENCABEZADOS DE LA FILA 2. Una fila por Cliente + Condición especial + Zona. El precio es lo que se le paga al conductor por ESA condición en ESA zona. Agregá abajo las filas nuevas y volvé a subir el archivo.'],
    ['CLIENTE', 'ZONA', 'CONDICION ESPECIAL', 'PRECIO A PAGAR AL CONDUCTOR', 'DETALLE'],
  ];
  if (cat.length) {
    cat.forEach(d => aoa.push([d.cliente || '', d.zona || '', d.nombre || '', _num(d.precio), d.detalle || '']));
  } else {
    // Catálogo vacío: dejamos ejemplos para que se vea el formato esperado.
    aoa.push(['ACONCAGUA', 'CABA', '3 Y 4 BULTOS', 5040, '3 Y 4 BULTOS X2']);
    aoa.push(['ACONCAGUA', 'MERLO', '3 Y 4 BULTOS', 5600, '3 Y 4 BULTOS X2']);
    aoa.push(['FERRETERIA MARTIN', 'ZARATE', 'CARRETILLA', 10000, 'LAS CARRETILLAS VALEN $10000']);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 30 }, { wch: 28 }, { wch: 32 }];
  ws['!rows'] = [{ hpx: 34 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HOJA DE CARGA');
  const hoy = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Dimensiones_Catalogo_' + hoy + '.xlsx');
  showToast(cat.length
    ? '📥 Catálogo descargado: ' + cat.length + ' precio(s) — agregá las filas nuevas y volvé a subirlo'
    : '📥 Plantilla descargada (el catálogo está vacío) — completala y subila');
}

function importDimensionesEspeciales(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo está vacío.'); return; }

      // Detección de la fila de encabezados. Acepta la planilla de la EMPRESA
      // ("HOJA DE CARGA": título en la fila 1, encabezados en la 3, columna A
      // vacía, "CONDICION ESPECIAL" + "PRECIO A PAGAR AL CONDUCTOR" + "DETALLE")
      // y también la plantilla simple que genera la app.
      const esCli    = c => c.includes('cliente') || c.includes('empresa');
      const esZona   = c => c.includes('zona') || c.includes('localidad');
      const esDim    = c => c.includes('dimension') || c.includes('dimensin') || c.includes('condicion') || c.includes('condicin') || c.includes('nombre');
      const esPrecio = c => c.includes('precio') || c.includes('valor') || c.includes('monto') || c.includes('tarifa');
      // Cada concepto tiene que caer en una columna DISTINTA. Sin esa condición,
      // la fila 1 de la plantilla (el aviso "…una fila por Cliente + Condición
      // especial + Zona…") matcheaba las tres palabras en una sola celda: se la
      // tomaba como encabezado, las 4 columnas apuntaban a la A y se importaba
      // el nombre del cliente en cliente, dimensión y zona, con precio 0.
      let h = -1, cols = null;
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const cells = (rows[r] || []).map(x => String(x).toLowerCase().replace(/[^a-z]/g, ''));
        const iC = cells.findIndex(esCli), iZ = cells.findIndex(esZona), iD = cells.findIndex(esDim);
        if (iC >= 0 && iZ >= 0 && iD >= 0 && iC !== iZ && iC !== iD && iZ !== iD) {
          h = r; cols = { iC, iZ, iD }; break;
        }
      }
      if (h < 0) {
        alert('No se encontró la fila de encabezados.\n\nSe esperan columnas de Cliente, Zona y Condición especial (o Dimensión).\nFunciona con la planilla de la empresa ("HOJA DE CARGA") o con la plantilla que descarga la app.');
        return;
      }
      const header = (rows[h] || []).map(x => String(x).toLowerCase().trim());
      const norm = x => String(x).toLowerCase().replace(/[^a-z]/g, '');
      const iCli    = cols.iC;
      const iNom    = cols.iD;
      const iZona   = cols.iZ;
      const iPrecio = header.findIndex(x => esPrecio(norm(x)));
      const iDet    = header.findIndex(x => norm(x).includes('detalle') || norm(x).includes('observacion') || norm(x).includes('nota'));
      if (iCli < 0 || iNom < 0 || iZona < 0 || iPrecio < 0) {
        alert('Faltan columnas. Se necesitan: Cliente, Zona, Condición especial (o Dimensión) y Precio.');
        return;
      }
      // Las demás columnas (p. ej. DETALLE) se ignoran: no afectan el cálculo.

      const parseNum = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
      const claveDe = (c, n, z) => normNombre(c) + '|' + normNombre(n) + '|' + normNombre(z);

      // Índice del catálogo actual (evita el escaneo por fila: con ~2.700 filas
      // el findIndex anidado hacía millones de comparaciones).
      const idxActual = new Map();
      AppData.dimCatalogo.forEach((d, i) => idxActual.set(claveDe(d.cliente, d.nombre, d.zona), i));

      const vistas = new Set();
      let nuevas = 0, actualizadas = 0, sinCambio = 0, ignoradas = 0;
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const cliente = String(r[iCli] || '').trim().toUpperCase();
        const nombre  = String(r[iNom] || '').trim().toUpperCase();
        const zona    = String(r[iZona] || '').trim().toUpperCase();
        const precio  = parseNum(r[iPrecio]);
        const detalle = iDet >= 0 ? String(r[iDet] || '').trim() : '';
        if (!cliente || !nombre || !zona) { if (r.some(c => String(c).trim())) ignoradas++; continue; }
        const k = claveDe(cliente, nombre, zona);
        vistas.add(k);
        const pos = idxActual.get(k);
        if (pos !== undefined) {
          if (_num(AppData.dimCatalogo[pos].precio) !== precio) { AppData.dimCatalogo[pos].precio = precio; actualizadas++; }
          else sinCambio++;
          if (detalle) AppData.dimCatalogo[pos].detalle = detalle;
        } else {
          idxActual.set(k, AppData.dimCatalogo.length);
          AppData.dimCatalogo.push({ cliente, nombre, zona, precio, detalle, tipo: dimTipo });
          nuevas++;
        }
      }
      if (!vistas.size) { alert('No se importó ninguna fila válida (se necesitan Cliente, Zona y Condición especial).'); return; }

      // La planilla de la empresa es la base de datos maestra: ofrecemos dejar el
      // catálogo idéntico al archivo, quitando lo que ya no figura en él.
      const sobrantes = AppData.dimCatalogo.filter(d => !vistas.has(claveDe(d.cliente, d.nombre, d.zona)));
      let eliminadas = 0;
      if (sobrantes.length) {
        const muestra = sobrantes.slice(0, 5).map(d => '· ' + d.cliente + ' — ' + d.nombre + ' (' + d.zona + ')').join('\n');
        if (confirm('El archivo trae ' + vistas.size + ' combinaciones.\n\nEn el catálogo hay ' + sobrantes.length + ' que NO figuran en el archivo:\n' + muestra + (sobrantes.length > 5 ? '\n…y ' + (sobrantes.length - 5) + ' más' : '') +
          '\n\n¿Eliminarlas para que el catálogo quede igual al archivo?\n(Aceptar = sincronizar · Cancelar = conservarlas)')) {
          AppData.dimCatalogo = AppData.dimCatalogo.filter(d => vistas.has(claveDe(d.cliente, d.nombre, d.zona)));
          eliminadas = sobrantes.length;
        }
      }

      saveDimCatalogo();
      renderDimensionesEspeciales();
      showToast('✅ Catálogo importado: ' + nuevas + ' nueva(s) · ' + actualizadas + ' con precio actualizado · ' + sinCambio + ' sin cambios' +
        (eliminadas ? ' · ' + eliminadas + ' eliminada(s)' : '') + (ignoradas ? ' · ' + ignoradas + ' fila(s) ignorada(s)' : ''));
    } catch (err) { console.error(err); alert('Error al importar: ' + err.message); }
    finally { event.target.value = ''; }
  };
  reader.readAsArrayBuffer(file);
}

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ═════════════════ MÓDULO DESCUENTO CONDUCTORES ══════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

