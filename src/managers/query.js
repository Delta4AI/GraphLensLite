import {Popup} from "../utilities/popup.js";
import {StaticUtilities} from "../utilities/static.js";

class QueryAST {
  constructor(instructions) {
    this.instructions = instructions;
  }

  /* ===== public API =================================================== */
  testNode(node) {
    return this.#evalExpr(this.instructions, node, /*elemType*/ 'Node filters');
  }

  testEdge(edge) {
    return this.#evalExpr(this.instructions, edge, /*elemType*/ 'Edge filters');
  }

  /* ===== internal helpers ============================================ */
  /**
   * Recursively evaluate any sub-expression.
   * Implements "left-before-right" for chains of arbitrary length.
   */
  #evalExpr(expr, element, requestedMainGroup) {
    if (!Array.isArray(expr)) return false;

    /* ---------- 0. empty query = no constraints = match everything ------ */
    if (expr.length === 0) return true;

    /* ---------- 1. unwrap single-element containers --------------------- */
    if (expr.length === 1) {
      return this.#evalExpr(expr[0], element, requestedMainGroup);
    }

    /* ---------- 2. leaf detection --------------------------------------- */
    const isLeaf =
      expr.length > 0 &&
      !Array.isArray(expr[0]) &&          // first item is NOT another list
      typeof expr[0] === 'object' &&
      expr[0]?.type === 'property';

    if (isLeaf) {
      return this.#evalLeaf(expr, element, requestedMainGroup);
    }

    /* ---------- 3. composite chain  (lhs OP rhs OP rhs2 …) -------------- */
    if (expr.length >= 3 && typeof expr[1] === 'string') {
      // evaluate first operand
      let acc = this.#evalExpr(expr[0], element, requestedMainGroup);

      // walk through the chain left-to-right
      for (let i = 1; i < expr.length; i += 2) {
        const op = expr[i];           // "AND" | "OR" | "NOT"
        const rhs = this.#evalExpr(expr[i + 1], element, requestedMainGroup);

        switch (op) {
          case 'AND':
            acc = acc && rhs;
            break;
          case 'OR':
            acc = acc || rhs;
            break;
          case 'NOT':
            // "lhs NOT rhs"  :=  lhs && !rhs   (specification)
            acc = acc && !rhs;
            break;
          default:
            // should never occur with validated input
            return false;
        }
      }
      return acc;
    }

    /* ---------- 4. nothing matched  ------------------------------------ */
    return false;   // fallback - shouldn't be reached with valid input
  }


  // Evaluate a single property expression
  #evalLeaf(tokens, element, requestedMainGroup) {
    /*  token layout (guaranteed):
          0: property
          1: KW (BETWEEN | LOWER THAN | IN [)
          2+: values / further KW
    */
    const propTok = tokens[0];
    const opTok = tokens[1];  // KW: "BETWEEN" | "LOWER THAN" | "IN [""]
    const value = this.#readValue(element, propTok);

    if (value === undefined || value === null) return false;

    // skip properties of the wrong main group (e.g. node property on an edge)
    if (propTok.main !== requestedMainGroup) return false;

    const propVal = this.#readValue(element, propTok);
    if (propVal === undefined || propVal === null) return false;

    const op = tokens[1].value;

    let validated = false;
    // --- BETWEEN a AND b ------------------------------------------------
    if (op === 'BETWEEN') {
      const lower = tokens[2].value;
      const upper = tokens[4].value;
      validated = typeof propVal === 'number' && propVal >= lower && propVal <= upper;
    }

    // --- LOWER THAN a OR GREATER THAN b -------------------------------
    if (op === 'LOWER THAN') {
      const low = tokens[2].value;  // a
      const high = tokens[4].value;  // b
      validated = typeof propVal === 'number' && (propVal <= low || propVal >= high);
    }

    // --- IN [ a, b, c ] -------------------------------------------------
    if (op.startsWith('IN')) {
      const set = tokens.slice(2).map(t => t.value);
      // Split pipe-separated values and check if any match
      const values = String(propVal).includes('|')
        ? String(propVal).split('|').map(v => v.trim()).filter(v => v !== '')
        : [propVal];
      validated = values.some(val => set.includes(val));
    }

    element.featureIsWithinThreshold.set(tokens[0].propID, validated);
    return validated;
  }

  // Safely pull the data from the D4Data hierarchy
  #readValue(element, {main, sub, prop}) {
    try {
      return element?.D4Data?.[main]?.[sub]?.[prop];
    } catch {
      return undefined;
    }
  }
}


class QueryManager {
  #validationTimer = 0;

  constructor(cache) {
    this.cache = cache;
  }

