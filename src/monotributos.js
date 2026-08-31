// ════════════════════════════════════════════════════════════════════════
//  MONOTRIBUTOS — el panel del TESORERO
//
//  La parte de la liquidación que se paga por TRANSFERENCIA BANCARIA es la
//  que se factura: por esa plata tiene que existir un comprobante. Y para que
//  ese comprobante exista, el conductor tiene que estar en condiciones —
//  cuenta bancaria cargada, contrato de prestación de servicios firmado y
//  monotributo activo—. Con los tres está **al día**; si falta alguno, la
//  empresa está transfiriendo contra nada.
//
//  Por eso el panel tiene dos caras: el estado de la DOCUMENTACIÓN (que es lo
//  que se reclama) y la FACTURACIÓN del mes (que es lo que se controla). Los
//  filtros de "sin contrato" y "sin monotributo" están para eso: son la lista
//  de a quién hay que ir a buscar.
//
//  Cuando la factura la emite la empresa en lugar del conductor, el tesorero
//  además tiene que emitir la factura a CONSUMIDOR FINAL. Eso se registra
//  acá con su fecha y su número: si no queda anotado, a fin de año nadie
//  puede reconstruir qué se facturó bajo esa condición.
// ════════════════════════════════════════════════════════════════════════

let monoTab = 'doc';

