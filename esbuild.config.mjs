import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prod = process.argv[2] === "--production";

// Plugin source lives in this directory; the build output goes to the
// sibling vault's plugin folder so the plugin can be enabled there without
// a separate copy step.
const vaultDir = path.resolve(__dirname, "..", "123");
const outDir = path.join(vaultDir, ".obsidian", "plugins", "local-runner");
const outFile = path.join(outDir, "main.js");

const vendorExternal = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  // Keep Node builtins (child_process etc.) and Obsidian as external requires —
  // they are provided by Obsidian's Node-enabled Electron runtime.
  external: [...vendorExternal, ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: outFile,
});

// Make sure the plugin directory exists and the static assets are in sync.
await mkdir(outDir, { recursive: true });
const manifestSrc = path.join(__dirname, "manifest.json");
const stylesSrc = path.join(__dirname, "styles.css");
await Promise.all([
  copyFile(manifestSrc, path.join(outDir, "manifest.json")),
  copyFile(stylesSrc, path.join(outDir, "styles.css")),
]);

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}
