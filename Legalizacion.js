// ─── LEGALIZACION.GS ──────────────────────────────────────────────────────────
// Contrato público:
//   crearEntradaLegalizacion_(idTrans, tipo)   → string (id) [interno]
//   obtenerColaIglesia()                       → Object[]
//   obtenerColaAcademia()                      → Object[]
//   marcarLegalizado(idTrans, tipo, notas?)    → {ok}
//   exportarPendientes(tipo)                   → Object[]  (datos para CSV frontend)
//   getResumenLegalizacion()                   → {iglesia:{}, academia:{}}
//   getAlertasPendientes()                     → Object[]  (>7 días)

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
 * @returns {Object[]}
 */
function obtenerColaIglesia() {
  return obtenerCola_('iglesia');
}

/**
 * Obtiene la cola de legalización para Academia El Camino.
 * @returns {Object[]}
 */
function obtenerColaAcademia() {
  return obtenerCola_('academia');
}

function obtenerCola_(tipo) {
  requireRol_('coordinadora');
  const legalizaciones = sheetToObjects_('Legalizaciones')
    .filter(l => l.Tipo === tipo && l.Estado === 'Pendiente');

  // Enriquecer con datos de la transacción
  const transMap = {};
  sheetToObjects_('Transacciones').forEach(t => { transMap[t.ID_Trans] = t; });

  const ahora = new Date();

  return legalizaciones
    .map(l => {
      const trans = transMap[l.ID_Trans] || {};
      const ts    = trans.Timestamp ? new Date(trans.Timestamp) : null;
      const dias  = ts ? Math.floor((ahora - ts) / (1000 * 60 * 60 * 24)) : 0;

      return {
        idLegal:       l.ID_Legal,
        idTrans:       l.ID_Trans,
        tipo:          l.Tipo,
        estado:        l.Estado,
        notas:         l.Notas,
        nombrePersona: trans.Nombre_Persona || '',
        actividad:     trans.Actividad      || '',
        monto:         Number(trans.Monto)  || 0,
        metodoPago:    trans.Metodo_Pago    || '',
        sede:          trans.Sede           || '',
        asesorNombre:  trans.Asesor_Nombre  || '',
        asesorEmail:   trans.Asesor_Email   || '',
        periodo:       trans.Periodo        || '',
        fecha:         ts ? formatDate_(ts) : '',
        diasPendiente: dias,
        urgente:       dias > 7
      };
    })
    .sort((a, b) => b.diasPendiente - a.diasPendiente);
}

/**
 * Marca una transacción como legalizada en la cola y actualiza Transacciones.
 * @param {string} idTrans
 * @param {'iglesia'|'academia'} tipo
 * @param {string} notas
 * @returns {{ok:boolean}}
 */
function marcarLegalizado(idTrans, tipo, notas = '') {
  requireRol_('coordinadora');
  const ahora = new Date();

  // 1. Actualizar hoja Legalizaciones
  const sheet   = getSheet_('Legalizaciones');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idTransIdx = headers.indexOf('ID_Trans');
  const tipoIdx    = headers.indexOf('Tipo');
  const estadoIdx  = headers.indexOf('Estado');
  const fechaIdx   = headers.indexOf('Fecha_Legalizacion');
  const notasIdx   = headers.indexOf('Notas');

  let found = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i][idTransIdx] === idTrans && values[i][tipoIdx] === tipo && values[i][estadoIdx] === 'Pendiente') {
      sheet.getRange(i + 1, estadoIdx  + 1).setValue('Legalizado');
      sheet.getRange(i + 1, fechaIdx   + 1).setValue(ahora);
      sheet.getRange(i + 1, notasIdx   + 1).setValue(notas);
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`No se encontró legalización pendiente para trans=${idTrans} tipo=${tipo}`);

  // 2. Actualizar estado en la Transacción
  actualizarEstadoLegalizacion(idTrans, tipo, 'Legalizado');

  return { ok: true };
}

/**
 * Retorna los datos de pendientes para exportar como CSV desde el frontend.
 * @param {'iglesia'|'academia'} tipo
 * @returns {Object[]}
 */
function exportarPendientes(tipo) {
  requireRol_('coordinadora');
  const cola = tipo === 'iglesia' ? obtenerColaIglesia() : obtenerColaAcademia();
  // Retornar array plano apto para construcción de CSV
  return cola.map(item => ({
    'ID Trans':       item.idTrans,
    'Persona':        item.nombrePersona,
    'Actividad':      item.actividad,
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
 * @returns {{iglesia:{total:number, pendientes:number, legalizados:number, pct:number},
 *            academia:{total:number, pendientes:number, legalizados:number, pct:number}}}
 */
function getResumenLegalizacion() {
  requireRol_('coordinadora');
  const legalizaciones = sheetToObjects_('Legalizaciones');

  function calcular(tipo) {
    const filtradas   = legalizaciones.filter(l => l.Tipo === tipo);
    const pendientes  = filtradas.filter(l => l.Estado === 'Pendiente').length;
    const legalizados = filtradas.filter(l => l.Estado === 'Legalizado').length;
    const total       = filtradas.length;
    const pct         = total > 0 ? Math.round((legalizados / total) * 100) : 0;
    return { total, pendientes, legalizados, pct };
  }

  return {
    iglesia:  calcular('iglesia'),
    academia: calcular('academia')
  };
}

/**
 * Alertas: transacciones con legalización pendiente de más de X días.
 * @param {number} dias - Umbral en días (default 7)
 * @returns {Object[]}
 */
function getAlertasPendientes(dias = 7) {
  requireRol_('coordinadora');
  const iglesia  = obtenerColaIglesia().filter(i => i.diasPendiente > dias);
  const academia = obtenerColaAcademia().filter(i => i.diasPendiente > dias);

  return [...iglesia, ...academia]
    .sort((a, b) => b.diasPendiente - a.diasPendiente)
    .slice(0, 50);
}
