# Datos que debe proporcionar el área jurídica (lista cerrada)

**Fecha:** 2026-11-15 · **Borradores:** `docs/legal/` versión 2026-11-14 · **Total:** 22 datos y 7 decisiones. No falta nada fuera de esta lista para publicar la versión definitiva.

El bloqueo de las páginas legales es de **datos, no de código**. Ningún dato se llenó con un valor inventado. Mientras falten, las tres páginas muestran arriba «Versión preliminar en revisión jurídica» con lo que falta en cada una, y el texto omite el dato (sin huecos ni promesas). Las omisiones exactas están en `apps/web/lib/legal.ts`.

## Cómo entregar

- Llenar la columna «Valor aprobado» de las tablas A y B (o responder con el **ID** y el valor) en el **formato** indicado.
- Si un mismo dato sirve para varios lugares, se escribe una vez: el ID dice todos los lugares donde va.
- Las secciones se nombran por su título. Mientras una sección esté oculta por falta de datos, la página publicada renumera las demás, así que el número publicado puede ser uno menos que el del borrador.

## Páginas

| Página | Dirección en la demo | Borrador |
| --- | --- | --- |
| Aviso de Privacidad Integral | `/legal/aviso-privacidad/` | `docs/legal/aviso-privacidad.md` |
| Aviso de Privacidad Simplificado | `/legal/aviso-simplificado/` y pantalla de registro de la app | `docs/legal/aviso-simplificado.md` |
| Términos y Condiciones | `/legal/terminos/` | `docs/legal/terminos.md` |

## A. Datos que se capturan (22)

| ID | Dato | Dónde va (página › sección del borrador) | Formato | Valor aprobado |
| --- | --- | --- | --- | --- |
| A1 | Nombre oficial del responsable del tratamiento y área que lo opera | Aviso integral › 1. Quién es responsable de tus datos; Aviso simplificado › Aviso simplificado (inicio); Términos › 1. Qué es POL-IAQ y 9. Responsabilidad | Texto en una línea, como debe leerse: «[Dependencia], a través de [área]» | |
| A2 | Domicilio del responsable | Aviso integral › 1. Quién es responsable de tus datos | Calle, número exterior e interior, colonia, código postal, municipio y estado | |
| A3 | Fundamento legal del tratamiento | Aviso integral › 4. Fundamento legal (sección completa, hoy oculta) | Lista, un ordenamiento por renglón: nombre oficial completo, artículos y fracciones, y fecha de la última reforma que se consideró | |
| A4 | País o región donde se alojan los datos | Aviso integral › 5. Con quién compartimos tus datos | Nombre del país (y región o estado, si se quiere precisar) | |
| A5 | Plazo de conservación de reportes atendidos sin investigación abierta, con su evidencia | Aviso integral › 6. Cuánto tiempo los conservamos (tabla) | Número y unidad (días, meses o años) contados desde el cierre, y qué pasa después: «se eliminan» o «se anonimizan» | |
| A6 | Plazo de conservación de las bitácoras de auditoría | Aviso integral › 6. Cuánto tiempo los conservamos (tabla) | Número y unidad (meses o años) | |
| A7 | Plazo para eliminar una cuenta cancelada | Aviso integral › 6. Cuánto tiempo los conservamos (tabla) | Número de días, indicando si son naturales o hábiles | |
| A8 | Nombre de la Unidad de Transparencia | Aviso integral › 8. Tus derechos ARCO y cómo ejercerlos | Nombre oficial completo | |
| A9 | Domicilio de la Unidad de Transparencia | Aviso integral › 8. Tus derechos ARCO y cómo ejercerlos | Igual que A2 | |
| A10 | Horario de atención de la Unidad de Transparencia | Aviso integral › 8. Tus derechos ARCO y cómo ejercerlos | Días y horas, formato de 24 h: «lunes a viernes, HH:MM a HH:MM» | |
| A11 | Correo de la Unidad de Transparencia | Aviso integral › 3. Para qué usamos tus datos (negarse a finalidades adicionales) y 8. Tus derechos ARCO | Una dirección de correo institucional | |
| A12 | Teléfono de la Unidad de Transparencia | Aviso integral › 8. Tus derechos ARCO y cómo ejercerlos | 10 dígitos, con extensión si la hay | |
| A13 | Denominación vigente de la Plataforma Nacional de Transparencia (o la que la sustituya tras la reforma de 2025) | Aviso integral › 8. Tus derechos ARCO y cómo ejercerlos | Nombre oficial y dirección web (https) | |
| A14 | Plazo legal de respuesta a una solicitud ARCO | Aviso integral › 8. Tus derechos ARCO y cómo ejercerlos | Número de días hábiles y artículo que lo fija | |
| A15 | Autoridad garante ante la que se presenta una queja (Querétaro, tras la reforma de 2025) | Aviso integral › 8. Tus derechos ARCO (último párrafo) | Nombre oficial vigente y dirección web (https) | |
| A16 | Dirección oficial donde se publica el aviso vigente | Aviso integral › 10. Cambios a este aviso; Aviso simplificado › Aviso simplificado (final) | Dirección web completa (https) | |
| A17 | Disposición que sanciona las falsas alarmas | Términos › 6. Falsas alarmas y uso indebido | Nombre oficial del ordenamiento (estatal o municipal) y artículo | |
| A18 | Medio para inconformarse por una suspensión de cuenta | Términos › 10. Suspensión y baja de la cuenta | Medio (correo, oficina o formulario) con su dato de contacto, y plazo para inconformarse si lo hay | |
| A19 | Autoridades o tribunales competentes para controversias | Términos › 12. Ley aplicable y jurisdicción | Nombre de la autoridad o los tribunales y su sede | |
| A20 | Correo de contacto de los Términos | Términos › 13. Contacto (sección completa, hoy oculta) | Una dirección de correo; puede ser la misma que A11 | |
| A21 | Teléfono de contacto de los Términos | Términos › 13. Contacto | 10 dígitos; puede ser el mismo que A12 | |
| A22 | Domicilio de contacto de los Términos | Términos › 13. Contacto | Igual que A2; puede ser el mismo | |

