// ─── REPORTES.GS ──────────────────────────────────────────────────────────────
// Contrato público:
//   getKPIsDashboard()                    → Object  (KPIs principales)
//   getRecaudoPorActividad(periodoId?)    → Object[]
//   getDistribucionPorSede(periodoId?)    → Object[]
//   getDistribucionPorMetodo(periodoId?)  → Object[]
//   getActividadReciente(limite?)         → Object[]
//   getDesempenoAsesores(periodoId?)      → Object[]
//   getAlertasDashboard()                 → Object
//   getReportePorPeriodo(periodoId)       → Object
//   getComparacionPeriodos(id1, id2)      → Object

/**
 * KPIs principales del dashboard de coordinadora.
 * @returns {{recaudoTotal:number, inscripcionesActivas:number, pagosPendientes:number,
 *            sinLegalizar:number, transaccionesHoy:number, periodoActivo:Object|null}}
 */
function getKPIsDashboard(periodoId, sede) {
  requireRol_('coordinadora');

  const transacciones  = sheetToObjects_('Transacciones');
  const inscripciones  = sheetToObjects_('Inscripciones');
  const legalizaciones = sheetToObjects_('Legalizaciones');

  const periodo = periodoId
    ? (sheetToObjects_('Periodos').find(p => p.ID_Periodo === periodoId) || null)
    : getPeriodoActivo_();

  const ahora     = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

  let transPeriodo = periodo
    ? transacciones.filter(t => t.Periodo === periodo.ID_Periodo)
    : transacciones;
  if (sede) transPeriodo = transPeriodo.filter(t => t.Sede === sede);

  const recaudoTotal = transPeriodo.reduce((s, t) => s + (Number(t.Monto) || 0), 0);

  let inscPeriodo = periodo
    ? inscripciones.filter(i => i.Periodo === periodo.ID_Periodo)
    : inscripciones;
  if (sede) inscPeriodo = inscPeriodo.filter(i => i.Sede === sede);

  const pagosPendientes = legalizaciones.filter(l => l.Estado === 'Pendiente').length;

  let sinLegal = transacciones.filter(t =>
    t.Estado_Legalizacion_Iglesia === 'Pendiente' ||
    t.Estado_Legalizacion_Academia === 'Pendiente'
  );
  if (sede) sinLegal = sinLegal.filter(t => t.Sede === sede);

  let transHoy = transacciones.filter(t => t.Timestamp && new Date(t.Timestamp) >= inicioHoy);
  if (sede) transHoy = transHoy.filter(t => t.Sede === sede);

  return {
    recaudoTotal,
    inscripcionesActivas: inscPeriodo.length,
    pagosPendientes,
    sinLegalizar:     sinLegal.length,
    transaccionesHoy: transHoy.length,
    periodoActivo:    periodo ? { id: periodo.ID_Periodo, nombre: periodo.Nombre } : null
  };
}

/**
 * Recaudo total agrupado por actividad (para gráfica de barras).
 * @param {string} periodoId - Opcional
 * @returns {Object[]} [{actividad, cantidad, recaudado}]
 */
function getRecaudoPorActividad(periodoId, sede) {
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones');
  if (periodoId) trans = trans.filter(t => t.Periodo === periodoId);
  if (sede)      trans = trans.filter(t => t.Sede    === sede);

  const agrupado = {};
  trans.forEach(t => {
    const key = t.Actividad || 'Sin actividad';
    if (!agrupado[key]) agrupado[key] = { actividad: key, cantidad: 0, recaudado: 0 };
    agrupado[key].cantidad++;
    agrupado[key].recaudado += Number(t.Monto) || 0;
  });

  return Object.values(agrupado).sort((a, b) => b.recaudado - a.recaudado);
}

/**
 * Distribución de recaudo por sede (para donut chart).
 * @param {string} periodoId - Opcional
 * @returns {Object[]} [{sede, recaudado, cantidad}]
 */