function switchMonoTab(tab) {
  monoTab = tab;
  ['doc', 'fact'].forEach(t => {
    const panel = document.getElementById('mono-tab-' + t);
    const btn = document.getElementById('mono-btn-' + t);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'doc') renderMonotributos(); else renderMonoFacturas();
}

function renderMonotributosPagina() {
  const m = document.getElementById('mono-mes');
  if (m && !m.value) m.value = new Date().toISOString().slice(0, 7);
  switchMonoTab(monoTab);
}

function monoMes() {
  const el = document.getElementById('mono-mes');
  if (el && !el.value) el.value = new Date().toISOString().slice(0, 7);
  return (el && el.value) || new Date().toISOString().slice(0, 7);
}

// ── Ficha fiscal ────────────────────────────────────────────────────────────
// Se ata al nombre CANÓNICO del Panel de conductores, igual que el Super SLA:
// es la identidad con la que se liquida, y un alias no puede abrir otra ficha.
function fiscalDe(conductor) {
  const k = normNombre(conductorCanonico(conductor));
  return (AppData.conductorFiscal || []).find(f => normNombre(f.conductor) === k) || null;
}
function _fiscalVacia(conductor) {
  return { conductor: conductorCanonico(conductor), cuit: '', cbu: '', alias_cbu: '', banco: '', titular: '',
           contrato_firmado: false, contrato_fecha: '', monotributo: false, monotributo_categoria: '',
           factura_la_emitimos: false, obs: '' };
}
function monoTieneCuenta(f) { return !!(f && (String(f.cbu || '').trim() || String(f.alias_cbu || '').trim())); }
// Al día = los tres requisitos. Sin cualquiera de ellos no se puede facturar
// lo que se transfiere, que es el único motivo por el que este panel existe.
function monoAlDia(f) { return !!(f && f.contrato_firmado && f.monotributo && monoTieneCuenta(f)); }

function _monoFaltantes(f) {
  const x = [];
  if (!monoTieneCuenta(f)) x.push('cuenta');
  if (!f || !f.contrato_firmado) x.push('contrato');
  if (!f || !f.monotributo) x.push('monotributo');
  return x;
}

// Los conductores del Panel: son los que liquidan, y por lo tanto los únicos a
// los que se les transfiere. Un cadete que no está en el Panel no cobra.
function monoConductores() {
  return (AppData.panelConductores || [])
    .map(c => String(c.nombre || '').trim()).filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function renderMonotributos() {
  const cont = document.getElementById('mono-rows');
  if (!cont) return;
  const q = (document.getElementById('mono-search')?.value || '').toLowerCase().trim();
  const filtro = (document.getElementById('mono-filtro')?.value || 'todos');

  const todos = monoConductores().map(nombre => ({ nombre, f: fiscalDe(nombre) }));

  // Resumen: lo primero que mira el tesorero es cuántos puede facturar.
  const alDia = todos.filter(x => monoAlDia(x.f)).length;
  const sinContrato = todos.filter(x => !x.f || !x.f.contrato_firmado).length;
  const sinMono = todos.filter(x => !x.f || !x.f.monotributo).length;
  const sinCuenta = todos.filter(x => !monoTieneCuenta(x.f)).length;
  const res = document.getElementById('mono-resumen');
  if (res) res.innerHTML =
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-check-circle"></i></div>' +
      '<div class="metric-label">Documentación al día</div><div class="metric-value">' + alDia + '</div>' +
      '<div class="metric-sub">de ' + todos.length + ' conductores</div></div>' +
    '<div class="metric-card"' + (sinContrato ? ' style="border-color:#f5d97a"' : '') + '><div class="metric-ic"><i class="ic ic-file"></i></div>' +
      '<div class="metric-label">Sin contrato firmado</div><div class="metric-value"' + (sinContrato ? ' style="color:#b45309"' : '') + '>' + sinContrato + '</div>' +
      '<div class="metric-sub">prestación de servicios</div></div>' +
    '<div class="metric-card"' + (sinMono ? ' style="border-color:#f5d97a"' : '') + '><div class="metric-ic"><i class="ic ic-receipt"></i></div>' +
      '<div class="metric-label">Sin monotributo</div><div class="metric-value"' + (sinMono ? ' style="color:#b45309"' : '') + '>' + sinMono + '</div>' +
      '<div class="metric-sub">no pueden facturar</div></div>' +
    '<div class="metric-card"' + (sinCuenta ? ' style="border-color:#fca5a5"' : '') + '><div class="metric-ic"><i class="ic ic-card"></i></div>' +
      '<div class="metric-label">Sin cuenta cargada</div><div class="metric-value"' + (sinCuenta ? ' style="color:#b91c1c"' : '') + '>' + sinCuenta + '</div>' +
      '<div class="metric-sub">no se les puede transferir</div></div>';

  const avi = document.getElementById('mono-aviso');
  if (avi) avi.innerHTML = (sinContrato || sinMono)
    ? '<div class="alert" style="margin:0 0 12px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d">' +
      '<i class="ic ic-alert"></i><div><strong>' + (sinContrato + sinMono > 0 ? '' : '') +
      'Hay documentación pendiente.</strong> ' +
      (sinContrato ? sinContrato + ' sin contrato de prestación de servicios' : '') +
      (sinContrato && sinMono ? ' y ' : '') +
      (sinMono ? sinMono + ' sin monotributo' : '') +
      '. Lo que se les transfiere se está pagando sin comprobante que lo respalde — usá los filtros para ver a quiénes hay que reclamarles.</div></div>'
    : '';

  let lista = todos.filter(x => !q ||
    x.nombre.toLowerCase().includes(q) ||
    String(x.f && x.f.cuit || '').toLowerCase().includes(q) ||
    String(x.f && x.f.banco || '').toLowerCase().includes(q));
  if (filtro === 'al_dia') lista = lista.filter(x => monoAlDia(x.f));
  else if (filtro === 'sin_contrato') lista = lista.filter(x => !x.f || !x.f.contrato_firmado);
  else if (filtro === 'sin_mono') lista = lista.filter(x => !x.f || !x.f.monotributo);
  else if (filtro === 'sin_cuenta') lista = lista.filter(x => !monoTieneCuenta(x.f));
  else if (filtro === 'incompletos') lista = lista.filter(x => !monoAlDia(x.f));

  const cnt = document.getElementById('mono-count');
  if (cnt) cnt.textContent = lista.length + ' de ' + todos.length + ' conductores' +
    (filtro !== 'todos' ? ' · filtrado' : '');

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:34px">' +
      '<div class="empty-icon"><i class="ic ic-users"></i></div>' +
      '<div class="empty-title">' + (todos.length ? 'Ningún conductor coincide' : 'Sin conductores en el Panel') + '</div>' +
      '<div class="empty-sub">' + (todos.length ? 'Probá con otro texto o quitá el filtro' : 'Se cargan en Panel de conductores') + '</div>' +
      '</div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(({ nombre, f }) => {
    const falta = _monoFaltantes(f);
    const okChip = (ok, txtOk, txtNo, det) =>
      ok ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ ' + txtOk + '</span>' +
           (det ? '<div class="muted" style="font-size:10px;margin-top:2px">' + det + '</div>' : '')
         : '<span class="badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5">' + txtNo + '</span>';
    const cuenta = monoTieneCuenta(f)
      ? '<div style="font-size:11.5px">' + (f.banco || 'sin banco') +
        (f.alias_cbu ? '<div class="mono" style="font-size:10.5px;color:var(--text-muted)">' + f.alias_cbu + '</div>' : '') +
        (f.cbu ? '<div class="mono" style="font-size:10px;color:var(--text-muted)">CBU ' + f.cbu + '</div>' : '') +
        (f.titular && normNombre(f.titular) !== normNombre(nombre)
          ? '<div style="font-size:10px;color:#b45309">titular: ' + f.titular + '</div>' : '') + '</div>'
      : '<span class="badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5">Sin cuenta</span>';

    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(nombre) + ';width:26px;height:26px;font-size:9px">' + initials(nombre) + '</div>' +
        '<div><strong>' + nombre + '</strong>' +
        (f && f.factura_la_emitimos ? '<div><span class="tag" style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;font-size:9.5px" title="La factura de este conductor la emite la empresa">factura la emitimos nosotros</span></div>' : '') +
        '</div></div></td>' +
      '<td class="mono" style="font-size:11.5px">' + ((f && f.cuit) || '<span class="muted">—</span>') + '</td>' +
      '<td>' + cuenta + '</td>' +
      '<td>' + okChip(f && f.contrato_firmado, 'Firmado', 'Sin firmar',
        (f && f.contrato_fecha) ? _monoFmt(f.contrato_fecha) : '') + '</td>' +
      '<td>' + okChip(f && f.monotributo, 'Activo', 'Sin monotributo',
        (f && f.monotributo_categoria) ? 'categoría ' + f.monotributo_categoria : '') + '</td>' +
      '<td>' + (monoAlDia(f)
        ? '<span class="badge" style="background:#dcfce7;color:#166534">✓ Al día</span>'
        : '<span class="badge" style="background:#fffbeb;color:#92400e;border:1px solid #fcd34d" title="Falta: ' + falta.join(', ') + '">Falta ' + falta.join(' · ') + '</span>') + '</td>' +
      '<td style="text-align:right"><button class="btn btn-sm" onclick="abrirFichaFiscal(' + JSON.stringify(nombre).replace(/"/g, '&quot;') + ')"><i class="ic ic-edit"></i> Editar</button></td>' +
    '</tr>';
  }).join('');
}

function _monoFmt(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
}

// ── Ficha fiscal: alta / edición ────────────────────────────────────────────
let _fiscalEditando = '';

function abrirFichaFiscal(conductor) {
  const nombre = conductorCanonico(conductor);
  _fiscalEditando = nombre;
  const f = fiscalDe(nombre) || _fiscalVacia(nombre);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
  const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  document.getElementById('mfis-titulo').textContent = nombre;
  set('mfis-cuit', f.cuit); set('mfis-banco', f.banco); set('mfis-cbu', f.cbu);
  set('mfis-alias', f.alias_cbu); set('mfis-titular', f.titular);
  chk('mfis-contrato', f.contrato_firmado); set('mfis-contrato-fecha', String(f.contrato_fecha || '').slice(0, 10));
  chk('mfis-mono', f.monotributo); set('mfis-mono-cat', f.monotributo_categoria);
  chk('mfis-emitimos', f.factura_la_emitimos);
  set('mfis-obs', f.obs);
  recalcFichaFiscal();
  document.getElementById('modal-fiscal-backdrop').style.display = 'flex';
}

function cerrarFichaFiscal(ev) {
  if (!ev || ev.target.id === 'modal-fiscal-backdrop') {
    document.getElementById('modal-fiscal-backdrop').style.display = 'none';
    _fiscalEditando = '';
  }
}

// Anticipa si con lo cargado queda al día: es la única pregunta que importa.
function recalcFichaFiscal() {
  const box = document.getElementById('mfis-estado');
  if (!box) return;
  const f = _leerFichaFiscal();
  const falta = _monoFaltantes(f);
  box.innerHTML = falta.length
    ? '<span style="color:#b45309">Con esto <strong>no queda al día</strong>: falta ' + falta.join(', ') + '. ' +
      'Lo que se le transfiera no va a tener comprobante que lo respalde.</span>'
    : '<span style="color:#166534">✓ Queda <strong>al día</strong>: se le puede transferir y facturar.</span>';
  const fc = document.getElementById('mfis-contrato-fecha');
  if (fc) fc.disabled = !document.getElementById('mfis-contrato')?.checked;
  const mc = document.getElementById('mfis-mono-cat');
  if (mc) mc.disabled = !document.getElementById('mfis-mono')?.checked;
}

function _leerFichaFiscal() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const chk = id => !!document.getElementById(id)?.checked;
  return {
    conductor: _fiscalEditando,
    cuit: val('mfis-cuit'), banco: val('mfis-banco'), cbu: val('mfis-cbu'),
    alias_cbu: val('mfis-alias'), titular: val('mfis-titular'),
    contrato_firmado: chk('mfis-contrato'),
    contrato_fecha: chk('mfis-contrato') ? (val('mfis-contrato-fecha') || null) : null,
    monotributo: chk('mfis-mono'),
    monotributo_categoria: chk('mfis-mono') ? val('mfis-mono-cat') : '',
    factura_la_emitimos: chk('mfis-emitimos'),
    obs: val('mfis-obs')
  };
}

