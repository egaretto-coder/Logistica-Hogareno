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

  // Trae TODAS las tablas de configuración + registros en paralelo.
  // Devuelve null si no hay conexión (para que la app use el caché local).
  async loadAll() {
    if (!sb) return null;
    try {
      const [tarifas, superSla, panel, dim, desc, km, registros, config] = await Promise.all([
        this.selectAll('tarifas', 'zona'),
        this.selectAll('super_sla'),
        this.selectAll('panel_conductores', 'nombre'),
        this.selectAll('dimensiones_especiales'),
        this.selectAll('descuentos_conductores'),
        this.selectAll('km_desvio'),
        this.selectAll('registros', 'id'),
        this.selectAll('config'),
      ]);
      return {
        tarifas, super_sla: superSla, panel_conductores: panel,
        dimensiones_especiales: dim, descuentos_conductores: desc,
        km_desvio: km, registros, config,
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
};

window.sb = sb;
window.DB = DB;
