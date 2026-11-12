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
    // LA SUCURSAL VIAJA COMO CABECERA, no como un filtro que cada consulta
    // tiene que acordarse de poner. Las policies de la base la exigen
    // (`es_de_sucursal`), así que una consulta a la que se le olvide el
    // `where` no puede traer filas de la otra sucursal — y las filas nuevas
    // nacen en la sucursal activa por el DEFAULT de la columna, sin que
    // ningún camino de escritura tenga que estamparla.
    // Se fija al CREAR el cliente: cambiar de sucursal recarga la página, que
    // es lo que deja todo —cliente, AppData, índices de precio y caché— en un
    // estado conocido en vez de a medio cambiar.
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { headers: { 'x-sucursal': (typeof sucursalActiva === 'function' ? sucursalActiva() : 'BA') } }
    });
  } else {
    console.warn('[Supabase] SDK no disponible — modo offline (caché local).');
  }
} catch (e) {
  console.warn('[Supabase] No se pudo inicializar el cliente:', e);
}

// OJO: estos helpers llevan prefijo _db a proposito. Un `function`, `let` o
// `const` en el tope de un src/*.js es un binding GLOBAL: si dos archivos
// declaran el mismo nombre, el segundo tira SyntaxError y queda SIN EJECUTAR
// ENTERO —no falla solo esa linea—. Paso: `_esperar` ya existia en
// liquidaciones-pdf.js y el panel de Liquidaciones se quedo sin un solo
// handler. Lo agarro el banco de humo.
// ── Cuántas páginas se piden A LA VEZ ───────────────────────────────────────
// El navegador abre ~6 conexiones por host y PostgREST empieza a devolver 500 y
// 522 (timeout) cuando le caen decenas de páginas juntas. Traer 'registros'
// entero son 78 páginas de 1000, y el historial otras 14: disparadas todas de
// una vez, el servidor devolvía errores y —como el Promise.all corta al primer
// error— se perdía la carga COMPLETA. Medido en produccion: 21 respuestas 500 y
// 17 respuestas 522 en los dos minutos en que se apretó "Cargar historial
// completo"; el boton volvia a su estado normal y parecia que no hacia nada.
// CUÁNTAS CONSULTAS A LA VEZ. Eran 6, heredado de cuando cada página era un
// LIMIT/OFFSET que el servidor resolvía recorriendo y descartando decenas de
// miles de filas (hasta 1,4 s una sola): ahí seis simultáneas lo saturaban y
// contestaba 500. Desde el cursor, una página son ~5-25 ms, así que ese techo
// dejó de proteger de algo y pasó a ser el cuello: el arranque son ~51 tablas
// y de a 6 son nueve tandas de ida y vuelta. Medido con los volúmenes reales
// (ver scratchpad/medir-arranque.html): de 6 a 12 el arranque baja a la mitad.
// El guardarraíl no se toca: ante un 429/500/503 la ventana se ACHICA sola
// (_dbAchicarVentana) y se recupera tras 8 páginas seguidas sin error.
// CUÁNTAS FILAS SE PIDEN POR REQUEST. PostgREST puede devolver MENOS de lo
// pedido (db-max-rows), y por eso el paso real de la paginación sale de lo que
// el servidor devolvió y no de esta constante: pedir de más nunca rompe, solo
// deja de ahorrar viajes. Medido con los volúmenes de producción, la ventana
// de envíos pasa de 20 requests a 4 y el arranque entero de ~88 a ~57.
// DE A CUÁNTOS DÍAS SE PARTE LA VENTANA DE ENVÍOS. Ver selectRegistrosVentana:
// el cursor es serial por definición, así que la única forma de acortar la
// fila es tener VARIAS filas a la vez. Un día son ~1.500-2.600 envíos, o sea
// 1 a 3 páginas por tramo.
const DB_TRAMO_DIAS = 2;
const DB_PAGE = 5000;
const DB_MAX_EN_VUELO = 12;
let _dbMaxEnVuelo = DB_MAX_EN_VUELO;
let _dbEnVuelo = 0;
let _dbExitosSeguidos = 0;
const _dbColaReqs = [];
function _dbDespachar() {
  while (_dbEnVuelo < _dbMaxEnVuelo && _dbColaReqs.length) {
    _dbEnVuelo++;
    _dbColaReqs.shift()();
  }
}
function _dbTomarTurno() {
  if (_dbEnVuelo < _dbMaxEnVuelo) { _dbEnVuelo++; return Promise.resolve(); }
  return new Promise(res => _dbColaReqs.push(res));
}
function _dbSoltarTurno() { _dbEnVuelo--; _dbDespachar(); }
async function _dbConTurno(fn) {
  await _dbTomarTurno();
  try { return await fn(); } finally { _dbSoltarTurno(); }
}
// Si el servidor se queja, reintentar con la MISMA presión no sirve de nada:
// vuelve a saturarse y la carga igual se cae. Hay que mandarle menos.
function _dbAchicarVentana() {
  _dbExitosSeguidos = 0;
  if (_dbMaxEnVuelo > 2) { _dbMaxEnVuelo--; }
}
// Y recuperarse de a poco: si quedara achicada para siempre, cada login
// siguiente pagaría el peaje de una saturación puntual.
function _dbMarcarExito() {
  if (_dbMaxEnVuelo >= DB_MAX_EN_VUELO) return;
  if (++_dbExitosSeguidos >= 8) { _dbExitosSeguidos = 0; _dbMaxEnVuelo++; _dbDespachar(); }
}

