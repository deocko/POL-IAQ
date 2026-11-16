# Producción, fase 1

Estado al Mensaje 9. «Hecho» quiere decir que está en el código y probado; lo demás está pendiente.

| Tema | Estado |
|---|---|
| PostgreSQL 16 + PostGIS | Hecho. Migraciones 001–006; las pruebas del API corren también contra PostgreSQL (`TEST_DATABASE_URL`). Ubicaciones como `geography(Point, 4326)`. El enrutamiento por geocerca se hace en el API con los polígonos de INEGI. |
| Clave de 5 dígitos | Hecho. Migración 006 pasa `municipio_clave` a `varchar(5)`, convierte las claves de 3 dígitos (`'014'` → `'22014'`) y agrega `CHECK (municipio_clave ~ '^22\d{3}$')`. |
| mTLS de los CAD | Hecho del lado del API: el proxy de entrada (Envoy, nginx) termina TLS y pasa el certificado en la cabecera `MTLS_CERT_HEADER` (por defecto `x-client-cert`; PEM codificado como URL o `Hash=` de Envoy). Se compara con la huella del alta. `MTLS_REQUIRED` está activo por defecto en producción. Falta configurar el proxy en la infraestructura real. |
| Lista de IPs | Hecho. `ipsPermitidas` por CAD. Detrás de un proxy, define `TRUST_PROXY` (p. ej. `loopback` o la red del balanceador) para que la IP sea la del CAD. |
| Secretos de los CAD | Hecho. Cifrados con AES-256-GCM, llave derivada (HKDF) de `TOKEN_SECRET`. |
| Keycloak / OIDC para operadores | Pendiente. Hoy la consola usa usuario y clave (`OPERADORES_JSON`, scrypt). Falta el realm, el segundo factor y el mapeo de `cadIds` a roles. |
| SMS real | Integración con Twilio lista (`SMS_PROVIDER=twilio`, `TWILIO_*`); en producción el API no arranca con SMS simulado. Falta la cuenta y el remitente. |
| Polígonos INEGI | Hecho. Marco Geoestadístico 2022 vía CONABIO, simplificado ~100 m, con SHA-256 de la fuente (`docs/municipios/`). Pendiente: validarlos con el C5 o con cada municipio, sobre todo en los límites. |
| Formato oficial SESNSP | Pendiente de confirmar con el C5 (`SESNSP.md`). |
