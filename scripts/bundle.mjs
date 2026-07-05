/**
 * esbuild bundle script — bundles all workspace deps + third-party deps
 * into a self-contained CLI tool for npm publish.
 */
import * as esbuild from "esbuild";

// Shared esbuild config
const baseConfig = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  sourcemap: true,
  // Node built-ins that should NOT be bundled
  external: [
    "node:*",
    "child_process",
    "fs",
    "path",
    "os",
    "util",
    "stream",
    "readline",
    "events",
    "buffer",
    "crypto",
    "url",
    "http",
    "https",
    "net",
    "tls",
    "dns",
    "assert",
    "process",
    "tty",
    // MCP SDK uses cross-spawn which dynamically requires child_process —
    // must be kept external to avoid esbuild ESM bundling issues.
    "@modelcontextprotocol/sdk",
  ],
  // Resolve .ts files directly (workspace packages have src/index.ts)
  resolveExtensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
  // Avoid duplicating types-only imports
  treeShaking: true,
};

// ---- Build CLI entry (shebang already in cli.ts, esbuild preserves it) ----
await esbuild.build({
  ...baseConfig,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  legalComments: "none",
});

// ---- Build library entry ----
await esbuild.build({
  ...baseConfig,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  legalComments: "none",
});

console.log("✅ Bundle complete: dist/cli.js, dist/index.js");
