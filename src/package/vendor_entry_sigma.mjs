// Entry for the browser-only vendor bundle (src/lib/sigma.bundle.mjs).
// Sigma references WebGL globals at module scope — never import this bundle
// from code that must load under node (vitest). Renderer-touching modules
// only. Bundled by src/package/vendor_libs.js via esbuild.
export {Sigma, Camera, MouseCaptor} from 'sigma';
export {NodeSquareProgram} from '@sigma/node-square';
export * as nodeImage from '@sigma/node-image';
export * as edgeCurve from '@sigma/edge-curve';
export * as exportImage from '@sigma/export-image';
