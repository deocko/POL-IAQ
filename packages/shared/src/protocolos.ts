import { z } from 'zod';
import type { Corporacion, IncidenteCatalogo, Prioridad } from './catalogo';

/**
 * Protocolos de atención que usa la despachadora 911 virtual.
 *
 * Un protocolo es DATOS, no código: se publica como JSON, se valida con
 * `ProtocoloSchema` y cada versión nueva (por ejemplo cuando el SESNSP publique
 * una actualización del Protocolo Nacional de Atención de Llamadas de
 * Emergencia 9-1-1 o del Catálogo Nacional de Incidentes de Emergencia) se
 * carga sin tocar el código. Cada folio guarda la versión con la que se
 * levantó y el texto exacto de cada pregunta, así que un cambio de versión no
 * altera los folios anteriores.
 *
 * Ver docs/protocolos/README.md para el procedimiento de actualización.
 */

const CORPORACIONES = ['policia_municipal', 'policia_estatal', 'cruz_roja', 'bomberos', 'proteccion_civil'] as const;
const PRIORIDADES = ['alta', 'media', 'baja'] as const;

export const ValorRespuestaSchema = z.union([z.string().max(500), z.number(), z.boolean()]);
export type ValorRespuesta = z.infer<typeof ValorRespuestaSchema>;

/** Respuesta válida para cualquier pregunta cerrada: la persona no lo sabe. */
export const NO_SABE = 'no_sabe';

/** Condición sobre una respuesta ya dada. */
const CondicionSchema = z.object({
  preguntaId: z.string().min(1),
  igualA: ValorRespuestaSchema.optional(),
  mayorQue: z.number().optional(),
});
export type Condicion = z.infer<typeof CondicionSchema>;

/** Qué cambia en la canalización cuando una respuesta cumple la condición. */
const EfectoSchema = z.object({
  cuando: z.object({ igualA: ValorRespuestaSchema.optional(), mayorQue: z.number().optional() }),
  prioridad: z.enum(PRIORIDADES).optional(),
  agregarCorporacion: z.enum(CORPORACIONES).optional(),
  /** Texto corto que verá el operador y la unidad, por ejemplo "Arma de fuego en el lugar". */
  alerta: z.string().max(140).optional(),
});

export const PreguntaProtocoloSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  texto: z.string().min(3).max(300),
  tipo: z.enum(['si_no', 'numero', 'texto', 'opcion']),
  opciones: z.array(z.object({ valor: z.string(), etiqueta: z.string(), sinonimos: z.array(z.string()).default([]) })).optional(),
  obligatoria: z.boolean().default(true),
  /** Solo se pregunta si se cumple esta condición. */
  mostrarSi: CondicionSchema.optional(),
  efectos: z.array(EfectoSchema).default([]),
});
export type PreguntaProtocolo = z.infer<typeof PreguntaProtocoloSchema>;

export const ProtocoloIncidenteSchema = z.object({
  incidenteId: z.string().min(1),
  /** Palabras o frases que la despachadora usa para reconocer este incidente en el relato. */
  palabrasClave: z.array(z.string().min(2)).default([]),
  preguntas: z.array(PreguntaProtocoloSchema).default([]),
  /** Indicaciones que se le dan al ciudadano mientras llega la unidad. */
  recomendaciones: z.array(z.string().max(300)).default([]),
});
export type ProtocoloIncidente = z.infer<typeof ProtocoloIncidenteSchema>;

