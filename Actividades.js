// ─── ACTIVIDADES.GS ───────────────────────────────────────────────────────────
// Contrato público:
//   listarActividades()             → Object[]  (solo activas, para asesor)
//   listarTodasActividades()        → Object[]  (todas, para coordinadora)
//   obtenerActividad(id)            → Object
//   crearActividad(datos)           → {ok, id}
//   actualizarActividad(id, datos)  → {ok}
//   toggleActividad(id, activa)     → {ok}

/**
 * Convierte un valor de Sheets a booleano.
 * Soporta: true/false, 'TRUE'/'FALSE', 'true'/'false', 1/0
 */
function toBool_(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string')  return val.toUpperCase() === 'TRUE';
  return val === 1;
}

/**
 * Mapea una fila de actividad a objeto normalizado.
 */
function mapActividad_(a) {
  return {
    id:                 a.ID_Actividad,
    nombre:             a.Nombre,
    categoria:          a.Categoria,
    valorBase:          Number(a.Valor_Base) || 0,
    valorVariable:      toBool_(a.Valor_Variable),
    requiereInscripcion:toBool_(a.Requiere_Inscripcion),
    legalizarIglesia:   toBool_(a.Legalizar_Iglesia),
    legalizarAcademia:  toBool_(a.Legalizar_Academia),
    activa:             toBool_(a.Activa)
  };
}

/**
 * Lista solo las actividades activas (para el flujo del asesor).
 * @returns {Object[]}
 */
function listarActividades() {
  requireRol_('asesor', 'coordinadora');
  return sheetToObjects_('Actividades')
    .filter(a => toBool_(a.Activa))
    .map(mapActividad_)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Lista TODAS las actividades (para gestión de la coordinadora).
 * @returns {Object[]}
 */
function listarTodasActividades() {
  requireRol_('coordinadora');
  return sheetToObjects_('Actividades')
    .map(mapActividad_)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Obtiene una actividad por ID.
 * @param {string} id
 * @returns {Object}
 */
function obtenerActividad(id) {
  requireRol_('asesor', 'coordinadora');
  const actividades = sheetToObjects_('Actividades');
  const found = actividades.find(a => a.ID_Actividad === id);
  if (!found) throw new Error('Actividad no encontrada: ' + id);
  return mapActividad_(found);
}

/**
 * Crea una nueva actividad en el catálogo.
 * @param {{nombre:string, categoria:string, valorBase:number, valorVariable:boolean,
 *          requiereInscripcion:boolean, legalizarIglesia:boolean, legalizarAcademia:boolean}} datos
 * @returns {{ok:boolean, id:string}}
 */
function crearActividad(datos) {
  requireRol_('coordinadora');
  validateRequired_(datos, ['nombre', 'categoria']);

  const sheet = getSheet_('Actividades', true);
  const id    = generateId_('ACT');

  sheet.appendRow([
    id,
    datos.nombre.trim(),
    datos.categoria.trim(),
    Number(datos.valorBase)       || 0,
    datos.valorVariable           ? true : false,
    datos.requiereInscripcion     ? true : false,
    datos.legalizarIglesia        ? true : false,
    datos.legalizarAcademia       ? true : false,
    true  // Activa por defecto
  ]);

  return { ok: true, id };
}

/**
 * Actualiza una actividad existente.
 * @param {string} id
 * @param {Object} datos
 * @returns {{ok:boolean}}
 */
function actualizarActividad(id, datos) {
  requireRol_('coordinadora');
  const sheet   = getSheet_('Actividades');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx   = headers.indexOf('ID_Actividad');

  const camposMap = {
    nombre:              'Nombre',
    categoria:           'Categoria',
    valorBase:           'Valor_Base',
    valorVariable:       'Valor_Variable',
    requiereInscripcion: 'Requiere_Inscripcion',
    legalizarIglesia:    'Legalizar_Iglesia',
    legalizarAcademia:   'Legalizar_Academia'
  };

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
      Object.entries(camposMap).forEach(([key, col]) => {
        if (datos[key] !== undefined) {
          const colIdx = headers.indexOf(col);
          if (colIdx >= 0) sheet.getRange(i + 1, colIdx + 1).setValue(datos[key]);
        }
      });
      return { ok: true };
    }
  }
  throw new Error('Actividad no encontrada: ' + id);
}

/**
 * Activa o desactiva una actividad del catálogo.
 * @param {string} id
 * @param {boolean} activa
 * @returns {{ok:boolean}}
 */
function toggleActividad(id, activa) {
  requireRol_('coordinadora');
  const sheet   = getSheet_('Actividades');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx   = headers.indexOf('ID_Actividad');
  const actIdx  = headers.indexOf('Activa');

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
      sheet.getRange(i + 1, actIdx + 1).setValue(activa);
      return { ok: true };
    }
  }
  throw new Error('Actividad no encontrada: ' + id);
}

// ─── PERÍODOS ─────────────────────────────────────────────────────────────────

/**
 * Lista todos los periodos.
 * @returns {Object[]}
 */
function listarPeriodos() {
  requireRol_('asesor', 'coordinadora');
  return sheetToObjects_('Periodos').map(p => ({
    id:          p.ID_Periodo,
    nombre:      p.Nombre,
    tipo:        p.Tipo,
    año:         Number(p.Año) || 0,
    fechaInicio: p.Fecha_Inicio instanceof Date ? formatDate_(p.Fecha_Inicio) : String(p.Fecha_Inicio || ''),
    fechaFin:    p.Fecha_Fin   instanceof Date ? formatDate_(p.Fecha_Fin)   : String(p.Fecha_Fin   || ''),
    activo:      toBool_(p.Activo)
  }));
}

/**
 * Crea un periodo y opcionalmente lo marca como activo (desactivando los demás).
 * @param {{nombre:string, tipo:string, año:number, fechaInicio:string, fechaFin:string, activo:boolean}} datos
 * @returns {{ok:boolean, id:string}}
 */
function crearPeriodo(datos) {
  requireRol_('coordinadora');
  validateRequired_(datos, ['nombre', 'tipo', 'año']);

  if (datos.activo) desactivarTodosLosPeriodos_();

  const sheet = getSheet_('Periodos', true);
  const id    = generateId_('PER');
  sheet.appendRow([
    id, datos.nombre, datos.tipo, datos.año,
    datos.fechaInicio || '', datos.fechaFin || '',
    datos.activo ? true : false
  ]);
  return { ok: true, id };
}

/**
 * Marca un periodo como activo (desactiva todos los demás).
 * @param {string} id
 * @returns {{ok:boolean}}
 */
function activarPeriodo(id) {
  requireRol_('coordinadora');
  desactivarTodosLosPeriodos_();
  const sheet   = getSheet_('Periodos');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx   = headers.indexOf('ID_Periodo');
  const actIdx  = headers.indexOf('Activo');

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
      sheet.getRange(i + 1, actIdx + 1).setValue(true);
      return { ok: true };
    }
  }
  throw new Error('Periodo no encontrado: ' + id);
}

function desactivarTodosLosPeriodos_() {
  const sheet   = getSheet_('Periodos');
  if (!sheet || sheet.getLastRow() < 2) return;
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const actIdx  = headers.indexOf('Activo');
  for (let i = 1; i < values.length; i++) {
    sheet.getRange(i + 1, actIdx + 1).setValue(false);
  }
}
