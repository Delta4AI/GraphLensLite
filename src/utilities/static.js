class StaticUtilities {
  static isString(value) {
    return typeof value === 'string' || value instanceof String;
  }

  /**
   * Strip characters the query DSL's AST cannot handle from property names
   * and categorical values.
   */
  static sanitizeForAST(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/\(/g, '{')
      .replace(/\)/g, '}')
      .replace(/\[/g, '{')
      .replace(/]/g, '}')
      .replace(/:/g, '-')
      .replace(/,/g, ' ')
      .replace(/&/g, 'and')
      .replace(/</g, 'less')
      .replace(/>/g, 'greater')
      .replace(/"/g, '')
      .replace(/'/g, '')
      .replace(/\\/g, '')
      .replace(/\//g, ' or ');
  }

  /**
   * Escape a value for safe interpolation into an HTML string. Use at every
   * boundary where untrusted text (node/edge/property names, layout names,
   * query fragments loaded from files) is concatenated into innerHTML.
   * @param {*} value
   * @returns {string}
   */
  static escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static isNumber(value) {
    const parsed = parseFloat(value);
    return !isNaN(parsed) && isFinite(parsed);
  }

  static isInList(value, allowedValues) {
    return allowedValues.includes(value);
  }

  static isBoolean(value) {
    if (typeof value === 'boolean') {
      return true;
    }
    if (typeof value === 'string') {
      const lowerVal = value.trim().toLowerCase();
      return lowerVal === 'true' || lowerVal === 'false';
    }
    if (typeof value === 'number') {
      return value === 1 || value === 0;
    }
    return false;
  }

  /**
   * Canonical boolean value of a user-data token, per the Excel template's
   * stated encoding ("true or TRUE or 1, false or FALSE or 0"): returns
   * 'true', 'false', or null when the value is not a boolean encoding.
   * Unlike isBoolean above (reserved style columns), this also accepts the
   * string forms '1'/'0', which is how spreadsheet cells usually arrive.
   */
  static booleanTokenValue(value) {
    const norm = String(value).trim().toLowerCase();
    if (norm === 'true' || norm === '1') return 'true';
    if (norm === 'false' || norm === '0') return 'false';
    return null;
  }

  static isHexColor(value) {
    if (!this.isString(value)) return false;
    const hexRegex = /^#(?:[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/;
    return hexRegex.test(value.trim());
  }

  static getReadableForegroundColor(hex) {
    if (hex === "#00000000") return "#000000"
    hex = hex.replace(/^#/, "");
    let r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.substring(0, 2), 16);
    let g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.substring(2, 4), 16);
    let b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.substring(4, 6), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 186 ? "#000000" : "#FFFFFF";
  }

  /**
   * Recursively merges properties from `source` into `target`.
   * - Existing properties in `target` remain if not in `source`.
   * - Matching keys in `source` overwrite `target`.
   * - New keys are added to `target`.
   */
  static deepMerge(target, source) {
    if (!this.isObject(target) || !this.isObject(source)) return;

    for (const [key, value] of Object.entries(source)) {
      // If both target and value are objects, recurse into them
      if (this.isObject(value) && this.isObject(target[key])) {
        this.deepMerge(target[key], value);
      } else {
        // Otherwise, just overwrite
        target[key] = value;
      }
    }
  }

  static isObject(obj) {
    return obj !== null && typeof obj === "object" && !Array.isArray(obj);
  }

  static arraysAreEqual(a, b) {
    if (a === b) return true;       // Same reference
    if (!a || !b) return false;     // One is undefined/null
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  static isInteger(value) {
    return value % 1 === 0;
  }

  static formatNumber(value, precision) {
    return this.isInteger(value) ? value : parseFloat(value).toFixed(precision);
  }

  static getLineMetrics(el) {
    if (!el || !el.firstChild) {
      return {lines: 0, lastLineWidth: 0};
    }

    const range = document.createRange();
    range.selectNodeContents(el);

    // All rectangles created by the text flow.
    const rects = Array.from(range.getClientRects());

    // Group by the rectangle's top coordinate (≈ line-id).
    // Using a rounded value avoids sub-pixel duplicates.
    const groups = new Map(); // top -> [rects]

    rects.forEach(rc => {
      const key = Math.round(rc.top);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rc);
    });

    // Number of distinct "top" positions ⇒ line count.
    const lines = groups.size;
    if (lines === 0) return {lines: 0, lastLineWidth: 0};

    // Get rects belonging to the last (visually lowest) line.
    const lastTop = Math.max(...groups.keys());
    const lastRects = groups.get(lastTop);

    // Combine segments to obtain total visual width of that line.
    // (If inline spans break the line into pieces, merge them.)
    const left = Math.min(...lastRects.map(r => r.left));
    const right = Math.max(...lastRects.map(r => r.right));
    const lastLineWidth = Math.round(right - left);

    return {lines, lastLineWidth};
  }

  static generatePropHashId(section, subSection, prop) {
    return `${section}::${subSection}::${prop}`;
  }

  static decodePropHashId(propId) {
    return propId.split("::");
  }

  // The query DSL uses [ ] , ( ) and \ as grammar. Categorical values can
  // contain any of these (e.g. free-text "Evidence sample" cells), so they are
  // backslash-escaped when written into a query string and unescaped when the
  // query is decoded back into category tokens.
  static escapeQueryValue(value) {
    return String(value).replace(/[\\[\],()]/g, "\\$&");
  }

  static unescapeQueryValue(value) {
    return String(value).replace(/\\(.)/g, "$1");
  }

  // Split a category list on unescaped commas only, keeping escape sequences
  // intact in each token (they are unescaped later, at decode time).
  static splitQueryList(listStr) {
    const out = [];
    let cur = "";
    for (let i = 0; i < listStr.length; i++) {
      const ch = listStr[i];
      if (ch === "\\" && i + 1 < listStr.length) {
        cur += ch + listStr[i + 1];
        i++;
        continue;
      }
      if (ch === ",") {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  // Decide where a dropdown panel should open relative to its anchor: flip
  // upward when there is more room above than below, and cap the height (with
  // scroll) to the chosen side so it never spills past the window edge.
  // Pure function of measured geometry so the flip logic stays unit-testable.
  static computeDropdownPlacement({anchorRect, dropdownHeight, viewportHeight, margin = 4}) {
    const spaceBelow = viewportHeight - anchorRect.bottom - margin;
    const spaceAbove = anchorRect.top - margin;
    const openUp = dropdownHeight > spaceBelow && spaceAbove > spaceBelow;
    const available = Math.max(0, openUp ? spaceAbove : spaceBelow);
    const height = Math.min(dropdownHeight, available);
    return {
      openUp,
      left: anchorRect.left - 3,
      top: openUp ? anchorRect.top - height : anchorRect.bottom,
      maxHeight: dropdownHeight > available ? available : null,
    };
  }

  static setsAreEqual(setA, setB) {
    if (setA.size !== setB.size) return false;
    for (let item of setA) {
      if (!setB.has(item)) return false;
    }
    return true;
  }

  static formatPropsAsTree(propID = undefined, section = undefined, subSection = undefined, prop = undefined) {
    if (propID) {
      const decoded = this.decodePropHashId(propID);
      section = decoded[0];
      subSection = decoded[1];
      prop = decoded[2];
    }

    let retStr = `\n └─ ${section}`;
    if (subSection) retStr += `\n        └─ ${subSection}`;
    if (prop) retStr += `\n                └─ ${prop}`;
    return retStr;
  }

  static humanFileSize(size) {
    let i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return +((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
  }

  static getTimestamp(includeMilliseconds = false) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    if (includeMilliseconds) {
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      return `${hh}:${mm}:${ss}.${ms}`;
    }
    return `${hh}:${mm}:${ss}`;
  }

  /**
   * True iff dotted-numeric version `a` is strictly newer than `b`
   * (e.g. "1.16.0" > "1.15.0"). Missing trailing segments count as 0
   * ("1.15.1" > "1.15"). Returns false for equal versions or any
   * non-string / non-numeric / malformed input (empty or non-numeric
   * segments, pre-release suffixes), so callers never warn on bad data.
   */
  static isVersionNewer(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    // Empty segments ("1..0") must reject, not coerce to 0 via Number("").
    const toNums = (v) => v.split(".").map((s) => (s === "" ? NaN : Number(s)));
    const pa = toNums(a);
    const pb = toNums(b);
    if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return false;
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (x !== y) return x > y;
    }
    return false;
  }
}

export {StaticUtilities}