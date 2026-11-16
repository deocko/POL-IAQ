# Alta de un municipio en POL-IAQ

Los 18 municipios de Querétaro y el C5 tienen un `cadId` fijo (`cad-<municipio>`, `c5-queretaro`) y
una clave INEGI de 5 dígitos (22001–22018). Lista y polígonos: `docs/municipios/README.md`.

## Qué pasa antes del alta

Un reporte dentro de un municipio sin conectar lo atiende el C5, pero conserva la clave del
municipio en `municipioClave`, en los reportes, en las exportaciones y en el folio
(`QRO-016-2026-000001`). Los 3 pilotos (Querétaro, Corregidora, El Marqués) siguen conectados.

## Registro del CAD

Consola → pestaña **Municipios** (solo supervisión), o `PUT /v1/admin/cads/{cadId}`:

| Campo | Notas |
|---|---|
| `cadId` | Uno de los 19 conocidos |
| `nombre` | |
| `clave` | 5 dígitos; debe coincidir con la del municipio (null para el C5) |
| `modo` | `webhook` (Modo A, CAD propio) o `consola` (Modo B) |
| `poligono` | Opcional; sin él se usa el de INEGI 2022 |
| `webhookUrl` | Obligatorio en Modo A |
| `secreto` | HMAC-SHA256, mínimo 32 caracteres. Se guarda cifrado (AES-256-GCM) y nunca se devuelve |
| `certificadoSha256` | Huella del certificado de cliente para mTLS |
| `ipsPermitidas` | IPv4 con CIDR o IPv6 exacta (hasta 50) |
| `contactoTecnico` | nombre, correo y teléfono opcional |

El alta queda **En pruebas**. Fuera de producción un CAD en pruebas ya recibe folios; en producción
solo los recibe cuando está **Activo**.

## Ambiente de pruebas y los 8 casos (Modo A)

Obligatorios antes de activar: acuse a tiempo, asignación, GPS (evento y AVL en lote), llegada y
cierre, reclasificación CNIE, transferencia a otro municipio o al C5, caída del webhook con
reintentos, y evento duplicado sin efecto doble.

```
POLIAQ_URL=https://pruebas.poliaq.example CAD_ID=cad-san-juan-del-rio \
SUP_USUARIO=… SUP_CLAVE=… OTP_PRUEBAS=000000 REGISTRAR=1 \
pnpm --filter @pol-iaq/cad-adaptador certificar
```

La suite crea reportes de **demostración** dentro de la geocerca con marcas `[prueba:…]` en la
descripción. El simulador las entiende; con un CAD real, el equipo técnico hace a mano lo que pide
cada marca. Con `REGISTRAR=1` deja el resultado de cada caso en el alta
(`POST /v1/admin/cads/{cadId}/casos/{caso}`).

Para practicar sin CAD real: `SIM_MODO=nativo` en `services/cad-simulator` más el adaptador.

## Activación

`POST /v1/admin/cads/{cadId}/estado` con `activo`:

- Modo A: exige los 8 casos aprobados y, en producción, certificado (mTLS) y lista de IPs.
- Modo B: exige al menos una unidad registrada.

`suspendido` corta la conexión al momento: los folios nuevos van al C5 y los eventos del CAD se
rechazan con 403.

## Modo B (consola)

El municipio despacha desde la consola web: bandeja por municipio, registro de unidades
(patrulla, motopatrulla, ambulancia, bomberos, con su corporación), asignar con ETA, mapa, estados,
mensajes al ciudadano, transferir a otro CAD conectado o al C5 y corregir el CNIE con bitácora.

## Migración de Modo B a Modo A

`POST /v1/admin/cads/{cadId}/migrar` con `webhookUrl` (y `secreto` si cambia). Requiere los 8 casos.
No se pierde nada: folios, CNIE e historial se quedan. Los folios en curso se reenvían al CAD como
`incidente.creado` con el campo opcional `estadoActual` (estado, folio del CAD, unidad e historial),
compatible con el contrato v1. Queda en la bitácora.

## Herramientas de soporte

- `GET /v1/admin/cads/{cadId}/bandeja?folio=` entregas y reintentos.
- `POST /v1/admin/cads/{cadId}/reenviar` reentrega un folio (mismo `eventoId`).
- `GET /v1/admin/auditoria?folio=` bitácora.
