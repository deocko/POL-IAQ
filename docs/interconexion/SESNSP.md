# Reporte mensual al SESNSP (CNI) y al CQ CIAS

Consola → pestaña **SESNSP mensual** (solo supervisión), o:

- `GET /v1/operador/sesnsp` meses y cierres.
- `GET /v1/operador/sesnsp/{AAAA-MM}` vista del mes (borrador o cerrado).
- `POST /v1/operador/sesnsp/{AAAA-MM}/cerrar` cierre del mes (solo meses ya terminados).
- `GET /v1/operador/sesnsp/{AAAA-MM}/reporte.csv`, `reporte.xlsx`, `ajustes.csv`.

## Contenido

Agrupado por **mes**, **clave de municipio de 5 dígitos** y **código CNIE V 3.0** (tipo, subtipo e
incidente). Sin datos personales. Columnas:

`mes, clave_municipio, municipio, cnie_tipo, cnie_tipo_nombre, cnie_subtipo, cnie_subtipo_nombre,
cnie_incidente, cnie_incidente_nombre, total_reportes, procedentes, improcedentes_cancelados,
mediana_recepcion_s, mediana_asignacion_s, mediana_salida_s, mediana_traslado_s, mediana_llegada_s`

Procedente: el folio se atendió o se atiende. Improcedente o cancelado: estado `improcedente` o
`cancelado`. Las medianas se calculan con el historial de estados, en hora de Querétaro, y solo con
etapas terminadas: una etapa en curso no cuenta (antes se medía hasta «ahora» y la mediana del borrador
subía sola con el reloj).

## Borrador y cierre

Mientras el mes no se cierra, la vista dice «Borrador: el mes sigue en curso» y los archivos se llaman
`sesnsp-AAAA-MM-borrador.csv|xlsx`. Ya cerrado dice «Cerrado el …» y se llaman
`sesnsp-AAAA-MM-cerrado.csv|xlsx`. Dos descargas de un mes cerrado son idénticas byte a byte.

En la demo hay un botón «Probar el cierre (solo demo)» que cierra el mes en curso para poder verlo
(la demo solo guarda reportes recientes); el cierre queda marcado como de prueba. El API real solo
cierra meses terminados.

## Cierre congelado

Al cerrar un mes se guarda el reporte tal cual y no se vuelve a calcular. En PostgreSQL, la tabla
`cierre_sesnsp` tiene un disparador que rechaza UPDATE y DELETE.

Si después un folio de un mes cerrado cambia (estado, CNIE o municipio), la diferencia sale como
**ajuste** en el cierre del mes siguiente, con su nota (`ajustes.csv` y hoja «Ajustes» del Excel).

## Pendiente

El acomodo de columnas sigue lo pedido en el Mensaje 9. **El formato oficial de captura del CNI
debe confirmarse con el CQ CIAS antes del primer envío.**
