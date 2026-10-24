// ═══════════════════════════════════════════════════════════════════════
//  SUCURSALES — una sola app para todas las bocas de la empresa.
//
//  Buenos Aires es la que estaba y sigue siendo la que abre por defecto.
//  Rosario es la primera de las que vienen. Los datos son INDEPENDIENTES:
//  conductores, clientes, tarifas, empleados y liquidaciones de cada una.
//
//  EL AISLAMIENTO LO HACE CUMPLIR LA BASE, NO ESTE ARCHIVO. La sucursal
//  activa viaja como cabecera `x-sucursal` en todas las consultas y las
//  policies la exigen (`es_de_sucursal`), así que aunque una consulta se
//  olvidara el filtro no puede traer filas de la otra. Es a propósito: un
//  filtro olvidado no da error, da datos de más, y este proyecto ya pagó
//  varias veces el costo de lo que falla en silencio.
//
//  ESTE ARCHIVO CARGA PRIMERO, antes que supabase.js, porque el cliente se
//  crea con la cabecera puesta y el caché local se namespacea antes de que
//  nadie lo lea.
// ═══════════════════════════════════════════════════════════════════════

const SUCURSAL_DEFAULT = 'BA';

// Lo que NO se separa por sucursal: las preferencias de la persona (el tema y
// el menú son de quien usa la app, no de la boca) y la propia sucursal activa.
// Todo el resto del caché `liq_*` SÍ se separa — ver abajo.
const SUC_CLAVES_GLOBALES = ['liq_tema', 'liq_menu', 'liq_emp_agrupa', 'liq_sucursal'];

let _sucActiva = SUCURSAL_DEFAULT;
let _sucNamespaceOk = false;

// ── El caché local, separado por sucursal ───────────────────────────────
// Son ~60 claves `liq_*` repartidas en 20 archivos. Namespacearlas una por una
// sería 60 lugares donde olvidarse de una, y la que se olvide hace que al
// abrir Rosario aparezcan los datos de Buenos Aires hasta que termine de
// hidratar — o sea el panel mostrando plata de otra sucursal. Por eso se
// intercepta localStorage en UN punto: toda clave `liq_*` que no sea una
// preferencia queda guardada como `suc_<SUCURSAL>_liq_...`.
(function _sucNamespaceLocalStorage() {
  let ls;
  try { ls = window.localStorage; } catch (e) { return; }
  if (!ls) return;

  try { _sucActiva = ls.getItem('liq_sucursal') || SUCURSAL_DEFAULT; } catch (e) {}

  const _get = ls.getItem.bind(ls);
  const _set = ls.setItem.bind(ls);
  const _del = ls.removeItem.bind(ls);
  const mapear = k => {
    const s = String(k);
    return (s.indexOf('liq_') === 0 && SUC_CLAVES_GLOBALES.indexOf(s) < 0)
      ? 'suc_' + _sucActiva + '_' + s : s;
  };
  const parche = {
    getItem: k => _get(mapear(k)),
    setItem: (k, v) => _set(mapear(k), v),
    removeItem: k => _del(mapear(k))
  };

  // Asignar sobre el objeto funciona en los navegadores actuales; si alguno lo
  // impidiera se parchea el prototipo. Si NINGUNO de los dos toma, la app
  // tiene que seguir andando —el caché es una optimización, no la fuente— así
  // que se deja constancia en vez de romper el arranque.
  try {
    Object.keys(parche).forEach(k => { ls[k] = parche[k]; });
    _sucNamespaceOk = (ls.getItem !== _get);
  } catch (e) { _sucNamespaceOk = false; }
  if (!_sucNamespaceOk) {
    try {
      Object.keys(parche).forEach(k => { Storage.prototype[k] = parche[k]; });
      _sucNamespaceOk = true;
    } catch (e) { _sucNamespaceOk = false; }
  }
  if (!_sucNamespaceOk) {
    console.warn('[Sucursal] No se pudo separar el caché local por sucursal: ' +
      'se va a trabajar siempre contra la nube.');
  }
})();

function sucursalActiva() { return _sucActiva || SUCURSAL_DEFAULT; }
function sucursalEsDefault() { return sucursalActiva() === SUCURSAL_DEFAULT; }
function sucursalCacheSeparado() { return _sucNamespaceOk; }

