// ─── TRANSACCIONES.GS ─────────────────────────────────────────────────────────
// Contrato público:
//   crearTransaccion(payload)              → {ok, transaccion, inscripcion?}
//   anularTransaccion(idTrans)             → {ok}
//   actualizarTransaccion(idTrans, datos)  → {ok}  (corrección de errores, solo activas)
//   listarTransacciones(filtros)           → {transacciones:[], total:number}
//   getHistorialTurno(sede?)               → {transacciones:[], totales:{}}
//   getCarteraAsesor()                     → Object[]  (semáforo por persona)
//   exportarTransaccionesDatafono(filtros) → Object[]  (datos para CSV frontend)
//   obtenerSaldoActividad(params)          → {valorEsperado, totalPagado, saldoPendiente}
//   getCarteraAbonos()                     → Object[]  (personas con saldo pendiente en actividades con abonos)

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
 *   dtTitularMismo?:     'Si'|'No',
 *   dtNombreTitular?:    string,   // Datos del titular de la tarjeta (cuando es diferente a la persona)
 *   dtDocTitular?:       string,
 *   dtCelularTitular?:   string,
 *   dtNoAutorizacion?:        string,
 *   dtNoDatafono?:            string,
 *   // Comprobante Nequi (solo cuando metodoPago === 'Nequi'):
 *   nequiComprobante?:        string  // data URL "data:image/jpeg;base64,...." desde el navegador
 * }
 */

/**
 * Decodifica una foto en base64 (data URL, ya comprimida en el navegador) y la
 * guarda como archivo en Drive. Lanza error si el formato no es una imagen válida.
 * @returns {string} URL del archivo guardado
 */
