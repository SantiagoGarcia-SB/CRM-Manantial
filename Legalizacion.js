// ─── LEGALIZACION.GS ──────────────────────────────────────────────────────────
// Contrato público:
//   crearEntradaLegalizacion_(idTrans, tipo)   → string (id) [interno]
//   obtenerColaIglesia(filtros?)                → Object[]  (filtros.estado: 'Pendiente'|'Legalizado'|'Todos', default Pendiente)
//   obtenerColaAcademia(filtros?)               → Object[]
//   marcarLegalizado(idTrans, tipo, notas?, numeroCaja?) → {ok}  (numeroCaja obligatorio si tipo='iglesia')
//   exportarPendientes(tipo)                   → Object[]  (datos para CSV frontend)
//   getResumenLegalizacionSeccion(filtros?)     → {iglesia:{total,pendientes,legalizados,pct}, academia:{...}}
//
// Internas, usadas solo desde otras funciones del backend (sin frontend que las llame):
//   getResumenLegalizacion_()                  → {iglesia:{}, academia:{}}  (usada por getAlertasDashboard)
//   getAlertasPendientes_(dias)                → Object[]  (>7 días, usada por getAlertasDashboard)

/**
 * Inserta una entrada en la cola de legalización. Llamada internamente desde crearTransaccion.
 * @param {string} idTrans
 * @param {'iglesia'|'academia'} tipo
 * @returns {string} id generado
 */
function crearEntradaLegalizacion_(idTrans, tipo) {
  const sheet = getSheet_('Legalizaciones', true);
  const id    = generateId_('LEG');
  sheet.appendRow([id, idTrans, tipo, 'Pendiente', '', '']);
  return id;
}

/**
 * Obtiene la cola de legalización para la plataforma Iglesia.
 * Solo transacciones con Legalizar_Iglesia=true y Estado=Pendiente.
 * @param {{sede?, asesorEmail?, metodoPago?, fechaDesde?, fechaHasta?, busqueda?}} filtros
 * @returns {Object[]}
 */
function obtenerColaIglesia(token, filtros) {
  authenticate_(token);
  requireRol_('coordinadora');
  return obtenerCola_('iglesia', filtros);
}

function obtenerColaAcademia(token, filtros) {
  authenticate_(token);
  requireRol_('coordinadora');
  return obtenerCola_('academia', filtros);
}

/**
 * Une Legalizaciones (de un tipo dado) con su transacción y aplica los filtros
 * globales de la UI. No filtra por Estado salvo que filtros.estado lo pida.
 * @param {'iglesia'|'academia'} tipo
 * @param {{sede?, asesorEmail?, metodoPago?, fechaDesde?, fechaHasta?, busqueda?, estado?}} filtros
 * @returns {{l:Object, trans:Object}[]}
 */
function obtenerLegalizacionesFiltradas_(tipo, filtros = {}) {
  const legalizaciones = sheetToObjects_('Legalizaciones').filter(l => l.Tipo === tipo);

  const transMap = {};
  sheetToObjects_('Transacciones').forEach(t => { transMap[t.ID_Trans] = t; });

  const sedeMap  = filtros.sede ? buildAsesorSedeMap_() : null;
  const busqueda = filtros.busqueda ? filtros.busqueda.toString().toLowerCase() : '';
  const desde    = filtros.fechaDesde ? new Date(filtros.fechaDesde) : null;
  const hasta    = filtros.fechaHasta ? new Date(filtros.fechaHasta) : null;
  if (hasta) hasta.setHours(23, 59, 59);

  return legalizaciones
    .map(l => ({ l, trans: transMap[l.ID_Trans] || null }))
    .filter(({ l, trans }) => {
      if (trans && (trans.Estado || 'Activa') === 'Anulada') return false;
      if (filtros.estado      && filtros.estado !== 'Todos' && l.Estado !== filtros.estado) return false;
      if (filtros.sede        && (!trans || sedeMap[trans.Asesor_Email] !== filtros.sede)) return false;
      if (filtros.asesorEmail && (!trans || trans.Asesor_Email !== filtros.asesorEmail)) return false;
      if (filtros.metodoPago  && (!trans || trans.Metodo_Pago !== filtros.metodoPago)) return false;
      if (busqueda             && (!trans || !(trans.Documento_Persona || '').toString().toLowerCase().includes(busqueda))) return false;
      if (desde                && (!trans || !trans.Timestamp || new Date(trans.Timestamp) < desde)) return false;
      if (hasta                && (!trans || !trans.Timestamp || new Date(trans.Timestamp) > hasta)) return false;
      return true;
    });
}