// El catálogo viene de la nube (`sucursales`); hasta que hidrate se usa lo
// mínimo para poder dibujar el selector sin esperar.
const SUC_FALLBACK = [
  { codigo: 'BA', nombre: 'Buenos Aires', orden: 1, activa: true },
  { codigo: 'ROS', nombre: 'Rosario', orden: 2, activa: true }
];
function sucursalesDisponibles() {
  const l = (typeof AppData !== 'undefined' && AppData && AppData.sucursales) || [];
  const base = l.length ? l : SUC_FALLBACK;
  return base.filter(s => s && s.activa !== false)
    .slice().sort((a, b) => (a.orden || 99) - (b.orden || 99) ||
      String(a.codigo).localeCompare(String(b.codigo)));
}
function sucursalNombre(cod) {
  const c = cod || sucursalActiva();
  const s = sucursalesDisponibles().find(x => x.codigo === c);
  return s ? s.nombre : c;
}

// Solo el analista cambia de sucursal. El resto trabaja en la suya y ni ve el
// control: un botón que no se puede usar es ruido, y uno que se puede usar sin
// querer mueve a alguien de sucursal sin que entienda qué pasó.
function puedeCambiarSucursal() {
  try { return typeof esAnalista === 'function' && esAnalista(); } catch (e) { return false; }
}

// ── El cambio ───────────────────────────────────────────────────────────
// RECARGA LA PÁGINA a propósito. Cambiar en caliente obligaría a rehacer el
// cliente de Supabase, vaciar `AppData`, tirar los índices cacheados de
// precios y volver a pedir los envíos, todo con paneles abiertos a medio
// pintar: una sola de esas cosas que quede a medias deja números de una
// sucursal en la pantalla de la otra. La recarga deja todo en un estado
// conocido, y cambiar de sucursal es algo que pasa dos veces por día.
async function cambiarSucursal(cod) {
  const destino = String(cod || '').trim();
  if (!destino || destino === sucursalActiva()) return;
  if (!puedeCambiarSucursal()) {
    alert('Solo un analista puede cambiar de sucursal.');
    return;
  }
  if (!await _sucPedirConfirmacion(destino)) return;
  try { localStorage.setItem('liq_sucursal', destino); } catch (e) {
    alert('No se pudo guardar la sucursal elegida. Revisá que el navegador ' +
      'permita guardar datos de este sitio.');
    return;
  }
  _sucRecargar();
}

// ── El aviso antes de cambiar ───────────────────────────────────────────
// Va por un modal de la app y no por el confirm() del navegador: aquel se
// titula con el dominio, no se puede dar formato y no distingue lo que hay
// que leer de lo que no. Devuelve una promesa porque un modal no frena el
// hilo como confirm; `cambiarSucursal` ya era async.
let _sucResolver = null;

function _sucPedirConfirmacion(destino) {
  const bd = document.getElementById('modal-sucursal-backdrop');
  // Si el modal no esta en el DOM —los parciales se inyectan en runtime y
  // uno puede no haber cargado— se cae al confirm del navegador. Es feo, pero
  // dejar al analista sin ninguna forma de cambiar de sucursal es peor.
  if (!bd) {
    return Promise.resolve(confirm('¿Pasar a ' + sucursalNombre(destino) + '?\n\n' +
      'Se recarga la app con los datos de esa sucursal. Lo que tengas a medio ' +
      'cargar en esta pantalla se pierde.'));
  }
  // Ya hay uno abierto (doble clic en el chip): no se abre otro, porque el
  // segundo pisaria al primero y esa promesa quedaria colgada para siempre.
  if (_sucResolver) return Promise.resolve(false);

  const nom = sucursalNombre(destino);
  const pon = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  pon('msuc-de', sucursalNombre(sucursalActiva()));
  pon('msuc-a', nom); pon('msuc-a2', nom); pon('msuc-a3', nom);
  bd.style.display = 'flex';
  document.addEventListener('keydown', _sucTecla);
  const ok = document.getElementById('msuc-ok');
  if (ok) { try { ok.focus(); } catch (e) {} }
  return new Promise(res => { _sucResolver = res; });
}

function _sucTecla(ev) { if (ev && ev.key === 'Escape') _sucCerrarModal(); }

function _sucTerminar(valor) {
  const bd = document.getElementById('modal-sucursal-backdrop');
  if (bd) bd.style.display = 'none';
  document.removeEventListener('keydown', _sucTecla);
  const r = _sucResolver; _sucResolver = null;
  if (r) r(valor);
}

