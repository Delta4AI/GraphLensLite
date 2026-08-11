import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_DEFAULTS,
  MAX_ANNOTATIONS,
  normalizeAnnotation,
  sanitizeAnnotations,
  annotationLayout,
} from '../src/graph/annotation_geometry.js';

// ==========================================================================
// Trust boundary + box metrics for text annotations. Loaded JSON is
// untrusted: malformed records must drop, fields must clamp/default. The
// layout math is the single source of truth for the DOM note, the PNG
// repaint and the SVG rect, so its arithmetic is pinned here.
// ==========================================================================

describe('normalizeAnnotation', () => {
  it('accepts a full valid record unchanged', () => {
    const ann = {
      id: 'n1',
      text: 'hello\nworld',
      x: 10.5,
      y: -3,
      fontSize: 22,
      fontColor: '#112233',
      borderColor: '#445566',
      borderWidth: 3,
      borderRadius: 12,
      bgColor: '#fffbe6',
      shadow: true,
    };
    expect(normalizeAnnotation(ann)).toEqual(ann);
  });

  it('defaults the card fields: radius 6, transparent background, no shadow', () => {
    const out = normalizeAnnotation({ x: 0, y: 0 });
    expect(out.borderRadius).toBe(ANNOTATION_DEFAULTS.borderRadius);
    expect(out.bgColor).toBeNull();
    expect(out.shadow).toBe(false);
  });

  it('clamps the radius and drops invalid backgrounds to null, not to a paint', () => {
    const out = normalizeAnnotation({
      x: 0,
      y: 0,
      borderRadius: 500,
      bgColor: 'url(javascript:x)',
      shadow: 'yes', // truthy junk must not become true
    });
    expect(out.borderRadius).toBe(40);
    expect(out.bgColor).toBeNull();
    expect(out.shadow).toBe(false);
  });

  it('rejects records without finite coordinates', () => {
    expect(normalizeAnnotation({ text: 'x' })).toBeNull();
    expect(normalizeAnnotation({ x: NaN, y: 0, text: 'x' })).toBeNull();
    expect(normalizeAnnotation({ x: 'a', y: 1 })).toBeNull();
    expect(normalizeAnnotation(null)).toBeNull();
    expect(normalizeAnnotation('junk')).toBeNull();
  });

  it('defaults missing style fields and coerces numeric strings', () => {
    const out = normalizeAnnotation({ x: '1', y: '2' });
    expect(out).toMatchObject({
      x: 1,
      y: 2,
      text: ANNOTATION_DEFAULTS.text,
      fontSize: ANNOTATION_DEFAULTS.fontSize,
      fontColor: ANNOTATION_DEFAULTS.fontColor,
      borderColor: ANNOTATION_DEFAULTS.borderColor,
      borderWidth: ANNOTATION_DEFAULTS.borderWidth,
    });
    expect(out.id).toBeTruthy();
  });

  it('clamps fontSize and borderWidth into sane ranges', () => {
    const out = normalizeAnnotation({ x: 0, y: 0, fontSize: 9999, borderWidth: -5 });
    expect(out.fontSize).toBe(200);
    expect(out.borderWidth).toBe(0);
    expect(normalizeAnnotation({ x: 0, y: 0, fontSize: 1 }).fontSize).toBe(6);
  });

  it('truncates oversized text and color strings instead of keeping them', () => {
    const out = normalizeAnnotation({ x: 0, y: 0, text: 'a'.repeat(5000), fontColor: 'b'.repeat(200) });
    expect(out.text).toHaveLength(2000);
    expect(out.fontColor).toHaveLength(50);
  });

  it('replaces non-string text/colors with defaults', () => {
    const out = normalizeAnnotation({ x: 0, y: 0, text: { evil: true }, fontColor: 42 });
    expect(out.text).toBe(ANNOTATION_DEFAULTS.text);
    expect(out.fontColor).toBe(ANNOTATION_DEFAULTS.fontColor);
  });

  it('rejects colors outside the safe paint allowlist at the boundary', () => {
    const out = normalizeAnnotation({
      x: 0,
      y: 0,
      fontColor: 'url(javascript:alert(1))',
      borderColor: '"><script>',
    });
    expect(out.fontColor).toBe(ANNOTATION_DEFAULTS.fontColor);
    expect(out.borderColor).toBe(ANNOTATION_DEFAULTS.borderColor);
    // Ordinary formats still pass.
    expect(normalizeAnnotation({ x: 0, y: 0, fontColor: 'rgb(1, 2, 3)' }).fontColor).toBe('rgb(1, 2, 3)');
  });
});

