// ─── PERSONAS.GS ──────────────────────────────────────────────────────────────
// Contrato público:
//   buscarPersonas(query)              → Object[]  (búsqueda por cédula/nombre/correo)
//   obtenerPersona(documento)          → Object    (ficha completa + historial)
//   crearPersona(datos)                → {ok, persona}
//   actualizarPersona(documento, datos)→ {ok}
//   listarPersonas(filtros)            → Object[]  (coordinadora)

function validarCorreo_(correo) {
  if (!correo) return '';
  correo = correo.toString().trim().toLowerCase();
  if (!correo) return '';
  if (/^\d+$/.test(correo)) throw new Error('El campo correo no puede ser un número de celular. Ingresa un email válido.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('El correo "' + correo + '" no es válido. Debe tener formato correo@ejemplo.com');
  return correo;
}

function mapPersona_(p) {
  return {
    id:            String(p.Documento || ''),
    nombre:        p.Nombre,
    documento:     String(p.Documento || ''),
    celular:       p.Celular,
    correo:        p.Correo,
    sede:          p.Sede,
    fechaRegistro: p.Fecha_Registro ? formatDate_(new Date(p.Fecha_Registro)) : ''
  };
}

/**
 * Busca personas por cédula, nombre o correo (búsqueda parcial, case-insensitive).
 * Retorna máximo 20 resultados.
 */
function buscarPersonas(token, query) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  if (!query || query.trim().length < 2) return [];

  const q        = query.trim().toLowerCase();
  const personas = sheetToObjects_('Personas');

  return personas
    .filter(p => {
      const nombre    = (p.Nombre    || '').toString().toLowerCase();
      const documento = (p.Documento || '').toString().toLowerCase();
      const correo    = (p.Correo    || '').toString().toLowerCase();
      const celular   = (p.Celular   || '').toString().toLowerCase();
      return nombre.includes(q) || documento.includes(q) ||
             correo.includes(q) || celular.includes(q);
    })
    .slice(0, 20)
    .map(mapPersona_);
}

/**
 * Obtiene la ficha completa de una persona + su historial de transacciones.
 * @param {string} documento
 */
function obtenerPersona(token, documento) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  const personas = sheetToObjects_('Personas');
  const persona  = personas.find(p => String(p.Documento) === String(documento));
  if (!persona) throw new Error('Persona no encontrada: ' + documento);

  // Prefiere el documento como llave (evita mezclar personas homónimas), pero
  // si la fila es antigua y no tiene documento guardado, cae de vuelta al
  // nombre para no perder ese historial — mismo criterio que getCarteraAsesor.
  const documentoStr = String(persona.Documento || '');
  const transacciones = sheetToObjects_('Transacciones')
    .filter(t => {
      const tDoc = String(t.Documento_Persona || '');
      if (documentoStr && tDoc) return tDoc === documentoStr;
      return t.Nombre_Persona === persona.Nombre;
    })
    .map(t => ({
      id:                    t.ID_Trans,
      timestamp:             t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
      actividad:             t.Actividad,
      monto:                 t.Monto,
      metodoPago:            t.Metodo_Pago,
      asesorNombre:          t.Asesor_Nombre,
      estadoIglesia:         t.Estado_Legalizacion_Iglesia,
      estadoAcademia:        t.Estado_Legalizacion_Academia,
      estado:                t.Estado || 'Activa',
    }))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return { persona: mapPersona_(persona), transacciones };
}

/**
 * Crea una nueva persona. Verifica duplicado por documento.
 */
function crearPersona(token, datos) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  validateRequired_(datos, ['nombre', 'documento', 'sede']);
  datos.nombre = datos.nombre.trim().toLowerCase().replace(/(?:^|\s)\S/g, function(c) { return c.toUpperCase(); });
  datos.correo = validarCorreo_(datos.correo);

  const personas = sheetToObjects_('Personas');
  const duplicado = personas.find(p =>
    p.Documento && p.Documento.toString() === datos.documento.toString()
  );
  if (duplicado) {
    return {
      ok: true,
      yaExistia: true,
      persona: mapPersona_(duplicado)
    };
  }

  const sheet = getSheet_('Personas', true);
  const ahora = new Date();

  sheet.appendRow([
    datos.nombre.trim(),
    datos.documento.toString().trim(),
    (datos.celular || '').toString().trim(),
    (datos.correo  || '').trim().toLowerCase(),
    datos.sede,
    ahora
  ]);

  return {
    ok: true,
    yaExistia: false,
    persona: {
      id:        datos.documento.toString().trim(),
      nombre:    datos.nombre.trim(),
      documento: datos.documento.toString().trim(),
      correo:    datos.correo   || '',
      celular:   datos.celular  || '',
      sede:      datos.sede
    }
  };
}

/**
 * Propaga un cambio de nombre/documento de una persona a sus transacciones e
 * inscripciones pasadas (que guardan su propia copia de esos datos, sin
 * ningún enlace vivo a la hoja Personas), para que el historial no quede
 * desincronizado de la ficha ya corregida. Solo toca las filas que ya
 * pertenecían a esa persona, identificadas por su documento anterior.
 */
