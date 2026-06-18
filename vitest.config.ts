import * as path from "path";
import { defineConfig } from "vitest/config";

// The extension code imports the `vscode` module, which only exists inside the
// VS Code extension host. For pure unit tests we alias it to a lightweight stub.
export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/vscode-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