async function guardarFichaFiscal() {
  if (!_fiscalEditando) return;
  const rec = _leerFichaFiscal();
  const existente = fiscalDe(_fiscalEditando);
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    if (existente && existente.id != null) {
      await DB.updateWhere('conductor_fiscal', 'id', existente.id, rec);
      Object.assign(existente, rec);
    } else {
      const row = await DB.insertRow('conductor_fiscal', rec);
      AppData.conductorFiscal.push(Object.assign({ id: row && row.id }, rec));
    }
    persistirMonotributosLocal();
    document.getElementById('modal-fiscal-backdrop').style.display = 'none';
    const nombre = _fiscalEditando; _fiscalEditando = '';
    renderMonotributos();
    showToast(monoAlDia(fiscalDe(nombre)) ? '✅ ' + nombre + ' · documentación al día' : '✅ Ficha guardada — todavía falta documentación');
  } catch (e) { console.warn('guardarFichaFiscal', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

// ════════════════════════════════════════════════════════════════════════
//  FACTURACIÓN DEL MES
// ════════════════════════════════════════════════════════════════════════
function facturasDelMes(periodo) {
  const p = String(periodo || '').slice(0, 7);
  return (AppData.conductorFacturas || [])
    .filter(x => String(x.periodo).slice(0, 7) === p)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) ||
                    String(a.conductor).localeCompare(String(b.conductor)));
}

