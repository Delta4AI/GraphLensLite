import { describe, it, expect } from 'vitest';
import { annotationPrimitives, primitivesToSvg } from '../src/graph/export_svg.js';

// ==========================================================================
// SVG parity for text annotations: the primitive group must mirror the DOM
// note (translate + zoom scale, centered border stroke, left-anchored lines
// at the shared annotationLayout metrics) and stay safe against untrusted
// colors/text from loaded files.
// ==========================================================================

const measure = (text) => text.length * 7;

const ann = (overrides = {}) => ({
  id: 'a',
  text: 'ab\ncd',
  x: 0,
  y: 0,
  fontSize: 10,
  fontColor: '#123456',
  borderColor: '#654321',
  borderWidth: 2,
  ...overrides,
});

describe('annotationPrimitives', () => {
  it('wraps border rect and text lines in a translate+scale group', () => {
    const [group] = annotationPrimitives({ ann: ann(), x: 40, y: 60, k: 2 }, measure);
    expect(group.kind).toBe('group');
    expect(group.transform).toBe('translate(40 60) scale(2)');

    const [rect, line1, line2] = group.children;
    // boxW = 14 + 12 + 4 = 30, boxH = 25 + 12 + 4 = 41; stroke inset bw/2.
    expect(rect).toMatchObject({ kind: 'rect', x: 1, y: 1, width: 28, height: 39, fill: 'none', stroke: '#654321', strokeWidth: 2 });
    // Left-anchored, baseline = origin(8) + (i + 0.5) × 12.5 + 0.35 em.
    expect(line1).toMatchObject({ kind: 'text', x: 8, text: 'ab', textAnchor: 'start', fill: '#123456' });
    expect(line1.y).toBeCloseTo(8 + 0.5 * 12.5 + 3.5);
    expect(line2.y).toBeCloseTo(8 + 1.5 * 12.5 + 3.5);
  });

  it('omits the rect at borderWidth 0 and skips empty lines while keeping their spacing', () => {
    const [group] = annotationPrimitives(
      { ann: ann({ text: 'a\n\nb', borderWidth: 0 }), x: 0, y: 0, k: 1 },
      measure
    );
    const kinds = group.children.map((c) => c.kind);
    expect(kinds).toEqual(['text', 'text']);
    // Second visible line sits on row index 2 — the empty row still advanced.
    expect(group.children[1].y).toBeCloseTo(6 + 2.5 * 12.5 + 3.5);
  });

  it('falls back to a neutral color for unsafe paint values', () => {
    const [group] = annotationPrimitives(
      { ann: ann({ fontColor: 'url(javascript:x)"', borderColor: '"><script>' }), x: 0, y: 0, k: 1 },
      measure
    );
    const rect = group.children.find((c) => c.kind === 'rect');
    const text = group.children.find((c) => c.kind === 'text');
    expect(rect.stroke).toBe('#999999');
    expect(text.fill).toBe('#999999');
  });

  it('serializes with an explicit text-anchor and XML-escaped text', () => {
    const prims = annotationPrimitives(
      { ann: ann({ text: 'a<b>&"c' }), x: 1, y: 2, k: 1 },
      measure
    );
    const svg = primitivesToSvg(prims, { width: 100, height: 100 }, '#fff');
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(svg).not.toContain('<b>');
  });

  it('returns nothing for a borderless note whose text is only empty lines', () => {
    expect(
      annotationPrimitives({ ann: ann({ text: '\n', borderWidth: 0 }), x: 0, y: 0, k: 1 }, measure)
    ).toEqual([]);
  });

  it('emits a rounded background card under the border, radius shrunk on the stroke', () => {
    const [group] = annotationPrimitives(
      { ann: ann({ borderRadius: 8, bgColor: '#fffbe6' }), x: 0, y: 0, k: 1 },
      measure
    );
    const [bg, border] = group.children;
    expect(bg).toMatchObject({ kind: 'rect', x: 0, y: 0, width: 30, height: 41, rx: 8, fill: '#fffbe6' });
    expect(bg.filter).toBeUndefined();
    expect(border).toMatchObject({ kind: 'rect', rx: 7, fill: 'none' });
  });

  it('adds the shadow filter to the card and the defs only when a note uses it', () => {
    const withShadow = annotationPrimitives(
      { ann: ann({ bgColor: '#fffbe6', shadow: true }), x: 0, y: 0, k: 1 },
      measure
    );
    expect(withShadow[0].children[0].filter).toBe('gllNoteShadow');

    const shadowSvg = primitivesToSvg(withShadow, { width: 100, height: 100 }, '#fff');
    expect(shadowSvg).toContain('<defs>');
    expect(shadowSvg).toContain('feDropShadow');
    expect(shadowSvg).toContain('filter="url(#gllNoteShadow)"');

    const plain = annotationPrimitives({ ann: ann(), x: 0, y: 0, k: 1 }, measure);
    const plainSvg = primitivesToSvg(plain, { width: 100, height: 100 }, '#fff');
    expect(plainSvg).not.toContain('<defs>');
  });

  it('shadow without a background paints no filter (no card to cast it)', () => {
    const [group] = annotationPrimitives(
      { ann: ann({ shadow: true }), x: 0, y: 0, k: 1 },
      measure
    );
    expect(group.children.every((c) => c.filter === undefined)).toBe(true);
  });
});
