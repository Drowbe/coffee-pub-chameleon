# Third-party code in the Maps module

**Audience:** whoever redistributes or audits the Maps module.

Everything here is free for commercial use and redistribution. The libraries are plain files in `src/` with their licence
files kept in `vendor/`; nothing is loaded from outside (the address texts inside the files are named in
`tools/check-no-outside-urls-allow.json`).

| Name | Version | SPDX | File | SHA-256 | Licence file | Source |
|---|---|---|---|---|---|---|
| MapLibre GL JS | 5.24.0 | BSD-3-Clause | `src/maps-lib-a-maplibre.js` | `8b2c6bfadb8cc2d720aea2816ac368e51ab75dbb81ee3fac2f8b97256ebd1585` | `vendor/LICENSE.maplibre-gl` | https://github.com/maplibre/maplibre-gl-js, npm `maplibre-gl@5.24.0` |
| MapLibre GL JS stylesheet | 5.24.0 | BSD-3-Clause | `src/maps-lib-a-maplibre.css` | `ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732` | `vendor/LICENSE.maplibre-gl` | https://github.com/maplibre/maplibre-gl-js, npm `maplibre-gl@5.24.0` |
| PMTiles reader | 4.5.0 | BSD-3-Clause | `src/maps-lib-b-pmtiles.js` | `ca16879182f180bd18648457701ec7106d2159944dca107fd17afc4110c79056` | `vendor/LICENSE.pmtiles` | https://github.com/protomaps/PMTiles, npm `pmtiles@4.5.0` |
| fflate (bundled inside the PMTiles reader) | 0.8.2 | MIT | `src/maps-lib-b-pmtiles.js` | `ca16879182f180bd18648457701ec7106d2159944dca107fd17afc4110c79056` | `vendor/LICENSE.fflate` | https://github.com/101arrowz/fflate, npm `fflate@0.8.2` |

How each file was made: `src/maps-lib-a-maplibre.js` and `.css` are the package's `dist/maplibre-gl.js` and `dist/maplibre-gl.css`;
`src/maps-lib-b-pmtiles.js` is the package's `dist/pmtiles.js`. In the two scripts the only change is the removed last
`sourceMappingURL` comment line. `vendor/LICENSE.maplibre-gl` is the package's `LICENSE.txt` (MapLibre's own BSD 3-clause text, then
the notices of the code MapLibre contains). The `pmtiles` package ships no licence file; `vendor/LICENSE.pmtiles` is the `LICENSE`
of the upstream repository (Copyright 2021 Protomaps LLC, BSD 3-clause), taken from its main branch. `vendor/LICENSE.fflate` is the
`LICENSE` of the `fflate` package.

## Other things the module ships or shows

| Piece | Where | Licence |
|---|---|---|
| Noto Sans Regular and Medium glyphs (Latin, Latin Extended, general punctuation) | `public/maps-glyphs/`, with `OFL.txt` (Copyright 2022 The Noto Project Authors) | SIL Open Font License 1.1 |
| Map data | not shipped; the map shows what the admin's PMTiles file holds (Protomaps builds are made from OpenStreetMap) | ODbL 1.0. The map always shows "© OpenStreetMap contributors", linked to https://www.openstreetmap.org/copyright; no setting hides it |

The About page of the Manage page lists all of these, from `public/credits.json` (`tools/check-credits.mjs` keeps the two in step).
