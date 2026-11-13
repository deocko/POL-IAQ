import { describe, expect, it } from 'vitest';
import {
  CATALOGO_SEMILLA, NO_SABE, PROTOCOLO_PROVISIONAL as P, PerfilSchema, ProtocoloSchema, canalizar, clasificarRelato, incidentePorId,
  interpretarRespuesta, preguntasPara, preguntasPendientes, resolverEntradas, siguientePregunta, sugerirEscenarios, transcripcion,
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
