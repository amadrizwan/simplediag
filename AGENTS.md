# Repository Guidance

- `plantuml/` is reference-only material. Do not copy Java source, GPL headers, author banners, or implementation text into `packages/simplediag/`.
- New package code lives in `packages/simplediag/`.
- Keep the implementation layered: parser -> resolver -> layout -> renderer.
- Layout code must not touch DOM APIs or produce SVG strings.
- Renderer code must consume `LayoutResult` and return SVG strings without DOM APIs.
- Runtime package code must avoid Node-only APIs so the library works in ESM-capable browsers.
