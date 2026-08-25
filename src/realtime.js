// ════════════════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN EN TIEMPO REAL (Supabase Realtime)
//  Escucha los cambios de las tablas clave y, cuando algo cambia (otro usuario,
//  otro dispositivo o un import), re-hidrata AppData desde la nube y re-renderiza
//  la pantalla activa — sin recargar la página. Así todas las pantallas quedan
//  siempre al día.
//
//  Diseño: en vez de parchear AppData tabla por tabla, ante CUALQUIER cambio se
//  dispara (con debounce) una re-hidratación completa vía hydrateFromSupabase()
//  — reutiliza el mismo mapeo probado que usa el login. Es simple y resiliente:
//  si se pierde un evento, el siguiente pone todo al día.
// ════════════════════════════════════════════════════════════════════════

// Tablas a las que nos suscribimos (deben estar en la publicación supabase_realtime).
const RT_TABLAS = [
  'registros', 'panel_conductores', 'tarifas', 'super_sla', 'dimensiones_especiales',
  'descuentos_items', 'descuento_cuotas', 'adelantos', 'adelanto_cuotas', 'km_desvio',
  'km_tarifas', 'config', 'rol_permisos', 'roles',
  'clientes', 'cliente_tarifas',
  'vendedores', 'comision_categorias', 'comision_clientes', 'comision_pagos',
  'importaciones', 'supersla_solicitudes', 'dimensiones_catalogo',
  'empleados', 'empleado_ajustes', 'empleado_sueldos', 'rendiciones',
];

let _rtCanal = null;
let _rtTimer = null;
let _rtMuteHasta = 0;   // ignorar echos de nuestras propias escrituras hasta este instante
// Tablas que cambiaron desde la última sincronización. Permite recargar SOLO lo
// necesario: si nadie tocó 'registros' (la tabla pesada, ~10k filas), la sync se
// hace sin ella. Antes cualquier cambio (un adelanto, un permiso) rebajaba toda
// la base y dejaba la UI trabada varios segundos.
let _rtTablasSucias = new Set();
let _rtUltimaCargaRegistros = Date.now();   // para no rebajar recorridos de más

// Qué tablas mira cada pantalla. Si ninguna de las que cambió está acá, NO se
// re-renderiza la pantalla activa (evita repintar de prepo mientras el operador
// está trabajando).
const RT_PANTALLA_TABLAS = {
  'dashboard':              ['registros', 'tarifas', 'super_sla', 'panel_conductores', 'dimensiones_catalogo'],
  'upload':                 ['registros', 'importaciones'],
  'liquidaciones':          ['registros', 'tarifas', 'super_sla', 'panel_conductores', 'dimensiones_catalogo',
                             'descuentos_items', 'descuento_cuotas', 'adelantos', 'adelanto_cuotas', 'km_desvio', 'km_tarifas'],
  'conductores':            ['registros', 'tarifas', 'super_sla', 'panel_conductores', 'dimensiones_catalogo'],
  'panel-conductores':      ['panel_conductores'],
  'config-tarifas':         ['tarifas'],
  'config-supersla':        ['super_sla', 'panel_conductores', 'supersla_solicitudes'],
  'dimensiones-especiales': ['dimensiones_catalogo'],
  'extraviados':            ['descuentos_items', 'descuento_cuotas'],
  'beneficios':             ['descuentos_items'],
  'km-desvio':              ['km_desvio', 'km_tarifas'],
  'adelantos':              ['adelantos', 'adelanto_cuotas'],
  'detalle-cliente':        ['registros', 'clientes', 'cliente_tarifas', 'tarifas', 'super_sla', 'panel_conductores'],
  'clientes':               ['clientes', 'cliente_tarifas', 'registros'],
  'comisiones':             ['vendedores', 'comision_categorias', 'comision_clientes', 'comision_pagos',
                             'clientes', 'cliente_tarifas', 'registros', 'config'],
  'gestion-permisos':       ['rol_permisos', 'roles'],
};

// Marca que la app acaba de escribir en la nube: evita que el "eco" de Realtime
// dispare una recarga redundante mientras el usuario sigue trabajando. La recarga
// se posterga hasta que pase la ventana (así igual capta cambios de otros).
function marcarEscrituraLocal(ms) {
  _rtMuteHasta = Date.now() + (ms || 2500);
}

