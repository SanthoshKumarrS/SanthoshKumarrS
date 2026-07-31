#!/usr/bin/env node
/**
 * 3D Contributions
 * ------------------------------------------------------------------
 * Renders the GitHub contribution calendar as an isometric city of
 * towers — one tower per day, height scaled to that day's commits.
 * Towers rise in a diagonal sweep when the SVG loads.
 *
 * Reads the public contribution calendar, so no token is required.
 *
 * Usage:  GH_USER=SanthoshKumarrS node scripts/generate-3d-contrib.mjs
 * Output: profile-3d-contrib/profile-green-animate.svg
 */

import { mkdir, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "SanthoshKumarrS";
const OUT_DIR = process.env.OUT_DIR || "profile-3d-contrib";
const OUT_FILE = `${OUT_DIR}/profile-green-animate.svg`;

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */
// Dimetric projection. Two screen-space basis vectors: one step along the
// week axis and one along the day axis. The week axis is kept shallow so
// 53 weeks lay out as a wide band rather than a long 45-degree diagonal.
const WEEK = { x: 14, y: 2.4 };
const DAY = { x: -7, y: 9.5 };
const BASE = 3; // slab height for a zero-contribution day
const RISE = 46; // extra height for the busiest day
const PAD = 34; // canvas padding
const HEAD = 104; // header band height

/* ------------------------------------------------------------------ */
/* palette — GitHub greens on the README's dark backdrop               */
/* ------------------------------------------------------------------ */
const LEVELS = ["#1b2430", "#0e4429", "#006d32", "#26a641", "#39d353"];
const BG = ["#0D1117", "#111a2e", "#1a1140"];
const ACCENT = "#8A2BE2";
const ACCENT2 = "#00BFFF";
const TEXT = "#c9d1d9";
const MUTED = "#6e7681";

/** Multiply a hex colour toward black — used for the two side faces. */
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* ------------------------------------------------------------------ */
/* fetch + parse the public contribution calendar                      */
/* ------------------------------------------------------------------ */
async function fetchDays() {
  const res = await fetch(`https://github.com/users/${USER}/contributions`, {
    headers: { "User-Agent": "generate-3d-contrib", Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${USER}`);
  const html = await res.text();

  // Tooltips carry the exact counts, keyed by the cell id they describe.
  const counts = new Map();
  for (const m of html.matchAll(
    /<tool-tip[^>]*\sfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g,
  )) {
    const n = /^(\d+)\s+contribution/.exec(m[2].trim());
    counts.set(m[1], n ? Number(n[1]) : 0);
  }

  const days = [];
  for (const tag of html.match(/<td[^>]*ContributionCalendar-day[^>]*>/g) ?? []) {
    const date = /data-date="([^"]+)"/.exec(tag)?.[1];
    const id = /\sid="([^"]+)"/.exec(tag)?.[1];
    const week = /data-ix="(\d+)"/.exec(tag)?.[1];
    if (!date || !id || week === undefined) continue;

    days.push({
      date,
      week: Number(week),
      dow: new Date(`${date}T00:00:00Z`).getUTCDay(),
      level: Number(/data-level="(\d+)"/.exec(tag)?.[1] ?? 0),
      count: counts.get(id) ?? 0,
    });
  }
  if (days.length === 0) throw new Error("No contribution cells found");
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ */
/* stats                                                               */
/* ------------------------------------------------------------------ */
function summarise(days) {
  const total = days.reduce((s, d) => s + d.count, 0);
  const best = days.reduce((m, d) => Math.max(m, d.count), 0);

  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  // Current streak walks backwards; today counts only if it has activity.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) current++;
    else if (i < days.length - 1) break;
  }

  return { total, best, longest, current };
}

/* ------------------------------------------------------------------ */
/* one isometric tower = top diamond + two side faces                  */
/* ------------------------------------------------------------------ */
function tower(px, py, h, colour) {
  const top = shade(colour, 1);
  const right = shade(colour, 0.72);
  const left = shade(colour, 0.46);

  // Four corners of the cell's top face, lifted h above the ground plane.
  const p = (a, b) => `${(px + a).toFixed(1)},${(py + b - h).toFixed(1)}`;
  const A = p(0, 0);
  const B = p(WEEK.x, WEEK.y);
  const C = p(WEEK.x + DAY.x, WEEK.y + DAY.y);
  const D = p(DAY.x, DAY.y);

  // The two faces meeting at the near corner C are the ones facing the viewer.
  const drop = (pt) => {
    const [a, b] = pt.split(",");
    return `${a},${(Number(b) + h).toFixed(1)}`;
  };

  return (
    `<polygon points="${D} ${C} ${drop(C)} ${drop(D)}" fill="${left}"/>` +
    `<polygon points="${B} ${C} ${drop(C)} ${drop(B)}" fill="${right}"/>` +
    `<polygon points="${A} ${B} ${C} ${D}" fill="${top}"/>`
  );
}

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */
const days = await fetchDays();
const { total, best, longest, current } = summarise(days);

const weeks = Math.max(...days.map((d) => d.week)) + 1;
const scale = best > 0 ? RISE / best : 0;

// The day axis runs left, so the plate's left edge sits under (week 0, Saturday).
const originX = PAD - 6 * DAY.x;
const originY = HEAD + PAD + RISE;
const W = originX + (weeks - 1) * WEEK.x + WEEK.x + PAD;
const H = originY + (weeks - 1) * WEEK.y + 8.4 * DAY.y + PAD;

const project = (d) => ({
  x: originX + d.week * WEEK.x + d.dow * DAY.x,
  y: originY + d.week * WEEK.y + d.dow * DAY.y,
});

// Painter's algorithm: both axes run toward the viewer, so ordering by the
// cell's ground-plane depth draws neighbours back-to-front.
const depth = (d) => d.week * WEEK.y + d.dow * DAY.y;
const ordered = [...days].sort((a, b) => depth(a) - depth(b));
const maxDepth = depth({ week: weeks - 1, dow: 6 }) || 1;

const bars = ordered
  .map((d) => {
    const { x, y } = project(d);
    const h = BASE + d.count * scale;
    const delay = ((depth(d) / maxDepth) * 1.5).toFixed(3);
    return (
      `<g class="t" style="animation-delay:${delay}s">` +
      tower(x, y, h, LEVELS[d.level]) +
      `</g>`
    );
  })
  .join("\n");

// Month labels sit below the front edge, where no tower can overlap them.
const seen = new Set();
const months = days
  .filter((d) => {
    const key = d.date.slice(0, 7);
    if (seen.has(key) || Number(d.date.slice(8)) > 7) return false;
    seen.add(key);
    return true;
  })
  .map((d) => {
    const x = originX + d.week * WEEK.x + 7.6 * DAY.x;
    const y = originY + d.week * WEEK.y + 8.0 * DAY.y;
    const label = new Date(`${d.date}T00:00:00Z`).toLocaleString("en", {
      month: "short",
      timeZone: "UTC",
    });
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="mo">${label}</text>`;
  })
  .join("\n");

const from = days[0].date;
const to = days[days.length - 1].date;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="${USER}'s GitHub contributions as an isometric 3D graph">
  <title>${USER} — ${total} contributions from ${from} to ${to}</title>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BG[0]}"/>
      <stop offset="55%" stop-color="${BG[1]}"/>
      <stop offset="100%" stop-color="${BG[2]}"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT2}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <style>
    text { font-family: 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; }
    .name { font-size: 22px; font-weight: 700; fill: ${TEXT}; }
    .sub  { font-size: 12px; fill: ${MUTED}; }
    .statn{ font-size: 17px; font-weight: 700; fill: ${ACCENT2}; }
    .statl{ font-size: 10px; fill: ${MUTED}; letter-spacing: .08em; }
    .mo   { font-size: 9px; fill: ${MUTED}; text-anchor: middle; }
    .t    { opacity: 0; animation: rise .55s ease-out forwards; }
    @keyframes rise {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .t { animation: none; opacity: 1; }
    }
  </style>

  <rect width="100%" height="100%" fill="url(#sky)"/>

  <text x="${PAD}" y="${PAD + 12}" class="name">${USER}</text>
  <text x="${PAD}" y="${PAD + 32}" class="sub">${total} contributions · ${from} → ${to}</text>
  <rect x="${PAD}" y="${PAD + 42}" width="${(W - PAD * 2).toFixed(0)}" height="2" fill="url(#rule)"/>

  <text x="${PAD}" y="${PAD + 68}" class="statn">${total}</text>
  <text x="${PAD}" y="${PAD + 82}" class="statl">TOTAL</text>
  <text x="${PAD + 96}" y="${PAD + 68}" class="statn">${longest}</text>
  <text x="${PAD + 96}" y="${PAD + 82}" class="statl">LONGEST STREAK</text>
  <text x="${PAD + 216}" y="${PAD + 68}" class="statn">${current}</text>
  <text x="${PAD + 216}" y="${PAD + 82}" class="statl">CURRENT STREAK</text>
  <text x="${PAD + 336}" y="${PAD + 68}" class="statn">${best}</text>
  <text x="${PAD + 336}" y="${PAD + 82}" class="statl">BEST DAY</text>

${bars}

${months}
</svg>
`;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, svg);
console.log(`${OUT_FILE} — ${total} contributions, ${days.length} days, ${weeks} weeks`);
