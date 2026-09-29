/**
 * @cubby/shared/camera — viewport camera pieces shared by CubbyCAD and Cubby
 * Slicer: the perspective / orthographic pair with a pose-preserving switch
 * (`CameraProjection`), the themed view cube (`ViewCube`, Y-up or Z-up), its
 * palettes (`viewCubeThemeOptions`), and the self-contained
 * `ViewportCameraRig` (renderer + cameras + orbit + cube + resize + loop).
 */
export { CameraProjection } from './projection';
export type { AnyCamera, CameraProjectionOptions, CameraType, OrbitLike } from './projection';
export { ViewCube } from './viewCube';
export type { ViewCubeOptions } from './viewCube';
export {
  AXIS_CUBE_FACES,
  CUBBY_CUBE_PALETTES,
  VIEW_CUBE_FACES,
  Z_UP_FACE_LABELS,
  viewCubeThemeOptions,
} from './viewCubeTheme';
export type { AxisCubeFace, CubePalette, CubePalettes, ViewCubeThemeOptions } from './viewCubeTheme';
export { ViewportCameraRig } from './ViewportCameraRig';
export type { ViewportCameraRigOptions } from './ViewportCameraRig';
