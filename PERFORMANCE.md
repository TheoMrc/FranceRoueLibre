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

## Zoom and territory-to-territory navigation

Measured on the same 618 × 698 viewport after selecting Audenge, then clicking a neighbouring commune.

| Metric | Before | Map-first build |
| --- | ---: | ---: |
| Zoom animation callback rate | 10.6–13.5 frames/s | 95.1–155.5 frames/s |
| Commune layer rebuild on a neighbouring selection | ~60 ms plus full SVG invalidation | 0.00 ms |
| Active metropolitan commune geometries | 34,746 | 34,746 |
| Pointer lookup while zoomed | — | 0.5 ms |

The camera now animates the SVG viewport as one composited CSS layer. The twelve commune color buckets stay cached when only the selected commune changes; only the lightweight selection outline is updated. Out-of-frame overseas geometry is omitted from the national animation layer and is loaded again for an explicit search, region filter, or overseas selection. Wheel and touchpad input is handled inside the map and updates the camera without scrolling the page.
