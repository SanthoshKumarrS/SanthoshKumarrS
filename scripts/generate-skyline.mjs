#!/usr/bin/env node
/**
 * Contribution City
 * ------------------------------------------------------------------
 * Turns a GitHub contribution calendar into an animated city skyline.
 * One tower per week, one lit floor per contribution.
 *
 * Usage:  GITHUB_TOKEN=... GH_USER=SanthoshKumarrS node scripts/generate-skyline.mjs
 * Output: dist/contribution-city.svg  (dark)
 *         dist/contribution-city-light.svg
 */

import { mkdir, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "SanthoshKumarrS";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || "dist";

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */
const BW = 16; // building width
const GAP = 4; // gap between buildings
const PAD = 28; // horizontal padding
const FLOOR = 9; // height of one floor = one contribution
const MAX_FLOORS = 30; // tallest tower we allow before scaling down
const GROUND = 392; // y of the street
const H = 470; // total height

/* ------------------------------------------------------------------ */
/* palettes                                                            */
/* ------------------------------------------------------------------ */
const THEMES = {
  dark: {
    sky: ["#0D1117", "#131a33", "#1d1140"],
    haze: "#8A2BE2",
    ground: "#0D1117",
    street: "#8A2BE2",
    text: "#c9d1d9",
    muted: "#6e7681",
    stars: true,
    moon: ["#ffffff", "#cbd5ff"],
    levels: [
      { a: "#101d36", b: "#1d3a6b" },
      { a: "#132a55", b: "#2a5fb0" },
      { a: "#1d2963", b: "#5b3fd6" },
      { a: "#2a1650", b: "#8A2BE2" },
    ],
    edge: "#00BFFF",
    winOn: "#FFD166",
    winCool: "#00BFFF",
    winOff: "#0a1020",
    winOffOpacity: 0.55,
    plot: "#1b2230",
  },
  light: {
    sky: ["#eaf2ff", "#dbe7ff", "#e9dcff"],
    haze: "#8A2BE2",
    ground: "#f4f7ff",
    street: "#8A2BE2",
    text: "#1f2328",
    muted: "#6a737d",
    stars: false,
    moon: ["#fff6cc", "#ffd166"],
    levels: [
      { a: "#9fb6dd", b: "#c9d9f2" },
      { a: "#6d92cf", b: "#a9c6ef" },
      { a: "#7a6bd8", b: "#b3a6f5" },
      { a: "#8A2BE2", b: "#c79bf5" },
    ],
    edge: "#00BFFF",
    winOn: "#FFB703",
    winCool: "#0092c7",
    winOff: "#ffffff",
    winOffOpacity: 0.35,
    plot: "#c9d4e8",
  },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG so a rebuild with the same data yields the same city. */
function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function fetchCalendar() {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is required to read the contribution calendar.");
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              firstDay
              contributionDays { date contributionCount }
            }
          }
        }
      }
    }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "contribution-city",
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error(`No contribution calendar found for "${USER}".`);
  return cal;
}

