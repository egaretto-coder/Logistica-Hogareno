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
  // Recorridos especiales: rutas de envíos problemáticos pactadas a monto fijo.
  // [{ id, conductor, fecha, valor_ruta, base, monto, detalle, imputar }]
  recorridosEspeciales: [],

  // Liquidaciones de cliente ya ARMADAS por el administrativo (el operador
  // solo descarga las que están acá).
  // clienteLiquidaciones: [{ id, cliente_cod, semana_desde, semana_hasta, armada_por, armada_en }]
  clienteLiquidaciones: [],

  // Cuentas secundarias de un cliente: alias_cod → cliente_cod canónico.
  // clienteCuentas: [{ id, alias_cod, cliente_cod }]
  clienteCuentas: [],

  // Alias de zona: cómo viene escrita la zona en el tarifario de un cliente
  // → la zona canónica (la del tarifario de costos).
  // zonaAlias: [{ id, alias, zona }]
  zonaAlias: [],

  // Adelantos (préstamos devueltos en cuotas) a conductores o a empleados.
  // adelantos:      [{ id, conductor, beneficiario_tipo, empleado_id, moneda, tipo_cambio,
  //                    monto_total, cuotas_total, monto_cuota, fecha, obs }]
  // adelantoCuotas: [{ id, adelanto_id, nro, monto, moneda, tipo_cambio, monto_ars, fecha }]
  //                 monto = en la moneda del adelanto; monto_ars = lo que descuenta en pesos
  adelantos: [],
  adelantoCuotas: [],

  // Clientes (facturación) y su tarifario de venta por zona.
  // clientes: [{ id, nombre, razon_social, cuit, activo }]
  // clienteTarifas: [{ id, cliente, zona, precio }]
  clientes: [],
  proveedores: [],   // proveedores de servicio (lista cerrada para cargar gastos)
  clienteTarifas: [],

  // Comisiones de vendedores.
  // vendedores: [{ id, nombre, activo }]
  // comisionCategorias (escala importada): [{ id, categoria, fact_desde, fact_hasta, monto }]
  // comisionClientes (cliente nuevo -> vendedor + evaluación): [{ id, cliente, vendedor, fecha_alta, mes_inicio, categoria, facturacion_eval, monto, bloqueado }]
  // comisionPagos (cierre mensual): [{ id, periodo, beneficiario, tipo, monto, detalle, pagado_en }]
  vendedores: [],
  comisionCategorias: [],
  comisionClientes: [],
  comisionPagos: [],

  // Historial de importaciones de recorridos (visibilidad + dedup por hash).
  // importaciones: [{ id, archivo, hash, fecha_carga, filas, agregados, reemplazados, fecha_desde, fecha_hasta, usuario, created_at }]
  importaciones: [],

  // Solicitudes de cambio de precio de Super SLA (maker-checker).
  // superSLASolicitudes: [{ id, conductor, zona, precio_anterior, precio_propuesto, motivo, solicitante, estado, resuelto_por, created_at }]
  superSLASolicitudes: [],

  // Recursos Humanos: empleados de la empresa, su historial de ajustes de
  // sueldo (cada 3 meses desde SU fecha de ingreso) y la liquidación mensual.
  // empleados: [{ id, nombre, dni, telefono, email, direccion, puesto, registrado,
  //               fecha_ingreso, sueldo, pct_transferencia, activo, obs }]
  empleados: [],
  // clienteCargos: [{ id, cliente_cod, semana, concepto, detalle, cantidad, precio_unitario, monto }]
  // Cargos que NO vienen de un envío: colecta, viajes particulares, otros.
  clienteCargos: [],
  // vacaciones: [{ id, empleado_id, periodo, fecha_desde, fecha_hasta, dias, estado, obs }]
  // Cuelga de empleados: el plantel y la fecha de ingreso salen de ahí.
  vacaciones: [],
  empleadoAjustes: [],
  empleadoPostergaciones: [],   // ajustes que se decidió NO dar todavía, con su justificación
  empleadoHorasExtra: [],       // horas extras registradas el día que se hicieron
  empleadoReaperturas: [],      // pedidos de reabrir una liquidación ya pagada
  conductorFiscal: [],          // cuenta, contrato y monotributo de cada conductor
  conductorFacturas: [],        // lo transferido por período y su comprobante
  empleadoSueldos: [],

  // Rendicion de envios con cobro en destino (el conductor cobra y rinde al dia siguiente).
  rendiciones: [],

  // Catálogo de dimensiones especiales (base de datos por cliente).
  // dimCatalogo: [{ id, cliente, nombre, zona, precio }] — un precio por (cliente, dimensión, zona).
  // La asignación a un envío se guarda en el registro (dim_especial + dim_cliente).
  dimCatalogo: [],

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
  const key = conductorKey(conductor);
  return AppData.kmDesvio.find(d => conductorKey(d.conductor) === key) || null;
}

