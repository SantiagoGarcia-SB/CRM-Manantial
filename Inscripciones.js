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
    ahora,
    datos.nombrePersona    || '',
    datos.documentoPersona || '',
    datos.celularPersona   || ''
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
        nombrePersona:   i.Nombre_Persona    || trans.Nombre_Persona    || '',
        documentoPersona:i.Documento_Persona  || trans.Documento_Persona || '',
        celularPersona:  i.Celular_Persona    || trans.Celular_Persona   || '',
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
/**
 * EJECUTAR UNA SOLA VEZ desde el editor de Apps Script.
 * 1. Recupera inscripciones faltantes con datos de persona.
 * 2. Corrige estados de legalización en Transacciones (NA → Pendiente).
 * 3. Crea entradas faltantes en Legalizaciones.
 * 4. Agrega columnas Nombre_Persona, Documento_Persona, Celular_Persona a Inscripciones si faltan.
 */
function recuperarDatosFaltantes() {
  const transacciones  = sheetToObjects_('Transacciones');
  const inscripciones  = sheetToObjects_('Inscripciones');
  const actividades    = sheetToObjects_('Actividades').map(mapActividad_);
  const legalizaciones = sheetToObjects_('Legalizaciones');

  var actMap = {};
  actividades.forEach(function(a) { actMap[a.nombre] = a; });

  var insTransIds = {};
  inscripciones.forEach(function(i) { insTransIds[i.ID_Trans] = true; });

  var legSet = {};
  legalizaciones.forEach(function(l) { legSet[l.ID_Trans + '|' + l.Tipo] = true; });

  agregarColumnasFaltantes();

  var inscCreadas = 0, transCorregidas = 0, legCreadas = 0;

  transacciones.forEach(function(t) {
    if ((t.Estado || 'Activa') === 'Anulada') return;

    var act = actMap[t.Actividad];
    if (!act) return;

    var debeInscribir = act.legalizarInscripcion || (act.modulos && act.modulos.length > 0);

    // 1. Crear inscripción faltante
    if (debeInscribir && !insTransIds[t.ID_Trans]) {
      crearInscripcionDesdeTransaccion_({
        idTrans:          t.ID_Trans,
        actividad:        t.Actividad,
        modulo:           '',
        horario:          '',
        sede:             t.Sede,
        asesorEmail:      t.Asesor_Email,
        nombrePersona:    t.Nombre_Persona    || '',
        documentoPersona: t.Documento_Persona || '',
        celularPersona:   t.Celular_Persona   || ''
      });
      inscCreadas++;
    }

    // 2. Corregir estado legalización pago (iglesia)
    if (act.legalizarPago && t.Estado_Legalizacion_Iglesia === 'NA') {
      actualizarEstadoLegalizacion_(t.ID_Trans, 'iglesia', 'Pendiente');
      transCorregidas++;
      if (!legSet[t.ID_Trans + '|iglesia']) {
        crearEntradaLegalizacion_(t.ID_Trans, 'iglesia');
        legCreadas++;
      }
    }

    // 3. Corregir estado legalización inscripción (academia)
    if (act.legalizarInscripcion && t.Estado_Legalizacion_Academia === 'NA') {
      actualizarEstadoLegalizacion_(t.ID_Trans, 'academia', 'Pendiente');
      transCorregidas++;
      if (!legSet[t.ID_Trans + '|academia']) {
        crearEntradaLegalizacion_(t.ID_Trans, 'academia');
        legCreadas++;
      }
    }
  });

  Logger.log('Inscripciones creadas: ' + inscCreadas);
  Logger.log('Transacciones corregidas: ' + transCorregidas);
  Logger.log('Legalizaciones creadas: ' + legCreadas);
  return { ok: true, inscCreadas: inscCreadas, transCorregidas: transCorregidas, legCreadas: legCreadas };
}

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