function guardarComprobanteNequi_(dataUrl, nombrePersona) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('El comprobante de Nequi no tiene un formato de imagen válido.');
  const mimeType = match[1];
  const ext      = mimeType.split('/')[1] || 'jpg';
  const bytes    = Utilities.base64Decode(match[2]);
  const nombreArchivo = 'Nequi_' + (nombrePersona || 'comprobante').replace(/[^\w\s-]/g, '') + '_' + Date.now() + '.' + ext;
  const blob = Utilities.newBlob(bytes, mimeType, nombreArchivo);
  const file = getCarpetaComprobantes_().createFile(blob);
  // Visible para cualquiera del dominio con el link (no público), suficiente para
  // que la coordinadora verifique el pago sin exponer el comprobante afuera.
  file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function crearTransaccion(token, payload) {
  authenticate_(token);
  const asesorInfo = requireRol_('asesor', 'coordinadora');
  validateRequired_(payload, ['nombrePersona','idActividad','nombreActividad','monto','metodoPago','sede']);

  if (!['Efectivo','Datáfono','Nequi'].includes(payload.metodoPago)) {
    throw new Error('Método de pago inválido: ' + payload.metodoPago);
  }
  if (isNaN(Number(payload.monto)) || Number(payload.monto) < 0) throw new Error('El monto debe ser un número válido mayor o igual a 0.');

  // Obtener actividad para leer sus flags
  const actividad = obtenerActividad_(payload.idActividad);
  if (!actividad.activa) throw new Error('La actividad "' + actividad.nombre + '" está inactiva y no permite transacciones.');

  // Nequi es un canal aparte (comprobante propio) y nunca se restringe aquí.
  if (payload.metodoPago !== 'Nequi' && !metodosPagoPermitidos_(actividad).includes(payload.metodoPago)) {
    throw new Error('La actividad "' + actividad.nombre + '" solo admite pago por ' + actividad.metodosPago + '.');
  }

  var debeInscribir = actividad.legalizarInscripcion || (actividad.modulos && actividad.modulos.length > 0);

  // Validar módulo y horario si la actividad requiere inscripción y tiene opciones definidas
  if (debeInscribir) {
    if (actividad.modulos && actividad.modulos.length > 0 && !payload.modulo) {
      throw new Error('Debe seleccionar un módulo para la actividad "' + actividad.nombre + '".');
    }
    if (actividad.horarios && actividad.horarios.length > 0 && !payload.horario) {
      throw new Error('Debe seleccionar un horario para la actividad "' + actividad.nombre + '".');
    }
  }

  // Valor total esperado (null si es de valor variable, sin abonos aplicables) y
  // validación de abonos: si la actividad no los permite, el monto de esta
  // transacción debe ser exactamente el valor total. Si sí los permite, se
  // valida más abajo contra lo ya pagado (requiere sumar transacciones previas).
  var valorEsperado = valorEsperadoActividad_(actividad, payload.modulo);
  if (valorEsperado !== null && !actividad.permiteAbonos && Number(payload.monto) !== valorEsperado) {
    throw new Error('La actividad "' + actividad.nombre + '" no permite abonos. El monto debe ser exactamente ' + formatCOP_(valorEsperado) + '.');
  }

  // Subir el comprobante de Nequi ANTES del lock: es I/O a Drive que puede tardar
  // uno o dos segundos, y no debe bloquear a otros asesores registrando pagos.
  var nequiComprobanteUrl = '';
  if (payload.metodoPago === 'Nequi' && payload.nequiComprobante) {
    nequiComprobanteUrl = guardarComprobanteNequi_(payload.nequiComprobante, payload.nombrePersona);
  }

  // ── Sección crítica bajo lock ─────────────────────────────────────────────
  // Evita que dos registros simultáneos (dos sedes a la vez) pasen la
  // validación de inscripción duplicada antes de que cualquiera escriba, y
  // valida el duplicado ANTES de guardar la transacción (antes, si la
  // inscripción resultaba duplicada, la transacción ya había quedado
  // guardada como "Activa" sin inscripción asociada — un pago fantasma).
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('El sistema está ocupado procesando otro registro. Intenta de nuevo en unos segundos.');
  }

  let ahora, idTrans, transaccion, inscripcion = null, legalizaciones;
  let filaTransaccion, emailEnviadoColIdx = null, sheet;
  try {
    // Idempotencia: si el dispositivo del asesor ya envió este mismo intento
    // antes (p. ej. la red se cayó justo cuando el servidor ya había
    // guardado el pago, y el dispositivo reintenta sin saber si se guardó),
    // no crear un segundo pago — se devuelve el que ya existe. La clave la
    // genera el dispositivo una sola vez por intento y se reutiliza en cada
    // reintento automático de ESE mismo intento.
    const transExistentes = sheetToObjects_('Transacciones');

    if (payload.idempotencyKey) {
      const yaExistente = transExistentes.find(t => t.Idempotency_Key === payload.idempotencyKey);
      if (yaExistente) {
        const inscYaExistente = sheetToObjects_('Inscripciones').find(i => i.ID_Trans === yaExistente.ID_Trans);
        return {
          ok: true,
          yaExistia: true,
          transaccion: mapTransaccion_(yaExistente),
          inscripcion: inscYaExistente ? {} : null,
          legalizaciones: [],
          emailEnviado: true,
          emailSolicitado: !!payload.correoPersona
        };
      }
    }

    // Total ya pagado por esta persona en esta actividad (+módulo), sin contar
    // el pago que se está registrando ahora mismo. Solo se necesita cuando hay
    // un valor total fijo contra el cual medir abonos.
    var totalPagadoPrevio = valorEsperado !== null
      ? sumaPagosPersonaActividad_(transExistentes, payload.idActividad, payload.nombreActividad, payload.documentoPersona, payload.nombrePersona, payload.modulo)
      : 0;

    var inscripcionExistente = null;
    if (debeInscribir) {
      // Buscar inscripción existente (misma persona + actividad + módulo + horario)
      const inscExistentes  = sheetToObjects_('Inscripciones');
      inscripcionExistente = inscExistentes.find(function(ins) {
        if (payload.modulo && ins.Modulo !== payload.modulo) return false;
        if (payload.horario && ins.Horario !== payload.horario) return false;
        // Verificar que la transacción asociada es de la misma persona, no está
        // anulada, y es realmente la misma actividad (por ID; el nombre de una
        // fila vieja sin ID guardado se usa como respaldo — ver mismaActividadFila_).
        var transAsociada = transExistentes.find(function(t) { return t.ID_Trans === ins.ID_Trans; });
        if (!transAsociada) return false;
        if ((transAsociada.Estado || 'Activa') === 'Anulada') return false;
        if (!mismaActividadFila_(transAsociada, payload.idActividad, payload.nombreActividad)) return false;
        if (payload.documentoPersona && transAsociada.Documento_Persona) {
          return String(transAsociada.Documento_Persona) === String(payload.documentoPersona);
        }
        return transAsociada.Nombre_Persona === payload.nombrePersona;
      }) || null;
      if (inscripcionExistente && (!actividad.permiteAbonos || valorEsperado === null)) {
        // Ya inscrito y no hay forma de que este segundo pago sea un abono
        // legítimo (la actividad no los permite, o no tiene valor fijo).
        throw new Error('La persona "' + payload.nombrePersona + '" ya tiene una inscripción activa en ' + payload.nombreActividad + (payload.modulo ? ' - ' + payload.modulo : '') + (payload.horario ? ' (' + payload.horario + ')' : '') + '.');
      }
    }

    if (valorEsperado !== null && actividad.permiteAbonos) {
      if (totalPagadoPrevio >= valorEsperado) {
        throw new Error('La persona "' + payload.nombrePersona + '" ya pagó el total de ' + payload.nombreActividad + (payload.modulo ? ' - ' + payload.modulo : '') + '.');
      }
      var saldoPendienteAntes = valorEsperado - totalPagadoPrevio;
      if (Number(payload.monto) > saldoPendienteAntes) {
        throw new Error('El monto supera el saldo pendiente de ' + formatCOP_(saldoPendienteAntes) + ' para ' + payload.nombreActividad + '.');
      }
    }

    ahora   = new Date();
    idTrans = generateId_('TRN');

    // Determinar estados de legalización
    const estadoIglesia  = actividad.legalizarPago         ? 'Pendiente' : 'NA';
    const estadoAcademia = actividad.legalizarInscripcion  ? 'Pendiente' : 'NA';

    // Insertar en Transacciones
    sheet = getSheet_('Transacciones', true);
    sheet.appendRow([
      idTrans,
      ahora,
      payload.nombrePersona,
      payload.documentoPersona || '',
      payload.celularPersona   || '',
      payload.nombreActividad,
      payload.sede,
      Number(payload.monto),
      payload.metodoPago,
      asesorInfo.email,
      asesorInfo.nombre,
      estadoIglesia,
      estadoAcademia,
      payload.dtFranquicia             || '',
      payload.dtTipoTarjeta            || '',
      payload.dtValor                  || '',
      payload.dtTitularMismo      || '',
      payload.dtNombreTitular     || '',
      payload.dtDocTitular        || '',
      payload.dtCelularTitular    || '',
      payload.dtNoAutorizacion         || '',
      payload.dtNoDatafono             || '',
      'Activa'
    ]);

    // Columna aparte (no en el array posicional de arriba): así una hoja ya
    // existente en producción, sin esta columna todavía, la agrega sola en vez
    // de escribir un valor "fantasma" en una columna sin encabezado.
    filaTransaccion = sheet.getLastRow();
    if (nequiComprobanteUrl) {
      const colIdx = ensureColumn_(sheet, 'Nequi_Comprobante_URL');
      sheet.getRange(filaTransaccion, colIdx + 1).setValue(nequiComprobanteUrl);
    }
    if (payload.idempotencyKey) {
      const idemColIdx = ensureColumn_(sheet, 'Idempotency_Key');
      sheet.getRange(filaTransaccion, idemColIdx + 1).setValue(payload.idempotencyKey);
    }
    // Se reserva la columna aquí, bajo el mismo bloqueo que las de arriba
    // (evita la misma condición de carrera al crear la columna). El valor
    // real se escribe más abajo, después de intentar el envío — que a
    // propósito ocurre fuera del bloqueo por ser una llamada lenta.
    if (payload.correoPersona) {
      emailEnviadoColIdx = ensureColumn_(sheet, 'Email_Enviado');
    }
    // Guardado solo para poder sumar abonos por módulo más adelante
    // (sumaPagosPersonaActividad_); las actividades sin módulos no la usan.
    if (payload.modulo) {
      const moduloColIdx = ensureColumn_(sheet, 'Modulo');
      sheet.getRange(filaTransaccion, moduloColIdx + 1).setValue(payload.modulo);
    }
    // Se guarda en todas las transacciones (no solo las de actividades con
    // abonos): el nombre de una actividad se puede repetir entre ediciones
    // distintas (misma actividad recreada meses después con el mismo nombre),
    // y solo el ID distingue de forma confiable a cuál pertenece cada pago.
    const idActColIdx = ensureColumn_(sheet, 'ID_Actividad');
    sheet.getRange(filaTransaccion, idActColIdx + 1).setValue(payload.idActividad);

    var saldoPendiente = (valorEsperado !== null && actividad.permiteAbonos)
      ? Math.max(0, valorEsperado - totalPagadoPrevio - Number(payload.monto))
      : null;

    transaccion = {
      id:              idTrans,
      timestamp:       formatDate_(ahora),
      nombrePersona:   payload.nombrePersona,
      actividad:       payload.nombreActividad,
      sede:            payload.sede,
      monto:           Number(payload.monto),
      metodoPago:      payload.metodoPago,
      saldoPendiente:  saldoPendiente,
      asesorEmail:     asesorInfo.email,
      asesorNombre:    asesorInfo.nombre,
      estadoIglesia,
      estadoAcademia,
      nequiComprobanteUrl
    };

    // ── Generar filas de Legalizaciones según flags ────────────────────────
    legalizaciones = [];
    if (actividad.legalizarPago) {
      const idLegal = crearEntradaLegalizacion_(idTrans, 'iglesia');
      legalizaciones.push({ tipo: 'iglesia', id: idLegal });
    }
    if (actividad.legalizarInscripcion) {
      const idLegal = crearEntradaLegalizacion_(idTrans, 'academia');
      legalizaciones.push({ tipo: 'academia', id: idLegal });
    }

    // ── Generar inscripción si aplica ───────────────────────────────────────
    // Si ya existía una inscripción activa para esta persona+módulo (abono
    // sobre un pago anterior), no se crea una segunda — la inscripción ya
    // está hecha, solo se está terminando de pagar.
    if (debeInscribir && !inscripcionExistente) {
      inscripcion = crearInscripcionDesdeTransaccion_({
        idTrans,
        actividad:      payload.nombreActividad,
        modulo:         payload.modulo  || '',
        horario:        payload.horario || '',
        sede:           payload.sede,
        asesorEmail:    asesorInfo.email,
        nombrePersona:  payload.nombrePersona,
        documentoPersona: payload.documentoPersona || '',
        celularPersona: payload.celularPersona || ''
      });
    }
  } finally {
    lock.releaseLock();
  }

  // ── Enviar email de confirmación (fuera del lock; no bloquea si falla) ────
  // El resultado se devuelve al frontend (emailEnviado) para que, si falla,
  // el asesor lo sepa en vez de asumir que el comprobante sí llegó.
  var emailEnviado = false;
  try {
    if (payload.correoPersona) {
      // Si el pago fue por Datáfono y el valor realmente cobrado difiere del
      // precio oficial de la actividad (error de digitación ya confirmado
      // por el asesor), el comprobante que recibe el cliente debe reflejar
      // lo que de verdad se le debitó de la tarjeta, no el precio de lista.
      const montoComprobante = (payload.metodoPago === 'Datáfono' && payload.dtValor)
        ? Number(payload.dtValor)
        : Number(payload.monto);
      enviarConfirmacion({
        nombre:    payload.nombrePersona,
        correo:    payload.correoPersona,
        actividad: payload.nombreActividad,
        monto:     montoComprobante,
        metodo:    payload.metodoPago,
        asesor:    asesorInfo.nombre,
        fecha:     formatDate_(ahora)
      });
      emailEnviado = true;
    }
  } catch (e) {
    Logger.log('Email no enviado: ' + e.message);
  }

  // Queda registrado en la propia hoja (columna "Email_Enviado") para poder
  // auditar después sin tener que revisar el log de ejecuciones de Apps
  // Script ni la carpeta de Enviados de Gmail. Escritura de una sola celda
  // en la fila que esta misma ejecución ya creó — no hace falta bloqueo.
  if (payload.correoPersona && emailEnviadoColIdx !== null) {
    sheet.getRange(filaTransaccion, emailEnviadoColIdx + 1).setValue(emailEnviado ? 'Enviado' : 'Falló');
  }

  return { ok: true, transaccion, inscripcion, legalizaciones, emailEnviado, emailSolicitado: !!payload.correoPersona };
}