function obtenerCola_(tipo, filtros = {}) {
  const conEstado = Object.assign({ estado: 'Pendiente' }, filtros);
  const ahora = new Date();

  const inscMap = {};
  sheetToObjects_('Inscripciones').forEach(i => { inscMap[i.ID_Trans] = i; });

  return obtenerLegalizacionesFiltradas_(tipo, conEstado)
    .map(({ l, trans }) => {
      trans = trans || {};
      const insc = inscMap[l.ID_Trans] || {};
      const ts   = trans.Timestamp ? new Date(trans.Timestamp) : null;
      const dias = ts ? Math.floor((ahora - ts) / (1000 * 60 * 60 * 24)) : 0;
      const fechaLeg = l.Fecha_Legalizacion ? new Date(l.Fecha_Legalizacion) : null;

      return {
        idLegal:           l.ID_Legal,
        idTrans:           l.ID_Trans,
        tipo:              l.Tipo,
        estado:            l.Estado,
        notas:             l.Notas,
        nombrePersona:     trans.Nombre_Persona    || '',
        documentoPersona:  trans.Documento_Persona || '',
        actividad:         trans.Actividad      || '',
        modulo:            insc.Modulo          || '',
        horario:           insc.Horario         || '',
        monto:             Number(trans.Monto)  || 0,
        metodoPago:        trans.Metodo_Pago    || '',
        sede:              trans.Sede           || '',
        asesorNombre:      trans.Asesor_Nombre  || '',
        asesorEmail:       trans.Asesor_Email   || '',
        periodo:           trans.Periodo        || '',
        fecha:             ts ? formatDate_(ts) : '',
        diasPendiente:     dias,
        urgente:           dias > 7,
        numeroCaja:        l.Numero_Caja      || '',
        legalizadoPor:     l.Legalizado_Por   || '',
        fechaLegalizacion: fechaLeg ? formatDate_(fechaLeg) : ''
      };
    })
    .sort((a, b) => b.diasPendiente - a.diasPendiente);
}

/**
 * Totales de legalización (total/pendientes/legalizados/%) para un tipo, respetando filtros.
 * @param {'iglesia'|'academia'} tipo
 * @param {Object} filtros - mismos filtros que obtenerCola_, sin 'estado' (se calculan ambos estados)
 * @returns {{total:number, pendientes:number, legalizados:number, pct:number}}
 */
function calcularResumenLegalizacion_(tipo, filtros = {}) {
  const pares       = obtenerLegalizacionesFiltradas_(tipo, filtros);
  const total       = pares.length;
  const legalizados = pares.filter(p => p.l.Estado === 'Legalizado').length;
  const pendientes  = pares.filter(p => p.l.Estado === 'Pendiente').length;
  const pct         = total > 0 ? Math.round((legalizados / total) * 100) : 0;
  return { total, pendientes, legalizados, pct };
}

/**
 * Resumen de legalización (iglesia + academia) para la sección Legalización, respetando
 * los filtros globales de la UI (sede, fechas, asesor, método, búsqueda).
 * @param {Object} filtros
 * @returns {{iglesia:Object, academia:Object}}
 */
function getResumenLegalizacionSeccion(token, filtros) {
  authenticate_(token);
  requireRol_('coordinadora');
  return {
    iglesia:  calcularResumenLegalizacion_('iglesia', filtros),
    academia: calcularResumenLegalizacion_('academia', filtros)
  };
}

/**
 * Marca una transacción como legalizada en la cola y actualiza Transacciones.
 * Para tipo='iglesia' es obligatorio indicar el número de caja usado en el cierre.
 * @param {string} idTrans
 * @param {'iglesia'|'academia'} tipo
 * @param {string} notas
 * @param {string} numeroCaja
 * @returns {{ok:boolean}}
 */
