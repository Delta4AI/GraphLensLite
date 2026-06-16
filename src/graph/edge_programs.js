/**
 * Custom WebGL edge programs (browser-only — imports the sigma bundle, must
 * never be loaded under node/vitest).
 *
 * Three building blocks, composed into the "styledLine"/"styledCurve"
 * registry entries by sigma_adapter.buildProgramRegistry:
 *
 *  - EdgeHaloProgram: a wider quad UNDER the straight edge body reading the
 *    per-edge `haloWidth`/`haloColor` attrs (graph_model). haloWidth 0
 *    collapses the quad in the vertex shader → zero fragments, so disabled
 *    halos cost (almost) nothing. Total halo width = edge size + 2×haloWidth,
 *    computed from the POST-reducer size so selection-widening widens the
 *    halo with the line.
 *
 *  - createCurveHaloProgram(CurveProgram): same underdraw for @sigma/edge-curve
 *    edges, by re-processing the curve program with substituted size/color.
 *    The curve shader clamps thickness up to minEdgeThickness, so "off" is a
 *    hairline fully-transparent band instead of a degenerate quad.
 *
 *  - createEdgeMarkerHeadProgram({extremity, curved}): parametric end-marker
 *    head. ONE program draws every marker shape — a per-edge float enum
 *    (`startMarker`/`endMarker`, see EDGE_MARKERS in graph_model.js) selects
 *    the SDF in the fragment shader (arrow/rect/diamond/circle/tee), and
 *    `startMarkerSize`/`endMarkerSize` give an explicit length in graph px
 *    (0 → proportional to edge thickness, sigma stock-arrow ratios). The
 *    curved variant orients the head along the quadratic-bezier tangent that
 *    @sigma/edge-curve renders (control point = midpoint + perp(delta) ×
 *    curvature — the graph→viewport map is a similarity transform, so the
 *    graph-space construction matches the shader's viewport-space one).
 */
import { EdgeProgram, EdgeRectangleProgram, floatColor } from "../lib/sigma.bundle.mjs";

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;

// Mirrors @sigma/edge-curve DEFAULT_EDGE_CURVATURE (the app sets no per-edge
// curvature, so every curved edge renders with this value).
const DEFAULT_EDGE_CURVATURE = 0.25;

const TRANSPARENT = "#00000000";

// ---------------------------------------------------------------------------
// Straight-edge halo: EdgeRectangleProgram clone whose thickness/color come
// from the halo attrs. The vertex shader is sigma's edge.vert.glsl with two
// changes: a zero-normal guard that collapses disabled halos to a zero-area
// off-screen triangle, and NO minEdgeThickness clamp (the clamp would
// resurrect a zero-width halo as a minThickness-wide quad).
// ---------------------------------------------------------------------------

// language=GLSL
const HALO_VERTEX_SHADER = /*glsl*/ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_zoomRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const float bias = 255.0 / 254.0;