/**
 * Anula una transacción. Asesores solo pueden anular transacciones propias del día actual.
 * Coordinadoras pueden anular cualquier transacción sin restricción.
 */
function anularTransaccion(token, idTrans) {
  authenticate_(token);
  const userInfo = requireRol_('asesor', 'coordinadora');

  const sheet   = getSheet_('Transacciones');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx       = headers.indexOf('ID_Trans');
  const tsIdx       = headers.indexOf('Timestamp');
  const asesorIdx   = headers.indexOf('Asesor_Email');
  const estadoIdx   = headers.indexOf('Estado');

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === idTrans) {
      const estadoActual = values[i][estadoIdx] || 'Activa';
      if (estadoActual === 'Anulada') throw new Error('Esta transacción ya fue anulada.');

      if (userInfo.rol === 'asesor') {
        if (values[i][asesorIdx] !== userInfo.email) {
          throw new Error('Solo puedes anular tus propias transacciones.');
        }
        const fechaTrans = new Date(values[i][tsIdx]);
        const inicioHoy  = new Date();
        inicioHoy.setHours(0, 0, 0, 0);
        if (fechaTrans < inicioHoy) {
          throw new Error('Solo puedes anular transacciones del día de hoy. Contacta a tu coordinadora.');
        }
      }

      if (estadoIdx >= 0) {
        sheet.getRange(i + 1, estadoIdx + 1).setValue('Anulada');
      }
      return { ok: true };
    }
  }
  throw new Error('Transacción no encontrada: ' + idTrans);
}