  encodeQuery(asciiStr) {
    this.cache.query.valid = true;

    const space = `<span class='q-space' data-encoded> </span>`;

    // ------------------------------------------------------------------
    // 1. Check for empty query
    // ------------------------------------------------------------------
    if (!asciiStr) {
      this.cache.query.valid = false;
    }

    // ------------------------------------------------------------------
    // 2. Check for empty instructions "()"
    // ------------------------------------------------------------------
    asciiStr = asciiStr.replace(
      /\(\s*\)/g,
      match => {
        this.cache.query.valid = false;
        return `<span class="q-error-empty-instruction" data-encoded>${match}</span>`;
      }
    );

    // ------------------------------------------------------------------
    // 3. Check for missing connectors between instructions ")("
    // ------------------------------------------------------------------
    asciiStr = asciiStr.replace(
      /\)\s*\(/g,
      match => {
        this.cache.query.valid = false;
        return (
          `<span class="q-error-missing-connector" data-encoded>` +
          match +
          `</span>`
        );
      }
    );

    /* ------------------------------------------------------------------ */
    /* 4. Encode Property names (main group::sub group::property)                */
    /* ------------------------------------------------------------------ */
    asciiStr = asciiStr.replace(
      /(Node filters|Edge filters)::([^:]+)::([^:]+)(?=\s(?:IN|BETWEEN|LOWER\sTHAN|\)))/g,
      (match, mainGroup, subGroup, prop) => {
        const mgok = mainGroup in this.cache.uniquePropHierarchy;
        const sgok = mgok && (subGroup in this.cache.uniquePropHierarchy[mainGroup]);
        const pok = sgok && this.cache.uniquePropHierarchy[mainGroup][subGroup].has(prop);

        const mainGroupEncoded = `<span class="${mgok ? 'q-maingroup' : 'q-error-unrecognized'}" data-encoded>${StaticUtilities.escapeHtml(mainGroup)}</span>`;
        const subGroupEncoded = `<span class="${sgok ? 'q-subgroup' : 'q-error-unrecognized'}" data-encoded>${StaticUtilities.escapeHtml(subGroup)}</span>`;
        const propEncoded = `<span class="${pok ? 'q-property' : 'q-error-unrecognized'}" data-encoded>${StaticUtilities.escapeHtml(prop)}</span>`;
        const sep = `<span class="q-prop-group-separator" data-encoded>::</span>`;

        return `<span class="q-property-wrapper" data-encoded>`
          + mainGroupEncoded + sep
          + subGroupEncoded + sep
          + propEncoded
          + `</span>`;
      }
    );

    /* ------------------------------------------------------------------ */
    /* 5. Encode filters in instructions                                  */
    /* ------------------------------------------------------------------ */

    /* 5-1 Numerical Values (Slider): "BETWEEN X AND Y" --------- */
    asciiStr = asciiStr.replace(
      /(BETWEEN)\s+(-?\d+(?:\.\d+)?)\s+(AND)\s+(-?\d+(?:\.\d+)?)/gi,
      (_m, betweenKw, low, andKw, high) =>
        `<span class='q-kw-between' data-encoded>${betweenKw}</span>`
        + space
        + `<span class='q-number' data-encoded>${low}</span>`
        + space
        + `<span class='q-kw-between-and' data-encoded>${andKw}</span>`
        + space
        + `<span class='q-number' data-encoded>${high}</span>`
    );

    /* 5-2 Inverted Numerical Values (Slider): "LOWER THAN X OR GREATER THAN Y" ------ */
    asciiStr = asciiStr.replace(
      /(LOWER THAN)\s+(-?\d+(?:\.\d+)?)\s+(OR GREATER THAN)\s+(-?\d+(?:\.\d+)?)/gi,
      (_m, lowerThanKw, low, andGreaterThanKw, high) =>
        `<span class='q-lower-than' data-encoded>${lowerThanKw}</span>`
        + space
        + `<span class='q-number' data-encoded>${low}</span>`
        + space
        + `<span class='q-or-greater-than' data-encoded>${andGreaterThanKw}</span>`
        + space
        + `<span class='q-number' data-encoded>${high}</span>`
    );

