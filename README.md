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

## Use it

```bash
npm install github:JoshTheDerf/cubby-shared
```

`three`, `vue` and `three-viewport-gizmo` (for the view cube) are optional peer dependencies. If you link this package from a sibling checkout, add `resolve: { dedupe: ['three', 'vue', 'three-viewport-gizmo'] }` to the app's Vite config so there's one copy of each.

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
