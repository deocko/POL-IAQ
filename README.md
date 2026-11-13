# Pol-IAQ

Plataforma ciudadana para reportar emergencias a las policías municipales de Querétaro, con seguimiento en tiempo real bajo un **folio unificado** e integración por API con los CAD municipales y el C5 estatal.

**Municipios piloto:** Querétaro (014), Corregidora (006) y El Marqués (011).

## Estructura

| Carpeta | Qué es | Estado |
| --- | --- | --- |
| `packages/shared` | Tipos, catálogo semilla, folio, máquina de estados, geocercas, contrato de eventos CAD y firma HMAC | Con pruebas |
| `services/api` | API NestJS: registro con aceptación legal, reportes, evidencia con hash, webhooks CAD, escalamiento al C5, seguimiento por WebSocket | Con pruebas de punta a punta; almacén en memoria |
| `services/cad-simulator` | CAD simulado: acusa, asigna unidad, la mueve y cierra el reporte | Listo para demos |
| `apps/ciudadano` | App Expo (Android/iOS): registro, botón de pánico, catálogo, foto con hash, seguimiento y chat | Scaffold; compila el bundle de Android |
| `apps/web` | Next.js: publica el Aviso de Privacidad y los Términos; consola de operador en construcción | Scaffold |
| `docs/api` | `openapi.yaml` (API pública) y `asyncapi.yaml` (contrato de eventos con los CAD) | v0.1 |
| `docs/legal` | Aviso de Privacidad integral y simplificado, Términos y Condiciones | Borradores para revisión jurídica |
| `services/api/db/esquema.sql` | Esquema PostgreSQL + PostGIS para la fase 1 | Propuesta |

## Requisitos

Node.js 22 y pnpm 10 (`corepack enable`).

## Arranque rápido: demo de punta a punta

```bash
pnpm install
pnpm build
cp services/api/.env.example services/api/.env

pnpm dev:api        # API en http://localhost:3000
pnpm dev:cad        # CAD simulado en http://localhost:4000
pnpm dev:web        # Avisos legales en http://localhost:3001
pnpm dev:ciudadano  # App: abre con Expo Go
```

En un teléfono físico usa la IP de tu computadora: `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000 EXPO_PUBLIC_WEB_URL=http://192.168.x.x:3001 pnpm dev:ciudadano`. En desarrollo el código SMS es siempre `000000`.

Prueba rápida sin la app:

```bash
TOKEN=$(curl -s localhost:3000/v1/auth/verificar -H 'content-type: application/json' \
  -d '{"telefono":"+524421234567","codigo":"000000","nombre":"Prueba","aceptaAvisoPrivacidad":"2026-11-13","aceptaTerminos":"2026-11-13"}' | jq -r .token)
curl -s localhost:3000/v1/reportes -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"incidenteId":"robo-en-curso","ubicacion":{"lat":20.539,"lng":-100.442}}' | jq .folio
# -> "QRO-006-2026-000001" (Corregidora). El CAD simulado lo lleva hasta "cerrado".
```

## Pruebas

```bash
pnpm build && pnpm typecheck && pnpm test
```

## Pendientes antes del piloto

- Cargar los códigos oficiales del Catálogo Nacional de Incidentes de Emergencia (`codigoCnie` está en `null` a propósito).
- Sustituir las geocercas aproximadas por los polígonos oficiales de INEGI.
- Persistencia en PostgreSQL + PostGIS, colas con outbox y Redis para WebSocket.
- Proveedor de SMS, Keycloak/OIDC, almacén de objetos con WORM y URLs prefirmadas.
- mTLS y lista de IPs con cada CAD; adaptadores reales para los CAD de los tres municipios y el C5.
- Revisión jurídica de `docs/legal` y convenios con cada municipio.
- Mapa con la unidad en tiempo real en la app y consola de operador.
