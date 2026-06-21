// ─── AUTH.GS ──────────────────────────────────────────────────────────────────
// Funciones públicas SIN autenticación (llamar con gsrPublic desde el frontend):
//   solicitarAcceso(email)       → {ok}
//   verificarCodigo(email, code) → {token, nombre, sede, rol}
//   cerrarSesion(token)          → {ok}
//   getCurrentUserInfo(token)    → {nombre, sede, rol}
//
// Funciones públicas CON autenticación (primer arg = token, llamar con gsr):
//   listarAsesores(token)                    → Object[]
//   crearAsesor(token, datos)                → {ok}
//   actualizarAsesor(token, email, datos)    → {ok}
//   toggleAsesor(token, email, activo)       → {ok}

// ─── SESIÓN POR EJECUCIÓN ─────────────────────────────────────────────────────
// GAS ejecuta cada google.script.run en un contexto independiente.
// authenticate_() establece esta variable al inicio de cada función protegida;
// requireRol_() la lee en esa misma ejecución.
let _currentSessionEmail = null;

/**
 * Valida el token y establece el email del usuario para esta ejecución.
 * Debe ser la PRIMERA línea de toda función pública protegida.
 */
function authenticate_(token) {
  if (!token) throw new Error('Sesión no iniciada. Por favor inicia sesión.');
  const cached = CacheService.getScriptCache().get('ses_' + token);
  if (!cached) throw new Error('Sesión expirada. Por favor inicia sesión nuevamente.');
  _currentSessionEmail = JSON.parse(cached).email;
  return _currentSessionEmail;
}

// ─── SIN AUTENTICACIÓN ────────────────────────────────────────────────────────

/**
 * Retorna la lista de asesores activos para el selector de la pantalla de inicio.
 */
