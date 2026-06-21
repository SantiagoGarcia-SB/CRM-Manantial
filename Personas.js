// ─── PERSONAS.GS ──────────────────────────────────────────────────────────────
// Contrato público:
//   buscarPersonas(query)              → Object[]  (búsqueda por cédula/nombre/correo)
//   obtenerPersona(documento)          → Object    (ficha completa + historial)
//   crearPersona(datos)                → {ok, persona}
//   actualizarPersona(documento, datos)→ {ok}
//   listarPersonas(filtros)            → Object[]  (coordinadora)

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

  const transacciones = sheetToObjects_('Transacciones')
    .filter(t => t.Nombre_Persona === persona.Nombre)
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
 * Actualiza datos de una persona existente.
 * @param {string} documento
 */
function actualizarPersona(token, documento, datos) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  const sheet   = getSheet_('Personas');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const docIdx  = headers.indexOf('Documento');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][docIdx]) === String(documento)) {
      const campos = { Nombre: datos.nombre, Celular: datos.celular, Correo: datos.correo, Sede: datos.sede };
      Object.entries(campos).forEach(([campo, valor]) => {
        if (valor !== undefined && valor !== null) {
          const idx = headers.indexOf(campo);
          if (idx >= 0) sheet.getRange(i + 1, idx + 1).setValue(valor);
        }
      });
      return { ok: true };
    }
  }
  throw new Error('Persona no encontrada: ' + documento);
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
