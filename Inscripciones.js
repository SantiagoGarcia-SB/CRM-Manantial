// ─── INSCRIPCIONES.GS ─────────────────────────────────────────────────────────
// Contrato público:
//   crearInscripcionDesdeTransaccion_(datos) → {ok, id}  (interno, sin _)
//   listarInscripciones(filtros)             → {inscripciones:[], total:number}
//   getKPIsInscripciones()                   → Object  (resumen por actividad)

/**
 * Crea una inscripción vinculada a una transacción. Llamada internamente desde crearTransaccion.
 * @param {{idTrans, actividad, modulo, horario, sede, asesorEmail}} datos
 * @returns {{ok:boolean, id:string}}
 */
function crearInscripcionDesdeTransaccion_(datos) {
  const sheet = getSheet_('Inscripciones', true);
  const id    = generateId_('INS');
  const ahora = new Date();

  sheet.appendRow([
    id,
    datos.idTrans,
    datos.actividad,
    datos.modulo   || '',
    datos.horario  || '',
    datos.sede,
    datos.asesorEmail,
    ahora
  ]);

  return { ok: true, id };
}

/**
 * Lista inscripciones con filtros. Solo coordinadora.
 * @param {{actividad?:string, sede?:string, periodo?:string, page?:number, pageSize?:number}} filtros
 * @returns {{inscripciones:Object[], total:number}}
 */
function listarInscripciones(token, filtros = {}) {
  authenticate_(token);
  requireRol_('coordinadora');
  let inscripciones = sheetToObjects_('Inscripciones');

  if (filtros.actividad)   inscripciones = inscripciones.filter(i => (i.Actividad || '').toLowerCase().includes(filtros.actividad.toLowerCase()));
  if (filtros.sede) {
    const sedeMap = buildAsesorSedeMap_();
    inscripciones = inscripciones.filter(i => sedeMap[i.Asesor_Email] === filtros.sede);
  }
  if (filtros.modulo)      inscripciones = inscripciones.filter(i => (i.Modulo || '').toLowerCase().includes(filtros.modulo.toLowerCase()));
  if (filtros.asesorEmail) inscripciones = inscripciones.filter(i => i.Asesor_Email === filtros.asesorEmail);
  if (filtros.fechaDesde) {
    const desde = new Date(filtros.fechaDesde);
    inscripciones = inscripciones.filter(i => i.Fecha && new Date(i.Fecha) >= desde);
  }
  if (filtros.fechaHasta) {
    const hasta = new Date(filtros.fechaHasta);
    hasta.setHours(23, 59, 59);
    inscripciones = inscripciones.filter(i => i.Fecha && new Date(i.Fecha) <= hasta);
  }

  // Enriquecer con estado de legalización desde Transacciones
  const transMap = {};
  sheetToObjects_('Transacciones').forEach(t => { transMap[t.ID_Trans] = t; });

  const total    = inscripciones.length;
  const page     = filtros.page     || 1;
  const pageSize = filtros.pageSize || 50;
  const start    = (page - 1) * pageSize;

  const result = inscripciones
    .sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha))
    .slice(start, start + pageSize)
    .map(i => {
      const trans = transMap[i.ID_Trans] || {};
      return {
        id:              i.ID_Inscripcion,
        idTrans:         i.ID_Trans,
        actividad:       i.Actividad,
        modulo:          i.Modulo,
        horario:         i.Horario,
        sede:            i.Sede,
        asesorEmail:     i.Asesor_Email,
        fecha:           i.Fecha ? formatDate_(new Date(i.Fecha)) : '',
        monto:           Number(trans.Monto) || 0,
        metodoPago:      trans.Metodo_Pago   || '',
        estadoIglesia:   trans.Estado_Legalizacion_Iglesia  || '',
        estadoAcademia:  trans.Estado_Legalizacion_Academia || ''
      };
    });

  return { inscripciones: result, total, page, pageSize };
}

/**
 * KPIs de inscripciones por actividad para el dashboard de coordinadora.
 * @param {string} periodoId - Opcional: filtrar por periodo
 * @returns {{porActividad:Object[], totalInscripciones:number, totalRecaudado:number}}
 */
function getKPIsInscripciones(token, periodoId) {
  authenticate_(token);
  requireRol_('coordinadora');
  let inscripciones = sheetToObjects_('Inscripciones');

  // Enriquecer con monto desde Transacciones
  const transMap = {};
  sheetToObjects_('Transacciones').forEach(t => { transMap[t.ID_Trans] = t; });

  const porActividad = {};
  let totalRecaudado = 0;

  inscripciones.forEach(i => {
    const trans  = transMap[i.ID_Trans] || {};
    const monto  = Number(trans.Monto)  || 0;
    const nombre = i.Actividad          || 'Sin actividad';

    if (!porActividad[nombre]) {
      porActividad[nombre] = { actividad: nombre, cantidad: 0, recaudado: 0 };
    }
    porActividad[nombre].cantidad++;
    porActividad[nombre].recaudado += monto;
    totalRecaudado += monto;
  });

  return {
    porActividad: Object.values(porActividad).sort((a, b) => b.cantidad - a.cantidad),
    totalInscripciones: inscripciones.length,
    totalRecaudado
  };
}
