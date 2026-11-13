import { z } from 'zod';
import { ValorRespuestaSchema, type ValorRespuesta } from './protocolos';

/**
 * Lugares guardados y escenarios de acceso rápido del perfil ciudadano.
 *
 * Un escenario es un botón preparado de antemano para un lugar concreto
 * ("Emergencia médica en casa de mis abuelos", "Ruidos extraños de noche en
 * casa"). Al tocarlo se levanta el reporte con la ubicación exacta guardada,
 * el tipo de incidente y las respuestas que ya se conocen; la despachadora
 * virtual solo pregunta lo que falte.
 */

export const TIPOS_LUGAR = ['casa', 'familiar', 'trabajo', 'escuela', 'otro'] as const;
export type TipoLugar = (typeof TIPOS_LUGAR)[number];

export const VULNERABILIDADES = ['adulto_mayor', 'ninos', 'discapacidad', 'enfermedad_cronica', 'embarazo'] as const;
export type Vulnerabilidad = (typeof VULNERABILIDADES)[number];

export const ETIQUETAS_VULNERABILIDAD: Record<Vulnerabilidad, string> = {
  adulto_mayor: 'Adultos mayores',
  ninos: 'Niñas o niños',
  discapacidad: 'Persona con discapacidad',
  enfermedad_cronica: 'Enfermedad crónica',
  embarazo: 'Embarazo',
};

const Id = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const LugarGuardadoSchema = z.object({
  id: Id,
  nombre: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_LUGAR),
  ubicacion: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Calle, número, entre calles, color de fachada. */
    referencia: z.string().max(280).optional(),
  }),
  /** Quiénes viven ahí y requieren atención especial; ayuda a sugerir escenarios. */
  vulnerables: z.array(z.enum(VULNERABILIDADES)).default([]),
  /** Padecimientos o datos médicos que la persona decide compartir (opcional, dato sensible). */
  infoMedica: z.string().max(280).optional(),
});
export type LugarGuardado = z.infer<typeof LugarGuardadoSchema>;

export const EscenarioSchema = z.object({
  id: Id,
  lugarId: Id,
  titulo: z.string().trim().min(1).max(60),
  incidenteId: z.string().min(1),
  /** Respuestas del protocolo que ya se conocen (preguntaId -> valor). */
  respuestasPrevias: z.record(z.string(), ValorRespuestaSchema).default({}),
  descripcion: z.string().max(280).optional(),
});
export type Escenario = z.infer<typeof EscenarioSchema>;

export const MAX_LUGARES = 10;
export const MAX_ESCENARIOS = 30;

export const PerfilSchema = z
  .object({
    lugares: z.array(LugarGuardadoSchema).max(MAX_LUGARES),
    escenarios: z.array(EscenarioSchema).max(MAX_ESCENARIOS),
  })
  .superRefine((p, ctx) => {
    const lugares = new Set<string>();
    for (const l of p.lugares) {
      if (lugares.has(l.id)) ctx.addIssue({ code: 'custom', message: `Lugar repetido: ${l.id}` });
      lugares.add(l.id);
    }
    const escenarios = new Set<string>();
    for (const e of p.escenarios) {
      if (escenarios.has(e.id)) ctx.addIssue({ code: 'custom', message: `Escenario repetido: ${e.id}` });
      escenarios.add(e.id);
      if (!lugares.has(e.lugarId)) ctx.addIssue({ code: 'custom', message: `El escenario ${e.id} apunta a un lugar que no existe: ${e.lugarId}` });
    }
  });
export type Perfil = z.infer<typeof PerfilSchema>;

export const PERFIL_VACIO: Perfil = { lugares: [], escenarios: [] };

type Plantilla = Omit<Escenario, 'id' | 'lugarId'> & { clave: string };

/**
 * Escenarios sugeridos para un lugar según su tipo y quién vive ahí.
 * La persona elige cuáles conservar y puede editarlos.
 */
export function sugerirEscenarios(lugar: LugarGuardado): Escenario[] {
  const de = lugar.nombre;
  const otra = { quien_afectado: 'otra_persona' } as Record<string, ValorRespuesta>;
  const medicos: Record<string, ValorRespuesta> = lugar.infoMedica ? { padecimientos: lugar.infoMedica } : {};
  const p: Plantilla[] = [];

  if (lugar.vulnerables.includes('adulto_mayor')) {
    p.push(
      { clave: 'medica-adulto-mayor', titulo: `Emergencia médica en ${de}`, incidenteId: 'emergencia-medica', respuestasPrevias: { ...otra, ...medicos }, descripcion: 'Adulto mayor con emergencia médica.' },
      { clave: 'caida-adulto-mayor', titulo: `Caída en ${de}`, incidenteId: 'emergencia-medica', respuestasPrevias: { ...otra, ...medicos, sintoma: 'caida' }, descripcion: 'Caída de adulto mayor.' },
    );
  } else if (lugar.tipo === 'casa' || lugar.tipo === 'familiar' || lugar.vulnerables.length) {
    p.push({ clave: 'medica', titulo: `Emergencia médica en ${de}`, incidenteId: 'emergencia-medica', respuestasPrevias: medicos });
  }
  if (lugar.tipo === 'casa' || lugar.tipo === 'familiar') {
    p.push(
      { clave: 'ruidos-noche', titulo: 'Ruidos extraños de noche', incidenteId: 'intrusion-domicilio', respuestasPrevias: { dentro_casa: true, quien_afectado: lugar.tipo === 'casa' ? 'yo' : 'otra_persona' }, descripcion: 'Se escuchan ruidos extraños en el domicilio.' },
      { clave: 'gas', titulo: `Olor a gas en ${de}`, incidenteId: 'fuga-gas', respuestasPrevias: {} },
      { clave: 'incendio', titulo: `Incendio en ${de}`, incidenteId: 'incendio', respuestasPrevias: { tipo_incendio: 'casa' } },
    );
  }
  if (lugar.vulnerables.includes('ninos') || lugar.tipo === 'escuela') {
    p.push({ clave: 'sospechoso', titulo: `Persona sospechosa cerca de ${de}`, incidenteId: 'persona-sospechosa', respuestasPrevias: {} });
  }
  if (lugar.tipo === 'trabajo') {
    p.push(
      { clave: 'robo', titulo: `Robo en ${de}`, incidenteId: 'robo-en-curso', respuestasPrevias: {} },
      { clave: 'medica', titulo: `Emergencia médica en ${de}`, incidenteId: 'emergencia-medica', respuestasPrevias: medicos },
    );
  }
  if (!p.length) p.push({ clave: 'otro', titulo: `Emergencia en ${de}`, incidenteId: 'otro', respuestasPrevias: {} });

  return p.map(({ clave, ...e }) => ({ ...e, id: `${lugar.id}-${clave}`.slice(0, 40), lugarId: lugar.id }));
}

/** Referencia que acompaña la ubicación del reporte cuando se usa un lugar guardado. */
export function referenciaDeLugar(lugar: LugarGuardado): string {
  return [`Lugar guardado: ${lugar.nombre}`, lugar.ubicacion.referencia].filter(Boolean).join('. ').slice(0, 280);
}