function marcarLegalizado(token, idTrans, tipo, notas = '', numeroCaja = '') {
  authenticate_(token);
  const actorInfo = requireRol_('coordinadora');
  const ahora = new Date();

  if (tipo === 'iglesia' && !numeroCaja.toString().trim()) {
    throw new Error('Debes indicar el número de caja para legalizar el pago.');
  }

  // 1. Actualizar hoja Legalizaciones
  const sheet = getSheet_('Legalizaciones');
  ensureColumn_(sheet, 'Numero_Caja');

  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idTransIdx = headers.indexOf('ID_Trans');
  const tipoIdx    = headers.indexOf('Tipo');
  const estadoIdx  = headers.indexOf('Estado');
  const fechaIdx   = headers.indexOf('Fecha_Legalizacion');
  const notasIdx   = headers.indexOf('Notas');
  const porIdx     = headers.indexOf('Legalizado_Por');
  const cajaIdx    = headers.indexOf('Numero_Caja');

  let found = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i][idTransIdx] === idTrans && values[i][tipoIdx] === tipo && values[i][estadoIdx] === 'Pendiente') {
      sheet.getRange(i + 1, estadoIdx  + 1).setValue('Legalizado');
      sheet.getRange(i + 1, fechaIdx   + 1).setValue(ahora);
      sheet.getRange(i + 1, notasIdx   + 1).setValue(notas);
      if (porIdx >= 0) sheet.getRange(i + 1, porIdx + 1).setValue(actorInfo.email);
      if (cajaIdx >= 0 && numeroCaja) sheet.getRange(i + 1, cajaIdx + 1).setValue(numeroCaja);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`No se encontró legalización pendiente para trans=${idTrans} tipo=${tipo}`);

  // 2. Actualizar estado en la Transacción
  actualizarEstadoLegalizacion_(idTrans, tipo, 'Legalizado');

  return { ok: true };
}

/**
 * Retorna los datos de pendientes para exportar como CSV desde el frontend.
 * @param {'iglesia'|'academia'} tipo
 * @returns {Object[]}
 */
function exportarPendientes(token, tipo) {
  authenticate_(token);
  requireRol_('coordinadora');
  const cola = obtenerCola_(tipo);
  // Retornar array plano apto para construcción de CSV
  return cola.map(item => ({
    'ID Trans':       item.idTrans,
    'Persona':        item.nombrePersona,
    'Documento':      item.documentoPersona,
    'Actividad':      item.actividad,
    'Módulo':         item.modulo,
    'Horario':        item.horario,
    'Monto':          item.monto,
    'Método Pago':    item.metodoPago,
    'Sede':           item.sede,
    'Asesor':         item.asesorNombre,
    'Fecha':          item.fecha,
    'Días pendiente': item.diasPendiente,
    'Urgente':        item.urgente ? 'Sí' : 'No'
  }));
}

/**
 * Resumen de estado de legalización para el dashboard.
 * Función interna: hoy solo la consume getAlertasDashboard (Reportes.js).
 * @returns {{iglesia:{total:number, pendientes:number, legalizados:number, pct:number},
 *            academia:{total:number, pendientes:number, legalizados:number, pct:number}}}
 */
function getResumenLegalizacion_() {
  return {
    iglesia:  calcularResumenLegalizacion_('iglesia', {}),
    academia: calcularResumenLegalizacion_('academia', {})
  };
}

/**
 * Alertas: transacciones con legalización pendiente de más de X días.
 * Función interna: hoy solo la consume getAlertasDashboard (Reportes.js).
 * @param {number} dias - Umbral en días (default 7)
 * @returns {Object[]}
 */
function getAlertasPendientes_(dias) {
  if (dias === undefined) dias = 7;
  const iglesia  = obtenerCola_('iglesia').filter(i => i.diasPendiente > dias);
  const academia = obtenerCola_('academia').filter(i => i.diasPendiente > dias);

  return [...iglesia, ...academia]
    .sort((a, b) => b.diasPendiente - a.diasPendiente)
    .slice(0, 50);
}