// Escrituras grandes EN CURSO (dbPush → replaceAll: un delete + N lotes de 500,
// cada uno un viaje a la nube). El mute de 2,5 s alcanza para un guardado
// chico, pero el catálogo de dimensiones son 5.700 filas = 12 lotes, y cuando
// la ventana vencía a mitad de camino Realtime re-hidrataba leyendo la tabla a
// medio escribir y le PISABA a AppData lo que todavía se estaba guardando: el
// panel quedaba mostrando 3.000 filas exactas (lo que había en la nube en ese
// instante) y el operador creía que el Excel se había importado incompleto
// (bug real). Mientras haya una escritura en vuelo la sincronización se
// posterga, sin importar cuánto tarde.
let _rtEscrituraEnVuelo = 0;
function inicioEscrituraNube() { _rtEscrituraEnVuelo++; marcarEscrituraLocal(); }
function finEscrituraNube() {
  _rtEscrituraEnVuelo = Math.max(0, _rtEscrituraEnVuelo - 1);
  // Un respiro extra al final para no recargar por el propio eco.
  marcarEscrituraLocal(3000);
}

// ¿Hay algo en curso que NO conviene interrumpir con una recarga/re-render?
function _rtEdicionEnCurso() {
  // Ediciones sin guardar en el editor de Conductores.
  if (typeof condEditPendientes !== 'undefined' && condEditPendientes) return true;
  // Zona elegida pendiente de confirmar.
  if (typeof _zonaPendiente !== 'undefined' && _zonaPendiente && Object.keys(_zonaPendiente).length) return true;
  // Algún modal abierto (visible).
  const modalAbierto = Array.from(document.querySelectorAll('.modal-backdrop'))
    .some(m => m.offsetParent !== null);
  if (modalAbierto) return true;
  // Mapeo de columnas de importación abierto.
  const mapper = document.getElementById('column-mapper');
  if (mapper && mapper.style.display && mapper.style.display !== 'none') return true;
  return false;
}

function _rtReprogramar(ms) {
  clearTimeout(_rtTimer);
  _rtTimer = setTimeout(sincronizarEnVivo, ms);
}

// Debounce: agrupa una ráfaga de eventos (ej. un import de miles de filas) en una
// sola recarga. Anota QUÉ tabla cambió para recargar solo lo necesario.
function _rtOnCambio(payload) {
  const t = payload && (payload.table || (payload.new && payload.new.table));
  if (t) _rtTablasSucias.add(t);
  _rtReprogramar(1500);
}

async function sincronizarEnVivo() {
  if (!currentUser) return;                        // sin sesión, no sincronizamos
  if (AppData._hidratando) { _rtReprogramar(2000); return; }
  // Guardado grande en curso: leer ahora traería la tabla a medio escribir.
  if (_rtEscrituraEnVuelo > 0) { _rtReprogramar(2000); return; }
  if (_rtEdicionEnCurso()) { _rtReprogramar(3500); return; }   // no pisar al operador
  const ahora = Date.now();
  if (ahora < _rtMuteHasta) { _rtReprogramar(_rtMuteHasta - ahora + 200); return; } // esperar fin del mute

  // Qué cambió. Los eventos de recorridos llegan con table='registros'; si no
  // sabemos qué cambió, NO rebajamos ~13k filas: refrescamos solo la config y,
  // como red de seguridad, recargamos recorridos si hace rato que no lo hacemos.
  const sucias = _rtTablasSucias;
  _rtTablasSucias = new Set();
  const desconocido = sucias.size === 0;
  const haceMucho = (Date.now() - _rtUltimaCargaRegistros) > 120000;   // 2 min
  const tocoRegistros = sucias.has('registros') || (desconocido && haceMucho);
  if (tocoRegistros) _rtUltimaCargaRegistros = Date.now();

  try {
    // Si nadie tocó 'registros', se refresca todo MENOS esa tabla: la sync pasa
    // de bajar varios MB a un puñado de filas.
    await hydrateFromSupabase({ sinRegistros: !tocoRegistros });

    // Re-render solo si la pantalla activa mira alguna de las tablas que cambió.
    const pagina = (typeof paginaActivaId === 'function') ? paginaActivaId() : null;
    const mira = RT_PANTALLA_TABLAS[pagina] || null;
    const afecta = desconocido || !mira || Array.from(sucias).some(t => mira.indexOf(t) >= 0);
    if (afecta && typeof rerenderPaginaActiva === 'function') {
      rerenderPaginaActiva();
      if (typeof showToast === 'function') showToast('🔄 Datos actualizados');
    }
  } catch (e) {
    console.warn('sincronizarEnVivo:', e);
  }
}

// Arranca la suscripción (después del login). Idempotente.
function iniciarRealtime() {
  if (!window.sb || _rtCanal) return;
  try {
    let ch = sb.channel('liq-cambios');
    RT_TABLAS.forEach(t => {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, _rtOnCambio);
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') console.info('[Realtime] Sincronización en vivo activa');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[Realtime] Estado:', status);
    });
    _rtCanal = ch;
  } catch (e) {
    console.warn('No se pudo iniciar Realtime:', e);
  }
}

// Corta la suscripción (al cerrar sesión).
function detenerRealtime() {
  clearTimeout(_rtTimer);
  if (_rtCanal && window.sb) { try { sb.removeChannel(_rtCanal); } catch (e) {} }
  _rtCanal = null;
}
