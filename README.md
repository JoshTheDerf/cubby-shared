# @cubby/shared

Code shared by the [CubbyCAD editor](https://cubbycad.com/editor) and [Cubby Slicer](https://github.com/JoshTheDerf/cubbyslicer). It's TypeScript source with no build step, so the apps' Vite and vue-tsc compile it directly.

| Import | What it is |
| --- | --- |
| `@cubby/shared/history` | Undo/redo: an operation stack with apply/unapply, same-key coalescing inside a 1 s window, gesture boundaries (`finalizeActiveTransform`), a mutation hook for dirty tracking and optional camera stamping per entry. |
| `@cubby/shared/gizmo` | CubbyCAD's move / rotate / scale gizmo: scale handles, floor move, lift cone, rotation arcs with a dial, editable size labels. `EditGizmo` is the editor's Y-up class; `TransformGizmo` wraps it for any three.js host with object, multi-object or matrix targets, `up: 'z'`, per-mode handles, snapping, a pointer hit test and drag-start / change / drag-end events. Also the touch-scale, haptics, pick-ray and colour helpers it uses. |
| `@cubby/shared/snap` | Grid snap: the `SNAP_OPTIONS` steps (10 mm to 0.1 mm, or off), `snap()`, the 15° rotation step, labels and `SnapSetting`, a small persisted holder for the current increment. The gizmo and keyboard nudges read the same increment. |
| `@cubby/shared/nudge` | Keyboard moves: `nudgeDelta` maps an arrow key to a world move (camera-relative or fixed axes, Y-up or Z-up, Shift+Up/Down vertical if wanted), `nudgeStep` ties the step to the grid snap, and `NudgeBurst` seals a run of nudges as one undo step once the keys go idle. |
| `@cubby/shared/camera` | Viewport camera: `CameraProjection` (a perspective and orthographic pair with a switch that keeps the view and, optionally, its scale), the themed `ViewCube` for Y-up or Z-up worlds, `viewCubeThemeOptions` palettes and `ViewportCameraRig` (renderer, cameras, orbit, cube, resize and loop in one). |
| `@cubby/shared/actions` | The action registry: action and key-binding types, `createActionRegistry`, `formatBinding` (Ctrl+Shift+Z, or ⌘⇧Z on macOS) and `bindingMatchesKey`. Each app keeps its own dispatcher policy. |
| `@cubby/shared/bridge` | The browser half of the Claude Code bridge: `BridgeClient` connects a tab to the local cubby-mcp server on 127.0.0.1, pairs with a one-time code, keeps the token per origin and answers tool calls. `@cubby/shared/bridge/protocol` is the wire format and pairing/origin helpers, shared with the server. |
| `@cubby/shared/cad` | CubbyCAD's modelling core: the `.cubby` node and scene types, every built-in Manifold-built shape (box … diamond, ring, baked `mesh`) with its defaults, property schema, English labels and i18n keys, `evaluateCadNode` (a node tree to one mesh, with CubbyCAD's manifold-group rules: ordered unions, expanded holes, hidden parts skipped, per-part colours, optional Z-up output and per-triangle source ids), `cadSupport` (which subtrees only CubbyCAD can build: SDF/loft/skin groups, modifiers, sculpt, script parts), `hashCadNode`, pure tree operations (create, find, group / ungroup with CubbyCAD's transform baking, holes, unique names, immutable updates), three-free matrix math, the inline mesh codec, default colours and the SDF primitives. You pass in the Manifold module. |
| `@cubby/shared/cad/manifold` | Manifold helpers: component-split mesh ingest with tolerance-weld repair, status checks, numProp-6 (position + RGB) mesh data, hole expansion, float32-safe export and `runCsgBatch`, the group boolean program CubbyCAD's manifold worker runs. |
| `@cubby/shared/cad/ui` | Vue + Nuxt UI components for editing shapes: `NumberSlider` (scrub-or-type number field), `ShapeParamsForm` (a shape's property form from its schema, with per-field slots) and `ShapePalette` (the shape grid). Pass a `translate` function or `provideCadTranslate(t)`; without one they use English. |

## Use it

```bash
npm install github:JoshTheDerf/cubby-shared
```

`three`, `vue`, `three-viewport-gizmo` (for the view cube), `manifold-3d` (for `cad`, which takes the initialised module as an argument) and `@nuxt/ui` (for `cad/ui`) are optional peer dependencies. If you link this package from a sibling checkout, add `resolve: { dedupe: ['three', 'vue', 'three-viewport-gizmo', '@nuxt/ui'] }` to the app's Vite config so there's one copy of each. The `cad/ui` components use Tailwind classes: add `@source "../node_modules/@cubby/shared/src/cad/ui";` (relative to your CSS entry) so Tailwind generates them.

To work on it next to an app:

```bash
git clone git@github.com:JoshTheDerf/cubby-shared.git ../cubby-shared
npm link ../cubby-shared
```

## Develop

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
