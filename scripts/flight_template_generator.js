// Run: node flight_template_generator.js [nodeCount]
// Output: airport-network-template.xlsx

const ExcelJS = require("exceljs");

const nodeCount = Number(process.argv[2] || 120);

const OPENFLIGHTS_AIRPORTS =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";
const OPENFLIGHTS_ROUTES =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat";

const nodeHeaders = [
  "ID",
  "Label",
  "Description",
  "iata [codes]",
  "icao [codes]",
  "country [geo]",
  "region [geo]",
  "lat [geo]",
  "lon [geo]",
  "altitude_m [geo]",
  "zone [geo]",
  "bio_risk_level [health]",
];

const edgeHeaders = [
  "Source ID",
  "Target ID",
  "Label",
  "Description",
  "Start Arrow",
  "End Arrow",
  "airline [carrier]",
  "equipment [aircraft]",
  "distance_km [geo]",
  "flight_count [traffic]",
  "avg_delay_min [ops]",
  "weight [traffic]",
];

const toRad = (deg) => (deg * Math.PI) / 180;
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const hashInt = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};

const pickFrom = (arr, seed) => arr[seed % arr.length];

const regionFromTz = (tz) => {
  const prefix = (tz || "").split("/")[0];
  const map = {
    Africa: "Africa",
    America: "North America",
    Asia: "Asia",
    Europe: "Europe",
    Australia: "Oceania",
    Pacific: "Oceania",
    Atlantic: "Europe",
  };
  return map[prefix] || "";
};

const normalizeEquipment = (raw) => {
  const text = String(raw || "").trim();
  if (!text || text === "\\N") return "Unknown";
  const tokens = text.split(/\s+/).filter(Boolean);
  const cleaned = tokens.map((t) => t.replace(/[^A-Za-z]/g, "")).filter(Boolean);
  return cleaned.length ? cleaned.join(" ") : "Unknown";
};

/** OpenFlights altitudes are in feet; the template column is in metres. */
const METRES_PER_FOOT = 0.3048;

/** A numeric cell, or an empty one when OpenFlights has no value. */
const toNumber = (raw) => {
  const value = Number(raw);
  return raw === "" || raw === "\\N" || !Number.isFinite(value) ? "" : value;
};

const toMetres = (rawFeet) => {
  const feet = toNumber(rawFeet);
  return feet === "" ? "" : Math.round(feet * METRES_PER_FOOT);
};

// Simple CSV parser that respects quoted fields
function parseCSV(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i - 1] !== "\\") {
          inQuotes = !inQuotes;
          continue;
        }
        if (ch === "," && !inQuotes) {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out;
    });
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.text();
}

