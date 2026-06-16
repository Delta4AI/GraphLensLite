import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  patchCurveFragmentForFlow,
  patchCurveVertexForFlow,
  CURVE_FLOW_ANCHORS,
} from "../src/graph/edge_flow_glsl.js";

// ==========================================================================
// Curved-edge flow GLSL patchers (sigma migration — edge flow phase 2).
// edge_flow_glsl.js is the node-safe half of createCurveFlowProgram: pure
// string transforms that fork the bundled @sigma/edge-curve shaders into the
// animated flow overlay. Under test:
//   - fragment fork: expose the closest-point bezier parameter t (out
//     params), inject flow varyings + u_time + pattern constants, swap the
//     body-color output for the dash/pulse mask (non-picking only)
//   - vertex fork: a_flow/a_flowSpeed attributes, flow-off vertex collapse,
//     projected arc-length varying (CSS px)
//   - drift guard: every patch THROWS on a missing anchor, and the anchors
//     still exist in the live bundle text
//   - co-change contract: pattern constants numerically identical to the
//     straight-edge program's (edge_flow_programs.js)
// ==========================================================================

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

// --------------------------------------------------------------------------
// Fixtures: VERBATIM snapshots of the shader sources the bundled
// @sigma/edge-curve createEdgeCurveProgram generates with the app's
// configuration (arrowHead: null — i.e. no arrow-clause insertions),
// extracted from src/lib/sigma.bundle.mjs. If a sigma upgrade changes the
// GLSL these snapshots stay green by design — the live drift guards are the
// bundle-anchor tests below plus the runtime try/catch in
// buildProgramRegistry (sigma_adapter.js).
// NOTE: the vertex fixture contains a whitespace-only line right after the
// gl_Position assignment (present in the bundle) — don't let a formatter
// strip it.
// --------------------------------------------------------------------------

const BUNDLED_CURVE_FRAGMENT = `
precision highp float;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;




float det(vec2 a, vec2 b) {
  return a.x * b.y - b.x * a.y;
}

vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2) {
  float a = det(b0, b2), b = 2.0 * det(b1, b0), d = 2.0 * det(b2, b1);
  float f = b * d - a * a;
  vec2 d21 = b2 - b1, d10 = b1 - b0, d20 = b2 - b0;
  vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);
  gf = vec2(gf.y, -gf.x);
  vec2 pp = -f * gf / dot(gf, gf);
  vec2 d0p = b0 - pp;
  float ap = det(d0p, d20), bp = 2.0 * det(d10, d0p);
  float t = clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);
  return mix(mix(b0, b1, t), mix(b1, b2, t), t);
}

float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  return length(getDistanceVector(b0 - p, b1 - p, b2 - p));
}

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);
  float thickness = v_thickness;



  float halfThickness = thickness / 2.0;
  if (dist < halfThickness) {
    #ifdef PICKING_MODE
    gl_FragColor = v_color;
    #else
    float t = smoothstep(
      halfThickness - v_feather,
      halfThickness,
      dist
    );

    gl_FragColor = mix(v_color, transparent, t);
    #endif
  } else {
    gl_FragColor = transparent;
  }
}
`;

