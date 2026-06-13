// ─── AUTH.GS ──────────────────────────────────────────────────────────────────
// Contrato público:
//   getRole(email)              → {email, nombre, sede, rol, activo} | null
//   getCurrentUserInfo()        → {email, nombre, sede, rol} (llamable desde frontend)
//   listarAsesores()            → Object[]  (coordinadora)
//   crearAsesor(datos)          → {ok, id}
//   actualizarAsesor(email, datos) → {ok}
//   toggleAsesor(email, activo) → {ok}

/**
 * Busca un email en la hoja Asesores y retorna su info de rol.
 * @param {string} email
 * @returns {{email:string, nombre:string, sede:string, rol:string, activo:boolean}|null}
 */
function getRole_(email) {
  if (!email) return null;
  const asesores = sheetToObjects_('Asesores');
  const found = asesores.find(a => a.Email && a.Email.toLowerCase() === email.toLowerCase());
  if (!found) return null;
  return {
    email:  found.Email,
    nombre: found.Nombre,
    sede:   found.Sede,
    rol:    found.Rol,
    activo: found.Activo === true || found.Activo === 'TRUE' || found.Activo === 'true'
  };
}

/**
 * Retorna la info del usuario activo. Llamable desde el frontend.
 * @returns {{email, nombre, sede, rol}}
 */
function getCurrentUserInfo() {
  const email = Session.getActiveUser().getEmail();
  const info  = getRole_(email);
  if (!info) throw new Error('Usuario no autorizado');
  return info;
}

/**
 * Lista todos los asesores. Solo accesible por coordinadora.
 * @returns {Object[]}
 */
function listarAsesores() {
  requireRol_('coordinadora');
  return sheetToObjects_('Asesores').map(a => ({
    email:  a.Email,
    nombre: a.Nombre,
    sede:   a.Sede,
    rol:    a.Rol,
    activo: a.Activo === true || a.Activo === 'TRUE' || a.Activo === 'true'
  }));
}

/**
 * Crea un nuevo asesor.
 * @param {{email:string, nombre:string, sede:string, rol:string}} datos
 * @returns {{ok:boolean, mensaje:string}}
 */
function crearAsesor(datos) {
  requireRol_('coordinadora');
  validateRequired_(datos, ['email','nombre','sede','rol']);

  const sheet    = getSheet_('Asesores', true);
  const asesores = sheetToObjects_('Asesores');
  const existe   = asesores.find(a => a.Email.toLowerCase() === datos.email.toLowerCase());
  if (existe) throw new Error('Ya existe un asesor con ese correo.');

  sheet.appendRow([datos.email, datos.nombre, datos.sede, datos.rol, true]);
  return { ok: true, mensaje: 'Asesor creado correctamente.' };
}

/**
 * Actualiza los datos de un asesor.
 * @param {string} email
 * @param {{nombre?:string, sede?:string, rol?:string}} datos
 * @returns {{ok:boolean}}
 */
function actualizarAsesor(email, datos) {
  requireRol_('coordinadora');
  const sheet  = getSheet_('Asesores');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const emailIdx = headers.indexOf('Email');

  for (let i = 1; i < values.length; i++) {
    if (values[i][emailIdx] && values[i][emailIdx].toLowerCase() === email.toLowerCase()) {
      if (datos.nombre) sheet.getRange(i + 1, headers.indexOf('Nombre') + 1).setValue(datos.nombre);
      if (datos.sede)   sheet.getRange(i + 1, headers.indexOf('Sede')   + 1).setValue(datos.sede);
      if (datos.rol)    sheet.getRange(i + 1, headers.indexOf('Rol')    + 1).setValue(datos.rol);
      return { ok: true };
    }
  }
  throw new Error('Asesor no encontrado: ' + email);
}

/**
 * Activa o desactiva un asesor.
 * @param {string} email
 * @param {boolean} activo
 * @returns {{ok:boolean}}
 */
function toggleAsesor(email, activo) {
  requireRol_('coordinadora');
  const sheet   = getSheet_('Asesores');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const emailIdx  = headers.indexOf('Email');
  const activoIdx = headers.indexOf('Activo');

  for (let i = 1; i < values.length; i++) {
    if (values[i][emailIdx] && values[i][emailIdx].toLowerCase() === email.toLowerCase()) {
      sheet.getRange(i + 1, activoIdx + 1).setValue(activo);
      return { ok: true };
    }
  }
  throw new Error('Asesor no encontrado: ' + email);
}

// ─── HELPERS COMPARTIDOS (disponibles en todos los .gs) ───────────────────────

/**
 * Lanza error si el usuario activo no tiene el rol requerido.
 * @param {...string} roles - Roles permitidos
 */
function requireRol_(...roles) {
  const email = Session.getActiveUser().getEmail();
  const info  = getRole_(email);
  if (!info || !roles.includes(info.rol)) {
    throw new Error('Permiso denegado. Se requiere rol: ' + roles.join(' o '));
  }
  return info;
}

/**
 * Valida que un objeto tenga todas las claves requeridas con valores no vacíos.
 * @param {Object} obj
 * @param {string[]} keys
 */
function validateRequired_(obj, keys) {
  const missing = keys.filter(k => obj[k] === undefined || obj[k] === null || obj[k] === '');
  if (missing.length > 0) {
    throw new Error('Campos requeridos faltantes: ' + missing.join(', '));
  }
}

/**
 * Obtiene el periodo activo actual.
 * @returns {{id:string, nombre:string, tipo:string}|null}
 */
function getPeriodoActivo_() {
  const periodos = sheetToObjects_('Periodos');
  return periodos.find(p => p.Activo === true || p.Activo === 'TRUE' || p.Activo === 'true') || null;
}

/**
 * Formatea un Date a string legible en Colombia.
 * @param {Date} date
 * @returns {string}
 */
function formatDate_(date) {
  if (!date || !(date instanceof Date)) return '';
  return Utilities.formatDate(date, 'America/Bogota', 'dd/MM/yyyy HH:mm');
}
