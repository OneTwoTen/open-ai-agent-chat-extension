import "@mantine/core/styles.css";
import "./vscode-bridge.css";
import "./styles.css";

import { MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { detectColorScheme, theme } from "./theme";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <MantineProvider theme={theme} forceColorScheme={detectColorScheme()}>
      <App />
    </MantineProvider>
  );
}
