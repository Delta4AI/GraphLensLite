/**
 * The 🧩 Auto-detect menu: pick the edge property to weight Louvain by, the
 * resolution, and how many of the largest communities to turn into groups.
 *
 * Built on RailMenu like group_menu.js, which is what buys the Escape handler,
 * `aria-expanded`, close-on-scroll and focus restore — the hand-rolled popover
 * this replaced had only outside-pointerdown, and it lived in the graph model
 * where DOM does not belong.
 */
import { RailMenu } from './rail.js';
import { clampCommunityGroups, MIN_COMMUNITY_GROUPS, MAX_COMMUNITY_GROUPS, DEFAULT_COMMUNITY_GROUPS } from '../graph/bubble_sets.js';

/** One menu per anchor: the Groups card is rebuilt on every graph load. */
const attached = new WeakMap();

/**
 * Attach (or re-attach) the menu to its button.
 *
 * @param {HTMLElement} anchor  #detectCommunitiesBtn
 * @param {object} bs  the bubble-set manager (owns communityOptions + the run)
 * @returns {RailMenu}
 */
export function attachCommunityMenu(anchor, bs) {
  attached.get(anchor)?.destroy();
  const menu = new RailMenu(anchor, (el) => build(el, menu, bs));
  attached.set(anchor, menu);
  return menu;
}

function build(el, menu, bs) {
  el.classList.add('community-detection-popover');
  // Resolve the default weight on open, and re-default whenever the stored
  // property is gone (the data was reloaded), so the dropdown selection and the
  // stored option never drift apart.
  // A graph with no numeric edge property (and a half-built cache in tests)
  // still gets the menu — weighting is optional, topology-only is the fallback.
  const numericProps = bs.getNumericEdgeProperties?.() ?? [];
  const stored = bs.communityOptions.weightProperty;
  const storedExists = stored === null || numericProps.some((p) => p.propHash === stored);
  if (stored === undefined || !storedExists) {
    bs.communityOptions.weightProperty = defaultWeightProperty(numericProps);
  }

  const title = document.createElement("div");
  title.className = "community-popover-title";
  title.textContent = "Detect communities (Louvain)";
  el.appendChild(title);

  // Weight dropdown ------------------------------------------------------
  const weightLabel = document.createElement("label");
  weightLabel.className = "community-popover-row";
  weightLabel.textContent = "Weight by";
  const weightSelect = document.createElement("select");
  weightSelect.className = "community-popover-select";
  const topoOpt = document.createElement("option");
  topoOpt.value = "";
  topoOpt.textContent = "Unweighted (topology)";
  weightSelect.appendChild(topoOpt);
  for (const p of numericProps) {
    const opt = document.createElement("option");
    opt.value = p.propHash;
    opt.textContent = p.label;
    weightSelect.appendChild(opt);
  }
  weightSelect.value = bs.communityOptions.weightProperty ?? "";
  weightSelect.addEventListener("change", (e) => {
    bs.communityOptions.weightProperty = e.target.value || null;
  });
  weightLabel.appendChild(weightSelect);
  el.appendChild(weightLabel);

  // Resolution slider ----------------------------------------------------
  const resRow = document.createElement("label");
  resRow.className = "community-popover-row";
  const resText = document.createElement("span");
  const setResText = (v) => { resText.textContent = `Resolution: ${Number(v).toFixed(2)}`; };
  setResText(bs.communityOptions.resolution);
  const resSlider = document.createElement("input");
  resSlider.type = "range";
  resSlider.min = "0.25";
  resSlider.max = "4";
  resSlider.step = "0.05";
  resSlider.value = String(bs.communityOptions.resolution);
  resSlider.className = "community-popover-slider";
  resSlider.addEventListener("input", (e) => {
    bs.communityOptions.resolution = parseFloat(e.target.value);
    setResText(e.target.value);
  });
  resRow.append(resText, resSlider);
  el.appendChild(resRow);

  // How many groups to create -------------------------------------------
  // Used to be fixed at 4 because that was all there were. Now it is the
  // number of NEW groups the run adds; existing ones are left alone.
  const countRow = document.createElement("label");
  countRow.className = "community-popover-row";
  countRow.textContent = "Groups";
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = String(MIN_COMMUNITY_GROUPS);
  countInput.max = String(MAX_COMMUNITY_GROUPS);
  countInput.step = "1";
  countInput.className = "community-popover-count";
  countInput.value = String(bs.communityOptions.groupCount ?? DEFAULT_COMMUNITY_GROUPS);
  countInput.title = "How many of the largest communities to turn into groups";
  countInput.addEventListener("change", () => {
    const n = clampCommunityGroups(countInput.value);
    bs.communityOptions.groupCount = n;
    countInput.value = String(n);
  });
  countRow.appendChild(countInput);
  el.appendChild(countRow);

  // Detect button --------------------------------------------------------
  const detectBtn = document.createElement("button");
  detectBtn.className = "community-popover-detect nw-button";
  detectBtn.textContent = "Detect";
  detectBtn.addEventListener("click", async () => {
    menu.close();
    await bs.detectCommunities();
  });
  el.appendChild(detectBtn);
}

// Default weight: STRING's "Combined Score" when present, else topology-only
// (null) so generic graphs keep the original unweighted behaviour.
function defaultWeightProperty(numericProps) {
  const combined = numericProps.find((p) => /combined\s*score/i.test(p.prop));
  return combined ? combined.propHash : null;
}
