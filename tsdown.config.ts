import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// ES modules only, as TanStack Start is. One file per source module, so the
// Start compiler sees each server function where it is defined, and the
// server-only modules stay behind the dynamic imports the client build drops.
export default defineConfig({
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  platform: "neutral",
  target: "es2023",
  unbundle: true,
  fixedExtension: true,
  dts: true,
  sourcemap: false,
  clean: true,
  // VERSION comes from package.json, the one place a release changes it.
  define: { __QEET_ID_TANSTACK_VERSION__: JSON.stringify(version) },
});
