# Map hover performance

Measured on 2026-09-16 in the Codex Chromium in-app browser at a 618 × 698 viewport, using the default **Projets aidés** view.

## Benchmark

The benchmark runs deterministic `document.elementFromPoint()` calls across the visible map. This measures the browser hit-testing step that determines which SVG shape receives `:hover` and pointer events.

| Metric | Before (`de5bd9e`) | Optimized |
| --- | ---: | ---: |
| Commune SVG paths | 13,733 | 13 (12 color buckets + 1 hover overlay) |
| Seven batches of 100 hit tests | 93, 95, 96, 96, 98, 109, 128 ms | 1, 1, 1, 1, 1, 2, 2 ms |
| Median per hit | 0.96 ms | ≤ 0.01 ms |
| SVG element reduction | — | 1,056× |
| Hit-test latency reduction | — | ≈ 96× (at the 1 ms timer resolution) |

The optimized application-side geographic lookup is grid-indexed and frame-throttled. A real pointer pass over the national project map recorded 0.2 ms of application processing. Building the vector hit index took 146.9 ms once at startup; rendering the project layer took 23.1 ms. The 34,875-commune budget view also renders as 13 SVG elements and took 63.7 ms.

## Architecture change

The map still uses the exact commune polygons. Display polygons are grouped into 12 color buckets, so the browser paints a handful of SVG paths instead of thousands of interactive nodes. A spatial grid and cached `Path2D` geometry identify the commune under the pointer, while one lightweight overlay draws the active hover or selection outline.