// Cancelar es lo que pasa por defecto: la ✕, el fondo, Escape y el boton.
function _sucCerrarModal(e) {
  if (e && e.target && e.target.id !== 'modal-sucursal-backdrop') return;
  _sucTerminar(false);
}
function _sucConfirmarModal() { _sucTerminar(true); }

// La recarga sale por una DECLARACION de funcion global a proposito: el banco
// la reemplaza en window para poder verificar que cambiar de sucursal recarga
// —espiar location.reload no se puede, el navegador lo protege— y sin esa
// costura el caso no se puede probar y la prueba pasa sin probar nada.
function _sucRecargar() { location.reload(); }

// ── Asignar un cliente o un conductor a OTRA sucursal ───────────────────
// El import entra siempre por Buenos Aires y reparte cada envío a la sucursal
// de SU cliente, así que esto es lo que hace que ese reparto tenga de dónde
// leer: mientras el cliente no esté asignado, sus envíos caen en Buenos Aires.
//
// ARRASTRA EL HISTORIAL. Lo decidió el negocio: la asignación va antes de la
// primera liquidación, y si se asignó mal, la reasignación se lleva todo.
// Media mudanza es peor que ninguna — lo que quede en la boca vieja no lo ve
// ninguno de los dos lados.
let _asigCtx = null;

function puedeAsignarSucursal() { return puedeCambiarSucursal(); }

function abrirAsignarSucursal(tipo, clave, nombre) {
  if (!puedeAsignarSucursal()) { alert('Solo un analista puede asignar a otra sucursal.'); return; }
  const otras = sucursalesDisponibles().filter(s => s.codigo !== sucursalActiva());
  if (!otras.length) { alert('No hay otra sucursal a la que asignar.'); return; }
  _asigCtx = { tipo: tipo, clave: clave, nombre: nombre, destino: otras[0].codigo };

  const bd = document.getElementById('modal-asignar-suc-backdrop');
  if (!bd) { alert('No se pudo abrir la ventana de asignación.'); return; }
  const pon = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  pon('masig-quien', nombre);
  pon('masig-tipo', tipo === 'cliente' ? 'Cliente' : (tipo === 'empleado' ? 'Empleado' : 'Conductor'));
  pon('masig-desde', sucursalNombre(sucursalActiva()));

  const sel = document.getElementById('masig-destino');
  if (sel) {
    sel.innerHTML = otras.map(s => '<option value="' + jsAttr(s.codigo) + '">' + jsAttr(s.nombre) + '</option>').join('');
    sel.onchange = () => { _asigCtx.destino = sel.value; _asigPintarAviso(); };
  }
  _asigPintarAviso();
  bd.style.display = 'flex';
}

// Lo que se lleva puesto, dicho antes de apretar. Si el cliente ya tiene
// liquidaciones CERRADAS no se bloquea —el negocio dijo que una asignación
// equivocada se corrige y arrastra todo— pero se avisa fuerte: esas
// liquidaciones cambian de sucursal y con ellas el total de cada boca.
function _asigPintarAviso() {
  const c = _asigCtx; if (!c) return;
  const e = document.getElementById('masig-aviso'); if (!e) return;
  const cerradas = _asigCerradas(c);
  e.innerHTML =
    '<div>Se mueve <strong>' + jsAttr(c.nombre) + '</strong> y <strong>todo su historial</strong> a ' +
    '<strong>' + jsAttr(sucursalNombre(c.destino)) + '</strong>: ' +
    (c.tipo === 'cliente'
      ? 'sus envíos, su tarifario, sus cargos, sus liquidaciones y su comisión.'
      : c.tipo === 'empleado'
        ? 'sus sueldos, sus ajustes, sus bonos, sus vacaciones, sus licencias, sus horas extras y sus adelantos.'
        : 'sus envíos, sus liquidaciones, sus adelantos, sus descuentos y su Super SLA.') +
    ' Desde acá deja de verse: cada panel muestra solo el ecosistema de su sucursal.</div>' +
    (cerradas > 0
      ? '<div style="margin-top:6px;font-weight:600">⚠ Ya tiene ' + cerradas +
        (c.tipo === 'empleado'
          ? ((cerradas !== 1 ? ' meses liquidados' : ' mes liquidado') +
             ': se mueven también, así que el costo de nómina de las dos sucursales cambia ' +
             'y los cierres mensuales ya congelados dejan de cuadrar contra el plantel.')
          : ((cerradas !== 1 ? ' liquidaciones cerradas' : ' liquidación cerrada') +
             ': se mueven también, así que el total de cada sucursal cambia.')) +
        ' Lo normal es asignar ANTES de la primera liquidación.</div>'
      : '');
}