describe('sanitizeAnnotations', () => {
  it('returns [] for anything that is not an array', () => {
    expect(sanitizeAnnotations(undefined)).toEqual([]);
    expect(sanitizeAnnotations(null)).toEqual([]);
    expect(sanitizeAnnotations({ 0: {} })).toEqual([]);
    expect(sanitizeAnnotations('x')).toEqual([]);
  });

  it('keeps valid records and drops broken ones', () => {
    const out = sanitizeAnnotations([
      { id: 'ok', x: 1, y: 2, text: 'keep' },
      { text: 'no coords' },
      null,
      { id: 'ok2', x: 3, y: 4 },
    ]);
    expect(out.map((a) => a.id)).toEqual(['ok', 'ok2']);
  });

  it('caps a note-bomb array instead of materializing every record', () => {
    const bomb = Array.from({ length: MAX_ANNOTATIONS + 5000 }, (_, i) => ({ id: `n${i}`, x: 0, y: 0 }));
    expect(sanitizeAnnotations(bomb)).toHaveLength(MAX_ANNOTATIONS);
  });
});

describe('annotationLayout', () => {
  // Deterministic measurer: 7 px per character.
  const measure = (text) => text.length * 7;

  it('sizes a single-line box: content + 2×padding + 2×border', () => {
    const ann = normalizeAnnotation({ x: 0, y: 0, text: 'abcd', fontSize: 10, borderWidth: 2 });
    const layout = annotationLayout(ann, measure);
    expect(layout.lines).toEqual(['abcd']);
    expect(layout.contentW).toBe(28);
    expect(layout.lineHeight).toBe(12.5); // 10 × 1.25
    expect(layout.contentH).toBe(12.5);
    expect(layout.boxW).toBe(28 + 2 * layout.pad + 4);
    expect(layout.boxH).toBe(12.5 + 2 * layout.pad + 4);
  });

  it('uses the widest line and stacks all lines, including empty ones', () => {
    const ann = normalizeAnnotation({ x: 0, y: 0, text: 'ab\n\nlongestline', fontSize: 14 });
    const layout = annotationLayout(ann, measure);
    expect(layout.lines).toHaveLength(3);
    expect(layout.contentW).toBe('longestline'.length * 7);
    expect(layout.contentH).toBe(3 * 14 * 1.25);
  });

  // The three shapes a repaint needs. Both export sinks (canvas drawExport, SVG
  // annotationPrimitives) had their own copy of the border inset, the corner
  // shrink and the line origins; they read them from here now.
  it('gives the fill box the whole border-box at the note radius', () => {
    const ann = normalizeAnnotation({
      x: 0, y: 0, text: 'abcd', fontSize: 10, borderWidth: 2, borderRadius: 6,
    });
    const layout = annotationLayout(ann, measure);

    expect(layout.fillBox).toEqual({
      x: 0, y: 0, width: layout.boxW, height: layout.boxH, radius: 6,
    });
  });

  it('insets the stroke box by half the border, shrinking the corner with it', () => {
    const ann = normalizeAnnotation({
      x: 0, y: 0, text: 'abcd', fontSize: 10, borderWidth: 4, borderRadius: 6,
    });
    const layout = annotationLayout(ann, measure);

    // Centred stroke: the OUTER edge lands on the border-box outline, so the
    // outer curve still reads as radius 6.
    expect(layout.strokeBox).toEqual({
      x: 2,
      y: 2,
      width: layout.boxW - 4,
      height: layout.boxH - 4,
      radius: 4,
      strokeWidth: 4,
    });
  });

  it('has no stroke box without a border, and never a negative radius', () => {
    const bare = annotationLayout(
      normalizeAnnotation({ x: 0, y: 0, text: 'x', borderWidth: 0 }),
      measure
    );
    expect(bare.strokeBox).toBeNull();

    const thick = annotationLayout(
      normalizeAnnotation({ x: 0, y: 0, text: 'x', borderWidth: 8, borderRadius: 1 }),
      measure
    );
    expect(thick.strokeBox.radius).toBe(0);
  });

  it('centres each line inside the padded content box', () => {
    const ann = normalizeAnnotation({
      x: 0, y: 0, text: 'ab\ncd', fontSize: 10, borderWidth: 2,
    });
    const layout = annotationLayout(ann, measure);
    const origin = 2 + layout.pad;

    expect(layout.textLines).toEqual([
      { text: 'ab', x: origin, y: origin + 0.5 * layout.lineHeight },
      { text: 'cd', x: origin, y: origin + 1.5 * layout.lineHeight },
    ]);
  });

  it('passes the font string to the measurer', () => {
    const fonts = [];
    const ann = normalizeAnnotation({ x: 0, y: 0, text: 'x', fontSize: 18 });
    annotationLayout(ann, (text, font) => {
      fonts.push(font);
      return 1;
    });
    expect(fonts).toEqual(['18px Arial, sans-serif']);
  });
});
