import { describe, expect, it } from 'vitest';
import {
  CATALOGO_SEMILLA, NO_SABE, PROTOCOLO_PROVISIONAL as P, PerfilSchema, ProtocoloSchema, canalizar, clasificarRelato, incidentePorId,
  interpretarRespuesta, preguntasPara, preguntasPendientes, preguntasDespachadora, preguntasHechas, esVital, MAX_PREGUNTAS_DESPACHADORA, resolverEntradas, siguientePregunta, sugerirEscenarios, transcripcion,
} from './index';

const q = (incidenteId: string, id: string) => preguntasPara(P, incidenteId).find((x) => x.id === id)!;

describe('protocolo provisional', () => {
  it('está marcado como provisional y cubre todo el catálogo', () => {
    expect(P.estado).toBe('provisional');
    for (const i of CATALOGO_SEMILLA) expect(P.incidentes.some((x) => x.incidenteId === i.id), i.id).toBe(true);
  });

  it('rechaza un protocolo con dependencias rotas', () => {
    const roto = structuredClone(P);
    roto.incidentes[0].preguntas.unshift({ id: 'x', texto: 'Pregunta x', tipo: 'si_no', obligatoria: true, efectos: [], mostrarSi: { preguntaId: 'no_existe', igualA: true } });
    expect(ProtocoloSchema.safeParse(roto).success).toBe(false);
  });
});

describe('despachadora virtual', () => {
  it('clasifica el relato libre', () => {
    expect(clasificarRelato(P, 'Mi abuelo se desmayó y no responde')[0].incidenteId).toBe('emergencia-medica');
    expect(clasificarRelato(P, 'escucho ruidos extraños en la azotea de mi casa')[0].incidenteId).toBe('intrusion-domicilio');
    expect(clasificarRelato(P, 'huele a gas en la cocina')[0].incidenteId).toBe('fuga-gas');
    expect(clasificarRelato(P, 'hola')).toEqual([]);
  });

  it('interpreta respuestas habladas', () => {
    expect(interpretarRespuesta(q('emergencia-medica', 'consciente'), 'Sí, sí responde')).toBe(true);
    expect(interpretarRespuesta(q('emergencia-medica', 'consciente'), 'no')).toBe(false);
    expect(interpretarRespuesta(q('emergencia-medica', 'consciente'), 'no sé')).toBe(NO_SABE);
    expect(interpretarRespuesta(q('emergencia-medica', 'edad'), 'tiene como 78 años')).toBe(78);
    expect(interpretarRespuesta(q('robo-en-curso', 'personas'), 'eran dos')).toBe(2);
    expect(interpretarRespuesta(q('emergencia-medica', 'sintoma'), 'le duele el pecho')).toBe('dolor_pecho');
    expect(interpretarRespuesta(q('emergencia-medica', 'consciente'), 'mmm')).toBeUndefined();
  });

  it('respeta las preguntas condicionales', () => {
    expect(siguientePregunta(P, 'intrusion-domicilio', {})!.id).toBe('lugar_seguro');
    const pend = (r: Record<string, boolean>) => preguntasPendientes(P, 'intrusion-domicilio', r).map((x) => x.id);
    expect(pend({ dentro_casa: false })).not.toContain('resguardo');
    expect(pend({ dentro_casa: true })).toContain('resguardo');
  });

  it('canaliza con las respuestas: prioridad, apoyo y alertas', () => {
    const acc = incidentePorId('accidente-vial')!;
    const c = canalizar(P, acc, { heridos: true, atrapados: true, vehiculos: 2 });
    expect(c.prioridad).toBe('alta');
    expect(c.corporaciones).toEqual(['cruz_roja', 'bomberos', 'policia_municipal']);
    expect(c.alertas).toContain('Personas prensadas');

    const ruido = incidentePorId('ruido-rina')!;
    expect(canalizar(P, ruido, {}).prioridad).toBe('baja');
    expect(canalizar(P, ruido, {}, { asistenciaDirecta: true }).prioridad).toBe('alta');
  });

  it('guarda el texto de la pregunta y descarta respuestas inválidas', () => {
    const { validas, desconocidas } = resolverEntradas(P, 'emergencia-medica', [
      { preguntaId: 'consciente', respuesta: false, textoOriginal: 'no responde' },
      { preguntaId: 'respira', respuesta: NO_SABE },
      { preguntaId: 'sintoma', respuesta: 'inventado' },
      { preguntaId: 'no_existe', respuesta: true },
    ], 'voz');
    expect(validas.map((v) => v.preguntaId)).toEqual(['consciente', 'respira']);
    expect(desconocidas).toEqual(['sintoma', 'no_existe']);
    const texto = transcripcion({ protocoloVersion: P.version, protocoloEstado: P.estado, entradas: validas });
    expect(texto).toContain('PROVISIONAL');
    expect(texto).toContain('R: No ("no responde") [voz]');
    expect(texto).toContain('R: No sabe');
  });
});

