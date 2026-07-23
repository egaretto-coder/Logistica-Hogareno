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

  // Trae una tabla completa paginando de a 1000 filas (PostgREST limita por
  // defecto a 1000 por request). Imprescindible para 'registros'.
  async selectAll(table, orderCol) {
    const PAGE = 1000;
    let from = 0, out = [];
    for (;;) {
      let q = sb.from(table).select('*').range(from, from + PAGE - 1);
      if (orderCol) q = q.order(orderCol);
      const { data, error } = await q;
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return out;
  },

  // Registros dentro de una ventana de días (server-side, por fecha_date).
  // Incluye los sin fecha parseable (fecha_date null) por seguridad.
  // desdeISO null = traer todo el historial.
  async selectRegistrosVentana(desdeISO) {
    const PAGE = 1000;
    let from = 0, out = [];
    for (;;) {
      let q = sb.from('registros').select('*').order('id').range(from, from + PAGE - 1);
      if (desdeISO) q = q.or('fecha_date.gte.' + desdeISO + ',fecha_date.is.null');
      const { data, error } = await q;
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return out;
  },

  // Trae todos los registros archivados (tabla registros_historico).
  async selectHistorico() {
    const PAGE = 1000;
    let from = 0, out = [];
    for (;;) {
      const { data, error } = await sb.from('registros_historico')
        .select('*').order('id').range(from, from + PAGE - 1);
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return out;
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
  async loadAll(desdeISO) {
    if (!sb) return null;
    try {
      const [tarifas, superSla, panel, dim, km, kmTar, registros, config, rolPerm, roles, adelantos, adelantoCuotas, descItems, descItemCuotas] = await Promise.all([
        this.selectAll('tarifas', 'zona'),
        this.selectAll('super_sla'),
        this.selectAll('panel_conductores', 'nombre'),
        this.selectAll('dimensiones_especiales'),
        this.selectAll('km_desvio'),
        this.selectAll('km_tarifas', 'vigente_desde'),
        this.selectRegistrosVentana(desdeISO),
        this.selectAll('config'),
        this.selectAll('rol_permisos'),
        this.selectAll('roles', 'created_at'),
        this.selectAll('adelantos', 'id'),
        this.selectAll('adelanto_cuotas', 'id'),
        this.selectAll('descuentos_items', 'id'),
        this.selectAll('descuento_cuotas', 'id'),
      ]);
      return {
        tarifas, super_sla: superSla, panel_conductores: panel,
        dimensiones_especiales: dim,
        km_desvio: km, km_tarifas: kmTar, registros, config,
        rol_permisos: rolPerm, roles, adelantos, adelanto_cuotas: adelantoCuotas,
        descuentos_items: descItems, descuento_cuotas: descItemCuotas,
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
      if (ins.error) throw ins.error;
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