function getDistribucionPorSede(periodoId, sede) {
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones');
  if (periodoId) trans = trans.filter(t => t.Periodo === periodoId);
  if (sede)      trans = trans.filter(t => t.Sede    === sede);

  const agrupado = {};
  trans.forEach(t => {
    const key = t.Sede || 'Sin sede';
    if (!agrupado[key]) agrupado[key] = { sede: key, recaudado: 0, cantidad: 0 };
    agrupado[key].recaudado += Number(t.Monto) || 0;
    agrupado[key].cantidad++;
  });

  return Object.values(agrupado);
}

/**
 * Distribución de recaudo por método de pago (para donut chart).
 * @param {string} periodoId - Opcional
 * @returns {Object[]} [{metodo, recaudado, cantidad}]
 */
function getDistribucionPorMetodo(periodoId, sede) {
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones');
  if (periodoId) trans = trans.filter(t => t.Periodo === periodoId);
  if (sede)      trans = trans.filter(t => t.Sede    === sede);

  const agrupado = {};
  trans.forEach(t => {
    const key = t.Metodo_Pago || 'Desconocido';
    if (!agrupado[key]) agrupado[key] = { metodo: key, recaudado: 0, cantidad: 0 };
    agrupado[key].recaudado += Number(t.Monto) || 0;
    agrupado[key].cantidad++;
  });

  return Object.values(agrupado);
}

/**
 * Feed de actividad reciente (últimas N transacciones de todo el sistema).
 * @param {number} limite
 * @returns {Object[]}
 */
function getActividadReciente(limite = 15, periodoId, sede) {
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones');
  if (periodoId) trans = trans.filter(t => t.Periodo === periodoId);
  if (sede)      trans = trans.filter(t => t.Sede    === sede);
  return trans
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .slice(0, limite)
    .map(t => ({
      idTrans:       t.ID_Trans,
      nombrePersona: t.Nombre_Persona,
      actividad:     t.Actividad,
      monto:         Number(t.Monto) || 0,
      metodoPago:    t.Metodo_Pago,
      asesorNombre:  t.Asesor_Nombre,
      sede:          t.Sede,
      fecha:         t.Timestamp ? formatDate_(new Date(t.Timestamp)) : ''
    }));
}

/**
 * Tabla de desempeño por asesor.
 * @param {string} periodoId - Opcional
 * @returns {Object[]} [{email, nombre, sede, transacciones, recaudado, ultimaActividad}]
 */
function getDesempenoAsesores(periodoId, sede) {
  requireRol_('coordinadora');
  let trans = sheetToObjects_('Transacciones');
  if (periodoId) trans = trans.filter(t => t.Periodo === periodoId);
  if (sede)      trans = trans.filter(t => t.Sede    === sede);

  const porAsesor = {};
  trans.forEach(t => {
    const email = t.Asesor_Email || 'desconocido';
    if (!porAsesor[email]) {
      porAsesor[email] = {
        email,
        nombre:          t.Asesor_Nombre || email,
        transacciones:   0,
        recaudado:       0,
        ultimaActividad: null
      };
    }
    porAsesor[email].transacciones++;
    porAsesor[email].recaudado += Number(t.Monto) || 0;
    const ts = t.Timestamp ? new Date(t.Timestamp) : null;
    if (ts && (!porAsesor[email].ultimaActividad || ts > porAsesor[email].ultimaActividad)) {
      porAsesor[email].ultimaActividad = ts;
    }
  });

  // Enriquecer con sede desde Asesores
  const asesoresMap = {};
  sheetToObjects_('Asesores').forEach(a => { asesoresMap[a.Email] = a; });

  return Object.values(porAsesor)
    .map(a => ({
      ...a,
      sede:            (asesoresMap[a.email] || {}).Sede || '',
      ultimaActividad: a.ultimaActividad ? formatDate_(a.ultimaActividad) : 'Nunca'
    }))
    .sort((a, b) => b.recaudado - a.recaudado);
}