export const ProtocoloSchema = z
  .object({
    version: z.string().regex(/^[0-9A-Za-z.\-]+$/),
    /** `provisional` mientras el contenido no esté validado contra el documento oficial. */
    estado: z.enum(['provisional', 'vigente', 'retirado']),
    nombre: z.string(),
    /** Documento(s) de origen y su versión. */
    fuentes: z.array(z.object({ titulo: z.string(), version: z.string().optional(), url: z.url().optional() })),
    publicadoEn: z.iso.date(),
    aviso: z.string().optional(),
    apertura: z.object({
      saludo: z.string(),
      preguntaMotivo: z.string(),
      confirmacion: z.string(),
      cierre: z.string(),
    }),
    /** Se hacen en todos los incidentes, antes de las específicas. */
    preguntasGenerales: z.array(PreguntaProtocoloSchema),
    incidentes: z.array(ProtocoloIncidenteSchema),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const q of [...p.preguntasGenerales, ...p.incidentes.flatMap((i) => i.preguntas)]) {
      if (q.tipo === 'opcion' && !q.opciones?.length) ctx.addIssue({ code: 'custom', message: `La pregunta ${q.id} es de opción y no tiene opciones` });
    }
    for (const i of p.incidentes) {
      if (ids.has(i.incidenteId)) ctx.addIssue({ code: 'custom', message: `Incidente repetido: ${i.incidenteId}` });
      ids.add(i.incidenteId);
      const propias = new Set<string>();
      for (const q of [...p.preguntasGenerales, ...i.preguntas]) {
        if (propias.has(q.id)) ctx.addIssue({ code: 'custom', message: `Pregunta repetida en ${i.incidenteId}: ${q.id}` });
        if (q.mostrarSi && !propias.has(q.mostrarSi.preguntaId)) {
          ctx.addIssue({ code: 'custom', message: `${q.id} depende de ${q.mostrarSi.preguntaId}, que no se pregunta antes` });
        }
        propias.add(q.id);
      }
    }
  });
export type Protocolo = z.infer<typeof ProtocoloSchema>;

/** Una respuesta tal como queda guardada en el folio. */
export const EntradaCuestionarioSchema = z.object({
  preguntaId: z.string().min(1),
  respuesta: ValorRespuestaSchema,
  /** Lo que dijo o escribió el ciudadano, antes de interpretarlo. */
  textoOriginal: z.string().max(1000).optional(),
});
export type EntradaCuestionario = z.infer<typeof EntradaCuestionarioSchema>;

export const ViaCuestionarioSchema = z.enum(['texto', 'voz', 'escenario', 'formulario']);
export type ViaCuestionario = z.infer<typeof ViaCuestionarioSchema>;

export const ResponderCuestionarioSchema = z.object({
  via: ViaCuestionarioSchema.default('texto'),
  entradas: z.array(EntradaCuestionarioSchema).min(1).max(40),
});
export type ResponderCuestionario = z.infer<typeof ResponderCuestionarioSchema>;

/** Entrada ya resuelta contra el protocolo: incluye el texto de la pregunta. */
export interface EntradaGuardada {
  preguntaId: string;
  pregunta: string;
  respuesta: ValorRespuesta;
  respuestaTexto: string;
  textoOriginal?: string;
  via: ViaCuestionario;
  en: string;
}

export interface Cuestionario {
  protocoloVersion: string;
  protocoloEstado: Protocolo['estado'];
  entradas: EntradaGuardada[];
}

export interface Canalizacion {
  prioridad: Prioridad;
  /** La primera es la que se despacha; las demás son apoyo. */
  corporaciones: Corporacion[];
  alertas: string[];
}

// ---------------------------------------------------------------------------
// Motor del cuestionario
// ---------------------------------------------------------------------------

export function protocoloDe(protocolo: Protocolo, incidenteId: string): ProtocoloIncidente | undefined {
  return protocolo.incidentes.find((i) => i.incidenteId === incidenteId);
}

/** Preguntas en el orden en que se hacen: generales y luego las del incidente. */
export function preguntasPara(protocolo: Protocolo, incidenteId: string): PreguntaProtocolo[] {
  return [...protocolo.preguntasGenerales, ...(protocoloDe(protocolo, incidenteId)?.preguntas ?? [])];
}

function cumple(c: { igualA?: ValorRespuesta; mayorQue?: number }, valor: ValorRespuesta | undefined): boolean {
  if (valor === undefined) return false;
  if (c.igualA !== undefined && valor !== c.igualA) return false;
  if (c.mayorQue !== undefined && !(typeof valor === 'number' && valor > c.mayorQue)) return false;
  return true;
}

