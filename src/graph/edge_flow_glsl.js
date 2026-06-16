/**
 * Pure GLSL string transforms forking the bundled @sigma/edge-curve shaders
 * into the curved-edge flow overlay (node-safe: no sigma import — unit-tested
 * against a verbatim bundle snapshot in tests/edge-flow-glsl.test.js).
 * createCurveFlowProgram (edge_flow_programs.js) applies them to the parent
 * curve program's shader sources at class-creation time.
 *
 * The parent fragment works in WINDOW PIXELS: v_cpA/v_cpB/v_cpC are the
 * projected quadratic-bezier control points, compared against gl_FragCoord.
 * Its getDistanceVector computes the bezier parameter t of the closest curve
 * point and discards it — the fork exposes it (out param) and uses
 * t × arc-length as the along-the-curve distance driving the same dash/pulse
 * masks as the straight-edge flow program.
 *
 * Every patch is anchored on a small exact substring of the bundled source
 * and THROWS when the anchor is missing — the drift guard for future sigma
 * upgrades. buildProgramRegistry (sigma_adapter.js) try/catches the program
 * creation and degrades to non-animated curves.
 */

// ---------------------------------------------------------------------------
// Anchors (copied verbatim from src/lib/sigma.bundle.mjs, arrowHead: null).
// ---------------------------------------------------------------------------

const FRAG_DISTANCE_FN_DECL = "vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2) {";
const FRAG_T_COMPUTATION = "float t = clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);";
const FRAG_DIST_TO_CURVE_FN = `float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  return length(getDistanceVector(b0 - p, b1 - p, b2 - p));
}`;
const FRAG_VARYINGS_END = "varying vec2 v_cpC;";
const FRAG_DIST_CALL =
  "float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);";
const FRAG_BODY_OUTPUT = "gl_FragColor = mix(v_color, transparent, t);";

const VERT_ATTRIBUTES_END = "attribute float a_curvature;";
// Coincidentally the same string as FRAG_VARYINGS_END (both stages declare
// the control-point varyings) — wrong-stage input is caught by the explicit
// assertStage() checks, not by this anchor.
const VERT_VARYINGS_END = "varying vec2 v_cpC;";
const VERT_MAIN_START = `void main() {
  float minThickness = u_minEdgeThickness;`;
const VERT_CONTROL_POINTS_DONE = "v_cpC = viewportTarget;";

/**
 * Every anchor the two patchers rely on, exported so the unit tests can also
 * grep the LIVE bundle text for them (early drift signal; the runtime
 * try/catch in buildProgramRegistry is the actual guard).
 */
const CURVE_FLOW_ANCHORS = Object.freeze({
  fragment: Object.freeze([
    FRAG_DISTANCE_FN_DECL,
    FRAG_T_COMPUTATION,
    FRAG_DIST_TO_CURVE_FN,
    FRAG_VARYINGS_END,
    FRAG_DIST_CALL,
    FRAG_BODY_OUTPUT,
  ]),
  vertex: Object.freeze([
    VERT_ATTRIBUTES_END,
    VERT_VARYINGS_END,
    VERT_MAIN_START,
    VERT_CONTROL_POINTS_DONE,
  ]),
});

// ---------------------------------------------------------------------------
// Injected GLSL.
// ---------------------------------------------------------------------------

// Pattern constants — MUST stay numerically identical to the straight-edge
// program's copies in edge_flow_programs.js (FLOW_VERTEX_SHADER +
// FLOW_FRAGMENT_SHADER): straight and curved flow edges animate side by side,
// and any drift shows up as mismatched dash spacing, dot size or speed.
// language=GLSL
const FLOW_PATTERN_CONSTANTS = /*glsl*/ `
// Base flow velocity in screen px per second (x per-edge v_flowSpeed).
const float SPEED_PX_PER_S = 40.0;
const float DASH_PERIOD_PX = 16.0;
const float DASH_DUTY = 0.5;
const float PULSE_PERIOD_PX = 48.0;
const float COMET_PERIOD_PX = 48.0;
const float CHEVRON_PERIOD_PX = 24.0;
// Chevron band: along-the-curve backsweep at the rim + filled period fraction.
const float CHEVRON_SLOPE_PX = 4.0;
const float CHEVRON_DUTY = 0.25;
// Pulse dot half-length along the edge.
const float DOT_RADIUS_PX = 3.0;
// Dash-end smoothing in screen px.
const float DASH_AA_PX = 1.0;`;

// language=GLSL
const FRAG_FLOW_INPUTS = /*glsl*/ `varying float v_flow;
varying float v_flowSpeed;
varying float v_flowDensity;
varying float v_flowArcLenPx;

uniform float u_time;
${FLOW_PATTERN_CONSTANTS}`;