/**
 * Aplica los filtros comunes de sede/asesor/método/estado/fecha a un arreglo
 * de filas de Transacciones (formato crudo de sheetToObjects_). Centraliza el
 * criterio que ya usaba listarTransacciones, para que el Dashboard y Análisis
 * puedan aplicar exactamente el mismo criterio en vez de ignorar estos filtros.
 */
function aplicarFiltrosTransacciones_(trans, filtros) {
  filtros = filtros || {};
  if (filtros.sede) {
    const sedeMap = buildAsesorSedeMap_();
    trans = trans.filter(t => sedeMap[t.Asesor_Email] === filtros.sede);
  }
  if (filtros.asesorEmail)    trans = trans.filter(t => t.Asesor_Email === filtros.asesorEmail);
  if (filtros.metodoPago)     trans = trans.filter(t => t.Metodo_Pago === filtros.metodoPago);
  if (filtros.estadoIglesia)  trans = trans.filter(t => t.Estado_Legalizacion_Iglesia === filtros.estadoIglesia);
  if (filtros.estadoAcademia) trans = trans.filter(t => t.Estado_Legalizacion_Academia === filtros.estadoAcademia);
  if (filtros.fechaDesde) {
    const desde = new Date(filtros.fechaDesde);
    trans = trans.filter(t => t.Timestamp && new Date(t.Timestamp) >= desde);
  }
  if (filtros.fechaHasta) {
    const hasta = new Date(filtros.fechaHasta);
    hasta.setHours(23, 59, 59);
    trans = trans.filter(t => t.Timestamp && new Date(t.Timestamp) <= hasta);
  }
  return trans;
}

