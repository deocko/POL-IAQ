# Municipios de Querétaro

18 municipios (entidad 22) más el C5 estatal. Fuente de claves, nombres y polígonos: Marco
Geoestadístico de INEGI 2022, versión GeoJSON de CONABIO. `extraer-geocercas.mjs` genera
`packages/shared/src/municipios-qro.ts` y guarda la URL y el SHA-256 de la fuente
(`FUENTE_GEOCERCAS`). Los polígonos se simplifican con Douglas-Peucker (0.001°, unos 100 m).

```
node docs/municipios/extraer-geocercas.mjs [ruta a Querétaro.json]
```

- `cadId`: `cad-<nombre-en-minúsculas-sin-acentos>` (p. ej. `cad-san-juan-del-rio`); C5: `c5-queretaro`.
- `municipioClave`: 5 dígitos, 22001–22018, en todos los reportes y exportaciones.
- Folio: `QRO-<3 dígitos del municipio>-<año>-<consecutivo>` (p. ej. `QRO-016-2026-000001`).

Los polígonos falta validarlos con el C5 o con cada municipio. Ver `../interconexion/ALTA-MUNICIPIO.md`.