function listarAsesoresPublico() {
  return sheetToObjects_('Asesores')
    .filter(function(a) { return a.Activo === true || a.Activo === 'TRUE' || a.Activo === 'true'; })
    .map(function(a) { return { email: a.Email, nombre: a.Nombre, sede: a.Sede }; })
    .sort(function(a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
}

/**
 * Retorna las coordinadoras activas para el selector de login.
 */
function listarCoordinadorasPublico() {
  return sheetToObjects_('Asesores')
    .filter(function(a) {
      return (a.Activo === true || a.Activo === 'TRUE' || a.Activo === 'true')
          && a.Rol === 'coordinadora';
    })
    .map(function(a) { return { email: a.Email, nombre: a.Nombre, sede: a.Sede }; })
    .sort(function(a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
}

/**
 * Verifica el PIN de 3 dígitos de la coordinadora y crea una sesión.
 */
function verificarPinCoordinadora(email, pin) {
  if (!email || !pin) throw new Error('Datos incompletos.');
  const emailNorm = email.toLowerCase().trim();
  const info = getRole_(emailNorm);
  if (!info) throw new Error('Coordinadora no encontrada.');
  if (!info.activo) throw new Error('Esta cuenta está inactiva.');
  if (info.rol !== 'coordinadora') throw new Error('Esta cuenta no tiene rol de coordinadora.');
  if (!info.pin) throw new Error('Esta coordinadora no tiene PIN configurado. Agrega el PIN en la hoja Asesores.');
  if (String(info.pin).trim() !== String(pin).trim()) throw new Error('PIN incorrecto.');

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    'ses_' + token,
    JSON.stringify({ email: info.email }),
    21600
  );
  return { token: token, nombre: info.nombre, sede: info.sede, rol: info.rol };
}

/**
 * Crea una sesión para el asesor seleccionado sin requerir OTP.
 */
function seleccionarAsesor(email) {
  if (!email) throw new Error('Selecciona un asesor.');
  const emailNorm = email.toLowerCase().trim();
  const info = getRole_(emailNorm);
  if (!info) throw new Error('Asesor no encontrado.');
  if (!info.activo) throw new Error('Esta cuenta está inactiva. Contacta a tu coordinadora.');

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    'ses_' + token,
    JSON.stringify({ email: info.email }),
    21600
  );
  return { token: token, nombre: info.nombre, sede: info.sede, rol: info.rol };
}

/**
 * Envía un código OTP de 6 dígitos al correo del asesor registrado.
 */
function solicitarAcceso(email) {
  if (!email) throw new Error('Ingresa tu correo electrónico.');
  const emailNorm = email.toLowerCase().trim();
  const info = getRole_(emailNorm);
  if (!info) throw new Error('Correo no registrado. Contacta a tu coordinadora.');
  if (!info.activo) throw new Error('Tu cuenta está desactivada. Contacta a tu coordinadora.');

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  CacheService.getScriptCache().put('otp_' + emailNorm, code, 600); // 10 min

  const htmlCuerpo =
    '<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">' +
    '<h2 style="color:#1a1f36;margin-bottom:8px">Código de acceso</h2>' +
    '<p>Hola <strong>' + escapeHtml_(info.nombre) + '</strong>,</p>' +
    '<p>Tu código para ingresar al CRM Punto de Información es:</p>' +
    '<div style="font-size:38px;letter-spacing:14px;font-weight:700;color:#6c63ff;' +
    'background:#f0f0ff;padding:16px 24px;border-radius:10px;text-align:center;margin:20px 0">' +
    code + '</div>' +
    '<p style="color:#718096;font-size:13px">Válido por <strong>10 minutos</strong>. No compartas este código.</p>' +
    '<p style="color:#718096;font-size:13px">Si no solicitaste este código, ignóralo.</p>' +
    '</div>';

  GmailApp.sendEmail(
    emailNorm,
    'Código de acceso – CRM Punto de Información',
    'Tu código de acceso es: ' + code + '\nVálido por 10 minutos.',
    { htmlBody: htmlCuerpo, name: 'CRM Punto de Información', noReply: true }
  );
  return { ok: true };
}

/**
 * Verifica el código OTP y crea una sesión de 6 horas.
 */
function verificarCodigo(email, code) {
  if (!email || !code) throw new Error('Datos incompletos.');
  const emailNorm = email.toLowerCase().trim();
  const otpKey    = 'otp_' + emailNorm;
  const stored    = CacheService.getScriptCache().get(otpKey);
  if (!stored) throw new Error('El código expiró. Solicita uno nuevo.');
  if (stored.trim() !== code.toString().trim()) throw new Error('Código incorrecto.');

  CacheService.getScriptCache().remove(otpKey);

  const info = getRole_(emailNorm);
  if (!info || !info.activo) throw new Error('Cuenta no válida.');

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    'ses_' + token,
    JSON.stringify({ email: info.email }),
    21600 // 6 horas
  );
  return { token, nombre: info.nombre, sede: info.sede, rol: info.rol };
}

/**
 * Invalida la sesión del token dado.
 */
function cerrarSesion(token) {
  if (token) {
    try { CacheService.getScriptCache().remove('ses_' + token); } catch (e) {}
  }
  return { ok: true };
}

/**
 * Retorna la info del usuario autenticado por token (para verificar sesión al cargar la página).
 */
function getCurrentUserInfo(token) {
  authenticate_(token);
  const info = getRole_(_currentSessionEmail);
  if (!info) throw new Error('Usuario no encontrado.');
  return { nombre: info.nombre, sede: info.sede, rol: info.rol };
}

// ─── CON AUTENTICACIÓN ────────────────────────────────────────────────────────

function listarAsesores(token) {
  authenticate_(token);
  requireRol_('coordinadora');
  return sheetToObjects_('Asesores').map(function(a) {
    return {
      email:  a.Email,
      nombre: a.Nombre,
      sede:   a.Sede,
      rol:    a.Rol,
      activo: a.Activo === true || a.Activo === 'TRUE' || a.Activo === 'true'
    };
  });
}

function crearAsesor(token, datos) {
  authenticate_(token);
  requireRol_('coordinadora');
  validateRequired_(datos, ['email', 'nombre', 'sede', 'rol']);
  const asesores = sheetToObjects_('Asesores');
  const existe   = asesores.find(function(a) { return a.Email.toLowerCase() === datos.email.toLowerCase(); });
  if (existe) throw new Error('Ya existe un asesor con ese correo.');
  getSheet_('Asesores', true).appendRow([datos.email, datos.nombre, datos.sede, datos.rol, true]);
  return { ok: true, mensaje: 'Asesor creado correctamente.' };
}

function actualizarAsesor(token, email, datos) {
  authenticate_(token);
  requireRol_('coordinadora');
  const sheet   = getSheet_('Asesores');
  const values  = sheet.getDataRange().getValues();
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

function toggleAsesor(token, email, activo) {
  authenticate_(token);
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

function getRole_(email) {
  if (!email) return null;
  const asesores = sheetToObjects_('Asesores');
  const found    = asesores.find(function(a) { return a.Email && a.Email.toLowerCase() === email.toLowerCase(); });
  if (!found) return null;
  return {
    email:  found.Email,
    nombre: found.Nombre,
    sede:   found.Sede,
    rol:    found.Rol,
    activo: found.Activo === true || found.Activo === 'TRUE' || found.Activo === 'true',
    pin:    found.Pin || null
  };
}

function requireRol_() {
  const roles = Array.prototype.slice.call(arguments);
  const email = _currentSessionEmail;
  if (!email) throw new Error('No autenticado. Inicia sesión nuevamente.');
  const info  = getRole_(email);
  if (!info || !info.activo || roles.indexOf(info.rol) === -1) {
    throw new Error('Permiso denegado. Se requiere rol: ' + roles.join(' o '));
  }
  return info;
}

function validateRequired_(obj, keys) {
  const missing = keys.filter(function(k) { return obj[k] === undefined || obj[k] === null || obj[k] === ''; });
  if (missing.length > 0) throw new Error('Campos requeridos faltantes: ' + missing.join(', '));
}

function formatDate_(date) {
  if (!date || !(date instanceof Date)) return '';
  return Utilities.formatDate(date, 'America/Bogota', 'dd/MM/yyyy HH:mm');
}

function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}
