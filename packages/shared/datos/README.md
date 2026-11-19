# Datos versionados

## colonias-queretaro-sepomex.json

Colonias y demás asentamientos de los 18 municipios de Querétaro (claves INEGI 22001–22018), con código postal, tipo,
municipio, ciudad y zona. 3,279 asentamientos.

- **Fuente:** Catálogo Nacional de Códigos Postales de SEPOMEX (Correos de México), vía Postali
  ([postali.app/mx](https://postali.app/mx)), regenerado desde SEPOMEX.
- **Fecha de descarga:** 2026-11-19.
- **Licencia y atribución:** SEPOMEX proporciona el catálogo gratis y prohíbe su comercialización total o parcial.
  Postali pide citar la fuente con enlace a postali.app/mx. Solo se versiona el recorte de Querétaro, nunca el
  catálogo nacional completo.

El archivo se guarda tal cual, con su encabezado de atribución. La consola usa la tabla compacta
`src/colonias-qro.ts`, que se genera con:

```sh
node packages/shared/scripts/generar-colonias.mjs
```

La prueba `src/colonias.test.ts` verifica que la tabla corresponde a este archivo (SHA-256, total y municipios).
