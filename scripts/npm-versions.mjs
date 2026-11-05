/**
 * npm-versions.mjs — the versions npm will never accept again for this package.
 *
 * npm refuses to publish a version number it has ever accepted, even after that version was
 * unpublished: `npm view` then reports it as missing, yet `npm publish` fails with "Cannot publish
 * over previously published version". The registry document's `time` field still lists every such
 * version, so release automation reads that instead of `npm view`.
 *
 *   node scripts/npm-versions.mjs next 0.1.0    → the next patch after 0.1.0 that npm has never seen
 *   node scripts/npm-versions.mjs check 0.1.1   → exit 1 if 0.1.1 was ever used and is not live now
 *   node scripts/npm-versions.mjs unused 0.1.0  → exit 0 if npm has never accepted 0.1.0
 *
 * Reads the package name from package.json and the registry from $NPM_REGISTRY (default npmjs.org).
 * Node built-ins only, so a workflow can run it before `bun install`.
 */
import { readFileSync } from "node:fs";

const REGISTRY = (process.env.NPM_REGISTRY || "https://registry.npmjs.org").replace(/\/$/, "");
const { name } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** A valid npm package name, optionally scoped. Anything else never reaches the network. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** The registry document URL: the scope's "@" stays literal, everything else is encoded. */
const documentUrl = (pkg) => `${REGISTRY}/${encodeURIComponent(pkg).replace(/^%40/, "@")}`;

/** Every version npm has accepted for `name` — live, deprecated or unpublished — and the live ones. */
export async function versionsOf(pkg = name) {
  if (!PACKAGE_NAME.test(pkg)) throw new Error(`not a valid npm package name: ${pkg}`);
  const response = await fetch(documentUrl(pkg));
  if (response.status === 404) return { used: new Set(), live: new Set() };
  if (!response.ok) throw new Error(`${REGISTRY} answered ${response.status} for ${pkg}`);
  const doc = await response.json();
  const time = doc.time ?? {};
  const live = new Set(Object.keys(doc.versions ?? {}));
  const used = new Set([
    ...Object.keys(time).filter((key) => !["created", "modified", "unpublished"].includes(key)),
    ...(time.unpublished?.versions ?? []),
    ...live,
  ]);
  return { used, live };
}

const bumpPatch = (version) => {
  const [major, minor, patch] = version.split(".").map(Number);
  return [major, minor, patch + 1].join(".");
};

const [command, version] = process.argv.slice(2);
if (command === "next") {
  const { used } = await versionsOf();
  let next = bumpPatch(version);
  while (used.has(next)) next = bumpPatch(next);
  console.log(next);
} else if (command === "check") {
  const { used, live } = await versionsOf();
  if (used.has(version) && !live.has(version)) {
    console.error(
      `${name}@${version} was published before and later unpublished. npm never accepts a version ` +
        `number twice — raise "version" in package.json (node scripts/npm-versions.mjs next ${version}).`,
    );
    process.exit(1);
  }
  console.log(`${name}@${version}: ${live.has(version) ? "already published" : "available"}`);
} else if (command === "unused") {
  const { used } = await versionsOf();
  process.exit(used.has(version) ? 1 : 0);
} else {
  console.error("usage: node scripts/npm-versions.mjs next <version> | check <version> | unused <version>");
  process.exit(2);
}
