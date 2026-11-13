# Pol-IAQ

Plataforma ciudadana para reportar emergencias a las policías municipales de Querétaro, con seguimiento en tiempo real bajo un **folio unificado** e integración por API con los CAD municipales y el C5 estatal.

**Municipios piloto:** Querétaro (014), Corregidora (006) y El Marqués (011).

## Estructura

| Carpeta | Qué es | Estado |
| --- | --- | --- |
| `packages/shared` | Tipos, catálogo semilla, folio, máquina de estados, geocercas, contrato de eventos CAD y firma HMAC | Con pruebas |
| `services/api` | API NestJS: registro con OTP por SMS y aceptación legal, reportes, evidencia con hash, webhooks CAD, escalamiento al C5, seguimiento por WebSocket, avisos por SMS | Con pruebas de punta a punta en memoria y en PostgreSQL |
| `services/cad-simulator` | CAD simulado: acusa, asigna unidad, la mueve y cierra el reporte | Listo para demos |
| `apps/ciudadano` | App Expo (Android/iOS/Web): registro, botón de asistencia directa, despachadora 911 virtual (voz/texto), lugares guardados con accesos rápidos, catálogo, foto con hash, seguimiento con mapa de la unidad en vivo y chat | Scaffold; compila Android y web |
| `apps/web` | Next.js: publica el Aviso de Privacidad y los Términos; consola de operador en construcción | Scaffold |
| `docs/api` | `openapi.yaml` (API pública) y `asyncapi.yaml` (contrato de eventos con los CAD) | v0.1 |
| `docs/legal` | Aviso de Privacidad integral y simplificado, Términos y Condiciones | Borradores para revisión jurídica |
| `services/api/db/migraciones` | Esquema PostgreSQL + PostGIS; el API aplica las migraciones al arrancar | En uso |

## Requisitos

Node.js 22 y pnpm 10 (`corepack enable`).

## Arranque rápido: demo de punta a punta

```bash
pnpm install
pnpm build
cp services/api/.env.example services/api/.env
docker compose up -d postgres   # PostgreSQL + PostGIS; el API crea las tablas al arrancar

pnpm dev:api        # API en http://localhost:3000
pnpm dev:cad        # CAD simulado en http://localhost:4000
pnpm dev:web        # Avisos legales en http://localhost:3001
pnpm dev:ciudadano  # App: abre con Expo Go
```

En un teléfono físico usa la IP de tu computadora: `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000 EXPO_PUBLIC_WEB_URL=http://192.168.x.x:3001 pnpm dev:ciudadano`. En desarrollo el SMS es simulado (se imprime en el log del API) y además se acepta el código fijo `000000` (`OTP_DEV`). Sin `DATABASE_URL` el API usa un almacén en memoria que se borra al reiniciar.

En web (`pnpm --filter @pol-iaq/ciudadano web`) el mapa usa Leaflet con OpenStreetMap; en Android e iOS usa `react-native-maps` (Apple Maps en iOS; para un build de Android define `GOOGLE_MAPS_ANDROID_API_KEY`).

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
# También contra PostgreSQL (la base se borra en cada corrida; usa una exclusiva para pruebas):
TEST_DATABASE_URL=postgres://poliaq:poliaq-dev@localhost:5432/poliaq_test pnpm test
```

## Escenarios y despachadora 911 virtual

- **Mis lugares** (`GET/PUT /v1/perfil`): el ciudadano guarda su casa, la de sus familiares, su trabajo… con la ubicación exacta, quién vive ahí (adultos mayores, niños…) e información médica opcional. Para cada lugar se sugieren **accesos rápidos** (`sugerirEscenarios`), por ejemplo "Emergencia médica en casa de mis abuelos" o "Ruidos extraños de noche". Un acceso rápido se envía con dos toques, con la ubicación guardada y las respuestas que ya se conocen.
- **Despachadora 911 virtual** (`apps/ciudadano/src/pantallas/Asistente911.tsx`): atiende por voz (`expo-speech` + `expo-speech-recognition`, es-MX) o por texto. Pregunta el motivo, lo clasifica en el catálogo, levanta el folio de inmediato y luego hace las preguntas del protocolo. Siempre ofrece llamar al 911 real.
- **Protocolo versionado**: las preguntas son datos (JSON) y se actualizan sin tocar código. Cada respuesta queda en texto en el folio (`POST /v1/reportes/{folio}/cuestionario`) y recalcula la **canalización** (prioridad, corporaciones de apoyo y alertas) que se envía al CAD. Ver [`docs/protocolos`](docs/protocolos/README.md). **El protocolo actual es provisional, no oficial.**
- El antiguo "botón de pánico" se llama ahora **botón de asistencia directa** (`asistenciaDirecta` en el API).

## SMS

`SMS_PROVIDER=simulado` (por defecto) o `twilio` con `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_FROM` (número o Messaging Service `MG…`). En producción el API no arranca con el simulado. Para otro proveedor implementa `ProveedorSms` en `services/api/src/sms/sms.ts`.

## Pendientes antes del piloto

- Sustituir el protocolo provisional de la despachadora virtual por el Protocolo Nacional de Atención de Llamadas de Emergencia 9-1-1 vigente, validado con el C5 (`docs/protocolos`).
- Cargar los códigos oficiales del Catálogo Nacional de Incidentes de Emergencia (`codigoCnie` está en `null` a propósito).
- Sustituir las geocercas aproximadas por los polígonos oficiales de INEGI.
- Trabajador de colas para la bandeja de salida y los temporizadores de acuse; Redis para WebSocket con varias instancias.
- Contratar el proveedor de SMS (cuenta, remitente y registro de plantillas), Keycloak/OIDC, almacén de objetos con WORM y URLs prefirmadas (hoy la evidencia va en PostgreSQL).
- mTLS y lista de IPs con cada CAD; adaptadores reales para los CAD de los tres municipios y el C5.
- Revisión jurídica de `docs/legal` y convenios con cada municipio.
- Llave de Google Maps para Android, proveedor de teselas para web y consola de operador.
