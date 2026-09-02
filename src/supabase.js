// ════════════════════════════════════════════════════════════════════════
//  Configuración y capa de datos de Supabase — Logística Hogareño
//  Sistema de gestión de finanzas / liquidaciones
// ════════════════════════════════════════════════════════════════════════

// Claves públicas del proyecto (la seguridad real la aplica RLS + Auth).
const SUPABASE_URL = 'https://rsglddbierwejiusrpvd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2ppAH-q0CiJR23WseNjbfA_PvIBfoQf';

// Cliente global. Si el SDK no cargó (sin conexión en el primer arranque),
// la app cae automáticamente al caché local (localStorage).
let sb = null;
try {
  if (window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  } else {
    console.warn('[Supabase] SDK no disponible — modo offline (caché local).');
  }
} catch (e) {
  console.warn('[Supabase] No se pudo inicializar el cliente:', e);
}

// Capa de acceso a datos
const DB = {
  get ready() { return !!sb; },

  // Trae TODAS las páginas de una consulta EN PARALELO (PostgREST limita a 1000
  // filas por request). Pide la 1ª página con el count exacto y, si faltan filas,
  // dispara el resto de páginas a la vez. Antes se hacía "de a 1000 EN SERIE",
  // lo que en 'registros' (~10k) tardaba varios segundos en el login/refresh.
  async _fetchAllParallel(table, { orderCol = null, filter = null } = {}) {
    const PAGE = 1000;
    const mk = (withCount) => {
      let q = withCount
        ? sb.from(table).select('*', { count: 'exact' })
        : sb.from(table).select('*');
      if (orderCol) q = q.order(orderCol);   // orden estable para paginar consistente
      if (filter) q = filter(q);
      return q;
    };
    const first = await mk(true).range(0, PAGE - 1);
    if (first.error) throw first.error;
    let out = first.data || [];
    const total = (first.count != null) ? first.count : out.length;
    if (out.length >= PAGE && total > PAGE) {
      const reqs = [];
      for (let p = 1, pages = Math.ceil(total / PAGE); p < pages; p++) {
        reqs.push(mk(false).range(p * PAGE, p * PAGE + PAGE - 1));
      }
      const results = await Promise.all(reqs);
      for (const r of results) { if (r.error) throw r.error; out = out.concat(r.data || []); }
    }
    return out;
  },

  // Trae una tabla completa. Imprescindible paginar para 'registros'.
  async selectAll(table, orderCol) {
    return this._fetchAllParallel(table, { orderCol });
  },

  // Registros dentro de una ventana de días (server-side, por fecha_date).
  // Incluye los sin fecha parseable (fecha_date null) por seguridad.
  // desdeISO null = traer todo el historial.
  async selectRegistrosVentana(desdeISO) {
    return this._fetchAllParallel('registros', {
      orderCol: 'id',
      filter: desdeISO ? (q => q.or('fecha_date.gte.' + desdeISO + ',fecha_date.is.null')) : null
    });
  },

  // Trae todos los registros archivados (tabla registros_historico).
  async selectHistorico() {
    return this._fetchAllParallel('registros_historico', { orderCol: 'id' });
  },

  // TODOS los recorridos de un cliente (vivos + archivados), sin importar la
  // ventana de días que carga la app. Lo usa Comisiones: la evaluación de un
  // cliente nuevo mira sus 4 primeras liquidaciones (28 días), que pueden quedar
  // fuera de la ventana operativa; si faltaran, la comisión se calcularía de menos.
  async selectRegistrosDeCliente(cliente) {
    const nombre = String(cliente || '').trim();
    if (!nombre) return [];
    const [vivos, hist] = await Promise.all([
      this._fetchAllParallel('registros', { orderCol: 'id', filter: q => q.ilike('cliente', nombre) }),
      this._fetchAllParallel('registros_historico', { orderCol: 'id', filter: q => q.ilike('cliente', nombre) }),
    ]);
    return (hist || []).concat(vivos || []);
  },

  // Registros archivados dentro de un rango de fechas (server-side, por fecha_date).
  // Permite consultar lo archivado sin traer las decenas de miles de filas enteras.
  async selectHistoricoRango(desdeISO, hastaISO) {
    return this._fetchAllParallel('registros_historico', {
      orderCol: 'fecha_date',
      filter: q => {
        if (desdeISO) q = q.gte('fecha_date', desdeISO);
        if (hastaISO) q = q.lte('fecha_date', hastaISO);
        return q;
      }
    });
  },

  // Mueve a histórico los registros con fecha anterior a antesDeISO.
  // Es transaccional en el servidor (función archivar_registros). Solo analista.
  // Devuelve la cantidad de registros archivados.
  async archivarRegistros(antesDeISO) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.rpc('archivar_registros', { antes_de: antesDeISO });
    if (error) throw error;
    return data || 0;
  },

  // Trae TODAS las tablas de configuración + los registros de la ventana.
  // Devuelve null si no hay conexión (para que la app use el caché local).
  // desdeISO: límite inferior de fecha para registros (null = todo).
  // opts.sinRegistros = true → NO trae la tabla 'registros' (la más pesada:
  // ~10k filas / varios MB). La usa la sincronización en vivo cuando el cambio
  // ocurrió en otra tabla, para no rebajar toda la base por un adelanto.
  async loadAll(desdeISO, opts) {
    if (!sb) return null;
    const sinRegistros = !!(opts && opts.sinRegistros);
    try {
      const [tarifas, superSla, panel, dim, km, recEsp, kmTar, registros, config, rolPerm, roles, adelantos, adelantoCuotas, descItems, descItemCuotas, clientes, proveedores, clienteTarifas, vendedores, comisionCategorias, comisionClientes, comisionPagos, importaciones, superSlaSolic, dimCatalogo, empleados, empleadoAjustes, empleadoPosterg, empleadoHsExtra, empleadoReap, condFiscal, condFacturas, empleadoSueldos, vacaciones, rendiciones, zonaAlias, cuentas, cliLiq, condLiq, cliCargos] = await Promise.all([
        this.selectAll('tarifas', 'zona'),
        this.selectAll('super_sla'),
        this.selectAll('panel_conductores', 'nombre'),
        this.selectAll('dimensiones_especiales'),
        this.selectAll('km_desvio'),
        this.selectAll('recorrido_especial'),
        this.selectAll('km_tarifas', 'vigente_desde'),
        sinRegistros ? Promise.resolve(null) : this.selectRegistrosVentana(desdeISO),
        this.selectAll('config'),
        this.selectAll('rol_permisos'),
        this.selectAll('roles', 'created_at'),
        this.selectAll('adelantos', 'id'),
        this.selectAll('adelanto_cuotas', 'id'),
        this.selectAll('descuentos_items', 'id'),
        this.selectAll('descuento_cuotas', 'id'),
        this.selectAll('clientes', 'nombre'),
        this.selectAll('proveedores', 'nombre'),
        this.selectAll('cliente_tarifas', 'id'),
        this.selectAll('vendedores', 'nombre'),
        this.selectAll('comision_categorias', 'fact_desde'),
        this.selectAll('comision_clientes', 'id'),
        this.selectAll('comision_pagos', 'id'),
        this.selectAll('importaciones', 'id'),
        this.selectAll('supersla_solicitudes', 'id'),
        this.selectAll('dimensiones_catalogo', 'id'),
        this.selectAll('empleados', 'nombre'),
        this.selectAll('empleado_ajustes', 'id'),
        this.selectAll('empleado_postergaciones', 'id'),
        this.selectAll('empleado_horas_extra', 'id'),
        this.selectAll('empleado_sueldo_reaperturas', 'id'),
        this.selectAll('conductor_fiscal', 'conductor'),
        this.selectAll('conductor_facturas', 'id'),
        this.selectAll('empleado_sueldos', 'id'),
        this.selectAll('vacaciones', 'id'),
        this.selectAll('rendiciones', 'id'),
        this.selectAll('zona_alias', 'alias'),
        this.selectAll('cliente_cuentas', 'alias_cod'),
        this.selectAll('cliente_liquidaciones', 'id'),
        this.selectAll('conductor_liquidaciones', 'id'),
        this.selectAll('cliente_cargos', 'id'),
      ]);
      return {
        tarifas, super_sla: superSla, panel_conductores: panel,
        dimensiones_especiales: dim,
        km_desvio: km, recorrido_especial: recEsp, km_tarifas: kmTar, registros, config,
        rol_permisos: rolPerm, roles, adelantos, adelanto_cuotas: adelantoCuotas,
        descuentos_items: descItems, descuento_cuotas: descItemCuotas,
        clientes,
        proveedores, cliente_tarifas: clienteTarifas,
        vendedores, comision_categorias: comisionCategorias,
        comision_clientes: comisionClientes, comision_pagos: comisionPagos,
        importaciones, supersla_solicitudes: superSlaSolic,
        dimensiones_catalogo: dimCatalogo,
        empleados, empleado_ajustes: empleadoAjustes, empleado_postergaciones: empleadoPosterg,
        empleado_horas_extra: empleadoHsExtra, empleado_sueldo_reaperturas: empleadoReap,
        conductor_fiscal: condFiscal, conductor_facturas: condFacturas,
        empleado_sueldos: empleadoSueldos, vacaciones,
        rendiciones, zona_alias: zonaAlias, cliente_cuentas: cuentas, cliente_liquidaciones: cliLiq, conductor_liquidaciones: condLiq, cliente_cargos: cliCargos,
      };
    } catch (e) {
      console.warn('[Supabase] loadAll error:', e);
      return null;
    }
  },

  // Estrategia "reemplazar todo": borra la tabla y reinserta el array completo.
  // Refleja el modelo de guardado actual (se persiste el array entero) y evita
  // el desfasaje entre filas nuevas/editadas/borradas en la UI.
  async replaceAll(table, rows, onProgress) {
    if (!sb) throw new Error('offline');
    const del = await sb.from(table).delete().not('id', 'is', null);
    if (del.error) throw del.error;
    const total = rows.length;
    for (let i = 0; i < total; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const ins = await sb.from(table).insert(chunk);
      // Esto NO es recuperable solo: el delete ya corrió, así que si un lote
      // falla la tabla queda a medio escribir. El error tiene que decir cuánto
      // entró y cuánto se perdió, porque el síntoma que se ve arriba es "la
      // planilla no se importó completa" y manda a buscar el problema al Excel
      // (bug real: una unique key sin 'tipo' cortó el guardado en la fila 3.000
      // de 5.720 y se perdieron 2.720 precios sin que nadie supiera por qué).
      if (ins.error) {
        const e = new Error('Se guardaron ' + i + ' de ' + total + ' filas de "' + table +
          '" y el resto se perdió: ' + (ins.error.message || ins.error));
        e.parcial = { tabla: table, guardadas: i, total: total };
        e.causa = ins.error;
        throw e;
      }
      if (onProgress) onProgress(Math.min(i + chunk.length, total), total);
    }
  },

  // Guarda un valor de configuración (clave/valor). Usa upsert porque la
  // tabla config tiene PK 'clave' (replaceAll asume PK 'id').
  async setConfig(clave, valor) {
    if (!sb) throw new Error('offline');
    const { error } = await sb.from('config').upsert({ clave, valor: String(valor) });
    if (error) throw error;
  },

  // Cantidad de filas de una tabla (sin traer datos).
  async count(table) {
    if (!sb) throw new Error('offline');
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  },

  // Upsert de una fila puntual (ej: un toggle de rol_permisos).
  // La RLS decide si el usuario tiene permiso.
  async upsertRow(table, row) {
    if (!sb) throw new Error('offline');
    const { error } = await sb.from(table).upsert(row);
    if (error) throw error;
  },

  // Borra las filas que matchean col = val. La RLS decide permisos.
  async deleteWhere(table, col, val) {
    if (!sb) throw new Error('offline');
    const { error } = await sb.from(table).delete().eq(col, val);
    if (error) throw error;
  },

  // Borra las filas cuyo col esté en la lista (en lotes de 200 para no
  // exceder el largo de URL de PostgREST).
  async deleteIn(table, col, valores) {
    if (!sb) throw new Error('offline');
    for (let i = 0; i < valores.length; i += 200) {
      const { error } = await sb.from(table).delete().in(col, valores.slice(i, i + 200));
      if (error) throw error;
    }
  },

  // Inserta filas en lotes y devuelve los ids generados (en el mismo orden).
  async insertRows(table, rows) {
    if (!sb) throw new Error('offline');
    const ids = [];
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await sb.from(table).insert(rows.slice(i, i + 500)).select('id');
      if (error) throw error;
      (data || []).forEach(d => ids.push(d.id));
    }
    return ids;
  },

  // Actualiza campos de una fila puntual por igualdad. La RLS decide permisos.
  async updateWhere(table, col, val, campos) {
    if (!sb) throw new Error('offline');
    const { error } = await sb.from(table).update(campos).eq(col, val);
    if (error) throw error;
  },

  // Inserta una fila (append) sin borrar el resto. Usado por el historial de
  // tarifas de km, que NO debe reemplazarse (cada cambio queda registrado).
  // La RLS decide si el usuario tiene permiso (solo analista para km_tarifas).
  async insertRow(table, row) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.from(table).insert(row).select();
    if (error) throw error;
    return data && data[0];
  },
};

window.sb = sb;
window.DB = DB;
