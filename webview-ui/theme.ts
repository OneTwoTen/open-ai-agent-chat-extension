import { createTheme } from "@mantine/core";

/** Detect VS Code's active color scheme from the body class. */
export function detectColorScheme(): "light" | "dark" {
  const cls = document.body.className;
  if (cls.includes("vscode-light")) {
    return "light";
  }
  return "dark";
}

/** Mantine theme tuned to inherit VS Code typography. */
export const theme = createTheme({
  fontFamily: "var(--vscode-font-family)",
  fontFamilyMonospace: "var(--vscode-editor-font-family, ui-monospace, monospace)",
  primaryColor: "blue",
  defaultRadius: "md",
  fontSizes: {
    xs: "11px",
    sm: "12px",
    md: "13px",
    lg: "15px",
    xl: "18px",
  },
  cursorType: "pointer",
});
