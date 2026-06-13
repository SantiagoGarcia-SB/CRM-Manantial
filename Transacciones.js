// ─── TRANSACCIONES.GS ─────────────────────────────────────────────────────────
// Contrato público:
//   crearTransaccion(payload)           → {ok, transaccion, inscripcion?}
//   listarTransacciones(filtros)        → {transacciones:[], total:number}
//   obtenerResumenAsesor(email?)        → {transacciones:[], resumen:{}}
//   getHistorialTurno()                 → {transacciones:[], totales:{}}
//   getCarteraAsesor()                  → Object[]  (semáforo por persona)
//   actualizarEstadoLegalizacion(id,tipo,estado) → {ok}

/**
 * Payload esperado de crearTransaccion:
 * {
 *   idPersona:    string,
 *   nombrePersona:string,
 *   correoPersona:string,
 *   idActividad:  string,
 *   nombreActividad: string,
 *   monto:        number,
 *   metodoPago:   'Efectivo'|'Datáfono'|'Nequi',
 *   sede:         string,
 *   modulo?:      string,   // Si requiere inscripción
 *   horario?:     string,   // Si requiere inscripción
 *   // Campos datáfono (solo cuando metodoPago === 'Datáfono'):
 *   dtFranquicia?:            string,
 *   dtTipoTarjeta?:           string,
 *   dtValor?:                 number,
 *   dtBeneficiarioMismo?:     'Si'|'No',
 *   dtNombreBeneficiario?:    string,
 *   dtDocBeneficiario?:       string,
 *   dtCelularBeneficiario?:   string,
 *   dtNoAutorizacion?:        string,
 *   dtNoDatafono?:            string
 * }
 */
function crearTransaccion(payload) {
  const asesorInfo = requireRol_('asesor', 'coordinadora');
  validateRequired_(payload, ['idPersona','nombrePersona','idActividad','nombreActividad','monto','metodoPago','sede']);

  if (!['Efectivo','Datáfono','Nequi'].includes(payload.metodoPago)) {
    throw new Error('Método de pago inválido: ' + payload.metodoPago);
  }
  if (Number(payload.monto) < 0) throw new Error('El monto no puede ser negativo.');

  // Obtener actividad para leer sus flags
  const actividad = obtenerActividad(payload.idActividad);

  // Obtener periodo activo
  const periodo = getPeriodoActivo_();
  if (!periodo) {
    // Advertencia: continuar sin periodo
    Logger.log('ADVERTENCIA: No hay periodo activo configurado.');
  }

  const ahora  = new Date();
  const idTrans = generateId_('TRN');

  // Determinar estados de legalización
  const estadoIglesia  = actividad.legalizarIglesia  ? 'Pendiente' : 'NA';
  const estadoAcademia = actividad.legalizarAcademia ? 'Pendiente' : 'NA';

  // Insertar en Transacciones
  const sheet = getSheet_('Transacciones', true);
  sheet.appendRow([
    idTrans,
    ahora,
    payload.idPersona,
    payload.nombrePersona,
    payload.nombreActividad,
    payload.sede,
    Number(payload.monto),
    payload.metodoPago,
    asesorInfo.email,
    asesorInfo.nombre,
    estadoIglesia,
    estadoAcademia,
    periodo ? periodo.id : '',
    payload.dtFranquicia             || '',
    payload.dtTipoTarjeta            || '',
    payload.dtValor                  || '',
    payload.dtBeneficiarioMismo      || '',
    payload.dtNombreBeneficiario     || '',
    payload.dtDocBeneficiario        || '',
    payload.dtCelularBeneficiario    || '',
    payload.dtNoAutorizacion         || '',
    payload.dtNoDatafono             || ''
  ]);

  const transaccion = {
    id:              idTrans,
    timestamp:       formatDate_(ahora),
    idPersona:       payload.idPersona,
    nombrePersona:   payload.nombrePersona,
    actividad:       payload.nombreActividad,
    sede:            payload.sede,
    monto:           Number(payload.monto),
    metodoPago:      payload.metodoPago,
    asesorEmail:     asesorInfo.email,
    asesorNombre:    asesorInfo.nombre,
    estadoIglesia,
    estadoAcademia,
    periodo:         periodo ? periodo.nombre : 'Sin periodo'
  };

  // ── Generar filas de Legalizaciones según flags ──────────────────────────
  const legalizaciones = [];
  if (actividad.legalizarIglesia) {
    const idLegal = crearEntradaLegalizacion_(idTrans, 'iglesia');
    legalizaciones.push({ tipo: 'iglesia', id: idLegal });
  }
  if (actividad.legalizarAcademia) {
    const idLegal = crearEntradaLegalizacion_(idTrans, 'academia');
    legalizaciones.push({ tipo: 'academia', id: idLegal });
  }

  // ── Generar inscripción si aplica ────────────────────────────────────────
  let inscripcion = null;
  if (actividad.requiereInscripcion) {
    inscripcion = crearInscripcionDesdeTransaccion_({
      idTrans,
      idPersona:    payload.idPersona,
      actividad:    payload.nombreActividad,
      modulo:       payload.modulo  || '',
      horario:      payload.horario || '',
      sede:         payload.sede,
      periodo:      periodo ? periodo.id : '',
      asesorEmail:  asesorInfo.email
    });
  }

  // ── Enviar email de confirmación (no bloquear si falla) ──────────────────
  try {
    if (payload.correoPersona) {
      enviarConfirmacion({
        nombre:    payload.nombrePersona,
        correo:    payload.correoPersona,
        actividad: payload.nombreActividad,
        monto:     Number(payload.monto),
        metodo:    payload.metodoPago,
        asesor:    asesorInfo.nombre,
        fecha:     formatDate_(ahora),
        periodo:   periodo ? periodo.nombre : ''
      });
    }
  } catch (e) {
    Logger.log('Email no enviado: ' + e.message);
  }

  return { ok: true, transaccion, inscripcion, legalizaciones };
}

