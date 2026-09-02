#!/usr/bin/env node
/*
  build-rankings.mjs
  ------------------------------------------------------------------
  Downloads the SCImago Journal Rank table and converts it into a compact
  rankings.json for the widget, keyed by ISSN, with each journal's per-category
  quartiles preserved (that's what makes the widget domain-aware).

  SCImago publishes one table per year, semicolon-delimited, with European
  decimals and a "Categories" column that already embeds quartiles, e.g.
  "Aging (Q1); Neuroscience (Q2)".

  Requirements: Node 18+ (built-in fetch). No npm install needed.

  Usage:
    node build-rankings.mjs                 # latest year, neuro-domain journals only
    node build-rankings.mjs --year 2024     # a specific SCImago year
    node build-rankings.mjs --all           # keep every journal (bigger file)
    node build-rankings.mjs --out rankings.json --domain domain.json

  Run it yearly (e.g. a cron job) and redeploy rankings.json so the widget
  tracks ranking changes. Data is SCImago's; cite them per their terms:
  https://www.scimagojr.com/
*/

import { writeFileSync, readFileSync } from "node:fs";

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const has = (flag) => args.includes(flag);

const YEAR = opt("--year", "");                 // "" = SCImago's default (latest)
const OUT = opt("--out", "rankings.json");
const KEEP_ALL = has("--all");
const DOMAIN_FILE = opt("--domain", "");

// Default neuro/behavioral/aging umbrella. Override with --domain domain.json
// (a JSON array of SCImago category names). Journals whose categories include
// at least one of these are kept; a kept journal retains ALL its categories.
const DEFAULT_DOMAIN = [
  "Neuroscience (miscellaneous)", "Neurology", "Neurology (clinical)",
  "Cellular and Molecular Neuroscience", "Behavioral Neuroscience",
  "Cognitive Neuroscience", "Developmental Neuroscience", "Sensory Systems",
  "Endocrine and Autonomic Systems", "Biological Psychiatry",
  "Psychiatry and Mental Health", "Aging", "Immunology",
  "Immunology and Allergy", "Physiology", "Pharmacology (medical)"
];
const DOMAIN = DOMAIN_FILE ? JSON.parse(readFileSync(DOMAIN_FILE, "utf8")) : DEFAULT_DOMAIN;
const DOMAIN_SET = new Set(DOMAIN);

// SCImago download endpoint. `out=xls` actually returns a semicolon CSV.
const SCIMAGO_URL = `https://www.scimagojr.com/journalrank.php?out=xls${YEAR ? `&year=${YEAR}` : ""}`;

// ---- CSV parsing ---------------------------------------------------------
// Quote-aware splitter for one semicolon-delimited line. Fields may be quoted
// with " and contain semicolons (ISSN lists, category lists). Doubled "" = ".
function splitLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ";") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.length);
  const header = splitLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (cells.length < header.length - 2) continue; // skip malformed
    const rec = {};
    header.forEach((h, idx) => { rec[h] = cells[idx] != null ? cells[idx] : ""; });
    rows.push(rec);
  }
  return { header, rows };
}

// Find a column by fuzzy name (headers vary slightly across SCImago years).
function col(header, ...candidates) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const cand of candidates) {
    const nc = norm(cand);
    const hit = header.find(h => norm(h) === nc) || header.find(h => norm(h).includes(nc));
    if (hit) return hit;
  }
  return null;
}

// Categories look like "Aging (Q1); Neuroscience (miscellaneous) (Q3)".
// Category names can themselves contain parentheses, so split on ";" and strip
// only the FINAL "(Qn)" from each chunk. Categories without a quartile (rare,
// when SCImago lacks data) are skipped since we can't threshold them.
function parseCategories(field) {
  const map = {};
  for (let chunk of String(field).split(";")) {
    chunk = chunk.trim();
    if (!chunk) continue;
    const m = chunk.match(/^(.+)\s*\((Q[1-4])\)\s*$/);
    if (m) map[m[1].trim()] = m[2];
  }
  return map;
}

function parseIssns(field) {
  return field.split(/[,\s]+/).map(s => s.replace(/[^0-9Xx]/g, "").toUpperCase())
    .filter(s => s.length === 8);
}

// ---- main ----------------------------------------------------------------
async function main() {
  console.log(`Fetching SCImago table: ${SCIMAGO_URL}`);
  const res = await fetch(SCIMAGO_URL, { headers: { "User-Agent": "lab-impact-widget/1.0 (build script)" } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}. If this persists, download the CSV manually from scimagojr.com › Journal Rankings › Download data, and pass it via --file.`);
  const text = await res.text();

  const { header, rows } = parseCsv(text);
  const cTitle = col(header, "Title");
  const cIssn = col(header, "Issn", "ISSN");
  const cSjr = col(header, "SJR");
  const cCats = col(header, "Categories");
  const cBestQ = col(header, "SJR Best Quartile", "Best Quartile");
  if (!cTitle || !cIssn || !cCats) throw new Error(`Unexpected CSV columns. Found: ${header.join(" | ")}`);

  const journals = {};
  const categoriesSeen = new Map();
  let kept = 0, issnKeys = 0;

  for (const r of rows) {
    const quartiles = parseCategories(r[cCats] || "");
    for (const cat of Object.keys(quartiles)) categoriesSeen.set(cat, (categoriesSeen.get(cat) || 0) + 1);

    const inDomain = Object.keys(quartiles).some(c => DOMAIN_SET.has(c));
    if (!KEEP_ALL && !inDomain) continue;

    const issns = parseIssns(r[cIssn] || "");
    if (!issns.length) continue;

    const record = {
      title: r[cTitle] || "",
      sjr: cSjr && r[cSjr] ? Number(r[cSjr].replace(/\./g, "").replace(",", ".")) || null : null,
      bestQuartile: cBestQ ? (r[cBestQ] || null) : null,
      quartiles
    };
    kept++;
    for (const issn of issns) { journals[issn] = record; issnKeys++; }
  }

  const domainCats = [...categoriesSeen.entries()]
    .filter(([c]) => DOMAIN_SET.has(c))
    .sort((a, b) => b[1] - a[1]);

  const output = {
    meta: {
      source: "SCImago Journal Rank (scimagojr.com), Scopus data",
      url: SCIMAGO_URL,
      year: YEAR || "latest",
      generated: new Date().toISOString().slice(0, 10),
      scope: KEEP_ALL ? "all journals" : "domain-filtered",
      journalCount: kept,
      citation: "SCImago, (n.d.). SJR — SCImago Journal & Country Rank [Portal]. Retrieved from https://www.scimagojr.com"
    },
    journals
  };

  writeFileSync(OUT, JSON.stringify(output));
  const kb = (JSON.stringify(output).length / 1024).toFixed(0);

  console.log(`\nParsed ${rows.length} journals from SCImago.`);
  console.log(`Kept ${kept} journals (${issnKeys} ISSN keys) → ${OUT} (${kb} KB).`);
  console.log(`\nYour domain categories present in the data (name — journal count):`);
  for (const [c, n] of domainCats) console.log(`  ${c} — ${n}`);
  const missing = DOMAIN.filter(c => !categoriesSeen.has(c));
  if (missing.length) {
    console.log(`\nConfigured categories NOT found in the data (check spelling against SCImago):`);
    for (const c of missing) console.log(`  ${c}`);
  }
  console.log(`\nDone. Deploy ${OUT} next to the widget and set CONFIG.rankingsUrl.`);
}

main().catch(err => { console.error("\nError:", err.message); process.exit(1); });
