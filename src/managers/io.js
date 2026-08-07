/* global ExcelJS */ // loaded as a global via vendored src/lib/exceljs.min.js script tag
import { VERSION, bubbleGroupStyle, UNSAFE_OBJECT_KEYS } from '../config.js';
import { sanitizeAnnotations, MAX_ANNOTATIONS } from '../graph/annotation_geometry.js';
import { StaticUtilities } from '../utilities/static.js';
import { EXPORT_SCALES } from '../utilities/export_scale.js';
import { excelData, EXCEL_NODE_PROPERTIES, EXCEL_EDGE_PROPERTIES } from './excel_schema.js';
import { ExcelTemplate } from './excel_template.js';

const EXPORT_SCALE_KEY = 'gll.exportScale';
// Grace period before revoking an SVG download's blob URL: long enough for
// any browser to start (and realistically finish) fetching the blob, short
// enough not to pin big documents in memory for the whole session.
const SVG_URL_REVOKE_DELAY_MS = 60_000;

function readExportScale() {
  try {
    const stored = Number(window.localStorage.getItem(EXPORT_SCALE_KEY));
    return EXPORT_SCALES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function writeExportScale(scale) {
  try {
    window.localStorage.setItem(EXPORT_SCALE_KEY, String(scale));
  } catch {
    /* storage unavailable — resolution choice just won't persist */
  }
}

/**
 * Which bubble groups a SAVED layout carries. `bubbleSetStyle` is the authority
 * whenever the file has one — an empty object means "this workspace has no
 * groups", which is a real state, not a missing field. Only a file that predates
 * `bubbleSetStyle` entirely falls back to inferring groups from its
 * `${group}Props` / `${group}ManualMembers` keys, so a pre-1.17 model does not
 * lose the groups it stored.
 * @param {object} layout raw, unparsed layout from the JSON model
 * @returns {string[]} group keys
 */
function savedLayoutGroupKeys(layout) {
  if (layout?.bubbleSetStyle) return Object.keys(layout.bubbleSetStyle);
  const derived = new Set();
  for (const key of Object.keys(layout ?? {})) {
    for (const suffix of ['ManualMembers', 'Props']) {
      if (key.length > suffix.length && key.endsWith(suffix)) {
        derived.add(key.slice(0, -suffix.length));
      }
    }
  }
  return [...derived];
}

/**
 * Replace boolean D4Data values with 'true'/'false' strings, in place, on
 * every node and edge. Raw booleans mis-classify as numeric downstream
 * (isNaN(true) === false) and become degenerate [1,1] range sliders whose
 * generated BETWEEN condition can never validate — the query AST requires
 * typeof number — so a boolean property silently hides its carriers under an
 * OR filter join. As strings they become categorical true/false filters.
 * Runs at the shared import boundary so every source (Excel, JSON, live API,
 * Neo4j) is covered regardless of how it encodes booleans.
 *
 * @param {{nodes?: object[], edges?: object[]}} fileData
 */
function normalizeD4DataBooleans(fileData) {
  for (const element of [...(fileData.nodes ?? []), ...(fileData.edges ?? [])]) {
    if (!element?.D4Data) continue;
    for (const group of Object.values(element.D4Data)) {
      if (!group || typeof group !== 'object') continue;
      for (const subGroup of Object.values(group)) {
        if (!subGroup || typeof subGroup !== 'object') continue;
        for (const [prop, value] of Object.entries(subGroup)) {
          if (typeof value === 'boolean') subGroup[prop] = String(value);
        }
      }
    }
  }
}


// ------------------------------------------------------ Excel parsing helpers
// Pure functions lifted out of IOManager.parseExcelToJson, which was a
// 500-line method with a dozen helper closures trapped inside it — none of
// them reachable by a test, though these five are where the actual cell
// decoding happens.

  function getOrNull(row, key) {
    const lowerCaseKey = key.toString().toLowerCase().trim();
    const value = row[Object.keys(row).find((key) => key.toLowerCase() === lowerCaseKey)];
    // Explicitly check for null/undefined to preserve 0 values
    if (value !== null && value !== undefined && value.toString().trim() !== '') {
      return value;
    }
    return null;
  }

  function cellValueToPrimitive(value) {
    if (value === null || typeof value !== 'object' || value instanceof Date) return value;
    if (Array.isArray(value.richText)) return value.richText.map((run) => run.text).join('');
    if (value.text !== undefined) return cellValueToPrimitive(value.text); // hyperlink cell
    if (value.result !== undefined) return cellValueToPrimitive(value.result); // formula cell
    return null; // formula without cached result, error cell, unknown shape → empty
  }

  function worksheetToJson(worksheet) {
    if (!worksheet) return { headers: [], jsonData: [] };

    const jsonData = [];
    const headers = [];

    const firstRow = worksheet.getRow(1);
    firstRow.eachCell((cell, colNumber) => {
      headers[colNumber] = cellValueToPrimitive(cell.value);
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const rowData = { __rowNum__: rowNumber - 2 };

      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          rowData[header] = cellValueToPrimitive(cell.value);
        }
      });

      // __rowNum__ is bookkeeping, not data — counting it made this guard
      // always true, so the blank-row skip only ever worked because ExcelJS's
      // eachRow leaves fully empty rows out in the first place.
      const hasData = Object.entries(rowData).some(
        ([key, val]) => key !== '__rowNum__' && val !== null && val !== undefined && val !== ''
      );
      if (hasData) {
        jsonData.push(rowData);
      }
    });

    return { headers: headers, jsonData: jsonData };
  }

