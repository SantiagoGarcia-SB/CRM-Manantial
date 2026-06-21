// ─── TRANSACCIONES.GS ─────────────────────────────────────────────────────────
// Contrato público:
//   crearTransaccion(payload)           → {ok, transaccion, inscripcion?}
//   anularTransaccion(idTrans)          → {ok}
//   listarTransacciones(filtros)        → {transacciones:[], total:number}
//   obtenerResumenAsesor(email?)        → {transacciones:[], resumen:{}}
//   getHistorialTurno(sede?)             → {transacciones:[], totales:{}}
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
 *   dtTitularMismo?:     'Si'|'No',
 *   dtNombreTitular?:    string,   // Datos del titular de la tarjeta (cuando es diferente a la persona)
 *   dtDocTitular?:       string,
 *   dtCelularTitular?:   string,
 *   dtNoAutorizacion?:        string,
 *   dtNoDatafono?:            string
 * }
 */
function crearTransaccion(token, payload) {
  authenticate_(token);
  const asesorInfo = requireRol_('asesor', 'coordinadora');
  validateRequired_(payload, ['nombrePersona','idActividad','nombreActividad','monto','metodoPago','sede']);

  if (!['Efectivo','Datáfono','Nequi'].includes(payload.metodoPago)) {
    throw new Error('Método de pago inválido: ' + payload.metodoPago);
  }
  if (Number(payload.monto) < 1) throw new Error('El monto debe ser mayor a 0.');

  // Obtener actividad para leer sus flags
  const actividad = obtenerActividad_(payload.idActividad);
  if (!actividad.activa) throw new Error('La actividad "' + actividad.nombre + '" está inactiva y no permite transacciones.');

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

  const ahora  = new Date();
  const idTrans = generateId_('TRN');

  // Determinar estados de legalización
  const estadoIglesia  = actividad.legalizarPago         ? 'Pendiente' : 'NA';
  const estadoAcademia = actividad.legalizarInscripcion  ? 'Pendiente' : 'NA';

  // Insertar en Transacciones
  const sheet = getSheet_('Transacciones', true);
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

  const transaccion = {
    id:              idTrans,
    timestamp:       formatDate_(ahora),
    nombrePersona:   payload.nombrePersona,
    actividad:       payload.nombreActividad,
    sede:            payload.sede,
    monto:           Number(payload.monto),
    metodoPago:      payload.metodoPago,
    asesorEmail:     asesorInfo.email,
    asesorNombre:    asesorInfo.nombre,
    estadoIglesia,
    estadoAcademia
  };

  // ── Generar filas de Legalizaciones según flags ──────────────────────────
  const legalizaciones = [];
  if (actividad.legalizarPago) {
    const idLegal = crearEntradaLegalizacion_(idTrans, 'iglesia');
    legalizaciones.push({ tipo: 'iglesia', id: idLegal });
  }
  if (actividad.legalizarInscripcion) {
    const idLegal = crearEntradaLegalizacion_(idTrans, 'academia');
    legalizaciones.push({ tipo: 'academia', id: idLegal });
  }

  // ── Generar inscripción si aplica ────────────────────────────────────────
  let inscripcion = null;
  if (debeInscribir) {
    // Validar que no exista inscripción duplicada (misma persona + actividad + módulo + horario)
    const inscExistentes = sheetToObjects_('Inscripciones');
    const transExistentes = sheetToObjects_('Transacciones');
    const yaInscrito = inscExistentes.some(function(ins) {
      if (ins.Actividad !== payload.nombreActividad) return false;
      if (payload.modulo && ins.Modulo !== payload.modulo) return false;
      if (payload.horario && ins.Horario !== payload.horario) return false;
      // Verificar que la transacción asociada es de la misma persona y no está anulada
      var transAsociada = transExistentes.find(function(t) { return t.ID_Trans === ins.ID_Trans; });
      if (!transAsociada) return false;
      if ((transAsociada.Estado || 'Activa') === 'Anulada') return false;
      return transAsociada.Nombre_Persona === payload.nombrePersona;
    });
    if (yaInscrito) {
      throw new Error('La persona "' + payload.nombrePersona + '" ya tiene una inscripción activa en ' + payload.nombreActividad + (payload.modulo ? ' - ' + payload.modulo : '') + (payload.horario ? ' (' + payload.horario + ')' : '') + '.');
    }

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
        actividad: payload.nombreActividad
      });
    }
  } catch (e) {
    Logger.log('Email no enviado: ' + e.message);
  }

  return { ok: true, transaccion, inscripcion, legalizaciones };
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
  let trans = sheetToObjects_('Transacciones');

  if (filtros.sede) {
    const sedeMap = buildAsesorSedeMap_();
    trans = trans.filter(t => sedeMap[t.Asesor_Email] === filtros.sede);
  }
  if (filtros.asesorEmail)   trans = trans.filter(t => t.Asesor_Email === filtros.asesorEmail);
  if (filtros.actividad)     trans = trans.filter(t => (t.Actividad||'').toLowerCase().includes(filtros.actividad.toLowerCase()));
  if (filtros.metodoPago)    trans = trans.filter(t => t.Metodo_Pago === filtros.metodoPago);
  if (filtros.estadoIglesia) trans = trans.filter(t => t.Estado_Legalizacion_Iglesia === filtros.estadoIglesia);
  if (filtros.estadoAcademia)trans = trans.filter(t => t.Estado_Legalizacion_Academia === filtros.estadoAcademia);
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

  // Agrupar por persona (última transacción de cada una)
  const porPersona = {};
  trans.forEach(t => {
    if (!porPersona[t.Nombre_Persona]) {
      porPersona[t.Nombre_Persona] = t;
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
function actualizarEstadoLegalizacion(token, idTrans, tipo, estado) {
  authenticate_(token);
  requireRol_('coordinadora');
  return actualizarEstadoLegalizacion_(idTrans, tipo, estado);
}

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
      noDatafono:             t.Datafono_No_Datafono          || ''
    };
  });
}

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

function mapTransaccion_(t) {
  return {
    id:              t.ID_Trans,
    timestamp:       t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
    nombrePersona:   t.Nombre_Persona,
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
    dtNoDatafono:            t.Datafono_No_Datafono          || ''
  };
}
