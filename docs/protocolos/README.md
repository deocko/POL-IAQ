# Protocolos de atención de la despachadora 911 virtual

La despachadora virtual de la app no tiene preguntas escritas en el código: sigue
un **protocolo versionado** que es un archivo JSON validado por `ProtocoloSchema`
(`packages/shared/src/protocolos.ts`).

> **Estado actual: PROVISIONAL.** El archivo `2026.11-provisional.2.json` (vigente en el código;
> `2026.11-provisional.1.json` queda como historial) lo
> redactó el equipo de Pol-IAQ siguiendo la estructura general de atención de
> llamadas de emergencia. **No** es el texto oficial del *Protocolo Nacional de
> Atención de Llamadas de Emergencia 9-1-1* ni del *Catálogo Nacional de
> Incidentes de Emergencia* (SESNSP / Centro Nacional de Información). Antes del
> piloto debe sustituirse pregunta por pregunta por el contenido vigente,
> validado con el C5 de Querétaro, y publicarse con `"estado": "vigente"`.
> Referencia de consulta: [Norma Técnica CALLE (gob.mx)](https://www.gob.mx/cms/uploads/attachment/file/895276/NT_CALLE_2023_II-2024_final.pdf).

## Qué contiene un protocolo

| Campo | Para qué sirve |
| --- | --- |
| `version`, `estado`, `fuentes`, `publicadoEn` | Trazabilidad: cada folio guarda la versión con la que se levantó. |
| `apertura` | Saludo, pregunta del motivo, confirmación (`{incidente}`) y cierre (`{folio}`). |
| `preguntasGenerales` | Se hacen en todos los incidentes (por ejemplo, si quien llama está en un lugar seguro). |
| `incidentes[].palabrasClave` | Con ellas la despachadora reconoce el incidente en el relato libre ("mi abuelo se desmayó"). Siempre pide confirmación. |
| `incidentes[].preguntas` | Preguntas del incidente. Tipos `si_no`, `numero`, `texto`, `opcion`. `mostrarSi` las hace condicionales. |
| `preguntas[].efectos` | Cómo cambia la **canalización** según la respuesta: subir prioridad, agregar una corporación de apoyo (Cruz Roja, Bomberos…) y una alerta corta para la unidad. |
| `incidentes[].recomendaciones` | Indicaciones al ciudadano mientras llega la unidad. |

Los `incidenteId` deben existir en el catálogo (`packages/shared/src/catalogo.ts`).
Las preguntas cerradas aceptan además la respuesta `"no_sabe"`.

## Llamada corta: qué pregunta la despachadora

La unidad se solicita en cuanto se levanta el folio; las preguntas solo afinan la
canalización. Por eso la despachadora no hace todo el protocolo
(`preguntasDespachadora` en `packages/shared/src/protocolos.ts`):

- Solo hace las preguntas **obligatorias**. Las opcionales (edad, padecimientos,
  descripción de responsables…) quedan para el operador.
- Primero las **vitales** (las que pueden subir la prioridad a alta o sumar una
  corporación), las del incidente antes que las generales; después las demás.
- **Tema nuevo** (la persona cuenta qué pasa): máximo 4 preguntas.
- **Acceso rápido** de un lugar guardado: sus respuestas ya van prellenadas y no
  se repiten. Solo se pregunta lo vital que falte, máximo 2.
- La persona puede terminar en cualquier momento; si no se le entiende dos
  veces, se anota "No sabe" y se sigue.

Las preguntas se redactan cortas y en lenguaje cotidiano ("¿Respira bien?").

## Qué se guarda en el folio

Cada respuesta se guarda en texto (`reporte.cuestionario`) con el texto exacto de
la pregunta, la respuesta interpretada, lo que dijo o escribió la persona, la vía
(`voz`, `texto`, `escenario`) y la hora. El CAD recibe ese cuestionario con una
transcripción `P:/R:` y la canalización (`prioridad`, `corporaciones`, `alertas`)
en `incidente.creado` y en cada `incidente.actualizado`. Cambiar de versión no
altera los folios anteriores.

## Publicar una versión nueva

1. Copiar el JSON vigente a `docs/protocolos/<nueva-version>.json` y editarlo
   (por ejemplo `2027.03-cni.1`). Mantener los `id` de las preguntas que no
   cambian de sentido; usar `id` nuevos si cambian, para no mezclar respuestas.
2. Validarlo:
   ```bash
   pnpm --filter @pol-iaq/api validar-protocolo ../../docs/protocolos/<nueva-version>.json
   ```
3. Configurar `PROTOCOLO_ARCHIVO=/ruta/<nueva-version>.json` en el API y
   reiniciar. `GET /v1/protocolo` sirve la versión nueva y la app la descarga al
   iniciar sesión (sin conexión usa la que trae integrada).
4. Revisar que los escenarios sugeridos (`packages/shared/src/escenarios.ts`)
   sigan apuntando a preguntas que existen; la prueba
   `escenarios por lugar guardado` lo verifica para la semilla.

TODO(fase 2): guardar las versiones en base de datos con un panel de
administración para el C5, en lugar de un archivo.
