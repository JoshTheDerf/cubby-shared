/**
 * CubbyCAD's built-in, Manifold-built shapes. Importing this module registers
 * every one; import order is CubbyCAD's palette order.
 */
export { boxShape } from './box';
export { sphereShape } from './sphere';
export { cylinderShape } from './cylinder';
export { filletShape } from './fillet';
export { capsuleShape } from './capsule';
export { coneShape } from './cone';
export { halfSphereShape } from './halfSphere';
export { halfCylinderShape } from './halfCylinder';
export { polygonShape } from './polygon';
export { pyramidShape } from './pyramid';
export { wedgeShape } from './wedge';
export { roofShape } from './roof';
export { torusShape } from './torus';
export { tubeShape } from './tube';
export { paraboloidShape } from './paraboloid';
export { icosahedronShape } from './icosahedron';
export { starShape } from './star';
export { extrudeStarShape } from './extrudeStar';
export { heartShape } from './heart';
export { diamondShape } from './diamond';
// Non-palette shapes (palette: false).
export { ringShape } from './ring';
export { meshShape } from './mesh';

export { defineShape, getSharedShape, sharedShapes, paletteSharedShapes, isSharedShape } from './registry';
export * from './_helpers';
