// Único estado que contabiliza en la liquidación. El resto se muestra pero no suma.
const ESTADO_CONTABILIZA = 'ENTREGADO';
const ESTADOS_CONOCIDOS = [
  'Pendiente','Rechazado por el comprador','En camino al destinatario','En planta de procesamiento',
  'Cerrado','A retirar','Retirado','Devolviendo a planta de procesamiento','Entregado','Nadie',
  'Cancelado','Nadie 2da visita','Cancelado 2da visita','En camino reprogramado','En camino 2da visita',
  'No entregado','Devuelto al cliente','Direccion incorrecta','Reprogramado por meli','Reprogramado por el comprador'
];

// ===== DATA STORE =====
let AppData = {
  records: [],       // raw uploaded rows after mapping (BD: tracking, fecha, localidad, estado, zona, cadete)
  mappings: {},      // col mappings { tracking, fecha, localidad, estado, zona, cadete }
  rawHeaders: [],
  rawRows: [],

  tarifas: [
    { zona: 'ALMIRANTE BROWN', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'AVELLANEDA', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'BERAZATEGUI', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'BERISSO', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'CABA', categoria: 'Cerca', s_colecta: 1890, c_colecta: 2100, sla: 2520 },
    { zona: 'CAMPANA', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'CAÑUELAS', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'DEL VISO', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'DERQUI', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'ENSENADA', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'ESCOBAR', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'ESTEBAN ECHEVERRIA', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'EZEIZA', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'FLORENCIO VARELA', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'GARIN', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'GENERAL RODRIGUEZ', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'GUERNICA', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'HURLINGHAM', categoria: 'Muy cerca', s_colecta: 1530, c_colecta: 1700, sla: 2040 },
    { zona: 'INGENIERO MASCHWITZ', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'ITUZAINGO', categoria: 'Muy cerca', s_colecta: 1530, c_colecta: 1700, sla: 2040 },
    { zona: 'JOSE C PAZ', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'LA PLATA', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'LANUS', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'LOMAS DE ZAMORA', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'LUJAN', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'MALVINAS ARGENTINAS', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'MARCOS PAZ', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'MATANZA NORTE', categoria: 'Muy cerca', s_colecta: 1530, c_colecta: 1700, sla: 2040 },
    { zona: 'MATANZA SUR', categoria: 'Cerca', s_colecta: 1890, c_colecta: 2100, sla: 2520 },
    { zona: 'MERLO', categoria: 'Cerca', s_colecta: 1890, c_colecta: 2100, sla: 2520 },
    { zona: 'MORENO', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'MORON', categoria: 'Muy cerca', s_colecta: 1530, c_colecta: 1700, sla: 2040 },
    { zona: 'NORDELTA', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'PILAR', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'PRESIDENTE PERON', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'QUILMES', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'SAN FERNANDO', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'SAN ISIDRO', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'SAN MARTIN', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'SAN MIGUEL', categoria: 'Cerca', s_colecta: 1890, c_colecta: 2100, sla: 2520 },
    { zona: 'SAN VICENTE', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'TIGRE', categoria: 'Lejos', s_colecta: 2610, c_colecta: 2900, sla: 3480 },
    { zona: 'TRES DE FEBRERO', categoria: 'Muy cerca', s_colecta: 1530, c_colecta: 1700, sla: 2040 },
    { zona: 'VICENTE LOPEZ', categoria: 'Intermedio', s_colecta: 2340, c_colecta: 2600, sla: 3120 },
    { zona: 'VILLA ROSA', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
    { zona: 'ZARATE', categoria: 'Muy Lejos', s_colecta: 2835, c_colecta: 3150, sla: 3780 },
  ],

  superSLA: [
    { conductor: 'ALEJO BRIEND', zona: 'VICENTE LOPEZ', precio: 4000 },
    { conductor: 'ALEJO BRIEND', zona: 'SAN ISIDRO', precio: 4000 },
    { conductor: 'ANDREA CARPENTIERI', zona: 'CABA', precio: 2520 },
    { conductor: 'ARIEL IGLESIAS', zona: 'HURLINGHAM', precio: 2250 },
    { conductor: 'ARIEL IGLESIAS', zona: 'MORON', precio: 2250 },
    { conductor: 'ARIEL OJEDA', zona: 'MARCOS PAZ', precio: 3120 },
    { conductor: 'ARIEL OJEDA', zona: 'MERLO', precio: 2520 },
    { conductor: 'AUGUSTO REYES', zona: 'SAN VICENTE', precio: 3780 },
    { conductor: 'AUGUSTO REYES', zona: 'GUERNICA', precio: 3780 },
    { conductor: 'AUGUSTO REYES', zona: 'ALMIRANTE BROWN', precio: 3450 },
    { conductor: 'BLAS SOSA', zona: 'ESTEBAN ECHEVERRIA', precio: 3500 },
    { conductor: 'BLAS SOSA', zona: 'LOMAS DE ZAMORA', precio: 3500 },
    { conductor: 'BLAS SOSA', zona: 'ALMIRANTE BROWN', precio: 3500 },
    { conductor: 'BRIAN RODRIGUEZ', zona: 'SAN MIGUEL', precio: 3000 },
    { conductor: 'CLAUDIO ROJAS', zona: 'DEL VISO', precio: 3750 },
    { conductor: 'CLAUDIO ROJAS', zona: 'VILLA ROSA', precio: 3750 },
    { conductor: 'CLAUDIO ROJAS', zona: 'PILAR', precio: 3750 },
    { conductor: 'DEBORA PEÑA', zona: 'CABA', precio: 2520 },
    { conductor: 'DIEGO CORIGLIANO', zona: 'SAN ISIDRO', precio: 4000 },
    { conductor: 'DIEGO CORIGLIANO', zona: 'VICENTE LOPEZ', precio: 4000 },
    { conductor: 'DIEGO CORIGLIANO', zona: 'SAN MARTIN', precio: 3120 },
    { conductor: 'EMANUEL VILLAVICENCIO', zona: 'CABA', precio: 2520 },
    { conductor: 'EMILIANO VENTURA', zona: 'LOMAS DE ZAMORA', precio: 3800 },
    { conductor: 'ENZO DIAZ', zona: 'SAN MARTIN', precio: 3120 },
    { conductor: 'FEDERICO LABIGNAN', zona: 'TIGRE', precio: 3800 },
    { conductor: 'FEDERICO LABIGNAN', zona: 'VICENTE LOPEZ', precio: 3800 },
    { conductor: 'FEDERICO LABIGNAN', zona: 'SAN ISIDRO', precio: 3800 },
    { conductor: 'FRANCO MENA', zona: 'AVELLANEDA', precio: 3300 },
    { conductor: 'GABRIEL TRILLER', zona: 'MATANZA NORTE', precio: 2800 },
    { conductor: 'GABRIEL TRILLER', zona: 'MATANZA SUR', precio: 4050 },
    { conductor: 'GASTON VILLADRA', zona: 'PILAR', precio: 3900 },
    { conductor: 'GASTON VILLADRA', zona: 'DERQUI', precio: 3900 },
    { conductor: 'GASTON VILLADRA', zona: 'VILLA ROSA', precio: 3900 },
    { conductor: 'GERMAN FERNANDEZ', zona: 'ESCOBAR', precio: 3780 },
    { conductor: 'GERMAN FERNANDEZ', zona: 'INGENIERO MASCHWITZ', precio: 3780 },
    { conductor: 'GERMAN FERNANDEZ', zona: 'TIGRE', precio: 3780 },
    { conductor: 'GISELA BLANCO', zona: 'MALVINAS ARGENTINAS', precio: 4320 },
    { conductor: 'GISELA BLANCO', zona: 'JOSE C PAZ', precio: 4320 },
    { conductor: 'GONZALO GABELLI', zona: 'SAN FERNANDO', precio: 3400 },
    { conductor: 'GONZALO GABELLI', zona: 'SAN ISIDRO', precio: 3400 },
    { conductor: 'GONZALO PICCOLI', zona: 'CABA', precio: 2520 },
    { conductor: 'JAVIER OCAMPO', zona: 'BERAZATEGUI', precio: 4300 },
    { conductor: 'JONATHAN RODAS', zona: 'MATANZA NORTE', precio: 2800 },
    { conductor: 'JONATHAN RODAS', zona: 'MATANZA SUR', precio: 3400 },
    { conductor: 'KEVIN BORDAKIEVICH', zona: 'CABA', precio: 2520 },
    { conductor: 'LEONEL MARCE', zona: 'MATANZA SUR', precio: 4050 },
    { conductor: 'LEONEL RODRIGUEZ', zona: 'LA PLATA', precio: 4580 },
    { conductor: 'LEONEL RODRIGUEZ', zona: 'BERISSO', precio: 4580 },
    { conductor: 'LEONEL RODRIGUEZ', zona: 'ENSENADA', precio: 4580 },
    { conductor: 'LUCA TOLEDO', zona: 'CABA', precio: 2520 },
    { conductor: 'LUCAS GONZALEZ', zona: 'EZEIZA', precio: 3500 },
    { conductor: 'LUCAS GONZALEZ', zona: 'CAÑUELAS', precio: 3500 },
    { conductor: 'LUCAS LUDUEÑA', zona: 'LANUS', precio: 3300 },
    { conductor: 'LUCAS LUDUEÑA', zona: 'AVELLANEDA', precio: 3300 },
    { conductor: 'LUCAS LUDUEÑA', zona: 'LOMAS DE ZAMORA', precio: 3300 },
    { conductor: 'LUCAS VISPO', zona: 'CABA', precio: 2900 },
    { conductor: 'LUCIO PAWLOWICZ', zona: 'CABA', precio: 2520 },
    { conductor: 'MARCELO CASTRO', zona: 'ZARATE', precio: 4000 },
    { conductor: 'MARCELO CASTRO', zona: 'CAMPANA', precio: 4000 },
    { conductor: 'MARTIN LOPEZ', zona: 'JOSE C PAZ', precio: 3600 },
    { conductor: 'MARTIN LOPEZ', zona: 'DERQUI', precio: 3600 },
    { conductor: 'MATIAS MELGAREJO', zona: 'LA PLATA', precio: 3900 },
    { conductor: 'MATIAS MELGAREJO', zona: 'BERISSO', precio: 3900 },
    { conductor: 'MATIAS MELGAREJO', zona: 'ENSENADA', precio: 3900 },
    { conductor: 'MATIAS OJEDA', zona: 'FLORENCIO VARELA', precio: 3480 },
    { conductor: 'MATIAS SCAPARRA', zona: 'VICENTE LOPEZ', precio: 3120 },
    { conductor: 'MATIAS SCAPARRA', zona: 'SAN ISIDRO', precio: 3120 },
    { conductor: 'MATIAS SCAPARRA', zona: 'TIGRE', precio: 3480 },
    { conductor: 'MAXIMILIANO DEBICKI', zona: 'CABA', precio: 2520 },
    { conductor: 'MAXIMILIANO DIAZ', zona: 'CABA', precio: 2520 },
    { conductor: 'MAXIMILIANO RIOS', zona: 'ALMIRANTE BROWN', precio: 3500 },
    { conductor: 'ROMINA JUAREZ', zona: 'TRES DE FEBRERO', precio: 2300 },
    { conductor: 'ROMINA PERATA', zona: 'ESCOBAR', precio: 3780 },
    { conductor: 'ROMINA PERATA', zona: 'INGENIERO MASCHWITZ', precio: 3780 },
    { conductor: 'ROMINA PERATA', zona: 'CAMPANA', precio: 3780 },
    { conductor: 'URIEL IRURETA', zona: 'QUILMES', precio: 3400 },
    { conductor: 'DANIEL SEGURADO', zona: 'CABA', precio: 2520 },
    { conductor: 'ELIZABETH VELIZ', zona: 'ITUZAINGO', precio: 3500 },
    { conductor: 'ELIZABETH VELIZ', zona: 'MORON', precio: 3500 },
  ],

  // Panel de Conductores: nombre, condición (Titular/Semi Titular/Suplente) y categorización de precios
  // La condición determina el día de pago y agrupa los PDFs de liquidación.
  panelConductores: [
    { id: 'LH20497', nombre: 'ALEJO BRIEND', condicion: '', categoria: 'super_sla' },
    { id: 'LH36416', nombre: 'ANDREA CARPENTIERI', condicion: '', categoria: 'super_sla' },
    { id: 'LH39619', nombre: 'ARIEL IGLESIAS', condicion: '', categoria: 'super_sla' },
    { id: 'LH39790', nombre: 'ARIEL OJEDA', condicion: '', categoria: 'super_sla' },
    { id: 'LH65076', nombre: 'AUGUSTO REYES', condicion: '', categoria: 'super_sla' },
    { id: 'LH19740', nombre: 'BLAS SOSA', condicion: '', categoria: 'super_sla' },
    { id: 'LH92732', nombre: 'BRIAN RODRIGUEZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH95380', nombre: 'CLAUDIO ROJAS', condicion: '', categoria: 'super_sla' },
    { id: 'LH34735', nombre: 'DANIEL SEGURADO', condicion: '', categoria: 'super_sla' },
    { id: 'LH22332', nombre: 'DEBORA PEÑA', condicion: '', categoria: 'super_sla' },
    { id: 'LH25855', nombre: 'DIEGO CORIGLIANO', condicion: '', categoria: 'super_sla' },
    { id: 'LH53747', nombre: 'ELIZABETH VELIZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH37871', nombre: 'EMANUEL VILLAVICENCIO', condicion: '', categoria: 'super_sla' },
    { id: 'LH84936', nombre: 'EMILIANO VENTURA', condicion: '', categoria: 'super_sla' },
    { id: 'LH84158', nombre: 'ENZO DIAZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH20527', nombre: 'FEDERICO LABIGNAN', condicion: '', categoria: 'super_sla' },
    { id: 'LH22570', nombre: 'FRANCO MENA', condicion: '', categoria: 'super_sla' },
    { id: 'LH33878', nombre: 'GABRIEL TRILLER', condicion: '', categoria: 'super_sla' },
    { id: 'LH85064', nombre: 'GASTON VILLADRA', condicion: '', categoria: 'super_sla' },
    { id: 'LH19538', nombre: 'GERMAN FERNANDEZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH25851', nombre: 'GISELA BLANCO', condicion: '', categoria: 'super_sla' },
    { id: 'LH79518', nombre: 'GONZALO GABELLI', condicion: '', categoria: 'super_sla' },
    { id: 'LH93438', nombre: 'GONZALO PICCOLI', condicion: '', categoria: 'super_sla' },
    { id: 'LH94952', nombre: 'JAVIER OCAMPO', condicion: '', categoria: 'super_sla' },
    { id: 'LH39674', nombre: 'JONATHAN RODAS', condicion: '', categoria: 'super_sla' },
    { id: 'LH96501', nombre: 'KEVIN BORDAKIEVICH', condicion: '', categoria: 'super_sla' },
    { id: 'LH85339', nombre: 'LEONEL MARCE', condicion: '', categoria: 'super_sla' },
    { id: 'LH89996', nombre: 'LEONEL RODRIGUEZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH40759', nombre: 'LUCA TOLEDO', condicion: '', categoria: 'super_sla' },
    { id: 'LH29090', nombre: 'LUCAS GONZALEZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH99317', nombre: 'LUCAS LUDUEÑA', condicion: '', categoria: 'super_sla' },
    { id: 'LH71497', nombre: 'LUCAS VISPO', condicion: '', categoria: 'super_sla' },
    { id: 'LH53598', nombre: 'LUCIO PAWLOWICZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH98812', nombre: 'MARCELO CASTRO', condicion: '', categoria: 'super_sla' },
    { id: 'LH58168', nombre: 'MARTIN LOPEZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH74573', nombre: 'MATIAS MELGAREJO', condicion: '', categoria: 'super_sla' },
    { id: 'LH40912', nombre: 'MATIAS OJEDA', condicion: '', categoria: 'super_sla' },
    { id: 'LH40001', nombre: 'MATIAS SCAPARRA', condicion: '', categoria: 'super_sla' },
    { id: 'LH46398', nombre: 'MAXIMILIANO DEBICKI', condicion: '', categoria: 'super_sla' },
    { id: 'LH57905', nombre: 'MAXIMILIANO DIAZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH57339', nombre: 'MAXIMILIANO RIOS', condicion: '', categoria: 'super_sla' },
    { id: 'LH29749', nombre: 'ROMINA JUAREZ', condicion: '', categoria: 'super_sla' },
    { id: 'LH47025', nombre: 'ROMINA PERATA', condicion: '', categoria: 'super_sla' },
    { id: 'LH81447', nombre: 'URIEL IRURETA', condicion: '', categoria: 'super_sla' },
    { id: 'LH18315', nombre: 'DANIEL GONZALEZ', condicion: '', categoria: 's_colecta' },
    { id: 'LH85027', nombre: 'FEDERICO PASSERO', condicion: '', categoria: 's_colecta' },
    { id: 'LH64347', nombre: 'FERNANDO RODRIGUEZ', condicion: '', categoria: 's_colecta' },
    { id: 'LH13934', nombre: 'GONZALO SOTELO', condicion: '', categoria: 's_colecta' },
    { id: 'LH67903', nombre: 'IVO EICHMAN', condicion: '', categoria: 's_colecta' },
    { id: 'LH45987', nombre: 'JOAQUIN MORENO', condicion: '', categoria: 's_colecta' },
    { id: 'LH89134', nombre: 'JOHAN BAZAN', condicion: '', categoria: 's_colecta' },
    { id: 'LH23423', nombre: 'JONATHAN CAMPERO', condicion: '', categoria: 's_colecta' },
    { id: 'LH71727', nombre: 'LEONARDO PEREZ', condicion: '', categoria: 's_colecta' },
    { id: 'LH30269', nombre: 'MARTIN DIAZ', condicion: '', categoria: 's_colecta' },
    { id: 'LH86272', nombre: 'NICOLAS LAUDANI', condicion: '', categoria: 's_colecta' },
    { id: 'LH63358', nombre: 'THIAGO MARQUES', condicion: '', categoria: 's_colecta' },
    { id: 'LH11651', nombre: 'VALENTIN ULIAMBRE', condicion: '', categoria: 's_colecta' },
  ],

  // Dimensiones Especiales: trackings con condición especial y valor único
  // que REEMPLAZA (no suma) al valor tradicional del tracking.
  // Formato: { fecha, tracking, cliente, zona, valor, condicion }
  dimensionesEspeciales: [],

  // Descuentos por conductor (MODELO VIEJO, deprecado — reemplazado por descItems).
  // Se conserva la propiedad para no romper referencias residuales; ya no se usa.
  descuentosConductores: [],

  // Descuentos por registro con fecha (combustible / extraviados / proveedores).
  // Cada renglón se imputa a la liquidación del período en que cae su fecha.
  // Formato: { id, tipo, conductor, fecha, monto, referencia, detalle, cuotas_total, monto_cuota }
  // cuotas_total>1 = extravío cuoteado (monto=total; se imputa por cuotas, no de una).
  descItems: [],

  // Cuotas de un extravío cuoteado (descuento_cuotas). Cada una se imputa a la
  // liquidación de su semana. Formato: { id, item_id, nro, monto, fecha }
  descItemCuotas: [],

  // Km de desvío: compensación adicional por kilómetros recorridos fuera de ruta.
  // Formato: { conductor, km, fecha, valor_km, monto, obs }
  kmDesvio: [],

  // Adelantos (préstamos a conductores devueltos en cuotas).
  // adelantos:      [{ id, conductor, monto_total, cuotas_total, monto_cuota, fecha, obs }]
  // adelantoCuotas: [{ id, adelanto_id, nro, monto, fecha }] — cuotas ya descontadas
  adelantos: [],
  adelantoCuotas: [],

  // Historial de tarifas de km de desvío (ordenado por vigencia).
  // Formato: { valor, vigente_desde (ISO), creado_por }
  // Cada cambio de precio queda registrado con su fecha/hora de vigencia.
  kmTarifas: [],

  // Configuración general (compartida en la nube).
  config: {},

  // Permisos por pantalla y rol cargados de la nube (null = defaults del código).
  // { administrativo: { pagina: true/false, ... } }
  rolPermisos: null,

  // Roles disponibles (de sistema + creados desde el panel). null = defaults.
  // [{ rol, label, emoji, color, es_sistema }]
  roles: null,

  // true cuando se trajo TODO el historial de registros (por defecto la app
  // carga solo la ventana reciente — ver VENTANA_DIAS_REGISTROS en datos.js).
  historialCompleto: false,
};

// Devuelve el registro de km de desvío de un conductor (o null).
function findKmDesvio(conductor) {
  if (!conductor || !AppData.kmDesvio.length) return null;
  const key = String(conductor).toUpperCase().trim();
  return AppData.kmDesvio.find(d =>
    String(d.conductor || '').toUpperCase().trim() === key
  ) || null;
}

// Adicional por km de desvío de un conductor dentro de un período.
// rango: { desde:'DD/MM/YYYY', hasta:'DD/MM/YYYY' } o null = todos los registros.
// Suma los km y montos de los desvíos cuya fecha cae dentro del período; así la
// liquidación semanal contempla solo los km de esa semana. Cada monto ya está
// congelado a la tarifa vigente cuando se cargó (no se recalcula).
function kmAdicionalConductor(conductor, rango) {
  const key = String(conductor || '').toUpperCase().trim();
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let km = 0, monto = 0, n = 0;
  AppData.kmDesvio.forEach(d => {
    if (String(d.conductor || '').toUpperCase().trim() !== key) return;
    if (desde || hasta) {
      const f = parseFechaReg(d.fecha);
      if (!f) return; // sin fecha no entra en un período filtrado
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    km += _num(d.km); monto += _num(d.monto); n++;
  });
  return { km, monto, n };
}

// ── Adelantos (préstamos en cuotas) ─────────────────────────────────────────
function cuotasDeAdelanto(adelantoId) {
  return AppData.adelantoCuotas.filter(c => c.adelanto_id === adelantoId);
}
function cuotasPagadasDe(adelantoId) { return cuotasDeAdelanto(adelantoId).length; }
function saldoAdelanto(a) {
  const pagado = cuotasDeAdelanto(a.id).reduce((s, c) => s + _num(c.monto), 0);
  return Math.max(0, _num(a.monto_total) - pagado);
}
function adelantoSaldado(a) { return cuotasPagadasDe(a.id) >= _num(a.cuotas_total); }

// Adelanto ACTIVO (con cuotas pendientes) de un conductor. Si hay varios, el más viejo.
function adelantoActivoDe(conductor) {
  const key = String(conductor || '').toUpperCase().trim();
  return AppData.adelantos
    .filter(a => String(a.conductor || '').toUpperCase().trim() === key && !adelantoSaldado(a))
    .sort((x, y) => x.id - y.id)[0] || null;
}

// Descuento por cuotas de adelanto de un conductor dentro de un período.
// Suma las cuotas cuya fecha cae en el rango (o todas si no hay filtro).
// Devuelve { monto, detalle: [{ nro, total, monto }] }.
function adelantoDescuentoConductor(conductor, rango) {
  const key = String(conductor || '').toUpperCase().trim();
  const setIds = new Set(AppData.adelantos
    .filter(a => String(a.conductor || '').toUpperCase().trim() === key).map(a => a.id));
  if (!setIds.size) return { monto: 0, detalle: [] };
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let monto = 0; const detalle = [];
  AppData.adelantoCuotas.forEach(c => {
    if (!setIds.has(c.adelanto_id)) return;
    if (desde || hasta) {
      const f = parseFechaReg(c.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    const a = AppData.adelantos.find(x => x.id === c.adelanto_id);
    monto += _num(c.monto);
    detalle.push({ nro: c.nro, total: a ? _num(a.cuotas_total) : 0, monto: _num(c.monto) });
  });
  detalle.sort((x, y) => x.nro - y.nro);
  return { monto, detalle };
}

// ── Descuentos por ítem con fecha (combustible / extraviados / proveedores) ──
// Registros de un tipo para un conductor (sin filtrar por fecha).
function descItemsDe(tipo, conductor) {
  const key = String(conductor || '').toUpperCase().trim();
  return AppData.descItems.filter(x =>
    x.tipo === tipo && String(x.conductor || '').toUpperCase().trim() === key);
}

// Descuento de un tipo para un conductor dentro de un período (suma las cuotas
// cuya fecha cae en el rango, o todas si no hay filtro). Espeja adelantoDescuentoConductor.
// Devuelve { monto, detalle: [{ fecha, monto, referencia }] }.
function descItemDescuentoConductor(tipo, conductor, rango) {
  const key = String(conductor || '').toUpperCase().trim();
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let monto = 0; const detalle = [];
  AppData.descItems.forEach(x => {
    if (x.tipo !== tipo) return;
    if (_num(x.cuotas_total) > 1) return; // cuoteado: no se imputa el total de una, va por cuotas
    if (String(x.conductor || '').toUpperCase().trim() !== key) return;
    if (desde || hasta) {
      const f = parseFechaReg(x.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    monto += _num(x.monto);
    detalle.push({ fecha: x.fecha, monto: _num(x.monto), referencia: x.referencia || '' });
  });
  return { monto, detalle };
}

// ── Cuotas de extravíos cuoteados (descuento_cuotas) ─────────────────────────
function descItemCuotasDe(itemId) {
  return AppData.descItemCuotas.filter(c => c.item_id === itemId);
}
function descItemCuotasPagadas(itemId) { return descItemCuotasDe(itemId).length; }
function descItemSaldo(item) {
  const pagado = descItemCuotasDe(item.id).reduce((s, c) => s + _num(c.monto), 0);
  return Math.max(0, _num(item.monto) - pagado);
}
function descItemSaldado(item) { return descItemCuotasPagadas(item.id) >= _num(item.cuotas_total); }

// Cuota(s) de extravío imputadas a un conductor dentro de un período.
// Suma las descuento_cuotas (de items tipo 'extraviados' cuoteados) cuya fecha
// cae en el rango. Espeja adelantoDescuentoConductor.
// Devuelve { monto, detalle: [{ nro, total, monto }] }.
function extravioCuotaDescuento(conductor, rango) {
  const key = String(conductor || '').toUpperCase().trim();
  const itemsTotal = {}; // item_id → cuotas_total (solo extravíos cuoteados del conductor)
  AppData.descItems.forEach(x => {
    if (x.tipo === 'extraviados' && _num(x.cuotas_total) > 1 &&
        String(x.conductor || '').toUpperCase().trim() === key) itemsTotal[x.id] = _num(x.cuotas_total);
  });
  const setIds = new Set(Object.keys(itemsTotal).map(Number));
  if (!setIds.size) return { monto: 0, detalle: [] };
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let monto = 0; const detalle = [];
  AppData.descItemCuotas.forEach(c => {
    if (!setIds.has(c.item_id)) return;
    if (desde || hasta) {
      const f = parseFechaReg(c.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    monto += _num(c.monto);
    detalle.push({ nro: c.nro, total: itemsTotal[c.item_id] || 0, monto: _num(c.monto) });
  });
  detalle.sort((x, y) => x.nro - y.nro);
  return { monto, detalle };
}

// Tarifa de km VIGENTE HOY (la más reciente del historial). 0 si no hay ninguna.
function kmValorActual() {
  if (!AppData.kmTarifas.length) return 0;
  // kmTarifas viene ordenado ascendente por vigente_desde; la última es la actual.
  return _num(AppData.kmTarifas[AppData.kmTarifas.length - 1].valor);
}

// Tarifa de km que estaba vigente en una fecha dada (DD/MM/YYYY o Date).
// Toma la última tarifa cuya vigencia empezó en o antes de esa fecha (fin del día).
// Así, si la tarifa sube más adelante, los desvíos con fecha anterior conservan
// la tarifa vieja. Devuelve 0 si no hay tarifa vigente para esa fecha.
function tarifaKmEnFecha(fechaStr) {
  if (!AppData.kmTarifas.length) return 0;
  let ref;
  if (fechaStr instanceof Date) ref = new Date(fechaStr);
  else ref = parseFechaReg(fechaStr);
  if (!ref) ref = new Date();
  ref.setHours(23, 59, 59, 999); // fin del día del desvío
  let valor = 0, mejor = null;
  AppData.kmTarifas.forEach(t => {
    const vd = new Date(t.vigente_desde);
    if (vd <= ref && (!mejor || vd >= mejor)) { mejor = vd; valor = _num(t.valor); }
  });
  return valor;
}

// ===== PRICE LOGIC =====
// Devuelve el precio a aplicar para un cadete en una zona puntual.
// 1) Super SLA: si el cadete tiene regla especial para ESA zona, se respeta.
// 2) Si no hay regla Super SLA para esa zona (aunque el cadete tenga Super SLA
//    en OTRA zona), se cae al precio "SLA Cumplido" estándar de la zona.
// 3) Si el cadete no tiene ninguna relación con Super SLA, se usa el tipo fijo
//    asignado en "Categorización de Conductores" (s_colecta | c_colecta | sla).
function getPrecio(conductor, zona) {
  const cNorm = (conductor || '').toUpperCase().trim();
  const zNorm = (zona || '').toUpperCase().trim();

  const superRule = AppData.superSLA.find(
    r => r.conductor.toUpperCase().trim() === cNorm && r.zona.toUpperCase().trim() === zNorm
  );

  const tarifa = AppData.tarifas.find(t => t.zona.toUpperCase().trim() === zNorm);
  // Leer categoría directo desde el panel de conductores
  const panelCond = AppData.panelConductores.find(c => c.nombre.toUpperCase().trim() === cNorm);
  const tipoFijo = panelCond?.categoria === 'super_sla' ? 'sla' : (panelCond?.categoria || 's_colecta');
  const tieneSuperSLAEnOtraZona = AppData.superSLA.some(r => r.conductor.toUpperCase().trim() === cNorm);

  if (superRule) {
    return { precio: superRule.precio ?? superRule.sla ?? 0, tipo: 'sla', es_super: true, sin_tarifa: false };
  }

  if (!tarifa) {
    return { precio: 0, tipo: tipoFijo, es_super: false, sin_tarifa: true };
  }

  // El cadete tiene Super SLA en otra zona, pero acá visita una zona sin regla → SLA Cumplido
  if (tieneSuperSLAEnOtraZona) {
    return { precio: tarifa.sla, tipo: 'sla', es_super: false, sin_tarifa: false };
  }

  return { precio: tarifa[tipoFijo] || 0, tipo: tipoFijo, es_super: false, sin_tarifa: false };
}

// Estados que contabilizan (pueden venir del XLS con variantes)
const ESTADOS_CONTABILIZAN = new Set(['ENTREGADO', 'ENTREGADO 2DA VISITA']);

function calcLiquidaciones() {
  const byDriver = {};
  AppData.records.forEach(r => {
    const cond = (r.cadete || '').trim();
    if (!cond) return;

    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = estadoNorm === ESTADO_CONTABILIZA || ESTADOS_CONTABILIZAN.has(estadoNorm);
    const fecha = r.fecha || '';
    const tracking = r.tracking || '';
    const zona_precio = r.zona_precio || '';

    if (!byDriver[cond]) {
      byDriver[cond] = { conductor: cond, filas: [], filas_excluidas: [], total: 0, total_excluido_count: 0 };
    }

    if (contabiliza) {
      // Buscar si este tracking tiene una DIMENSIÓN ESPECIAL cargada.
      // Si existe, REEMPLAZA el precio tradicional (no lo suma).
      const dim = tracking ? findDimensionEspecial(tracking) : null;

      let precio, tipo, es_super = false, sin_tarifa = false;
      let es_dim_especial = false;
      let dim_cliente = '', dim_condicion = '';

      if (dim) {
        // Precio reemplazado por el valor especial
        precio = dim.valor;
        tipo = 'dim_especial';
        es_dim_especial = true;
        dim_cliente = dim.cliente || '';
        dim_condicion = dim.condicion || '';
      } else {
        // Cálculo tradicional desde panel de tarifas
        const p = getPrecio(cond, zona);
        precio = p.precio;
        tipo = p.tipo;
        es_super = p.es_super;
        sin_tarifa = p.sin_tarifa;
      }

      // Corrección manual del operador (pantalla Conductores): pisa todo cálculo.
      if (precioManualDe(r) !== null) {
        precio = precioManualDe(r);
        tipo = 'manual';
        sin_tarifa = false;
      }

      const subtotal = precio;

      byDriver[cond].filas.push({
        tracking, zona, zona_precio, fecha, estado: r.estado,
        tipo, precio, subtotal, es_super, sin_tarifa,
        es_dim_especial, dim_cliente, dim_condicion
      });
      byDriver[cond].total += subtotal;
    } else {
      byDriver[cond].filas_excluidas.push({ tracking, zona, zona_precio, fecha, estado: r.estado });
      byDriver[cond].total_excluido_count++;
    }
  });
  return byDriver;
}

// ═══ Buscar dimensión especial por tracking ══════════════════════════════
function findDimensionEspecial(tracking) {
  if (!tracking || !AppData.dimensionesEspeciales.length) return null;
  const t = String(tracking).trim().toUpperCase();
  return AppData.dimensionesEspeciales.find(d =>
    String(d.tracking || '').trim().toUpperCase() === t
  ) || null;
}

// Devuelve el precio corregido a mano de un registro, o null si no tiene.
function precioManualDe(r) {
  if (!r || r.precio_manual === null || r.precio_manual === undefined || r.precio_manual === '') return null;
  const n = parseFloat(r.precio_manual);
  return isNaN(n) ? null : n;
}

// Normaliza texto para comparar (minúsculas, sin acentos ni puntuación, espacios colapsados).
function _normTxt(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ¿El tracking "parece real"? (numérico de 8+ dígitos, ej. Mercado Libre).
function trackingValido(t) {
  return /^[0-9]{8,}$/.test(String(t || '').trim());
}

// Clave de deduplicación de un registro. Determina cuándo una carga REEMPLAZA
// a un registro anterior (superposición) y cuándo son envíos DISTINTOS:
//   - Tracking real  -> por tracking (dos envíos nunca comparten un tracking real).
//   - Tracking basura -> por dirección + destinatario (la 1ra y 2da visita de un
//     mismo envío comparten dirección => se fusionan; direcciones distintas => son
//     envíos distintos y se pagan por separado). La fecha NO entra: 1ra y 2da
//     visita son días distintos y deben reconocerse como el mismo envío.
//   - Basura sin dirección -> huella por campos, para que re-importar el mismo
//     archivo no duplique (caso muy marginal).
function claveRegistro(r) {
  const t = String(r.tracking || '').trim();
  if (trackingValido(t)) return 'T:' + t;
  const dir = _normTxt(r.direccion);
  const dest = _normTxt(r.destinatario);
  if (dir) return 'D:' + dir + '|' + dest;
  return 'F:' + _normTxt([r.cadete, r.fecha, r.zona, r.localidad, dest].join('|'));
}

function tipoLabel(t) {
  if (t === 'c_colecta') return 'C/ Colecta';
  if (t === 's_colecta') return 'S/ Colecta';
  if (t === 'sla') return 'SLA Cumplido';
  if (t === 'dim_especial') return 'Dimensión Especial';
  if (t === 'manual') return 'Corregido manual';
  return t || '—';
}

function esEstadoEntregado(estado) {
  return (estado || '').toUpperCase().trim() === ESTADO_CONTABILIZA;
}

// ===== AVATAR COLORS =====
const AVATAR_COLORS = ['#e94560','#4169e1','#2e8b57','#9b59b6','#e67e22','#16a085','#c0392b','#2980b9'];
function avatarColor(name) {
  let h = 0;
  for (let c of name) h += c.charCodeAt(0);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}

// ===== CURRENCY FORMAT =====
function fmtPeso(n) {
  return '$' + Math.round(n).toLocaleString('es-AR');
}

// ===== NAVIGATION =====
const PAGE_TITLES = {
  'dashboard': ['Dashboard', 'Resumen general del sistema'],
  'upload': ['Importar datos', 'Cargá tu base de recorridos'],
  'liquidaciones': ['Liquidaciones', 'Cálculo por conductor'],
  'conductores': ['Detalle de conductor', 'Recorridos individuales'],
  'reporte-zona': ['Reporte por zona', 'Análisis geográfico de recorridos'],
  'reporte-conductor': ['Reporte por conductor', 'Resumen ejecutivo'],
  'config-tarifas': ['Configuración de tarifas', 'Precios por zona y categoría'],
  'config-supersla': ['Super SLA', 'Tarifas especiales por conductor y zona'],
  'panel-conductores':  ['Panel de conductores', 'Condición, día de pago y categorización'],
  'dimensiones-especiales': ['Dimensiones Especiales', 'Trackings con condición y valor especial que reemplazan la tarifa'],
  'descuento-conductores': ['Descuento Conductores', 'Combustible, extraviados, adelantos y servicio proveedores por conductor'],
  'gestion-permisos': ['Gestión de permisos', 'Qué pantallas ve cada rol y usuarios asignados'],
};

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--brand);color:white;padding:10px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ════════════════════════════════════════════════════════════════════════
//  SUPERPOSICIONES DE IMPORTACIÓN
//  Cada importación de Excel queda asociada a una fecha de carga. Cuando la
//  carga pisa información anterior (misma clave: tracking / zona / conductor),
//  lo nuevo REEMPLAZA a lo viejo y acá se registra qué se superpuso, para
//  poder auditarlo desde el botón de alerta "⚠ Superposiciones".
// ════════════════════════════════════════════════════════════════════════

const SUPERPOSICION_LABELS = {
  registros:   'Importación de recorridos',
  tarifas:     'Importación de tarifas',
  dimensiones: 'Importación de dimensiones especiales',
  descuentos:  'Importación de descuentos',
};

// { modulo: { fecha_carga:'DD/MM/YYYY', hora:'HH:MM', items:[{clave, antes, despues}] } }
let superposiciones = {};
try { superposiciones = JSON.parse(localStorage.getItem('liq_superposiciones') || '{}') || {}; } catch(e) {}

// Registra las superposiciones de la última importación de un módulo y
// actualiza su botón de alerta. items = [{ clave, antes, despues }].
function registrarSuperposiciones(modulo, fechaCarga, items) {
  const ahora = new Date();
  superposiciones[modulo] = {
    fecha_carga: fechaCarga || ahora.toLocaleDateString('es-AR'),
    hora: String(ahora.getHours()).padStart(2,'0') + ':' + String(ahora.getMinutes()).padStart(2,'0'),
    items: items || []
  };
  try { localStorage.setItem('liq_superposiciones', JSON.stringify(superposiciones)); } catch(e) {}
  actualizarBotonSuperposiciones(modulo);
}

// Muestra/oculta el botón de alerta del módulo según haya superposiciones.
function actualizarBotonSuperposiciones(modulo) {
  const btn = document.getElementById('alerta-sup-' + modulo);
  if (!btn) return;
  const s = superposiciones[modulo];
  const n = s && s.items ? s.items.length : 0;
  btn.style.display = n > 0 ? '' : 'none';
  if (n > 0) btn.textContent = n === 1 ? '⚠ 1 superposición' : '⚠ ' + n + ' superposiciones';
}

// Modal de detalle: qué se pisó, valor anterior → valor nuevo.
function mostrarSuperposiciones(modulo) {
  const s = superposiciones[modulo];
  if (!s || !s.items || !s.items.length) { showToast('Sin superposiciones registradas'); return; }
  document.getElementById('modal-title').textContent =
    '⚠ Superposiciones — ' + (SUPERPOSICION_LABELS[modulo] || modulo);
  const filas = s.items.map(it => `
    <tr>
      <td class="mono" style="font-weight:600">${it.clave}</td>
      <td style="font-size:12px;color:#b91c1c">${it.antes}</td>
      <td style="font-size:12px;color:#166534;font-weight:600">${it.despues}</td>
    </tr>`).join('');
  document.getElementById('modal-body').innerHTML = `
    <div style="background:#fff8e1;border:1px solid #f5d97a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12.5px">
      📅 Carga del <strong>${s.fecha_carga}</strong> a las ${s.hora} hs — la información nueva
      <strong>reemplazó</strong> a la anterior en ${s.items.length} caso${s.items.length !== 1 ? 's' : ''}.
    </div>
    <div class="table-wrap" style="max-height:50vh;overflow-y:auto">
      <table>
        <thead><tr><th>Clave</th><th>Información anterior</th><th>Información nueva</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  document.getElementById('modal-backdrop').classList.add('open');
}

// ===== LOAD SAVED CONFIG =====
// ═══════════════════════════════════════════════════════════════════════════
// ═════════════════ MÓDULO DIMENSIONES ESPECIALES ══════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

