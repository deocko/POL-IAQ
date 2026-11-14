# Pol-IAQ

Plataforma ciudadana para reportar emergencias a las policías municipales de Querétaro, con seguimiento en tiempo real bajo un **folio unificado** e integración por API con los CAD municipales y el C5 estatal.

**Municipios piloto:** Querétaro (014), Corregidora (006) y El Marqués (011).

## Demo en vivo (datos de prueba)

| Parte | URL pública | Cómo funciona en la demo |
| --- | --- | --- |
| Portada | https://deocko.github.io/POL-IAQ/ | Explica el recorrido |
| App ciudadana (web) | https://deocko.github.io/POL-IAQ/demo/ | Registro con código SMS `000000`, reporte, folio unificado y seguimiento |
| Consola del operador | https://deocko.github.io/POL-IAQ/consola/ | Usuario `operador`, clave `operador` |
| API (`services/api`) | **No está publicado** | Simulado en el navegador con la misma lógica de `@pol-iaq/shared` |
| CAD simulado (`services/cad-simulator`) | **No está publicado** | Simulado en el navegador: acusa a los 3 s, asigna unidad y cierra a los ~32 s |

Recorrido: abre `/demo/`, regístrate (código `000000`, no se envía ningún SMS), elige incidente y ubicación de prueba y envía. Recibes un folio como `QRO-006-2026-000001`. Si eliges "Yo, desde la consola del operador", abre `/consola/` en otra pestaña del **mismo navegador**, entra con `operador`/`operador` y lleva el reporte por recibir → asignar → en camino → en sitio → cerrar; la app ciudadana se actualiza al instante. Si eliges "El CAD simulado", avanza solo hasta cerrado. Si nadie recibe un reporte en 90 s, se escala al C5 con el mismo folio. Las ubicaciones de prueba cubren los tres municipios piloto y una fuera del piloto (San Juan del Río → folio `QRO-000-…` del C5).

Por qué así: la demo se publica en GitHub Pages (gratis, en el mismo repo, sin cuentas ni llaves de terceros). Pages solo sirve archivos estáticos, así que el API NestJS y el CAD simulado no pueden correr ahí: con `NEXT_PUBLIC_DEMO=1`, `apps/web/lib/demo/motor.ts` hace en el navegador lo mismo que ellos (folio, geocercas, máquina de estados, cuestionario, canalización, escalamiento al C5). Los datos viven en el `localStorage` de quien abre la demo, se comparten entre pestañas de ese navegador y se borran con "Borrar datos de la demo". **Solo datos de prueba: nada sale del navegador ni llega a ningún CAD o policía.** Para probar los servicios reales, usa el arranque rápido de abajo.

Publicación: el flujo `.github/workflows/demo-pages.yml` construye `pnpm --filter @pol-iaq/web build:demo` en cada push a `main` y publica `apps/web/out` en la rama `gh-pages`. Para la vista local idéntica: `pnpm --filter @pol-iaq/web build:demo` y sirve `apps/web/out` bajo `/POL-IAQ/`.

## Estructura

| Carpeta | Qué es | Estado |
| --- | --- | --- |
| `packages/shared` | Tipos, catálogo semilla, folio, máquina de estados, geocercas, contrato de eventos CAD y firma HMAC | Con pruebas |
| `services/api` | API NestJS: registro con OTP por SMS y aceptación legal, reportes, evidencia con hash, webhooks CAD, escalamiento al C5, seguimiento por WebSocket, avisos por SMS | Con pruebas de punta a punta en memoria y en PostgreSQL |
| `services/cad-simulator` | CAD simulado: acusa, asigna unidad, la mueve y cierra el reporte | Listo para demos |
| `apps/ciudadano` | App Expo (Android/iOS/Web): registro, botón de asistencia directa, despachadora 911 virtual (voz/texto), lugares guardados con accesos rápidos, catálogo, foto con hash, seguimiento con mapa de la unidad en vivo y chat | Scaffold; compila Android y web |
| `apps/web` | Next.js: Aviso de Privacidad y Términos, consola del operador y la demo pública (`/demo`, modo `NEXT_PUBLIC_DEMO=1`) | En uso |
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
pnpm dev:web        # Avisos legales y consola de operador en http://localhost:3001
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

## Consola del operador/despachador

`http://localhost:3001/consola` (`apps/web/app/consola`). Es para municipios **sin CAD integrado** y para supervisión:

- Los CAD en `CONSOLA_CADS` (p. ej. `CONSOLA_CADS=cad-el-marques`) no reciben webhook: el operador ve su bandeja en tiempo real (namespace `/operacion`), con la transcripción de la despachadora virtual, la canalización, las alertas y los datos del reportante, y despacha desde ahí: recibir, asignar unidad con ETA, en camino, en sitio, cerrar, improcedente, transferir a otro CAD y chatear con el ciudadano. Cada acción pasa por el mismo flujo que los eventos de un CAD (`EventosCadService`): auditoría, SMS y seguimiento en la app.
- Los CAD con sistema propio (webhook) se ven en **solo lectura**.
- Si nadie recibe el reporte en `CAD_ACK_TIMEOUT_SEC`, se escala al C5 igual que con un CAD integrado (la consola muestra la cuenta regresiva).
- Operadores en `OPERADORES_JSON` (clave con `pnpm --filter @pol-iaq/api hash-clave '<clave>'`), cada uno limitado a sus `cadIds` (`*` = supervisión). Fuera de producción existe `operador` / `operador`. Unidades en `UNIDADES_JSON` (en desarrollo hay unidades de ejemplo por CAD).
- La web apunta al API con `NEXT_PUBLIC_API_URL` (por defecto `http://localhost:3000`).

## SMS

`SMS_PROVIDER=simulado` (por defecto) o `twilio` con `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_FROM` (número o Messaging Service `MG…`). En producción el API no arranca con el simulado. Para otro proveedor implementa `ProveedorSms` en `services/api/src/sms/sms.ts`.

## Pendientes antes del piloto

- Sustituir el protocolo provisional de la despachadora virtual por el Protocolo Nacional de Atención de Llamadas de Emergencia 9-1-1 vigente, validado con el C5 (`docs/protocolos`).
- Consola: cambiar los usuarios en configuración por SSO (OIDC) con segundo factor, y cargar el padrón real de unidades de cada municipio.
- Cargar los códigos oficiales del Catálogo Nacional de Incidentes de Emergencia (`codigoCnie` está en `null` a propósito).
- Sustituir las geocercas aproximadas por los polígonos oficiales de INEGI.
- Trabajador de colas para la bandeja de salida y los temporizadores de acuse; Redis para WebSocket con varias instancias.
- Contratar el proveedor de SMS (cuenta, remitente y registro de plantillas), Keycloak/OIDC, almacén de objetos con WORM y URLs prefirmadas (hoy la evidencia va en PostgreSQL).
- mTLS y lista de IPs con cada CAD; adaptadores reales para los CAD de los tres municipios y el C5.
- Revisión jurídica de `docs/legal` y convenios con cada municipio.
- Llave de Google Maps para Android, proveedor de teselas para web y consola de operador.
