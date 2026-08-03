#!/usr/bin/env node
/**
 * Strip the star and fork totals from the 3D contribution SVGs.
 * ------------------------------------------------------------------
 * github-profile-3d-contrib always draws a star count and a fork count in the
 * footer next to the contribution total, and exposes no setting to turn them
 * off (see src/create-svg.ts upstream — the counts are unconditional).
 *
 * Each one is emitted as an icon group followed by its label:
 *
 *   <g transform="translate(608, 802), scale(2)">
 *     <path fill-rule="evenodd" d="M8 .25a…" class="fill-fg"></path>
 *   </g>
 *   <text … text-anchor="start" class="fill-fg">539<title>539</title></text>
 *
 * Both icons are matched on the leading edge of their Octicon path data, which
 * is a stable constant in the upstream source, then the icon and its adjacent
 * label are removed together.
 *
 * Usage:  node scripts/strip-stars-forks.mjs [dir]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = process.argv[2] || process.env.OUT_DIR || "profile-3d-contrib";

// Leading edge of each Octicon path, enough to identify it unambiguously.
const ICONS = {
  star: "M8 .25a.75.75 0 01.673.418",
  fork: "M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122",
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Icon group + the count label that follows it. */
const pattern = (pathPrefix) =>
  new RegExp(
    `<g transform="[^"]*">` +
      `<path fill-rule="evenodd" d="${escape(pathPrefix)}[^"]*"[^>]*>` +
      `</path></g>` +
      `<text[^>]*>[^<]*<title>[^<]*</title></text>`,
    "g",
  );

const files = (await readdir(DIR)).filter((f) => f.endsWith(".svg"));
if (files.length === 0) throw new Error(`No SVGs found in ${DIR}`);

let touched = 0;

for (const file of files) {
  const path = join(DIR, file);
  const before = await readFile(path, "utf8");

  let after = before;
  const removed = [];
  for (const [name, prefix] of Object.entries(ICONS)) {
    const next = after.replace(pattern(prefix), "");
    if (next !== after) removed.push(name);
    after = next;
  }

  if (after === before) {
    console.log(`${file} — nothing to strip`);
    continue;
  }

  await writeFile(path, after);
  touched++;
  console.log(`${file} — removed ${removed.join(" + ")}`);
}

// A zero here means upstream changed its markup and the counts are now sneaking
// back onto the profile. Surfaced as a warning rather than a hard failure so a
// refresh of the graph itself still goes through.
if (touched === 0) {
  console.warn(
    "WARNING: no star/fork markup matched in any SVG — " +
      "check whether github-profile-3d-contrib changed its output.",
  );
}
