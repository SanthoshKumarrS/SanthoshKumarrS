#!/usr/bin/env node
/**
 * Star counter
 * ------------------------------------------------------------------
 * Sums the stargazers across every non-fork repo owned by GH_USER and
 * rewrites the block between the STAR_COUNT markers in README.md.
 *
 * Usage:  GITHUB_TOKEN=... GH_USER=SanthoshKumarrS node scripts/update-star-count.mjs
 */

import { readFile, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "SanthoshKumarrS";
const TOKEN = process.env.GITHUB_TOKEN;
const README = process.env.README_PATH || "README.md";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "update-star-count",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

/* ------------------------------------------------------------------ */
/* fetch every owned repo, page by page                                */
/* ------------------------------------------------------------------ */
async function totalStars() {
  let stars = 0;
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/users/${USER}/repos?per_page=100&type=owner&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);

    const repos = await res.json();
    if (repos.length === 0) break;

    for (const repo of repos) {
      if (!repo.fork) stars += repo.stargazers_count;
    }
    if (repos.length < 100) break;
  }
  return stars;
}

/* ------------------------------------------------------------------ */
/* swap the marked block in place                                      */
/* ------------------------------------------------------------------ */
const stars = await totalStars();
const text = await readFile(README, "utf8");

const block =
  `<!-- STAR_COUNT_START -->\n` +
  `<div align="center"><b>Total Stars Across Projects:</b> ${stars} ⭐</div>\n` +
  `<!-- STAR_COUNT_END -->`;

const marked = /<!-- STAR_COUNT_START -->[\s\S]*?<!-- STAR_COUNT_END -->/;
if (!marked.test(text)) {
  throw new Error(`No STAR_COUNT markers found in ${README}`);
}

const updated = text.replace(marked, () => block);
if (updated !== text) await writeFile(README, updated);

console.log(`Total stars: ${stars}`);
