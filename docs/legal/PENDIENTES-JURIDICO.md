# Datos que debe proporcionar el área jurídica

**Fecha:** 2026-11-15 (actualizada el mismo día) · Aplica a los borradores de `docs/legal/` versión 2026-11-14.

Mientras falten estos datos, las páginas publicadas **no muestran huecos ni frases que prometan el dato**: cada dato que falta se omite, la sección que queda vacía se quita (4. Fundamento legal del aviso integral y 13. Contacto de los Términos) y la tabla de plazos de conservación se sustituye por las reglas que no dependen de un número. Arriba de cada página, el aviso "Versión preliminar en revisión jurídica" dice qué datos faltan en ese documento. Las sustituciones exactas están en `apps/web/lib/legal.ts`. **Ninguno se llenó con un valor inventado.** Al recibir un dato, se escribe en el `.md` y se quita su sustitución. Los valores entre corchetes con números (por ejemplo `[12 meses]`) son propuestas del borrador, no plazos aprobados.

## Antes de llenar: decisiones de fondo

1. **Quién es el responsable del tratamiento.** El borrador asume que es una autoridad pública (municipios piloto y/o Gobierno del Estado). Por eso se apoya en la Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados y en la ley estatal de Querétaro. Si quien opera POL-IAQ fuera un particular, aplica la Ley Federal de Protección de Datos Personales en Posesión de los Particulares y el aviso debe reescribirse.
2. **Referencias vigentes tras la reforma de 2025.** Las leyes de protección de datos se reformaron en 2025 y cambió la autoridad garante. Hay que confirmar las leyes, los artículos y la autoridad ante la que se presentan quejas.
3. **Secciones de los Términos que requieren validación** de cada municipio piloto y del C5: 6 (sanciones), 9 (responsabilidad) y 12 (jurisdicción).
4. **Nuevo en 2026-11-14:** reporte con seudónimo o anónimo (el teléfono verificado se conserva y solo se entrega a una autoridad cuando la ley lo exige), calificación y quejas después del cierre, y medición de tiempos de respuesta. Hay que confirmar que este tratamiento y su redacción son correctos.

## Resumen: lo indispensable para publicar la versión definitiva