## B. Decisiones (7)

| ID | Decisión | Dónde cambia el texto | Formato de la respuesta | Respuesta |
| --- | --- | --- | --- | --- |
| B1 | Quién es el responsable: autoridad pública (municipios piloto y/o Gobierno del Estado) o un particular. El borrador asume autoridad pública; si fuera un particular, el aviso se reescribe con la ley federal de particulares | Todo el aviso integral | «Autoridad pública» o «Particular» | |
| B2 | ¿Se pedirá la CURP? | Aviso integral › 2. Qué datos personales tratamos | Sí / No (si es No, se elimina la mención) | |
| B3 | ¿Las comunicaciones entre autoridades para atender el reporte no requieren consentimiento? | Aviso integral › 5. Con quién compartimos tus datos | Sí / No, con el artículo que lo fundamenta | |
| B4 | ¿Se permite el registro de adolescentes con consentimiento de madre, padre o tutor? | Aviso integral › 9. Personas menores de edad; Términos › 3. Quién puede usarla | Sí (con edad mínima) / No | |
| B5 | Alcance de la limitación de responsabilidad de una autoridad pública | Términos › 9. Responsabilidad | Texto aprobado del párrafo, o «se queda como está» | |
| B6 | Validación de los municipios piloto y del C5 de las secciones de sanciones, responsabilidad y jurisdicción | Términos › 6, 9 y 12 | Aprobado / cambios, por municipio y por el C5 | |
| B7 | Validación del tratamiento nuevo: reporte con seudónimo o anónimo (el teléfono verificado se conserva y solo se entrega a una autoridad cuando la ley lo exige), calificación y quejas tras el cierre, y medición de tiempos de respuesta | Aviso integral › 2, 3 y 5 | Aprobado / cambios | |

## Al recibir los datos

1. Se escriben en los `.md` de esta carpeta y se quita su omisión en `apps/web/lib/legal.ts`.
2. Se sube la versión en `packages/shared/src/legal.ts`; la app pide a cada persona aceptar de nuevo.
3. El aviso «Versión preliminar en revisión jurídica» desaparece solo cuando no queda ningún dato de esta lista.