function propagarIdentidadPersona_(documentoAnterior, documentoNuevo, nombreNuevo) {
  if (!documentoAnterior) return; // evita cascadear sobre filas antiguas sin documento
  [
    { hoja: 'Transacciones', colDoc: 'Documento_Persona', colNombre: 'Nombre_Persona' },
    { hoja: 'Inscripciones', colDoc: 'Documento_Persona', colNombre: 'Nombre_Persona' }
  ].forEach(function(cfg) {
    const sheet = getSheet_(cfg.hoja);
    if (!sheet) return;
    const values  = sheet.getDataRange().getValues();
    const headers = values[0];
    const docIdx    = headers.indexOf(cfg.colDoc);
    const nombreIdx = headers.indexOf(cfg.colNombre);
    if (docIdx === -1) return;

    const cambiaDoc    = documentoNuevo !== undefined && documentoNuevo !== documentoAnterior;
    const cambiaNombre = nombreIdx >= 0 && nombreNuevo !== undefined && nombreNuevo !== null;
    if (!cambiaDoc && !cambiaNombre) return;

    const numFilas = values.length - 1;
    if (numFilas <= 0) return;

    // Se arma la columna completa en memoria y se escribe en un solo
    // setValues() por columna, en vez de un setValue() por fila coincidente:
    // con un historial largo, escribir celda por celda podía mantener el
    // bloqueo global (el mismo que usa el registro de pagos) tomado varios
    // segundos, frenando a otros asesores mientras tanto.
    let huboCambios = false;
    const colDocValues    = cambiaDoc    ? [] : null;
    const colNombreValues = cambiaNombre ? [] : null;
    for (let i = 1; i < values.length; i++) {
      const match = String(values[i][docIdx]) === String(documentoAnterior);
      if (match) huboCambios = true;
      if (cambiaDoc)    colDocValues.push([match ? documentoNuevo : values[i][docIdx]]);
      if (cambiaNombre) colNombreValues.push([match ? nombreNuevo : values[i][nombreIdx]]);
    }
    if (!huboCambios) return;

    if (cambiaDoc)    sheet.getRange(2, docIdx + 1, numFilas, 1).setValues(colDocValues);
    if (cambiaNombre) sheet.getRange(2, nombreIdx + 1, numFilas, 1).setValues(colNombreValues);
  });
}

/**
 * Actualiza datos de una persona existente. Si cambia el nombre o el
 * documento, propaga el cambio a su historial (ver propagarIdentidadPersona_)
 * bajo bloqueo, para que no se cruce con un registro de pago simultáneo de
 * la misma persona.
 * @param {string} documento
 */
function actualizarPersona(token, documento, datos) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');

  const nuevoDocumento = (datos.documento !== undefined && datos.documento !== null)
    ? datos.documento.toString().trim()
    : undefined;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('El sistema está ocupado procesando otro cambio. Intenta de nuevo en unos segundos.');
  }
  try {
    const sheet   = getSheet_('Personas');
    const values  = sheet.getDataRange().getValues();
    const headers = values[0];
    const docIdx    = headers.indexOf('Documento');
    const nombreIdx = headers.indexOf('Nombre');

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][docIdx]) === String(documento)) {
        if (datos.correo !== undefined && datos.correo !== null) datos.correo = validarCorreo_(datos.correo);

        if (nuevoDocumento !== undefined && nuevoDocumento !== '' && nuevoDocumento !== String(values[i][docIdx])) {
          const choque = values.some((row, idx) => idx > 0 && idx !== i && String(row[docIdx]) === nuevoDocumento);
          if (choque) throw new Error('Ya existe otra persona registrada con el documento ' + nuevoDocumento + '.');
        }

        const documentoAnterior = String(values[i][docIdx]);
        const nombreAnterior    = values[i][nombreIdx];

        const campos = {
          Nombre:    datos.nombre,
          Documento: (nuevoDocumento !== undefined && nuevoDocumento !== '') ? nuevoDocumento : undefined,
          Celular:   datos.celular,
          Correo:    datos.correo,
          Sede:      datos.sede
        };
        Object.entries(campos).forEach(([campo, valor]) => {
          if (valor !== undefined && valor !== null) {
            const idx = headers.indexOf(campo);
            if (idx >= 0) sheet.getRange(i + 1, idx + 1).setValue(valor);
          }
        });

        const documentoFinal = campos.Documento !== undefined ? campos.Documento : documentoAnterior;
        const nombreFinal    = campos.Nombre    !== undefined ? campos.Nombre    : nombreAnterior;
        if (documentoFinal !== documentoAnterior || nombreFinal !== nombreAnterior) {
          propagarIdentidadPersona_(documentoAnterior, documentoFinal, nombreFinal);
        }

        return { ok: true };
      }
    }
    throw new Error('Persona no encontrada: ' + documento);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Lista todas las personas con paginación simple (coordinadora).
 */
function listarPersonas(token, filtros = {}) {
  authenticate_(token);
  requireRol_('coordinadora');
  let personas = sheetToObjects_('Personas');

  if (filtros.sede) {
    personas = personas.filter(p => p.Sede === filtros.sede);
  }
  if (filtros.busqueda) {
    const q = filtros.busqueda.toLowerCase();
    personas = personas.filter(p =>
      (p.Documento || '').toString().toLowerCase().includes(q)
    );
  }

  const total    = personas.length;
  const page     = filtros.page     || 1;
  const pageSize = filtros.pageSize || 50;
  const start    = (page - 1) * pageSize;

  return {
    personas: personas.slice(start, start + pageSize).map(mapPersona_),
    total,
    page,
    pageSize
  };
}
