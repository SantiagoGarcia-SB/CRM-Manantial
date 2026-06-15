// ─── PERSONAS.GS ──────────────────────────────────────────────────────────────
// Contrato público:
//   buscarPersonas(query)        → Object[]  (búsqueda por cédula/nombre/correo)
//   obtenerPersona(id)           → Object    (ficha completa + historial)
//   crearPersona(datos)          → {ok, persona}
//   actualizarPersona(id, datos) → {ok}
//   listarPersonas(filtros)      → Object[]  (coordinadora)

/**
 * Busca personas por cédula, nombre o correo (búsqueda parcial, case-insensitive).
 * Retorna máximo 20 resultados.
 * @param {string} query
 * @returns {Object[]}
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
    .map(p => ({
      id:             p.ID_Persona,
      nombre:         p.Nombre,
      documento:      p.Documento,
      celular:        p.Celular,
      correo:         p.Correo,
      sede:           p.Sede,
      fechaRegistro:  p.Fecha_Registro ? formatDate_(new Date(p.Fecha_Registro)) : ''
    }));
}

/**
 * Obtiene la ficha completa de una persona + su historial de transacciones.
 * @param {string} id - ID_Persona
 * @returns {{persona: Object, transacciones: Object[]}}
 */
function obtenerPersona(token, id) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  const personas = sheetToObjects_('Personas');
  const persona  = personas.find(p => p.ID_Persona === id);
  if (!persona) throw new Error('Persona no encontrada: ' + id);

  const transacciones = sheetToObjects_('Transacciones')
    .filter(t => t.ID_Persona === id)
    .map(t => ({
      id:                    t.ID_Trans,
      timestamp:             t.Timestamp ? formatDate_(new Date(t.Timestamp)) : '',
      actividad:             t.Actividad,
      monto:                 t.Monto,
      metodoPago:            t.Metodo_Pago,
      asesorNombre:          t.Asesor_Nombre,
      estadoIglesia:         t.Estado_Legalizacion_Iglesia,
      estadoAcademia:        t.Estado_Legalizacion_Academia,
      periodo:               t.Periodo
    }))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    persona: {
      id:            persona.ID_Persona,
      nombre:        persona.Nombre,
      documento:     persona.Documento,
      celular:       persona.Celular,
      correo:        persona.Correo,
      sede:          persona.Sede,
      fechaRegistro: persona.Fecha_Registro ? formatDate_(new Date(persona.Fecha_Registro)) : ''
    },
    transacciones
  };
}

/**
 * Crea una nueva persona. Verifica duplicado por documento.
 * @param {{nombre:string, documento:string, celular:string, correo:string, sede:string}} datos
 * @returns {{ok:boolean, persona:{id:string, nombre:string}}}
 */
function crearPersona(token, datos) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  validateRequired_(datos, ['nombre', 'documento', 'sede']);

  const personas = sheetToObjects_('Personas');
  const duplicado = personas.find(p =>
    p.Documento && p.Documento.toString() === datos.documento.toString()
  );
  if (duplicado) {
    // Si ya existe, retornar la persona existente (no duplicar)
    return {
      ok: true,
      yaExistia: true,
      persona: {
        id:       duplicado.ID_Persona,
        nombre:   duplicado.Nombre,
        documento:duplicado.Documento,
        correo:   duplicado.Correo,
        celular:  duplicado.Celular,
        sede:     duplicado.Sede
      }
    };
  }

  const sheet   = getSheet_('Personas', true);
  const id      = generateId_('PER');
  const ahora   = new Date();

  sheet.appendRow([
    id,
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
      id,
      nombre:    datos.nombre.trim(),
      documento: datos.documento,
      correo:    datos.correo   || '',
      celular:   datos.celular  || '',
      sede:      datos.sede
    }
  };
}

/**
 * Actualiza datos de una persona existente.
 * @param {string} id
 * @param {{nombre?:string, celular?:string, correo?:string, sede?:string}} datos
 * @returns {{ok:boolean}}
 */
function actualizarPersona(token, id, datos) {
  authenticate_(token);
  requireRol_('asesor', 'coordinadora');
  const sheet   = getSheet_('Personas');
  const values  = sheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx   = headers.indexOf('ID_Persona');

  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
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
  throw new Error('Persona no encontrada: ' + id);
}

/**
 * Lista todas las personas con paginación simple (coordinadora).
 * @param {{sede?:string, page?:number, pageSize?:number}} filtros
 * @returns {{personas: Object[], total: number}}
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
      (p.Nombre    || '').toString().toLowerCase().includes(q) ||
      (p.Documento || '').toString().toLowerCase().includes(q) ||
      (p.Correo    || '').toString().toLowerCase().includes(q)
    );
  }

  const total    = personas.length;
  const page     = filtros.page     || 1;
  const pageSize = filtros.pageSize || 50;
  const start    = (page - 1) * pageSize;

  return {
    personas: personas.slice(start, start + pageSize).map(p => ({
      id:            p.ID_Persona,
      nombre:        p.Nombre,
      documento:     p.Documento,
      celular:       p.Celular,
      correo:        p.Correo,
      sede:          p.Sede,
      fechaRegistro: p.Fecha_Registro ? formatDate_(new Date(p.Fecha_Registro)) : ''
    })),
    total,
    page,
    pageSize
  };
}
