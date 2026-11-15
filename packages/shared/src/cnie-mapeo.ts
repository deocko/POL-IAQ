/**
 * Cómo se llega del incidente que elige el ciudadano al código CNIE.
 *
 * Cada opción del catálogo tiene un subtipo y, cuando se puede, un incidente
 * fijo (ver catalogo.ts). Cuando la opción abarca varios incidentes del CNIE,
 * el código se afina con UNA pregunta en lenguaje simple (marcada con
 * `afinaCnie` en el protocolo) y con respuestas que ya se hacían (heridos,
 * armas). Si falta la respuesta, el incidente queda en `null` y lo asigna el
 * operador; nunca se adivina.
 *
 * Todos los códigos de este archivo están en el CNIE V 3.0 (lo comprueba
 * cnie.test.ts) y el mapeo de cada opción está en docs/cnie/README.md.
 */
import { clasificacionDe, clasificacionDeSubtipo, validarCodigoCnie, type ClasificacionCnie } from './cnie';
import { incidentePorId } from './catalogo';
import { NO_SABE, type ValorRespuesta } from './protocolos';

type Respuestas = Record<string, ValorRespuesta | unknown>;
/** Código principal y, si aplica, secundario. `null` = falta afinar. */
type Resultado = { codigo: string | null; secundario?: string | null };

/**
 * Con violencia salvo que conste lo contrario: sin armas y sin heridos.
 * Ante la duda se registra con violencia, que es la variante de prioridad ALTA.
 */
const sinViolencia = (r: Respuestas) => r.armas === false && r.heridos !== true;
const porViolencia = (r: Respuestas, con: string, sin: string) => (sinViolencia(r) ? sin : con);

const ROBO: Record<string, [string, string] | string> = {
  persona: ['30421', '30422'], // robo a transeúnte con / sin violencia
  negocio: ['30419', '30420'], // robo a negocio
  casa: ['30413', '30414'], // robo a casa habitación
  vehiculo: ['30429', '30430'], // robo de vehículo particular
  dentro_auto: '30403', // cristalazo o robo al interior de vehículo
  otro: '30446', // otros actos relacionados con el patrimonio
};
const ACCIDENTE: Record<string, string> = {
  auto: '10104', // vehículo automotor con persona(s) lesionada(s)
  moto: '10103', // motocicleta con persona(s) lesionada(s)
  atropello: '10116', // atropellamiento con persona(s) lesionada(s)
  varios: '10107', // accidente múltiple con persona(s) lesionada(s)
  pasajeros: '10109', // transporte de pasajeros con persona(s) lesionada(s)
};
const SINTOMA: Record<string, string> = {
  dolor_pecho: '10314', // infarto / urgencia cardiológica
  dificultad_respirar: '10305', // dificultad respiratoria
  convulsion: '10307',
  desmayo: '10308', // persona inconsciente (incluye desmayos)
  parto: '10301', // trabajo de parto
  embarazo: '10302', // emergencia obstétrica
  intoxicacion: '10315', // intoxicación / sobredosis / envenenamiento
  caida: '10204', // persona lesionada por caída (subtipo 102)
  sangrado: '10316', // sin código propio en el mapeo: otros incidentes médicos clínicos
  otro: '10316',
};
const LESION: Record<string, string> = {
  caida: '10204',
  fractura: '10206',
  cuchillo: '10208', // arma blanca
  disparo: '10209', // proyectil de arma de fuego
  quemadura: '10211',
  cabeza: '10213', // traumatismo de cráneo
  golpe_objeto: '10222', // objeto contundente
  rina: '10225', // durante alteración del orden público o riña
  otro: '10220', // otros incidentes médicos traumáticos
};
const INCENDIO: Record<string, string> = {
  casa: '20301',
  escuela: '20302',
  vehiculo: '20303',
  comercio: '20304',
  fabrica: '20310',
  pastizal: '20307', // incendio forestal
  otro: '20311',
};

const de = (tabla: Record<string, string>, v: unknown): string | null =>
  typeof v === 'string' && v !== NO_SABE ? tabla[v] ?? null : v === NO_SABE ? tabla.otro ?? null : null;

