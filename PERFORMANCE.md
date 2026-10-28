# Map performance

## October 2026 – GPU map

The SVG map (12 giant colour-bucket paths, CSS-scaled during zoom then re-rasterised) was replaced by MapLibre GL 4.7.1, vendored in `dist/vendor/`.

- Zoom and pan are rendered by WebGL at display rate; geometry is tiled and simplified per zoom level in a web worker, so wheel/trackpad zoom no longer stalls on SVG re-rasterisation or snaps from a blurry to a sharp image.
- Territory colours are applied with `setFeatureState` (≈35 000 communes, ~50 ms once per view change) rather than rebuilding SVG paths.
- Hover and click use `queryRenderedFeatures`, throttled to one lookup per animation frame.

## Payload

Initial map data before → after (uncompressed):

| File | Before | After |
| --- | ---: | ---: |
| Commune contours (1 km) | `communes.geojson` 10.0 MB | `web/communes.json` 3.1 MB |
| Commune metadata | `budgets-2025.json` 9.0 MB | `web/communes-meta.json` 1.6 MB |
| Projects | `projects-2025.json` 5.7 MB | `web/projects-2025.json` 2.3 MB |
| Detailed commune contours (all departments) | 58 MB | 24 MB |

Geometry is stored as integer deltas at the source precision (lossless) and decoded in the page. The national accounts JSON is only fetched when its section approaches the viewport, so the map data gets the network first.
