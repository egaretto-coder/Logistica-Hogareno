function loadSavedConfig() {
  const t = localStorage.getItem('liq_tarifas');
  if (t) AppData.tarifas = JSON.parse(t);
  const s = localStorage.getItem('liq_supersla');
  if (s) AppData.superSLA = JSON.parse(s);
  const dim = localStorage.getItem('liq_dimensiones_especiales');
  if (dim) {
    try { AppData.dimensionesEspeciales = JSON.parse(dim); } catch(e) {}
  }
  const desc = localStorage.getItem('liq_descuentos_conductores');
  if (desc) {
    try { AppData.descuentosConductores = JSON.parse(desc); } catch(e) {}
  }
  const kmd = localStorage.getItem('liq_km_desvio');
  if (kmd) {
    try { AppData.kmDesvio = JSON.parse(kmd); } catch(e) {}
  }
  const kmt = localStorage.getItem('liq_km_tarifas');
  if (kmt) {
    try { AppData.kmTarifas = JSON.parse(kmt); } catch(e) {}
  }
  const cfg = localStorage.getItem('liq_config');
  if (cfg) {
    try { AppData.config = JSON.parse(cfg) || {}; } catch(e) {}
  }
  const p = localStorage.getItem('liq_panel_conductores');
  if (p) {
    const saved = JSON.parse(p);
    // Si los conductores guardados no tienen IDs, fusionar con los del HTML base
    // para recuperar los IDs recién asignados
    const sinId = saved.filter(c => !c.id || c.id === '').length;
    if (sinId > 0) {
      // Fusionar: tomar los datos guardados (condicion, etc.) pero recuperar IDs del base
      AppData.panelConductores = AppData.panelConductores.map(base => {
        const guardado = saved.find(s => s.nombre === base.nombre);
        if (guardado) {
          return {
            id: base.id || guardado.id || '',
            nombre: base.nombre,
            condicion: guardado.condicion || base.condicion || '',
            categoria: guardado.categoria || base.categoria || ''
          };
        }
        return base;
      });
      // Guardar la versión fusionada con IDs
      localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
    } else {
      AppData.panelConductores = saved;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN CON SUPABASE
// ════════════════════════════════════════════════════════════════════════

const _num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// Trae todos los datos desde Supabase y reemplaza AppData + caché local.
// Si no hay conexión, deja el caché local que ya cargó loadSavedConfig().
async function hydrateFromSupabase() {
  if (!window.DB || !DB.ready) return;
  const data = await DB.loadAll();
  if (!data) return; // offline: se conserva el caché local

  // Tablas base: si Supabase está vacío (primer arranque), conservamos los
  // valores por defecto del código y los sembramos en la nube al final.
  const faltaSeed = [];

  if ((data.tarifas || []).length) {
    AppData.tarifas = data.tarifas.map(t => ({
      zona: t.zona, categoria: t.categoria || '',
      s_colecta: _num(t.s_colecta), c_colecta: _num(t.c_colecta), sla: _num(t.sla)
    }));
  } else { faltaSeed.push('tarifas'); }

  if ((data.super_sla || []).length) {
    AppData.superSLA = data.super_sla.map(r => ({
      conductor: r.conductor, zona: r.zona, precio: _num(r.precio)
    }));
  } else { faltaSeed.push('super_sla'); }

  if ((data.panel_conductores || []).length) {
    AppData.panelConductores = data.panel_conductores.map(c => ({
      id: c.id, nombre: c.nombre, condicion: c.condicion || '', categoria: c.categoria || 'super_sla'
    }));
  } else { faltaSeed.push('panel_conductores'); }

  AppData.dimensionesEspeciales = (data.dimensiones_especiales || []).map(d => ({
    fecha: d.fecha || '', tracking: d.tracking || '', cliente: d.cliente || '',
    zona: d.zona || '', valor: _num(d.valor), condicion: d.condicion || ''
  }));
  AppData.descuentosConductores = (data.descuentos_conductores || []).map(d => ({
    conductor: d.conductor, combustible: _num(d.combustible),
    extraviados: _num(d.extraviados), adelantos: _num(d.adelantos),
    proveedores: _num(d.proveedores), obs: d.obs || ''
  }));
  AppData.kmDesvio = (data.km_desvio || []).map(d => ({
    conductor: d.conductor, km: _num(d.km), fecha: d.fecha || '',
    valor_km: _num(d.valor_km), monto: _num(d.monto), obs: d.obs || ''
  }));
  // Historial de tarifas de km (ascendente por vigencia)
  AppData.kmTarifas = (data.km_tarifas || [])
    .map(t => ({ valor: _num(t.valor), vigente_desde: t.vigente_desde, creado_por: t.creado_por || '' }))
    .sort((a, b) => new Date(a.vigente_desde) - new Date(b.vigente_desde));
  AppData.records = (data.registros || []).map(r => ({
    cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
    zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
    estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || ''
  }));

  // Configuración clave/valor (genérica)
  AppData.config = {};
  (data.config || []).forEach(row => { AppData.config[row.clave] = row.valor; });

  // Refrescar caché local para uso offline
  try {
    localStorage.setItem('liq_tarifas', JSON.stringify(AppData.tarifas));
    localStorage.setItem('liq_supersla', JSON.stringify(AppData.superSLA));
    localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
    localStorage.setItem('liq_dimensiones_especiales', JSON.stringify(AppData.dimensionesEspeciales));
    localStorage.setItem('liq_descuentos_conductores', JSON.stringify(AppData.descuentosConductores));
    localStorage.setItem('liq_km_desvio', JSON.stringify(AppData.kmDesvio));
    localStorage.setItem('liq_km_tarifas', JSON.stringify(AppData.kmTarifas));
    localStorage.setItem('liq_config', JSON.stringify(AppData.config));
  } catch(e) {}

  // Primer arranque: sembrar en Supabase las tablas base que estaban vacías.
  if (faltaSeed.length) {
    for (const t of faltaSeed) {
      try { await dbPush(t); } catch(e) { console.warn('Seed ' + t + ' falló:', e); }
    }
    console.info('[Supabase] Tablas base sembradas desde defaults:', faltaSeed.join(', '));
  }
}

// Empuja una tabla de configuración a Supabase (reemplazo total).
// Se llama desde cada función save*(); si no hay conexión, no rompe nada
// (el caché local ya quedó guardado).
function dbPush(table) {
  if (!window.DB || !DB.ready) return Promise.resolve();
  const builders = {
    tarifas: () => AppData.tarifas.map(t => ({
      zona: t.zona, categoria: t.categoria || '',
      s_colecta: _num(t.s_colecta), c_colecta: _num(t.c_colecta), sla: _num(t.sla)
    })),
    super_sla: () => AppData.superSLA.map(r => ({
      conductor: r.conductor, zona: r.zona, precio: _num(r.precio != null ? r.precio : r.sla)
    })).filter(r => r.conductor && r.zona),
    panel_conductores: () => AppData.panelConductores.map(c => ({
      id: c.id, nombre: c.nombre, condicion: c.condicion || '', categoria: c.categoria || 'super_sla'
    })).filter(c => c.id),
    dimensiones_especiales: () => AppData.dimensionesEspeciales.map(d => ({
      fecha: d.fecha || '', tracking: d.tracking || '', cliente: d.cliente || '',
      zona: d.zona || '', valor: _num(d.valor), condicion: d.condicion || ''
    })),
    descuentos_conductores: () => AppData.descuentosConductores.map(d => ({
      conductor: d.conductor, combustible: _num(d.combustible),
      extraviados: _num(d.extraviados), adelantos: _num(d.adelantos),
      proveedores: _num(d.proveedores), obs: d.obs || ''
    })).filter(d => d.conductor),
    km_desvio: () => AppData.kmDesvio.map(d => ({
      conductor: d.conductor, km: _num(d.km), fecha: d.fecha || '',
      valor_km: _num(d.valor_km), monto: _num(d.monto), obs: d.obs || ''
    })).filter(d => d.conductor),
  };
  const rows = builders[table] ? builders[table]() : [];
  return DB.replaceAll(table, rows).catch(e => {
    console.warn('Sincronización de "' + table + '" falló:', e);
    showToast('⚠️ Guardado local OK, pero falló la sincronización con la nube');
  });
}

// Registra una NUEVA tarifa de km en el historial (append), con vigencia desde
// ahora. No pisa las tarifas anteriores, así los montos ya calculados quedan
// intactos. La RLS de Supabase exige rol analista para insertar.
async function agregarTarifaKm(valor) {
  const nueva = {
    valor: _num(valor),
    vigente_desde: new Date().toISOString(),
    creado_por: (currentUser && currentUser.usuario) || ''
  };
  // Optimista en memoria + caché local
  AppData.kmTarifas.push(nueva);
  AppData.kmTarifas.sort((a, b) => new Date(a.vigente_desde) - new Date(b.vigente_desde));
  try { localStorage.setItem('liq_km_tarifas', JSON.stringify(AppData.kmTarifas)); } catch(e) {}

  if (window.DB && DB.ready) {
    try {
      await DB.insertRow('km_tarifas', {
        valor: nueva.valor, vigente_desde: nueva.vigente_desde, creado_por: nueva.creado_por
      });
    } catch (e) {
      console.warn('No se pudo sincronizar la tarifa de km:', e);
      throw e; // el llamador revierte / avisa (ej. sin permiso analista)
    }
  }
}

// Guarda los registros importados (entregas) en Supabase.
async function guardarRegistrosEnNube() {
  if (!window.DB || !DB.ready) { showToast('Sin conexión: registros guardados solo localmente'); return; }
  const rows = AppData.records.map(r => ({
    cadete: r.cadete || '', tracking: r.tracking || '', fecha: r.fecha || '',
    localidad: r.localidad || '', zona: r.zona || '', zona_precio: r.zona_precio || '',
    estado: r.estado || '', precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || ''
  }));
  try {
    showToast('Guardando ' + rows.length + ' registros en la nube…');
    await DB.replaceAll('registros', rows);
    showToast('✅ ' + rows.length + ' registros guardados en la nube');
  } catch(e) {
    console.warn('guardarRegistrosEnNube:', e);
    showToast('⚠️ No se pudieron guardar los registros en la nube: ' + (e.message || e));
  }
}

// Carga el set inicial de registros desde el archivo del repo (data/registros_seed.json)
// para probar la app o sembrar la nube por primera vez.
async function cargarSeedRegistros() {
  try {
    showToast('Cargando registros de ejemplo…');
    const res = await fetch('data/registros_seed.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.json();
    AppData.records = arr.map(r => ({
      cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
      zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
      estado: r.estado, precio_bd: _num(r.precio_bd)
    }));
    // Mostrar la vista previa reutilizando el bloque de importación
    document.getElementById('column-mapper').style.display = 'none';
    document.getElementById('upload-preview').style.display = 'block';
    const entregados = AppData.records.filter(r => esEstadoEntregado(r.estado)).length;
    document.getElementById('preview-title').textContent =
      'Vista previa · ' + AppData.records.length + ' registros de ejemplo';
    document.getElementById('upload-success-msg').innerHTML =
      '✅ ' + AppData.records.length + ' registros cargados (<strong>' + entregados +
      ' entregados</strong>). Revisá y presioná “☁️ Guardar en la nube” para persistirlos.';
    const wrap = document.getElementById('preview-table-wrap');
    if (wrap) wrap.innerHTML = '';
    renderDashboard();
    showToast('Registros de ejemplo cargados: ' + AppData.records.length);
  } catch (e) {
    console.warn('cargarSeedRegistros:', e);
    showToast('⚠️ No se pudo cargar el seed (¿estás abriendo la app por http/https?)');
  }
}

// ===== DATOS REALES (importados del XLS) =====
