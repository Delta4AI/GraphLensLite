/**
 * Node-safe lasso geometry.
 *
 * Pure point-in-polygon math for the freehand lasso overlay; the DOM/canvas
 * part lives in interactions.js. Points and polygon vertices are plain
 * {x, y} objects in the same coordinate space (viewport pixels in practice).
 */

/**
 * Axis-aligned bounding box of a polygon.
 *
 * @param {Array<{x: number, y: number}>} polygon
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
 *   null for an empty polygon
 */
function polygonBBox(polygon) {
  if (!polygon || polygon.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Ray-casting point-in-polygon test (even-odd rule). Works for concave and
 * self-intersecting polygons, which freehand lassos routinely are.
 *
 * @param {{x: number, y: number}} point
 * @param {Array<{x: number, y: number}>} polygon  at least 3 vertices
 * @returns {boolean}
 */
function pointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crossesRay = a.y > point.y !== b.y > point.y;
    if (crossesRay && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * IDs of the points that fall inside the polygon, with a bbox prefilter so
 * the O(vertices) test only runs for candidates near the lasso.
 *
 * @param {Array<{id: string, x: number, y: number}>} points
 * @param {Array<{x: number, y: number}>} polygon
 * @returns {string[]}
 */
function idsInsidePolygon(points, polygon) {
  const bbox = polygonBBox(polygon);
  if (!bbox || polygon.length < 3) return [];
  const ids = [];
  for (const point of points) {
    if (point.x < bbox.minX || point.x > bbox.maxX) continue;
    if (point.y < bbox.minY || point.y > bbox.maxY) continue;
    if (pointInPolygon(point, polygon)) ids.push(point.id);
  }
  return ids;
}

export { pointInPolygon, polygonBBox, idsInsidePolygon };