/* ------------------------------------------------------------------ */
/* renderer                                                            */
/* ------------------------------------------------------------------ */
function render(cal, themeName) {
  const t = THEMES[themeName];
  const weeks = cal.weeks.map((w) => ({
    firstDay: w.firstDay,
    count: w.contributionDays.reduce((a, d) => a + d.contributionCount, 0),
    days: w.contributionDays.length,
  }));

  const W = PAD * 2 + weeks.length * (BW + GAP) - GAP;
  const peak = Math.max(1, ...weeks.map((w) => w.count));
  const scale = peak > MAX_FLOORS ? MAX_FLOORS / peak : 1;
  const rand = rng(`${USER}:${cal.totalContributions}:${weeks.length}`);

  const defs = [];
  const sky = [];
  const city = [];
  const labels = [];

  /* ---------- sky ------------------------------------------------- */
  defs.push(
    `<linearGradient id="sky" x1="0" y1="0" x2="0.35" y2="1">` +
      `<stop offset="0%" stop-color="${t.sky[0]}"/>` +
      `<stop offset="55%" stop-color="${t.sky[1]}"/>` +
      `<stop offset="100%" stop-color="${t.sky[2]}"/>` +
      `</linearGradient>`,
    `<radialGradient id="haze" cx="0.5" cy="1" r="0.75">` +
      `<stop offset="0%" stop-color="${t.haze}" stop-opacity="${themeName === "dark" ? 0.34 : 0.18}"/>` +
      `<stop offset="100%" stop-color="${t.haze}" stop-opacity="0"/>` +
      `</radialGradient>`,
    `<radialGradient id="moon">` +
      `<stop offset="0%" stop-color="${t.moon[0]}"/>` +
      `<stop offset="70%" stop-color="${t.moon[1]}"/>` +
      `<stop offset="100%" stop-color="${t.moon[1]}" stop-opacity="0"/>` +
      `</radialGradient>`,
    `<linearGradient id="mirror" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#fff" stop-opacity="0.42"/>` +
      `<stop offset="100%" stop-color="#fff" stop-opacity="0"/>` +
      `</linearGradient>`,
    `<mask id="fade"><rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="url(#mirror)"/></mask>`,
  );

  sky.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
  sky.push(`<rect x="0" y="${GROUND - 260}" width="${W}" height="260" fill="url(#haze)"/>`);

  // moon / sun — sits below the header band so it never fights the text
  const moonX = W - 86;
  const moonY = 148;
  sky.push(
    `<circle cx="${moonX}" cy="${moonY}" r="42" fill="url(#moon)" opacity="0.5"/>`,
    `<circle cx="${moonX}" cy="${moonY}" r="16" fill="${t.moon[0]}" opacity="${themeName === "dark" ? 0.9 : 1}"/>`,
  );

  if (t.stars) {
    for (let i = 0; i < 70; i++) {
      const x = r1(rand() * W);
      const y = r1(20 + rand() * 230);
      const rr = r1(0.5 + rand() * 1.1);
      const d = r1(rand() * 4);
      sky.push(`<circle class="st" cx="${x}" cy="${y}" r="${rr}" fill="#fff" style="animation-delay:${d}s"/>`);
    }
  } else {
    // daytime: a couple of drifting clouds
    for (let i = 0; i < 3; i++) {
      const y = r1(50 + rand() * 110);
      const s = r1(0.7 + rand() * 0.6);
      const d = r1(-rand() * 60);
      sky.push(
        `<g class="cloud" style="animation-delay:${d}s" opacity="0.75">` +
          `<g transform="translate(-160 ${y}) scale(${s})">` +
          `<ellipse cx="0" cy="0" rx="34" ry="14" fill="#fff"/>` +
          `<ellipse cx="26" cy="6" rx="26" ry="11" fill="#fff"/>` +
          `<ellipse cx="-24" cy="6" rx="22" ry="10" fill="#fff"/>` +
          `</g></g>`,
      );
    }
  }

  // a blinking aircraft crossing the skyline
  sky.push(
    `<g class="plane"><g transform="translate(-40 96)">` +
      `<circle cx="0" cy="0" r="1.8" fill="#fff"/>` +
      `<circle class="beacon" cx="0" cy="0" r="3.2" fill="#ff5a5a"/>` +
      `<rect x="-26" y="-0.4" width="22" height="0.8" fill="#fff" opacity="0.28"/>` +
      `</g></g>`,
  );

  /* ---------- buildings ------------------------------------------- */
  weeks.forEach((week, i) => {
    const x = PAD + i * (BW + GAP);
    const c = week.count;

    if (c === 0) {
      // empty lot — a fenced-off plot waiting for its first commit
      city.push(
        `<g class="b" style="animation-delay:${r1(i * 0.016)}s">` +
          `<rect x="${x}" y="${GROUND - 4}" width="${BW}" height="4" rx="1" fill="${t.plot}"/>` +
          `<rect x="${x + 3}" y="${GROUND - 9}" width="1" height="5" fill="${t.plot}"/>` +
          `<rect x="${x + BW - 4}" y="${GROUND - 9}" width="1" height="5" fill="${t.plot}"/>` +
          `<rect x="${x + 2}" y="${GROUND - 8}" width="${BW - 4}" height="1" fill="${t.plot}"/>` +
          `</g>`,
      );
      return;
    }

    const floors = Math.max(1, Math.round(c * scale));
    const bh = floors * FLOOR;
    const y = GROUND - bh;
    const lvl = Math.min(3, Math.floor((c / peak) * 4 - 1e-6));
    const g = t.levels[lvl];
    const gid = `bg${lvl}`;

    if (!defs.some((d) => d.includes(`id="${gid}"`))) {
      defs.push(
        `<linearGradient id="${gid}" x1="0" y1="1" x2="0.25" y2="0">` +
          `<stop offset="0%" stop-color="${g.a}"/>` +
          `<stop offset="100%" stop-color="${g.b}"/>` +
          `</linearGradient>`,
      );
    }

    const parts = [];
    // tower body
    parts.push(`<rect x="${x}" y="${y}" width="${BW}" height="${bh}" rx="1.5" fill="url(#${gid})"/>`);
    // lit edge catching the city glow
    parts.push(
      `<rect x="${x}" y="${y}" width="1.2" height="${bh}" fill="${t.edge}" opacity="${lvl >= 2 ? 0.5 : 0.22}"/>`,
    );

    // roof: flat parapet, stepped penthouse, or spire — picked deterministically
    const style = rand();
    if (style < 0.34) {
      parts.push(`<rect x="${x - 1}" y="${y - 3}" width="${BW + 2}" height="3" rx="1" fill="${g.b}"/>`);
    } else if (style < 0.7) {
      const pw = BW - 6;
      parts.push(
        `<rect x="${x + 3}" y="${y - 7}" width="${pw}" height="7" rx="1" fill="${g.b}"/>`,
        `<rect x="${x - 1}" y="${y - 1}" width="${BW + 2}" height="2" rx="1" fill="${g.b}" opacity="0.85"/>`,
      );
    } else {
      const cx = r1(x + BW / 2);
      parts.push(
        `<rect x="${x - 1}" y="${y - 2}" width="${BW + 2}" height="2" rx="1" fill="${g.b}"/>`,
        `<path d="M${x + 2} ${y - 2}L${cx} ${y - 16}L${x + BW - 2} ${y - 2}Z" fill="${g.b}"/>`,
        `<rect x="${r1(cx - 0.5)}" y="${y - 26}" width="1" height="11" fill="${t.edge}" opacity="0.7"/>`,
        `<circle class="beacon" cx="${cx}" cy="${y - 27}" r="2" fill="#ff5a5a" style="animation-delay:${r1(rand() * 2)}s"/>`,
      );
    }

    // tall towers get an aircraft-warning light even without a spire
    if (style >= 0.34 && floors >= 14) {
      parts.push(
        `<circle class="beacon" cx="${r1(x + BW / 2)}" cy="${y - (style < 0.7 ? 9 : 5)}" r="1.8" fill="#ff5a5a" style="animation-delay:${r1(rand() * 2)}s"/>`,
      );
    }

    // windows — two per floor, one floor per contribution
    const litChance = 0.4 + lvl * 0.14;
    for (let f = 0; f < floors; f++) {
      const wy = r1(GROUND - (f + 1) * FLOOR + 2);
      for (const wx of [x + 3, x + 9]) {
        const on = rand() < litChance;
        if (!on) {
          parts.push(
            `<rect x="${wx}" y="${wy}" width="4" height="5" fill="${t.winOff}" opacity="${t.winOffOpacity}"/>`,
          );
          continue;
        }
        const cool = rand() < 0.18;
        const flick = rand() < 0.14;
        parts.push(
          `<rect${flick ? ` class="fl" style="animation-delay:${r1(rand() * 6)}s"` : ""} x="${wx}" y="${wy}"` +
            ` width="4" height="5" fill="${cool ? t.winCool : t.winOn}" opacity="${r1(0.6 + rand() * 0.4)}"/>`,
        );
      }
    }

    city.push(`<g class="b" style="animation-delay:${r1(i * 0.016)}s">${parts.join("")}</g>`);

    /* month tick marks along the street */
    const d = new Date(week.firstDay + "T00:00:00Z");
    const prev = i > 0 ? new Date(weeks[i - 1].firstDay + "T00:00:00Z") : null;
    if (!prev || d.getUTCMonth() !== prev.getUTCMonth()) {
      labels.push(
        `<text x="${x}" y="${GROUND + 26}" class="mo">${MONTHS[d.getUTCMonth()]}</text>`,
        `<rect x="${x - 1}" y="${GROUND + 1}" width="1" height="5" fill="${t.muted}" opacity="0.6"/>`,
      );
    }
  });

  /* ---------- street + reflection --------------------------------- */
  const streetY = GROUND;
  const ground =
    `<rect x="0" y="${streetY}" width="${W}" height="${H - streetY}" fill="${t.ground}"/>` +
    `<rect x="0" y="${streetY - 1}" width="${W}" height="1.6" fill="${t.street}" opacity="0.85"/>` +
    `<rect x="0" y="${streetY - 3}" width="${W}" height="1" fill="${t.edge}" opacity="0.35"/>`;

  /* ---------- chrome ---------------------------------------------- */
  const best = Math.max(...weeks.map((w) => w.count));
  const active = weeks.filter((w) => w.count > 0).length;

  const header =
    `<text x="${PAD}" y="40" class="h1">Contribution City</text>` +
    `<text x="${PAD}" y="60" class="sub">@${USER} · one tower per week · one lit floor per contribution</text>` +
    `<text x="${W - PAD}" y="40" class="h1 r">${cal.totalContributions.toLocaleString("en-US")}</text>` +
    `<text x="${W - PAD}" y="60" class="sub r">contributions in the last year</text>`;

  const footer =
    `<text x="${PAD}" y="${H - 16}" class="sub">tallest tower ${best} · ${active}/${weeks.length} weeks built` +
    `${scale < 1 ? ` · heights scaled ×${scale.toFixed(2)}` : ""}</text>` +
    `<text x="${W - PAD}" y="${H - 16}" class="sub r">still under construction — rebuilt nightly</text>`;

  const css = `
    .h1{font:700 20px 'Segoe UI',Ubuntu,Helvetica,sans-serif;fill:${t.text}}
    .sub,.mo{font:400 11px 'Segoe UI',Ubuntu,Helvetica,sans-serif;fill:${t.muted}}
    .mo{font-size:10px}
    .r{text-anchor:end}
    .b{transform-box:view-box;transform-origin:0px ${GROUND}px;animation:rise .85s cubic-bezier(.2,.85,.25,1) backwards}
    .st{animation:tw 3.6s ease-in-out infinite}
    .fl{animation:flick 7s steps(1,end) infinite}
    .beacon{animation:blink 2.4s ease-in-out infinite}
    .plane{animation:fly 26s linear infinite}
    .cloud{animation:drift 90s linear infinite}
    @keyframes rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}
    @keyframes tw{0%,100%{opacity:.15}50%{opacity:.95}}
    @keyframes flick{0%,88%{opacity:.9}90%{opacity:.12}92%{opacity:.85}94%{opacity:.15}96%,100%{opacity:.9}}
    @keyframes blink{0%,45%{opacity:1}55%,100%{opacity:.08}}
    @keyframes fly{from{transform:translateX(0)}to{transform:translateX(${W + 120}px)}}
    @keyframes drift{from{transform:translateX(0)}to{transform:translateX(${W + 340}px)}}
    @media(prefers-reduced-motion:reduce){.b,.st,.fl,.beacon,.plane,.cloud{animation:none}}
  `.replace(/\s*\n\s*/g, "");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img" ` +
    `aria-label="${USER}'s GitHub contributions drawn as a city skyline, ${cal.totalContributions} contributions in the last year">` +
    `<defs>${defs.join("")}</defs><style>${css}</style>` +
    sky.join("") +
    `<g id="city">${city.join("")}</g>` +
    ground +
    `<use href="#city" transform="translate(0 ${GROUND * 2}) scale(1 -1)" mask="url(#fade)" opacity="0.65"/>` +
    labels.join("") +
    header +
    footer +
    `</svg>`
  );
}

/* ------------------------------------------------------------------ */
const cal = await fetchCalendar();
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/contribution-city.svg`, render(cal, "dark"));
await writeFile(`${OUT_DIR}/contribution-city-light.svg`, render(cal, "light"));
console.log(
  `Built ${OUT_DIR}/contribution-city{,-light}.svg for @${USER} — ${cal.totalContributions} contributions, ${cal.weeks.length} towers.`,
);