// Adicional por km de desvío de un conductor dentro de un período.
// rango: { desde:'DD/MM/YYYY', hasta:'DD/MM/YYYY' } o null = todos los registros.
// Suma los km y montos de los desvíos cuya fecha cae dentro del período; así la
// liquidación semanal contempla solo los km de esa semana. Cada monto ya está
// congelado a la tarifa vigente cuando se cargó (no se recalcula).
function kmAdicionalConductor(conductor, rango, incluirExcluidos) {
  const key = conductorKey(conductor);
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let km = 0, monto = 0, n = 0;
  const detalle = [];   // con incluirExcluidos=true vienen también los destildados
  AppData.kmDesvio.forEach((d, idx) => {
    if (conductorKey(d.conductor) !== key) return;
    if (desde || hasta) {
      const f = parseFechaReg(d.fecha);
      if (!f) return; // sin fecha no entra en un período filtrado
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    const imputa = d.imputar !== false;
    if (imputa) { km += _num(d.km); monto += _num(d.monto); n++; }
    if (incluirExcluidos || imputa) {
      detalle.push({ idx, id: d.id, fecha: d.fecha || '', km: _num(d.km), monto: _num(d.monto),
                     obs: d.obs || '', imputar: imputa });
    }
  });
  return { km, monto, n, detalle };
}

// ── Zonas válidas ───────────────────────────────────────────────────────────
// Palabras que son el ENCABEZADO de la planilla, no una zona. Si una se cuela
// como zona queda en el tarifario de costos y desde ahí aparece en todos los
// selectores y en el tarifario de venta de CADA cliente con precio $0 — sin que
// exista ningún envío en esa "zona" (bug real: "ZONA" era la fila 47 de 47).
const ZONAS_NO_VALIDAS = ['ZONA', 'ZONAS', 'PRECIO', 'PRECIOS', 'LOCALIDAD',
  'LOCALIDADES', 'TARIFA', 'TARIFAS', 'CLIENTE', 'TOTAL', 'CATEGORIA'];
function esZonaValida(z) {
  const k = String(z == null ? '' : z).trim().toUpperCase();
  return !!k && ZONAS_NO_VALIDAS.indexOf(k) < 0;
}

// Un ENCABEZADO colado como cliente. Mismo caso que "ZONA" en el tarifario: la
// fila de títulos del listado entra como si fuera un envío y desde ahí aparece
// un "cliente" llamado Nombre Fantasia, que se ofrece para dar de alta y para
// cargarle tarifario (bug real: la fila traía además zona "Zona", estado
// "Estado" y cadete "Cadete").
const CLIENTES_NO_VALIDOS = ['NOMBRE FANTASIA', 'RAZON SOCIAL', 'RAZÓN SOCIAL',
  'COD.CLIENTE', 'COD CLIENTE', 'CODIGO CLIENTE', 'CÓDIGO CLIENTE',
  'CLIENTE', 'CLIENTES', 'NOMBRE', 'TOTAL'];
function esClienteValido(c) {
  const k = String(c == null ? '' : c).trim().toUpperCase();
  return !!k && CLIENTES_NO_VALIDOS.indexOf(k) < 0;
}

// ── Alias de zona ───────────────────────────────────────────────────────────
// Los tarifarios de los clientes traen la zona partida en sub-zonas que en los
// envíos no existen: llega "LA PLATA NORTE" cuando la localidad del envío
// siempre dice "LA PLATA". Una tarifa con una zona que no aparece en ningún
// envío no se aplica NUNCA, así que ese envío se factura en $0 sin que nadie lo
// note. Es el mismo problema que los alias de conductor, del lado de las zonas.
function zonaCanonica(z) {
  const bruto = String(z == null ? '' : z).trim().toUpperCase();
  const k = normNombre(bruto);
  if (!k) return bruto;
  const a = (AppData.zonaAlias || []).find(x => normNombre(x.alias) === k);
  return a ? String(a.zona).trim().toUpperCase() : bruto;
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

// ── Moneda del adelanto (ARS / USD) ─────────────────────────────────────────
// monto_total y monto_cuota están expresados en la moneda del adelanto, y el
// saldo se lleva en esa misma moneda: un préstamo en dólares se debe en dólares.
// La LIQUIDACIÓN, en cambio, siempre es en pesos, así que cada cuota guarda
// además su equivalente (monto_ars) al tipo de cambio con el que se abonó.
function adelantoEsUSD(a) { return String((a && a.moneda) || 'ARS').toUpperCase() === 'USD'; }
function fmtUSD(n) { return 'USD ' + Math.round(_num(n)).toLocaleString('es-AR'); }
// Importe en la moneda que corresponda ("$1.000.000" o "USD 1.000").
function fmtMoneda(n, moneda) {
  return String(moneda || 'ARS').toUpperCase() === 'USD' ? fmtUSD(n) : fmtPeso(n);
}
// Lo que una cuota descuenta EN PESOS. Las cuotas viejas (anteriores al USD) no
// tienen monto_ars, y eran todas en pesos: ahí el monto ya es el equivalente.
function cuotaAdelantoARS(c) { return _num(c && c.monto_ars) || _num(c && c.monto); }
// Equivalente en pesos de un importe del adelanto, al tipo de cambio pactado.
// Sin tipo de cambio no se puede convertir y devuelve null: preferimos que la
// UI diga "falta el TC" antes que descontar $0 sin que nadie lo note.
function adelantoARS(a, monto) {
  if (!adelantoEsUSD(a)) return _num(monto);
  const tc = _num(a && a.tipo_cambio);
  return tc > 0 ? Math.round(_num(monto) * tc) : null;
}

// ── Beneficiario del adelanto: conductor o empleado ─────────────────────────
// `conductor` guarda el NOMBRE del beneficiario en los dos casos (así el
// buscador y el histórico siguen sirviendo); `beneficiario_tipo` distingue el
// grupo y `empleado_id` ata la fila al legajo.
function adelantoEsEmpleado(a) { return String((a && a.beneficiario_tipo) || 'conductor') === 'empleado'; }
function adelantosDeGrupo(grupo) {
  return (AppData.adelantos || []).filter(a => (adelantoEsEmpleado(a) ? 'empleado' : 'conductor') === grupo);
}
// Adelantos vigentes (autorizados y con saldo) de un empleado.
function adelantosActivosEmpleado(empId) {
  return (AppData.adelantos || [])
    .filter(a => adelantoEsEmpleado(a) && a.empleado_id === empId && esAutorizado(a) && !adelantoSaldado(a))
    .sort((x, y) => x.id - y.id);
}

// Adelanto ACTIVO (con cuotas pendientes) de un conductor. Si hay varios, el más viejo.
// Excluye los de empleados: un empleado homónimo de un cadete no es el cadete.
function adelantoActivoDe(conductor) {
  const key = conductorKey(conductor);
  return AppData.adelantos
    .filter(a => !adelantoEsEmpleado(a) && conductorKey(a.conductor) === key && !adelantoSaldado(a))
    .sort((x, y) => x.id - y.id)[0] || null;
}

// ── Régimen de superposiciones (maker-checker) ──────────────────────────────
// Adelantos y extravíos que carga un OPERADOR quedan 'pendiente' y NO impactan la
// liquidación hasta que un SUPERVISOR (o analista) los autorice. Km y beneficios
// se crean directo. Las filas viejas (sin estado) se tratan como autorizadas.
function esAutorizado(x) {
  const e = x && x.estado;
  return !e || e === 'autorizado';
}
function puedeAutorizar() {
  return !!currentUser && (currentUser.rol === 'supervisor' || currentUser.rol === 'analista');
}
// Estado inicial de una operación nueva según quién la carga.
function estadoNuevaOperacion() {
  return puedeAutorizar() ? 'autorizado' : 'pendiente';
}

// Descuento por cuotas de adelanto de un conductor dentro de un período.
// Suma las cuotas cuya fecha cae en el rango (o todas si no hay filtro).
// Solo cuenta adelantos AUTORIZADOS. Devuelve { monto, detalle: [{ nro, total, monto }] }.
function adelantoDescuentoConductor(conductor, rango) {
  const key = conductorKey(conductor);
  // Solo adelantos a CONDUCTORES: los de empleados se cobran en su sueldo, y si
  // un empleado se llamara igual que un cadete le descontaría plata al cadete.
  const setIds = new Set(AppData.adelantos
    .filter(a => !adelantoEsEmpleado(a) && conductorKey(a.conductor) === key && esAutorizado(a)).map(a => a.id));
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
    // La liquidación es en pesos: de una cuota en dólares se descuenta su
    // equivalente al tipo de cambio con el que se abonó, no el número en USD.
    const enPesos = cuotaAdelantoARS(c);
    monto += enPesos;
    detalle.push({ nro: c.nro, total: a ? _num(a.cuotas_total) : 0, monto: enPesos,
                   moneda: (c.moneda || (a && a.moneda) || 'ARS'), origen: _num(c.monto), tc: _num(c.tipo_cambio) });
  });
  detalle.sort((x, y) => x.nro - y.nro);
  return { monto, detalle };
}