/**
 * Lista transacciones con filtros combinables.
 * @param {{sede?:string, asesorEmail?:string, actividad?:string, metodoPago?:string,
 *          estadoIglesia?:string, estadoAcademia?:string,
 *          fechaDesde?:string, fechaHasta?:string,
 *          periodo?:string, page?:number, pageSize?:number}} filtros
 * @returns {{transacciones:Object[], total:number}}
 */
function listarTransacciones(filtros = {}) {
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones');

  if (filtros.sede)          trans = trans.filter(t => t.Sede === filtros.sede);
  if (filtros.asesorEmail)   trans = trans.filter(t => t.Asesor_Email === filtros.asesorEmail);
  if (filtros.actividad)     trans = trans.filter(t => (t.Actividad||'').toLowerCase().includes(filtros.actividad.toLowerCase()));
  if (filtros.metodoPago)    trans = trans.filter(t => t.Metodo_Pago === filtros.metodoPago);
  if (filtros.estadoIglesia) trans = trans.filter(t => t.Estado_Legalizacion_Iglesia === filtros.estadoIglesia);
  if (filtros.estadoAcademia)trans = trans.filter(t => t.Estado_Legalizacion_Academia === filtros.estadoAcademia);
  if (filtros.periodo)       trans = trans.filter(t => t.Periodo === filtros.periodo);

  if (filtros.fechaDesde) {
    const desde = new Date(filtros.fechaDesde);
    trans = trans.filter(t => t.Timestamp && new Date(t.Timestamp) >= desde);
  }
  if (filtros.fechaHasta) {
    const hasta = new Date(filtros.fechaHasta);
    hasta.setHours(23, 59, 59);
    trans = trans.filter(t => t.Timestamp && new Date(t.Timestamp) <= hasta);
  }

  // Rango de tiempo predefinido
  if (filtros.rango) {
    const ahora   = new Date();
    let   fechaMin;
    if (filtros.rango === 'hoy') {
      fechaMin = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    } else if (filtros.rango === 'semana') {
      fechaMin = new Date(ahora);
      fechaMin.setDate(ahora.getDate() - 7);
    }
    if (fechaMin) trans = trans.filter(t => t.Timestamp && new Date(t.Timestamp) >= fechaMin);
  }

  // Ordenar por más reciente
  trans.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

  const total    = trans.length;
  const page     = filtros.page     || 1;
  const pageSize = filtros.pageSize || 50;
  const start    = (page - 1) * pageSize;

  return {
    transacciones: trans.slice(start, start + pageSize).map(mapTransaccion_),
    total, page, pageSize
  };
}

/**
 * Retorna el resumen del turno actual (hoy) para el asesor logueado.
 * @returns {{transacciones:Object[], totales:{efectivo:number, datafono:number, nequi:number, total:number}}}
 */
function getHistorialTurno() {
  const asesorInfo = requireRol_('asesor', 'coordinadora');
  const ahora      = new Date();
  const inicioHoy  = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

  const trans = sheetToObjects_('Transacciones')
    .filter(t =>
      t.Asesor_Email === asesorInfo.email &&
      t.Timestamp && new Date(t.Timestamp) >= inicioHoy
    )
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .map(mapTransaccion_);

  const totales = trans.reduce((acc, t) => {
    acc.total += t.monto;
    if (t.metodoPago === 'Efectivo')  acc.efectivo  += t.monto;
    if (t.metodoPago === 'Datáfono')  acc.datafono  += t.monto;
    if (t.metodoPago === 'Nequi')     acc.nequi     += t.monto;
    return acc;
  }, { efectivo: 0, datafono: 0, nequi: 0, total: 0 });

  return { transacciones: trans, totales };
}

