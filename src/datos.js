function loadSavedConfig() {
  const t = localStorage.getItem('liq_tarifas');
  if (t) { try { AppData.tarifas = JSON.parse(t); } catch(e) {} }
  const s = localStorage.getItem('liq_supersla');
  if (s) { try { AppData.superSLA = JSON.parse(s); } catch(e) {} }
  const dim = localStorage.getItem('liq_dimensiones_especiales');
  if (dim) {
    try { AppData.dimensionesEspeciales = JSON.parse(dim); } catch(e) {}
  }
  const dItems = localStorage.getItem('liq_desc_items');
  if (dItems) {
    try { AppData.descItems = JSON.parse(dItems) || []; } catch(e) {}
  }
  const dCuotas = localStorage.getItem('liq_desc_cuotas');
  if (dCuotas) {
    try { AppData.descItemCuotas = JSON.parse(dCuotas) || []; } catch(e) {}
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
  const adv = localStorage.getItem('liq_adelantos');
  if (adv) { try { AppData.adelantos = JSON.parse(adv) || []; } catch(e) {} }
  const advc = localStorage.getItem('liq_adelanto_cuotas');
  if (advc) { try { AppData.adelantoCuotas = JSON.parse(advc) || []; } catch(e) {} }
  const cli = localStorage.getItem('liq_clientes');
  if (cli) { try { AppData.clientes = JSON.parse(cli) || []; } catch(e) {} }
  const clit = localStorage.getItem('liq_cliente_tarifas');
  if (clit) { try { AppData.clienteTarifas = JSON.parse(clit) || []; } catch(e) {} }
  const ven = localStorage.getItem('liq_vendedores');
  if (ven) { try { AppData.vendedores = JSON.parse(ven) || []; } catch(e) {} }
  const ccat = localStorage.getItem('liq_comision_categorias');
  if (ccat) { try { AppData.comisionCategorias = JSON.parse(ccat) || []; } catch(e) {} }
  const ccli = localStorage.getItem('liq_comision_clientes');
  if (ccli) { try { AppData.comisionClientes = JSON.parse(ccli) || []; } catch(e) {} }
  const cpag = localStorage.getItem('liq_comision_pagos');
  if (cpag) { try { AppData.comisionPagos = JSON.parse(cpag) || []; } catch(e) {} }
  const imps = localStorage.getItem('liq_importaciones');
  if (imps) { try { AppData.importaciones = JSON.parse(imps) || []; } catch(e) {} }
  const slasol = localStorage.getItem('liq_supersla_solic');
  if (slasol) { try { AppData.superSLASolicitudes = JSON.parse(slasol) || []; } catch(e) {} }
  const dimc = localStorage.getItem('liq_dim_catalogo');
  if (dimc) { try { AppData.dimCatalogo = JSON.parse(dimc) || []; } catch(e) {} }
  const emp = localStorage.getItem('liq_empleados');
  if (emp) { try { AppData.empleados = JSON.parse(emp) || []; } catch(e) {} }
  const empa = localStorage.getItem('liq_empleado_ajustes');
  if (empa) { try { AppData.empleadoAjustes = JSON.parse(empa) || []; } catch(e) {} }
  const emps = localStorage.getItem('liq_empleado_sueldos');
  if (emps) { try { AppData.empleadoSueldos = JSON.parse(emps) || []; } catch(e) {} }
  const rend = localStorage.getItem('liq_rendiciones');
  if (rend) { try { AppData.rendiciones = JSON.parse(rend) || []; } catch(e) {} }
  const p = localStorage.getItem('liq_panel_conductores');
  if (p) {
    try {
      const saved = JSON.parse(p) || [];
      // Preservar TODOS los conductores guardados (no solo los del seed). A los que
      // les falte el id, se lo recuperamos desde el seed por nombre; dedupe completa
      // los que sigan sin id y colapsa repetidos.
      const seed = AppData.panelConductores || [];
      const conIds = saved.map(gc => {
        if (gc && gc.id) return gc;
        const base = seed.find(b => normNombre(b.nombre) === normNombre(gc && gc.nombre));
        return Object.assign({}, gc, { id: base ? base.id : '' });
      });
      AppData.panelConductores = dedupePanelConductores(conIds);
      localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
      invalidarIndicePanel();   // se cargó el panel desde localStorage
    } catch (e) { console.warn('Panel de conductores en cache corrupto, se ignora:', e); }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN CON SUPABASE
// ════════════════════════════════════════════════════════════════════════

const _num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// Ventana de registros que se carga al iniciar. Con ~1.200 recorridos por día,
// traer meses de historial en cada arranque no escala (90 días ≈ 100.000 filas).
// La operación es SEMANAL: se cargan los últimos N días (la semana que se liquida
// + una de margen para correcciones) y el resto se consulta a demanda:
//   • "Cargar historial completo" (Dashboard) para análisis,
//   • el panel Archivo por rango de fechas,
//   • Comisiones trae por su cuenta la historia del cliente que evalúa
//     (DB.selectRegistrosDeCliente), así el monto nunca se calcula de menos.
const VENTANA_DIAS_REGISTROS = 14;

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
// opts.sinRegistros = true → refresca solo las tablas de configuración//movimientos
// y CONSERVA AppData.records (evita rebajar ~10k filas cuando el cambio no las toca).
// GUARDA anti-duplicación: si ya hay una hidratación equivalente en curso, se
// reutiliza en vez de disparar otra tanda de ~28 consultas (y otra bajada de
// registros si fuera completa).
let _pHydrate = { completa: null, config: null };
function hydrateFromSupabase(opts) {
  const clave = (opts && opts.sinRegistros) ? 'config' : 'completa';
  if (_pHydrate[clave]) return _pHydrate[clave];
  _pHydrate[clave] = _hydrateFromSupabaseReal(opts).finally(() => { _pHydrate[clave] = null; });
  return _pHydrate[clave];
}
async function _hydrateFromSupabaseReal(opts) {
  if (!window.DB || !DB.ready) return;
  const sinRegistros = !!(opts && opts.sinRegistros);
  AppData._hidratando = true;
  const _t0 = (window.performance && performance.now()) || 0;
  let data;
  try {
    data = await DB.loadAll(AppData.historialCompleto ? null : ventanaDesdeISO(), { sinRegistros });
  } finally {
    AppData._hidratando = false;
  }
  if (window.__perfLog) window.__perfLog('hydrate' + (sinRegistros ? '(sin registros)' : '(completa)'), _t0);
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
      id: c.id, nombre: c.nombre, condicion: c.condicion || '', categoria: c.categoria || 'super_sla',
      alias: c.alias || ''
    }));
  } else { faltaSeed.push('panel_conductores'); }
  AppData.panelConductores = dedupePanelConductores(AppData.panelConductores);
  invalidarIndicePanel();   // se rehidrató el panel desde la nube → índice viejo
  if (typeof invalidarIndiceTarifas === 'function') invalidarIndiceTarifas(); // tarifas/superSLA frescos

  AppData.dimensionesEspeciales = (data.dimensiones_especiales || []).map(d => ({
    fecha: d.fecha || '', tracking: d.tracking || '', cliente: d.cliente || '',
    zona: d.zona || '', valor: _num(d.valor), condicion: d.condicion || ''
  }));
  // Descuentos por ítem con fecha (combustible / extraviados / proveedores).
  // Reemplaza el modelo viejo descuentosConductores (deprecado, ya no se carga).
  AppData.descItems = (data.descuentos_items || []).map(x => ({
    id: x.id, tipo: x.tipo, conductor: x.conductor, fecha: x.fecha || '',
    monto: _num(x.monto), referencia: x.referencia || '', detalle: x.detalle || '',
    cuotas_total: _num(x.cuotas_total) || 1, monto_cuota: _num(x.monto_cuota),
    imputar: x.imputar !== false,   // false = excluido de las liquidaciones a propósito
    estado: x.estado || 'autorizado', autorizado_por: x.autorizado_por || '', autorizado_en: x.autorizado_en || ''
  }));
  // Cuotas de extravíos cuoteados (descuento_cuotas)
  AppData.descItemCuotas = (data.descuento_cuotas || []).map(c => ({
    id: c.id, item_id: c.item_id, nro: _num(c.nro), monto: _num(c.monto), fecha: c.fecha || ''
  }));
  AppData.kmDesvio = (data.km_desvio || []).map(d => ({
    id: d.id, conductor: d.conductor, km: _num(d.km), fecha: d.fecha || '',
    valor_km: _num(d.valor_km), monto: _num(d.monto), obs: d.obs || '',
    imputar: d.imputar !== false   // las filas viejas (sin el campo) cuentan como imputadas
  }));
  // Historial de tarifas de km (ascendente por vigencia)
  AppData.kmTarifas = (data.km_tarifas || [])
    .map(t => ({ valor: _num(t.valor), vigente_desde: t.vigente_desde, creado_por: t.creado_por || '' }))
    .sort((a, b) => new Date(a.vigente_desde) - new Date(b.vigente_desde));
  // OJO: con sinRegistros, data.registros viene null y NO se toca AppData.records
  // (si mapeáramos null quedaría vacío y se perdería la base en memoria).
  if (data.registros) AppData.records = data.registros.map(r => ({
    id: r.id, // id de la fila en la nube: permite ediciones puntuales sin reescribir la base
    cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
    zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
    direccion: r.direccion || '', destinatario: r.destinatario || '',
    cliente: r.cliente || '', // nombre de fantasía (para mostrar)
    cliente_cod: r.cliente_cod || '', // IDENTIDAD del cliente que factura
    dim_especial: r.dim_especial || '', // dimensión especial asignada (nombre) — vacío = ninguna
    dim_cliente: r.dim_cliente || '',   // cliente de esa dimensión (para resolver el precio por zona)
    cobro_destino: _num(r.cobro_destino), // monto que el conductor cobra al destinatario y debe rendir
    estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
    manual: !!r.manual, // true = envío cargado a mano desde el editor de Conductores
    // Visita hecha sin entrega: se paga igual, pero el estado del envío NO cambia.
    contabiliza_manual: !!r.contabiliza_manual,
    motivo_contab: r.motivo_contab || '',
    zona_manual: !!r.zona_manual, // true = la zona fue definida/corregida a mano
    // null = sin corrección; número = precio corregido a mano por el operador
    precio_manual: (r.precio_manual === null || r.precio_manual === undefined) ? null : _num(r.precio_manual)
  }));

  // Clientes (facturación) + su tarifario de venta por zona.
  AppData.proveedores = (data.proveedores || []).map(p => ({
    id: p.id, nombre: p.nombre, rubro: p.rubro || '', telefono: p.telefono || '',
    obs: p.obs || '', activo: p.activo !== false
  }));
  AppData.clientes = (data.clientes || []).map(c => ({
    id: c.id, nombre: c.nombre, codigo: (c.codigo || '').toUpperCase(),
    razon_social: c.razon_social || '', cuit: c.cuit || '',
    contacto: c.contacto || '', telefono: c.telefono || '', email: c.email || '', obs: c.obs || '',
    activo: c.activo !== false
  }));
  AppData.clienteTarifas = (data.cliente_tarifas || []).map(t => ({
    id: t.id, cliente: t.cliente, cliente_cod: (t.cliente_cod || '').toUpperCase(),
    zona: t.zona, precio: _num(t.precio)
  }));

  // Comisiones: vendedores, escala de categorización, clientes en comisión y pagos.
  AppData.vendedores = (data.vendedores || []).map(v => ({
    id: v.id, nombre: v.nombre, activo: v.activo !== false
  }));
  AppData.comisionCategorias = (data.comision_categorias || []).map(c => ({
    id: c.id, categoria: c.categoria,
    fact_desde: _num(c.fact_desde),
    fact_hasta: (c.fact_hasta === null || c.fact_hasta === undefined) ? null : _num(c.fact_hasta),
    monto: _num(c.monto)
  }));
  AppData.comisionClientes = (data.comision_clientes || []).map(c => ({
    id: c.id, cliente: c.cliente, vendedor: c.vendedor,
    fecha_alta: c.fecha_alta || '', mes_inicio: c.mes_inicio || '',
    categoria: c.categoria || '', facturacion_eval: _num(c.facturacion_eval),
    monto: _num(c.monto), bloqueado: !!c.bloqueado
  }));
  AppData.comisionPagos = (data.comision_pagos || []).map(p => ({
    id: p.id, periodo: p.periodo, beneficiario: p.beneficiario,
    tipo: p.tipo || 'vendedor', monto: _num(p.monto),
    detalle: p.detalle || '', pagado_en: p.pagado_en || ''
  }));

  // Historial de importaciones de recorridos.
  AppData.importaciones = (data.importaciones || []).map(i => ({
    id: i.id, archivo: i.archivo || '', hash: i.hash || '',
    fecha_carga: i.fecha_carga || '', filas: _num(i.filas),
    agregados: _num(i.agregados), reemplazados: _num(i.reemplazados),
    fecha_desde: i.fecha_desde || '', fecha_hasta: i.fecha_hasta || '',
    usuario: i.usuario || '', created_at: i.created_at || ''
  }));

  // Recursos Humanos.
  AppData.empleados = (data.empleados || []).map(e => ({
    id: e.id, nombre: e.nombre, dni: e.dni || '', telefono: e.telefono || '', email: e.email || '',
    direccion: e.direccion || '', puesto: e.puesto || '', area: e.area || '',
    registrado: e.registrado !== false,
    fecha_ingreso: e.fecha_ingreso || '', sueldo: _num(e.sueldo),
    pct_transferencia: e.pct_transferencia === null || e.pct_transferencia === undefined ? 100 : _num(e.pct_transferencia),
    activo: e.activo !== false, obs: e.obs || '',
    fecha_baja: e.fecha_baja || null, motivo_baja: e.motivo_baja || ''
  }));
  AppData.empleadoAjustes = (data.empleado_ajustes || []).map(a => ({
    id: a.id, empleado_id: a.empleado_id, fecha: a.fecha || '', periodo: a.periodo || '',
    pct: _num(a.pct), sueldo_anterior: _num(a.sueldo_anterior), sueldo_nuevo: _num(a.sueldo_nuevo),
    motivo: a.motivo || '', aplicado_por: a.aplicado_por || ''
  }));
  AppData.empleadoSueldos = (data.empleado_sueldos || []).map(s => ({
    id: s.id, empleado_id: s.empleado_id, periodo: s.periodo,
    sueldo_base: _num(s.sueldo_base), horas_extra: _num(s.horas_extra),
    valor_hora_extra: _num(s.valor_hora_extra), monto_horas_extra: _num(s.monto_horas_extra),
    bono_eficiencia: _num(s.bono_eficiencia), descuenta_adelanto: !!s.descuenta_adelanto,
    monto_adelanto: _num(s.monto_adelanto), total: _num(s.total),
    pct_transferencia: _num(s.pct_transferencia), monto_transferencia: _num(s.monto_transferencia),
    monto_efectivo: _num(s.monto_efectivo), pagado: !!s.pagado, pagado_en: s.pagado_en || '', obs: s.obs || ''
  }));

  // Rendiciones de cobros en destino.
  AppData.rendiciones = (data.rendiciones || []).map(r => ({
    id: r.id, tracking: r.tracking || '', conductor: r.conductor, cliente: r.cliente || '',
    monto: _num(r.monto), fecha_entrega: r.fecha_entrega || '', fecha_limite: r.fecha_limite || '',
    estado: r.estado || 'pendiente', fecha_rendicion: r.fecha_rendicion || '',
    medio: r.medio || '', obs: r.obs || '', origen: r.origen || 'manual',
    registrado_por: r.registrado_por || '', recibido_por: r.recibido_por || '',
    // Etapa 1: el chofer trajo la plata. Etapa 2: se le devolvió al cliente.
    fecha_recibido: r.fecha_recibido || '', medio_recibido: r.medio_recibido || '',
    rendido_por: r.rendido_por || '', comprobante: r.comprobante || '',
    lote_id: r.lote_id || null
  }));

  // Catálogo de dimensiones especiales (cliente · dimensión · zona · precio).
  AppData.dimCatalogo = (data.dimensiones_catalogo || []).map(d => ({
    id: d.id, cliente: d.cliente || '', nombre: d.nombre || '', zona: d.zona || '', precio: _num(d.precio),
    detalle: d.detalle || ''   // nota del acuerdo; no entra en el cálculo pero viaja en la planilla
  }));

  // Solicitudes de cambio de precio de Super SLA.
  AppData.superSLASolicitudes = (data.supersla_solicitudes || []).map(s => ({
    id: s.id, conductor: s.conductor, zona: s.zona,
    precio_anterior: _num(s.precio_anterior), precio_propuesto: _num(s.precio_propuesto),
    motivo: s.motivo || '', solicitante: s.solicitante || '',
    estado: s.estado || 'pendiente', resuelto_por: s.resuelto_por || '',
    created_at: s.created_at || ''
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
  // Adelantos (préstamos en cuotas) y sus cuotas descontadas
  AppData.adelantos = (data.adelantos || []).map(a => ({
    id: a.id, conductor: a.conductor, monto_total: _num(a.monto_total),
    cuotas_total: _num(a.cuotas_total), monto_cuota: _num(a.monto_cuota),
    fecha: a.fecha || '', obs: a.obs || '',
    beneficiario_tipo: a.beneficiario_tipo || 'conductor',
    empleado_id: a.empleado_id != null ? a.empleado_id : null,
    moneda: a.moneda || 'ARS', tipo_cambio: _num(a.tipo_cambio),
    estado: a.estado || 'autorizado', autorizado_por: a.autorizado_por || '', autorizado_en: a.autorizado_en || ''
  }));
  AppData.adelantoCuotas = (data.adelanto_cuotas || []).map(c => ({
    id: c.id, adelanto_id: c.adelanto_id, nro: _num(c.nro),
    monto: _num(c.monto), fecha: c.fecha || '',
    moneda: c.moneda || 'ARS', tipo_cambio: _num(c.tipo_cambio),
    // Las cuotas viejas no tienen monto_ars y eran todas en pesos.
    monto_ars: _num(c.monto_ars) || _num(c.monto)
  }));

  // Re-aplicar permisos con los datos frescos (sidebar puede cambiar)
  if (typeof aplicarPermisos === 'function' && currentUser) aplicarPermisos();

  // Refrescar caché local para uso offline
  try {
    localStorage.setItem('liq_tarifas', JSON.stringify(AppData.tarifas));
    localStorage.setItem('liq_supersla', JSON.stringify(AppData.superSLA));
    localStorage.setItem('liq_panel_conductores', JSON.stringify(AppData.panelConductores));
    localStorage.setItem('liq_dimensiones_especiales', JSON.stringify(AppData.dimensionesEspeciales));
    localStorage.setItem('liq_desc_items', JSON.stringify(AppData.descItems));
    localStorage.setItem('liq_desc_cuotas', JSON.stringify(AppData.descItemCuotas));
    localStorage.setItem('liq_km_desvio', JSON.stringify(AppData.kmDesvio));
    localStorage.setItem('liq_km_tarifas', JSON.stringify(AppData.kmTarifas));
    localStorage.setItem('liq_config', JSON.stringify(AppData.config));
    localStorage.setItem('liq_rol_permisos', JSON.stringify(AppData.rolPermisos || null));
    localStorage.setItem('liq_roles', JSON.stringify(AppData.roles || null));
    localStorage.setItem('liq_adelantos', JSON.stringify(AppData.adelantos));
    localStorage.setItem('liq_adelanto_cuotas', JSON.stringify(AppData.adelantoCuotas));
    localStorage.setItem('liq_clientes', JSON.stringify(AppData.clientes));
    localStorage.setItem('liq_cliente_tarifas', JSON.stringify(AppData.clienteTarifas));
    localStorage.setItem('liq_vendedores', JSON.stringify(AppData.vendedores));
    localStorage.setItem('liq_comision_categorias', JSON.stringify(AppData.comisionCategorias));
    localStorage.setItem('liq_comision_clientes', JSON.stringify(AppData.comisionClientes));
    localStorage.setItem('liq_comision_pagos', JSON.stringify(AppData.comisionPagos));
    localStorage.setItem('liq_importaciones', JSON.stringify(AppData.importaciones));
    localStorage.setItem('liq_supersla_solic', JSON.stringify(AppData.superSLASolicitudes));
    localStorage.setItem('liq_dim_catalogo', JSON.stringify(AppData.dimCatalogo));
    localStorage.setItem('liq_empleados', JSON.stringify(AppData.empleados));
    localStorage.setItem('liq_empleado_ajustes', JSON.stringify(AppData.empleadoAjustes));
    localStorage.setItem('liq_empleado_sueldos', JSON.stringify(AppData.empleadoSueldos));
    localStorage.setItem('liq_rendiciones', JSON.stringify(AppData.rendiciones));
  } catch(e) {}

  // Primer arranque: sembrar en Supabase las tablas base que estaban vacías.
  if (faltaSeed.length) {
    for (const t of faltaSeed) {
      try { await dbPush(t); } catch(e) { console.warn('Seed ' + t + ' falló:', e); }
    }
    console.info('[Supabase] Tablas base sembradas desde defaults:', faltaSeed.join(', '));
  }
}

// ════════════════════════════════════════════════════════════════════════
//  CARGA EN 2 FASES (arranque ágil)
//  Los recorridos son lo pesado (~10k filas / varios MB) y tardan >1,5 s. Si
//  esperamos todo junto, el operador ve pantallas vacías y siente la app
//  trabada. Por eso: primero la configuración (liviana → la app queda usable
//  al instante) y después los recorridos, repintando al llegar.
// ════════════════════════════════════════════════════════════════════════

// Trae SOLO la tabla de recorridos y actualiza AppData.records.
// GUARDA anti-duplicación: si ya hay una carga en curso, devuelve ESA misma
// promesa en vez de disparar otra descarga (bajar ~13k filas dos o tres veces
// en paralelo era el mayor costo del arranque).
let _pCargaRegistros = null;
function hydrateRegistros() {
  if (_pCargaRegistros) return _pCargaRegistros;
  _pCargaRegistros = _hydrateRegistrosReal().finally(() => { _pCargaRegistros = null; });
  return _pCargaRegistros;
}
async function _hydrateRegistrosReal() {
  if (!window.DB || !DB.ready) return false;
  const _t0 = (window.performance && performance.now()) || 0;
  AppData._cargandoRegistros = true;
  actualizarEstadoCarga();
  try {
    const filas = await DB.selectRegistrosVentana(AppData.historialCompleto ? null : ventanaDesdeISO());
    AppData.records = (filas || []).map(r => ({
      id: r.id,
      cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
      zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
      direccion: r.direccion || '', destinatario: r.destinatario || '',
      cliente: r.cliente || '', dim_especial: r.dim_especial || '', dim_cliente: r.dim_cliente || '',
      estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
      manual: !!r.manual, zona_manual: !!r.zona_manual,
      contabiliza_manual: !!r.contabiliza_manual, motivo_contab: r.motivo_contab || '',
      precio_manual: (r.precio_manual === null || r.precio_manual === undefined) ? null : _num(r.precio_manual)
    }));
    invalidarLiquidaciones();   // base nueva en memoria: recalcular totales
    if (window.__perfLog) window.__perfLog('cargar recorridos (' + AppData.records.length + ')', _t0);
    return true;
  } catch (e) {
    console.warn('hydrateRegistros:', e);
    return false;
  } finally {
    AppData._cargandoRegistros = false;
    actualizarEstadoCarga();
  }
}

// Aviso visible mientras bajan los recorridos (así el operador entiende que los
// números todavía se están completando, en vez de ver una pantalla vacía).
function actualizarEstadoCarga() {
  const el = document.getElementById('sidebar-record-count');
  if (!el) return;
  if (AppData._cargandoRegistros) {
    el.textContent = '⏳ Cargando recorridos…';
  } else {
    // Mismo texto que escribe el Dashboard al renderizar.
    el.textContent = AppData.records.length
      ? (AppData.records.length + ' registros' + (AppData.historialCompleto ? ' (historial completo)' : ' · últimos ' + VENTANA_DIAS_REGISTROS + ' días'))
      : 'Sin datos cargados';
  }
}

// Orquesta el arranque. Las dos cargas salen EN PARALELO (el tiempo total es el
// de la más lenta, no la suma), pero la pantalla se repinta apenas llega la
// configuración: la app queda operativa sin esperar los ~10k recorridos.
async function hydrateEnFases() {
  const pRegistros = hydrateRegistros();                       // arranca ya
  try {
    await hydrateFromSupabase({ sinRegistros: true });          // config (liviana)
    if (typeof rerenderPaginaActiva === 'function') rerenderPaginaActiva();
  } catch (e) { console.warn('Fase config:', e); }
  const ok = await pRegistros;                                 // recorridos (pesado)
  if (ok && typeof rerenderPaginaActiva === 'function') rerenderPaginaActiva();
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
    panel_conductores: () => dedupePanelConductores(AppData.panelConductores).map(c => ({
      id: c.id, nombre: c.nombre, condicion: c.condicion || '', categoria: c.categoria || 'super_sla',
      alias: c.alias || ''
    })).filter(c => c.id),
    dimensiones_especiales: () => AppData.dimensionesEspeciales.map(d => ({
      fecha: d.fecha || '', tracking: d.tracking || '', cliente: d.cliente || '',
      zona: d.zona || '', valor: _num(d.valor), condicion: d.condicion || ''
    })),
    dimensiones_catalogo: () => AppData.dimCatalogo.map(d => ({
      cliente: d.cliente || '', nombre: d.nombre || '', zona: d.zona || '', precio: _num(d.precio),
      detalle: d.detalle || ''
    })).filter(d => d.cliente && d.nombre && d.zona),
    km_desvio: () => AppData.kmDesvio.map(d => ({
      conductor: d.conductor, km: _num(d.km), fecha: d.fecha || '',
      valor_km: _num(d.valor_km), monto: _num(d.monto), obs: d.obs || '',
      imputar: d.imputar !== false
    })).filter(d => d.conductor),
  };
  const rows = builders[table] ? builders[table]() : [];
  if ((table === 'super_sla' || table === 'tarifas') && typeof invalidarIndiceTarifas === 'function') invalidarIndiceTarifas();
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
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
    direccion: r.direccion || '', destinatario: r.destinatario || '', cliente: r.cliente || '',
    cliente_cod: r.cliente_cod || '',
    dim_especial: r.dim_especial || '', dim_cliente: r.dim_cliente || '',
    cobro_destino: _num(r.cobro_destino),  // cobro en destino a rendir
    estado: r.estado || '', precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
    clave: claveRegistro(r),
    manual: !!r.manual,
    zona_manual: !!r.zona_manual,
    contabiliza_manual: !!r.contabiliza_manual,
    motivo_contab: r.motivo_contab || '',
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
  // Import grande: silenciar el eco de Realtime un rato más largo.
  if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal(8000);
  try {
    showToast('Guardando ' + nuevos.length + ' registros en la nube…');
    const claves = Array.from(new Set(nuevos.map(n => n.clave || claveRegistro(n)).filter(Boolean)));
    // 1) Eliminar en el servidor las filas previas con la MISMA CLAVE de las de
    //    esta carga (por tracking real, o por dirección si el tracking es basura).
    //    Las claves nuevas no matchean nada -> los envíos distintos se conservan.
    await DB.deleteIn('registros', 'clave', claves);
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
    : '<strong style="color:#b91c1c"><i class="ic ic-alert"></i> Sigue sin poder guardarse — revisá la conexión.</strong>';
}

// Trae TODO el historial de registros (más allá de la ventana inicial): la
// tabla viva completa + los archivados en registros_historico. Los archivados
// se cargan como SOLO LECTURA (id=null, _historico=true): no se pueden editar
// ni re-sincronizar, porque ya no están en la tabla principal.
async function cargarHistorialCompleto(btn) {
  if (AppData.historialCompleto) { showToast('El historial completo ya está cargado'); return; }
  if (!window.DB || !DB.ready) { showToast('Sin conexión'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Cargando historial…'; }
  try {
    const [vivos, historico] = await Promise.all([
      DB.selectRegistrosVentana(null),
      DB.selectHistorico()
    ]);
    const mapVivo = r => ({
      id: r.id,
      cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
      zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
      direccion: r.direccion || '', destinatario: r.destinatario || '', cliente: r.cliente || '',
      cliente_cod: r.cliente_cod || '',
      dim_especial: r.dim_especial || '', dim_cliente: r.dim_cliente || '', cobro_destino: _num(r.cobro_destino),
      estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
      manual: !!r.manual, zona_manual: !!r.zona_manual,
      contabiliza_manual: !!r.contabiliza_manual, motivo_contab: r.motivo_contab || '',
      precio_manual: (r.precio_manual === null || r.precio_manual === undefined) ? null : _num(r.precio_manual)
    });
    const mapHist = r => ({
      id: null, _historico: true,
      cadete: r.cadete, tracking: r.tracking, fecha: r.fecha, localidad: r.localidad,
      zona: r.zona || r.localidad, zona_precio: r.zona_precio || '',
      direccion: r.direccion || '', destinatario: r.destinatario || '', cliente: r.cliente || '',
      cliente_cod: r.cliente_cod || '',
      dim_especial: r.dim_especial || '', dim_cliente: r.dim_cliente || '', cobro_destino: _num(r.cobro_destino),
      estado: r.estado, precio_bd: _num(r.precio_bd), carga_fecha: r.carga_fecha || '',
      manual: !!r.manual, zona_manual: !!r.zona_manual,
      contabiliza_manual: !!r.contabiliza_manual, motivo_contab: r.motivo_contab || '',
      precio_manual: (r.precio_manual === null || r.precio_manual === undefined) ? null : _num(r.precio_manual)
    });
    AppData.records = historico.map(mapHist).concat(vivos.map(mapVivo));
    AppData.historialCompleto = true;
    showToast('✅ Historial completo: ' + AppData.records.length + ' registros (' + historico.length + ' archivados)');
    if (typeof renderDashboard === 'function') renderDashboard();
  } catch (e) {
    console.warn('cargarHistorialCompleto:', e);
    showToast('⚠️ No se pudo cargar el historial completo');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Cargar historial completo'; }
  }
}

// Archiva (mueve a registros_historico) los registros anteriores a antesDeISO.
// Transaccional en el servidor; solo analistas. Refresca la app al terminar.
async function archivarRegistrosAntesDe(antesDeISO) {
  if (!esAnalista()) { showToast('⛔ Solo un analista puede archivar registros'); return; }
  if (!window.DB || !DB.ready) { showToast('Sin conexión'); return; }
  try {
    const movidos = await DB.archivarRegistros(antesDeISO);
    if (movidos > 0) {
      showToast('✅ ' + movidos + ' registros archivados');
      AppData.historialCompleto = false; // la ventana se recarga sin los archivados
      await hydrateFromSupabase();
      if (typeof renderDashboard === 'function') renderDashboard();
    } else {
      showToast('No había registros anteriores a esa fecha');
    }
    return movidos;
  } catch (e) {
    console.warn('archivarRegistrosAntesDe:', e);
    showToast('⛔ No se pudo archivar: ' + (e.message || e));
    return -1;
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
