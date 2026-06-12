/**
 * Animated edge-flow overlay program (browser-only — imports the sigma
 * bundle, must never be loaded under node/vitest).
 *
 * EdgeFlowProgram draws a moving source→target pattern OVER the straight
 * edge body (composed into "styledLine" after EdgeRectangleProgram, before
 * the marker heads — see sigma_adapter.buildProgramRegistry). Two patterns,
 * selected by the per-edge `flowMode` float attr (FLOW_MODES in
 * graph_model.js): marching dashes (1) or travelling pulse dots (2);
 * 0 collapses the quad in the vertex shader → zero fragments, so edges
 * without flow cost (almost) nothing, same trick as the halo program.
 *
 * Animation: the programs are stateless — FlowAnimator advances the module
 * `flowClock` and triggers redraw-only refreshes; setUniforms re-reads the
 * clock each frame (buffers untouched).
 *
 * Curved edges get the same overlay from createCurveFlowProgram, a
 * @sigma/edge-curve subclass whose shaders are forked by the string patchers
 * in edge_flow_glsl.js (composed into "styledCurve" the same way). The
 * patchers throw on GLSL anchor drift — buildProgramRegistry catches and
 * degrades to non-animated curves.
 */
import { EdgeRectangleProgram, floatColor } from "../lib/sigma.bundle.mjs";
import { patchCurveFragmentForFlow, patchCurveVertexForFlow } from "./edge_flow_glsl.js";

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;

const TRANSPARENT = "#00000000";

/**
 * Module-level animation clock (seconds). FlowAnimator owns advancing it
 * (and zeroes it in destroy()); every EdgeFlowProgram instance reads it in
 * setUniforms as u_time. Wrapped by the animator (see TIME_WRAP_S there) so
 * the shader's fract() never sees float-precision decay on long sessions.
 * A single shared clock assumes one live SigmaAdapter at a time (the app's
 * invariant) — concurrent adapters would tick each other's patterns, nothing
 * worse.
 */
const flowClock = { time: 0 };

// ---------------------------------------------------------------------------
// Straight-edge flow: EdgeRectangleProgram clone drawing the animated pattern
// with the flow color at the body's own thickness. The vertex shader is the
// halo vertex shader (sigma's edge.vert.glsl + zero-normal collapse guard, NO
// minEdgeThickness clamp — the clamp would resurrect a disabled overlay as a
// minThickness-wide quad) extended with the along-the-edge phase varying.
//
// Pattern geometry is computed in SCREEN px so dash spacing/dot size are
// zoom-stable: a_edgeLength is the graph-coordinate endpoint distance, and
// graph-coordinate length → screen px is length / (2 × u_correctionRatio)
// (inverse of the px → pre-matrix convention the halo/marker shaders use:
// px × 2 × correctionRatio / sizeRatio pre-matrix ≙ px / sizeRatio screen px,
// and correctionRatio = 1 / (matrix scale × viewport width)).
//
// The time term is folded into the phase PER EDGE in the vertex shader
// (fract of whole periods travelled — constant across the quad, so the
// varying stays linear in a_positionCoef and small enough for mediump
// fragments). phase = alongPx/period − travelled ⇒ a fixed pattern feature
// satisfies alongPx = const + t·speed ⇒ it moves from positionCoef 0 (source)
// toward 1 (target).
// ---------------------------------------------------------------------------

// language=GLSL
const FLOW_VERTEX_SHADER = /*glsl*/ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
attribute float a_edgeLength;
attribute float a_flow;
attribute float a_flowSpeed;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_zoomRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;
uniform float u_time;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_flow;
varying float v_phase;

const float bias = 255.0 / 254.0;
// Base flow velocity in screen px per second (× per-edge a_flowSpeed).
const float SPEED_PX_PER_S = 40.0;
// Pattern periods — must stay equal to the same constants in the FRAGMENT
// shader (GLSL stages can't share consts; both fold px into period units)
// AND to FLOW_PATTERN_CONSTANTS in edge_flow_glsl.js (the curve overlay
// animates side by side with this one).
const float DASH_PERIOD_PX = 16.0;
const float PULSE_PERIOD_PX = 48.0;