/**
 * Split a column header into its property key and its sub-group: the LAST
 * bracketed segment names the group, everything before it is the key.
 *
 * @returns {{subGroup: string, key: string}|null} null for a reserved name
 */
  function decodeKey(key, uncategorizedSubGroup) {
    let subGroup = uncategorizedSubGroup;
    let trimmedKey;

    const matches = key.match(/\[.*?\]/g);
    if (matches && matches.length >= 2) {
      const lastBracketContent = matches[matches.length - 1];
      subGroup = lastBracketContent.substring(1, lastBracketContent.length - 1).trim();

      // For multiple brackets, preserve all except the last one in the key
      const lastBracketIndex = key.lastIndexOf(matches[matches.length - 1]);
      trimmedKey = key.substring(0, lastBracketIndex).trim();
    } else if (matches && matches.length === 1) {
      const bracketContent = matches[0];
      subGroup = bracketContent.substring(1, bracketContent.length - 1).trim();
      trimmedKey = key.substring(0, key.indexOf('[')).trim();
    } else {
      trimmedKey = key.trim();
    }

    // Both halves become live object keys in D4Data; a column named
    // `__proto__` would land its properties on a prototype instead (see
    // UNSAFE_OBJECT_KEYS). Refused here, the one place every header and cell
    // key is decoded.
    if (UNSAFE_OBJECT_KEYS.has(subGroup) || UNSAFE_OBJECT_KEYS.has(trimmedKey)) return null;
    return { subGroup: subGroup, key: trimmedKey };
  }

  function validateUserData(row, key, uncategorizedSubGroup) {
    const val = row[key];

    // Explicitly check for null/undefined to preserve 0 values
    if (val === null || val === undefined || val.toString().trim() === '') {
      return null;
    }

    const decoded = decodeKey(key, uncategorizedSubGroup);
    if (!decoded) return null; // reserved column name — decodeHeaders warned already
    return { value: val, ...decoded };
  }

  function addNodeOrEdgeUserData(nodeOrEdge, row, propertyMap, header, uncategorizedSubGroup) {
    nodeOrEdge.D4Data = {
      [header]: {},
    };

    let propsAdded = 0;
    const reservedProperties = propertyMap.map((p) => p.column.toLowerCase().trim());

    for (let key in row) {
      if (key === '__rowNum__' || reservedProperties.includes(key.toLowerCase())) continue;

      const userData = validateUserData(row, key, uncategorizedSubGroup);

      if (!userData) continue;

      if (!Object.prototype.hasOwnProperty.call(nodeOrEdge.D4Data[header], userData.subGroup)) {
        nodeOrEdge.D4Data[header][userData.subGroup] = {};
      }

      nodeOrEdge.D4Data[header][userData.subGroup][userData.key] = userData.value;
      propsAdded++;
    }

    return propsAdded;
  }

class IOManager {
  constructor(cache) {
    this.cache = cache;
    this.exportScale = readExportScale();
  }