describe('escenarios por lugar guardado', () => {
  const abuelos = { id: 'abuelos', nombre: 'casa de mis abuelos', tipo: 'familiar' as const, ubicacion: { lat: 20.59, lng: -100.39 }, vulnerables: ['adulto_mayor' as const], infoMedica: 'Abuelo diabético' };

  it('sugiere emergencias médicas con respuestas previas para adultos mayores', () => {
    const s = sugerirEscenarios(abuelos);
    const medica = s.find((e) => e.id === 'abuelos-medica-adulto-mayor')!;
    expect(medica.incidenteId).toBe('emergencia-medica');
    expect(medica.respuestasPrevias).toMatchObject({ quien_afectado: 'otra_persona', padecimientos: 'Abuelo diabético' });
    expect(s.some((e) => e.incidenteId === 'intrusion-domicilio')).toBe(true);
    // Toda respuesta previa debe existir en el protocolo vigente.
    for (const e of s) {
      const { desconocidas } = resolverEntradas(P, e.incidenteId, Object.entries(e.respuestasPrevias).map(([preguntaId, respuesta]) => ({ preguntaId, respuesta })), 'escenario');
      expect(desconocidas, e.id).toEqual([]);
    }
  });

  it('valida que cada escenario apunte a un lugar existente', () => {
    const lugar = { ...abuelos, vulnerables: ['adulto_mayor'] };
    expect(PerfilSchema.safeParse({ lugares: [lugar], escenarios: sugerirEscenarios(abuelos) }).success).toBe(true);
    expect(PerfilSchema.safeParse({ lugares: [], escenarios: sugerirEscenarios(abuelos) }).success).toBe(false);
  });
});

describe('protocolo publicado en docs/protocolos', () => {
  it('el JSON coincide con la semilla del código y es válido', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const json = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'protocolos', `${P.version}.json`), 'utf8'));
    expect(ProtocoloSchema.parse(json)).toEqual(P);
  });
});

describe('llamada corta con la despachadora virtual', () => {
  const ids = (incidenteId: string, r: Record<string, unknown>, op?: { accesoRapido?: boolean; yaHechas?: number }) =>
    preguntasDespachadora(P, incidenteId, r as Record<string, string>, op).map((q) => q.id);

  it('entiende "sí" con o sin acento y otras formas de afirmar', () => {
    const q = preguntasPara(P, 'otro').find((x) => x.id === 'lugar_seguro')!;
    for (const dicho of ['Sí', 'si', 'SI', 'sí.', 'sip', 'si estoy bien', 'estoy bien', 'ok']) expect(interpretarRespuesta(q, dicho), dicho).toBe(true);
    expect(interpretarRespuesta(q, 'algo asi')).toBeUndefined();
  });

  it('en un tema nuevo hace solo las obligatorias, primero las vitales del incidente y con tope', () => {
    const lista = ids('emergencia-medica', {});
    expect(lista).toEqual(['consciente', 'respira', 'sintoma', 'lugar_seguro']);
    expect(lista).not.toContain('quien_afectado');
    expect(lista).not.toContain('edad');
    expect(ids('robo-en-curso', {}).length).toBe(MAX_PREGUNTAS_DESPACHADORA.temaNuevo);
    expect(ids('robo-en-curso', {}, { yaHechas: 3 })).toHaveLength(1);
    expect(ids('robo-en-curso', {}, { yaHechas: 4 })).toEqual([]);
  });

  it('desde un acceso rápido no repite lo prellenado y solo pregunta lo vital', () => {
    for (const lugar of [
      { id: 'abuelos', nombre: 'casa de mis abuelos', tipo: 'familiar' as const, ubicacion: { lat: 20.59, lng: -100.39 }, vulnerables: ['adulto_mayor' as const] },
      { id: 'casa', nombre: 'Mi casa', tipo: 'casa' as const, ubicacion: { lat: 20.59, lng: -100.39 }, vulnerables: [] },
    ]) {
      for (const e of sugerirEscenarios(lugar)) {
        const lista = preguntasDespachadora(P, e.incidenteId, e.respuestasPrevias, { accesoRapido: true });
        expect(lista.length, e.id).toBeLessThanOrEqual(MAX_PREGUNTAS_DESPACHADORA.accesoRapido);
        for (const q of lista) {
          expect(Object.keys(e.respuestasPrevias), e.id).not.toContain(q.id);
          expect(esVital(q), `${e.id}:${q.id}`).toBe(true);
        }
      }
    }
    const caida = sugerirEscenarios({ id: 'a', nombre: 'abuelos', tipo: 'familiar', ubicacion: { lat: 20.59, lng: -100.39 }, vulnerables: ['adulto_mayor'] }).find((e) => e.id === 'a-caida-adulto-mayor')!;
    expect(ids('emergencia-medica', caida.respuestasPrevias, { accesoRapido: true })).toEqual(['consciente', 'respira']);
  });

  it('cuenta solo lo que contestó la persona', () => {
    expect(preguntasHechas([{ via: 'escenario' }, { via: 'voz' }, { via: 'texto' }, { via: 'formulario' }])).toBe(2);
  });
});
