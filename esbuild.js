const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const e2e = process.argv.includes("--e2e");

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

/** Build config for VS Code integration test entrypoints. */
const e2eConfigs = [
  {
    entryPoints: ["test/e2e/runTest.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/e2e/runTest.js",
    external: ["vscode"],
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  },
  {
    entryPoints: ["test/e2e/suite/extension.test.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/e2e/suite/extension.test.js",
    external: ["vscode"],
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  },
];

async function main() {
  if (e2e) {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
      ...e2eConfigs.map((config) => esbuild.build(config)),
    ]);
    console.log("[e2e] build complete");
    return;
  }

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