1. **Responsable**: nombre oficial y área (#1, #21, #23, #26).
2. **Domicilio** del responsable (#2).
3. **Fundamento legal** del tratamiento (#5, #6, #25).
4. **Plazos de conservación numéricos**: reportes sin investigación (#8), bitácoras (#9) y cuenta cancelada (#10).
5. **Datos de contacto**: Unidad de Transparencia (#4, #11 a #15) y contacto de los Términos (#30 a #32).

## Lista exacta de datos

| # | Documento | Sección | Marcador | Qué se necesita |
| --- | --- | --- | --- | --- |
| 1 | Aviso de Privacidad Integral | 1. Responsable | `[NOMBRE DEL RESPONSABLE …]` | Nombre oficial del responsable y área (p. ej. dependencia de seguridad pública) |
| 2 | Aviso de Privacidad Integral | 1. Responsable | `[DOMICILIO]` | Domicilio del responsable |
| 3 | Aviso de Privacidad Integral | 2. Datos | `[CURP, si se solicita]` | Decidir si se pedirá la CURP; si no, se elimina |
| 4 | Aviso de Privacidad Integral | 3. Finalidades | `[CORREO DE LA UNIDAD DE TRANSPARENCIA]` | Correo para negarse a finalidades adicionales |
| 5 | Aviso de Privacidad Integral | 4. Fundamento legal | `[COMPLETAR …]` | Artículos aplicables: ley general y estatal de datos personales, Ley General del Sistema Nacional de Seguridad Pública, Ley de Seguridad para el Estado de Querétaro y reglamentos municipales |
| 6 | Aviso de Privacidad Integral | 5. Transferencias | `[CONFIRMAR: no requieren tu consentimiento …]` | Confirmar si las comunicaciones entre autoridades no requieren consentimiento, con fundamento |
| 7 | Aviso de Privacidad Integral | 5. Transferencias | `[PAÍS/REGIÓN …]` | País o región donde se alojan los datos |
| 8 | Aviso de Privacidad Integral | 6. Conservación | `[12 meses]` | Plazo para reportes atendidos sin investigación abierta |
| 9 | Aviso de Privacidad Integral | 6. Conservación | `[5 años]` | Plazo para bitácoras de auditoría |
| 10 | Aviso de Privacidad Integral | 6. Conservación | `[30 días]` | Plazo para eliminar una cuenta cancelada |
| 11 | Aviso de Privacidad Integral | 7. Derechos ARCO | `[RESPONSABLE]` | Nombre de la Unidad de Transparencia |
| 12 | Aviso de Privacidad Integral | 7. Derechos ARCO | `[DOMICILIO]` | Domicilio de la Unidad de Transparencia |
| 13 | Aviso de Privacidad Integral | 7. Derechos ARCO | `[HORARIO]` | Horario de atención |
| 14 | Aviso de Privacidad Integral | 7. Derechos ARCO | `[CORREO]` | Correo de la Unidad de Transparencia |
| 15 | Aviso de Privacidad Integral | 7. Derechos ARCO | `[TELÉFONO]` | Teléfono de la Unidad de Transparencia |
| 16 | Aviso de Privacidad Integral | 7. Derechos ARCO | `[CONFIRMAR denominación vigente]` | Nombre vigente de la Plataforma Nacional de Transparencia |
| 17 | Aviso de Privacidad Integral | 7. Derechos ARCO | `[20 días hábiles]` | Plazo legal de respuesta |
| 18 | Aviso de Privacidad Integral | 8. Quejas | `[AUTORIDAD GARANTE …]` | Autoridad garante competente en Querétaro tras la reforma de 2025 |
| 19 | Aviso de Privacidad Integral | 9. Menores | `[CONFIRMAR CON JURÍDICO …]` | Si se permitirá el registro de adolescentes con consentimiento de madre, padre o tutor |
| 20 | Aviso de Privacidad Integral | 10. Cambios | `[URL]` | URL oficial donde se publicará el aviso vigente (en la demo apunta a la propia página) |
| 21 | Aviso Simplificado | Aviso simplificado | `[RESPONSABLE]` | Mismo dato que el #1 |
| 22 | Aviso Simplificado | Aviso simplificado | `[URL]` | URL oficial del aviso integral (en la demo apunta a la página del aviso integral) |
| 23 | Términos y Condiciones | 1. Qué es POL-IAQ | `[RESPONSABLE]` | Mismo dato que el #1 |
| 24 | Términos y Condiciones | 3. Quién puede usarla | `[CONFIRMAR política para adolescentes]` | Igual que el #19 |
| 25 | Términos y Condiciones | 6. Falsas alarmas | `[CITAR la disposición aplicable …]` | Disposición estatal o municipal que sanciona las falsas alarmas |
| 26 | Términos y Condiciones | 9. Responsabilidad | `[RESPONSABLE]` | Mismo dato que el #1 |
| 27 | Términos y Condiciones | 9. Responsabilidad | `[REVISAR CON JURÍDICO …]` | Alcance de la limitación de responsabilidad de una autoridad pública |
| 28 | Términos y Condiciones | 10. Suspensión | `[MEDIO]` | Medio para inconformarse por una suspensión de cuenta |
| 29 | Términos y Condiciones | 12. Jurisdicción | `[AUTORIDADES O TRIBUNALES COMPETENTES …]` | Autoridades o tribunales competentes |
| 30 | Términos y Condiciones | 13. Contacto | `[CORREO]` | Correo de contacto |
| 31 | Términos y Condiciones | 13. Contacto | `[TELÉFONO]` | Teléfono de contacto |
| 32 | Términos y Condiciones | 13. Contacto | `[DOMICILIO]` | Domicilio de contacto |

Cuando lleguen los datos, se reemplazan en los archivos `.md` de esta carpeta, se sube la versión en `packages/shared/src/legal.ts` y el API pide a cada persona aceptar de nuevo.
