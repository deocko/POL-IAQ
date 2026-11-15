import { ProtocoloSchema, type Protocolo } from './protocolos';

/**
 * PROTOCOLO PROVISIONAL de la despachadora 911 virtual.
 *
 * NO es el texto oficial. Lo redactó el equipo de POL-IAQ siguiendo la
 * estructura general de atención de llamadas de emergencia (motivo, ubicación,
 * seguridad de quien llama, preguntas por tipo de incidente, indicaciones
 * previas al arribo). Antes del piloto debe sustituirse, pregunta por pregunta,
 * por el contenido vigente del Protocolo Nacional de Atención de Llamadas de
 * Emergencia 9-1-1 y del Catálogo Nacional de Incidentes de Emergencia
 * (SESNSP / Centro Nacional de Información), validado con el C5 de Querétaro.
 *
 * Para publicar una versión nueva no se edita este archivo: se genera un JSON
 * con la misma forma y se carga con PROTOCOLO_ARCHIVO (ver docs/protocolos).
 */
const SI = { igualA: true } as const;
const NO = { igualA: false } as const;

const HERIDOS = {
  id: 'heridos', texto: '¿Hay heridos?', tipo: 'si_no',
  efectos: [{ cuando: SI, prioridad: 'alta', agregarCorporacion: 'cruz_roja', alerta: 'Hay personas heridas' }],
} as const;
const NUM_HERIDOS = { id: 'num_heridos', texto: '¿Cuántos heridos hay?', tipo: 'numero', mostrarSi: { preguntaId: 'heridos', igualA: true } } as const;
const ARMAS = {
  id: 'armas', texto: '¿Vio algún arma?', tipo: 'si_no',
  efectos: [{ cuando: SI, prioridad: 'alta', alerta: 'Posible persona armada' }],
} as const;
const PERSONAS = { id: 'personas', texto: '¿Cuántas personas son?', tipo: 'numero' } as const;
const CONSCIENTE = {
  id: 'consciente', texto: '¿La persona le responde si le habla?', tipo: 'si_no',
  efectos: [{ cuando: NO, prioridad: 'alta', alerta: 'Persona inconsciente' }],
} as const;
const RESPIRA = {
  id: 'respira', texto: '¿Respira bien?', tipo: 'si_no',
  efectos: [{ cuando: NO, prioridad: 'alta', alerta: 'No respira con normalidad' }],
} as const;
const EDAD = {
  id: 'edad', texto: '¿Qué edad tiene, más o menos?', tipo: 'numero', obligatoria: false,
  efectos: [{ cuando: { mayorQue: 64 }, alerta: 'Adulto mayor' }],
} as const;