// 500, 502, 503, 504, 522 y 429 son transitorios: el servidor está saturado, no
// hay nada malo con la consulta. Reintentar esa página —esperando cada vez un
// poco más— la recupera, en vez de tirar abajo toda la carga por una.
const DB_ESTADOS_REINTENTABLES = [429, 500, 502, 503, 504, 520, 521, 522, 524];
function _dbValeReintentar(err) {
  if (!err) return false;
  const code = Number(err.status || err.code);
  if (DB_ESTADOS_REINTENTABLES.indexOf(code) >= 0) return true;
  // Sin status: casi siempre es la red cortada a mitad del fetch.
  const msg = String(err.message || '').toLowerCase();
  return !code && (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout'));
}
// UNA TABLA QUE NO EXISTE NO ES UNA TABLA QUE NO LLEGÓ, y confundirlas tiró
// la app entera: PostgREST contesta PGRST205 / 404, eso TIRA, y loadAll
// trataba cualquier rechazo como "la red falló" y devolvía null, o sea NO
// HIDRATABA NINGUNA de las 52 tablas. Pasó de verdad: el 10/11/2026 se
// desplegó el código que lee `costos_catalogo` y la migración que la crea es
// un paso manual aparte, así que durante un día la app sirvió SOLO caché
// local — sin un aviso, porque el único rastro era un console.warn.
// No se reintenta: un 404 de esquema no va a dejar de serlo.
function _dbTablaNoExiste(err) {
  if (!err) return false;
  if (String(err.code) === 'PGRST205') return true;
  return /could not find the table|does not exist/i.test(String(err.message || ''));
}
// CUÁNTAS FILAS DEVUELVE DE VERDAD EL SERVIDOR. Se le piden DB_PAGE pero
// PostgREST puede dar menos (db-max-rows), y eso cambia el arranque de 5
// tandas a 8. Queda anotado en window.__dbPaso y se dice UNA vez: con esto no
// hace falta que nadie corra una consulta a mano para saber en qué mundo está.
function _dbAnotarPaso(paso) {
  if (!paso || paso >= DB_PAGE) {
    if (window.__dbPaso == null) { window.__dbPaso = DB_PAGE; console.info('[DB] el servidor sirve las ' + DB_PAGE + ' filas que se le piden'); }
    return;
  }
  if (window.__dbPaso === paso) return;
  window.__dbPaso = paso;
  console.info('[DB] el servidor corta en ' + paso + ' filas por request (se le piden ' + DB_PAGE + '): el arranque paga más viajes, pero no se pierde ni una fila.');
}
// Parte [desde, fin) en tramos de n días. El ÚLTIMO queda abierto: un envío
// con fecha de mañana —o el de hoy mismo, según la hora— tiene que entrar
// igual, y un tope cerrado lo dejaría afuera sin que nada lo diga.
// Las fechas se mueven ancladas al MEDIODÍA: a medianoche cualquier huso
// corre el día, y acá un día corrido es un pedazo de la ventana que no se
// pide o que se pide dos veces.
function _dbTramosDeDias(desdeISO, n) {
  const tramos = [];
  const fin = new Date(); fin.setHours(12, 0, 0, 0); fin.setDate(fin.getDate() + 1);
  let d = new Date(String(desdeISO) + 'T12:00:00');
  if (isNaN(d)) return [{ desde: desdeISO, hasta: null }];
  let guarda = 0;
  while (d < fin && guarda++ < 400) {
    const sig = new Date(d); sig.setDate(sig.getDate() + n);
    tramos.push({
      desde: _dbISO(d),
      hasta: sig < fin ? _dbISO(sig) : null       // el último, abierto
    });
    d = sig;
  }
  return tramos.length ? tramos : [{ desde: desdeISO, hasta: null }];
}
function _dbISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
}
function _dbEsperar(ms) { return new Promise(res => setTimeout(res, ms)); }

// Pide UNA página, con turno y con reintentos.
async function _dbPedirPagina(hacerQuery, desde, hasta, intentos = 6) {
  let ultimo = null;
  for (let i = 0; i < intentos; i++) {
    const r = await _dbConTurno(() => hacerQuery().range(desde, hasta));
    if (!r.error) { _dbMarcarExito(); return r; }
    ultimo = r.error;
    if (!_dbValeReintentar(r.error) || i === intentos - 1) break;
    _dbAchicarVentana();                      // menos presión, no solo más espera
    await _dbEsperar(300 * Math.pow(2, Math.min(i, 4)));   // 0,3s .. 4,8s
  }
  throw ultimo;
}