// Replaces the body-color output INSIDE the `dist < halfThickness` non-picking
// branch: `t` (just above) is the parent's rim feather term (0 at the spine,
// 1 at the rim), so (1.0 - t) is the coverage the body would have drawn with.
// PICKING_MODE is untouched — the parent's id output stays, and the body
// sub-program already draws this exact quad with this exact id, so picking
// coverage is unchanged (same reasoning as the straight flow program).
// language=GLSL
const FRAG_FLOW_MASK = /*glsl*/ `// Flow mask instead of the body color (v_color carries the flow color,
    // substituted CPU-side like the curve halo does). curveT x arc length =
    // distance along the curve in px; the pattern expressions mirror the
    // straight program's (edge_flow_programs.js FLOW_FRAGMENT_SHADER), with
    // the per-edge density multiplier stretching the period.
    float alongPx = curveT * v_flowArcLenPx;
    float basePeriod = v_flow < 1.5 ? DASH_PERIOD_PX
      : v_flow < 2.5 ? PULSE_PERIOD_PX
      : v_flow < 3.5 ? COMET_PERIOD_PX
      : CHEVRON_PERIOD_PX;
    float period = basePeriod * v_flowDensity;
    float crossNorm = dist / halfThickness;
    float phase = fract(alongPx / period - fract(u_time * v_flowSpeed * SPEED_PX_PER_S / period));
    float alpha;
    if (v_flow < 1.5) {
      // Dash: filled for phase in [0, duty), ends feathered in phase units.
      float aa = DASH_AA_PX / period;
      float dashDist = min(phase, DASH_DUTY - phase);
      alpha = smoothstep(-0.5 * aa, 0.5 * aa, dashDist);
    } else if (v_flow < 2.5) {
      // Pulse: circular-ish dot — along-distance normalized to the dot
      // radius, cross-distance to the half-thickness, soft radial falloff.
      vec2 q = vec2((phase - 0.5) * period / DOT_RADIUS_PX, crossNorm);
      alpha = 1.0 - smoothstep(0.8, 1.0, length(q));
    } else if (v_flow < 3.5) {
      // Comet: alpha ramps over the period — fading tail behind the sharp
      // head at the fract() wrap.
      alpha = phase * phase;
    } else {
      // Chevron: dash band swept back with the cross-axis distance, tip
      // leading at the spine — a > pointing along the travel direction.
      float chevPhase = fract(phase + (CHEVRON_SLOPE_PX / period) * crossNorm);
      float aa = DASH_AA_PX / period;
      float chevDist = min(chevPhase, CHEVRON_DUTY - chevPhase);
      alpha = smoothstep(-0.5 * aa, 0.5 * aa, chevDist);
    }
    gl_FragColor = mix(transparent, v_color, alpha * (1.0 - t));`;

// language=GLSL
const VERT_FLOW_COLLAPSE = /*glsl*/ `if (a_flow < 0.5) {
    // Flow disabled: zero-area triangle off-screen -> no fragments (the
    // straight flow program's trick; the cheapest possible off state).
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    v_color = vec4(0.0);
    v_thickness = 1.0;
    v_feather = 1.0;
    v_cpA = vec2(0.0);
    v_cpB = vec2(0.0);
    v_cpC = vec2(0.0);
    v_flow = 0.0;
    v_flowSpeed = 0.0;
    v_flowDensity = 1.0;
    v_flowArcLenPx = 0.0;
    return;
  }
`;

// language=GLSL
const VERT_ARC_LENGTH = /*glsl*/ `
  v_flow = a_flow;
  v_flowSpeed = a_flowSpeed;
  // Clamp must match the straight program's vertex copy (period divisor).
  v_flowDensity = max(a_flowDensity, 0.05);
  // Arc length of the projected bezier (chord sum, 8 segments — well under
  // 1% short at the app's fixed 0.25 curvature). The control points are in
  // DEVICE px (gl_FragCoord space); divide by u_pixelRatio so the fragment's
  // pattern geometry is in CSS px, matching the straight flow program's dash
  // spacing on hidpi screens.
  vec2 flowPrev = v_cpA;
  float flowArcLen = 0.0;
  for (int i = 1; i <= 8; i++) {
    float ft = float(i) / 8.0;
    vec2 flowPt = mix(mix(v_cpA, v_cpB, ft), mix(v_cpB, v_cpC, ft), ft);
    flowArcLen += length(flowPt - flowPrev);
    flowPrev = flowPt;
  }
  v_flowArcLenPx = flowArcLen / u_pixelRatio;`;

// ---------------------------------------------------------------------------
// Patchers.
// ---------------------------------------------------------------------------

/**
 * Throw unless `source` looks like the expected shader stage. Both patchers'
 * anchor sets overlap (the v_cpC varying exists in both stages), so the
 * stage marker — gl_FragCoord reads vs gl_Position writes — is the check
 * that actually rejects a source handed to the wrong patcher.
 *
 * @param {string} source
 * @param {string} marker  stage-distinctive substring
 * @param {string} patcherName  for the error message
 */