const DATOS = {
  version: '2026.11-provisional.3',
  estado: 'provisional',
  nombre: 'Protocolo de atención POL-IAQ (provisional, no oficial)',
  fuentes: [
    { titulo: 'Protocolo Nacional de Atención de Llamadas de Emergencia 9-1-1 (SESNSP / CNI)', version: 'pendiente de confirmar' },
    { titulo: 'Catálogo Nacional de Incidentes de Emergencia (SESNSP / CNI)', version: 'V 3.0, junio 2024' },
    { titulo: 'Norma Técnica para la Estandarización de los Servicios de Llamadas de Emergencia (NT CALLE)', url: 'https://www.gob.mx/cms/uploads/attachment/file/895276/NT_CALLE_2023_II-2024_final.pdf' },
  ],
  publicadoEn: '2026-11-15',
  aviso: 'Contenido provisional redactado por POL-IAQ. No sustituye al protocolo oficial ni a una llamada al 9-1-1.',
  apertura: {
    saludo: '9-1-1 virtual de POL-IAQ. Le atiende la despachadora virtual. Su ubicación ya se está compartiendo.',
    preguntaMotivo: '¿Cuál es su emergencia?',
    confirmacion: '¿Se trata de: {incidente}?',
    cierre: 'Su folio es {folio}. La unidad ya fue canalizada; puede seguirla en el mapa. No cuelgue la app y manténgase en un lugar seguro.',
  },
  preguntasGenerales: [
    {
      id: 'lugar_seguro', texto: '¿Está usted a salvo ahora?', tipo: 'si_no',
      efectos: [{ cuando: NO, prioridad: 'alta', alerta: 'Quien reporta no está en un lugar seguro' }],
    },
    {
      id: 'quien_afectado', texto: '¿A quién le pasa?', tipo: 'opcion', obligatoria: false,
      opciones: [
        { valor: 'yo', etiqueta: 'A mí', sinonimos: ['a mi', 'yo', 'soy yo', 'me pasa a mi'] },
        { valor: 'otra_persona', etiqueta: 'A otra persona', sinonimos: ['otra persona', 'a mi familiar', 'a un familiar', 'a mi abuelo', 'a mi abuela', 'a mi hijo', 'a mi hija', 'a mi mama', 'a mi papa'] },
        { valor: 'testigo', etiqueta: 'Soy testigo', sinonimos: ['testigo', 'lo estoy viendo', 'lo vi'] },
      ],
    },
  ],
  incidentes: [
    {
      incidenteId: 'emergencia-medica',
      palabrasClave: ['desmayo', 'desmayó', 'se desmayo', 'infarto', 'dolor de pecho', 'no respira', 'convulsion', 'convulsiona', 'se cayo', 'caida', 'diabetico', 'diabetes', 'presion', 'embolia', 'enfermo', 'enferma', 'malestar', 'abuelo', 'abuela', 'ambulancia', 'emergencia medica', 'se puso mal', 'se siente mal'],
      preguntas: [
        CONSCIENTE,
        RESPIRA,
        {
          id: 'sintoma', texto: '¿Qué le pasa?', tipo: 'opcion',
          opciones: [
            { valor: 'dolor_pecho', etiqueta: 'Dolor de pecho', sinonimos: ['pecho', 'infarto', 'corazon'] },
            { valor: 'dificultad_respirar', etiqueta: 'Le cuesta respirar', sinonimos: ['no puede respirar', 'se ahoga', 'asma', 'respirar'] },
            { valor: 'caida', etiqueta: 'Se cayó', sinonimos: ['cayo', 'caida', 'se cayo', 'golpe'] },
            { valor: 'convulsion', etiqueta: 'Convulsiones', sinonimos: ['convulsiona', 'convulsion', 'ataque'] },
            { valor: 'desmayo', etiqueta: 'Desmayo', sinonimos: ['desmayo', 'se desmayo', 'perdio el conocimiento'] },
            { valor: 'sangrado', etiqueta: 'Sangrado', sinonimos: ['sangre', 'sangra', 'sangrado'] },
            { valor: 'parto', etiqueta: 'Va a dar a luz', sinonimos: ['parto', 'dar a luz', 'se le rompio la fuente', 'contracciones'] },
            { valor: 'embarazo', etiqueta: 'Problema en el embarazo', sinonimos: ['embarazada', 'embarazo'] },
            { valor: 'intoxicacion', etiqueta: 'Se intoxicó o tomó algo', sinonimos: ['intoxicado', 'intoxicada', 'sobredosis', 'envenenado', 'tomo pastillas', 'se tomo algo'] },
            { valor: 'otro', etiqueta: 'Otro', sinonimos: ['otro', 'otra cosa'] },
          ],
          afinaCnie: true,
          efectos: [
            { cuando: { igualA: 'dolor_pecho' }, prioridad: 'alta', alerta: 'Posible evento cardiaco' },
            { cuando: { igualA: 'dificultad_respirar' }, prioridad: 'alta', alerta: 'Dificultad para respirar' },
            { cuando: { igualA: 'convulsion' }, prioridad: 'alta', alerta: 'Convulsiones' },
          ],
        },
        EDAD,
        { id: 'padecimientos', texto: '¿Tiene alguna enfermedad, como diabetes o presión alta?', tipo: 'texto', obligatoria: false },
      ],
      recomendaciones: [
        'No le dé de comer ni de beber.',
        'Si no respira y sabe hacerlo, presione fuerte y rápido en el centro del pecho hasta que llegue la ambulancia.',
        'Abra la puerta y encienda una luz para que la unidad ubique el domicilio.',
        'Tenga a la mano sus medicamentos y una identificación.',
      ],
    },
    {
      incidenteId: 'intrusion-domicilio',
      palabrasClave: ['ruidos', 'ruido extraño', 'ruidos extraños', 'se metieron', 'alguien entro', 'intruso', 'forzando', 'forzaron', 'en mi casa', 'escucho', 'escuche', 'brincaron', 'se brinco', 'ladrones en mi casa'],
      preguntas: [
        {
          id: 'intruso_visto', texto: '¿Ha visto a alguien?', tipo: 'si_no',
          efectos: [{ cuando: SI, prioridad: 'alta', alerta: 'Persona ajena vista en el domicilio' }],
        },
        {
          id: 'origen_ruido', texto: '¿Dónde se oyen los ruidos?', tipo: 'opcion',
          opciones: [
            { valor: 'puerta', etiqueta: 'Puerta', sinonimos: ['puerta', 'entrada', 'cochera', 'porton'] },
            { valor: 'ventana', etiqueta: 'Ventana', sinonimos: ['ventana', 'vidrio'] },
            { valor: 'azotea', etiqueta: 'Azotea', sinonimos: ['azotea', 'techo', 'arriba'] },
            { valor: 'patio', etiqueta: 'Patio', sinonimos: ['patio', 'jardin', 'atras'] },
            { valor: 'dentro', etiqueta: 'Dentro de la casa', sinonimos: ['dentro', 'adentro', 'cocina', 'sala', 'abajo'] },
          ],
          efectos: [{ cuando: { igualA: 'dentro' }, prioridad: 'alta', alerta: 'Ruidos dentro del domicilio' }],
        },
        { id: 'dentro_casa', texto: '¿Está usted dentro de la casa?', tipo: 'si_no' },
        { id: 'resguardo', texto: '¿Puede encerrarse en un cuarto con seguro?', tipo: 'si_no', mostrarSi: { preguntaId: 'dentro_casa', igualA: true } },
        ARMAS,
        { id: 'robo_casa', texto: '¿Se están llevando cosas de la casa?', tipo: 'si_no', afinaCnie: true },
      ],
      recomendaciones: [
        'No confronte a nadie. Enciérrese con su familia en una habitación con seguro.',
        'Ponga el teléfono en silencio y manténgalo con usted.',
        'No salga hasta que la unidad se identifique; le avisaremos en la app.',
      ],
    },
    {
      incidenteId: 'robo-en-curso',
      palabrasClave: ['robo', 'robando', 'asalto', 'asaltando', 'me asaltaron', 'me robaron', 'ladron', 'ladrones', 'atraco'],
      preguntas: [
        ARMAS, HERIDOS, NUM_HERIDOS, PERSONAS,
        {
          id: 'que_roban', texto: '¿Qué están robando?', tipo: 'opcion', afinaCnie: true,
          opciones: [
            { valor: 'persona', etiqueta: 'A mí o a alguien en la calle', sinonimos: ['a mi', 'en la calle', 'mi celular', 'mi cartera', 'asalto'] },
            { valor: 'negocio', etiqueta: 'Un negocio o tienda', sinonimos: ['negocio', 'tienda', 'local', 'oxxo'] },
            { valor: 'casa', etiqueta: 'Una casa', sinonimos: ['casa', 'mi casa', 'departamento'] },
            { valor: 'vehiculo', etiqueta: 'Un carro o camioneta', sinonimos: ['carro', 'coche', 'auto', 'camioneta', 'mi carro'] },
            { valor: 'dentro_auto', etiqueta: 'Algo de adentro de un carro', sinonimos: ['cristalazo', 'dentro del carro', 'de mi carro'] },
            { valor: 'otro', etiqueta: 'Otra cosa', sinonimos: ['otro', 'otra cosa'] },
          ],
        },
        { id: 'siguen_lugar', texto: '¿Siguen ahí?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', alerta: 'Responsables en el lugar' }] },
        { id: 'huida', texto: '¿Hacia dónde se fueron y en qué (a pie, moto, auto)?', tipo: 'texto', obligatoria: false, mostrarSi: { preguntaId: 'siguen_lugar', igualA: false } },
        { id: 'media_filiacion', texto: 'Describa a los responsables: ropa, complexión, rasgos.', tipo: 'texto', obligatoria: false },
      ],
      recomendaciones: ['No se resista ni persiga a los responsables.', 'No toque objetos que hayan tocado; pueden servir como evidencia.'],
    },
    {
      incidenteId: 'agresion',
      palabrasClave: ['pelea', 'peleando', 'golpes', 'golpeando', 'agresion', 'me pegaron', 'rina', 'navaja', 'apuñalado'],
      preguntas: [
        { id: 'continua', texto: '¿Siguen peleando?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', alerta: 'Agresión en curso' }] },
        ARMAS, HERIDOS, NUM_HERIDOS, PERSONAS,
        { id: 'pelea_mutua', texto: '¿Es una pelea entre varias personas?', tipo: 'si_no', afinaCnie: true },
      ],
      recomendaciones: ['Aléjese del lugar si puede hacerlo sin riesgo.', 'No intervenga físicamente.'],
    },
    {
      incidenteId: 'violencia-familiar',
      palabrasClave: ['violencia familiar', 'mi pareja', 'mi esposo', 'mi esposa', 'mi novio', 'me golpea', 'me pega', 'me amenaza', 'violencia'],
      preguntas: [
        { id: 'agresor_presente', texto: '¿La persona agresora está con usted?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', alerta: 'Persona agresora presente' }] },
        HERIDOS, ARMAS,
        { id: 'menores', texto: '¿Hay niños ahí?', tipo: 'si_no', efectos: [{ cuando: SI, alerta: 'Menores en el lugar' }] },
        { id: 'es_pareja', texto: '¿Quien agrede es pareja o expareja de la víctima?', tipo: 'si_no', afinaCnie: true },
      ],
      recomendaciones: ['Si puede, salga a un lugar seguro o con una vecina o vecino.', 'Si no puede hablar, conteste escribiendo; la app no hace sonidos.'],
    },
    {
      incidenteId: 'disparos',
      palabrasClave: ['disparos', 'balazos', 'balacera', 'tiros', 'detonaciones', 'dispararon'],
      preguntas: [
        { id: 'continuan', texto: '¿Se siguen oyendo disparos?', tipo: 'si_no', efectos: [{ cuando: SI, alerta: 'Disparos en curso' }] },
        HERIDOS, NUM_HERIDOS,
        { id: 'en_escuela', texto: '¿Es en una escuela?', tipo: 'si_no', afinaCnie: true, efectos: [{ cuando: SI, alerta: 'Disparos en una escuela' }] },
        { id: 'direccion', texto: '¿De qué dirección vienen los disparos?', tipo: 'texto', obligatoria: false },
      ],
      recomendaciones: ['Tírese al piso y aléjese de puertas y ventanas.', 'No salga a ver qué pasó.'],
    },
    {
      incidenteId: 'persona-sospechosa',
      palabrasClave: ['sospechoso', 'sospechosa', 'merodeando', 'vigilando', 'carro sospechoso', 'vehiculo sospechoso', 'rondando'],
      preguntas: [
        PERSONAS, ARMAS,
        { id: 'es_vehiculo', texto: '¿Lo sospechoso es un vehículo?', tipo: 'si_no', afinaCnie: true },
        { id: 'vehiculo', texto: 'Si hay un vehículo, ¿de qué color, marca y placas?', tipo: 'texto', obligatoria: false },
        { id: 'media_filiacion', texto: 'Describa a la persona: ropa, complexión, rasgos.', tipo: 'texto', obligatoria: false },
      ],
      recomendaciones: ['No se acerque ni la confronte.', 'Si puede, tome una foto desde un lugar seguro y súbala al folio.'],
    },
    {
      incidenteId: 'accidente-vial',
      palabrasClave: ['choque', 'chocaron', 'accidente', 'atropellado', 'atropellaron', 'volcadura', 'se volco', 'motociclista'],
      preguntas: [
        HERIDOS, NUM_HERIDOS,
        {
          id: 'tipo_accidente', texto: '¿Qué tipo de accidente es?', tipo: 'opcion', afinaCnie: true, mostrarSi: { preguntaId: 'heridos', igualA: true },
          opciones: [
            { valor: 'auto', etiqueta: 'Choque o volcadura de un carro', sinonimos: ['carro', 'auto', 'coche', 'volcadura', 'se volco'] },
            { valor: 'varios', etiqueta: 'Choque entre varios vehículos', sinonimos: ['varios', 'carambola', 'chocaron dos'] },
            { valor: 'moto', etiqueta: 'Accidente de moto', sinonimos: ['moto', 'motocicleta', 'motociclista'] },
            { valor: 'atropello', etiqueta: 'Atropellaron a alguien', sinonimos: ['atropellado', 'atropellaron', 'peaton', 'ciclista'] },
            { valor: 'pasajeros', etiqueta: 'Camión o transporte de pasajeros', sinonimos: ['camion', 'autobus', 'combi', 'transporte publico', 'pasajeros'] },
          ],
        },
        { id: 'atrapados', texto: '¿Hay alguien atrapado en un vehículo?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', agregarCorporacion: 'bomberos', alerta: 'Personas prensadas' }] },
        { id: 'fuego_combustible', texto: '¿Hay fuego o se tira gasolina?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', agregarCorporacion: 'bomberos', alerta: 'Fuego o derrame de combustible' }] },
        { id: 'vehiculos', texto: '¿Cuántos vehículos son?', tipo: 'numero', efectos: [{ cuando: { mayorQue: 0 }, agregarCorporacion: 'policia_municipal' }] },
      ],
      recomendaciones: ['No mueva a las personas lesionadas.', 'Encienda intermitentes y colóquese fuera del arroyo vehicular.'],
    },
    {
      incidenteId: 'persona-lesionada',
      palabrasClave: ['herido', 'herida', 'inconsciente', 'sangrando', 'lesionado', 'lesionada', 'tirado en la calle', 'no se mueve'],
      preguntas: [
        CONSCIENTE, RESPIRA,
        { id: 'sangrado', texto: '¿Sangra mucho?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', alerta: 'Sangrado abundante' }] },
        {
          id: 'tipo_lesion', texto: '¿Cómo se lastimó?', tipo: 'opcion', afinaCnie: true,
          opciones: [
            { valor: 'caida', etiqueta: 'Se cayó', sinonimos: ['cayo', 'caida', 'se cayo'] },
            { valor: 'fractura', etiqueta: 'Se rompió o torció un hueso', sinonimos: ['fractura', 'hueso', 'torcio', 'esguince'] },
            { valor: 'cabeza', etiqueta: 'Golpe en la cabeza', sinonimos: ['cabeza', 'craneo'] },
            { valor: 'golpe_objeto', etiqueta: 'Lo golpearon con algo', sinonimos: ['palo', 'piedra', 'botella', 'tubo'] },
            { valor: 'cuchillo', etiqueta: 'Cuchillo o navaja', sinonimos: ['cuchillo', 'navaja', 'apuñalado', 'arma blanca'] },
            { valor: 'disparo', etiqueta: 'Disparo', sinonimos: ['bala', 'balazo', 'disparo'] },
            { valor: 'quemadura', etiqueta: 'Quemadura', sinonimos: ['quemado', 'quemada', 'quemadura'] },
            { valor: 'rina', etiqueta: 'En una pelea o riña', sinonimos: ['pelea', 'rina', 'golpes'] },
            { valor: 'otro', etiqueta: 'Otra cosa', sinonimos: ['otro', 'otra cosa'] },
          ],
        },
        EDAD,
      ],
      recomendaciones: ['No la mueva salvo que esté en peligro.', 'Si sangra, presione la herida con una tela limpia.'],
    },
    {
      incidenteId: 'incendio',
      palabrasClave: ['incendio', 'fuego', 'se quema', 'quemando', 'humo', 'llamas'],
      preguntas: [
        { id: 'personas_dentro', texto: '¿Hay alguien adentro?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', agregarCorporacion: 'cruz_roja', alerta: 'Personas dentro' }] },
        {
          id: 'tipo_incendio', texto: '¿Qué se está quemando?', tipo: 'opcion',
          opciones: [
            { valor: 'casa', etiqueta: 'Una casa', sinonimos: ['casa', 'departamento', 'vivienda'] },
            { valor: 'comercio', etiqueta: 'Un negocio o tienda', sinonimos: ['negocio', 'tienda', 'local'] },
            { valor: 'fabrica', etiqueta: 'Una fábrica o bodega', sinonimos: ['fabrica', 'bodega', 'industria', 'nave'] },
            { valor: 'escuela', etiqueta: 'Una escuela', sinonimos: ['escuela', 'colegio', 'primaria', 'secundaria'] },
            { valor: 'vehiculo', etiqueta: 'Un vehículo', sinonimos: ['carro', 'auto', 'camion', 'coche'] },
            { valor: 'pastizal', etiqueta: 'Pasto, monte o árboles', sinonimos: ['pasto', 'pastizal', 'monte', 'cerro', 'arboles', 'lote', 'terreno'] },
            { valor: 'otro', etiqueta: 'Otra cosa', sinonimos: ['otro', 'otra cosa', 'basura'] },
          ],
          afinaCnie: true,
        },
        HERIDOS,
      ],
      recomendaciones: ['Salga del lugar y no regrese por objetos.', 'Si hay humo, avance agachado y cubra nariz y boca.'],
    },
    {
      incidenteId: 'fuga-gas',
      palabrasClave: ['gas', 'huele a gas', 'olor a gas', 'fuga', 'tanque estacionario', 'cilindro'],
      preguntas: [
        { id: 'evacuado', texto: '¿Ya salieron todos?', tipo: 'si_no', efectos: [{ cuando: NO, prioridad: 'alta', alerta: 'Personas dentro con fuga de gas' }] },
        { id: 'origen_gas', texto: '¿Sabe de dónde sale el gas (tanque, cilindro, tubería)?', tipo: 'texto', obligatoria: false },
      ],
      recomendaciones: ['No encienda ni apague luces o aparatos, ni use encendedores.', 'Si puede hacerlo sin riesgo, cierre la llave de paso.', 'Salga y espere afuera, lejos del lugar.'],
    },
    {
      incidenteId: 'inundacion',
      palabrasClave: ['inundacion', 'inundando', 'se inunda', 'agua', 'arroyo', 'se desbordo', 'corriente'],
      preguntas: [
        { id: 'atrapados', texto: '¿Hay alguien atrapado por el agua?', tipo: 'si_no', efectos: [{ cuando: SI, prioridad: 'alta', agregarCorporacion: 'bomberos', alerta: 'Personas atrapadas por el agua' }] },
        {
          id: 'nivel_agua', texto: '¿Hasta dónde llega el agua?', tipo: 'opcion',
          opciones: [
            { valor: 'tobillo', etiqueta: 'Al tobillo', sinonimos: ['tobillo', 'poquita', 'poca'] },
            { valor: 'rodilla', etiqueta: 'A la rodilla', sinonimos: ['rodilla'] },
            { valor: 'cintura', etiqueta: 'A la cintura o más', sinonimos: ['cintura', 'pecho', 'mucha', 'mas'] },
          ],
          efectos: [{ cuando: { igualA: 'cintura' }, prioridad: 'alta', alerta: 'Agua a la cintura o más' }],
        },
        PERSONAS,
      ],
      recomendaciones: ['No cruce corrientes de agua a pie ni en auto.', 'Suba a un lugar alto y desconecte la electricidad si es seguro.'],
    },
    {
      incidenteId: 'ruido-rina',
      palabrasClave: ['fiesta', 'musica', 'ruido', 'escandalo', 'borrachos'],
      preguntas: [
        {
          id: 'tipo_ruido', texto: '¿Qué tipo de ruido es?', tipo: 'opcion',
          opciones: [
            { valor: 'fiesta', etiqueta: 'Fiesta o música', sinonimos: ['fiesta', 'musica', 'bocinas'] },
            { valor: 'rina', etiqueta: 'Gritos o riña', sinonimos: ['gritos', 'pelea', 'rina', 'golpes'] },
            { valor: 'otro', etiqueta: 'Otro', sinonimos: ['otro'] },
          ],
          efectos: [{ cuando: { igualA: 'rina' }, prioridad: 'media', alerta: 'Posible riña' }],
          afinaCnie: true,
        },
      ],
      recomendaciones: ['No acuda a reclamar; espere a la unidad.'],
    },
    {
      incidenteId: 'otro',
      palabrasClave: [],
      preguntas: [
        { id: 'descripcion', texto: 'Cuénteme en pocas palabras qué pasa.', tipo: 'texto' },
        HERIDOS, ARMAS,
      ],
      recomendaciones: ['Manténgase en un lugar seguro mientras llega la unidad.'],
    },
  ],
};

export const PROTOCOLO_PROVISIONAL: Protocolo = ProtocoloSchema.parse(DATOS);