/**
 * Todas las alertas consolidadas para el panel de Alertas.
 * @returns {{sinLegalizar7Dias:Object[], asesoresSinActividad:Object[], resumenLeg:Object}}
 */
function getAlertasDashboard() {
  requireRol_('coordinadora');
  const sinLegalizar7Dias   = getAlertasPendientes(7);
  const resumenLeg          = getResumenLegalizacion();

  // Asesores sin actividad en los últimos 3 días
  const ahora     = new Date();
  const hace3dias = new Date(ahora);
  hace3dias.setDate(ahora.getDate() - 3);

  const trans     = sheetToObjects_('Transacciones');
  const asesores  = sheetToObjects_('Asesores').filter(a => toBool_(a.Activo) && a.Rol === 'asesor');

  const ultimaTransPorAsesor = {};
  trans.forEach(t => {
    const email = t.Asesor_Email;
    const ts    = t.Timestamp ? new Date(t.Timestamp) : null;
    if (email && ts && (!ultimaTransPorAsesor[email] || ts > ultimaTransPorAsesor[email])) {
      ultimaTransPorAsesor[email] = ts;
    }
  });

  const asesoresSinActividad = asesores
    .filter(a => {
      const ultima = ultimaTransPorAsesor[a.Email];
      return !ultima || ultima < hace3dias;
    })
    .map(a => ({
      email:           a.Email,
      nombre:          a.Nombre,
      sede:            a.Sede,
      ultimaActividad: ultimaTransPorAsesor[a.Email]
        ? formatDate_(ultimaTransPorAsesor[a.Email])
        : 'Nunca'
    }));

  return { sinLegalizar7Dias, asesoresSinActividad, resumenLeg };
}

/**
 * Reporte completo de un periodo.
 * @param {string} periodoId
 * @returns {Object}
 */
function getReportePorPeriodo(periodoId) {
  requireRol_('coordinadora');

  const periodos = sheetToObjects_('Periodos');
  const periodo  = periodos.find(p => p.ID_Periodo === periodoId);
  if (!periodo) throw new Error('Periodo no encontrado: ' + periodoId);

  const trans = sheetToObjects_('Transacciones').filter(t => t.Periodo === periodoId);
  const insc  = sheetToObjects_('Inscripciones').filter(i => i.Periodo === periodoId);

  const totalRecaudado   = trans.reduce((s, t) => s + (Number(t.Monto) || 0), 0);
  const totalTransacciones = trans.length;
  const totalInscripciones = insc.length;

  return {
    periodo:             { id: periodo.ID_Periodo, nombre: periodo.Nombre, tipo: periodo.Tipo, año: periodo.Año },
    totalRecaudado,
    totalTransacciones,
    totalInscripciones,
    porActividad:        getRecaudoPorActividad(periodoId),
    porSede:             getDistribucionPorSede(periodoId),
    porMetodo:           getDistribucionPorMetodo(periodoId),
    porAsesor:           getDesempenoAsesores(periodoId)
  };
}

/**
 * Comparación lado a lado de dos periodos.
 * @param {string} id1
 * @param {string} id2
 * @returns {{periodo1:Object, periodo2:Object, variacion:Object}}
 */
function getComparacionPeriodos(id1, id2) {
  requireRol_('coordinadora');
  const r1 = getReportePorPeriodo(id1);
  const r2 = getReportePorPeriodo(id2);

  const variacion = {
    recaudo:        calcVar_(r1.totalRecaudado,      r2.totalRecaudado),
    transacciones:  calcVar_(r1.totalTransacciones,  r2.totalTransacciones),
    inscripciones:  calcVar_(r1.totalInscripciones,  r2.totalInscripciones)
  };

  return { periodo1: r1, periodo2: r2, variacion };
}

function calcVar_(v1, v2) {
  if (v1 === 0) return v2 > 0 ? 100 : 0;
  return Math.round(((v2 - v1) / v1) * 100);
}
