const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** Build config for the extension host (Node / CommonJS). */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

/** Build config for the webview (browser / React). */
const webviewConfig = {
  entryPoints: ["webview-ui/index.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "dist/webview.js",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  loader: { ".css": "css" },
};

async function main() {
  const ctxExt = await esbuild.context(extensionConfig);
  const ctxWeb = await esbuild.context(webviewConfig);

  if (watch) {
    await Promise.all([ctxExt.watch(), ctxWeb.watch()]);
    console.log("[watch] building...");
  } else {
    await Promise.all([ctxExt.rebuild(), ctxWeb.rebuild()]);
    await Promise.all([ctxExt.dispose(), ctxWeb.dispose()]);
    console.log("[build] complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
