# Catálogo Nacional de Incidentes de Emergencia (CNIE V 3.0)

Fuente única: [`CNIE_V_3.0_Oficial_junio_24.pdf`](CNIE_V_3.0_Oficial_junio_24.pdf), versión 3.0, junio de 2024
(sha256 `1d0f6867690338e3b2087cdaaa677df5d4cb0feca450c9c71986522198857609`). **El PDF manda**: ningún código
del sistema se escribió a mano sin verificarlo contra él.

## Estructura del código

| Nivel | Dígitos | Ejemplo |
|---|---|---|
| Tipo | 1 | `3` Seguridad |
| Subtipo | 3 | `302` Armas y explosivos |
| Incidente | 5 | `30202` Detonación por arma de fuego · ALTA |

- 7 tipos, 26 subtipos (25 vigentes; el `502` está retirado).
- 361 incidentes vigentes con nombre y prioridad (ALTA, MEDIA, BAJA).
- 12 códigos retirados, listados aparte (`CODIGOS_CNIE_RETIRADOS`): `10212` y `30704` (dados de baja) y
  `30902`, `50201`, `50202`, `50203`, `60101`, `60102`, `70102`, `70103`, `70105`, `70108`.
  Un código retirado o inexistente se rechaza con 400 (`cnie_retirado`, `cnie_inexistente`, `cnie_formato`) y un
  mensaje claro; si el PDF indica reemplazo, se devuelve en `reemplazo`.

## Datos versionados y cómo regenerarlos

Los datos están en `packages/shared/src/cnie-v3.ts` (generado) y se consultan con `packages/shared/src/cnie.ts`
(`validarCodigoCnie`, `buscarCnie`, `etiquetaCnie`, `subtiposDeTipo`, `incidentesDeSubtipo`…). Para regenerar:

```bash
pdftotext -layout docs/cnie/CNIE_V_3.0_Oficial_junio_24.pdf /tmp/cnie.txt
node docs/cnie/extraer-cnie.mjs /tmp/cnie.txt packages/shared/src/cnie-v3.ts
```

El script comprueba que salgan 361 vigentes y 12 retirados, sin códigos repetidos y con subtipos válidos.
Donde la extracción de texto del PDF falla (palabras cortadas por el diseño de la tabla), el script aplica
correcciones revisadas a ojo contra la página del PDF y anotadas con su número de página (`CORRECCIONES`,
`PRIORIDADES_MANUALES`). Una versión nueva del CNIE se agrega como un archivo nuevo (`cnie-v4.ts`); los folios
guardan la versión con la que se clasificaron.

Nota: el PDF imprime `10114` como "LESIONADA(S" sin cerrar el paréntesis. Se conserva tal cual.

## Clasificación de cada reporte

Cada reporte guarda `cnie` = `{ version, tipo, subtipo, incidente | null, prioridad | null, secundario | null, origen }`.
`origen` es `catalogo` (código fijo de la entrada), `respuestas` (afinado por las preguntas), `ciudadano`
(lo eligió en "Otro") u `operador` (lo corrigió la consola o el CAD). Los folios anteriores conservan `null`
y siguen siendo válidos.

| Entrada de la app | Subtipo | Incidente | Pregunta que afina |
|---|---|---|---|
| Robo en curso | 304 | según `que_roban` y si hubo violencia: persona 30421/30422, negocio 30419/30420, casa 30413/30414, vehículo 30429/30430, dentro del auto 30403, otro 30446 | `que_roban` |
| Agresión | 309 | 30909; riña entre varios 31112; con heridos secundario 10225 | `pelea_mutua` |
| Intrusión | 310 | 31001; si es robo a casa 30413/30414 | `robo_casa` |
| Violencia familiar | 305 | 30503; pareja o expareja 30502 | `es_pareja` |
| Disparos | 302 | 30202; en escuela 30206 | `en_escuela` |
| Persona sospechosa | 309 | 30904; vehículo sospechoso 30307 | `es_vehiculo` |
| Accidente vial | 101 | sin lesionados 30309; con lesionados según `tipo_accidente` (10103, 10104, 10107, 10109, 10116) | `tipo_accidente` |
| Emergencia médica | 103 | según `sintoma` (10301, 10302, 10305, 10307, 10308, 10314, 10315, 10316, 10204); inconsciente sin respirar 10313 | `sintoma` |
| Persona lesionada | 102 | según `tipo_lesion` (10204, 10206, 10208, 10209, 10211, 10213, 10220, 10222, 10225); sangrado 10207 | `tipo_lesion` |
| Incendio | 203 | según `tipo_incendio` (20301, 20302, 20303, 20304, 20307, 20310, 20311) | `tipo_incendio` |
| Fuga de gas | 201 | 20115 | — |
| Inundación | 202 | 20207 | — |
| Ruido o riña | 501 | 50105; riña 31112 | `tipo_ruido` |
| Otro | — | el que elija el ciudadano en el explorador del catálogo, o sin clasificar | — |

Reglas: se hace **una sola pregunta de afinado por caso** (`afinaCnie` en el protocolo), al final y fuera del
tope de preguntas. Si no se sabe si hubo violencia, se clasifica "con violencia" (la variante de prioridad más
alta). El código secundario `30903` (violencia contra las mujeres) solo lo pone el operador.

## Anonimato por subtipo

- **No permiten anónimo**: 302, 304, 305, 309, 310.
- **Permiten anónimo**: 101, 102, 103, 201, 202, 203, 204, 301, 303, 311, 312, 401, 501, 503.
- Los subtipos que no están en ninguna lista (306, 307, 308, 601, 602, 701) se tratan como **no permitidos**.
- Se revisa el subtipo base de la entrada y el afinado por las respuestas; ambos deben permitirlo.
- **Conflicto pendiente**: "Persona sospechosa" es `30904` (subtipo 309, no permitido), pero se había marcado como
  anónima. Se conserva como excepción (`EXCEPCIONES_ANONIMATO`) hasta que se decida.

## Dónde aparece

- API: `GET /v1/catalogo` (entradas con sus códigos) y `GET /v1/cnie` (catálogo completo); `codigoCnie` en
  `POST /v1/reportes` solo para "Otro".
- CAD y C5: `cnie` en `incidente.creado` / `incidente.actualizado`; el CAD puede corregir con
  `incidente.reclasificado` o enviando otro `codigoCnie` en `incidente.recibido` ([`docs/api/asyncapi.yaml`](../api/asyncapi.yaml)).
- Consola: etiqueta "CNIE 30202 · Seguridad / Armas y explosivos / Detonación por arma de fuego · ALTA",
  corrección con búsqueda y auditoría, tablero por tipo y subtipo.
- App ciudadana: sin códigos al reportar; en el seguimiento, "Robo (CNIE 304)".
