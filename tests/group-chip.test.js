// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UIComponentManager } from '../src/managers/ui_components.js';

// ==========================================================================
// The per-filter-row group chip.
//
// It replaced a 2×2 quadrant pie whose four wedges were the entire reason
// bubble groups were capped at four. At 18px it cannot name N groups, so it
// deliberately encodes only "unassigned / in one / in several" plus the first
// group's colour, and puts the exact truth in the accessible name. These tests
// pin that contract, including the accessible name — which is the ONLY place
// multi-group membership is legible.
// ==========================================================================

function makeCache(groups = { g1: '#403C53', g2: '#C33D35' }) {
  const bubbleSetStyle = {};
  Object.entries(groups).forEach(([key, fill], i) => {
    bubbleSetStyle[key] = { fill, labelText: ['Kinases', 'Hubs'][i] ?? key };
  });
  const layout = { filters: new Map(), bubbleSetStyle };
  for (const key of Object.keys(bubbleSetStyle)) layout[`${key}Props`] = new Set();

  const cache = {
    data: { selectedLayout: 'Default', layouts: { Default: layout } },
    bs: {
      *traverseBubbleSets() { yield* Object.keys(bubbleSetStyle); },
      createGroup: vi.fn(),
      getEffectiveGroupMembers: () => new Set(),
      afterMembershipChange: vi.fn(),
    },
    gcm: { decideToRenderOrDraw: vi.fn(async () => {}) },
    ui: { info: vi.fn(), error: vi.fn() },
  };
  cache.uiComponents = new UIComponentManager(cache);
  return cache;
}

const PROP = 'Node::Topology::degree';
const layoutOf = (cache) => cache.data.layouts.Default;

beforeEach(() => {
  document.body.innerHTML = '';
  for (const el of document.querySelectorAll('.rail-menu')) el.remove();
});

describe('group chip appearance', () => {
  it('is a hairline outline, naming the property, when unassigned', () => {
    const cache = makeCache();
    const chip = cache.uiComponents.createGroupChip(PROP);

    expect(chip.classList.contains('assigned')).toBe(false);
    expect(chip.classList.contains('multi')).toBe(false);
    expect(chip.getAttribute('aria-label'))
      .toBe('Assign nodes matching Node › Topology › degree to a group');
  });

  it('takes the group colour, and names the group, when in one', () => {
    const cache = makeCache();
    layoutOf(cache).g1Props.add(PROP);
    const chip = cache.uiComponents.createGroupChip(PROP);

    expect(chip.classList.contains('assigned')).toBe(true);
    expect(chip.classList.contains('multi')).toBe(false);
    expect(chip.style.getPropertyValue('--chip-color')).toBe('#403C53');
    expect(chip.getAttribute('aria-label')).toContain('currently in Kinases');
  });

  it('adds the "and others" ring and names every group when in several', () => {
    const cache = makeCache();
    layoutOf(cache).g1Props.add(PROP);
    layoutOf(cache).g2Props.add(PROP);
    const chip = cache.uiComponents.createGroupChip(PROP);

    expect(chip.classList.contains('multi')).toBe(true);
    // Only the first colour is shown; the name carries the rest.
    expect(chip.style.getPropertyValue('--chip-color')).toBe('#403C53');
    expect(chip.getAttribute('aria-label')).toContain('currently in Kinases, Hubs');
  });

  it('repaints in place when membership changes elsewhere', () => {
    const cache = makeCache();
    const container = document.createElement('div');
    container.id = 'filterContainer';
    container.appendChild(cache.uiComponents.createGroupChip(PROP));
    document.body.appendChild(container);

    layoutOf(cache).g2Props.add(PROP);
    cache.uiComponents.refreshGroupChips();

    const chip = container.querySelector('.group-chip');
    expect(chip.classList.contains('assigned')).toBe(true);
    expect(chip.style.getPropertyValue('--chip-color')).toBe('#C33D35');
  });
});

describe('group chip menu', () => {
  const rows = () =>
    [...document.querySelectorAll('.rail-menu.open .rail-menu-item')].map(
      (r) => r.querySelector('.rail-menu-label').textContent
    );

  it('opens the shared checklist, ticking the groups this property feeds', () => {
    const cache = makeCache();
    layoutOf(cache).g2Props.add(PROP);
    const chip = cache.uiComponents.createGroupChip(PROP);
    document.body.appendChild(chip);

    chip.click();

    expect(rows()).toEqual(['Kinases', 'Hubs', 'New group from this filter']);
    const items = document.querySelectorAll('.rail-menu.open .rail-menu-item');
    expect(items[0].classList.contains('checked')).toBe(false);
    expect(items[1].classList.contains('checked')).toBe(true);
  });

  it('toggles the property into and out of a group', async () => {
    const cache = makeCache();
    const chip = cache.uiComponents.createGroupChip(PROP);
    document.body.appendChild(chip);

    chip.click();
    document.querySelectorAll('.rail-menu.open .rail-menu-item')[0].click();
    await Promise.resolve();
    expect([...layoutOf(cache).g1Props]).toEqual([PROP]);

    chip.click();
    document.querySelectorAll('.rail-menu.open .rail-menu-item')[0].click();
    await Promise.resolve();
    expect(layoutOf(cache).g1Props.size).toBe(0);
  });

  it('names a new group after the property it was made from', async () => {
    const cache = makeCache({});
    cache.bs.createGroup.mockReturnValue('g1');
    const chip = cache.uiComponents.createGroupChip(PROP);
    document.body.appendChild(chip);

    chip.click();
    document.querySelector('.rail-menu.open .rail-menu-item').click();
    await Promise.resolve();

    expect(cache.bs.createGroup).toHaveBeenCalledWith({
      name: 'Node › Topology › degree',
      fromProp: PROP,
    });
  });
});