export function aplica(q: PreguntaProtocolo, respuestas: Record<string, ValorRespuesta>): boolean {
  return !q.mostrarSi || cumple(q.mostrarSi, respuestas[q.mostrarSi.preguntaId]);
}

/** Preguntas que aún faltan por contestar, según lo ya respondido. */
export function preguntasPendientes(protocolo: Protocolo, incidenteId: string, respuestas: Record<string, ValorRespuesta>): PreguntaProtocolo[] {
  return preguntasPara(protocolo, incidenteId).filter((q) => aplica(q, respuestas) && respuestas[q.id] === undefined);
}

export function siguientePregunta(protocolo: Protocolo, incidenteId: string, respuestas: Record<string, ValorRespuesta>): PreguntaProtocolo | undefined {
  return preguntasPendientes(protocolo, incidenteId, respuestas)[0];
}

/** Quita acentos y signos para comparar lo que dijo la persona. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Propone incidentes a partir del relato libre ("mi abuelo se desmayó"),
 * ordenados por coincidencias. La despachadora siempre pide confirmación.
 */
export function clasificarRelato(protocolo: Protocolo, relato: string): { incidenteId: string; puntos: number }[] {
  const t = ` ${normalizar(relato)} `;
  return protocolo.incidentes
    .map((i) => ({ incidenteId: i.incidenteId, puntos: i.palabrasClave.reduce((n, p) => n + (t.includes(` ${normalizar(p)}`) ? normalizar(p).split(' ').length : 0), 0) }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos);
}

const NUMEROS: Record<string, number> = {
  cero: 0, ninguno: 0, ninguna: 0, nadie: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, varios: 3, varias: 3, muchos: 5, muchas: 5,
};
const SI = ['si', 'sí', 'claro', 'afirmativo', 'correcto', 'asi es', 'exacto', 'aja', 'por supuesto', 'yes'];
const NO = ['no', 'negativo', 'para nada', 'ninguno', 'ninguna', 'nadie', 'nada'];

/**
 * Convierte lo que dijo o escribió el ciudadano al tipo de la pregunta.
 * Devuelve `undefined` si no se entendió, para que la despachadora repita.
 */
export function interpretarRespuesta(q: PreguntaProtocolo, dicho: string): ValorRespuesta | undefined {
  const t = normalizar(dicho);
  if (!t) return undefined;
  const palabras = t.split(' ');
  if (q.tipo !== 'texto' && /^(no se|no lo se|no sabria|no estoy segur[oa]|ni idea|desconozco)\b/.test(t)) return NO_SABE;
  switch (q.tipo) {
    case 'si_no': {
      const empieza = (lista: string[]) => lista.map(normalizar).some((x) => t === x || t.startsWith(`${x} `));
      if (empieza(NO)) return false;
      if (empieza(SI)) return true;
      return undefined;
    }
    case 'numero': {
      const cifra = /\d+/.exec(t);
      if (cifra) return Number(cifra[0]);
      for (const w of palabras) if (w in NUMEROS) return NUMEROS[w];
      return undefined;
    }
    case 'opcion': {
      for (const o of q.opciones ?? []) {
        const formas = [o.valor, o.etiqueta, ...o.sinonimos].map(normalizar);
        if (formas.some((f) => f && (t === f || ` ${t} `.includes(` ${f} `)))) return o.valor;
      }
      return undefined;
    }
    case 'texto':
      return dicho.trim().slice(0, 500);
  }
}

/** Texto legible de una respuesta, para la transcripción. */
export function respuestaComoTexto(q: Pick<PreguntaProtocolo, 'tipo' | 'opciones'>, v: ValorRespuesta): string {
  if (v === NO_SABE && q.tipo !== 'texto') return 'No sabe';
  if (q.tipo === 'si_no') return v === true ? 'Sí' : v === false ? 'No' : String(v);
  if (q.tipo === 'opcion') return q.opciones?.find((o) => o.valor === v)?.etiqueta ?? String(v);
  return String(v);
}

const ORDEN_PRIORIDAD: Record<Prioridad, number> = { baja: 0, media: 1, alta: 2 };

/**
 * Decide prioridad y corporaciones con las respuestas: es la "canalización"
 * que viaja al CAD para despachar la unidad adecuada.
 */
export function canalizar(
  protocolo: Protocolo,
  incidente: Pick<IncidenteCatalogo, 'id' | 'prioridad' | 'corporacionSugerida'>,
  respuestas: Record<string, ValorRespuesta>,
  opciones: { asistenciaDirecta?: boolean } = {},
): Canalizacion {
  let prioridad: Prioridad = opciones.asistenciaDirecta ? 'alta' : incidente.prioridad;
  const corporaciones: Corporacion[] = [incidente.corporacionSugerida];
  const alertas: string[] = [];
  for (const q of preguntasPara(protocolo, incidente.id)) {
    if (!aplica(q, respuestas)) continue;
    for (const ef of q.efectos) {
      if (!cumple(ef.cuando, respuestas[q.id])) continue;
      if (ef.prioridad && ORDEN_PRIORIDAD[ef.prioridad] > ORDEN_PRIORIDAD[prioridad]) prioridad = ef.prioridad;
      if (ef.agregarCorporacion && !corporaciones.includes(ef.agregarCorporacion)) corporaciones.push(ef.agregarCorporacion);
      if (ef.alerta && !alertas.includes(ef.alerta)) alertas.push(ef.alerta);
    }
  }
  return { prioridad, corporaciones, alertas };
}

/**
 * Resuelve las entradas que manda la app contra el protocolo: descarta
 * preguntas que no existen y guarda el texto exacto de cada pregunta.
 */
export function resolverEntradas(
  protocolo: Protocolo,
  incidenteId: string,
  entradas: EntradaCuestionario[],
  via: ViaCuestionario,
  en = new Date().toISOString(),
): { validas: EntradaGuardada[]; desconocidas: string[] } {
  const preguntas = new Map(preguntasPara(protocolo, incidenteId).map((q) => [q.id, q]));
  const validas: EntradaGuardada[] = [];
  const desconocidas: string[] = [];
  for (const e of entradas) {
    const q = preguntas.get(e.preguntaId);
    const tipoOk =
      q !== undefined &&
      ((e.respuesta === NO_SABE && q.tipo !== 'texto') ||
        (q.tipo === 'si_no' ? typeof e.respuesta === 'boolean' : q.tipo === 'numero' ? typeof e.respuesta === 'number' : typeof e.respuesta === 'string'));
    const opcionOk = q?.tipo !== 'opcion' || e.respuesta === NO_SABE || q.opciones?.some((o) => o.valor === e.respuesta);
    if (!q || !tipoOk || !opcionOk) {
      desconocidas.push(e.preguntaId);
      continue;
    }
    validas.push({ preguntaId: q.id, pregunta: q.texto, respuesta: e.respuesta, respuestaTexto: respuestaComoTexto(q, e.respuesta), textoOriginal: e.textoOriginal, via, en });
  }
  return { validas, desconocidas };
}

/** Respuestas vigentes (la última gana) a partir de las entradas guardadas. */
export function respuestasDe(entradas: Pick<EntradaGuardada, 'preguntaId' | 'respuesta'>[]): Record<string, ValorRespuesta> {
  const r: Record<string, ValorRespuesta> = {};
  for (const e of entradas) r[e.preguntaId] = e.respuesta;
  return r;
}

/** Transcripción en texto plano del cuestionario, para el operador, la unidad y el expediente. */
export function transcripcion(c: Cuestionario): string {
  const cabecera = `Cuestionario protocolo ${c.protocoloVersion}${c.protocoloEstado === 'provisional' ? ' (PROVISIONAL)' : ''}`;
  return [cabecera, ...c.entradas.map((e) => `P: ${e.pregunta}\nR: ${e.respuestaTexto}${e.textoOriginal && e.textoOriginal !== e.respuestaTexto ? ` ("${e.textoOriginal}")` : ''} [${e.via}]`)].join('\n');
}
