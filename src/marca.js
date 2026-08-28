// ════════════════════════════════════════════════════════════════════════
//  MARCA — la identidad visual de Logística Hogareño, para los documentos
//  que SALEN de la app hacia afuera. Hoy es uno solo: la liquidación del
//  cliente, que se manda por mail junto con la factura y la abre alguien
//  que no trabaja acá.
//
//  Un papel que representa a la empresa no puede depender de que alguien se
//  acuerde de pegar el logo: la paleta y el logotipo viven acá, en un solo
//  lugar, y los PDFs los toman de acá.
//
//  Colores tomados de los PNG del manual de marca (no elegidos a ojo):
//    #000B23  navy — el bloque "LOGÍSTICA"
//    #3B63A8  azul — la flecha y el subtítulo "HOGAREÑO"
//
//  El logotipo va embebido en base64 y no como archivo suelto: jsPDF arma el
//  documento en el navegador y un `fetch` de la imagen puede fallar (offline,
//  caché fría) justo cuando el operador está bajando 40 liquidaciones. Un PDF
//  sin logo saldría igual y nadie se enteraría hasta verlo del otro lado.
//  Es el recorte del logo horizontal, compuesto sobre blanco a 560×160 px
//  (~300 dpi al ancho al que se imprime).
// ════════════════════════════════════════════════════════════════════════

const MARCA = {
  navy:      [0, 11, 35],
  azul:      [59, 99, 168],
  azulPapel: [239, 243, 250],
  linea:     [214, 222, 236],
  gris:      [108, 117, 133],
  texto:     [30, 41, 59],
  verde:     [21, 128, 61],
  ambar:     [180, 83, 9],
  logoRatio: 3.5,     // ancho / alto del recorte
  logo: 'data:image/png;base64,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'
};

// ── Datos del emisor ───────────────────────────────────────────────────────
// Un documento formal tiene que decir QUIÉN lo emite: sin razón social, CUIT y
// domicilio es un listado, no una liquidación. No se hardcodean —inventar un
// CUIT sería peor que no mostrarlo— sino que se cargan desde la app
// (Liquidación de clientes → "Datos de la empresa") y viven en la tabla
// `config`. El PDF imprime SOLO lo que está cargado.
const EMPRESA_CAMPOS = [
  { k: 'empresa_nombre',    label: 'Nombre comercial',  ph: 'Logística Hogareño' },
  { k: 'empresa_razon',     label: 'Razón social',      ph: 'Ej: Logística Hogareño S.R.L.' },
  { k: 'empresa_cuit',      label: 'CUIT',              ph: 'Ej: 30-12345678-9' },
  { k: 'empresa_domicilio', label: 'Domicilio',         ph: 'Calle, número, localidad' },
  { k: 'empresa_tel',       label: 'Teléfono',          ph: '' },
  { k: 'empresa_email',     label: 'Email',             ph: '' },
  { k: 'empresa_web',       label: 'Web',               ph: '' },
  { k: 'empresa_pago',      label: 'Datos de pago',     ph: 'CBU / Alias / Banco' },
];

function empresaDato(k) { return String((AppData.config && AppData.config[k]) || '').trim(); }
function empresaNombre() { return empresaDato('empresa_nombre') || 'Logística Hogareño'; }

// Renglón fiscal: razón social + CUIT. Es el que identifica legalmente al
// emisor, así que va primero y en el pie de todas las páginas.
function empresaLineaFiscal() {
  const p = [];
  const rz = empresaDato('empresa_razon') || empresaNombre();
  if (rz) p.push(rz);
  if (empresaDato('empresa_cuit')) p.push('CUIT ' + empresaDato('empresa_cuit'));
  if (empresaDato('empresa_domicilio')) p.push(empresaDato('empresa_domicilio'));
  return p.join('  ·  ');
}

function empresaLineaContacto() {
  const p = [];
  if (empresaDato('empresa_tel')) p.push('Tel. ' + empresaDato('empresa_tel'));
  if (empresaDato('empresa_email')) p.push(empresaDato('empresa_email'));
  if (empresaDato('empresa_web')) p.push(empresaDato('empresa_web'));
  return p.join('  ·  ');
}

// ¿Falta algo para que el documento se pueda mandar? Lo consulta el panel de
// Liquidación de clientes para avisarlo ANTES de que salgan 40 PDFs sin CUIT.
function empresaFaltaFiscal() {
  return !empresaDato('empresa_razon') || !empresaDato('empresa_cuit');
}

// ── Editor de los datos del emisor ────────────────────────────────────────
function abrirDatosEmpresa() {
  const campos = EMPRESA_CAMPOS.map(f =>
    '<label style="display:block;margin-bottom:10px">' +
      '<span style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px">' + f.label + '</span>' +
      '<input id="emp-' + f.k + '" value="' + String(empresaDato(f.k)).replace(/"/g, '&quot;') + '" ' +
      'placeholder="' + f.ph + '" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px">' +
    '</label>').join('');

  document.getElementById('modal-title').textContent = 'Datos de la empresa';
  document.getElementById('modal-body').innerHTML =
    '<div class="alert alert-info" style="margin-bottom:12px"><i class="ic ic-file"></i><div>' +
    'Es lo que sale <strong>en el encabezado y el pie de la liquidación del cliente</strong>. ' +
    'La liquidación se manda por mail y la abre alguien de afuera: sin razón social ni CUIT no se puede identificar quién la emite. ' +
    'Se imprime solo lo que esté cargado.</div></div>' +
    campos +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="btn" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-primary" onclick="guardarDatosEmpresa()"><i class="ic ic-save"></i> Guardar</button>' +
    '</div>';
  document.getElementById('modal-backdrop').classList.add('open');
}

async function guardarDatosEmpresa() {
  const vals = {};
  EMPRESA_CAMPOS.forEach(f => {
    const el = document.getElementById('emp-' + f.k);
    vals[f.k] = el ? el.value.trim() : '';
  });
  try {
    if (typeof marcarEscrituraLocal === 'function') marcarEscrituraLocal();
    for (const k of Object.keys(vals)) {
      if (empresaDato(k) === vals[k]) continue;
      await DB.setConfig(k, vals[k]);
      AppData.config[k] = vals[k];
    }
    try { localStorage.setItem('liq_config', JSON.stringify(AppData.config)); } catch (e) {}
    closeModal();
    showToast('✅ Datos de la empresa guardados');
    if (typeof renderClienteLiquidaciones === 'function' &&
        document.getElementById('page-cliente-liquidaciones')?.classList.contains('active')) renderClienteLiquidaciones();
  } catch (e) {
    console.warn('guardarDatosEmpresa', e);
    alert('No se pudieron guardar: ' + (e.message || e));
  }
}