async function main() {
  const workbook = new ExcelJS.Workbook();

  // Nodes sheet
  const nodesSheet = workbook.addWorksheet("nodes");
  nodesSheet.addRow(nodeHeaders);

  const airportsText = await fetchText(OPENFLIGHTS_AIRPORTS);
  const airports = parseCSV(airportsText);

  const nodes = [];
  const nodeIdSet = new Set();
  const nodeGeo = new Map();
  const usedCountries = new Set();
  for (const a of airports) {
    // OpenFlights airports.dat fields:
    // 0 ID, 1 Name, 2 City, 3 Country, 4 IATA, 5 ICAO, 6 Lat, 7 Lon, 8 Altitude, 9 TZ, 10 DST, 11 TzDB, 12 Type, 13 Source
    const iata = a[4] && a[4] !== "\\N" ? a[4] : "";
    const icao = a[5] && a[5] !== "\\N" ? a[5] : "";
    const id = iata || icao;
    const country = a[3] || "";
    if (!id || nodeIdSet.has(id)) continue;
    if (usedCountries.has(country)) continue;

    const lat = Number(a[6]);
    const lon = Number(a[7]);
    const tz = a[11] || "";
    const seed = hashInt(id);

    const row = {
      "ID": id,
      "Label": a[1] || id,
      "Description": [a[1], a[2], a[3]].filter(Boolean).join(", "),
      "iata [codes]": iata,
      "icao [codes]": icao,
      "country [geo]": country,
      "region [geo]": regionFromTz(tz),
      "lat [geo]": toNumber(a[6]),
      "lon [geo]": toNumber(a[7]),
      "altitude_m [geo]": toMetres(a[8]),
      "zone [geo]": tz.split("/")[0] || "",
      "bio_risk_level [health]": pickFrom(["low", "medium", "high"], seed >> 3),
    };

    nodeIdSet.add(id);
    usedCountries.add(country);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      nodeGeo.set(id, { lat, lon });
    }
    nodes.push(row);
    nodesSheet.addRow(nodeHeaders.map((h) => row[h]));
    if (nodes.length >= nodeCount) break;
  }

  // Fill remaining slots (if unique countries run out)
  if (nodes.length < nodeCount) {
    for (const a of airports) {
      const iata = a[4] && a[4] !== "\\N" ? a[4] : "";
      const icao = a[5] && a[5] !== "\\N" ? a[5] : "";
      const id = iata || icao;
      const country = a[3] || "";
      if (!id || nodeIdSet.has(id)) continue;

      const lat = Number(a[6]);
      const lon = Number(a[7]);
      const tz = a[11] || "";
      const seed = hashInt(id);

      const row = {
        "ID": id,
        "Label": a[1] || id,
        "Description": [a[1], a[2], a[3]].filter(Boolean).join(", "),
        "iata [codes]": iata,
        "icao [codes]": icao,
        "country [geo]": country,
        "region [geo]": regionFromTz(tz),
        "lat [geo]": toNumber(a[6]),
        "lon [geo]": toNumber(a[7]),
        "altitude_m [geo]": toMetres(a[8]),
        "zone [geo]": tz.split("/")[0] || "",
        "bio_risk_level [health]": pickFrom(["low", "medium", "high"], seed >> 3),
      };

      nodeIdSet.add(id);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        nodeGeo.set(id, { lat, lon });
      }
      nodes.push(row);
      nodesSheet.addRow(nodeHeaders.map((h) => row[h]));
      if (nodes.length >= nodeCount) break;
    }
  }

  // Edges sheet
  const edgesSheet = workbook.addWorksheet("edges");
  edgesSheet.addRow(edgeHeaders);

  const routesText = await fetchText(OPENFLIGHTS_ROUTES);
  const routes = parseCSV(routesText);

  const edgeKeys = new Set();
  const degree = new Map();

  const addEdge = (source, target, airline, equipment) => {
    const keyParts = [source, target].sort();
    const key = `${keyParts[0]}__${keyParts[1]}`;
    if (edgeKeys.has(key)) return;

    const geoA = nodeGeo.get(source);
    const geoB = nodeGeo.get(target);
    const distance =
      geoA && geoB ? Math.round(haversineKm(geoA.lat, geoA.lon, geoB.lat, geoB.lon)) : "";

    const flightCount =
      typeof distance === "number" && distance > 0
        ? Math.max(5, Math.round(1500 / Math.sqrt(distance)))
        : 25;

    const avgDelay =
      typeof distance === "number" && distance > 0
        ? Math.round(Math.min(90, distance / 180))
        : 30;

    const row = {
      "Source ID": source,
      "Target ID": target,
      "Label": `${source} → ${target}`,
      "Description": `Route between ${source} and ${target}`,
      "Start Arrow": "FALSE",
      "End Arrow": "FALSE",
      "airline [carrier]": airline || "",
      "equipment [aircraft]": normalizeEquipment(equipment),
      "distance_km [geo]": distance,
      "flight_count [traffic]": flightCount,
      "avg_delay_min [ops]": avgDelay,
      "weight [traffic]": flightCount,
    };

    edgeKeys.add(key);
    edgesSheet.addRow(edgeHeaders.map((h) => row[h]));
    degree.set(source, (degree.get(source) || 0) + 1);
    degree.set(target, (degree.get(target) || 0) + 1);
  };

  for (const r of routes) {
    // OpenFlights routes.dat fields:
    // 0 Airline, 1 Airline ID, 2 Source airport, 3 Source ID, 4 Destination airport, 5 Destination ID, 6 Codeshare, 7 Stops, 8 Equipment
    const source = r[2] && r[2] !== "\\N" ? r[2] : "";
    const target = r[4] && r[4] !== "\\N" ? r[4] : "";
    if (!source || !target || source === target) continue;
    if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) continue;

    addEdge(source, target, r[0], r[8]);
  }

  // Ensure every node has at least one edge
  const nodeIds = [...nodeIdSet];
  for (const id of nodeIds) {
    if ((degree.get(id) || 0) > 0) continue;

    let target = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    if (target === id) {
      target = nodeIds[(nodeIds.indexOf(id) + 1) % nodeIds.length];
    }
    addEdge(id, target, "Generated", "N/A");
  }

  // Ensure a minimum edge count (e.g., 2x nodes)
  const minEdges = nodeCount * 2;
  while (edgeKeys.size < minEdges) {
    const source = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    let target = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    if (target === source) continue;

    addEdge(source, target, "Generated", "N/A");
  }

  await workbook.xlsx.writeFile("../templates/airport-network-template.xlsx");
  console.log("Generated airport-network-template.xlsx");
}

main().catch((err) => {
  console.error("Error generating template:", err);
});