"use strict";

const crypto = require("crypto");

/**
 * Extract the token from an `Authorization: Bearer <token>` header value.
 * @param {string|undefined} authHeader
 * @returns {string|null}
 */
function extractBearer(authHeader) {
  if (typeof authHeader !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : null;
}

/**
 * Constant-time comparison of the presented bearer token against the expected one.
 * Returns false for any malformed input rather than throwing.
 *
 * @param {string|undefined} authHeader  Raw Authorization header value.
 * @param {string} expectedToken
 * @returns {boolean}
 */
function checkToken(authHeader, expectedToken) {
  const presented = extractBearer(authHeader);
  if (!presented || typeof expectedToken !== "string" || expectedToken.length === 0) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expectedToken);
  // timingSafeEqual requires equal lengths; the length check itself is not
  // secret (token length is fixed) so an early return here is acceptable.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { extractBearer, checkToken };