// ── Descuentos por ítem con fecha (combustible / extraviados / proveedores) ──
// Registros de un tipo para un conductor (sin filtrar por fecha).
function descItemsDe(tipo, conductor) {
  const key = conductorKey(conductor);
  return AppData.descItems.filter(x =>
    x.tipo === tipo && conductorKey(x.conductor) === key);
}

// Descuento de un tipo para un conductor dentro de un período (suma las cuotas
// cuya fecha cae en el rango, o todas si no hay filtro). Espeja adelantoDescuentoConductor.
// Devuelve { monto, detalle: [{ fecha, monto, referencia }] }.
// incluirExcluidos = true → devuelve también los marcados "no imputar" (con
// imputar:false), para que el modal de liquidación pueda mostrarlos destildados.
// El monto SIEMPRE suma solo los imputables.
function descItemDescuentoConductor(tipo, conductor, rango, incluirExcluidos) {
  const key = conductorKey(conductor);
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let monto = 0; const detalle = [];
  AppData.descItems.forEach(x => {
    if (x.tipo !== tipo) return;
    if (!esAutorizado(x)) return;         // extravío pendiente de autorización: no impacta
    if (_num(x.cuotas_total) > 1) return; // cuoteado: no se imputa el total de una, va por cuotas
    if (conductorKey(x.conductor) !== key) return;
    const imputable = x.imputar !== false; // excluido a mano: no descuenta
    if (!imputable && !incluirExcluidos) return;
    if (desde || hasta) {
      const f = parseFechaReg(x.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    if (imputable) monto += _num(x.monto);
    detalle.push({ id: x.id, fecha: x.fecha, monto: _num(x.monto), referencia: x.referencia || '', detalleTxt: x.detalle || '', imputar: imputable });
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
  const key = conductorKey(conductor);
  const itemsTotal = {}; // item_id → cuotas_total (saldos cuoteados del conductor)
  const itemsRef = {};   // item_id → de qué es (proveedor / tracking), para el PDF
  // Se cuotean extravíos y servicios de proveedores; combustible y km van enteros.
  AppData.descItems.forEach(x => {
    if ((x.tipo === 'extraviados' || x.tipo === 'proveedores') && _num(x.cuotas_total) > 1 &&
        conductorKey(x.conductor) === key && esAutorizado(x)) {
      itemsTotal[x.id] = _num(x.cuotas_total);
      itemsRef[x.id] = String(x.referencia || x.detalle || '').trim();
    }
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
    detalle.push({ nro: c.nro, total: itemsTotal[c.item_id] || 0, monto: _num(c.monto), ref: itemsRef[c.item_id] || '' });
  });
  detalle.sort((x, y) => x.nro - y.nro);
  return { monto, detalle };
}

// ── Neto real de una liquidación ────────────────────────────────────────────
// Todo lo que mueve el bruto en un período: el adicional por km (suma) y los
// descuentos imputados (restan). ES LA MISMA CUENTA QUE HACE EL PDF: el panel
// mostraba el bruto pelado, así que el número de la pantalla no era el que se
// le terminaba pagando al conductor.
// descuentosOverride: los montos que el operador dejó tildados en el modal;
// sin él se calculan por fecha, igual que en la descarga masiva.
// Diferencial por recorridos ESPECIALES del período. Son rutas de envíos
// problemáticos —5 a 10 direcciones muy dispersas— que se pactan a un monto fijo
// que no tiene relación con lo que suman esos envíos por tarifa de zona. Lo que
// se guarda es la DIFERENCIA entre lo pactado y lo que el día ya paga, así el
// conductor termina cobrando la ruta completa. SUMA al neto, igual que los km.
function recorridoEspecialConductor(conductor, rango, incluirExcluidos) {
  const key = conductorKey(conductor);
  const desde = rango && rango.desde ? parseFechaReg(rango.desde) : null;
  let hasta = rango && rango.hasta ? parseFechaReg(rango.hasta) : null;
  if (desde) desde.setHours(0, 0, 0, 0);
  if (hasta) hasta.setHours(23, 59, 59, 999);
  let monto = 0, n = 0;
  const detalle = [];
  (AppData.recorridosEspeciales || []).forEach(d => {
    if (conductorKey(d.conductor) !== key) return;
    if (desde || hasta) {
      const f = parseFechaReg(d.fecha);
      if (!f) return;
      if (desde && f < desde) return;
      if (hasta && f > hasta) return;
    }
    // Solo suma lo AUTORIZADO: un recorrido pendiente de aprobación no puede
    // entrar en la liquidación, igual que un adelanto o un extravío.
    const imputa = d.imputar !== false && esAutorizado(d);
    if (imputa) { monto += _num(d.monto); n++; }
    if (incluirExcluidos || imputa) {
      detalle.push({ id: d.id, fecha: d.fecha || '', valor_ruta: _num(d.valor_ruta),
                     base: _num(d.base), monto: _num(d.monto), detalle: d.detalle || '',
                     estado: d.estado || 'autorizado', imputar: imputa });
    }
  });
  detalle.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  return { monto, n, detalle };
}

// El recorrido especial ya cargado para ese conductor y ese día, si lo hay.
function recorridoEspecialDe(conductor, fecha) {
  const key = conductorKey(conductor);
  const f = String(fecha || '').trim();
  return (AppData.recorridosEspeciales || []).find(d =>
    conductorKey(d.conductor) === key && String(d.fecha || '').trim() === f) || null;
}

function imputacionesConductor(conductor, rango, descuentosOverride) {
  const d = descuentosOverride || {
    combustible: descItemDescuentoConductor('combustible', conductor, rango).monto,
    extraviados: descItemDescuentoConductor('extraviados', conductor, rango).monto,
    proveedores: descItemDescuentoConductor('proveedores', conductor, rango).monto
  };
  const items = _num(d.combustible) + _num(d.extraviados) + _num(d.proveedores);
  const km  = kmAdicionalConductor(conductor, rango).monto;
  const especial = recorridoEspecialConductor(conductor, rango).monto;
  const adelanto = adelantoDescuentoConductor(conductor, rango).monto;
  const extravioCuota = extravioCuotaDescuento(conductor, rango).monto;
  const descuentos = items + adelanto + extravioCuota;
  return { km, especial, items, adelanto, extravioCuota, descuentos, hay: km > 0 || especial > 0 || descuentos > 0 };
}
// bruto + adicionales − descuentos. Nunca baja de 0: un neto negativo en el
// papel sería plata que el conductor le debe a la empresa, y eso se arrastra
// como saldo, no se paga en negativo.
function netoLiquidacion(bruto, imp) {
  return Math.max(0, _num(bruto) + _num(imp && imp.km) + _num(imp && imp.especial) - _num(imp && imp.descuentos));
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

// ===== VÍNCULO RECORRIDO ↔ PANEL DE CONDUCTORES =====
// Los recorridos identifican al conductor sólo por el texto "cadete", que puede
// no coincidir con el nombre cargado en el panel (apodos: "Fer" vs "Fernando",
// 2° nombre, typos, doble espacio). Normalizamos (mayúsculas, sin acentos, un
// solo espacio) y además permitimos "alias": nombres tal como aparecen en los
// recorridos, cargados en el panel para vincularlos a mano. Así la categoría del
// panel se aplica aunque el nombre difiera.
// Memo: normNombre se llama MILES de veces por render (una por fila × varias
// tablas) siempre con el mismo puñado de nombres/zonas. Cachear el resultado del
// translit (6 regex) evita recomputarlo y descongestiona el cálculo de precios.
const _normCache = new Map();
function normNombre(s) {
  const key = s == null ? '' : String(s);
  const hit = _normCache.get(key);
  if (hit !== undefined) return hit;
  const out = key
    .toUpperCase()
    // Saca acentos y ñ con un translit explícito (evita marcas combinantes).
    .replace(/[ÁÀÄÂÃ]/g, 'A')
    .replace(/[ÉÈËÊ]/g, 'E')
    .replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔÕ]/g, 'O')
    .replace(/[ÚÙÜÛ]/g, 'U')
    .replace(/Ñ/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
  if (_normCache.size < 50000) _normCache.set(key, out);   // cota para no crecer sin límite
  return out;
}

// Lista de alias normalizados de un conductor del panel (separados por ";").
function panelAliasNorm(c) {
  return String(c && c.alias || '').split(';').map(normNombre).filter(Boolean);
}

// Índice normalizado (nombre + alias) → conductor del panel. Cacheado para que el
// matching sea O(1): se usa una vez por recorrido en varios cálculos (miles de
// filas). Se reconstruye cuando cambia el set de conductores o sus nombres/alias
// (ver invalidarIndicePanel). Un cambio de categoría NO requiere invalidar: el
// Map guarda la referencia al objeto, que se muta in-place.
let _indicePanelCache = null;
function invalidarIndicePanel() { _indicePanelCache = null; invalidarLiquidaciones(); }
function _indicePanel() {
  if (_indicePanelCache) return _indicePanelCache;
  const m = new Map();
  (AppData.panelConductores || []).forEach(c => {
    const kn = normNombre(c.nombre);
    if (kn && !m.has(kn)) m.set(kn, c);                    // el nombre tiene prioridad
    panelAliasNorm(c).forEach(a => { if (!m.has(a)) m.set(a, c); });
  });
  _indicePanelCache = m;
  return m;
}

// Busca en el panel el conductor que corresponde a un nombre de recorrido,
// matcheando por nombre normalizado O por cualquiera de sus alias.
function panelConductorDe(nombre) {
  const n = normNombre(nombre);
  if (!n) return undefined;
  return _indicePanel().get(n);
}

// Nombre canónico de un conductor: si el nombre del recorrido está vinculado a un
// conductor del panel (por nombre o alias), devuelve el nombre del panel; si no,
// el nombre tal cual. Es la CLAVE de identidad: unifica todas las grafías/alias de
// una misma persona en un solo conductor para liquidaciones, detalle, super SLA y
// condición (día de pago).
function conductorCanonico(nombre) {
  const p = panelConductorDe(nombre);
  return p ? p.nombre : String(nombre || '').trim();
}

// Clave de identidad canónica y normalizada de un conductor. La usan los helpers
// de descuentos/adelantos/extravíos para imputar al conductor UNIFICADO (así un
// descuento cargado con un alias/grafía distinta se aplica igual).
function conductorKey(nombre) {
  return normNombre(conductorCanonico(nombre));
}

// Deduplica el panel de conductores: colapsa entradas repetidas por nombre
// (queda la más completa: con condición/categoría/alias) y garantiza IDs únicos.
// Un ID repetido rompe la sincronización con la nube: `id` es PRIMARY KEY, así que
// el insert de dbPush('panel_conductores') falla y la tabla queda vacía. Se aplica
// al cargar, al hidratar y antes de pushear.
function dedupePanelConductores(lista) {
  const arr = Array.isArray(lista) ? lista : [];
  const completitud = c => (String(c && c.condicion || '').trim() ? 2 : 0) +
                           (String(c && c.categoria || '').trim() ? 1 : 0) +
                           (String(c && c.alias || '').trim() ? 1 : 0);
  // 1) Colapsar por nombre normalizado (una sola entrada por persona; la más completa).
  const porNombre = new Map();
  arr.forEach(c => {
    const k = normNombre(c && c.nombre);
    if (!k) return;                                  // descartar entradas sin nombre
    const prev = porNombre.get(k);
    if (!prev || completitud(c) > completitud(prev)) porNombre.set(k, Object.assign({}, c));
  });
  // 2) Garantizar IDs únicos (evita el choque de PRIMARY KEY).
  const out = Array.from(porNombre.values());
  const usados = new Set();
  let maxN = 0;
  out.forEach(c => { const m = /^LH(\d+)$/i.exec(String(c.id || '')); if (m) maxN = Math.max(maxN, parseInt(m[1], 10)); });
  out.forEach(c => {
    let id = String(c.id || '').trim();
    if (!id || usados.has(id)) { id = 'LH' + String(++maxN).padStart(5, '0'); c.id = id; }
    usados.add(id);
  });
  return out;
}

// ===== PRICE LOGIC =====
// Devuelve el precio a aplicar para un cadete en una zona puntual.
// 1) Super SLA: si el cadete tiene regla especial para ESA zona, se respeta.
// 2) Si no hay regla Super SLA para esa zona (aunque el cadete tenga Super SLA
//    en OTRA zona), se cae al precio "SLA Cumplido" estándar de la zona.
// 3) Si el cadete no tiene ninguna relación con Super SLA, se usa el tipo fijo
//    asignado en "Categorización de Conductores" (s_colecta | c_colecta | sla).
// Índices cacheados para getPrecio (evitan escanear superSLA/tarifas —con
// normNombre— por CADA envío, que era el gran cuello de botella con ~10k filas).
// Se reconstruyen cuando cambian tarifas/superSLA (ver invalidarIndiceTarifas).
let _superSLAIdxCache = null, _tarifaIdxCache = null;
function invalidarIndiceTarifas() { _superSLAIdxCache = null; _tarifaIdxCache = null; invalidarLiquidaciones(); }
function _superSLAIndex() {
  if (_superSLAIdxCache) return _superSLAIdxCache;
  const porCond = new Map();   // normCond -> Map(normZona -> precio)
  (AppData.superSLA || []).forEach(r => {
    const c = normNombre(r.conductor); if (!c) return;
    let zm = porCond.get(c); if (!zm) { zm = new Map(); porCond.set(c, zm); }
    zm.set(normNombre(r.zona), _num(r.precio != null ? r.precio : r.sla));
  });
  _superSLAIdxCache = porCond;
  return porCond;
}
function _tarifaIndex() {
  if (_tarifaIdxCache) return _tarifaIdxCache;
  const m = new Map();
  (AppData.tarifas || []).forEach(t => { m.set(normNombre(t.zona), t); });
  _tarifaIdxCache = m;
  return m;
}

function getPrecio(conductor, zona) {
  // La zona del envío pasa por el alias ANTES de buscar la tarifa. Hasta ahora
  // el alias solo se aplicaba al guardar tarifarios, así que un envío en una
  // zona con alias no lo usaba nunca: los dos lados tienen que resolver la zona
  // igual, si no el conductor cobra por una zona y al cliente se le factura $0.
  const zNorm = normNombre(typeof zonaCanonica === 'function' ? zonaCanonica(zona) : zona);

  // Categoría y nombre canónico desde el panel (resuelve alias). El super SLA se
  // guarda con el nombre del panel, así que hay que matchearlo por el canónico
  // para que aplique aunque el recorrido use otra grafía/alias.
  const panelCond = panelConductorDe(conductor);
  const cNorm = normNombre(panelCond ? panelCond.nombre : conductor);

  const superZonas = _superSLAIndex().get(cNorm);          // Map(zona -> precio) o undefined
  const superPrecio = superZonas ? superZonas.get(zNorm) : undefined;
  const tarifa = _tarifaIndex().get(zNorm);
  const tipoFijo = panelCond?.categoria === 'super_sla' ? 'sla' : (panelCond?.categoria || 's_colecta');
  const tieneSuperSLAEnOtraZona = !!(superZonas && superZonas.size);

  if (superPrecio !== undefined) {
    return { precio: superPrecio ?? 0, tipo: 'sla', es_super: true, sin_tarifa: false };
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

// Opcional: pasar un subconjunto de registros (ej. filtrados por período del
// dashboard). Por defecto usa todos los de AppData.
// Memo de vida corta: dentro de un mismo render varias vistas piden lo mismo
// (Dashboard + sus dos reportes, Liquidaciones, el selector de Conductores).
// El TTL chico evita recálculos en cascada SIN riesgo de mostrar plata vieja:
// además se invalida explícitamente ante cualquier cambio de datos o precios.
let _liqCache = { t: 0, data: null };
function invalidarLiquidaciones() { _liqCache.t = 0; _liqCache.data = null; _liqCache.src = null;
  if (typeof invalidarFiltroFecha === 'function') invalidarFiltroFecha(); }
// El TTL era de 250 ms, menos de lo que tarda UN render del Dashboard con 47.684
// envíos (~1,1 s): el reporte por zona/conductor volvía a calcular lo mismo que
// se acababa de calcular. Se sube a 3 s porque la garantía real no es el TTL sino
// la invalidación explícita —hay 18 puntos que la llaman ante cualquier cambio de
// envío, panel, tarifa o dimensión— y además se descarta el caché si el array de
// registros dejó de ser el mismo.
const _LIQ_TTL_MS = 3000;

function calcLiquidaciones(records) {
  // El caché se lleva por IDENTIDAD del array, no por "es la base entera": con un
  // filtro de fecha puesto, el Dashboard y su reporte reciben el MISMO array
  // filtrado y antes cada uno recalculaba los 47.684 envíos desde cero.
  // filtrarRecordsPorFecha devuelve una referencia estable para el mismo rango,
  // así que la segunda llamada del render da en el caché.
  const cacheable = true;
  const base = records || AppData.records || [];
  if (cacheable && _liqCache.data && (Date.now() - _liqCache.t) < _LIQ_TTL_MS
      && _liqCache.src === base && _liqCache.n === base.length) return _liqCache.data;
  const byDriver = {};
  base.forEach(r => {
    // Identidad canónica: unifica alias/grafías de una misma persona en un solo
    // conductor (una sola liquidación), en vez de duplicarlo por cada nombre.
    const cond = conductorCanonico(r.cadete);
    if (!cond) return;

    const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
    const estadoNorm = (r.estado || '').toUpperCase().trim();
    const contabiliza = contabilizaRegistro(r);
    const fecha = r.fecha || '';
    const tracking = r.tracking || '';
    const zona_precio = r.zona_precio || '';

    if (!byDriver[cond]) {
      byDriver[cond] = { conductor: cond, filas: [], filas_excluidas: [], total: 0, total_excluido_count: 0 };
    }

    if (contabiliza) {
      // ¿Este envío tiene una DIMENSIÓN ESPECIAL asignada (a mano, desde
      // Conductores)? Si sí, REEMPLAZA el precio tradicional por el de la
      // dimensión en la zona de entrega (no lo suma).
      const dim = dimensionAsignada(r);

      let precio, tipo, es_super = false, sin_tarifa = false;
      let es_dim_especial = false;
      let dim_cliente = '', dim_condicion = '';

      if (dim) {
        precio = dim.precio;
        tipo = 'dim_especial';
        es_dim_especial = true;
        sin_tarifa = dim.sinPrecioZona;   // dimensión asignada sin precio en esa zona
        dim_cliente = dim.cliente || '';
        dim_condicion = dim.nombre || '';
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
        es_dim_especial, dim_cliente, dim_condicion,
        manual: !!r.manual, zona_manual: !!r.zona_manual,
        precio_corregido: precioManualDe(r) !== null, corregido: esCorregidoRegistro(r)
      });
      byDriver[cond].total += subtotal;
    } else {
      byDriver[cond].filas_excluidas.push({ tracking, zona, zona_precio, fecha, estado: r.estado });
      byDriver[cond].total_excluido_count++;
    }
  });
  // Las filas se arman en el orden en que están los registros (orden de
  // importación). Las ordenamos por FECHA DE ENVÍO para que el detalle y el PDF
  // sigan la cronología real aunque un día se haya cargado tarde.
  Object.keys(byDriver).forEach(k => {
    _ordenarPorFechaEnvio(byDriver[k].filas);
    _ordenarPorFechaEnvio(byDriver[k].filas_excluidas);
  });
  if (cacheable) { _liqCache.t = Date.now(); _liqCache.data = byDriver; _liqCache.src = base; _liqCache.n = base.length; }
  return byDriver;
}

// Comparador por fecha de envío (DD/MM/YYYY). Sin fecha → al final.
function _cmpPorFechaEnvio(a, b) {
  const fa = parseFechaReg(a.fecha), fb = parseFechaReg(b.fecha);
  const ta = fa ? fa.getTime() : Infinity, tb = fb ? fb.getTime() : Infinity;
  if (ta !== tb) return ta - tb;
  return String(a.tracking || '').localeCompare(String(b.tracking || ''));
}

// Ordena filas por fecha de envío SIN pagar un Date por comparación.
// _cmpPorFechaEnvio llama a parseFechaReg —que aloca un Date— para los DOS
// operandos en cada comparación: ordenar los 47.684 envíos de una liquidación
// completa creaba ~810.000 Date para tirarlos enseguida, y eso solo era el 85%
// del tiempo de calcLiquidaciones (1.094 ms de los que 940 eran esto).
// Se decora una vez por fila, se ordena por la clave ya calculada y se saca.
// El criterio es el MISMO: fecha, después tracking, y sin fecha va al final.
let _colador = null;
function _ordenarPorFechaEnvio(arr) {
  const n = arr.length;
  if (n < 2) return;
  if (!_colador) { try { _colador = new Intl.Collator(); } catch (e) { _colador = { compare: (x, y) => x.localeCompare(y) }; } }
  const dec = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = parseFechaReg(arr[i].fecha);
    dec[i] = { t: f ? f.getTime() : Infinity, k: String(arr[i].tracking || ''), v: arr[i] };
  }
  dec.sort((x, y) => (x.t - y.t) || _colador.compare(x.k, y.k));
  for (let i = 0; i < n; i++) arr[i] = dec[i].v;
}

// ═══ Dimensiones especiales (catálogo por cliente, precio por zona) ══════════
// El catálogo (AppData.dimCatalogo) guarda un precio por (cliente, dimensión,
// zona). La asignación a un envío vive en el registro (dim_especial + dim_cliente)
// y el precio aplicado sale de la zona de entrega del envío.
function dimClientes() {
  const m = new Map();
  AppData.dimCatalogo.forEach(d => { const k = normNombre(d.cliente); if (k && !m.has(k)) m.set(k, d.cliente); });
  return Array.from(m.values()).sort((a, b) => String(a).localeCompare(String(b)));
}
function dimNombresDe(cliente) {
  const ck = normNombre(cliente), m = new Map();
  AppData.dimCatalogo.forEach(d => { if (normNombre(d.cliente) === ck) { const k = normNombre(d.nombre); if (k && !m.has(k)) m.set(k, d.nombre); } });
  return Array.from(m.values()).sort((a, b) => String(a).localeCompare(String(b)));
}
// Una dimensión tiene DOS precios que no tienen por qué coincidir: lo que se le
// PAGA al conductor por llevarla y lo que se le COBRA al cliente por ese envío.
// El tipo elige el tarifario; 'conductor' por defecto, que es el uso histórico.
// Índice del catálogo de dimensiones. Mismo motivo que el de tarifas: esto se
// resuelve una vez por ENVÍO y el catálogo real tiene 6.829 filas, así que el
// find lineal costaba 0,36 ms por llamada — con 47.684 envíos, 17 s por render.
// Clave: tipo|cliente|condición  ->  Map(zonaNorm -> {zona, precio})
let _dimIdxCache = null;
function invalidarIndiceDim() { _dimIdxCache = null; invalidarLiquidaciones(); }
function _dimIndex() {
  // Misma guarda que el índice del tarifario de venta: el panel de Dimensiones
  // muta AppData.dimCatalogo en memoria (push/splice/filter) en ocho lugares, y
  // un índice viejo devolvería un precio equivocado en silencio.
  const arr = AppData.dimCatalogo || [];
  if (_dimIdxCache && (_dimIdxCache.src !== arr || _dimIdxCache.n !== arr.length)) _dimIdxCache = null;
  if (_dimIdxCache) return _dimIdxCache;
  const m = new Map();
  arr.forEach(d => {
    const k = ((d.tipo || 'conductor') === 'cliente' ? 'cliente' : 'conductor') +
      '|' + normNombre(d.cliente) + '|' + normNombre(d.nombre);
    let zm = m.get(k); if (!zm) { zm = new Map(); m.set(k, zm); }
    const zk = normNombre(d.zona), precio = _num(d.precio);
    // Entre dos filas repetidas gana la que TIENE precio: una fila en $0 es la
    // condición registrada esperando valor, no un precio acordado. Es el mismo
    // criterio de _colapsarRepetidas y de dimensionAsignada.
    const prev = zm.get(zk);
    if (prev === undefined || (!(prev.precio > 0) && precio > 0)) zm.set(zk, { zona: d.zona, precio });
  });
  m.src = arr; m.n = arr.length;
  _dimIdxCache = m;
  return m;
}
function _dimClave(cliente, nombre, tipo) {
  return (tipo === 'cliente' ? 'cliente' : 'conductor') + '|' + normNombre(cliente) + '|' + normNombre(nombre);
}
function dimPrecioEnZona(cliente, nombre, zona, tipo) {
  const t = tipo === 'cliente' ? 'cliente' : 'conductor';
  // La zona pasa por el alias antes de buscar, igual que en getPrecio y en
  // clienteTarifaEnZona: los tres tienen que resolver la zona IGUAL. Si no, un
  // envío en PRESIDENTE PERON no encontraría su condición cargada en GUERNICA y
  // se liquidaría con la tarifa común sin que nadie lo note.
  const zk = normNombre(typeof zonaCanonica === 'function' ? zonaCanonica(zona) : zona);
  const zm = _dimIndex().get(_dimClave(cliente, nombre, t));
  const row = zm ? zm.get(zk) : undefined;
  return row ? row.precio : null;
}
// Zonas (con precio) en las que existe una dimensión de un cliente.
function dimZonasDe(cliente, nombre, tipo) {
  const t = tipo === 'cliente' ? 'cliente' : 'conductor';
  const zm = _dimIndex().get(_dimClave(cliente, nombre, t));
  return zm ? Array.from(zm.values()).map(v => ({ zona: v.zona, precio: v.precio })) : [];
}
// Dimensión asignada a un envío (o null). El precio sale de la zona de entrega.
function dimensionAsignada(r) {
  if (!r || !r.dim_especial) return null;
  const zona = (r.zona && r.zona.trim()) ? r.zona.trim() : (r.localidad || '').trim();
  const cli = r.dim_cliente || r.cliente || '';
  // Lo que se le paga al CONDUCTOR por esa dimensión.
  // Una fila en $0 NO es un precio: es la condición registrada esperando que le
  // carguen el valor (el aviso cruzado del panel las crea así). Cuenta igual que
  // "no hay precio en esa zona", si no el envío se pagaría $0 en silencio y sin
  // el cartel de "sin precio". Es el mismo criterio que dimPrecioVenta, que ya
  // exige > 0 del lado del cliente.
  const precio = dimPrecioEnZona(cli, r.dim_especial, zona, 'conductor');
  const sinPrecio = precio == null || !(_num(precio) > 0);
  return { cliente: cli, nombre: r.dim_especial, precio: sinPrecio ? 0 : _num(precio), sinPrecioZona: sinPrecio };
}

// Devuelve el precio corregido a mano de un registro, o null si no tiene.
function precioManualDe(r) {
  if (!r || r.precio_manual === null || r.precio_manual === undefined || r.precio_manual === '') return null;
  const n = parseFloat(r.precio_manual);
  return isNaN(n) ? null : n;
}

// ¿El operador tocó este envío a mano? = cargado a mano, zona definida a mano,
// o precio pisado. Sirve para localizar correcciones en Conductores y en la
// liquidación.
function esCorregidoRegistro(r) {
  return !!(r && (r.manual || r.zona_manual)) || precioManualDe(r) !== null;
}

// Lista de correcciones aplicadas ('manual' | 'zona' | 'precio'), para chips.
function correccionesDe(r) {
  const out = [];
  if (r && r.manual) out.push('manual');
  if (r && r.zona_manual) out.push('zona');
  if (precioManualDe(r) !== null) out.push('precio');
  return out;
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
// OJO: una VISITA PAGADA tiene clave propia (V:tracking|fecha). Es un evento
// cerrado —el conductor fue ese día y se le paga— y el listado no puede volver
// a pisarlo: al día siguiente otro conductor puede llevar el mismo envío y
// lograr la entrega, y esos son DOS trabajos que se pagan y se facturan por
// separado. Con la clave T: la fila del día 2 reemplazaba la del día 1 y el
// primer conductor perdía su visita.
function claveRegistro(r) {
  const t = String(r.tracking || '').trim();
  if (r && r.contabiliza_manual && trackingValido(t)) return 'V:' + t + '|' + String(r.fecha || '').trim();
  if (trackingValido(t)) return 'T:' + t;
  const dir = _normTxt(r.direccion);
  const dest = _normTxt(r.destinatario);
  if (dir) {
    const base = 'D:' + dir + '|' + dest;
    // Sin tracking real, lo único que ata dos filas al mismo envío es la
    // dirección. Eso se rompe con el cliente que le manda VARIAS VECES al mismo
    // comprador: un jueves y el martes siguiente, mismos datos, y la segunda
    // entrega pisaba a la primera — se perdía un envío entero, sin aviso (bug
    // real en GAMING CITY: 11 entregas). Una ENTREGA cierra el envío, con el
    // mismo criterio que la visita pagada: desde ahí la fecha entra en la clave
    // y una entrega posterior al mismo domicilio es OTRO envío, no la misma
    // fila otra vez. Mientras no esté entregado la clave queda ABIERTA, así la
    // 1ra y la 2da visita se siguen reconociendo como el mismo envío.
    if (esEstadoEntregado(r.estado)) return base + '|' + String(r.fecha || '').trim();
    return base;
  }
  return 'F:' + _normTxt([r.cadete, r.fecha, r.zona, r.localidad, dest].join('|'));
}

// Clave ABIERTA de un envío sin tracking real: la que tenía mientras no estaba
// entregado. La entrega la cierra agregándole la fecha, así que al fusionar hay
// que mirar las dos — si no, la fila intermedia ("En camino", "Nadie") quedaría
// para siempre al lado de la entrega, como un envío fantasma que no contabiliza
// pero ensucia el detalle.
function claveAbiertaRegistro(r) {
  const t = String(r.tracking || '').trim();
  if (trackingValido(t)) return null;
  const dir = _normTxt(r.direccion);
  if (!dir) return null;
  return 'D:' + dir + '|' + _normTxt(r.destinatario);
}

function tipoLabel(t) {
  if (t === 'c_colecta') return 'C/ Colecta';
  if (t === 's_colecta') return 'S/ Colecta';
  if (t === 'sla') return 'SLA Cumplido';
  if (t === 'dim_especial') return 'Dimensión Especial';
  if (t === 'manual') return 'Corregido manual';
  return t || '—';
}

// ¿Este envío se le paga al conductor?
// Dos vías: el estado dice que se entregó, O el operador lo contabilizó a mano
// desde el panel Conductores (MOTIVOS_CONTAB): el conductor fue al domicilio y
// no pudo entregar por una causa ajena (rechazo o cancelación en la puerta,
// nadie tras varios reintentos, dirección inexistente). El trabajo se hizo, así
// que se paga; el ESTADO del envío no se toca, sigue diciendo la verdad.
// OJO: rendiciones NO usa este helper — un envío no entregado no cobró nada al
// destinatario, así que no puede generar una rendición para reclamarle.
function contabilizaRegistro(r) {
  if (!r) return false;
  if (r.contabiliza_manual) return true;
  return esEstadoEntregado(r.estado);
}

// Motivos por los que una visita sin entrega igual se paga.
const MOTIVOS_CONTAB = [
  'Rechazado por el comprador en la puerta',
  'Cancelado en la puerta',
  'Reintentos sin éxito (nadie en el domicilio)',
  'Dirección inexistente o desconocida',
  'Otro'
];

// "Entregado" = estado que CONTABILIZA en la liquidación (incluye "2da visita"),
// para que los conteos (dashboard, resumen de import) coincidan con la plata.
function esEstadoEntregado(estado) {
  const e = (estado || '').toUpperCase().trim();
  return e === ESTADO_CONTABILIZA || ESTADOS_CONTABILIZAN.has(e);
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
  'liquidaciones': ['Liquidación Conductores', 'Cálculo y descarga por conductor'],
  'conductores': ['Detalle de conductores', 'Recorridos individuales'],
  'config-tarifas': ['Configuración de tarifas', 'Precios por zona y categoría'],
  'config-supersla': ['Super SLA', 'Tarifas especiales por conductor y zona'],
  'panel-conductores':  ['Panel de conductores', 'Condición, día de pago y categorización'],
  'monotributos': ['Monotributos', 'Documentación, cuentas y facturación de lo que se transfiere'],
  'dimensiones-especiales': ['Dimensiones Especiales', 'Trackings con condición y valor especial que reemplazan la tarifa'],
  'extraviados': ['Extraviados / Rotos', 'Envíos extraviados o rotos, con opción de cuotear'],
  'beneficios': ['Beneficios', 'Combustible y servicio de proveedores por conductor'],
  'km-desvio': ['Km de desvío', 'Adicional por km de desvío al retirar mercadería'],
  'adelantos': ['Adelantos', 'Préstamos en cuotas y deuda por conductor'],
  'clientes': ['Panel Clientes', 'Ficha, cuentas vinculadas y tarifario de venta por zona'],
  'detalle-cliente': ['Detalle de cliente', 'Revisar los envíos de la semana y armar la liquidación'],
  'cliente-liquidaciones': ['Liquidación de clientes', 'Descargar las liquidaciones que el administrativo dejó listas'],
  'comisiones': ['Comisiones', 'Comisiones de vendedores por clientes nuevos y cierre mensual'],
  'empleados': ['Empleados', 'Sueldos, ajustes trimestrales y liquidación mensual del personal'],
  'vacaciones': ['Vacaciones', 'Días que corresponden, licencias y superposiciones del personal'],
  'rendiciones': ['Rendición de envíos', 'Cobros en destino que el conductor debe rendir'],
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
      <i class="ic ic-calendar"></i> Carga del <strong>${s.fecha_carga}</strong> a las ${s.hora} hs — la información nueva
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