/**
 * Lista transacciones con filtros combinables.
 * @param {{sede?:string, asesorEmail?:string, actividad?:string, metodoPago?:string,
 *          estadoIglesia?:string, estadoAcademia?:string,
 *          fechaDesde?:string, fechaHasta?:string,
 *          periodo?:string, page?:number, pageSize?:number}} filtros
 * @returns {{transacciones:Object[], total:number}}
 */
function listarTransacciones(token, filtros = {}) {
  authenticate_(token);
  requireRol_('coordinadora');
  let trans = aplicarFiltrosTransacciones_(sheetToObjects_('Transacciones'), filtros);

  if (filtros.actividad) trans = trans.filter(t => (t.Actividad||'').toLowerCase().includes(filtros.actividad.toLowerCase()));
  if (filtros.busqueda) {
    const q = filtros.busqueda.toString().toLowerCase();
    trans = trans.filter(t => (t.Documento_Persona || '').toString().toLowerCase().includes(q));
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
function getHistorialTurno(token, sede) {
  authenticate_(token);
  const asesorInfo = requireRol_('asesor', 'coordinadora');
  const ahora      = new Date();
  const inicioHoy  = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

  let filas = sheetToObjects_('Transacciones')
    .filter(t => t.Timestamp && new Date(t.Timestamp) >= inicioHoy);

  if (sede) {
    filas = filas.filter(t => t.Sede === sede);
  } else {
    filas = filas.filter(t => t.Asesor_Email === asesorInfo.email);
  }

  const trans = filas
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .map(mapTransaccion_);

  const totales = trans.reduce((acc, t) => {
    if (t.estado === 'Anulada') return acc;
    acc.total += t.monto;
    if (t.metodoPago === 'Efectivo')  acc.efectivo  += t.monto;
    if (t.metodoPago === 'Datáfono')  acc.datafono  += t.monto;
    if (t.metodoPago === 'Nequi')     acc.nequi     += t.monto;
    return acc;
  }, { efectivo: 0, datafono: 0, nequi: 0, total: 0 });

  const asesores = [];
  const seen = {};
  trans.forEach(function(t) {
    if (t.estado !== 'Anulada' && t.asesorNombre && !seen[t.asesorNombre]) {
      seen[t.asesorNombre] = true;
      asesores.push(t.asesorNombre);
    }
  });
  asesores.sort();

  return { transacciones: trans, totales, asesores };
}

/**
 * Retorna la cartera del asesor: personas con pagos recientes y su estado de legalización.
 * Semáforo: verde=legalizado, amarillo=pendiente ≤7 días, rojo=pendiente >7 días
 * @returns {Object[]}
 */
function getCarteraAsesor(token) {
  authenticate_(token);
  const asesorInfo = requireRol_('asesor', 'coordinadora');
  const ahora      = new Date();

  const trans = sheetToObjects_('Transacciones')
    .filter(t => t.Asesor_Email === asesorInfo.email && (t.Estado || 'Activa') !== 'Anulada')
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

  // Agrupar por persona (última transacción de cada una). Se usa el documento
  // como llave porque el nombre puede repetirse entre personas distintas; si
  // una fila antigua no tiene documento, se cae de vuelta al nombre para no
  // perder esa fila de la agrupación.
  const porPersona = {};
  trans.forEach(t => {
    const key = t.Documento_Persona || ('nombre:' + t.Nombre_Persona);
    if (!porPersona[key]) {
      porPersona[key] = t;
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
      nombrePersona:   t.Nombre_Persona,
      documentoPersona:t.Documento_Persona || '',
      ultimaActividad: t.Actividad,
      ultimaMonto:     t.Monto,
      ultimaMetodoPago:t.Metodo_Pago,
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
 * Actualiza el estado de legalización de una transacción.
 * Función interna: la usan marcarLegalizado (Legalizacion.js) y recuperarDatosFaltantes (Inscripciones.js).
 * @param {string} idTrans
 * @param {'iglesia'|'academia'} tipo
 * @param {'Pendiente'|'Legalizado'|'NA'} estado
 * @returns {{ok:boolean}}
 */
function actualizarEstadoLegalizacion_(idTrans, tipo, estado) {
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

/**
 * Edita los datos de una transacción existente para corregir errores de captura.
 * No permite editar transacciones anuladas ni cambiar actividad/sede/legalizaciones.
 * @param {string} idTrans
 * @param {{nombrePersona?, documentoPersona?, celularPersona?, monto?, metodoPago?,
 *          dtFranquicia?, dtTipoTarjeta?, dtNoAutorizacion?, dtNoDatafono?}} datos
 * @returns {{ok:boolean}}
 */
function actualizarTransaccion(token, idTrans, datos) {
  authenticate_(token);
  const actorInfo = requireRol_('coordinadora');

  if (datos.metodoPago && !['Efectivo','Datáfono','Nequi'].includes(datos.metodoPago)) {
    throw new Error('Método de pago inválido: ' + datos.metodoPago);
  }
  if (datos.monto !== undefined && (isNaN(Number(datos.monto)) || Number(datos.monto) < 0)) {
    throw new Error('El monto debe ser un número válido mayor o igual a 0.');
  }
  if (datos.nombrePersona !== undefined && !datos.nombrePersona.toString().trim()) {
    throw new Error('El nombre de la persona es obligatorio.');
  }

  const colMap = {
    nombrePersona:    'Nombre_Persona',
    documentoPersona: 'Documento_Persona',
    celularPersona:   'Celular_Persona',
    monto:            'Monto',
    metodoPago:       'Metodo_Pago',
    dtValor:          'Datafono_Valor',
    dtFranquicia:     'Datafono_Franquicia',
    dtTipoTarjeta:    'Datafono_Tipo_Tarjeta',
    dtNoAutorizacion: 'Datafono_No_Autorizacion',
    dtNoDatafono:     'Datafono_No_Datafono'
  };

  const sheet   = getSheet_('Transacciones');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx     = headers.indexOf('ID_Trans');
  const estadoIdx = headers.indexOf('Estado');

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === idTrans) {
      if ((values[i][estadoIdx] || 'Activa') === 'Anulada') {
        throw new Error('No se puede editar una transacción anulada.');
      }
      Object.keys(colMap).forEach(key => {
        if (datos[key] === undefined) return;
        const colIdx = headers.indexOf(colMap[key]);
        if (colIdx === -1) return;
        const val = (key === 'monto' || key === 'dtValor') ? Number(datos[key]) || 0 : datos[key];
        sheet.getRange(i + 1, colIdx + 1).setValue(val);
      });
      // ensureColumn_ puede insertar una columna nueva (Editado_Por/Fecha).
      // crearTransaccion hace lo mismo (Nequi_Comprobante_URL/Idempotency_Key)
      // bajo este mismo bloqueo global — sin él, dos ejecuciones concurrentes
      // podrían leer el mismo "última columna" antes de que cualquiera
      // escriba, y una pisaría el encabezado de la otra.
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) {
        throw new Error('El sistema está ocupado procesando otro registro. Intenta de nuevo en unos segundos.');
      }
      try {
        const editadoPorIdx   = ensureColumn_(sheet, 'Editado_Por');
        const editadoFechaIdx = ensureColumn_(sheet, 'Editado_Fecha');
        sheet.getRange(i + 1, editadoPorIdx + 1).setValue(actorInfo.email);
        sheet.getRange(i + 1, editadoFechaIdx + 1).setValue(formatDate_(new Date()));
      } finally {
        lock.releaseLock();
      }
      return { ok: true };
    }
  }
  throw new Error('Transacción no encontrada: ' + idTrans);
}

/**
 * Exporta transacciones con método Datáfono para descarga Excel.
 * Respeta los mismos filtros globales que listarTransacciones.
 */
function exportarTransaccionesDatafono(token, filtros = {}) {
  authenticate_(token);
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones')
    .filter(t => t.Metodo_Pago === 'Datáfono' && (t.Estado || 'Activa') !== 'Anulada');

  if (filtros.sede)        trans = trans.filter(t => t.Sede === filtros.sede);
  if (filtros.asesorEmail) trans = trans.filter(t => t.Asesor_Email === filtros.asesorEmail);
  if (filtros.actividad)   trans = trans.filter(t => (t.Actividad||'').toLowerCase().includes(filtros.actividad.toLowerCase()));
  if (filtros.fechaDesde) {
    const desde = new Date(filtros.fechaDesde);
    trans = trans.filter(t => t.Timestamp && new Date(t.Timestamp) >= desde);
  }
  if (filtros.fechaHasta) {
    const hasta = new Date(filtros.fechaHasta);
    hasta.setHours(23, 59, 59);
    trans = trans.filter(t => t.Timestamp && new Date(t.Timestamp) <= hasta);
  }
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

  trans.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

  return trans.map(t => {
    const esDiferente = t.Datafono_Titular_Mismo === 'No';
    return {
      sede:                   t.Sede                          || '',
      fechaDatafono:          t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
      franquicia:             t.Datafono_Franquicia           || '',
      noAutorizacion:         t.Datafono_No_Autorizacion      || '',
      valor:                  Number(t.Datafono_Valor)        || 0,
      nombreTitular:          esDiferente ? t.Datafono_Nombre_Titular  || '' : t.Nombre_Persona    || '',
      cedula:                 esDiferente ? t.Datafono_Doc_Titular     || '' : t.Documento_Persona || '',
      celular:                esDiferente ? t.Datafono_Celular_Titular || '' : t.Celular_Persona   || '',
      beneficiarioPago:       esDiferente ? t.Nombre_Persona               || '' : '',
      cedulaBeneficiario:     esDiferente ? t.Documento_Persona            || '' : '',
      celularBeneficiario:    esDiferente ? t.Celular_Persona              || '' : '',
      concepto:               t.Actividad                     || '',
      debitoCredito:          t.Datafono_Tipo_Tarjeta         || '',
      noDatafono:             t.Datafono_No_Datafono          || '',
      asesor:                 t.Asesor_Nombre                 || ''
    };
  });
}

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

/**
 * ¿Esta fila de Transacciones corresponde a la misma actividad que idActividad?
 * Compara por ID (preciso: dos actividades distintas con el mismo nombre —p.ej.
 * dos ediciones de "Aposento Alto" creadas meses aparte— nunca se confunden).
 * Las filas guardadas antes de que existiera esta columna no tienen ID, así
 * que para esas se cae al nombre (comportamiento previo, ya conocido).
 */
function mismaActividadFila_(t, idActividad, nombreActividad) {
  if (t.ID_Actividad) return t.ID_Actividad === idActividad;
  return t.Actividad === nombreActividad;
}

/**
 * Suma lo pagado (transacciones activas, no anuladas) por una persona en una
 * actividad — y, si se indica, en un módulo puntual de esa actividad — para
 * medir cuánto lleva abonado contra el valor total. La persona se identifica
 * por documento cuando está disponible (más confiable que el nombre).
 */
function sumaPagosPersonaActividad_(transacciones, idActividad, nombreActividad, documentoPersona, nombrePersona, modulo) {
  return transacciones
    .filter(function(t) {
      if (!mismaActividadFila_(t, idActividad, nombreActividad)) return false;
      if ((t.Estado || 'Activa') === 'Anulada') return false;
      if (modulo && (t.Modulo || '') !== modulo) return false;
      if (!modulo && t.Modulo) return false;
      if (documentoPersona && t.Documento_Persona) {
        return String(t.Documento_Persona) === String(documentoPersona);
      }
      return t.Nombre_Persona === nombrePersona;
    })
    .reduce(function(sum, t) { return sum + (Number(t.Monto) || 0); }, 0);
}

/**
 * Saldo pendiente de una persona en una actividad de valor fijo que permite
 * abonos — usado por el frontend para mostrar/prellenar el monto antes de
 * registrar un pago. Para actividades de valor variable o sin abonos
 * devuelve saldoPendiente:null (no aplica).
 * @param {{idActividad, documentoPersona?, nombrePersona, modulo?}} params
 */
function obtenerSaldoActividad(token, params) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  const actividad = obtenerActividad_(params.idActividad);
  const valorEsperado = valorEsperadoActividad_(actividad, params.modulo);
  if (valorEsperado === null || !actividad.permiteAbonos) {
    return { valorEsperado: valorEsperado, totalPagado: 0, saldoPendiente: null };
  }
  const transacciones = sheetToObjects_('Transacciones');
  const totalPagado = sumaPagosPersonaActividad_(transacciones, params.idActividad, actividad.nombre, params.documentoPersona, params.nombrePersona, params.modulo);
  return { valorEsperado: valorEsperado, totalPagado: totalPagado, saldoPendiente: Math.max(0, valorEsperado - totalPagado) };
}

/**
 * Cartera de abonos: todas las personas con saldo pendiente en actividades
 * que permiten abonos, agrupado por persona + actividad (+ módulo si aplica).
 * Solo mira transacciones activas (no anuladas). Pensado para que la
 * coordinadora vea de un vistazo quién quedó debiendo y cuánto.
 * @returns {{nombrePersona, documentoPersona, celularPersona, actividad, modulo,
 *            valorEsperado, totalPagado, saldoPendiente, ultimaFecha}[]}
 */
function getCarteraAbonos(token) {
  authenticate_(token);
  requireRol_('coordinadora');

  const actividadesAbonos = sheetToObjects_('Actividades')
    .map(mapActividad_)
    .filter(a => a.permiteAbonos && !a.valorVariable);
  if (!actividadesAbonos.length) return [];

  // Por ID (preciso) y por nombre (respaldo, solo para filas guardadas antes
  // de que existiera la columna ID_Actividad). Si dos actividades activas con
  // abonos comparten nombre — dos ediciones del mismo evento a la vez—, una
  // fila vieja sin ID no se puede asignar de forma confiable a ninguna de las
  // dos, así que se ignora en vez de arriesgarse a mezclarlas.
  const actividadPorId = {};
  const idsPorNombre = {};
  actividadesAbonos.forEach(function(a) {
    actividadPorId[a.id] = a;
    (idsPorNombre[a.nombre] = idsPorNombre[a.nombre] || []).push(a.id);
  });

  const transacciones = sheetToObjects_('Transacciones').filter(t => (t.Estado || 'Activa') !== 'Anulada');

  const grupos = {};
  transacciones.forEach(function(t) {
    var idActividad = null;
    if (t.ID_Actividad && actividadPorId.hasOwnProperty(t.ID_Actividad)) {
      idActividad = t.ID_Actividad;
    } else if (!t.ID_Actividad) {
      var candidatos = idsPorNombre[t.Actividad];
      if (candidatos && candidatos.length === 1) idActividad = candidatos[0];
    }
    if (!idActividad) return;

    const doc    = t.Documento_Persona || '';
    const modulo = t.Modulo || '';
    const key    = (doc || t.Nombre_Persona) + '|' + idActividad + '|' + modulo;
    if (!grupos[key]) {
      grupos[key] = {
        nombrePersona:    t.Nombre_Persona,
        documentoPersona: doc,
        celularPersona:   t.Celular_Persona || '',
        idActividad:      idActividad,
        actividad:        t.Actividad,
        modulo:           modulo,
        totalPagado:      0,
        ultimaFecha:      null
      };
    }
    grupos[key].totalPagado += Number(t.Monto) || 0;
    const fecha = t.Timestamp ? new Date(t.Timestamp) : null;
    if (fecha && (!grupos[key].ultimaFecha || fecha > grupos[key].ultimaFecha)) grupos[key].ultimaFecha = fecha;
  });

  return Object.values(grupos)
    .map(function(g) {
      const valorEsperado  = valorEsperadoActividad_(actividadPorId[g.idActividad], g.modulo);
      const saldoPendiente = Math.max(0, valorEsperado - g.totalPagado);
      return {
        nombrePersona:    g.nombrePersona,
        documentoPersona: g.documentoPersona,
        celularPersona:   g.celularPersona,
        actividad:        g.actividad,
        modulo:           g.modulo,
        valorEsperado:    valorEsperado,
        totalPagado:      g.totalPagado,
        saldoPendiente:   saldoPendiente,
        ultimaFecha:      g.ultimaFecha ? formatDate_(g.ultimaFecha) : ''
      };
    })
    .filter(function(r) { return r.saldoPendiente > 0; })
    .sort(function(a, b) { return b.saldoPendiente - a.saldoPendiente; });
}

function mapTransaccion_(t) {
  return {
    id:              t.ID_Trans,
    timestamp:       t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
    nombrePersona:   t.Nombre_Persona,
    documentoPersona:t.Documento_Persona || '',
    celularPersona:  t.Celular_Persona   || '',
    actividad:       t.Actividad,
    sede:            t.Sede,
    monto:           Number(t.Monto) || 0,
    metodoPago:      t.Metodo_Pago,
    asesorEmail:     t.Asesor_Email,
    asesorNombre:    t.Asesor_Nombre,
    estadoIglesia:   t.Estado_Legalizacion_Iglesia,
    estadoAcademia:  t.Estado_Legalizacion_Academia,
    estado:          t.Estado || 'Activa',
    dtFranquicia:            t.Datafono_Franquicia           || '',
    dtTipoTarjeta:           t.Datafono_Tipo_Tarjeta         || '',
    dtValor:                 Number(t.Datafono_Valor)        || 0,
    dtTitularMismo:     t.Datafono_Titular_Mismo   || '',
    dtNombreTitular:    t.Datafono_Nombre_Titular  || '',
    dtDocTitular:       t.Datafono_Doc_Titular     || '',
    dtCelularTitular:   t.Datafono_Celular_Titular || '',
    dtNoAutorizacion:        t.Datafono_No_Autorizacion      || '',
    dtNoDatafono:            t.Datafono_No_Datafono          || '',
    nequiComprobanteUrl:     t.Nequi_Comprobante_URL         || '',
    editadoPor:              t.Editado_Por                   || '',
    editadoFecha:            t.Editado_Fecha ? formatDate_(new Date(t.Editado_Fecha)) : '',
    emailEnviado:            t.Email_Enviado                 || ''
  };
}