function _asigCerradas(c) {
  try {
    if (c.tipo === 'cliente') {
      return (AppData.clienteLiquidaciones || [])
        .filter(x => clienteKey(x.cliente_cod) === clienteKey(c.clave)).length;
    }
    if (c.tipo === 'empleado') {
      // Los meses que ya se le PAGARON. Mover a alguien con meses liquidados
      // cambia el costo de nómina de las dos bocas, y además los cierres
      // mensuales —que son el total congelado de la sucursal, no una fila por
      // persona, así que no se mueven— dejan de cuadrar contra el plantel.
      return (AppData.empleadoSueldos || [])
        .filter(x => String(x.empleado_id) === String(c.clave) && x.pagado).length;
    }
    return (AppData.conductorLiquidaciones || [])
      .filter(x => conductorKey(x.conductor) === conductorKey(c.clave)).length;
  } catch (e) { return 0; }
}

function cerrarAsignarSucursal(e) {
  if (e && e.target && e.target.id !== 'modal-asignar-suc-backdrop') return;
  const bd = document.getElementById('modal-asignar-suc-backdrop');
  if (bd) bd.style.display = 'none';
  _asigCtx = null;
}

async function confirmarAsignarSucursal() {
  const c = _asigCtx; if (!c) return;
  const destino = (document.getElementById('masig-destino') || {}).value || c.destino;
  const nom = sucursalNombre(destino);
  if (!confirm('¿Asignar ' + c.nombre + ' a ' + nom + '?\n\n' +
    'Se mueve con todo su historial y deja de verse desde ' +
    sucursalNombre(sucursalActiva()) + '.')) return;

  const btn = document.getElementById('masig-ok');
  if (btn) { btn.disabled = true; btn.textContent = 'Asignando…'; }
  try {
    const det = (c.tipo === 'cliente')
      ? await DB.asignarClienteASucursal(c.clave, destino)
      : c.tipo === 'empleado'
        ? await DB.asignarEmpleadoASucursal(c.clave, destino)
        : await DB.asignarConductorASucursal(c.clave, destino);
    const filas = (det || []).filter(d => (d.movidas || 0) > 0);
    const total = filas.reduce((s, d) => s + Number(d.movidas || 0), 0);
    cerrarAsignarSucursal();
    // Re-hidratar: lo movido ya no se ve desde acá y el panel tiene que
    // reflejarlo, si no queda una fila fantasma que al tocarla no existe.
    if (typeof hydrateFromSupabase === 'function') await hydrateFromSupabase();
    if (typeof rerenderPaginaActiva === 'function') rerenderPaginaActiva();
    showToast('✅ ' + c.nombre + ' pasó a ' + nom + ' · ' + total + ' fila' + (total !== 1 ? 's' : '') +
      ' movidas (' + filas.map(d => d.tabla + ' ' + d.movidas).join(', ') + ')');
  } catch (err) {
    // Un alert y no un toast: si la mudanza falló a medias hay que enterarse.
    alert('No se pudo asignar: ' + (err && (err.message || err.hint) || err));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ic ic-check"></i> Asignar'; }
  }
}

// ── El selector, arriba de todo ─────────────────────────────────────────
// Va en la cabecera del menú, pegado a la marca: es el contexto de TODO lo que
// se ve abajo, y un control de contexto escondido en una pantalla hace que el
// operador no sepa sobre qué sucursal está mirando los números.
function renderSelectorSucursal() {
  const cont = document.getElementById('suc-selector');
  if (!cont) return;
  if (!puedeCambiarSucursal()) { cont.innerHTML = ''; return; }
  const activa = sucursalActiva();
  const lista = sucursalesDisponibles();
  cont.innerHTML =
    '<div class="suc-wrap">' +
    lista.map(s =>
      '<button class="suc-btn' + (s.codigo === activa ? ' suc-activa' : '') + '"' +
      ' onclick="cambiarSucursal(\'' + jsAttr(s.codigo) + '\')"' +
      ' title="' + jsAttr(s.codigo === activa ? 'Estás trabajando en ' + s.nombre
        : 'Pasar a ' + s.nombre) + '">' +
      jsAttr(s.nombre) + '</button>').join('') +
    '</div>';
}