const BUNDLED_CURVE_VERTEX = `
attribute vec4 a_id;
attribute vec4 a_color;
attribute float a_direction;
attribute float a_thickness;
attribute vec2 a_source;
attribute vec2 a_target;
attribute float a_current;
attribute float a_curvature;



uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform vec2 u_dimensions;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;




const float bias = 255.0 / 254.0;
const float epsilon = 0.7;

vec2 clipspaceToViewport(vec2 pos, vec2 dimensions) {
  return vec2(
    (pos.x + 1.0) * dimensions.x / 2.0,
    (pos.y + 1.0) * dimensions.y / 2.0
  );
}

vec2 viewportToClipspace(vec2 pos, vec2 dimensions) {
  return vec2(
    pos.x / dimensions.x * 2.0 - 1.0,
    pos.y / dimensions.y * 2.0 - 1.0
  );
}

void main() {
  float minThickness = u_minEdgeThickness;

  // Selecting the correct position
  // Branchless "position = a_source if a_current == 1.0 else a_target"
  vec2 position = a_source * max(0.0, a_current) + a_target * max(0.0, 1.0 - a_current);
  position = (u_matrix * vec3(position, 1)).xy;

  vec2 source = (u_matrix * vec3(a_source, 1)).xy;
  vec2 target = (u_matrix * vec3(a_target, 1)).xy;

  vec2 viewportPosition = clipspaceToViewport(position, u_dimensions);
  vec2 viewportSource = clipspaceToViewport(source, u_dimensions);
  vec2 viewportTarget = clipspaceToViewport(target, u_dimensions);

  vec2 delta = viewportTarget.xy - viewportSource.xy;
  float len = length(delta);
  vec2 normal = vec2(-delta.y, delta.x) * a_direction;
  vec2 unitNormal = normal / len;
  float boundingBoxThickness = len * a_curvature;

  float curveThickness = max(minThickness, a_thickness / u_sizeRatio);
  v_thickness = curveThickness * u_pixelRatio;
  v_feather = u_feather;

  v_cpA = viewportSource;
  v_cpB = 0.5 * (viewportSource + viewportTarget) + unitNormal * a_direction * boundingBoxThickness;
  v_cpC = viewportTarget;

  vec2 viewportOffsetPosition = (
    viewportPosition +
    unitNormal * (boundingBoxThickness / 2.0 + sign(boundingBoxThickness) * (curveThickness + epsilon)) *
    max(0.0, a_direction) // NOTE: cutting the bounding box in half to avoid overdraw
  );

  position = viewportToClipspace(viewportOffsetPosition, u_dimensions);
  gl_Position = vec4(position, 0, 1);
    



  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

const PATTERN_CONSTANT_NAMES = [
  "SPEED_PX_PER_S",
  "DASH_PERIOD_PX",
  "DASH_DUTY",
  "PULSE_PERIOD_PX",
  "COMET_PERIOD_PX",
  "CHEVRON_PERIOD_PX",
  "CHEVRON_SLOPE_PX",
  "CHEVRON_DUTY",
  "DOT_RADIUS_PX",
  "DASH_AA_PX",
];

/**
 * All `const float NAME = VALUE;` definitions in a GLSL (or GLSL-embedding
 * JS) source. Asserts that re-definitions of the same name agree, then maps
 * name -> value string.
 */
function glslFloatConstants(source) {
  const constants = new Map();
  for (const [, name, value] of source.matchAll(/const float (\w+) = ([\d.]+);/g)) {
    if (constants.has(name)) {
      expect(value, `conflicting definitions of ${name}`).toBe(constants.get(name));
    }
    constants.set(name, value);
  }
  return constants;
}

const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

/** Brace/paren balance over CODE only (comments may use ranges like "[0, x)"). */
function expectBalanced(source) {
  const code = source.replace(/\/\/[^\n]*/g, "");
  expect(countOccurrences(code, "{")).toBe(countOccurrences(code, "}"));
  expect(countOccurrences(code, "(")).toBe(countOccurrences(code, ")"));
}

describe("patchCurveFragmentForFlow", () => {
  const patched = patchCurveFragmentForFlow(BUNDLED_CURVE_FRAGMENT);

  it("exposes the closest-point bezier parameter t through out params", () => {
    expect(patched).toContain(
      "vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2, out float t_out) {",
    );
    expect(patched).toContain("t_out = t;");
    expect(patched).toContain(
      "float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2, out float t_out) {",
    );
    expect(patched).toContain("getDistanceVector(b0 - p, b1 - p, b2 - p, t_out)");
    // The 3-arg forms are fully rewritten.
    expect(patched).not.toContain("vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2) {");
    expect(patched).not.toContain("getDistanceVector(b0 - p, b1 - p, b2 - p);");
  });

  it("captures curveT at the distance call in main", () => {
    expect(patched).toContain("float curveT = 0.0;");
    expect(patched).toContain(
      "float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC, curveT);",
    );
  });

  it("injects the flow varyings, u_time and the pattern constants", () => {
    expect(patched).toContain("varying float v_flow;");
    expect(patched).toContain("varying float v_flowSpeed;");
    expect(patched).toContain("varying float v_flowDensity;");
    expect(patched).toContain("varying float v_flowArcLenPx;");
    expect(patched).toContain("uniform float u_time;");
    expect(patched).toContain("const float SPEED_PX_PER_S = 40.0;");
    expect(patched).toContain("const float DASH_PERIOD_PX = 16.0;");
    expect(patched).toContain("const float DASH_DUTY = 0.5;");
    expect(patched).toContain("const float PULSE_PERIOD_PX = 48.0;");
    expect(patched).toContain("const float COMET_PERIOD_PX = 48.0;");
    expect(patched).toContain("const float CHEVRON_PERIOD_PX = 24.0;");
    expect(patched).toContain("const float CHEVRON_SLOPE_PX = 4.0;");
    expect(patched).toContain("const float CHEVRON_DUTY = 0.25;");
    expect(patched).toContain("const float DOT_RADIUS_PX = 3.0;");
    expect(patched).toContain("const float DASH_AA_PX = 1.0;");
  });

  it("replaces the body color output with the flow mask, non-picking only", () => {
    // Zero occurrences — guards future edits to the injected constants from
    // re-introducing the replaced body output anywhere in the patched source.
    expect(countOccurrences(patched, "gl_FragColor = mix(v_color, transparent, t);")).toBe(0);
    expect(patched).toContain("float alongPx = curveT * v_flowArcLenPx;");
    expect(patched).toContain("u_time * v_flowSpeed * SPEED_PX_PER_S / period");
    // Density stretches the per-mode period; all four pattern branches exist.
    expect(patched).toContain("float period = basePeriod * v_flowDensity;");
    expect(patched).toContain("alpha = phase * phase;");
    expect(patched).toContain("CHEVRON_SLOPE_PX / period");
    expect(patched).toContain("gl_FragColor = mix(transparent, v_color, alpha * (1.0 - t));");
    // Picking keeps the parent's id output (coverage identical to the body).
    expect(patched).toContain("#ifdef PICKING_MODE");
    expect(patched).toContain("gl_FragColor = v_color;");
    // The outside-the-curve transparent branch is untouched.
    expect(patched).toContain("gl_FragColor = transparent;");
  });

  it("keeps the original distance machinery", () => {
    expect(patched).toContain("float det(vec2 a, vec2 b) {");
    expect(patched).toContain("vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);");
    expect(patched).toContain("float t = clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);");
    expect(patched).toContain("float halfThickness = thickness / 2.0;");
  });

  it("stays brace- and paren-balanced", () => {
    expectBalanced(patched);
  });

  it("throws a descriptive error when an anchor is missing", () => {
    // Real fragment source with ONE anchor knocked out: passes the stage
    // checks, fails at the precise anchor — the sigma-upgrade drift scenario.
    const drifted = BUNDLED_CURVE_FRAGMENT.replace(
      "float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);",
      "float dist = distToQuadraticBezierCurveRenamed(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);",
    );
    expect(() => patchCurveFragmentForFlow(drifted)).toThrow(
      /patchCurveFragmentForFlow.*@sigma\/edge-curve/,
    );
    // A source that isn't a fragment shader at all fails the stage check.
    expect(() => patchCurveFragmentForFlow("void main() {}")).toThrow(
      /patchCurveFragmentForFlow.*shader stage/,
    );
  });

  it("throws on the wrong shader stage (vertex source)", () => {
    expect(() => patchCurveFragmentForFlow(BUNDLED_CURVE_VERTEX)).toThrow(
      /patchCurveFragmentForFlow/,
    );
  });
});

describe("patchCurveVertexForFlow", () => {
  const patched = patchCurveVertexForFlow(BUNDLED_CURVE_VERTEX);

  it("adds the per-edge flow attributes and varyings", () => {
    expect(patched).toContain("attribute float a_flow;");
    expect(patched).toContain("attribute float a_flowSpeed;");
    expect(patched).toContain("attribute float a_flowDensity;");
    expect(patched).toContain("varying float v_flow;");
    expect(patched).toContain("varying float v_flowSpeed;");
    expect(patched).toContain("varying float v_flowDensity;");
    expect(patched).toContain("varying float v_flowArcLenPx;");
  });

  it("collapses flow-off edges to zero fragments before any other work", () => {
    expect(patched).toContain("if (a_flow < 0.5) {");
    expect(patched).toContain("gl_Position = vec4(2.0, 2.0, 0.0, 1.0);");
    // The collapse guards the whole body: it precedes the parent's first
    // statement.
    const collapseAt = patched.indexOf("if (a_flow < 0.5) {");
    const parentBodyAt = patched.indexOf("float minThickness = u_minEdgeThickness;");
    expect(collapseAt).toBeGreaterThan(-1);
    expect(parentBodyAt).toBeGreaterThan(collapseAt);
  });

  it("computes the projected arc length after the control points, in CSS px", () => {
    expect(patched).toContain("v_flow = a_flow;");
    expect(patched).toContain("v_flowSpeed = a_flowSpeed;");
    // Clamp mirrors the straight program's vertex copy (period divisor).
    expect(patched).toContain("v_flowDensity = max(a_flowDensity, 0.05);");
    expect(patched).toContain("for (int i = 1; i <= 8; i++) {");
    expect(patched).toContain("v_flowArcLenPx = flowArcLen / u_pixelRatio;");
    const controlPointsAt = patched.indexOf("v_cpC = viewportTarget;");
    const arcLengthAt = patched.indexOf("float flowArcLen = 0.0;");
    expect(controlPointsAt).toBeGreaterThan(-1);
    expect(arcLengthAt).toBeGreaterThan(controlPointsAt);
  });

  it("keeps the original projection machinery", () => {
    expect(patched).toContain("vec2 clipspaceToViewport(vec2 pos, vec2 dimensions) {");
    expect(patched).toContain("v_cpB = 0.5 * (viewportSource + viewportTarget)");
    expect(patched).toContain("v_color.a *= bias;");
  });

  it("stays brace- and paren-balanced", () => {
    expectBalanced(patched);
  });

  it("throws a descriptive error when an anchor is missing", () => {
    // Real vertex source with ONE anchor knocked out (see fragment twin).
    const drifted = BUNDLED_CURVE_VERTEX.replace(
      "attribute float a_curvature;",
      "attribute float a_curvatureRenamed;",
    );
    expect(() => patchCurveVertexForFlow(drifted)).toThrow(
      /patchCurveVertexForFlow.*@sigma\/edge-curve/,
    );
    // A source that isn't a vertex shader at all fails the stage check.
    expect(() => patchCurveVertexForFlow("void main() {}")).toThrow(
      /patchCurveVertexForFlow.*shader stage/,
    );
  });

  it("throws on the wrong shader stage (fragment source)", () => {
    expect(() => patchCurveVertexForFlow(BUNDLED_CURVE_FRAGMENT)).toThrow(
      /patchCurveVertexForFlow/,
    );
  });
});

describe("pattern constants co-change contract", () => {
  it("matches the straight-edge program's constants exactly", () => {
    // The straight program is browser-only (imports the sigma bundle), so
    // compare against its SOURCE TEXT rather than importing it.
    const straightConstants = glslFloatConstants(readSource("src/graph/edge_flow_programs.js"));
    const curveConstants = glslFloatConstants(
      patchCurveFragmentForFlow(BUNDLED_CURVE_FRAGMENT),
    );
    for (const name of PATTERN_CONSTANT_NAMES) {
      expect(straightConstants.has(name), `straight program defines ${name}`).toBe(true);
      expect(curveConstants.get(name), `curve overlay value of ${name}`).toBe(
        straightConstants.get(name),
      );
    }
  });
});

describe("bundle drift signal", () => {
  const bundleSource = readSource("src/lib/sigma.bundle.mjs");

  it("every fragment anchor still exists in the bundled @sigma/edge-curve source", () => {
    for (const anchor of CURVE_FLOW_ANCHORS.fragment) {
      expect(bundleSource, `bundle contains ${JSON.stringify(anchor)}`).toContain(anchor);
    }
  });

  it("every vertex anchor still exists in the bundled @sigma/edge-curve source", () => {
    for (const anchor of CURVE_FLOW_ANCHORS.vertex) {
      expect(bundleSource, `bundle contains ${JSON.stringify(anchor)}`).toContain(anchor);
    }
  });

  it("the fixtures carry every anchor the patchers rely on", () => {
    for (const anchor of CURVE_FLOW_ANCHORS.fragment) {
      expect(BUNDLED_CURVE_FRAGMENT, `fragment fixture contains ${JSON.stringify(anchor)}`).toContain(anchor);
    }
    for (const anchor of CURVE_FLOW_ANCHORS.vertex) {
      expect(BUNDLED_CURVE_VERTEX, `vertex fixture contains ${JSON.stringify(anchor)}`).toContain(anchor);
    }
  });
});