    /* 5-3 Categorical Values (Dropdown): "IN [" up to "]"  --------- */
    asciiStr = asciiStr.replace(/IN\s*\[((?:\\.|[^\]\\])*)]/g, (_match, list) => {
        const encodedCategories = StaticUtilities.splitQueryList(list)
          .map(cat => `<span class='q-string' data-encoded>${StaticUtilities.escapeHtml(cat)}</span>`)
          .join(`<span class='q-comma' data-encoded>,</span>`);

        return [
          `<span class='q-in-cat-bracket-open' data-encoded>IN${space}[</span>`,
          encodedCategories,
          `<span class='q-cat-bracket-close' data-encoded>]</span>`
        ].join("");
      }
    );

    /* ------------------------------------------------------------------ */
    /* 6.  Top-level connectors  ") OR ("  /  ") AND ("  /  ") NOT ("     */
    /* ------------------------------------------------------------------ */
    const connectorOpeningBracket = `<span class='q-connector-opening-bracket' data-encoded>(</span>`;
    const connectorClosingBracket = `<span class='q-connector-closing' data-encoded>)</span>`;

    asciiStr = asciiStr.replace(
      /\)\s*(OR|AND|NOT)\s*\(/gi,
      (_m, connector) =>
        connectorClosingBracket
        + `<span class='q-connector-${connector.toLowerCase()}' data-encoded>`
        + ' '
        + connector.toUpperCase()
        + ' '
        + `</span>`
        + connectorOpeningBracket
    );

    /* ------------------------------------------------------------------ */
    /* 7. Brackets with depth tracking (plain-text chunks only)           */
    /* ------------------------------------------------------------------ */
    const bracketChunks = asciiStr.split(/(<span\b[^>]*data-encoded[^>]*>[\s\S]*?<\/span>)/g);

    // collect bracket positions from plain-text chunks only
    const plainBrackets = [];
    bracketChunks.forEach((chunk, ci) => {
      if (chunk.startsWith('<span') && chunk.includes('data-encoded')) return;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === '(' || chunk[i] === ')') {
          plainBrackets.push({ chunkIdx: ci, charIdx: i, char: chunk[i] });
        }
      }
    });

    // find unmatched brackets among plain-text brackets
    const unmatchedSet = new Set();
    const stack = [];
    plainBrackets.forEach((b, idx) => {
      if (b.char === '(') {
        stack.push(idx);
      } else {
        if (stack.length) stack.pop();
        else unmatchedSet.add(idx);
      }
    });
    stack.forEach(idx => unmatchedSet.add(idx));

    if (unmatchedSet.size) {
      this.cache.query.valid = false;
    }

    // wrap brackets in plain-text chunks with depth-aware coloring
    let bracketLevel = 0;
    let bracketIdx = 0;

    asciiStr = bracketChunks.map(chunk => {
      if (chunk.startsWith('<span') && chunk.includes('data-encoded')) return chunk;

      return [...chunk].map(ch => {
        if (ch === '(') {
          bracketLevel++;
          const lvl = Math.min(bracketLevel, 5);
          const cls = [
            `q-bracket-open-lvl-${lvl}`,
            unmatchedSet.has(bracketIdx) ? 'q-error-unmatched-opening-bracket' : ''
          ].join(' ');
          bracketIdx++;
          return `<span class='${cls.trim()}' data-encoded>(</span>`;
        }

        if (ch === ')') {
          const lvl = Math.min(bracketLevel, 5);
          const cls = [
            `q-bracket-close-lvl-${lvl}`,
            unmatchedSet.has(bracketIdx) ? 'q-error-unmatched-closing-bracket' : ''
          ].join(' ');
          bracketIdx++;
          const html = `<span class='${cls.trim()}' data-encoded>)</span>`;
          bracketLevel = Math.max(bracketLevel - 1, 0);
          return html;
        }

        return ch;
      }).join('');
    }).join('');

    // ------------------------------------------------------------------
    // 8. substitute &nbsp; with space span (important for copy/paste)
    // ------------------------------------------------------------------
    asciiStr = asciiStr
      // split into "already encoded" vs "plain" parts
      .split(/(<span\b[^>]*data-encoded[^>]*>[\s\S]*?<\/span>)/g)
      .map(chunk => {
        // keep every part that is already marked as encoded
        if (chunk.startsWith('<span') && chunk.includes('data-encoded')) {
          return chunk;
        }
        // in all other chunks replace real blanks, NBSP (char 160) and "&nbsp;"
        // with the standard encoded-space element
        return chunk
          .replace(/&nbsp;|\u00a0| /g, space);
      })
      .join('');

    // ------------------------------------------------------------------
    // 9. Check for instructions without filters (no "IN|BETWEEN|LOWER THAN after property)
    // TODO: not working
    // ------------------------------------------------------------------

    // asciiStr = asciiStr.replace(
    //   /\(([^)]+?::[^)]+?::[^)]+?)(?=\s*\))/g,
    //   (match, prop) => {
    //     this.cache.query.valid = false;
    //     return `<span class="q-error-missing-filter" data-encoded>${match}</span>`;
    //   }
    // );

    // ------------------------------------------------------------------
    // 10. wrap everything not already in a <span class='q-…'>…</span> as an error
    // ------------------------------------------------------------------
    asciiStr = asciiStr
      // split out only the already-encoded chunks vs everything else
      .split(/(<span\b[^>]*data-encoded[^>]*>[\s\S]*?<\/span>)/g)
      .map(chunk => {
        // if it's one of our data-encoded spans, keep it
        if ((chunk.startsWith('<span') && chunk.includes('data-encoded'))
          || chunk === "" || chunk === "</span> " || chunk === "</span>" || chunk === "[</span>") {
          return chunk;
        }

        this.cache.query.valid = false;
        return chunk.replace(/\S+/g, txt =>
          `<span class="q-error-unrecognized">${txt}</span>`
        );
      })
      .join('');

    const updateQueryBtn = document.getElementById("queryUpdateBtn");
    const selectQueryBtn = document.getElementById("querySelectBtn");
    if (this.cache.query.valid) {
      updateQueryBtn.classList.remove("disabled");
      selectQueryBtn.classList.remove("disabled");
    } else {
      updateQueryBtn.classList.add("disabled");
      selectQueryBtn.classList.add("disabled");
    }

    return asciiStr;
  }

  updateQueryTextArea() {
    let queryStr = this.cache.data.layouts[this.cache.data.selectedLayout]["query"] || "";

    if (!queryStr) {
      let queryEntries = [];
      for (const [propID, fo] of this.cache.data.layouts[this.cache.data.selectedLayout].filters.entries()) {
        if (fo.active) {
          if (fo.isCategory) {
            queryEntries.push(`${propID} IN [${[...fo.categories].map(cat => StaticUtilities.escapeQueryValue(cat)).join(",")}]`);
          } else if (fo.isInverted) {
            queryEntries.push(`${propID} LOWER THAN ${fo.upperThreshold} OR GREATER THAN ${fo.lowerThreshold}`);
          } else {
            queryEntries.push(`${propID} BETWEEN ${fo.lowerThreshold} AND ${fo.upperThreshold}`);
          }
        }
      }

      if (queryEntries.length) {
        queryStr = `(${queryEntries.join(") OR (")})`;
      }
    }

    this.cache.query.text.textContent = queryStr;
    this.cache.query.overlay.innerHTML = this.encodeQuery(queryStr);
  }

  clearQuery() {
    this.cache.query.text.textContent = "";
    this.handleQueryValidationEvent(true);
    this.cache.query.caret.style.display = "none";
  }

  getCursorPosition() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;

    const range = sel.getRangeAt(0).cloneRange();
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(this.cache.query.text);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  }

  setCursorPosition(charIndex) {
    const root = this.cache.query.text;
    charIndex = Math.max(0, Math.min(charIndex, root.textContent.length));

    const range = document.createRange();
    const sel = window.getSelection();

    let currentPos = 0;
    let found = false;

    function traverseNodes(node) {
      if (found) return;

      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.length;
        if (currentPos + length >= charIndex) {
          range.setStart(node, charIndex - currentPos);
          range.collapse(true);
          found = true;
          return;
        }
        currentPos += length;
      } else {
        for (const child of node.childNodes) {
          traverseNodes(child);
        }
      }
    }

    traverseNodes(root);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  moveCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      this.cache.query.caret.style.display = 'none';
      return;
    }

    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);

    let tmpQuery = this.cache ? this.cache.query : window.cache.query;

    const rect = range.getBoundingClientRect();
    const parentRect = tmpQuery.text.getBoundingClientRect();

    if (!rect || !rect.height) {
      return;
    }

    const overlapsVert = rect.bottom > parentRect.top && rect.top < parentRect.bottom;
    const overlapsHoriz = rect.right > parentRect.left && rect.left < parentRect.right;

    if (!(overlapsVert && overlapsHoriz)) {
      tmpQuery.caret.style.display = 'none';
      return;
    }

    tmpQuery.caret.style.display = 'block';
    tmpQuery.caret.style.left = `${rect.left - parentRect.left}px`;
    tmpQuery.caret.style.top = `${rect.top - parentRect.top}px`;
    tmpQuery.caret.style.height = `${rect.height}px`;
  }

  handleQueryValidationEvent(immediate) {
    if (immediate) {
      clearTimeout(this.#validationTimer);
      this.#runValidation();
      return;
    }
    clearTimeout(this.#validationTimer);
    this.#validationTimer = setTimeout(() => this.#runValidation(), 40);
  }

  #runValidation() {
    // proactively sync overlay width before rebuilding HTML
    this.cache.query.overlay.style.width = `${this.cache.query.text.offsetWidth}px`;

    this.cache.query.overlay.innerHTML = this.encodeQuery(this.cache.query.text.textContent);
    this.cache.query.overlay.scrollTop = this.cache.query.text.scrollTop;
    this.cache.query.overlay.scrollLeft = this.cache.query.text.scrollLeft;

    if (this.cache.query.valid) {
      this.cache.data.layouts[this.cache.data.selectedLayout]["query"] = this.cache.query.text.textContent;
    } else {
      this.cache.data.layouts[this.cache.data.selectedLayout]["query"] = undefined;
    }
  }

  async handleQueryUpdateEvent() {
    this.cache.EVENT_LOCKS.QUERY_UPDATE_EVENT = true;
    this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
    try {
      this.updateUIFromQueryInstructions();
      this.cache.ui.updateFilterLockState(); // Show lock status bar
      await this.cache.fm.handleFilterEvent("Updating Graph from Query", this.cache.query.text.textContent, null, false);
    } finally {
      this.cache.EVENT_LOCKS.QUERY_UPDATE_EVENT = false;
    }
  }

  async handleQuerySelectEvent() {
    await this.cache.ui.showLoading("Updating Selection", `Modifying selection from query`);
    await new Promise(resolve => requestAnimationFrame(resolve));

    this.cache.EVENT_LOCKS.QUERY_SELECTION_EVENT = true;

    this.decodeQueryAndBuildAST();

    const nodeIDsToSelect = this.cache.nodeRef.values()
      .filter(node => this.cache.query.ast.testNode(node) && this.cache.nodeIDsToBeShown.has(node.id))
      .map(node => node.id);

    const edgeIDsToSelect = this.cache.edgeRef.values()
      .filter(edge => this.cache.query.ast.testEdge(edge) && this.cache.edgeIDsToBeShown.has(edge.id))
      .map(edge => edge.id);

    await this.cache.sm.selectNodes(nodeIDsToSelect);
    await this.cache.sm.selectEdges(edgeIDsToSelect);
    await this.cache.ui.hideLoading();
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  /**
   * Turn the HTML produced by `encodeQuery()` back into a nested data
   * structure that mirrors the original logical expression.
   *
   * Returned format (simplified):
   * [
   *   {type: 'property', main:'Node filters', sub:'Label', prop:'name'},
   *   {type: 'KW', value: 'BETWEEN'},
   *   {type: 'NUM', value: 10},
   *   {type: 'KW', value: 'AND'},
   *   {type: 'NUM', value: 20},
   *   'AND',
   *   [                                    // ← nested group (brackets)
   *     {type:'property', …},
   *     'OR',
   *     {type:'property', …}
   *   ]
   * ]
   *
   * The tree can afterwards be compiled into any instruction format you need.
   */
  decodeQuery() {
    /* -------------------------------------------------------------
     * 1.  DOM → token list
     * ----------------------------------------------------------- */
    const tokens = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${this.cache.query.overlay.innerHTML}</div>`, 'text/html');
    const root = doc.body.firstElementChild;        // wrapper <div>

    // helper: map CSS classes → token factory
    const classMap = {
      // connectors
      'q-connector-or': () => 'OR',
      'q-connector-and': () => 'AND',
      'q-connector-not': () => 'NOT',

      // brackets (depth-colored and connector-adjacent)
      'q-bracket-open-lvl-1': () => ({type: '(', value: '('}),
      'q-bracket-open-lvl-2': () => ({type: '(', value: '('}),
      'q-bracket-open-lvl-3': () => ({type: '(', value: '('}),
      'q-bracket-open-lvl-4': () => ({type: '(', value: '('}),
      'q-bracket-open-lvl-5': () => ({type: '(', value: '('}),
      'q-bracket-close-lvl-1': () => ({type: ')', value: ')'}),
      'q-bracket-close-lvl-2': () => ({type: ')', value: ')'}),
      'q-bracket-close-lvl-3': () => ({type: ')', value: ')'}),
      'q-bracket-close-lvl-4': () => ({type: ')', value: ')'}),
      'q-bracket-close-lvl-5': () => ({type: ')', value: ')'}),
      'q-connector-opening-bracket': () => ({type: '(', value: '('}),
      'q-connector-closing': () => ({type: ')', value: ')'}),

      // numbers & keywords
      'q-number': el => ({type: 'NUM', value: Number(el.textContent)}),
      'q-kw-between': () => ({type: 'KW', value: 'BETWEEN'}),
      'q-kw-between-and': () => ({type: 'KW', value: 'AND'}),
      'q-lower-than': () => ({type: 'KW', value: 'LOWER THAN'}),
      'q-or-greater-than': () => ({type: 'KW', value: 'OR GREATER THAN'}),
      'q-in-cat-bracket-open': () => ({type: 'KW', value: 'IN ['}),

      // category strings
      'q-string': el => ({type: 'STR', value: StaticUtilities.unescapeQueryValue(el.textContent)}),

      // whole property path ("A::B::C")
      'q-property-wrapper': el => {
        const [main, sub, prop] = el.textContent.split('::');
        return {type: 'property', main, sub, prop, propID: el.textContent};
      }
    };

    // depth-first walk
    function walk(node) {
      // ignore plain text / spaces
      if (node.nodeType === Node.TEXT_NODE) {
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        for (const cls of node.classList) {
          if (classMap[cls]) {
            const t = classMap[cls](node);
            if (t !== undefined) tokens.push(t);
            // stop after first recognised class
            break;
          }
        }
      }

      node.childNodes.forEach(walk);
    }

    walk(root);

    /* -------------------------------------------------------------
     * 2.  Token list → nested groups     (recursive-descent)
     * ----------------------------------------------------------- */
    function readGroup(idx = 0) {
      const group = [];

      while (idx < tokens.length) {
        const tok = tokens[idx];

        if (tok.type === ')') {               // end of this group
          return [group, idx + 1];
        }

        if (tok.type === '(') {               // begin sub-group
          const [subGroup, next] = readGroup(idx + 1);
          group.push(subGroup);
          idx = next;
          continue;
        }

        group.push(tok);
        idx += 1;
      }

      return [group, idx];                    // top-level done
    }

    const [instructions] = readGroup();       // start at index 0
    return instructions;
  }

  updateUIFromQueryInstructions() {
    this.cache.ui.uncheckAllCheckboxes();
    this.decodeQueryAndBuildAST();

    for (const inst of this.cache.query.ast.instructions) {
      this.refreshUI(inst);
    }
  }

  setFilter(obj) {
    // normal slider
    if (obj[1].type === "KW" && obj[1].value === "BETWEEN") {
      this.cache.ui.checkCheckbox(obj[0].propID, true);
      this.cache.propIDToInvertibleRangeSliders.get(obj[0].propID).setTo(obj[2].value, obj[4].value, false);
    }

    // inverted slider
    else if (obj[1].type === "KW" && obj[1].value === "LOWER THAN") {
      this.cache.ui.checkCheckbox(obj[0].propID, true);
      this.cache.propIDToInvertibleRangeSliders.get(obj[0].propID).setTo(obj[2].value, obj[4].value, true);
    }

    // category
    else if (obj[1].type === "KW" && obj[1].value === "IN [") {
      this.cache.ui.checkCheckbox(obj[0].propID, true);
      const dropdown = this.cache.propIDToDropdownChecklists.get(obj[0].propID);
      dropdown.deselectAllCategories(true);
      for (const dropdownElem of obj) {
        if (dropdownElem.type === "STR") {
          dropdown.selectCategory(dropdownElem.value);
        }
      }
    }
  }

  refreshUI(obj) {
    if (obj.constructor === Array) {
      if (obj[0].constructor === Object && obj[0].type === "property") {
        this.setFilter(obj);
      } else {
        // nested instruction
        for (const nestedInst of obj) {
          this.refreshUI(nestedInst);
        }
      }
    }
  }

  moveCaretToEnd() {
    const el = this.cache.query.text;               // the editable element
    if (!el) return;

    /* -------- textarea / input ---------- */
    if ('selectionStart' in el) {        // true for <input> / <textarea>
      el.selectionStart = el.selectionEnd = el.value.length;
      el.focus();
      return;
    }

    /* -------- contenteditable ----------- */
    const range = document.createRange();
    range.selectNodeContents(el);        // select the whole content
    range.collapse(false);               // collapse to the end

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.focus();
  }

  resetQuery() {
    delete this.cache.data.layouts[this.cache.data.selectedLayout]["query"];
    this.cache.query.text.textContent = "";
    this.cache.query.overlay.innerHTML = "";
    this.updateQueryTextArea();
    this.moveCaretToEnd();

    // Clear filter lock when resetting query
    this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = false;
    this.cache.ui.updateFilterLockState();
  }

  storeQuery() {
    this.cache.query.textCache = this.cache.query.text.textContent;
  }

  restoreQuery() {
    if (this.cache.query.textCache === undefined || this.cache.query.textCache === null || this.cache.query.textCache === "") {
      return;
    }
    this.cache.query.text.textContent = this.cache.query.textCache;
    this.cache.query.overlay.innerHTML = this.encodeQuery(this.cache.query.textCache);
    this.moveCaretToEnd();
    this.cache.query.textCache = null;
  }

  showQueryHelp() {
    this.cache.popup = new Popup(`
<p>Build complex filters using nested AND, OR and NOT expressions.</p>

<div class="alert-warning">
  <strong>⚠️ Important:</strong> Using the filtering UI panel or adding/modifying bubble groups will automatically
  overwrite the this.cache.query. Any custom logic (AND/NOT operators, nested brackets) will be cleared and replaced
  with the UI-generated this.cache.query.
</div>
<div class="alert-info">
  <strong>💡 Tip:</strong> Queries are saved for each workspace and included when exporting the model 💾
</div>

<h3>Available Actions</h3>
<p><strong>Header buttons:</strong></p>
<ul>
  <li><span class="tooltip-dummy-buttons green">🔍 Filter</span> - Apply the query to filter the graph</li>
  <li><span class="tooltip-dummy-buttons blue">🎯 Select</span> - Select all matching elements (without filtering)</li>
  <li><span class="tooltip-dummy-buttons pink">⟳ Sync</span> - Sync query with current UI panel settings</li>
  <li><span class="tooltip-dummy-buttons red">✗ Clear</span> - Remove all query conditions</li>
</ul>
<p><strong>Filtering panel:</strong></p>
<ul>
  <li><span class="add-to-query-button show tt">📝</span> - Add a single parameter to the query</li>
</ul>

<hr>
<h2>Query Syntax Guide</h2>

<h3>Example Query</h3>

<div class="popupQueryContainer">
  <span class="q-bracket-open-lvl-1">(</span>
  <span class="q-property-wrapper"><span class="q-maingroup">${this.cache.CFG.EXCEL_NODE_HEADER}</span><span class="q-prop-group-separator">::</span><span class="q-subgroup">group A</span><span class="q-prop-group-separator">::</span><span class="q-property">prop X</span></span>
  <span class="q-kw-between">BETWEEN</span>
  <span class="q-number">0</span>
  <span class="q-kw-between-and">AND</span>
  <span class="q-number">1.3</span>
  <span class="q-connector-closing"><span class="q-bracket-close-lvl-1">)</span></span>
  <span class="q-connector-or">&nbsp;OR&nbsp;</span>
  <span class="q-connector-opening-bracket"><span class="q-bracket-open-lvl-1">(</span></span>
  <span class="q-property-wrapper"><span class="q-maingroup">${this.cache.CFG.EXCEL_NODE_HEADER}</span><span class="q-prop-group-separator">::</span><span class="q-subgroup">group A</span><span class="q-prop-group-separator">::</span><span class="q-property">prop Y</span></span>
  <span class="q-in-cat-bracket-open">IN<span class="q-space"> </span>[</span>
  <span class="q-string">foo</span>
  <span class="q-comma">,</span>
  <span class="q-string">bar</span>
  <span class="q-cat-bracket-close">]</span>
  <span class="q-connector-closing"><span class="q-bracket-close-lvl-1">)</span></span>
</div>

<h3>Syntax Elements</h3>

<p><strong>1. Properties</strong></p>
<p style="margin-left: 20px; margin-top: -8px;">
  <span class="q-property-wrapper"><span class="q-maingroup">${this.cache.CFG.EXCEL_NODE_HEADER}</span><span class="q-prop-group-separator">::</span><span class="q-subgroup">group A</span><span class="q-prop-group-separator">::</span><span class="q-property">prop X</span></span>
</p>
<ul style="margin-top: -8px;">
  <li>Format: <code>node-or-edge::group::property</code> (<strong>3 levels</strong> separated by <strong>::</strong>)</li>
  <li>Nodes start with <span class="q-property-wrapper"><span class="q-maingroup">${this.cache.CFG.EXCEL_NODE_HEADER}</span><span class="q-prop-group-separator">::</span></span> , edges with <span class="q-property-wrapper"><span class="q-maingroup">${this.cache.CFG.EXCEL_EDGE_HEADER}</span><span class="q-prop-group-separator">::</span></span></li>
  <li>Default group is <span class="q-property-wrapper"><span class="q-subgroup">${this.cache.CFG.EXCEL_UNCATEGORIZED_SUBHEADER}</span></span> if none is defined in the input data</li>
</ul>

<p><strong>2. Filter Instructions</strong></p>
<ul style="margin-top: -8px;">
  <li><span class="q-kw-between">BETWEEN</span>&nbsp;<span class="q-number">0</span>&nbsp;<span class="q-kw-between-and">AND</span>&nbsp;<span class="q-number">1.3</span> - Keep numerical values in range (inclusive)</li>
  <li><span class="q-lower-than">LOWER THAN</span>&nbsp;<span class="q-number">0.2</span>&nbsp;<span class="q-or-greater-than">OR GREATER THAN</span>&nbsp;<span class="q-number">0.8</span> - Keep numerical values ≤ 0.2 or ≥ 0.8</li>
  <li><span class="q-in-cat-bracket-open">IN&nbsp;[</span><span class="q-string">foo</span><span class="q-comma">,</span>&nbsp;<span class="q-string">bar</span><span class="q-cat-bracket-close">]</span> - Keep specific categorical values</li>
</ul>

<p><strong>3. Logical Operators</strong></p>
<ul style="margin-top: -8px;">
  <li><span class="q-connector-or">&nbsp;OR&nbsp;</span> - True if at least one condition is true</li>
  <li><span class="q-connector-and">&nbsp;AND&nbsp;</span> - True if both conditions are true</li>
  <li><span class="q-connector-not">&nbsp;NOT&nbsp;</span> - True if first condition is true and second is false</li>
  <li>⚡ Left-to-right precedence; use parentheses for complex logic</li>
</ul>

<p><strong>4. Grouping with Parentheses</strong></p>
<ul style="margin-top: -8px;">
  <li><span class="q-bracket-open-lvl-1">(</span> <span class="q-bracket-close-lvl-1">)</span> - Group multiple conditions into one logical unit</li>
  <li>Nest to any depth with color coding: <span class="q-bracket-open-lvl-1">(</span><span class="q-bracket-open-lvl-2">(</span><span class="q-bracket-open-lvl-3">(</span><span class="q-bracket-open-lvl-4">(</span><span class="q-bracket-open-lvl-5">(</span><span class="q-bracket-close-lvl-5">)</span><span class="q-bracket-close-lvl-4">)</span><span class="q-bracket-close-lvl-3">)</span><span class="q-bracket-close-lvl-2">)</span><span class="q-bracket-close-lvl-1">)</span></li>
  <li>Unmatched brackets are highlighted: <span class="q-bracket-close-lvl-0 q-error-unmatched-closing-bracket">)</span></li>
</ul>

<p><strong>5. Query Validation</strong></p>
<ul style="margin-top: -8px">
  <li>Invalid syntax is <span class="q-error-unrecognized">highlighted like this</span></li>
</ul>

`, {title: 'Query Editor', width: '80vw', height: '75vh', lineHeight: '1.5em'});
  }

  decodeQueryAndBuildAST() {
    const instructions = this.decodeQuery();
    this.cache.query.ast = new QueryAST(instructions);
  }

  performANDFilterLogic() {
    // we want to kick out elements where not all thresholds are met
    for (let nodeID of this.cache.nodeIDsToBeShown) {
      let propertiesNotWithinThresholds = this.cache.fm.getPropertiesNotWithinThresholds(nodeID, null);
      if (propertiesNotWithinThresholds.length > 0) {
        this.cache.nodeIDsToBeShown.delete(nodeID);
        this.cache.fm.removeFromPropIDsToNodeIDsToBeShown(nodeID);
      }
    }

    for (let edgeID of this.cache.edgeIDsToBeShown) {
      let propertiesNotWithinThresholds = this.cache.fm.getPropertiesNotWithinThresholds(null, edgeID);
      if (propertiesNotWithinThresholds.length > 0) {
        this.cache.edgeIDsToBeShown.delete(edgeID);
        this.cache.fm.removeFromPropIDsToEdgeIDsToBeShown(edgeID);
      } else {
        // we have edges in an AND-filtered graph, so we want to remember the connected nodes, since all other dangling
        // nodes should be removed
        const [source, target] = edgeID.split("::");
        this.cache.remainingEdgeRelatedNodes.add(source);
        this.cache.remainingEdgeRelatedNodes.add(target);
      }
    }
  }

  validateAlignment() {
    // proactively sync overlay width to text element on every resize
    this.cache.query.overlay.style.width = `${this.cache.query.text.offsetWidth}px`;

    const mText = StaticUtilities.getLineMetrics(this.cache.query.text);
    const mOverlay = StaticUtilities.getLineMetrics(this.cache.query.overlay);
    const linesMatch = mText.lines === mOverlay.lines;
    const lastWidthMatch = Math.abs(mText.lastLineWidth - mOverlay.lastLineWidth) <= 1;

    if (linesMatch && lastWidthMatch) {
      this.cache.query.lastGoodWidth = this.cache.query.text.offsetWidth;
      return;
    }

    // fallback: if still misaligned after proactive sync, lock at last known good width
    if (this.cache.query.lastGoodWidth > 0) {
      this.cache.query.text.style.width = `${this.cache.query.lastGoodWidth}px`;
      this.cache.query.overlay.style.width = `${this.cache.query.lastGoodWidth}px`;
    }
  }
}

export {QueryManager, QueryAST};