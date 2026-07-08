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
  let horarios = [];
  let modulos  = [];
  try { horarios = JSON.parse(a.Horarios  || '[]'); } catch(e) {}
  try { modulos  = JSON.parse(a.Modulos   || '[]'); } catch(e) {}
  return {
    id:                  a.ID_Actividad,
    nombre:              a.Nombre,
    categoria:           a.Categoria,
    valorBase:           Number(a.Valor_Base) || 0,
    valorVariable:       toBool_(a.Valor_Variable),
    requiereInscripcion: toBool_(a.Requiere_Inscripcion),
    legalizarIglesia:    toBool_(a.Legalizar_Iglesia),
    legalizarAcademia:   toBool_(a.Legalizar_Academia),
    legalizarPago:       toBool_(a.Legalizar_Pago),
    legalizarInscripcion:toBool_(a.Legalizar_Inscripcion),
    horarios:            horarios,
    modulos:             modulos,
    activa:              toBool_(a.Activa)
  };
}

/**
 * Lista solo las actividades activas (para el flujo del asesor).
 * @returns {Object[]}
 */
function listarActividades(token) {
  authenticate_(token);
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
function listarTodasActividades(token) {
  authenticate_(token);
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
function obtenerActividad_(id) {
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
function crearActividad(token, datos) {
  authenticate_(token);
  const actorInfo = requireRol_('coordinadora');
  validateRequired_(datos, ['nombre', 'categoria']);

  const sheet = getSheet_('Actividades', true);
  const id    = generateId_('ACT');

  sheet.appendRow([
    id,
    datos.nombre.trim(),
    datos.categoria.trim(),
    Number(datos.valorBase)         || 0,
    datos.valorVariable             ? true : false,
    datos.requiereInscripcion       ? true : false,
    datos.legalizarIglesia          ? true : false,
    datos.legalizarAcademia         ? true : false,
    true,  // Activa por defecto
    datos.legalizarPago             ? true : false,
    datos.legalizarInscripcion      ? true : false,
    JSON.stringify(datos.horarios   || []),
    JSON.stringify(datos.modulos    || []),
    actorInfo.email,
    formatDate_(new Date())
  ]);

  return { ok: true, id };
}

/**
 * Actualiza una actividad existente.
 * @param {string} id
 * @param {Object} datos
 * @returns {{ok:boolean}}
 */
function actualizarActividad(token, id, datos) {
  authenticate_(token);
  const actorInfo = requireRol_('coordinadora');
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
    legalizarAcademia:   'Legalizar_Academia',
    legalizarPago:       'Legalizar_Pago',
    legalizarInscripcion:'Legalizar_Inscripcion',
    horarios:            'Horarios',
    modulos:             'Modulos'
  };

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
      Object.entries(camposMap).forEach(([key, col]) => {
        if (datos[key] !== undefined) {
          const colIdx = headers.indexOf(col);
          if (colIdx >= 0) {
            const val = (key === 'horarios' || key === 'modulos') && Array.isArray(datos[key])
              ? JSON.stringify(datos[key])
              : datos[key];
            sheet.getRange(i + 1, colIdx + 1).setValue(val);
          }
        }
      });
      const modPorIdx   = headers.indexOf('Modificado_Por');
      const modFechaIdx = headers.indexOf('Modificado_Fecha');
      if (modPorIdx   >= 0) sheet.getRange(i + 1, modPorIdx   + 1).setValue(actorInfo.email);
      if (modFechaIdx >= 0) sheet.getRange(i + 1, modFechaIdx + 1).setValue(formatDate_(new Date()));
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
function toggleActividad(token, id, activa) {
  authenticate_(token);
  const actorInfo = requireRol_('coordinadora');
  const sheet   = getSheet_('Actividades');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx   = headers.indexOf('ID_Actividad');
  const actIdx  = headers.indexOf('Activa');
  const modPorIdx   = headers.indexOf('Modificado_Por');
  const modFechaIdx = headers.indexOf('Modificado_Fecha');

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
      sheet.getRange(i + 1, actIdx + 1).setValue(activa);
      if (modPorIdx   >= 0) sheet.getRange(i + 1, modPorIdx   + 1).setValue(actorInfo.email);
      if (modFechaIdx >= 0) sheet.getRange(i + 1, modFechaIdx + 1).setValue(formatDate_(new Date()));
      return { ok: true };
    }
  }
  throw new Error('Actividad no encontrada: ' + id);
}

// ─── CATEGORÍAS ───────────────────────────────────────────────────────────────

const CATEGORIAS_DEFAULT_ = [
  'Academia El Camino', 'Campamentos', 'Conéctate',
  'Donaciones', 'Encuentros', 'Grupos de Cuidado'
];

/**
 * Lista todas las categorías. Si la hoja está vacía, siembra las categorías por defecto.
 * @returns {{id:string, nombre:string}[]}
 */
function listarCategorias(token) {
  authenticate_(token);
  requireRol_('coordinadora');
  const sheet = getSheet_('Categorias', true);
  const rows  = sheetToObjects_('Categorias');

  if (rows.length === 0) {
    CATEGORIAS_DEFAULT_.forEach(nombre => {
      sheet.appendRow([generateId_('CAT'), nombre]);
    });
    return CATEGORIAS_DEFAULT_.map(nombre => ({ id: '', nombre }));
  }

  return rows
    .map(c => ({ id: c.ID_Categoria, nombre: c.Nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Crea una nueva categoría. Lanza error si ya existe una con el mismo nombre.
 * @param {string} nombre
 * @returns {{ok:boolean, id:string}}
 */
function crearCategoria(token, nombre) {
  authenticate_(token);
  requireRol_('coordinadora');
  if (!nombre || !nombre.trim()) throw new Error('El nombre es requerido');
  const existing = sheetToObjects_('Categorias');
  if (existing.some(c => c.Nombre.toLowerCase() === nombre.trim().toLowerCase())) {
    throw new Error('Ya existe una categoría con ese nombre');
  }
  const sheet = getSheet_('Categorias', true);
  const id    = generateId_('CAT');
  sheet.appendRow([id, nombre.trim()]);
  return { ok: true, id };
}

/**
 * Elimina una categoría por ID.
 * @param {string} id
 * @returns {{ok:boolean}}
 */
function eliminarCategoria(token, id) {
  authenticate_(token);
  requireRol_('coordinadora');
  const sheet   = getSheet_('Categorias');
  if (!sheet) throw new Error('Hoja de categorías no encontrada');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx   = headers.indexOf('ID_Categoria');
  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('Categoría no encontrada');
}