// Estado de un registro: qué le falta para estar cerrado.
//   pendiente        → todavía no hay comprobante
//   falta_cf         → la emitimos nosotros y falta la de consumidor final
//   completa         → nada pendiente
function estadoFactura(x) {
  if (!x.factura_recibida) return 'pendiente';
  if (x.origen === 'nosotros' && !x.cf_emitida) return 'falta_cf';
  return 'completa';
}
const MONO_ESTADOS = {
  pendiente: { label: 'Sin factura', bg: '#fef2f2', color: '#b91c1c', borde: '#fca5a5' },
  falta_cf:  { label: 'Falta consumidor final', bg: '#fffbeb', color: '#92400e', borde: '#fcd34d' },
  completa:  { label: '✓ Completa', bg: '#dcfce7', color: '#166534', borde: '#bbf7d0' },
};

function renderMonoFacturas() {
  const cont = document.getElementById('mono-fact-rows');
  if (!cont) return;
  const periodo = monoMes();
  const q = (document.getElementById('mono-fact-search')?.value || '').toLowerCase().trim();
  const filtro = document.getElementById('mono-fact-filtro')?.value || 'todos';
  const todas = facturasDelMes(periodo);

  const totTransf = todas.reduce((s, x) => s + _num(x.monto_transferencia), 0);
  const sinFact = todas.filter(x => estadoFactura(x) === 'pendiente');
  const nuestras = todas.filter(x => x.origen === 'nosotros');
  const sinCF = nuestras.filter(x => !x.cf_emitida);

  const res = document.getElementById('mono-fact-resumen');
  if (res) res.innerHTML =
    '<div class="metric-card accent"><div class="metric-ic"><i class="ic ic-card"></i></div>' +
      '<div class="metric-label">Transferido en el mes</div><div class="metric-value">' + fmtPeso(totTransf) + '</div>' +
      '<div class="metric-sub">' + todas.length + ' registro(s) · esto es lo que se factura</div></div>' +
    '<div class="metric-card"' + (sinFact.length ? ' style="border-color:#fca5a5"' : '') + '><div class="metric-ic"><i class="ic ic-alert"></i></div>' +
      '<div class="metric-label">Sin factura</div><div class="metric-value"' + (sinFact.length ? ' style="color:#b91c1c"' : '') + '>' + sinFact.length + '</div>' +
      '<div class="metric-sub">' + fmtPeso(sinFact.reduce((s, x) => s + _num(x.monto_transferencia), 0)) + ' sin respaldo</div></div>' +
    '<div class="metric-card"><div class="metric-ic"><i class="ic ic-receipt"></i></div>' +
      '<div class="metric-label">Las emitimos nosotros</div><div class="metric-value">' + nuestras.length + '</div>' +
      '<div class="metric-sub">' + fmtPeso(nuestras.reduce((s, x) => s + _num(x.monto_transferencia), 0)) + '</div></div>' +
    '<div class="metric-card"' + (sinCF.length ? ' style="border-color:#f5d97a"' : '') + '><div class="metric-ic"><i class="ic ic-file"></i></div>' +
      '<div class="metric-label">Falta consumidor final</div><div class="metric-value"' + (sinCF.length ? ' style="color:#b45309"' : '') + '>' + sinCF.length + '</div>' +
      '<div class="metric-sub">de las que emitimos nosotros</div></div>';

  const avi = document.getElementById('mono-fact-aviso');
  if (avi) avi.innerHTML = sinCF.length
    ? '<div class="alert" style="margin:0 0 12px;background:#fffbeb;color:#92400e;border:1px solid #fcd34d">' +
      '<i class="ic ic-receipt"></i><div><strong>' + sinCF.length + ' factura(s) que emitimos nosotros no tienen su factura a consumidor final.</strong> ' +
      'Cuando la factura del conductor la hace la empresa, el tesorero tiene que emitir además la de consumidor final y registrarla acá con su fecha: ' +
      sinCF.slice(0, 6).map(x => x.conductor).join(' · ') + (sinCF.length > 6 ? ' …y ' + (sinCF.length - 6) + ' más' : '') +
      '</div></div>'
    : '';

  let lista = todas.filter(x => !q || String(x.conductor).toLowerCase().includes(q));
  if (filtro === 'sin_factura') lista = lista.filter(x => estadoFactura(x) === 'pendiente');
  else if (filtro === 'nosotros') lista = lista.filter(x => x.origen === 'nosotros');
  else if (filtro === 'sin_cf') lista = lista.filter(x => x.origen === 'nosotros' && !x.cf_emitida);

  const cnt = document.getElementById('mono-fact-count');
  if (cnt) cnt.textContent = lista.length + ' de ' + todas.length + ' registro(s) en ' + _monoMesTxt(periodo);

  if (!lista.length) {
    cont.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:34px">' +
      '<div class="empty-icon"><i class="ic ic-receipt"></i></div>' +
      '<div class="empty-title">' + (todas.length ? 'Nada coincide con el filtro' : 'Sin transferencias registradas en ' + _monoMesTxt(periodo)) + '</div>' +
      '<div class="empty-sub">' + (todas.length ? 'Probá con otro filtro' : 'Cargá con "Registrar transferencia" lo que se pagó por banco') + '</div>' +
      '</div></td></tr>';
    return;
  }

  cont.innerHTML = lista.map(x => {
    const est = MONO_ESTADOS[estadoFactura(x)];
    const f = fiscalDe(x.conductor);
    return '<tr>' +
      '<td><div class="conductor-cell"><div class="conductor-avatar" style="background:' + avatarColor(x.conductor) + ';width:26px;height:26px;font-size:9px">' + initials(x.conductor) + '</div>' +
        '<div><strong>' + x.conductor + '</strong>' +
        (monoAlDia(f) ? '' : '<div><span class="tag" style="background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;font-size:9.5px" title="Falta ' + _monoFaltantes(f).join(', ') + '">documentación incompleta</span></div>') +
        '</div></div></td>' +
      '<td class="mono" style="font-size:11.5px">' + (_monoFmt(x.fecha) || '<span class="muted">—</span>') + '</td>' +
      '<td class="mono" style="text-align:right;font-weight:700">' + fmtPeso(_num(x.monto_transferencia)) + '</td>' +
      '<td style="font-size:11.5px">' +
        '<span class="tag" style="background:' + (x.origen === 'nosotros' ? '#eff6ff;color:#1e40af;border:1px solid #bfdbfe' : '#f5f3ff;color:#5b21b6;border:1px solid #ddd6fe') + ';font-size:9.5px">' +
        (x.origen === 'nosotros' ? 'la emitimos nosotros' : 'la emite el conductor') + '</span>' +
        (x.factura_recibida
          ? '<div style="margin-top:2px">' + (x.factura_nro ? 'N° ' + x.factura_nro + ' · ' : '') + (_monoFmt(x.factura_fecha) || 'sin fecha') + '</div>'
          : '<div style="margin-top:2px;color:#b91c1c">no está</div>') + '</td>' +
      '<td style="font-size:11.5px">' + (x.origen !== 'nosotros'
          ? '<span class="muted">no corresponde</span>'
          : (x.cf_emitida
              ? '<span style="color:#166534">✓ ' + (x.cf_nro ? 'N° ' + x.cf_nro + ' · ' : '') + (_monoFmt(x.cf_fecha) || 'sin fecha') + '</span>' +
                (_num(x.cf_monto) ? '<div class="muted" style="font-size:10px">' + fmtPeso(_num(x.cf_monto)) + '</div>' : '')
              : '<span style="color:#b45309">pendiente</span>')) + '</td>' +
      '<td><span class="badge" style="background:' + est.bg + ';color:' + est.color + ';border:1px solid ' + est.borde + '">' + est.label + '</span>' +
        (x.obs ? '<div class="muted" style="font-size:10px">' + x.obs + '</div>' : '') + '</td>' +
      '<td><div style="display:flex;gap:4px;justify-content:flex-end">' +
        '<button class="btn btn-sm" onclick="abrirMonoFactura(' + x.id + ')"><i class="ic ic-edit"></i></button>' +
        '<button class="btn btn-sm" style="border-color:#fca5a5;color:#b91c1c" onclick="borrarMonoFactura(' + x.id + ')"><i class="ic ic-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

const _MONO_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function _monoMesTxt(p) {
  const x = String(p || '').split('-');
  if (x.length < 2) return p || '—';
  return _MONO_MESES[(+x[1]) - 1] + ' ' + x[0];
}

// ── Alta / edición de un registro de facturación ────────────────────────────
let _monoFactEdit = null;

function abrirMonoFactura(id) {
  const x = id != null ? (AppData.conductorFacturas || []).find(r => r.id === id) : null;
  _monoFactEdit = x ? x.id : null;
  const periodo = monoMes();
  const sel = document.getElementById('mfac-conductor');
  if (sel) {
    const lista = monoConductores();
    let html = '<option value="">— Elegí un conductor —</option>' +
      lista.map(n => '<option value="' + n.replace(/"/g, '&quot;') + '">' + n +
        (monoAlDia(fiscalDe(n)) ? '' : ' · documentación incompleta') + '</option>').join('');
    // Un registro viejo de alguien que ya no está en el Panel se conserva.
    if (x && !lista.some(n => normNombre(n) === normNombre(x.conductor))) {
      html += '<option value="' + String(x.conductor).replace(/"/g, '&quot;') + '">' + x.conductor + ' (fuera del panel)</option>';
    }
    sel.innerHTML = html;
    sel.value = x ? x.conductor : '';
  }
  const set = (i, v) => { const el = document.getElementById(i); if (el) el.value = v == null ? '' : v; };
  const chk = (i, v) => { const el = document.getElementById(i); if (el) el.checked = !!v; };
  set('mfac-fecha', x ? String(x.fecha || '').slice(0, 10) : (periodo + '-01'));
  set('mfac-monto', x ? _num(x.monto_transferencia) : '');
  set('mfac-origen', x ? x.origen : 'conductor');
  chk('mfac-recibida', x ? x.factura_recibida : false);
  set('mfac-fact-fecha', x ? String(x.factura_fecha || '').slice(0, 10) : '');
  set('mfac-fact-nro', x ? x.factura_nro : '');
  chk('mfac-cf', x ? x.cf_emitida : false);
  set('mfac-cf-fecha', x ? String(x.cf_fecha || '').slice(0, 10) : '');
  set('mfac-cf-nro', x ? x.cf_nro : '');
  set('mfac-cf-monto', x ? (_num(x.cf_monto) || '') : '');
  set('mfac-obs', x ? x.obs : '');
  document.getElementById('modal-mfac-title').textContent = x ? 'Editar registro' : 'Registrar transferencia';
  recalcMonoFactura();
  document.getElementById('modal-mfac-backdrop').style.display = 'flex';
}

function cerrarMonoFactura(ev) {
  if (!ev || ev.target.id === 'modal-mfac-backdrop') {
    document.getElementById('modal-mfac-backdrop').style.display = 'none';
    _monoFactEdit = null;
  }
}

// El bloque de consumidor final solo tiene sentido si la factura la emitimos
// nosotros: mostrarlo siempre invitaría a cargarlo cuando no corresponde.
function recalcMonoFactura() {
  const origen = document.getElementById('mfac-origen')?.value || 'conductor';
  const recibida = !!document.getElementById('mfac-recibida')?.checked;
  const cf = !!document.getElementById('mfac-cf')?.checked;
  const boxCF = document.getElementById('mfac-cf-box');
  if (boxCF) boxCF.style.display = origen === 'nosotros' ? '' : 'none';
  ['mfac-fact-fecha', 'mfac-fact-nro'].forEach(i => { const el = document.getElementById(i); if (el) el.disabled = !recibida; });
  ['mfac-cf-fecha', 'mfac-cf-nro', 'mfac-cf-monto'].forEach(i => { const el = document.getElementById(i); if (el) el.disabled = !cf; });

  const lbl = document.getElementById('mfac-recibida-lbl');
  if (lbl) lbl.textContent = origen === 'nosotros' ? 'Ya emitimos la factura' : 'El conductor mandó la factura';

  const cond = document.getElementById('mfac-conductor')?.value || '';
  const f = cond ? fiscalDe(cond) : null;
  const avi = document.getElementById('mfac-aviso');
  if (avi) {
    const falta = cond ? _monoFaltantes(f) : [];
    avi.innerHTML = !cond ? ''
      : (falta.length
        ? '<span style="color:#b45309">' + cond + ' tiene documentación pendiente (' + falta.join(', ') + '). ' +
          'Se puede registrar igual, pero esa transferencia queda sin respaldo.</span>'
        : '<span style="color:#166534">' + cond + ' está al día: cuenta, contrato y monotributo.</span>');
  }
  const est = document.getElementById('mfac-estado');
  if (est) {
    const e = estadoFactura({ factura_recibida: recibida, origen, cf_emitida: cf });
    const m = MONO_ESTADOS[e];
    est.innerHTML = 'Queda como <span class="badge" style="background:' + m.bg + ';color:' + m.color + ';border:1px solid ' + m.borde + '">' + m.label + '</span>' +
      (e === 'falta_cf' ? ' <span class="muted">— falta emitir la factura a consumidor final</span>' : '');
  }
}

async function guardarMonoFactura() {
  const conductor = (document.getElementById('mfac-conductor')?.value || '').trim();
  const fecha = document.getElementById('mfac-fecha')?.value || '';
  const monto = parseFloat(document.getElementById('mfac-monto')?.value) || 0;
  if (!conductor) { alert('Elegí el conductor.'); return; }
  if (!fecha) { alert('Cargá la fecha de la transferencia.'); return; }
  if (!(monto > 0)) { alert('Cargá cuánto se transfirió: es el monto que se factura.'); return; }
  const origen = document.getElementById('mfac-origen')?.value || 'conductor';
  const recibida = !!document.getElementById('mfac-recibida')?.checked;
  const cf = origen === 'nosotros' && !!document.getElementById('mfac-cf')?.checked;
  const val = i => (document.getElementById(i)?.value || '').trim();
  const rec = {
    conductor: conductorCanonico(conductor),
    periodo: String(fecha).slice(0, 7),
    fecha,
    monto_transferencia: monto,
    origen: origen === 'nosotros' ? 'nosotros' : 'conductor',
    factura_recibida: recibida,
    factura_fecha: recibida ? (val('mfac-fact-fecha') || null) : null,
    factura_nro: recibida ? val('mfac-fact-nro') : '',
    cf_emitida: cf,
    cf_fecha: cf ? (val('mfac-cf-fecha') || null) : null,
    cf_nro: cf ? val('mfac-cf-nro') : '',
    cf_monto: cf ? (parseFloat(val('mfac-cf-monto')) || 0) : 0,
    obs: val('mfac-obs'),
    creado_por: (typeof currentUser !== 'undefined' && currentUser && (currentUser.nombre || currentUser.usuario)) || ''
  };
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    if (_monoFactEdit != null) {
      await DB.updateWhere('conductor_facturas', 'id', _monoFactEdit, rec);
      const x = AppData.conductorFacturas.find(r => r.id === _monoFactEdit);
      if (x) Object.assign(x, rec);
    } else {
      const row = await DB.insertRow('conductor_facturas', rec);
      AppData.conductorFacturas.push(Object.assign({ id: row && row.id }, rec));
    }
    persistirMonotributosLocal();
    document.getElementById('modal-mfac-backdrop').style.display = 'none';
    _monoFactEdit = null;
    // Si el registro cayó en otro mes que el que se está mirando, se avisa: si
    // no, el operador guarda y no ve nada aparecer.
    const mesVisto = monoMes();
    renderMonoFacturas();
    showToast(rec.periodo === mesVisto
      ? '✅ Transferencia registrada · ' + fmtPeso(monto)
      : '✅ Registrada en ' + _monoMesTxt(rec.periodo) + ' — cambiá el mes para verla');
  } catch (e) { console.warn('guardarMonoFactura', e); alert('No se pudo guardar: ' + (e.message || e)); }
}

async function borrarMonoFactura(id) {
  const x = (AppData.conductorFacturas || []).find(r => r.id === id);
  if (!x) return;
  if (!confirm('¿Borrar el registro de ' + x.conductor + ' del ' + (_monoFmt(x.fecha) || x.periodo) +
    ' por ' + fmtPeso(_num(x.monto_transferencia)) + '?')) return;
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    await DB.deleteWhere('conductor_facturas', 'id', id);
    AppData.conductorFacturas = AppData.conductorFacturas.filter(r => r.id !== id);
    persistirMonotributosLocal();
    renderMonoFacturas();
    showToast('Registro borrado');
  } catch (e) { console.warn('borrarMonoFactura', e); alert('No se pudo borrar: ' + (e.message || e)); }
}

function persistirMonotributosLocal() {
  try {
    localStorage.setItem('liq_conductor_fiscal', JSON.stringify(AppData.conductorFiscal));
    localStorage.setItem('liq_conductor_facturas', JSON.stringify(AppData.conductorFacturas));
  } catch (e) {}
}

// ── PDF de control del mes ──────────────────────────────────────────────────
// Es el papel con el que el tesorero cierra: quién está al día, cuánto se
// transfirió y qué comprobante falta.
function exportMonotributosPDF() {
  const periodo = monoMes();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const L = 14, R = 196;

  try { doc.addImage(MARCA.logo, 'PNG', L, 12, 40, 40 / MARCA.logoRatio); } catch (e) {}
  doc.setTextColor(MARCA.navy[0], MARCA.navy[1], MARCA.navy[2]);
  doc.setFont(undefined, 'bold'); doc.setFontSize(12.5);
  doc.text('MONOTRIBUTOS · CONTROL DE FACTURACIÓN', R, 16.5, { align: 'right' });
  doc.setFont(undefined, 'normal'); doc.setFontSize(8);
  doc.setTextColor(MARCA.gris[0], MARCA.gris[1], MARCA.gris[2]);
  doc.text(_monoMesTxt(periodo), R, 21.5, { align: 'right' });
  doc.text('Emitido el ' + _monoFmt(new Date().toISOString()), R, 25.5, { align: 'right' });
  doc.setFillColor(MARCA.navy[0], MARCA.navy[1], MARCA.navy[2]); doc.rect(L, 29.5, R - L, 1.1, 'F');
  doc.setFillColor(MARCA.azul[0], MARCA.azul[1], MARCA.azul[2]); doc.rect(L, 29.5, 42, 1.1, 'F');

  const conductores = monoConductores().map(n => ({ n, f: fiscalDe(n) }));
  doc.autoTable({
    startY: 38,
    head: [['Conductor', 'CUIT', 'Cuenta', 'Contrato', 'Monotributo', 'Estado']],
    body: conductores.map(({ n, f }) => [
      n, (f && f.cuit) || '—',
      monoTieneCuenta(f) ? ((f.banco || '') + (f.alias_cbu ? ' · ' + f.alias_cbu : '')) : 'sin cuenta',
      (f && f.contrato_firmado) ? ('Firmado' + (f.contrato_fecha ? ' ' + _monoFmt(f.contrato_fecha) : '')) : 'Sin firmar',
      (f && f.monotributo) ? ('Activo' + (f.monotributo_categoria ? ' · cat. ' + f.monotributo_categoria : '')) : 'Sin monotributo',
      monoAlDia(f) ? 'Al día' : ('Falta ' + _monoFaltantes(f).join(', '))
    ]),
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineWidth: 0 },
    headStyles: { fillColor: MARCA.navy, textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
    bodyStyles: { textColor: MARCA.texto },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    margin: { left: L, right: L, bottom: 22 }
  });

  const facts = facturasDelMes(periodo);
  if (facts.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [['Transferencias de ' + _monoMesTxt(periodo), 'Fecha', 'Monto', 'Factura', 'Cons. final']],
      body: facts.map(x => [
        x.conductor, _monoFmt(x.fecha) || '—', fmtPeso(_num(x.monto_transferencia)),
        (x.origen === 'nosotros' ? 'La emitimos: ' : 'Del conductor: ') +
          (x.factura_recibida ? ((x.factura_nro ? 'N° ' + x.factura_nro + ' ' : '') + (_monoFmt(x.factura_fecha) || '')) : 'NO'),
        x.origen !== 'nosotros' ? '—' : (x.cf_emitida ? ((x.cf_nro ? 'N° ' + x.cf_nro + ' ' : '') + (_monoFmt(x.cf_fecha) || '')) : 'PENDIENTE')
      ]),
      foot: [[{ content: 'Total transferido', colSpan: 2, styles: { halign: 'right' } },
              fmtPeso(facts.reduce((s, x) => s + _num(x.monto_transferencia), 0)), '', '']],
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineWidth: 0 },
      headStyles: { fillColor: MARCA.azul, textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
      footStyles: { fillColor: MARCA.navy, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { textColor: MARCA.texto },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      columnStyles: { 2: { halign: 'right', fontStyle: 'bold' } },
      margin: { left: L, right: L, bottom: 22 }
    });
  }

  // Pie con el emisor en todas las hojas.
  const n = doc.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(MARCA.linea[0], MARCA.linea[1], MARCA.linea[2]); doc.setLineWidth(0.2);
    doc.line(L, 277, R, 277);
    doc.setFont(undefined, 'bold'); doc.setFontSize(7);
    doc.setTextColor(MARCA.navy[0], MARCA.navy[1], MARCA.navy[2]);
    const fis = (typeof empresaLineaFiscal === 'function') ? empresaLineaFiscal() : '';
    if (fis) doc.text(doc.splitTextToSize(fis, 140)[0], L, 281.5);
    doc.setFont(undefined, 'normal'); doc.setFontSize(6.5);
    doc.setTextColor(MARCA.gris[0], MARCA.gris[1], MARCA.gris[2]);
    doc.text('Documento interno de control. No válido como comprobante fiscal.', L, 285);
    doc.setFontSize(7.5);
    doc.text('Página ' + p + ' de ' + n, R, 281.5, { align: 'right' });
  }
  doc.save('Monotributos_' + periodo + '.pdf');
  return doc;
}