void main() {
  vec2 normal = a_normal * a_normalCoef;
  float normalLength = length(normal);

  if (normalLength <= 0.0) {
    // Halo disabled: zero-area triangle off-screen -> no fragments.
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    v_color = vec4(0.0);
    v_normal = vec2(0.0);
    v_thickness = 1.0;
    v_feather = 1.0;
    return;
  }

  vec2 unitNormal = normal / normalLength;
  float webGLThickness = normalLength * u_correctionRatio / u_sizeRatio;

  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;
  v_normal = unitNormal;
  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

// language=GLSL
const HALO_FRAGMENT_SHADER = /*glsl*/ `
precision mediump float;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float dist = length(v_normal) * v_thickness;
  float t = smoothstep(v_thickness - v_feather, v_thickness, dist);
  gl_FragColor = mix(v_color, transparent, t);
  #endif
}
`;

class EdgeHaloProgram extends EdgeRectangleProgram {
  getDefinition() {
    return {
      ...super.getDefinition(),
      VERTEX_SHADER_SOURCE: HALO_VERTEX_SHADER,
      FRAGMENT_SHADER_SOURCE: HALO_FRAGMENT_SHADER,
    };
  }

  processVisibleItem(edgeIndex, startIndex, sourceData, targetData, data) {
    const haloWidth = data.haloWidth > 0 ? data.haloWidth : 0;
    // Post-reducer size: a selected (widened) edge widens its halo too.
    const thickness = haloWidth > 0 ? (data.size || 1) + 2 * haloWidth : 0;
    const color = floatColor(haloWidth > 0 ? (data.haloColor ?? data.color) : TRANSPARENT);

    const x1 = sourceData.x;
    const y1 = sourceData.y;
    const x2 = targetData.x;
    const y2 = targetData.y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    let len = dx * dx + dy * dy;
    let n1 = 0;
    let n2 = 0;
    if (len && thickness > 0) {
      len = 1 / Math.sqrt(len);
      n1 = -dy * len * thickness;
      n2 = dx * len * thickness;
    }

    const array = this.array;
    array[startIndex++] = x1;
    array[startIndex++] = y1;
    array[startIndex++] = x2;
    array[startIndex++] = y2;
    array[startIndex++] = n1;
    array[startIndex++] = n2;
    array[startIndex++] = color;
    array[startIndex++] = edgeIndex;
  }
}

// ---------------------------------------------------------------------------
// Curved-edge halo: re-process the curve program with halo size/color.
// ---------------------------------------------------------------------------

/** @param {typeof EdgeProgram} CurveProgramClass  a created @sigma/edge-curve program class */
function createCurveHaloProgram(CurveProgramClass) {
  return class CurveHaloProgram extends CurveProgramClass {
    processVisibleItem(edgeIndex, startIndex, sourceData, targetData, data) {
      const haloWidth = data.haloWidth > 0 ? data.haloWidth : 0;
      // The curve shader clamps thickness up to minEdgeThickness, so a zero
      // size cannot fully disable it — pair a hairline size with a fully
      // transparent color instead (fragments blend to nothing).
      const size = haloWidth > 0 ? (data.size || 1) + 2 * haloWidth : 0.001;
      const color = haloWidth > 0 ? (data.haloColor ?? data.color) : TRANSPARENT;
      super.processVisibleItem(edgeIndex, startIndex, sourceData, targetData, {
        ...data,
        size,
        color,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Parametric marker head.
//
// Geometry: a quad anchored at the marked node's border, extending `length`
// back along the edge (straight) or along the bezier tangent (curved), tip
// side at the node. a_corner ∈ {-1,1}×{0,1} spans it as two triangles.
// All lengths are computed in graph px and converted with sigma's stock
// arrow-head convention (px → pre-matrix units = ×2·correctionRatio/sizeRatio).
// Default (markerSize 0) proportions match sigma's arrow: length 2.5×, full
// width 2× the edge thickness.
// ---------------------------------------------------------------------------

// language=GLSL
const MARKER_VERTEX_SHADER = /*glsl*/ `
attribute vec2 a_position;
attribute vec2 a_normal;
attribute float a_radius;
attribute float a_marker;
attribute float a_markerSize;
attribute float a_borderSize;
attribute vec2 a_corner;

#ifdef PICKING_MODE
attribute vec4 a_id;
#else
attribute vec4 a_color;
attribute vec4 a_borderColor;
#endif

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying vec4 v_borderColor;
varying float v_marker;
varying vec2 v_uv;
varying vec2 v_dimPx;
varying float v_borderSizePx;
varying float v_feather;

const float bias = 255.0 / 254.0;
const float lengthToThicknessRatio = 2.5;
const float widenessToThicknessRatio = 2.0;

void main() {
  float normalLength = length(a_normal);

  if (a_marker < 0.5 || normalLength <= 0.0) {
    // No marker on this end: zero-area triangle off-screen -> no fragments.
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    v_color = vec4(0.0);
    v_borderColor = vec4(0.0);
    v_marker = 0.0;
    v_uv = vec2(0.0);
    v_dimPx = vec2(1.0);
    v_borderSizePx = 0.0;
    v_feather = 1.0;
    return;
  }

  vec2 unitNormal = a_normal / normalLength;
  // a_normal = perp(unitAway): recover the direction pointing from the node
  // center back along the edge.
  vec2 unitAway = vec2(unitNormal.y, -unitNormal.x);

  // Graph-px sizing (normalLength carries the edge thickness).
  float thickness = max(normalLength, u_minEdgeThickness * u_sizeRatio);
  float len = a_markerSize > 0.0 ? a_markerSize : thickness * lengthToThicknessRatio;
  float halfWidth = a_markerSize > 0.0
    ? a_markerSize * 0.5
    : thickness * widenessToThicknessRatio * 0.5;

  float toWebGL = 2.0 * u_correctionRatio / u_sizeRatio;
  vec2 pos = a_position
    + unitAway * (a_radius + a_corner.y * len) * toWebGL
    + unitNormal * (a_corner.x * halfWidth) * toWebGL;

  gl_Position = vec4((u_matrix * vec3(pos, 1)).xy, 0, 1);

  v_uv = a_corner;
  v_dimPx = vec2(2.0 * halfWidth, len) / u_sizeRatio;
  // Explicit border thickness (graph px → screen px); 0 lets the fragment derive it.
  v_borderSizePx = a_borderSize > 0.0 ? a_borderSize / u_sizeRatio : 0.0;
  v_marker = a_marker;
  v_feather = u_feather;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  v_borderColor = a_borderColor;
  v_borderColor.a *= bias;
  #endif

  v_color.a *= bias;
}
`;

// language=GLSL
const MARKER_FRAGMENT_SHADER = /*glsl*/ `
precision mediump float;

varying vec4 v_color;
varying vec4 v_borderColor;
varying float v_marker;
varying vec2 v_uv;
varying vec2 v_dimPx;
varying float v_borderSizePx;
varying float v_feather;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
// Auto border band thickness as a fraction of the marker's smaller dimension;
// used when no explicit border size is set, so the outline scales with the
// marker and reads the same at any size/zoom.
const float borderFraction = 0.2;

void main(void) {
  float w = v_dimPx.x;            // full width across the edge (screen px)
  float l = v_dimPx.y;            // length along the edge; y=0 at the node border
  float x = abs(v_uv.x) * w * 0.5;
  float y = v_uv.y * l;
  float d = 0.0;                  // approx signed distance (px), positive inside

  if (v_marker < 1.5) {
    // arrow: triangle, tip at the node border, base toward the line
    d = min(y * 0.5 * w / l - x, l - y);
  } else if (v_marker < 2.5) {
    // rect
    d = min(w * 0.5 - x, min(y, l - y));
  } else if (v_marker < 3.5) {
    // diamond
    float norm = x / (w * 0.5) + abs(y - l * 0.5) / (l * 0.5);
    d = (1.0 - norm) * 0.25 * min(w, l);
  } else if (v_marker < 4.5) {
    // circle
    d = 0.5 * min(w, l) - length(vec2(x, y - l * 0.5));
  } else {
    // tee: inhibition bar (⊣) hugging the node border
    float barLen = max(l * 0.3, 1.5);
    d = min(min(y, barLen - y), w * 0.5 - x);
  }

  #ifdef PICKING_MODE
  gl_FragColor = d >= 0.0 ? v_color : transparent;
  #else
  float feather = max(v_feather, 0.001);
  float coverage = smoothstep(-feather * 0.5, feather * 0.5, d);   // 0 outside -> 1 inside
  float borderPx = v_borderSizePx > 0.0 ? v_borderSizePx : min(v_dimPx.x, v_dimPx.y) * borderFraction;
  // fillMix: 0 inside the border band (near the edge), 1 in the interior.
  float fillMix = smoothstep(borderPx - feather * 0.5, borderPx + feather * 0.5, d);
  // No border color (alpha ~0) -> the whole marker uses the fill color.
  fillMix = max(fillMix, 1.0 - step(0.0039, v_borderColor.a));
  vec4 body = mix(v_borderColor, v_color, fillMix);
  gl_FragColor = mix(transparent, body, coverage);
  #endif
}
`;

/**
 * @param {object} [options]
 * @param {"source"|"target"} [options.extremity]
 * @param {boolean} [options.curved]  orient along the @sigma/edge-curve tangent
 * @returns {typeof EdgeProgram}
 */
function createEdgeMarkerHeadProgram({ extremity = "target", curved = false } = {}) {
  const isSource = extremity === "source";

  return class EdgeMarkerHeadProgram extends EdgeProgram {
    getDefinition() {
      return {
        VERTICES: 6,
        VERTEX_SHADER_SOURCE: MARKER_VERTEX_SHADER,
        FRAGMENT_SHADER_SOURCE: MARKER_FRAGMENT_SHADER,
        METHOD: WebGLRenderingContext.TRIANGLES,
        UNIFORMS: ["u_matrix", "u_sizeRatio", "u_correctionRatio", "u_minEdgeThickness", "u_feather"],
        ATTRIBUTES: [
          { name: "a_position", size: 2, type: FLOAT },
          { name: "a_normal", size: 2, type: FLOAT },
          { name: "a_radius", size: 1, type: FLOAT },
          { name: "a_marker", size: 1, type: FLOAT },
          { name: "a_markerSize", size: 1, type: FLOAT },
          { name: "a_borderSize", size: 1, type: FLOAT },
          { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_borderColor", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
        ],
        CONSTANT_ATTRIBUTES: [{ name: "a_corner", size: 2, type: FLOAT }],
        CONSTANT_DATA: [
          [-1, 0],
          [1, 0],
          [1, 1],
          [-1, 0],
          [1, 1],
          [-1, 1],
        ],
      };
    }

    processVisibleItem(edgeIndex, startIndex, sourceData, targetData, data) {
      const marked = isSource ? sourceData : targetData;
      const marker = (isSource ? data.startMarker : data.endMarker) || 0;
      const markerSize = (isSource ? data.startMarkerSize : data.endMarkerSize) || 0;
      const borderSize = (isSource ? data.startMarkerBorderSize : data.endMarkerBorderSize) || 0;
      const thickness = data.size || 1;
      // Explicit arrow fill wins; null inherits the edge color. Border null -> none.
      const fillColor = (isSource ? data.startMarkerColor : data.endMarkerColor) ?? data.color;
      const borderColor = (isSource ? data.startMarkerBorderColor : data.endMarkerBorderColor) ?? TRANSPARENT;

      // Direction from the marked node back along the edge.
      let awayX;
      let awayY;
      if (curved) {
        const curvature = data.curvature ?? DEFAULT_EDGE_CURVATURE;
        const dx = targetData.x - sourceData.x;
        const dy = targetData.y - sourceData.y;
        // Quadratic control point as @sigma/edge-curve constructs it.
        const cpX = (sourceData.x + targetData.x) / 2 - dy * curvature;
        const cpY = (sourceData.y + targetData.y) / 2 + dx * curvature;
        awayX = cpX - marked.x;
        awayY = cpY - marked.y;
      } else {
        const other = isSource ? targetData : sourceData;
        awayX = other.x - marked.x;
        awayY = other.y - marked.y;
      }

      const len = Math.sqrt(awayX * awayX + awayY * awayY);
      let n1 = 0;
      let n2 = 0;
      if (len > 0) {
        // a_normal = perp(unitAway) × thickness (the shader recovers both axes).
        n1 = (-awayY / len) * thickness;
        n2 = (awayX / len) * thickness;
      }

      const array = this.array;
      array[startIndex++] = marked.x;
      array[startIndex++] = marked.y;
      array[startIndex++] = n1;
      array[startIndex++] = n2;
      array[startIndex++] = marked.size || 1;
      array[startIndex++] = marker;
      array[startIndex++] = markerSize;
      array[startIndex++] = borderSize;
      array[startIndex++] = floatColor(fillColor);
      array[startIndex++] = floatColor(borderColor);
      array[startIndex++] = edgeIndex;
    }

    setUniforms(params, { gl, uniformLocations }) {
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
      gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
      gl.uniform1f(uniformLocations.u_minEdgeThickness, params.minEdgeThickness);
      gl.uniform1f(uniformLocations.u_feather, params.antiAliasingFeather);
    }
  };
}

export { EdgeHaloProgram, createCurveHaloProgram, createEdgeMarkerHeadProgram };
