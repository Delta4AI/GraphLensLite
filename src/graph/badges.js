/**
 * Node badges: one pill per perimeter slot. A node style carries them as the
 * parallel arrays `badges` ([{text, placement, property?}]) and
 * `badgePalette` ([color]) — the saved JSON shape, unchanged.
 */
import { placementVector } from './label_renderers.js';
import { StaticUtilities } from '../utilities/static.js';

/** The eight perimeter slots, clockwise from the top. */
const BADGE_SLOTS = [
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
  'top-left',
];

/** Longest badge text drawn; longer column values are cut with an ellipsis. */
const BADGE_MAX_CHARS = 24;
const BADGE_NUMBER_PRECISION = 2;

const SLOT_BY_VECTOR = new Map(BADGE_SLOTS.map((slot) => [String(placementVector(slot)), slot]));

/**
 * The slot a placement draws in. Older files also used `left-top` style
 * spellings, which draw in the same spot as `top-left`.
 * @returns {string|undefined} undefined for a placement that is no slot
 */
function badgeSlot(placement) {
  return SLOT_BY_VECTOR.get(String(placementVector(placement)));
}

/**
 * The style's badges with `slot` emptied.
 * @returns {{badges: object[], badgePalette: string[]}}
 */
function withoutSlot(style, slot) {
  const badges = [];
  const badgePalette = [];
  (Array.isArray(style.badges) ? style.badges : []).forEach((badge, i) => {
    if (badgeSlot(badge?.placement) === slot) return;
    badges.push(badge);
    badgePalette.push(style.badgePalette?.[i]);
  });
  return { badges, badgePalette };
}

/**
 * A node style's badge fields after `badge_set` or `badge_remove`.
 *
 * badge_set fills the slot — with the typed text, or with this node's value
 * in `badge.property` — replacing what was there. A node with no value for
 * that column gets an empty slot (missingValue), so a stale badge never
 * passes for the column's value.
 *
 * @param {object} style  the node's current style
 * @param {'badge_set'|'badge_remove'} command
 * @param {{placement: string, color?: string, text?: string, property?: string}} badge
 * @param {Map<string, unknown>} [featureValues]  the node's property values
 * @returns {{badge: boolean, badges: object[], badgePalette: string[], missingValue: boolean}}
 */
function applyBadgeCommand(style, command, badge, featureValues) {
  if (!badge?.placement) throw new Error(`${command} needs a badge placement`);
  const slot = badgeSlot(badge.placement);
  const kept = withoutSlot(style, slot);
  const result = (fields, missingValue) => ({ ...fields, badge: fields.badges.length > 0, missingValue });
  if (command === 'badge_remove') return result(kept, false);

  const text = badge.property ? badgeTextFromValue(featureValues?.get(badge.property)) : badge.text;
  if (!text) return result(kept, true);
  const placed = { text, placement: slot };
  if (badge.property) placed.property = badge.property;
  return result(
    { badges: [...kept.badges, placed], badgePalette: [...kept.badgePalette, badge.color] },
    false
  );
}

/**
 * Badge text for a node property value: categorical values are Sets (split on
 * `|` at load), numbers are rounded, everything is capped at BADGE_MAX_CHARS.
 * @returns {string} '' when the node has no value
 */
function badgeTextFromValue(value) {
  if (value === undefined || value === null) return '';
  let text;
  if (value instanceof Set) {
    text = [...value].join(', ');
  } else if (typeof value === 'number') {
    text = String(StaticUtilities.formatNumber(value, BADGE_NUMBER_PRECISION));
  } else {
    text = String(value);
  }
  return StaticUtilities.truncate(text.trim(), BADGE_MAX_CHARS);
}

/**
 * What the selected nodes carry, slot by slot, for the badge list.
 * @param {object[]} styles  node styles
 * @returns {{slot: string, texts: string[], colors: string[], property: string|null, nodes: number}[]}
 *          in BADGE_SLOTS order; `property` is set only when every badge in the
 *          slot came from that one column
 */
function summarizeBadges(styles) {
  const bySlot = new Map();
  for (const style of styles) {
    if (!style?.badge || !Array.isArray(style.badges)) continue;
    style.badges.forEach((badge, i) => {
      const slot = badgeSlot(badge?.placement);
      if (!slot) return;
      const entry = bySlot.get(slot) ?? { texts: new Set(), colors: new Set(), properties: new Set(), nodes: 0 };
      entry.texts.add(String(badge.text ?? ''));
      entry.colors.add(style.badgePalette?.[i]);
      entry.properties.add(typeof badge.property === 'string' ? badge.property : null);
      entry.nodes += 1;
      bySlot.set(slot, entry);
    });
  }
  return BADGE_SLOTS.filter((slot) => bySlot.has(slot)).map((slot) => {
    const { texts, colors, properties, nodes } = bySlot.get(slot);
    const [onlyProperty] = properties;
    return {
      slot,
      texts: [...texts],
      colors: [...colors],
      property: properties.size === 1 ? onlyProperty : null,
      nodes,
    };
  });
}

export { BADGE_SLOTS, BADGE_MAX_CHARS, badgeSlot, applyBadgeCommand, badgeTextFromValue, summarizeBadges };