  parseJSON(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const jsonContent = JSON.parse(reader.result);
          if (!jsonContent.edges || !jsonContent.nodes) {
            this.cache.ui.error('File does not contain edges or nodes.');
            resolve(null);
          } else {
            this.noteFileVersion(jsonContent);
            // Convert arrays back to Sets for specific properties
            this.restoreSetsFromJSON(jsonContent);
            resolve(jsonContent);
          }
        } catch (errorMsg) {
          this.cache.ui.error(`Failed to parse file as JSON: ${errorMsg}`);
          resolve(null);
        }
      };
      reader.onerror = () => {
        this.cache.ui.error(`Failed to load file: ${reader.error}`);
        resolve(null);
      };
      reader.readAsText(file);
    });
  }

  restoreSetsFromJSON(jsonContent) {
    // Deduplicate headers to fix old exported files with duplicate headers
    if (jsonContent.nodeDataHeaders) {
      const seen = new Set();
      jsonContent.nodeDataHeaders = jsonContent.nodeDataHeaders.filter((h) => {
        const key = `${h.subGroup}::${h.key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (jsonContent.edgeDataHeaders) {
      const seen = new Set();
      jsonContent.edgeDataHeaders = jsonContent.edgeDataHeaders.filter((h) => {
        const key = `${h.subGroup}::${h.key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Restore Sets in layouts
    if (jsonContent.layouts) {
      for (const layoutName in jsonContent.layouts) {
        const layout = jsonContent.layouts[layoutName];

        // Restore bubble group manual members
        for (const key in layout) {
          if (key.endsWith('ManualMembers') && Array.isArray(layout[key])) {
            layout[key] = new Set(layout[key]);
          }
          if (key.endsWith('Props') && Array.isArray(layout[key])) {
            layout[key] = new Set(layout[key]);
          }
        }

        // Restore filters Map and nested Sets
        if (layout.filters && typeof layout.filters === 'object') {
          const filtersMap = new Map(Object.entries(layout.filters));

          // Restore Sets within each filter value
          for (const filterValue of filtersMap.values()) {
            if (filterValue.categories && Array.isArray(filterValue.categories)) {
              filterValue.categories = new Set(filterValue.categories);
            }
            // Per-filter `${group}Members/IDs/MembersHidden/IDsHidden` sets used to be
            // revived here. Group membership lives on the LAYOUT
            // (`${group}Props` / `${group}ManualMembers`, above); those four were
            // either never read or mirrored `${group}Props`. Files that still carry
            // them are simply ignored.
          }

          layout.filters = filtersMap;
        }

        // Restore positions Map
        if (layout.positions && typeof layout.positions === 'object') {
          layout.positions = new Map(Object.entries(layout.positions));
        }

        // Restore style Maps
        if (layout.nodeStyles && typeof layout.nodeStyles === 'object') {
          layout.nodeStyles = new Map(Object.entries(layout.nodeStyles));
        }
        if (layout.edgeStyles && typeof layout.edgeStyles === 'object') {
          layout.edgeStyles = new Map(Object.entries(layout.edgeStyles));
        }
      }
    }

    // Restore Sets in filterDefaults
    if (jsonContent.filterDefaults && typeof jsonContent.filterDefaults === 'object') {
      const filterDefaultsMap = new Map(Object.entries(jsonContent.filterDefaults));

      // Restore Sets within each filter default value
      for (const filterValue of filterDefaultsMap.values()) {
        if (filterValue.categories && Array.isArray(filterValue.categories)) {
          filterValue.categories = new Set(filterValue.categories);
        }
      }

      jsonContent.filterDefaults = filterDefaultsMap;
    }
  }

  /**
   * Parses an Excel file into the required JSON structure.
   *
   * @param {File} file - The Excel file to be parsed.
   * @param {Object} [options]
   * @param {boolean} [options.merge] - Merge mode: a single "nodes" or "edges"
   *   sheet suffices, and empty sheets are tolerated (one of them must have rows).
   * @param {Set<string>} [options.knownNodeIDs] - Node ids already in the graph;
   *   edge endpoints are validated against the file's nodes plus this set.
   * @returns {Object} - Parsed JSON structure compatible with the existing system.
   */
  async parseExcelToJson(file, options = {}) {
    const merge = options.merge === true;
    const knownNodeIDs = options.knownNodeIDs ?? new Set();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);

    const nodesSheet = workbook.getWorksheet('nodes');
    const edgesSheet = workbook.getWorksheet('edges');

    if (merge ? !nodesSheet && !edgesSheet : !nodesSheet || !edgesSheet) {
      this.cache.ui.error(
        merge
          ? 'The Excel file must contain a "nodes" and/or "edges" sheet.'
          : 'The Excel file must contain a "nodes" and "edges" sheet.'
      );
      return;
    }


    const validateColumns = (requiredColumns, firstRowKeys, sheetName) => {
      for (const column of requiredColumns) {
        if (!firstRowKeys.includes(column)) {
          const origColumn = firstRowKeys.filter((k) => k.toLowerCase().trim() === column)[0];
          this.cache.ui.error(`The "${sheetName}" sheet must contain an "${origColumn}" column.`);
          return;
        }
      }
    };

    const sanitizeColumns = (sheetJson, sheetDescriptor) => {
      if (!sheetJson || sheetJson.length === 0) return;

      const firstRow = sheetJson[0];
      const columnMapping = {};

      Object.keys(firstRow).forEach((originalKey) => {
        if (originalKey.startsWith('__EMPTY')) return;

        if (originalKey.includes('(') || originalKey.includes(')')) {
          columnMapping[originalKey] = originalKey.replace(/\(/g, '[').replace(/\)/g, ']');
        }
      });

      sheetJson.forEach((row) => {
        Object.entries(columnMapping).forEach(([originalKey, sanitizedKey]) => {
          if (Object.prototype.hasOwnProperty.call(row, originalKey)) {
            row[sanitizedKey] = row[originalKey];
            delete row[originalKey];
          }
        });
      });

      Object.entries(columnMapping).forEach(([original, sanitized]) => {
        this.cache.ui.warning(
          `Column "${original}" in "${sheetDescriptor}" sheet was renamed to "${sanitized}" for proper group parsing.`
        );
      });
    };

    const removeEmptyColumns = (sheetJson, sheetDescriptor) => {
      if (!sheetJson || sheetJson.length === 0) return;

      const propertyDefs =
        sheetDescriptor === 'edges' ? EXCEL_EDGE_PROPERTIES : EXCEL_NODE_PROPERTIES;
      const requiredCols = propertyDefs.filter((prop) => prop.required).map((prop) => prop.column);
      const optionalCols = propertyDefs.filter((prop) => !prop.required).map((prop) => prop.column);

      const allCols = Object.keys(sheetJson[0]).filter(
        (c) => !c.startsWith('__EMPTY') && c !== '__rowNum__'
      );

      const isColumnEmpty = (col) =>
        sheetJson.every((row) => {
          const v = row[col];
          return v == null || v.toString().trim() === '';
        });

      const emptyRequiredColumns = allCols.filter(
        (col) => requiredCols.includes(col) && isColumnEmpty(col)
      );

      const emptyOptionalColumns = allCols.filter(
        (col) => optionalCols.includes(col) && isColumnEmpty(col)
      );

      const emptyUserColumns = allCols.filter(
        (col) => !requiredCols.includes(col) && !optionalCols.includes(col) && isColumnEmpty(col)
      );

      emptyRequiredColumns.forEach((col) => {
        this.cache.ui.error(`Required column "${col}" in "${sheetDescriptor}" sheet is empty.`);
      });

      emptyOptionalColumns.forEach((col) => {
        this.cache.ui.info(`Optional column "${col}" in "${sheetDescriptor}" sheet is empty.`);
      });

      emptyUserColumns.forEach((col) => {
        this.cache.ui.warning(
          `User defined column "${col}" in "${sheetDescriptor}" sheet is empty.`
        );
      });

      const allEmptyColumns = [
        ...emptyRequiredColumns,
        ...emptyOptionalColumns,
        ...emptyUserColumns,
      ];
      sheetJson.forEach((row) => {
        allEmptyColumns.forEach((col) => delete row[col]);
      });
    };

    // ExcelJS surfaces rich cells as objects (rich-text runs, hyperlinks,
    // formulas, error cells). Normalize to the primitive the user sees in the
    // sheet — raw objects leaking into D4Data corrupt change detection and
    // crash the category filters downstream.



    /** decodeKey over a header list, telling the user which columns it refused. */
    const decodeHeaders = (keys, descriptor) => {
      const decoded = [];
      const refused = [];
      for (const key of keys) {
        const entry = decodeKey(key, this.cache.CFG.EXCEL_UNCATEGORIZED_SUBHEADER);
        if (entry) decoded.push(entry);
        else refused.push(key);
      }
      if (refused.length > 0) {
        this.cache.ui.warning(
          `Ignored ${refused.length} ${descriptor} column(s) with a reserved name: ${refused.join(', ')}.`
        );
      }
      return decoded;
    };

    const nodesDataDict = worksheetToJson(nodesSheet);
    const edgesDataDict = worksheetToJson(edgesSheet);

    const nodesData = nodesDataDict.jsonData;
    const edgesData = edgesDataDict.jsonData;

    if (nodesData.length === 0 && !merge) {
      this.cache.ui.error('The "nodes" sheet is empty or invalid.');
      return;
    }

    if (edgesData.length === 0 && !merge) {
      this.cache.ui.error('The "edges" sheet is empty or invalid.');
      return;
    }

    if (merge && nodesData.length === 0 && edgesData.length === 0) {
      this.cache.ui.error('The Excel file contains no node or edge rows.');
      return;
    }

    sanitizeColumns(nodesData, 'nodes');
    sanitizeColumns(edgesData, 'edges');

    removeEmptyColumns(nodesData, 'nodes');
    removeEmptyColumns(edgesData, 'edges');

    if (nodesData.length > 0) {
      const firstNodeRowKeys = nodesDataDict.headers.map((k) => k.toLowerCase().trim());
      const requiredNodeColumns = EXCEL_NODE_PROPERTIES.filter((node) => node.required).map(
        (node) => node.column.toLowerCase().trim()
      );
      validateColumns(requiredNodeColumns, firstNodeRowKeys, 'nodes');
    }

    if (edgesData.length > 0) {
      const firstEdgeRowKeys = edgesDataDict.headers.map((k) => k.toLowerCase().trim());
      const requiredEdgeColumns = EXCEL_EDGE_PROPERTIES.filter((edge) => edge.required).map(
        (edge) => edge.column.toLowerCase().trim()
      );
      validateColumns(requiredEdgeColumns, firstEdgeRowKeys, 'edges');
    }

    const nonDataNodeColumns = new Set(
      EXCEL_NODE_PROPERTIES.map((p) => p.column.toLowerCase().trim())
    );
    const nodeDataHeaders = decodeHeaders(
      nodesDataDict.headers.filter(
        (k) =>
          !nonDataNodeColumns.has(k.toLowerCase().trim()) &&
          !k.startsWith('__EMPTY') &&
          k !== '__rowNum__'
      ),
      'node'
    );

    const nonDataEdgeColumns = new Set(
      EXCEL_EDGE_PROPERTIES.map((p) => p.column.toLowerCase().trim())
    );
    const edgeDataHeaders = decodeHeaders(
      edgesDataDict.headers.filter(
        (k) =>
          !nonDataEdgeColumns.has(k.toLowerCase().trim()) &&
          !k.startsWith('__EMPTY') &&
          k !== '__rowNum__'
      ),
      'edge'
    );

    const addNodeOrEdgeStyle = (nodeOrEdge, row, propertyMap, descriptor) => {
      nodeOrEdge.style = {};

      propertyMap.forEach(({ column, type, required, apply }) => {
        if (required) return;

        const rowNum = row.__rowNum__ + 1;

        if (!type) {
          this.cache.ui
            .warning(`Unsure how to validate ${descriptor} property ${column} in row ${rowNum}. 
        Missing definition in EXCEL_NODE_PROPERTIES or EXCEL_EDGE_PROPERTIES?`);
          return;
        }

        const maybeValue = getOrNull(row, column);
        if (maybeValue) {
          let validated = false;
          let listValues = null;
          if (type.startsWith('oneOf:')) {
            listValues = type.split(':')[1].split('|');
            type = 'list';
          }
          switch (type) {
            case 'str':
              validated = true;
              break;
            case 'num':
              validated = StaticUtilities.isNumber(maybeValue);
              break;
            case 'bool':
              validated = StaticUtilities.isBoolean(maybeValue);
              break;
            case 'rgba':
              validated = StaticUtilities.isHexColor(maybeValue);
              break;
            case 'list':
              validated = StaticUtilities.isInList(maybeValue, listValues);
              break;
            default:
              break;
          }
          if (!validated) {
            this.cache.ui.error(
              `${descriptor} property '${column}' in row ${rowNum} has an invalid value '${maybeValue}' and will be ignored (value must be of type '${type}').`
            );
          } else {
            let coerced = maybeValue;
            if (type === 'num') coerced = parseFloat(maybeValue);
            else if (type === 'bool')
              coerced =
                typeof maybeValue === 'string'
                  ? maybeValue.trim().toLowerCase() === 'true'
                  : !!maybeValue;
            apply(nodeOrEdge, coerced);
          }
        }
      });
    };



    const nodeIDs = new Set();

    const parsedNodes = nodesData
      .map((row) => {
        const node = {};
        const nodeRowNum = row.__rowNum__ + 1;
        const descriptor = 'Node';

        const nodeID = getOrNull(row, 'ID');
        if (!nodeID) {
          this.cache.ui.warning(
            `Node in row ${nodeRowNum} does not contain an ID and will be skipped.`
          );
          return null;
        }

        if (nodeIDs.has(nodeID)) {
          this.cache.ui.warning(
            `Node in row ${nodeRowNum} (ID ${nodeID}) already exists and will be skipped.`
          );
          return null;
        }

        node.id = nodeID;
        nodeIDs.add(nodeID);

        addNodeOrEdgeStyle(node, row, EXCEL_NODE_PROPERTIES, descriptor);
        const propsAdded = addNodeOrEdgeUserData(
          node,
          row,
          EXCEL_NODE_PROPERTIES,
          this.cache.CFG.EXCEL_NODE_HEADER,
          this.cache.CFG.EXCEL_UNCATEGORIZED_SUBHEADER
        );
        node._propsAdded = propsAdded;

        return node;
      })
      .filter((node) => node !== null);

    const nodesWithoutProps = parsedNodes.filter((n) => n._propsAdded === 0);
    if (nodesWithoutProps.length > 0) {
      const ids = nodesWithoutProps.map((n) => n.id);
      this.cache.ui.info(
        `${nodesWithoutProps.length} node(s) have no user-defined properties and will always be visible:\n` +
          ids.map((id) => `  - ${id}`).join('\n')
      );
    }
    parsedNodes.forEach((n) => delete n._propsAdded);

    const parsedEdges = edgesData
      .map((row) => {
        const edge = {};
        const edgeRowNum = row.__rowNum__ + 1;
        const descriptor = 'Edge';

        const sourceID = getOrNull(row, 'Source ID');
        if (!sourceID) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} does not contain a Source ID and will be skipped.`
          );
          return null;
        }

        if (!nodeIDs.has(sourceID) && !knownNodeIDs.has(String(sourceID))) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} has an invalid/missing Source ID (${sourceID}) and will be skipped.`
          );
          return null;
        }

        const targetID = getOrNull(row, 'Target ID');
        if (!targetID) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} does not contain a Target ID and will be skipped.`
          );
          return null;
        }

        if (!nodeIDs.has(targetID) && !knownNodeIDs.has(String(targetID))) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} has an invalid/missing Target ID (${targetID}) and will be skipped.`
          );
          return null;
        }

        edge.id = `${sourceID}::${targetID}`;
        edge.source = sourceID;
        edge.target = targetID;

        addNodeOrEdgeStyle(edge, row, EXCEL_EDGE_PROPERTIES, descriptor);
        const propsAdded = addNodeOrEdgeUserData(
          edge,
          row,
          EXCEL_EDGE_PROPERTIES,
          this.cache.CFG.EXCEL_EDGE_HEADER,
          this.cache.CFG.EXCEL_UNCATEGORIZED_SUBHEADER
        );
        edge._propsAdded = propsAdded;

        return edge;
      })
      .filter((edge) => edge !== null);

    const edgesWithoutProps = parsedEdges.filter((e) => e._propsAdded === 0);
    if (edgesWithoutProps.length > 0) {
      const ids = edgesWithoutProps.map((e) => e.id);
      this.cache.ui.info(
        `${edgesWithoutProps.length} edge(s) have no user-defined properties and will always be visible:\n` +
          ids.map((id) => `  - ${id}`).join('\n')
      );
    }
    parsedEdges.forEach((e) => delete e._propsAdded);

    return {
      nodes: parsedNodes,
      edges: parsedEdges,
      nodeDataHeaders: nodeDataHeaders,
      edgeDataHeaders: edgeDataHeaders,
      skippedNodeRows: nodesData.length - parsedNodes.length,
      skippedEdgeRows: edgesData.length - parsedEdges.length,
    };
  }

  async downloadExcelTemplate() {
    const template = new ExcelTemplate(excelData);
    const workbook = template.createWorkbook(ExcelJS);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'simple-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  preProcessData(fileData) {
    this.cache.reset();
    normalizeD4DataBooleans(fileData);
    this.cache.bs?.clearAvoidConsent?.();

    this.cache.CFG.HIDE_LABELS =
      fileData.nodes.length > this.cache.CFG.MAX_NODES_BEFORE_HIDING_LABELS;

    this.cache.nodePositionsFromExcelImport = new Map();

    this.populateCacheHeaders(fileData);

    this.cache.data.nodes = fileData.nodes.map((node) => {
      const nodeFeatures = new Set();
      const nodeFeatureValues = new Map();
      const nodeFeatureWithinThreshold = new Map();

      for (let [section, subsection, prop, data] of this.cache.gcm.traverseD4Data(node)) {
        let propId = StaticUtilities.generatePropHashId(section, subsection, prop);
        nodeFeatures.add(propId);

        if (isNaN(data)) {
          // Split categorical values by pipe separator
          const values = String(data).includes('|')
            ? String(data)
                .split('|')
                .map((v) => v.trim())
                .filter((v) => v !== '')
            : [data];

          if (!nodeFeatureValues.has(propId)) {
            nodeFeatureValues.set(propId, new Set());
          }
          values.forEach((val) => {
            nodeFeatureValues.get(propId).add(val);
            this.populateFilterPropsLowsAndHighs(propId, val);
          });
        } else {
          nodeFeatureValues.set(propId, data);
          this.populateFilterPropsLowsAndHighs(propId, data);
        }
        nodeFeatureWithinThreshold.set(propId, null);
      }

      if (node.style?.x && node.style?.y) {
        this.cache.nodePositionsFromExcelImport.set(node.id, {
          x: node.style.x,
          y: node.style.y,
        });
      }

      // Preserve visibility from loaded data before applying defaults
      const savedVisibility = node.style?.visibility;

      const nodeDefaults = this.cache.style.getNodeStyleOrDefaults(node);
      const processedNode = {
        ...node,
        ...nodeDefaults,
        originalType: nodeDefaults.type,
        originalStyle: structuredClone(nodeDefaults.style),
        features: nodeFeatures,
        featureValues: nodeFeatureValues,
        featureIsWithinThreshold: nodeFeatureWithinThreshold,
      };

      // Restore visibility if it was set in loaded data
      if (savedVisibility) {
        processedNode.style.visibility = savedVisibility;
      }

      return processedNode;
    });

    this.cache.data.edges = fileData.edges.map((edge) => {
      const edgeFeatures = new Set();
      const edgeFeatureValues = new Map();
      const edgeFeatureWithinThreshold = new Map();

      for (let [section, subsection, prop, data] of this.cache.gcm.traverseD4Data(edge)) {
        let propId = StaticUtilities.generatePropHashId(section, subsection, prop);
        edgeFeatures.add(propId);
        if (isNaN(data)) {
          // Split categorical values by pipe separator
          const values = String(data).includes('|')
            ? String(data)
                .split('|')
                .map((v) => v.trim())
                .filter((v) => v !== '')
            : [data];

          if (!edgeFeatureValues.has(propId)) {
            edgeFeatureValues.set(propId, new Set());
          }
          values.forEach((val) => {
            edgeFeatureValues.get(propId).add(val);
            this.populateFilterPropsLowsAndHighs(propId, val);
          });
        } else {
          edgeFeatureValues.set(propId, data);
          this.populateFilterPropsLowsAndHighs(propId, data);
        }
        edgeFeatureWithinThreshold.set(propId, null);
      }

      // Preserve visibility from loaded data before applying defaults
      const savedVisibility = edge.style?.visibility;

      const edgeDefaults = this.cache.style.getEdgeStyleOrDefaults(edge);
      const processedEdge = {
        ...edge,
        ...edgeDefaults,
        originalType: edgeDefaults.type,
        originalStyle: structuredClone(edgeDefaults.style),
        features: edgeFeatures,
        featureValues: edgeFeatureValues,
        featureIsWithinThreshold: edgeFeatureWithinThreshold,
      };

      // Restore visibility if it was set in loaded data
      if (savedVisibility) {
        processedEdge.style.visibility = savedVisibility;
      }

      return processedEdge;
    });

    this.finalizeFilterClassification();

    const excelHasCoordinates = this.cache.nodePositionsFromExcelImport.size > 0;
    this.cache.data.selectedLayout =
      fileData.selectedLayout ||
      (excelHasCoordinates ? this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME : 'Default');

    // create individual map for each layout, no matter if default or manual, with positions, current filters, ..
    if (fileData.layouts) {
      this.cache.data.layouts = this.cache.io.parseLayouts(fileData.layouts);
      if (fileData.selectedLayout === this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME) {
        this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE = true;
      }
    } else {
      // Create only a single "Default" layout using force layout
      this.cache.data.layouts = {
        Default: this.cache.lm.createDefaultLayout(this.cache.DEFAULTS.LAYOUT, false),
      };

      if (excelHasCoordinates) {
        this.cache.data.layouts[this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME] =
          this.cache.lm.createDefaultLayout(this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME, true);
        this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE = true;
      }
    }

    // Rebuild layout filters in the correct order from filterDefaults
    // This ensures new columns appear in alphabetical position, not at the end
    for (const layoutName in this.cache.data.layouts) {
      const layout = this.cache.data.layouts[layoutName];
      const oldFilters = new Map(layout.filters); // Save old filter values
      layout.filters.clear(); // Clear to rebuild in correct order

      // Rebuild filters in the order they appear in filterDefaults
      for (const [propId, defaultFilter] of this.cache.data.filterDefaults.entries()) {
        if (oldFilters.has(propId)) {
          // Preserve existing filter values (user's slider positions, etc.),
          // reconciled against the property's freshly-derived type — a loaded
          // filter saved before boolean inference (or before a type override)
          // may no longer match the widget the property gets now.
          layout.filters.set(
            propId,
            this.reconcileLoadedFilterType(oldFilters.get(propId), defaultFilter)
          );
        } else {
          // Add new property with default filter
          layout.filters.set(propId, structuredClone(defaultFilter));
        }
      }
    }

    // Initialize empty stash (legacy support)
    this.cache.data.stash = {};

    this.cache.initialize({
      nodeDataHeaders: fileData.nodeDataHeaders,
      edgeDataHeaders: fileData.edgeDataHeaders,
    });
    this.cache.ui.debug('Done pre-processing data');
  }

  getDefaultFilterObject() {
    let obj = {
      active: true,
      lowerThreshold: Infinity,
      upperThreshold: -Infinity,
      isInverted: false,
      isCategory: false,
      // Boolean classification (§6.1): boolCandidate stays true while every
      // observed value is a boolean encoding (true/TRUE/1 vs false/FALSE/0);
      // finalizeFilterClassification then promotes candidates to isBoolean.
      // Classification is purely data-driven — when the data changes (e.g. a
      // third distinct number appears via the data editor), the rebuild
      // reclassifies the column automatically.
      isBoolean: false,
      boolCandidate: true,
      // Mixed-type accounting (§6.2): a column holding both numeric and text
      // values becomes an unusable (disabled) filter row instead of being
      // deleted; the counts feed the row's explanation.
      unusable: false,
      numericCount: 0,
      textCount: 0,
      hasFloatValues: false,
      categories: new Set(),
    };
    return obj;
  }

  // Accumulates one observed value into a property's filter defaults. Type
  // conflicts are NOT resolved here — numeric bounds and categorical values
  // both accumulate, and finalizeFilterClassification decides afterwards
  // whether the property is numeric, categorical, boolean, or unusable.
  populateFilterPropsLowsAndHighs(propHash, nodeOrEdgeValue) {
    if (!this.cache.data.filterDefaults.get(propHash)) {
      this.cache.data.filterDefaults.set(propHash, this.getDefaultFilterObject());
    }

    if (nodeOrEdgeValue === '') {
      return;
    }

    const fo = this.cache.data.filterDefaults.get(propHash);
    if (fo.boolCandidate && StaticUtilities.booleanTokenValue(nodeOrEdgeValue) === null) {
      fo.boolCandidate = false;
    }

    if (isNaN(nodeOrEdgeValue)) {
      fo.textCount += 1;
      fo.isCategory = true;
      fo.categories.add(nodeOrEdgeValue);
      return;
    }

    fo.numericCount += 1;
    if (!fo.hasFloatValues && !StaticUtilities.isInteger(nodeOrEdgeValue)) {
      fo.hasFloatValues = true;
    }
    fo.lowerThreshold = Math.min(nodeOrEdgeValue, fo.lowerThreshold);
    fo.upperThreshold = Math.max(nodeOrEdgeValue, fo.upperThreshold);
  }

  // Reconcile a filter loaded from a saved workspace with the property's
  // freshly-derived default. Boolean props canonicalize the saved categories
  // (pre-inference files stored raw spellings like 'TRUE'); a type mismatch
  // in either direction falls back to a clone of the new default. Non-boolean
  // props keep the loaded filter untouched (today's behavior).
  reconcileLoadedFilterType(loaded, defaultFilter) {
    if (defaultFilter.isBoolean) {
      const canonical = new Set(
        [...(loaded.categories ?? [])]
          .map((c) => StaticUtilities.booleanTokenValue(c))
          .filter((c) => c !== null)
      );
      if (loaded.isCategory && canonical.size > 0) {
        return {
          ...structuredClone(defaultFilter),
          active: loaded.active,
          categories: canonical,
        };
      }
      return structuredClone(defaultFilter); // numeric-era or empty → reset
    }
    if (defaultFilter.unusable || loaded.isBoolean) {
      return structuredClone(defaultFilter);
    }
    return loaded;
  }

  /**
   * Resolve every property's final filter type once all values are collected
   * (§6.1/§6.2). Runs after the node/edge preprocessing loops and before the
   * per-layout filter rebuild, so cloned layout filters inherit the result.
   *
   * - Boolean: every value is a boolean encoding → isBoolean (a refined
   *   categorical with canonical categories {'true','false'}).
   * - Mixed numeric+text: kept visible but marked unusable (disabled row)
   *   instead of the pre-1.17 silent delete.
   */
  finalizeFilterClassification() {
    for (const [propHash, fo] of this.cache.data.filterDefaults.entries()) {
      const hasText = fo.categories.size > 0;
      const hasNumeric = fo.lowerThreshold !== Infinity;
      if (!hasText && !hasNumeric) continue; // header-only property, no values

      if (fo.boolCandidate) {
        fo.isBoolean = true;
        fo.isCategory = true;
        fo.categories = new Set(['true', 'false']);
        this.#canonicalizeBooleanFeatureValues(propHash);
        continue;
      }

      if (hasText && hasNumeric) {
        fo.unusable = true;
        fo.active = false;
        const [section, subSection, prop] = StaticUtilities.decodePropHashId(propHash);
        this.cache.ui.warning(
          `Property ${prop} (section ${section}, sub-section ${subSection}) mixes ` +
            `${fo.numericCount} numeric and ${fo.textCount} text values — its filter is disabled.`
        );
      }
    }
  }

  // Rewrite a boolean property's derived featureValues to canonical
  // Set{'true'|'false'} on every carrier, so categorical consumers (color
  // ramps, pies, IN queries) see one value space regardless of the source
  // encoding (TRUE vs 1). Raw D4Data is never touched — exports stay
  // byte-faithful.
  #canonicalizeBooleanFeatureValues(propHash) {
    for (const element of [...this.cache.data.nodes, ...this.cache.data.edges]) {
      if (!element.features?.has(propHash)) continue;
      const raw = element.featureValues.get(propHash);
      const rawValues = raw instanceof Set ? [...raw] : [raw];
      const canonical = new Set();
      for (const value of rawValues) {
        canonical.add(StaticUtilities.booleanTokenValue(value) ?? 'false');
      }
      element.featureValues.set(propHash, canonical);
    }
  }

  populateCacheHeaders(fileData) {
    if (fileData.nodeDataHeaders) {
      for (const nodeHeader of fileData.nodeDataHeaders) {
        const nodePropHash = StaticUtilities.generatePropHashId(
          this.cache.CFG.EXCEL_NODE_HEADER,
          nodeHeader.subGroup,
          nodeHeader.key
        );
        this.cache.data.filterDefaults.set(nodePropHash, this.getDefaultFilterObject());
      }
    }
    if (fileData.edgeDataHeaders) {
      for (const edgeHeader of fileData.edgeDataHeaders) {
        const edgePropHash = StaticUtilities.generatePropHashId(
          this.cache.CFG.EXCEL_EDGE_HEADER,
          edgeHeader.subGroup,
          edgeHeader.key
        );
        this.cache.data.filterDefaults.set(edgePropHash, this.getDefaultFilterObject());
      }
    }
  }

  buildExportFilename(ext, suffix = '') {
    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    const label = document.getElementById('dataSourceLabel')?.textContent || '';
    let basename = label
      .replace(/\.[a-z0-9]+$/i, '') // strip file extension
      .replace(/^(\d{8}-\d{6}_GLL_)+/, '') // strip stacked GLL prefixes
      .replace(/[<>:"/\\|?*,]+/g, '_') // replace unsafe chars
      .replace(/\s+/g, '_') // spaces to underscores
      .replace(/_+/g, '_') // collapse multiple underscores
      .replace(/^_|_$/g, ''); // trim leading/trailing underscores

    if (!basename) basename = 'export';
    if (suffix) basename += `_${suffix}`;

    return `${ts}_GLL_${basename}.${ext}`;
  }

  /**
   * Record the producing version of a loaded file (for diagnostics and any
   * future targeted migration) and warn — softly — when the file was saved by
   * a NEWER app than the one loading it, where forward compatibility is not
   * guaranteed. Older or version-less files load silently: the importer is
   * backward-tolerant by defaulting every missing key.
   */
  noteFileVersion(jsonContent) {
    // Validate at the boundary: keep only a string version, else null — never
    // store an arbitrary JSON value (number/object) as the producing version.
    const raw = jsonContent?.version;
    const version = typeof raw === 'string' ? raw : null;
    this.cache.loadedFileVersion = version;
    if (version && StaticUtilities.isVersionNewer(version, VERSION)) {
      this.cache.ui.info(
        `This file was saved by a newer version (v${version}) than this app ` +
          `(v${VERSION}). Some settings may not load correctly.`
      );
    }
  }

  /**
   * The serialized save: the live graph state plus a top-level `version` stamp
   * and the workspace heatmap overlay (held on the adapter, not in cache.data,
   * so it must be folded in explicitly). Pure — does not mutate cache.data.
   */
  buildExportPayload() {
    // version last so the current app stamp always wins, even if a stale
    // version key ever rode in on cache.data.
    const payload = { ...this.cache.data, version: VERSION };
    const heatmap = this.cache.graph?.heatmapLayer;
    if (heatmap) {
      payload.heatmap = {
        enabled: !!heatmap.heatmapEnabled,
        settings: { ...heatmap.settings },
      };
    }
    return payload;
  }

  /**
   * Restore the heatmap overlay from a loaded file onto the freshly-created
   * adapter. Settings first, then enabled, so the dim-graph refresh in
   * setHeatmapEnabled sees the final settings. No-op for files without a
   * heatmap block (backward compatible) or before the graph exists.
   */
  restoreHeatmapFromImport(fileData) {
    const heatmap = this.cache.graph?.heatmapLayer;
    if (!heatmap || !fileData?.heatmap) return;
    if (fileData.heatmap.settings) heatmap.updateSettings(fileData.heatmap.settings);
    heatmap.setHeatmapEnabled(!!fileData.heatmap.enabled);
  }

  async exportGraphAsJSON() {
    if (this.cache.data === null) {
      this.cache.ui.error('No graph data to save.');
      return false;
    }

    // helper for JSON.stringify to serialize Maps to plain objects and Sets to arrays
    function replacer(key, value) {
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return [...value];
      return value;
    }

    await this.cache.ui.showLoading('Exporting graph ..');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Clear and rebuild headers from filterDefaults to avoid duplicates
    this.cache.data.nodeDataHeaders = [];
    this.cache.data.edgeDataHeaders = [];

    for (const filterDefaultKey of this.cache.data.filterDefaults.keys()) {
      const [nodeOrEdge, subGroup, key] = StaticUtilities.decodePropHashId(filterDefaultKey);
      const targetList =
        nodeOrEdge === this.cache.CFG.EXCEL_NODE_HEADER
          ? this.cache.data.nodeDataHeaders
          : this.cache.data.edgeDataHeaders;
      const elem = { subGroup: subGroup, key: key };

      // Check if header already exists by comparing actual values
      const exists = targetList.some((h) => h.subGroup === elem.subGroup && h.key === elem.key);
      if (!exists) {
        // Insert next to existing group members to keep groups contiguous
        const lastGroupIdx = targetList.findLastIndex((h) => h.subGroup === subGroup);
        if (lastGroupIdx !== -1) {
          targetList.splice(lastGroupIdx + 1, 0, elem);
        } else {
          targetList.push(elem);
        }
      }
    }

    // Clean base node/edge styles - only keep visibility, remove all other style properties
    // All styles should be stored in per-layout nodeStyles/edgeStyles maps
    if (this.cache.graph) {
      const { nodes, edges } = await this.cache.graph.getData();

      // Reset cache.data.nodes to clean state, only preserving visibility
      for (const node of this.cache.data.nodes) {
        const graphNode = nodes.find((n) => n.id === node.id);
        const visibility = graphNode?.style?.visibility || 'visible';

        // Get the original clean style and type from nodeRef
        const nodeRefData = this.cache.nodeRef.get(node.id);
        if (nodeRefData && nodeRefData.originalStyle) {
          // Reset to original clean style and type, then apply visibility
          node.style = structuredClone(nodeRefData.originalStyle);
          node.style.visibility = visibility;
          node.type = nodeRefData.originalType;
        } else {
          // Fallback: only preserve visibility
          node.style = { visibility: visibility };
        }
      }

      // Reset cache.data.edges to clean state, only preserving visibility
      for (const edge of this.cache.data.edges) {
        const graphEdge = edges.find((e) => e.id === edge.id);
        const visibility = graphEdge?.style?.visibility || 'visible';

        // Get the original clean style and type from edgeRef
        const edgeRefData = this.cache.edgeRef.get(edge.id);
        if (edgeRefData && edgeRefData.originalStyle) {
          // Reset to original clean style and type, then apply visibility
          edge.style = structuredClone(edgeRefData.originalStyle);
          edge.style.visibility = visibility;
          edge.type = edgeRefData.originalType;
        } else {
          // Fallback: only preserve visibility
          edge.style = { visibility: visibility };
        }
      }
    }

    const blob = new Blob([JSON.stringify(this.buildExportPayload(), replacer)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.buildExportFilename('json');
    a.click();
    URL.revokeObjectURL(url);
    await this.cache.ui.hideLoading();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  parseLayouts(jsonLayouts) {
    const parsedLayouts = {};
    // Notes past MAX_ANNOTATIONS (and malformed records) are dropped at the
    // trust boundary. Silently, until now — while the same feature warns when
    // it trims a single note's text.
    let droppedNotes = 0;
    Object.entries(jsonLayouts).forEach(([key, layout]) => {
      const positions =
        layout.positions instanceof Map
          ? layout.positions
          : new Map(Object.entries(layout.positions || {}));
      parsedLayouts[key] = {
        // layoutType gates the initial layout run in core.js: a view with no
        // positions needs one so the force algorithm fires. Authored payloads
        // (e.g. bubble groups, §7) omit it; without this default they'd render
        // every node stacked at the origin. Honour an explicit value when given.
        layoutType:
          layout.layoutType || (positions.size === 0 ? this.cache.DEFAULTS.LAYOUT : undefined),
        internals: layout.internals || null,
        // Check if already a Map (from restoreSetsFromJSON), otherwise convert
        positions,
        filters: this.parseFiltersAsMap(layout.filters),
        isCustom: layout.isCustom || false,
        query: layout['query'] || undefined,
        // Per-view filter-join settings; default for pre-1.15.4 files that
        // predate them (OR / non-strict = the historical behavior).
        filterJoinMode: layout.filterJoinMode === 'AND' ? 'AND' : 'OR',
        filterStrict: layout.filterStrict === true,
        // Per-view styles - check if already Maps
        hideDisconnectedNodes: layout.hideDisconnectedNodes || false,
        nodeStyles:
          layout.nodeStyles instanceof Map
            ? layout.nodeStyles
            : new Map(Object.entries(layout.nodeStyles || {})),
        edgeStyles:
          layout.edgeStyles instanceof Map
            ? layout.edgeStyles
            : new Map(Object.entries(layout.edgeStyles || {})),
        bubbleSetStyle: (() => {
          const merged = {};
          // Iterate the SAVED group keys, never a fixed list: a model is the
          // authority on which groups it has. Each one gets the template (plus
          // a palette colour by position, so a file that stored no `fill` does
          // not collapse every group onto one colour) with its saved values on
          // top.
          savedLayoutGroupKeys(layout).forEach((group, index) => {
            merged[group] = {
              ...bubbleGroupStyle(index, group),
              ...(layout.bubbleSetStyle?.[group] || {}),
            };
          });
          return merged;
        })(),
        // Trust boundary for loaded text notes: malformed records are dropped,
        // fields are clamped/defaulted (annotation_geometry.js). Pre-note
        // files simply get [].
        annotations: (() => {
          const kept = sanitizeAnnotations(layout.annotations);
          const raw = Array.isArray(layout.annotations) ? layout.annotations.length : 0;
          droppedNotes += Math.max(0, raw - kept.length);
          return kept;
        })(),
      };

      // Keyed off the layout BEING PARSED, not traverseBubbleSets(): that reads
      // data.layouts[data.selectedLayout], a different and not-yet-installed
      // workspace. Once the group list is per-layout, a load into a workspace
      // with a different set of groups would leave these as raw arrays instead
      // of Sets, and getEffectiveGroupMembers would throw on `.has()`.
      for (let group of Object.keys(parsedLayouts[key].bubbleSetStyle)) {
        parsedLayouts[key][`${group}Props`] = new Set(layout[`${group}Props`] || []);
        // Also restore ManualMembers if not already restored
        parsedLayouts[key][`${group}ManualMembers`] =
          layout[`${group}ManualMembers`] instanceof Set
            ? layout[`${group}ManualMembers`]
            : new Set(layout[`${group}ManualMembers`] || []);
      }
    });
    if (droppedNotes > 0) {
      this.cache.ui?.warning?.(
        `${droppedNotes} text note${droppedNotes === 1 ? '' : 's'} could not be loaded ` +
          `(the limit is ${MAX_ANNOTATIONS} per workspace).`,
      );
    }
    return parsedLayouts;
  }

  parseFiltersAsMap(filtersObj) {
    if (filtersObj instanceof Map) {
      return structuredClone(filtersObj);
    }

    return new Map(
      Object.entries(filtersObj || {}).map(([key, value]) => [
        key,
        { ...value, categories: new Set(value?.categories || []) },
      ])
    );
  }

  loadFile(event) {
    const file = event.target.files[0];
    if (!file) {
      this.cache.ui.error('No file selected.');
      return Promise.resolve(null);
    }

    const fileType = file.name.split('.').pop().toLowerCase();

    try {
      switch (fileType) {
        case 'json':
          return this.parseJSON(file);

        case 'xls':
        case 'xlsx':
        case 'ods':
          return file
            .arrayBuffer()
            .then((buffer) => {
              return this.parseExcelToJson(buffer);
            })
            .catch((errorMsg) => {
              this.cache.ui.error(`Error reading Excel file: ${errorMsg}`);
              return null;
            });

        default:
          this.cache.ui.error(`Unsupported file type: ${fileType}`);
      }
    } catch (errorMsg) {
      this.cache.ui.error(`Failed to load file: ${errorMsg}`);
    }

    // Reset the file input for subsequent uploads
    event.target.value = '';
  }

  async loadFileWrapper(event) {
    const file = event.target.files[0];
    if (!file) return;

    await this.cache.ui.showLoading(
      'Loading',
      `Loading ${file.name} (${file.type} with ${StaticUtilities.humanFileSize(file.size)})`
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      // Parse before destroying anything. The old order tore the graph down
      // first, so a malformed file left an empty stage with nothing to go
      // back to. Every failure path inside loadFile reports its own reason.
      const fileData = await this.cache.io.loadFile(event);
      if (!fileData) return;

      this.cache.ui.setDataSourceLabel(file.name);

      if (this.cache.graph) {
        await this.cache.gcm.destroyGraphAndRollBackUI();
        await this.cache.gcm.resetEventLocks();
      }

      this.cache.io.preProcessData(fileData);
      this.cache.ui.updateHoverToggleButton();
      this.cache.buildDataTable(fileData);
      this.cache.ui.buildUI();

      // Check if there's a saved query and set lock state
      const savedQuery = this.cache.data.layouts[this.cache.data.selectedLayout]['query'];
      if (savedQuery) {
        this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
        this.cache.qm.updateQueryTextArea();
        this.cache.qm.updateUIFromQueryInstructions();
      }

      await this.cache.gcm.createGraphInstance();

      if (!this.cache.graph) {
        this.cache.ui.error('Graph not initialized, aborting.');
        return;
      }
      await this.cache.graph.render();
      await this.cache.gcm.fitViewToVisibleNodes();
      this.cache.io.restoreHeatmapFromImport(fileData);

      // Restored ManualMembers populate the layout, but the selection-panel
      // badges (per-group deselect toggles) only refresh via these calls —
      // mirror the post-layout sync so loaded groups stay deselectable.
      this.cache.bs.renderGroupList();

      this.cache.ui.debug('Initial graph rendered.');

      // Update UI lock state if query was applied
      if (savedQuery) {
        this.cache.ui.updateFilterLockState();
      }
    } catch (errorMsg) {
      this.cache.ui.error(`Error loading graph: ${errorMsg}`);
    } finally {
      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      // Without this, re-picking the same file fires no change event and the
      // click does nothing at all.
      event.target.value = '';
    }
  }

  /**
   * Export the current viewport as PNG. An explicit `scale` (1/2/4) updates
   * and persists the remembered resolution; calling without one (keyboard "P")
   * reuses it. The renderer clamps the factor to canvas limits — if the final
   * resolution fell short of the request, the user is told.
   */
  async exportPNG(scale) {
    if (typeof scale === 'number') {
      this.exportScale = scale;
      writeExportScale(scale);
    }
    const useScale = this.exportScale || 1;

    try {
      await this.cache.ui.showLoading('Loading', 'Generating picture data');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { url, requestedScale, appliedScale } = await this.cache.graph.toDataURL({
        scale: useScale,
      });

      const link = document.createElement('a');
      link.href = url;
      link.download = this.buildExportFilename('png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      if (appliedScale < requestedScale - 1e-6) {
        this.cache.ui.warning(
          `Image too large at ${requestedScale}× — exported at the maximum supported resolution instead.`
        );
      }
    } catch (errorMsg) {
      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.cache.ui.error(errorMsg);
    }
  }

  /**
   * Export the current viewport as SVG — resolution-independent vector output
   * (publication figures, editable in Inkscape/Illustrator), so there is no
   * scale factor and no canvas size ceiling involved.
   */
  async exportSVG() {
    try {
      await this.cache.ui.showLoading('Loading', 'Generating vector data');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { svg } = this.cache.graph.toSVG();

      const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      // The download fetches the blob AFTER click() returns (asynchronously),
      // so revoking on this tick races it — Firefox reliably saves an empty
      // file. Defer the revoke; a data URI is no alternative because large
      // graphs exceed browsers' data-URI navigation limits.
      setTimeout(() => URL.revokeObjectURL(objectUrl), SVG_URL_REVOKE_DELAY_MS);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = this.buildExportFilename('svg');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    } catch (errorMsg) {
      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.cache.ui.error(errorMsg);
    }
  }
}

export {
  excelData,
  ExcelTemplate,
  EXCEL_NODE_PROPERTIES,
  EXCEL_EDGE_PROPERTIES,
  IOManager,
  normalizeD4DataBooleans,
  cellValueToPrimitive,
  worksheetToJson,
  decodeKey,
  getOrNull,
  validateUserData,
  addNodeOrEdgeUserData,
};