function assertStage(source, marker, patcherName) {
  if (!source.includes(marker)) {
    throw new Error(
      `${patcherName}: source does not look like the expected shader stage ` +
        `(missing ${JSON.stringify(marker)}) — wrong source passed, or a ` +
        `sigma upgrade restructured the GLSL`,
    );
  }
}

/**
 * Replace the first occurrence of `anchor`, throwing a descriptive error when
 * the anchor is absent (sigma upgrade moved the GLSL).
 *
 * Patch-ordering invariant: the patchers apply several replaceOnce calls to
 * the same accumulating string, so injected text must never contain a LATER
 * call's anchor — the injected copy would be patched instead of the original.
 *
 * @param {string} source
 * @param {string} anchor  exact substring of the bundled shader source
 * @param {string} replacement
 * @param {string} patcherName  for the error message
 * @returns {string}
 */
function replaceOnce(source, anchor, replacement, patcherName) {
  const index = source.indexOf(anchor);
  if (index === -1) {
    throw new Error(
      `${patcherName}: anchor not found in @sigma/edge-curve shader source ` +
        `(did a sigma upgrade change the GLSL?): ${JSON.stringify(anchor)}`,
    );
  }
  return source.slice(0, index) + replacement + source.slice(index + anchor.length);
}

/**
 * Fork the @sigma/edge-curve FRAGMENT shader: expose the closest-point bezier
 * parameter t from getDistanceVector and replace the body-color output with
 * the animated dash/pulse flow mask (non-picking only).
 *
 * @param {string} fragmentSource
 * @returns {string}
 * @throws {Error} when any anchor is missing from the source
 */
function patchCurveFragmentForFlow(fragmentSource) {
  const name = "patchCurveFragmentForFlow";
  assertStage(fragmentSource, "gl_FragCoord", name);
  // Scope dependencies of the injected mask that no anchor would otherwise
  // verify: FRAG_FLOW_MASK reads the parent's halfThickness and rim term t.
  assertStage(fragmentSource, "float halfThickness", name);
  assertStage(fragmentSource, "float t = smoothstep(", name);
  let source = fragmentSource;
  // Expose t: out param on getDistanceVector + distToQuadraticBezierCurve.
  source = replaceOnce(
    source,
    FRAG_DISTANCE_FN_DECL,
    "vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2, out float t_out) {",
    name,
  );
  source = replaceOnce(source, FRAG_T_COMPUTATION, `${FRAG_T_COMPUTATION}\n  t_out = t;`, name);
  source = replaceOnce(
    source,
    FRAG_DIST_TO_CURVE_FN,
    `float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2, out float t_out) {
  return length(getDistanceVector(b0 - p, b1 - p, b2 - p, t_out));
}`,
    name,
  );
  // Flow inputs after the parent's last varying.
  source = replaceOnce(source, FRAG_VARYINGS_END, `${FRAG_VARYINGS_END}\n${FRAG_FLOW_INPUTS}`, name);
  // main: capture curveT at the existing distance call.
  source = replaceOnce(
    source,
    FRAG_DIST_CALL,
    `float curveT = 0.0;
  float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC, curveT);`,
    name,
  );
  // Body color -> flow mask.
  source = replaceOnce(source, FRAG_BODY_OUTPUT, FRAG_FLOW_MASK, name);
  return source;
}

/**
 * Fork the @sigma/edge-curve VERTEX shader: add the a_flow/a_flowSpeed/
 * a_flowDensity attributes (the flow color rides the parent's a_color slot,
 * substituted CPU-side), the flow-off vertex collapse, and the projected
 * arc-length varying the fragment scales curveT by.
 *
 * @param {string} vertexSource
 * @returns {string}
 * @throws {Error} when any anchor is missing from the source
 */
function patchCurveVertexForFlow(vertexSource) {
  const name = "patchCurveVertexForFlow";
  assertStage(vertexSource, "gl_Position", name);
  let source = vertexSource;
  source = replaceOnce(
    source,
    VERT_ATTRIBUTES_END,
    `${VERT_ATTRIBUTES_END}
attribute float a_flow;
attribute float a_flowSpeed;
attribute float a_flowDensity;`,
    name,
  );
  source = replaceOnce(
    source,
    VERT_VARYINGS_END,
    `${VERT_VARYINGS_END}
varying float v_flow;
varying float v_flowSpeed;
varying float v_flowDensity;
varying float v_flowArcLenPx;`,
    name,
  );
  source = replaceOnce(
    source,
    VERT_MAIN_START,
    `void main() {
  ${VERT_FLOW_COLLAPSE}
  float minThickness = u_minEdgeThickness;`,
    name,
  );
  source = replaceOnce(
    source,
    VERT_CONTROL_POINTS_DONE,
    `${VERT_CONTROL_POINTS_DONE}\n${VERT_ARC_LENGTH}`,
    name,
  );
  return source;
}

export { patchCurveFragmentForFlow, patchCurveVertexForFlow, CURVE_FLOW_ANCHORS };