void main() {
  vec2 normal = a_normal * a_normalCoef;
  float normalLength = length(normal);

  if (normalLength <= 0.0) {
    // Flow disabled: zero-area triangle off-screen -> no fragments.
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    v_color = vec4(0.0);
    v_normal = vec2(0.0);
    v_thickness = 1.0;
    v_feather = 1.0;
    v_flow = 0.0;
    v_phase = 0.0;
    return;
  }

  vec2 unitNormal = normal / normalLength;
  float webGLThickness = normalLength * u_correctionRatio / u_sizeRatio;

  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;
  v_normal = unitNormal;
  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;
  v_flow = a_flow;

  // Phase in pattern periods: along-the-edge screen px / period, minus the
  // periods travelled so far (fract'd per edge here in highp; the fragment's
  // mediump fract then only ever sees |phase| ≲ edge length / period).
  float periodPx = a_flow < 1.5 ? DASH_PERIOD_PX : PULSE_PERIOD_PX;
  float alongPx = a_positionCoef * a_edgeLength / (2.0 * u_correctionRatio);
  float travelled = fract(u_time * a_flowSpeed * SPEED_PX_PER_S / periodPx);
  v_phase = alongPx / periodPx - travelled;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

// language=GLSL
const FLOW_FRAGMENT_SHADER = /*glsl*/ `
precision mediump float;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_flow;
varying float v_phase;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
// ALL pattern constants below must stay equal to the VERTEX shader's copies
// and to FLOW_PATTERN_CONSTANTS in edge_flow_glsl.js (curve overlay).
const float DASH_PERIOD_PX = 16.0;
const float DASH_DUTY = 0.5;
const float PULSE_PERIOD_PX = 48.0;
// Pulse dot half-length along the edge (≈6 px dot at default zoom).
const float DOT_RADIUS_PX = 3.0;
// Dash-end smoothing in screen px (the cross-section reuses v_feather).
const float DASH_AA_PX = 1.0;

void main(void) {
  #ifdef PICKING_MODE
  // Whole quad picks the edge id — the body program already draws this exact
  // quad with this exact id in the picking pass, so coverage is unchanged.
  gl_FragColor = v_color;
  #else
  // Cross-section anti-alias feathering, identical to the halo/body edge.
  float dist = length(v_normal) * v_thickness;
  float crossSection = 1.0 - smoothstep(v_thickness - v_feather, v_thickness, dist);

  float f = fract(v_phase);
  float alpha;
  if (v_flow < 1.5) {
    // Dash: filled for f ∈ [0, duty), ends feathered in phase units so the
    // marching segments aren't aliased along the edge.
    float aa = DASH_AA_PX / DASH_PERIOD_PX;
    float d = min(f, DASH_DUTY - f); // signed distance to the dash band edge
    alpha = smoothstep(-0.5 * aa, 0.5 * aa, d);
  } else {
    // Pulse: circular-ish dot — along-distance normalized to the dot radius,
    // cross-distance to the half-thickness, soft radial falloff.
    vec2 q = vec2((f - 0.5) * PULSE_PERIOD_PX / DOT_RADIUS_PX, length(v_normal));
    alpha = 1.0 - smoothstep(0.8, 1.0, length(q));
  }

  gl_FragColor = mix(transparent, v_color, alpha * crossSection);
  #endif
}
`;

class EdgeFlowProgram extends EdgeRectangleProgram {
  getDefinition() {
    const definition = super.getDefinition();
    return {
      ...definition,
      VERTEX_SHADER_SOURCE: FLOW_VERTEX_SHADER,
      FRAGMENT_SHADER_SOURCE: FLOW_FRAGMENT_SHADER,
      UNIFORMS: [...definition.UNIFORMS, "u_time"],
      ATTRIBUTES: [
        { name: "a_positionStart", size: 2, type: FLOAT },
        { name: "a_positionEnd", size: 2, type: FLOAT },
        { name: "a_normal", size: 2, type: FLOAT },
        { name: "a_edgeLength", size: 1, type: FLOAT },
        { name: "a_flow", size: 1, type: FLOAT },
        { name: "a_flowSpeed", size: 1, type: FLOAT },
        ...definition.ATTRIBUTES.filter(({ name }) => name === "a_color" || name === "a_id"),
      ],
    };
  }

  processVisibleItem(edgeIndex, startIndex, sourceData, targetData, data) {
    const flowMode = data.flowMode > 0 ? data.flowMode : 0;
    // Post-reducer size: the overlay matches the body width, so a selected
    // (widened) edge widens its flow pattern with the line.
    const thickness = flowMode > 0 ? data.size || 1 : 0;
    const color = floatColor(flowMode > 0 ? (data.flowColor ?? data.color) : TRANSPARENT);

    const x1 = sourceData.x;
    const y1 = sourceData.y;
    const x2 = targetData.x;
    const y2 = targetData.y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    let edgeLength = 0;
    let n1 = 0;
    let n2 = 0;
    const len = dx * dx + dy * dy;
    if (len && thickness > 0) {
      edgeLength = Math.sqrt(len);
      n1 = (-dy / edgeLength) * thickness;
      n2 = (dx / edgeLength) * thickness;
    }

    const array = this.array;
    array[startIndex++] = x1;
    array[startIndex++] = y1;
    array[startIndex++] = x2;
    array[startIndex++] = y2;
    array[startIndex++] = n1;
    array[startIndex++] = n2;
    array[startIndex++] = edgeLength;
    array[startIndex++] = flowMode;
    array[startIndex++] = data.flowSpeed || 0;
    array[startIndex++] = color;
    array[startIndex++] = edgeIndex;
  }

  setUniforms(params, programInfo) {
    super.setUniforms(params, programInfo);
    programInfo.gl.uniform1f(programInfo.uniformLocations.u_time, flowClock.time);
  }
}

// ---------------------------------------------------------------------------
// Curved-edge flow: @sigma/edge-curve subclass whose shaders are forked by
// the edge_flow_glsl.js string patchers (out-param t from the bezier distance
// function × a projected arc-length varying drive the same dash/pulse masks).
// The flow color rides the parent's a_color slot (CPU-side substitution, like
// the curve halo); only a_flow/a_flowSpeed are appended after the parent's
// attributes.
// ---------------------------------------------------------------------------

/**
 * Floats one edge occupies in an instanced program's array (sigma's
 * getAttributesItemsCount convention): FLOAT attrs contribute their size,
 * UNSIGNED_BYTE×4-normalized color/id attrs pack into a single float slot.
 *
 * With arrowHead: null the parent layout is a_source:2 a_target:2
 * a_thickness:1 a_curvature:1 a_color:1 a_id:1 = 8 floats — cross-check
 * against the bundle after a sigma upgrade.
 *
 * @param {Array<{name: string, size: number, type: number, normalized?: boolean}>} attributes
 * @returns {number}
 * @throws {Error} on an attribute layout this convention doesn't cover
 *   (caught by buildProgramRegistry's fallback, like the GLSL anchors)
 */
function attributeFloatCount(attributes) {
  return attributes.reduce((count, { name, size, type, normalized }) => {
    if (type === FLOAT) return count + size;
    if (type === UNSIGNED_BYTE && normalized && size === 4) return count + 1;
    throw new Error(`edge_flow_programs: unsupported attribute layout for "${name}"`);
  }, 0);
}

/**
 * Build the curve flow sub-program for the "styledCurve" compound. Patches
 * the parent's GLSL EAGERLY, so anchor drift after a sigma upgrade throws
 * HERE (where buildProgramRegistry can catch it and drop the sub-program)
 * instead of later inside sigma's render loop.
 *
 * @param {typeof EdgeRectangleProgram} CurveProgramClass  a created @sigma/edge-curve program class
 * @returns {typeof EdgeRectangleProgram}
 * @throws {Error} when the bundled curve GLSL no longer matches the patchers' anchors
 */
function createCurveFlowProgram(CurveProgramClass) {
  // The created curve program's getDefinition is closure-pure (no `this`);
  // a bare prototype-derived receiver keeps this honest if that changes.
  const parentDefinition = CurveProgramClass.prototype.getDefinition.call(
    Object.create(CurveProgramClass.prototype),
  );
  const vertexSource = patchCurveVertexForFlow(parentDefinition.VERTEX_SHADER_SOURCE);
  const fragmentSource = patchCurveFragmentForFlow(parentDefinition.FRAGMENT_SHADER_SOURCE);
  // a_flow/a_flowSpeed live right after the parent's per-edge floats.
  const parentStrideFloats = attributeFloatCount(parentDefinition.ATTRIBUTES);

  return class CurveFlowProgram extends CurveProgramClass {
    getDefinition() {
      const definition = super.getDefinition();
      return {
        ...definition,
        VERTEX_SHADER_SOURCE: vertexSource,
        FRAGMENT_SHADER_SOURCE: fragmentSource,
        UNIFORMS: [...definition.UNIFORMS, "u_time"],
        ATTRIBUTES: [
          ...definition.ATTRIBUTES,
          { name: "a_flow", size: 1, type: FLOAT },
          { name: "a_flowSpeed", size: 1, type: FLOAT },
        ],
      };
    }

    processVisibleItem(edgeIndex, startIndex, sourceData, targetData, data) {
      const flowMode = data.flowMode > 0 ? data.flowMode : 0;
      // Flow color rides the parent's color slot; size stays the body's
      // (post-reducer) size so the overlay widens with a selected edge.
      // The a_flow < 0.5 vertex collapse makes the off-state values inert —
      // TRANSPARENT is belt and braces.
      super.processVisibleItem(edgeIndex, startIndex, sourceData, targetData, {
        ...data,
        color: flowMode > 0 ? (data.flowColor ?? data.color) : TRANSPARENT,
      });
      this.array[startIndex + parentStrideFloats] = flowMode;
      this.array[startIndex + parentStrideFloats + 1] = flowMode > 0 ? data.flowSpeed || 0 : 0;
    }

    setUniforms(params, programInfo) {
      super.setUniforms(params, programInfo);
      programInfo.gl.uniform1f(programInfo.uniformLocations.u_time, flowClock.time);
    }
  };
}

export { EdgeFlowProgram, createCurveFlowProgram, flowClock };
