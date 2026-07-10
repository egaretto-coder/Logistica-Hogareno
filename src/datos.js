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
  const rp = localStorage.getItem('liq_rol_permisos');
  if (rp) {
    try { const v = JSON.parse(rp); if (v) AppData.rolPermisos = v; } catch(e) {}
  }
  const rl = localStorage.getItem('liq_roles');
  if (rl) {
    try { const v = JSON.parse(rl); if (v) AppData.roles = v; } catch(e) {}
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

// Ventana de registros que se carga al iniciar. Con ~2.000 registros diarios,
// traer todo el historial en cada arranque no escala: se cargan los últimos
// N días (las liquidaciones son semanales) y el resto a demanda con
// cargarHistorialCompleto().
const VENTANA_DIAS_REGISTROS = 90;

function ventanaDesdeISO() {
  const d = new Date();
  d.setDate(d.getDate() - VENTANA_DIAS_REGISTROS);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// DD/MM/YYYY → YYYY-MM-DD (o null si no es parseable), para fecha_date.
function fechaISOde(fechaStr) {
  const m = String(fechaStr || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

// Trae todos los datos desde Supabase y reemplaza AppData + caché local.
// Si no hay conexión, deja el caché local que ya cargó loadSavedConfig().
async function hydrateFromSupabase() {
  if (!window.DB || !DB.ready) return;
  AppData._hidratando = true;
  let data;
  try {
    data = await DB.loadAll(AppData.historialCompleto ? null : ventanaDesdeISO());
  } finally {
    AppData._hidratando = false;
  }
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
    id: r.id, // id de la fila en la nube: permite ediciones puntuales sin reescribir la base
    cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
    zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
    estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
    // null = sin corrección; número = precio corregido a mano por el operador
    precio_manual: (r.precio_manual === null || r.precio_manual === undefined) ? null : _num(r.precio_manual)
  }));

  // Configuración clave/valor (genérica)
  AppData.config = {};
  (data.config || []).forEach(row => { AppData.config[row.clave] = row.valor; });

  // Permisos por pantalla y rol (panel "Gestión de permisos").
  // { administrativo: { pagina: true/false, ... }, ... } — analista no se persiste (ve todo).
  if ((data.rol_permisos || []).length) {
    AppData.rolPermisos = {};
    data.rol_permisos.forEach(p => {
      if (!AppData.rolPermisos[p.rol]) AppData.rolPermisos[p.rol] = {};
      AppData.rolPermisos[p.rol][p.pagina] = !!p.permitido;
    });
  }

  // Roles del sistema + creados desde el panel
  if ((data.roles || []).length) {
    AppData.roles = data.roles.map(r => ({
      rol: r.rol, label: r.label || r.rol, emoji: r.emoji || '👥',
      color: r.color || '#6366f1', es_sistema: !!r.es_sistema
    }));
  }
  // Re-aplicar permisos con los datos frescos (sidebar puede cambiar)
  if (typeof aplicarPermisos === 'function' && currentUser) aplicarPermisos();

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
    localStorage.setItem('liq_rol_permisos', JSON.stringify(AppData.rolPermisos || null));
    localStorage.setItem('liq_roles', JSON.stringify(AppData.roles || null));
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

// Convierte un registro en memoria al formato de fila para la nube.
function filaRegistroNube(r) {
  return {
    cadete: r.cadete || '', tracking: r.tracking || '', fecha: r.fecha || '',
    fecha_date: fechaISOde(r.fecha),
    localidad: r.localidad || '', zona: r.zona || '', zona_precio: r.zona_precio || '',
    estado: r.estado || '', precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
    precio_manual: (r.precio_manual === null || r.precio_manual === undefined || r.precio_manual === '') ? null : _num(r.precio_manual)
  };
}

// Última importación que no llegó a la nube (para el botón "Reintentar").
let importPendiente = null;

// Guarda UNA importación en la nube de forma QUIRÚRGICA: borra en el servidor
// solo los trackings que esta carga reemplaza e inserta las filas nuevas.
// No reescribe la base entera (con ~2.000 registros/día eso no escala y
// pisaría cargas de otros usuarios). Asigna a cada registro su id de nube.
// Devuelve true si se sincronizó.
async function guardarImportacionEnNube(nuevos) {
  if (!window.DB || !DB.ready) { showToast('Sin conexión: la carga quedó solo local'); importPendiente = nuevos; return false; }
  try {
    showToast('Guardando ' + nuevos.length + ' registros en la nube…');
    const trackings = Array.from(new Set(nuevos.map(n => String(n.tracking || '').trim()).filter(Boolean)));
    // 1) Eliminar TODAS las filas previas de esos trackings (también las más
    //    viejas que la ventana cargada): la información nueva reemplaza.
    await DB.deleteIn('registros', 'tracking', trackings);
    // 2) Insertar las filas de esta carga y quedarnos con sus ids.
    const ids = await DB.insertRows('registros', nuevos.map(filaRegistroNube));
    nuevos.forEach((n, i) => { n.id = ids[i]; });
    importPendiente = null;
    showToast('✅ ' + nuevos.length + ' registros guardados en la nube');
    return true;
  } catch(e) {
    console.warn('guardarImportacionEnNube:', e);
    importPendiente = nuevos;
    showToast('⚠️ No se pudo guardar la carga en la nube: ' + (e.message || e));
    return false;
  }
}

// Reintenta el guardado de la última importación fallida.
async function reintentarGuardadoNube() {
  if (!importPendiente) { showToast('No hay ninguna carga pendiente de guardar'); return; }
  const ok = await guardarImportacionEnNube(importPendiente);
  const est = document.getElementById('upload-nube-estado');
  if (est) est.innerHTML = ok
    ? '<strong style="color:#166534">☁️✅ Guardado en la nube.</strong>'
    : '<strong style="color:#b91c1c">⚠️ Sigue sin poder guardarse — revisá la conexión.</strong>';
}

// Trae TODO el historial de registros (más allá de la ventana inicial).
// Para reportes históricos; con el tiempo puede ser una descarga grande.
async function cargarHistorialCompleto(btn) {
  if (AppData.historialCompleto) { showToast('El historial completo ya está cargado'); return; }
  if (!window.DB || !DB.ready) { showToast('Sin conexión'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Cargando historial…'; }
  try {
    const todos = await DB.selectRegistrosVentana(null);
    AppData.records = todos.map(r => ({
      id: r.id,
      cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
      zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
      estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
      precio_manual: (r.precio_manual === null || r.precio_manual === undefined) ? null : _num(r.precio_manual)
    }));
    AppData.historialCompleto = true;
    showToast('✅ Historial completo: ' + AppData.records.length + ' registros');
    if (typeof renderDashboard === 'function') renderDashboard();
  } catch (e) {
    console.warn('cargarHistorialCompleto:', e);
    showToast('⚠️ No se pudo cargar el historial completo');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Cargar historial completo'; }
  }
}

// Carga el set inicial de registros (data/registros_seed.json) SOLO si la nube
// está vacía: es una herramienta de arranque/prueba, no debe pisar datos reales.
async function cargarSeedRegistros() {
  try {
    if (window.DB && DB.ready) {
      const enNube = await DB.count('registros');
      if (enNube > 0) {
        showToast('⛔ La base ya tiene ' + enNube + ' registros — el seed es solo para una base vacía');
        return;
      }
    }
    showToast('Cargando registros de ejemplo…');
    const res = await fetch('data/registros_seed.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.json();
    const nuevos = arr.map(r => ({
      cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
      zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
      estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: '', precio_manual: null
    }));
    AppData.records = nuevos;
    const ok = await guardarImportacionEnNube(nuevos);
    renderDashboard();
    showToast((ok ? '✅' : '⚠️') + ' Registros de ejemplo: ' + nuevos.length + (ok ? ' (guardados en la nube)' : ' (solo local)'));
  } catch (e) {
    console.warn('cargarSeedRegistros:', e);
    showToast('⚠️ No se pudo cargar el seed (¿estás abriendo la app por http/https?)');
  }
}

// ===== DATOS REALES (importados del XLS) =====