/**
 * Retorna la cartera del asesor: personas con pagos recientes y su estado de legalización.
 * Semáforo: verde=legalizado, amarillo=pendiente ≤7 días, rojo=pendiente >7 días
 * @returns {Object[]}
 */
function getCarteraAsesor() {
  const asesorInfo = requireRol_('asesor', 'coordinadora');
  const ahora      = new Date();

  const trans = sheetToObjects_('Transacciones')
    .filter(t => t.Asesor_Email === asesorInfo.email)
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

  // Agrupar por persona (última transacción de cada una)
  const porPersona = {};
  trans.forEach(t => {
    if (!porPersona[t.ID_Persona]) {
      porPersona[t.ID_Persona] = t;
    }
  });

  return Object.values(porPersona).map(t => {
    const fecha  = new Date(t.Timestamp);
    const diasP  = Math.floor((ahora - fecha) / (1000 * 60 * 60 * 24));
    const iglesiaPendiente  = t.Estado_Legalizacion_Iglesia  === 'Pendiente';
    const academiaPendiente = t.Estado_Legalizacion_Academia === 'Pendiente';
    const hayPendiente      = iglesiaPendiente || academiaPendiente;

    let semaforo;
    if (!hayPendiente)           semaforo = 'verde';
    else if (diasP <= 7)         semaforo = 'amarillo';
    else                         semaforo = 'rojo';

    return {
      idPersona:       t.ID_Persona,
      nombrePersona:   t.Nombre_Persona,
      ultimaActividad: t.Actividad,
      ultimaMonto:     t.Monto,
      ultimaFecha:     formatDate_(fecha),
      diasDesde:       diasP,
      semaforo,
      estadoIglesia:   t.Estado_Legalizacion_Iglesia,
      estadoAcademia:  t.Estado_Legalizacion_Academia
    };
  }).sort((a, b) => {
    const orden = { rojo: 0, amarillo: 1, verde: 2 };
    return orden[a.semaforo] - orden[b.semaforo];
  });
}

/**
 * Actualiza el estado de legalización de una transacción (llamado desde Legalizacion.gs también).
 * @param {string} idTrans
 * @param {'iglesia'|'academia'} tipo
 * @param {'Pendiente'|'Legalizado'|'NA'} estado
 * @returns {{ok:boolean}}
 */
function actualizarEstadoLegalizacion(idTrans, tipo, estado) {
  requireRol_('coordinadora');
  const sheet   = getSheet_('Transacciones');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx   = headers.indexOf('ID_Trans');
  const colMap  = {
    iglesia:  'Estado_Legalizacion_Iglesia',
    academia: 'Estado_Legalizacion_Academia'
  };
  const col = colMap[tipo];
  if (!col) throw new Error('Tipo de legalización inválido: ' + tipo);

  const colIdx = headers.indexOf(col);
  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === idTrans) {
      sheet.getRange(i + 1, colIdx + 1).setValue(estado);
      return { ok: true };
    }
  }
  throw new Error('Transacción no encontrada: ' + idTrans);
}

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

function mapTransaccion_(t) {
  return {
    id:              t.ID_Trans,
    timestamp:       t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
    idPersona:       t.ID_Persona,
    nombrePersona:   t.Nombre_Persona,
    actividad:       t.Actividad,
    sede:            t.Sede,
    monto:           Number(t.Monto) || 0,
    metodoPago:      t.Metodo_Pago,
    asesorEmail:     t.Asesor_Email,
    asesorNombre:    t.Asesor_Nombre,
    estadoIglesia:   t.Estado_Legalizacion_Iglesia,
    estadoAcademia:  t.Estado_Legalizacion_Academia,
    periodo:         t.Periodo,
    dtFranquicia:            t.Datafono_Franquicia           || '',
    dtTipoTarjeta:           t.Datafono_Tipo_Tarjeta         || '',
    dtValor:                 Number(t.Datafono_Valor)        || 0,
    dtBeneficiarioMismo:     t.Datafono_Beneficiario_Mismo   || '',
    dtNombreBeneficiario:    t.Datafono_Nombre_Beneficiario  || '',
    dtDocBeneficiario:       t.Datafono_Doc_Beneficiario     || '',
    dtCelularBeneficiario:   t.Datafono_Celular_Beneficiario || '',
    dtNoAutorizacion:        t.Datafono_No_Autorizacion      || '',
    dtNoDatafono:            t.Datafono_No_Datafono          || ''
  };
}
