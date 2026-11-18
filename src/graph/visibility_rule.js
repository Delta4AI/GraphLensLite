/**
 * The workspace settings that decide visibility around the filter query.
 *
 * The join toggle picks one of two ways to use the filter rows:
 * - "build up" (stored as filterJoinMode OR): start from nothing, and every
 *   ticked row ADDS the elements it matches — so nothing ticked shows nothing;
 * - "narrow down" (AND): start from everything, and every narrowed row cuts
 *   away — so nothing narrowed shows everything.
 *
 * In build-up, links between the shown nodes follow an explicit choice
 * (`filterLinks`) instead of hanging off whether an edge row happens to be
 * ticked: "all" shows every link between shown nodes, "ticked" only those an
 * edge row matches (and brings their end nodes along), "none" no links.
 * Elements without any filterable property follow `includePropertyless` in
 * both modes.
 */

const FILTER_LINKS = ['all', 'ticked', 'none'];

/**
 * A workspace's build-up settings with their defaults: every link and every
 * element, which is how a workspace without them (an older file) looked.
 * The loader and visibilityRule both read them through here.
 * @returns {{filterLinks: string, includePropertyless: boolean}}
 */
function visibilitySettings(layout) {
  return {
    filterLinks: FILTER_LINKS.includes(layout?.filterLinks) ? layout.filterLinks : 'all',
    includePropertyless: layout?.includePropertyless !== false,
  };
}

/**
 * @param {object} layout  workspace (filters Map, filterJoinMode, query, …)
 * @param {string} edgeSection  the edge section's prefix (CFG.EXCEL_EDGE_HEADER)
 * @returns {{buildUp: boolean, nothingTicked: boolean, links: string,
 *   includePropertyless: boolean, tickedNodeRows: number, tickedEdgeRows: number}}
 */
function visibilityRule(layout, edgeSection) {
  const buildUp = layout?.filterJoinMode !== 'AND';
  let tickedNodeRows = 0;
  let tickedEdgeRows = 0;
  for (const [propID, filter] of layout?.filters ?? []) {
    if (!filter?.active || filter.unusable) continue;
    if (propID.startsWith(`${edgeSection}::`)) tickedEdgeRows += 1;
    else tickedNodeRows += 1;
  }
  const { filterLinks, includePropertyless } = visibilitySettings(layout);
  return {
    buildUp,
    // Only a query the rows built: a hand-typed one keeps the query
    // language's own rule (an empty query matches everything).
    nothingTicked: buildUp && !layout?.query && tickedNodeRows + tickedEdgeRows === 0,
    links: filterLinks,
    includePropertyless,
    tickedNodeRows,
    tickedEdgeRows,
  };
}

/**
 * Whether a featured edge shows, given whether the query matched it and
 * whether both its end nodes are shown. In build-up with "ticked" links, a
 * matched edge has already pulled its end nodes in.
 */
function edgeShown(rule, { matches, endsShown }) {
  if (!rule.buildUp) return endsShown && matches;
  if (rule.links === 'all') return endsShown;
  if (rule.links === 'ticked') return matches;
  return false;
}

/** Whether an element without filterable properties shows. */
function propertylessShown(rule, { isEdge, endsShown = true }) {
  if (!rule.includePropertyless) return false;
  if (!isEdge) return true;
  if (rule.buildUp && rule.links === 'none') return false;
  return endsShown;
}

export { FILTER_LINKS, visibilitySettings, visibilityRule, edgeShown, propertylessShown };