const REGLAS: Record<string, (r: Respuestas) => Resultado> = {
  'robo-en-curso': (r) => {
    if (r.que_roban === NO_SABE) return { codigo: '30446' };
    const c = typeof r.que_roban === 'string' ? ROBO[r.que_roban] : undefined;
    if (!c) return { codigo: null };
    return { codigo: typeof c === 'string' ? c : porViolencia(r, c[0], c[1]) };
  },
  agresion: (r) => ({ codigo: r.pelea_mutua === true ? '31112' : '30909', secundario: r.heridos === true ? '10225' : null }),
  'intrusion-domicilio': (r) => ({ codigo: r.robo_casa === true ? porViolencia(r, '30413', '30414') : '31001' }),
  'violencia-familiar': (r) => ({ codigo: r.es_pareja === true ? '30502' : '30503' }),
  disparos: (r) => ({ codigo: r.en_escuela === true ? '30206' : '30202' }),
  'persona-sospechosa': (r) => ({ codigo: r.es_vehiculo === true ? '30307' : '30904' }),
  'accidente-vial': (r) => {
    if (r.heridos === false) return { codigo: '30309' }; // accidente de tránsito sin personas lesionadas (tipo 3)
    if (r.heridos !== true) return { codigo: null };
    // Con heridos el incidente queda definido aunque no se sepa el vehículo: 10104 (vehículo automotor
    // con persona(s) lesionada(s)), el caso general; la pregunta del tipo de accidente lo precisa.
    return { codigo: (typeof r.tipo_accidente === 'string' ? ACCIDENTE[r.tipo_accidente] : undefined) ?? '10104' };
  },
  'emergencia-medica': (r) => {
    if (r.consciente === false && r.respira === false) return { codigo: '10313' }; // paro cardiorrespiratorio
    const s = de(SINTOMA, r.sintoma);
    if (s) return { codigo: s };
    return { codigo: r.consciente === false ? '10308' : null };
  },
  'persona-lesionada': (r) => {
    const l = de(LESION, r.tipo_lesion);
    if (l) return { codigo: l };
    return { codigo: r.sangrado === true ? '10207' : null }; // hemorragia
  },
  incendio: (r) => ({ codigo: de(INCENDIO, r.tipo_incendio) }),
  'fuga-gas': () => ({ codigo: '20115' }),
  inundacion: () => ({ codigo: '20207' }),
  'ruido-rina': (r) => ({ codigo: r.tipo_ruido === 'rina' ? '31112' : '50105' }),
  otro: () => ({ codigo: null }),
};

/** Códigos que pueden salir de las reglas (para pruebas y documentación). */
export const CODIGOS_DEL_MAPEO: readonly string[] = [
  ...new Set([
    ...Object.values(ROBO).flat(), ...Object.values(ACCIDENTE), ...Object.values(SINTOMA), ...Object.values(LESION), ...Object.values(INCENDIO),
    '30909', '31112', '10225', '31001', '30413', '30414', '30502', '30503', '30202', '30206', '30904', '30307', '30309', '10313', '10308', '10207', '20115', '20207', '50105',
  ]),
];

/**
 * Clasificación CNIE de un reporte según la opción elegida y las respuestas.
 * `codigoElegido`: código que el ciudadano eligió en el catálogo completo (solo "Otra emergencia").
 * Devuelve `null` si no hay ni subtipo (por ejemplo, "Otra emergencia" sin elegir).
 */
export function clasificarCnie(incidenteId: string, respuestas: Respuestas = {}, codigoElegido?: string | null): ClasificacionCnie | null {
  if (codigoElegido) {
    const v = validarCodigoCnie(codigoElegido);
    if (!v.ok) throw new Error(v.mensaje);
    return clasificacionDe(codigoElegido, 'ciudadano');
  }
  const base = incidentePorId(incidenteId);
  if (!base) return null;
  const { codigo, secundario } = (REGLAS[incidenteId] ?? (() => ({ codigo: base.codigoCnie?.codigo ?? null })))(respuestas);
  if (codigo) return clasificacionDe(codigo, codigo === base.codigoCnie?.codigo ? 'catalogo' : 'respuestas', secundario);
  return base.codigoCnieSubtipo ? clasificacionDeSubtipo(base.codigoCnieSubtipo.codigo, 'catalogo', secundario) : null;
}
