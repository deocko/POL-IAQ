# Adaptador de referencia POL-IAQ ⇄ CAD municipal (Modo A)

Código: `services/cad-adaptador`. Solo datos de demostración en pruebas.

## Para qué sirve

Un municipio con CAD propio (Modo A) no tiene que hablar el contrato v1 de POL-IAQ directamente.
El adaptador traduce entre el contrato v1 (sin cambios) y el formato del CAD:

| Sentido | Entrada | Salida |
|---|---|---|
| POL-IAQ → CAD | `incidente.creado`, `incidente.actualizado` firmados con HMAC en `POST /poliaq/{cadId}/eventos` | `POST {cadUrl}/incidentes` y `POST {cadUrl}/incidentes/{folio}/actualizaciones` |
| CAD → POL-IAQ | Eventos del CAD en `POST /cad/{cadId}/eventos` (token Bearer del CAD) | Los 7 eventos v1 firmados en `POST /v1/cad/{cadId}/eventos` |
| CAD → POL-IAQ (AVL) | Posiciones en `POST /cad/{cadId}/avl` | Lote cada `AVL_CADA_MS` en `POST /v1/cad/{cadId}/avl` |

`GET /salud` responde `{ ok, despliegue, cads }`.

Los 7 eventos v1 que produce: `incidente.recibido` (acuse), `unidad.asignada`, `unidad.posicion`,
`incidente.estado` (en_camino, en_sitio, cerrado, improcedente), `incidente.transferido`,
`mensaje.operador` e `incidente.reclasificado`.

## Formato nativo de referencia

`src/nativo.ts` define un JSON sencillo (`ACUSE`, `ASIGNACION`, `GPS`, `ESTATUS`, `TRANSFERENCIA`,
`MENSAJE`, `RECLASIFICACION`, y AVL `{ posiciones: [...] }`). **No es el formato de ningún proveedor
real.** Sirve de ejemplo y es el que habla el simulador (`SIM_MODO=nativo`). Para un CAD real se
escribe un conector con las mismas tres piezas (`haciaCad`, `desdeCad` y los esquemas de entrada)
contra la documentación del proveedor; el resto del adaptador no cambia.

La clave de municipio viaja como `municipioInegi` de 5 dígitos (22001–22018).

## Garantías

- **Idempotencia.** Si el CAD manda `idEvento`, el `eventoId` v1 es un UUID v5 derivado de
  `cadId` + `idEvento`: los reintentos del CAD llegan a POL-IAQ con el mismo `eventoId` y no tienen
  efecto doble. Las entregas repetidas de POL-IAQ (mismo `idempotency-key`) se descartan.
- **Orden.** `secuencia` por folio = máx(anterior + 1, segundos epoch), siempre creciente.
- **Reintentos hacia POL-IAQ** con `REINTENTOS_MS` (por defecto 0, 1, 2, 4, 8, 16 s).
- **CAD caído.** Si el CAD no responde, el adaptador contesta 502 a POL-IAQ, que reintenta con su
  bandeja de salida.
- **Sin datos personales en reposo.** Nombre, teléfono y descripción pasan en tránsito hacia el CAD
  y no se guardan. En memoria solo quedan ids de eventos ya entregados, la última secuencia por
  folio y qué unidad atiende qué folio; al cerrar el folio se olvida. La prueba E2E lo revisa.

## Dos formas de despliegue (sin decidir entre ellas)

El mismo código y la misma imagen sirven para las dos; cambia solo la configuración.

### Forma 1: alojado por POL-IAQ

Un adaptador para varios municipios, operado por el equipo de POL-IAQ.

```
ADAPTADOR_TENANTS_JSON={"cad-san-juan-del-rio":{"secreto":"…","cadUrl":"https://cad.municipio.example/api","tokenHaciaCad":"…","tokenDesdeCad":"…"}}
```

Rutas con `{cadId}`. En el alta del CAD, `webhookUrl` apunta a
`https://adaptador.poliaq.example/poliaq/{cadId}/eventos`.

- A favor: un solo lugar que mantener y actualizar; el municipio solo expone su API.
- En contra: POL-IAQ necesita salida de red hacia cada CAD municipal (VPN o IP fija) y custodia los
  tokens del CAD.

### Forma 2: instalado en el municipio

Un adaptador por CAD, dentro de la red del municipio.

```
CAD_ID=cad-san-juan-del-rio
POLIAQ_SECRETO=…            # el mismo secreto del alta
CAD_URL=http://cad.local/api
CAD_TOKEN_ENTRADA=…         # obligatorio
CAD_TOKEN_SALIDA=…          # opcional
POLIAQ_MTLS_CERT=/run/secrets/cad.crt
POLIAQ_MTLS_KEY=/run/secrets/cad.key
```

Acepta también rutas sin `{cadId}` (`/poliaq/eventos`, `/cad/eventos`, `/cad/avl`).

- A favor: el CAD no se expone a internet; solo sale tráfico hacia POL-IAQ (con mTLS e IP fija).
- En contra: cada municipio opera y actualiza su instancia.

### Común

`PORT` (4100), `POLIAQ_URL`, `REINTENTOS_MS`, `AVL_CADA_MS` (5000), `TIEMPO_MAX_MS` (5000),
`POLIAQ_MTLS_CERT`, `POLIAQ_MTLS_KEY`, `POLIAQ_MTLS_CA`. Ver `services/cad-adaptador/.env.example`.

Imagen: `docker build -f services/cad-adaptador/Dockerfile -t poliaq-cad-adaptador .` (desde la raíz).

## Probarlo

```
pnpm --filter @pol-iaq/cad-adaptador test
```

`test/e2e.test.ts` levanta el API real (en memoria), el simulador en formato nativo y el adaptador:
reporte → acuse → asignación → GPS (evento y AVL) → cierre, y luego los 8 casos de certificación.