// Capa de acceso a datos
const DB = {
  get ready() { return !!sb; },

  // Trae TODAS las páginas de una consulta (PostgREST limita a 1000 filas por
  // request). Pide la 1ª con el count exacto y, si faltan filas, trae el resto
  // en paralelo pero DE A DB_MAX_EN_VUELO: en serie, 'registros' tardaba
  // varios segundos en cada login; todas juntas, el servidor devolvía 500 y la
  // carga entera se perdía. `onProgress(hechas, total)` permite mostrar avance
  // en las cargas largas — sin eso, "Cargar historial completo" son 90 páginas
  // sin una sola señal de que algo está pasando.
  async _fetchAllParallel(table, { orderCol = null, filter = null, onProgress = null, cols = '*' } = {}) {
    const PAGE = DB_PAGE;
    const mk = (withCount) => {
      let q = withCount
        ? sb.from(table).select(cols, { count: 'exact' })
        : sb.from(table).select(cols);
      // Orden estable para paginar consistente. Puede ser más de una columna.
      if (orderCol) [].concat(orderCol).forEach(c => { q = q.order(c); });
      if (filter) q = filter(q);
      return q;
    };
    const first = await _dbPedirPagina(() => mk(true), 0, PAGE - 1);
    let out = first.data || [];
    const total = (first.count != null) ? first.count : out.length;
    // EL TAMAÑO DE PÁGINA LO DECIDE EL SERVIDOR, NO LA CONSTANTE. Se pide
    // PAGE, pero PostgREST puede devolver menos (db-max-rows). Calculando los
    // saltos con PAGE, pedir 5.000 contra un servidor que corta en 1.000 daba
    // `out.length >= PAGE` falso, una sola página, y el resto de la tabla se
    // perdía EN SILENCIO. Con el paso real la cuenta cierra en los dos mundos.
    const paso = out.length || PAGE;
    if (total > paso) _dbAnotarPaso(paso);
    const paginas = (total > paso) ? Math.ceil(total / paso) : 1;
    if (onProgress) { try { onProgress(1, paginas); } catch (e) {} }
    if (paginas > 1) {
      let hechas = 1;
      // Las páginas se disparan todas, pero cada una espera su turno: el
      // semáforo deja pasar de a DB_MAX_EN_VUELO.
      const reqs = [];
      for (let p = 1; p < paginas; p++) {
        reqs.push(_dbPedirPagina(() => mk(false), p * paso, p * paso + paso - 1)
          .then(r => { hechas++; if (onProgress) { try { onProgress(hechas, paginas); } catch (e) {} } return r; }));
      }
      const results = await Promise.all(reqs);
      for (const r of results) out = out.concat(r.data || []);
    }
    return out;
  },

  // ── PAGINAR POR CURSOR, NO POR OFFSET ──────────────────────────────────
  //  PostgREST pagina con `range`, que en SQL es LIMIT/OFFSET: para darte la
  //  página 120 el servidor tiene que **recorrer y descartar las 119.000 filas
  //  anteriores**, en cada página. El costo no es el volumen, es la PROFUNDIDAD,
  //  y crece en cada paso. Medido sobre la base real (120.221 envíos vivos):
  //
  //    página 1 del arranque .................    8 ms
  //    página 21 de un mes (offset 20.000) ...  913 ms
  //    última del historial (offset 119.000) . 1399 ms
  //
  //  O sea que "Cargar historial completo" son ~120 páginas cuyo costo sube
  //  hasta el segundo y medio: ~84 s de base. Y como se disparan de a 6, el
  //  servidor se satura y devuelve 500/522 — que es el bug que el semáforo y
  //  los reintentos vinieron a tapar, pero la causa estaba acá.
  //
  //  El cursor (keyset/seek) lo resuelve: en vez de "saltá 119.000", se pide
  //  "dame lo que viene DESPUÉS de esta fila", que es un posicionamiento en el
  //  índice. El costo deja de depender de la profundidad:
  //
  //    historial completo, página profunda ...   5,9 ms  (era 1399)
  //    rango de un mes, página profunda ......   3,4 ms  (era 913)
  //
  //  Dos detalles hacen que funcione:
  //  1) Con filtro de fecha, el cursor **mueve también el piso del rango**
  //     (`gte('fecha_date', cursor)`), así el Index Cond arranca en el cursor.
  //     Moviendo solo el desempate, el motor vuelve a leer y descartar todo lo
  //     anterior: medido, 18,9 ms contra 3,4 ms — anda, pero sigue creciendo.
  //  2) `fecha_date` no es única (hay ~2.000 envíos por día), así que el
  //     desempate va por `id`: `fecha > X  OR  (fecha = X AND id > Y)`. Sin eso
  //     se pierden filas del día del corte o se repiten.
  //
  //  Va EN SERIE y no en paralelo, al revés que el camino viejo: cada página es
  //  un salto en el índice (~5 ms), así que 120 en fila son ~1 s — menos que lo
  //  que tardaba UNA de las profundas. Y de paso deja de haber 6 consultas
  //  pesadas simultáneas, que es lo que tiraba al servidor.
  async _fetchAllSeek(table, { desdeISO = null, hastaISO = null, onProgress = null, cols = '*' } = {}) {
    const PAGE = DB_PAGE;
    const porFecha = !!desdeISO || !!hastaISO;   // sin filtro de fecha el cursor es el id solo
    let piso = desdeISO || null, ultimoId = null, ultimaFecha = null;

    // Primera página con el count exacto, solo para poder mostrar avance: 120
    // páginas sin una señal parecen un cuelgue.
    const armar = (conCount) => {
      let q = conCount ? sb.from(table).select(cols, { count: 'exact' }) : sb.from(table).select(cols);
      if (porFecha) {
        if (piso) q = q.gte('fecha_date', piso);
        if (hastaISO) q = q.lt('fecha_date', hastaISO);
        if (ultimaFecha != null) {
          // El desempate del día del corte. Las fechas van sin comillas: es la
          // sintaxis de PostgREST, no SQL.
          q = q.or('fecha_date.gt.' + ultimaFecha + ',and(fecha_date.eq.' + ultimaFecha + ',id.gt.' + ultimoId + ')');
        }
        q = q.order('fecha_date').order('id');
      } else {
        if (ultimoId != null) q = q.gt('id', ultimoId);
        q = q.order('id');
      }
      return q;
    };

    const out = [];
    let paginas = 1, hechas = 0, paso = 0, total = null;
    for (;;) {
      const r = await _dbPedirPagina(() => armar(hechas === 0), 0, PAGE - 1);
      const filas = r.data || [];
      if (hechas === 0) {
        if (r.count != null) total = r.count;
        // El paso REAL, por lo mismo que arriba: cortar por `< PAGE` contra un
        // servidor que devuelve menos de lo pedido termina la paginación en la
        // primera página y descarta el resto sin decir nada.
        paso = filas.length || PAGE;
        if (total != null && total > paso) _dbAnotarPaso(paso);
        paginas = Math.max(1, Math.ceil((total != null ? total : filas.length) / paso));
      }
      hechas++;
      if (onProgress) { try { onProgress(Math.min(hechas, paginas), paginas); } catch (e) {} }
      for (const f of filas) out.push(f);
      if (!filas.length) break;
      if (total != null && out.length >= total) break;
      if (filas.length < paso) break;
      const ult = filas[filas.length - 1];
      ultimoId = ult.id;
      if (porFecha) {
        ultimaFecha = String(ult.fecha_date || '').slice(0, 10);
        // Sin fecha no hay por dónde seguir el cursor: se corta en vez de
        // quedar pidiendo la misma página para siempre.
        if (!ultimaFecha) break;
        piso = ultimaFecha;
      }
      // Red de seguridad: 1.000 páginas son un millón de filas. Si algo hiciera
      // que el cursor no avance, mejor cortar que colgar el navegador.
      if (hechas > 1000) { console.warn('_fetchAllSeek: demasiadas páginas en ' + table); break; }
    }
    return out;
  },

  // Trae una tabla completa. Imprescindible paginar para 'registros'.

  // TODAS las tablas de datos: las que hidrata la app más las tres que deja
  // afuera a propósito por pesadas (el archivo de envíos y el detalle
  // congelado de cada liquidación se piden de a uno). Un respaldo que se
  // saltee una tabla no avisa, así que la lista se DERIVA en vez de copiarse.
  tablasDelRespaldo() {
    const base = this._defsHidratacion(null, true).map(d => d[0]);
    return base.concat(['registros', 'registros_historico', 'liquidacion_detalle']);
  },

  // Baja una tabla ENTERA. Las dos grandes van por el camino de cursor que ya
  // existe (sin desdeISO trae todo); el resto por páginas normales.
  async selectTablaCompleta(tabla, onProgress) {
    if (tabla === 'registros') return this.selectRegistrosVentana(null, onProgress);
    if (tabla === 'registros_historico') return this.selectHistorico(onProgress);
    return this._fetchAllParallel(tabla, { onProgress: onProgress || null });
  },

  async selectAll(table, orderCol) {
    return this._fetchAllParallel(table, { orderCol });
  },

  // Registros dentro de una ventana de días (server-side, por fecha_date).
  // Incluye los sin fecha parseable (fecha_date null) por seguridad.
  // desdeISO null = traer todo el historial.
  // OJO con el ORDEN: paginar la ventana ordenando por id obligaba al servidor a
  // recorrer los 80.000 envíos de la tabla viva en CADA página, descartando los
  // viejos —las filas de la ventana son las más nuevas—: ~1 s por página y ~20
  // páginas en cada arranque. Ordenando por fecha usa el índice de fecha_date y
  // lee solo la ventana: 24 ms por página, medido sobre la base real. La 'OR
  // fecha_date is null' se pide aparte porque no deja usar el índice (casi
  // siempre viene vacía). Al final se ordena por id para que AppData.records
  // quede EXACTAMENTE en el mismo orden que antes.
  async selectRegistrosVentana(desdeISO, onProgress) {
    // Sin fecha es el historial COMPLETO: no hay filtro, así que el cursor es
    // el id solo y cada página es un salto en la clave primaria (5,9 ms medidos
    // contra los 1.399 ms de la última página por offset).
    if (!desdeISO) return this._fetchAllSeek('registros', { onProgress: onProgress || null });
    // LA VENTANA VA EN TRAMOS DE DÍAS, CADA UNO CON SU PROPIO CURSOR.
    //
    //   El cursor es serial POR DEFINICIÓN: cada página necesita la última fila
    //   de la anterior para saber desde dónde seguir. Con 19.753 envíos en la
    //   ventana y el servidor cortando en 1.000, eso son 20 idas EN FILA —y
    //   subir la concurrencia no las toca, porque no hay dos que puedan salir
    //   juntas—. Medido en producción: la pantalla de carga mostraba
    //   "14 de 20", o sea casi todo el arranque esperando esa fila.
    //
    //   Partiendo la ventana por fecha, cada tramo es una fila INDEPENDIENTE y
    //   salen todas a la vez: con tramos de DB_TRAMO_DIAS días la fila más
    //   larga pasa de 20 a 2 o 3. Los tramos son disjuntos —[desde, hasta) con
    //   gte/lt— así que no se pierde ni se repite una fila, y cada uno sigue
    //   usando el índice de fecha_date igual que antes.
    const tramos = _dbTramosDeDias(desdeISO, DB_TRAMO_DIAS);
    // El avance se suma entre tramos: son páginas de la misma carga y al
    // operador le da igual de cuál vienen.
    const porTramo = new Array(tramos.length).fill(null).map(() => ({ h: 0, t: 1 }));
    const avisar = onProgress ? (i) => (h, t) => {
      porTramo[i] = { h: h, t: t };
      let H = 0, T = 0;
      porTramo.forEach(x => { H += x.h; T += x.t; });
      try { onProgress(H, Math.max(T, H)); } catch (e) {}
    } : () => null;
    const partes = await Promise.all(tramos.map((tr, i) =>
      this._fetchAllSeek('registros', {
        desdeISO: tr.desde, hastaISO: tr.hasta, onProgress: onProgress ? avisar(i) : null
      })));
    // El tick final: un tramo puede cortar antes de su ultima pagina estimada
    // (el count exacto deja cortar justo), asi que la suma quedaria en 11/12 y
    // la barra no llegaria nunca al final de su fase. Terminado el trabajo, lo
    // que corresponde decir es que esta todo.
    if (onProgress) {
      let T = 0; porTramo.forEach(x => { T += x.t; });
      try { onProgress(T, T); } catch (e) {}
    }
    const [enVentana, sinFecha] = [
      [].concat.apply([], partes),
      await this._fetchAllParallel('registros', { orderCol: 'id', filter: q => q.is('fecha_date', null) })
    ];
    const out = enVentana.concat(sinFecha);
    out.sort((a, b) => a.id - b.id);
    return out;
  },

  // Trae todos los registros archivados (tabla registros_historico).
  async selectHistorico(onProgress) {
    return this._fetchAllSeek('registros_historico', { onProgress: onProgress || null });
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

  // Los recorridos de un RANGO de fechas, de las dos tablas. Es lo que permite
  // mirar un periodo anterior a la ventana del arranque sin bajar las 99.000
  // filas: se pide solo el pedazo que falta.
  async selectRegistrosRango(desdeISO, hastaISO, onProgress) {
    // Las dos tablas: archivar NO saca un envío de la vista, solo lo mueve de
    // tabla. Por cursor, porque un mes son ~22 páginas y por offset la última
    // costaba 913 ms (3,4 ms por cursor).
    const [vivos, historico] = await Promise.all([
      this._fetchAllSeek('registros', { desdeISO: desdeISO, hastaISO: hastaISO, onProgress: onProgress || null }),
      this._fetchAllSeek('registros_historico', { desdeISO: desdeISO, hastaISO: hastaISO }),
    ]);
    return { vivos: vivos || [], historico: historico || [] };
  },

  // Los envios que YA tienen alguna de estas claves, en las dos tablas. El
  // control de "este envio ya esta cargado" no puede mirar solo la ventana en
  // memoria: el original suele estar unos dias atras y, si cayo fuera de lo
  // cargado, el aviso no saltaba y el envio entraba dos veces igual.
  // Se piden SOLO las claves que se van a dar de alta (un `in`), asi el costo
  // no depende del tamano de la tabla.
  async buscarPorClaves(claves) {
    // Se descartan las que llevan una comilla doble: supabase-js entrecomilla
    // los valores con coma pero NO escapa la comilla, asi que una sola rompe el
    // `in.()` entero y la consulta se cae con las demas adentro. Un tracking con
    // comillas es rarisimo; perder su chequeo contra la nube es mucho mejor que
    // perder el de todo el lote (igual se sigue comparando contra la memoria).
    const lista = Array.from(new Set((claves || []).filter(k => k && !String(k).includes('"'))));
    if (!lista.length) return [];
    const cols = 'id,clave,tracking,fecha,fecha_date,estado,cadete,cliente,zona,manual,contabiliza_manual';
    const out = [];
    // Los lotes se arman por LARGO y no por cantidad: una clave de respaldo
    // ('F:01 09 2026 vicente lopez vicente lopez 0005 00012535') son ~55
    // caracteres, asi que 100 de esas arman una URL de 6 KB y PostgREST la
    // rechaza con 414. Contando caracteres el lote se adapta solo.
    const lotes = [];
    let act = [], largo = 0;
    lista.forEach(k => {
      const c = String(k).length + 3;   // la clave mas sus comillas y la coma
      if (act.length && largo + c > 3500) { lotes.push(act); act = []; largo = 0; }
      act.push(k); largo += c;
    });
    if (act.length) lotes.push(act);
    for (const trozo of lotes) {
      const [vivos, hist] = await Promise.all([
        this._fetchAllParallel('registros', { cols, orderCol: 'id', filter: q => q.in('clave', trozo) }),
        this._fetchAllParallel('registros_historico', { cols, orderCol: 'id', filter: q => q.in('clave', trozo) }),
      ]);
      out.push(...(vivos || []), ...(hist || []));
    }
    return out;
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

  // Reemplaza en UNA transaccion las filas con esas claves por las nuevas.
  // Antes eran dos viajes —un delete y un insert— y un corte de red entre los
  // dos dejaba los envios borrados y sin reponer: se perdian sin ningun aviso.
  // Devuelve los ids de las filas insertadas, en el mismo orden.
  async reemplazarRegistros(claves, filas) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.rpc('reemplazar_registros', { claves: claves || [], filas: filas || [] });
    if (error) throw error;
    return data || [];
  },

  // ── Asignar un cliente o un conductor a otra sucursal ────────────────
  // Van por RPC y no por un update porque RLS lo impide POR DISEÑO: el
  // `with_check` de las policies no deja que una sesión parada en Buenos
  // Aires escriba una fila de Rosario. Las funciones son SECURITY DEFINER,
  // exigen analista y arrastran el historial entero; devuelven el detalle de
  // qué tabla movió cuántas filas.
  async asignarClienteASucursal(cod, destino) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.rpc('asignar_cliente_a_sucursal', { p_cod: cod, p_destino: destino });
    if (error) throw error;
    return data || [];
  },
  async asignarConductorASucursal(nombre, destino) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.rpc('asignar_conductor_a_sucursal', { p_nombre: nombre, p_destino: destino });
    if (error) throw error;
    return data || [];
  },
  // Va por ID: a diferencia del conductor —que se matchea por nombre y alias
  // porque así lo guardan los envíos— el empleado tiene id propio en las diez
  // tablas que cuelgan de él, así que no hay nada que adivinar.
  async asignarEmpleadoASucursal(id, destino) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.rpc('asignar_empleado_a_sucursal', { p_id: id, p_destino: destino });
    if (error) throw error;
    return data || [];
  },
  // A qué sucursal va cada código de cliente. Lo contesta la BASE porque desde
  // una sesión de Buenos Aires los clientes de Rosario están tapados por RLS:
  // la app no puede saberlo sola. Devuelve solo el código y su sucursal.
  async sucursalDeClientes(cods) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.rpc('sucursal_de_clientes', { cods: cods || [] });
    if (error) throw error;
    const m = new Map();
    (data || []).forEach(r => { if (r && r.cod) m.set(r.cod, r.sucursal || null); });
    return m;
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
  // Trae TODAS las tablas de configuración. Devuelve null si alguna no llegó.
  //
  // UNA TABLA QUE FALLA NO PUEDE LLEVARSE PUESTAS LAS OTRAS 49. Esto era un
  // Promise.all: la primera que rechazaba tiraba la carga entera, el catch
  // devolvía null y la app se quedaba con el caché del navegador mostrando
  // datos viejos sin decirlo. Es la misma lección que ya pagó el paginador
  // (ver _fetchAllParallel), solo que a nivel de TABLA en vez de página.
  //
  // Ahora las que fallan SE REINTENTAN solas, que es lo que hace que casi
  // nunca se llegue al null. Y si después del reintento igual falta alguna,
  // se devuelve null A PROPÓSITO: entregar lo que llegó dejaría las que
  // faltan en [] y eso VACIARÍA AppData —un tarifario en cero factura $0 sin
  // que nadie lo note—. Conservar lo que hay en memoria es lo seguro; lo que
  // faltaba era DECIRLO, y por eso se nombra cuáles no llegaron.
  // La lista de tablas que la app hidrata. Vive acá y no adentro de loadAll
  // porque el RESPALDO la necesita para enumerar qué bajar: con una lista
  // copiada, una tabla nueva entraría a la app y quedaría fuera del respaldo
  // sin que nada lo dijera — el modo de falla que este proyecto ya pagó con
  // archivar_registros copiando 17 de 28 columnas.
  _defsHidratacion(desdeISO, sinRegistros) {
    const defs = [
      ['tarifas', () => this.selectAll('tarifas', 'zona')],
      ['super_sla', () => this.selectAll('super_sla')],
      ['panel_conductores', () => this.selectAll('panel_conductores', 'nombre')],
      ['dimensiones_especiales', () => this.selectAll('dimensiones_especiales')],
      ['km_desvio', () => this.selectAll('km_desvio')],
      ['recorrido_especial', () => this.selectAll('recorrido_especial')],
      ['km_tarifas', () => this.selectAll('km_tarifas', 'vigente_desde')],
      ['config', () => this.selectAll('config')],
      ['rol_permisos', () => this.selectAll('rol_permisos')],
      ['roles', () => this.selectAll('roles', 'created_at')],
      ['adelantos', () => this.selectAll('adelantos', 'id')],
      ['adelanto_cuotas', () => this.selectAll('adelanto_cuotas', 'id')],
      ['descuentos_items', () => this.selectAll('descuentos_items', 'id')],
      ['descuento_cuotas', () => this.selectAll('descuento_cuotas', 'id')],
      ['clientes', () => this.selectAll('clientes', 'nombre')],
      ['proveedores', () => this.selectAll('proveedores', 'nombre')],
      ['cliente_tarifas', () => this.selectAll('cliente_tarifas', 'id')],
      ['vendedores', () => this.selectAll('vendedores', 'nombre')],
      ['comision_categorias', () => this.selectAll('comision_categorias', 'fact_desde')],
      ['comision_clientes', () => this.selectAll('comision_clientes', 'id')],
      ['comision_pagos', () => this.selectAll('comision_pagos', 'id')],
      ['importaciones', () => this.selectAll('importaciones', 'id')],
      ['supersla_solicitudes', () => this.selectAll('supersla_solicitudes', 'id')],
      ['dimensiones_catalogo', () => this.selectAll('dimensiones_catalogo', 'id')],
      ['empleados', () => this.selectAll('empleados', 'nombre')],
      ['empleado_ajustes', () => this.selectAll('empleado_ajustes', 'id')],
      ['empleado_postergaciones', () => this.selectAll('empleado_postergaciones', 'id')],
      ['empleado_movimientos', () => this.selectAll('empleado_movimientos', 'id')],
      ['empleado_horas_extra', () => this.selectAll('empleado_horas_extra', 'id')],
      ['empleado_bonos', () => this.selectAll('empleado_bonos', 'id')],
      ['puesto_horarios', () => this.selectAll('puesto_horarios', 'id')],
      ['empleado_sueldo_reaperturas', () => this.selectAll('empleado_sueldo_reaperturas', 'id')],
      ['conductor_fiscal', () => this.selectAll('conductor_fiscal', 'conductor')],
      ['conductor_facturas', () => this.selectAll('conductor_facturas', 'id')],
      ['empleado_sueldos', () => this.selectAll('empleado_sueldos', 'id')],
      ['vacaciones', () => this.selectAll('vacaciones', 'id')],
      ['rendiciones', () => this.selectAll('rendiciones', 'id')],
      ['zona_alias', () => this.selectAll('zona_alias', 'alias')],
      ['cliente_cuentas', () => this.selectAll('cliente_cuentas', 'alias_cod')],
      ['cliente_liquidaciones', () => this.selectAll('cliente_liquidaciones', 'id')],
      ['conductor_liquidaciones', () => this.selectAll('conductor_liquidaciones', 'id')],
      ['archivo_solicitudes', () => this.selectAll('archivo_solicitudes', 'id')],
      ['cliente_cargos', () => this.selectAll('cliente_cargos', 'id')],
      ['empleado_cierres', () => this.selectAll('empleado_cierres', 'periodo')],
      ['empleado_licencias', () => this.selectAll('empleado_licencias', 'id')],
      ['viajes_particulares', () => this.selectAll('viajes_particulares', 'id')],
      ['viaje_tarifas', () => this.selectAll('viaje_tarifas', 'id')],
      ['compras', () => this.selectAll('compras', 'id')],
      ['costos', () => this.selectAll('costos', 'id')],
      ['costos_catalogo', () => this.selectAll('costos_catalogo', 'id')],
      ['sucursales', () => this.selectAll('sucursales', 'orden')],
    ];
    if (!sinRegistros) defs.push(['registros', () => this.selectRegistrosVentana(desdeISO)]);
    return defs;
  },

  async loadAll(desdeISO, opts) {
    if (!sb) return null;
    const sinRegistros = !!(opts && opts.sinRegistros);
    const defs = this._defsHidratacion(desdeISO, sinRegistros);

    const out = {};
    const noExisten = [];
    // AVANCE DE LA PRIMERA FASE. Son ~51 tablas y antes la pantalla de carga
    // no tenía nada que medir ahí: la barra se paseaba varios segundos, que es
    // lo que se lee como que la app se colgó. Cuenta TABLAS TERMINADAS, que es
    // un número real y no uno inventado — el mismo criterio que el avance de
    // los envíos.
    const avisar = (opts && opts.onProgress) || null;
    let listas = 0;
    const marcar = () => {
      listas++;
      if (avisar) { try { avisar(listas, defs.length); } catch (e) {} }
    };
    let pend = defs.map((d, i) => i);
    for (let vuelta = 0; vuelta < 2 && pend.length; vuelta++) {
      const res = await Promise.allSettled(pend.map(i =>
        Promise.resolve(defs[i][1]()).then(v => { marcar(); return v; },
                                           e => { marcar(); throw e; })));
      const quedan = [];
      res.forEach((r, k) => {
        const i = pend[k];
        if (r.status === 'fulfilled') { out[defs[i][0]] = r.value; return; }
        // La tabla no está en la base: hidrata VACÍA, que es lo que es, y el
        // resto de la app entra normalmente. Falta una migración, no datos.
        if (_dbTablaNoExiste(r.reason)) {
          out[defs[i][0]] = [];
          if (noExisten.indexOf(defs[i][0]) < 0) noExisten.push(defs[i][0]);
          return;
        }
        quedan.push(i); if (vuelta) console.warn('[Supabase] ' + defs[i][0] + ':', r.reason);
      });
      pend = quedan;
    }
    if (pend.length) {
      const faltan = pend.map(i => defs[i][0]);
      console.warn('[Supabase] loadAll incompleto: no llegaron ' + faltan.join(', ') +
        '. No se hidrata nada para no vaciar lo que ya está en memoria.');
      try { window.__loadAllFaltaron = faltan; } catch (e) {}
      return null;
    }
    // ESTO NO PUEDE SER SILENCIOSO. Hidratar vacío es correcto para una tabla
    // que todavía no existe, pero si la tabla ausente fuera `cliente_tarifas`
    // el vacío FACTURA $0 sin que nadie lo note. El aviso del menú es lo que
    // hace que esto sea seguro: va siempre y nombra las tablas.
    if (noExisten.length) {
      console.warn('[Supabase] falta(n) en la base: ' + noExisten.join(', ') +
        '. Se hidratan vacías — falta correr su migración.');
    }
    try { window.__tablasFaltantes = noExisten.length ? noExisten : null; } catch (e) {}
    try { window.__loadAllFaltaron = null; } catch (e) {}
    if (sinRegistros) out.registros = null;
    return out;
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
    const fila = { clave: clave, valor: String(valor) };
    if (typeof sucursalActiva === 'function') fila.sucursal = sucursalActiva();
    const { error } = await sb.from('config').upsert(fila, { onConflict: 'sucursal,clave' });
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

  // Actualiza las filas cuyo col este en la lista (en lotes de 200, igual que
  // deleteIn, para no exceder el largo de URL de PostgREST). Reparar 270 filas
  // de a una serian 270 idas a la red.
  async updateIn(table, col, valores, campos) {
    if (!sb) throw new Error('offline');
    for (let i = 0; i < valores.length; i += 200) {
      const { error } = await sb.from(table).update(campos).in(col, valores.slice(i, i + 200));
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

  // Escribe filas resolviendo por su CLAVE ÚNICA: la que ya está se actualiza y
  // la que falta se inserta, todo en un request. Es lo que hay que usar cuando
  // se vuelve a cargar una lista entera sobre una clave única, en vez de
  // "borro y después inserto": ese camino son dos viajes, y entre los dos la
  // tabla queda a medio escribir si algo falla — además de que reintentar
  // choca con lo que ya entró. Acá repetir la operación es inofensivo.
  // `onConflict` son las columnas de la unique, separadas por coma.
  async upsertRows(table, rows, onConflict) {
    if (!sb) throw new Error('offline');
    const ids = [];
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await sb.from(table)
        .upsert(rows.slice(i, i + 500), { onConflict }).select('id');
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
  // ── Detalle CONGELADO de una liquidación (historial) ────────────────────
  // Vive en su propia tabla y NO se hidrata con el resto: las de liquidaciones
  // se traen enteras al arrancar, y los envíos de cada una serían decenas de MB
  // en memoria. Acá se lee de a una, recién cuando se abre esa liquidación.
  async selectDetalleLiq(tipo, clave, semanaISO) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.from('liquidacion_detalle').select('*')
      .eq('tipo', tipo).eq('clave', clave).eq('semana_desde', semanaISO).limit(1);
    if (error) throw error;
    return (data && data[0]) || null;
  },
  // Reabrir y volver a marcar lista pisa el MISMO detalle: la clave es la del
  // dominio (conductor/cliente + día que abre el período), no el id de la fila,
  // así no quedan detalles huérfanos de liquidaciones que ya no existen.
  async guardarDetalleLiq(row) {
    if (!sb) throw new Error('offline');
    const { error } = await sb.from('liquidacion_detalle')
      .upsert(row, { onConflict: 'tipo,clave,semana_desde' });
    if (error) throw error;
    return true;
  },
  // Cuántas liquidaciones tienen detalle guardado, sin traerlo.
  async contarDetallesLiq(tipo) {
    if (!sb) throw new Error('offline');
    const { count, error } = await sb.from('liquidacion_detalle')
      .select('id', { count: 'exact', head: true }).eq('tipo', tipo);
    if (error) throw error;
    return count || 0;
  },

  async insertRow(table, row) {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.from(table).insert(row).select();
    if (error) throw error;
    return data && data[0];
  },
};

window.sb = sb;
window.DB = DB;
