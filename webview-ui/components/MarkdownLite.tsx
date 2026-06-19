import { ActionIcon, CopyButton, Menu, Tooltip } from "@mantine/core";
import React, { useMemo } from "react";
import { Marked } from "marked";
import { vscode } from "../vscodeApi";

/* ── LaTeX to Unicode conversion ─────────────────────────────────────── */

const LATEX_SYMBOLS: Record<string, string> = {
  // Arrows
  "\\rightarrow": "→",
  "\\leftarrow": "←",
  "\\leftrightarrow": "↔",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
  "\\Leftrightarrow": "⇔",
  "\\uparrow": "↑",
  "\\downarrow": "↓",
  "\\updownarrow": "↕",
  "\\Uparrow": "⇑",
  "\\Downarrow": "⇓",
  "\\Updownarrow": "⇕",
  "\\mapsto": "↦",
  "\\hookrightarrow": "↪",
  "\\hookleftarrow": "↩",
  "\\longrightarrow": "→",
  "\\longleftarrow": "←",
  // Relation
  "\\leq": "≤",
  "\\geq": "≥",
  "\\neq": "≠",
  "\\approx": "≈",
  "\\equiv": "≡",
  "\\sim": "∼",
  "\\simeq": "≃",
  "\\cong": "≅",
  "\\propto": "∝",
  "\\ll": "≪",
  "\\gg": "≫",
  "\\prec": "≺",
  "\\succ": "≻",
  "\\preceq": "⪯",
  "\\succeq": "⪰",
  // Set theory
  "\\in": "∈",
  "\\notin": "∉",
  "\\subset": "⊂",
  "\\supset": "⊃",
  "\\subseteq": "⊆",
  "\\supseteq": "⊇",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\emptyset": "∅",
  "\\varnothing": "∅",
  // Logic
  "\\land": "∧",
  "\\lor": "∨",
  "\\neg": "¬",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\nexists": "∄",
  // Math operators
  "\\times": "×",
  "\\div": "÷",
  "\\pm": "±",
  "\\mp": "∓",
  "\\cdot": "·",
  "\\ast": "∗",
  "\\star": "⋆",
  "\\circ": "∘",
  "\\bullet": "•",
  "\\oplus": "⊕",
  "\\otimes": "⊗",
  // Misc symbols
  "\\infty": "∞",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\deg": "°",
  "\\degree": "°",
  "\\prime": "′",
  "\\dprime": "″",
  "\\angle": "∠",
  "\\measuredangle": "∡",
  "\\triangle": "△",
  "\\diamond": "◇",
  "\\square": "□",
  "\\perp": "⊥",
  "\\parallel": "∥",
  // Greek letters (lowercase)
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ε",
  "\\varepsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\vartheta": "ϑ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\pi": "π",
  "\\varpi": "ϖ",
  "\\rho": "ρ",
  "\\varrho": "ϱ",
  "\\sigma": "σ",
  "\\varsigma": "ς",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "φ",
  "\\varphi": "φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\omega": "ω",
  // Greek letters (uppercase)
  "\\Gamma": "Γ",
  "\\Delta": "Δ",
  "\\Theta": "Θ",
  "\\Lambda": "Λ",
  "\\Xi": "Ξ",
  "\\Pi": "Π",
  "\\Sigma": "Σ",
  "\\Phi": "Φ",
  "\\Psi": "Ψ",
  "\\Omega": "Ω",
  // Fractions and subscripts
  "\\frac": "/",
  "\\sqrt": "√",
  "\\sum": "∑",
  "\\prod": "∏",
  "\\int": "∫",
  "\\iint": "∬",
  "\\iiint": "∭",
  "\\oint": "∮",
  "\\coprod": "∐",
  "\\vee": "∨",
  "\\wedge": "∧",
  "\\bigcap": "⋂",
  "\\bigcup": "⋃",
};

function convertLatexToUnicode(text: string): string {
  let result = text;
  // Convert \( ... \) and $ ... $ inline math
  result = result.replace(/\$([^$]+)\$/g, (_, math) => convertMathExpression(math));
  // Convert \( ... \) inline math
  result = result.replace(/\\\(([^)]+)\\\)/g, (_, math) => convertMathExpression(math));
  // Convert \[ ... \] display math - keep as is but convert symbols
  result = result.replace(/\\\[[\s\S]*?\\\]/g, (match) => {
    const inner = match.slice(2, -2);
    return convertMathExpression(inner);
  });
  return result;
}

function convertMathExpression(math: string): string {
  let result = math;
  // Replace known symbols
  for (const [latex, unicode] of Object.entries(LATEX_SYMBOLS)) {
    result = result.split(latex).join(unicode);
  }
  // Handle subscripts: x_1, x_{10}
  result = result.replace(/_\{?(\w+)\}?/g, (_, sub) => {
    const subscripts = "₀₁₂₃₄₅₆₇₈₉";
    return sub
      .split("")
      .map((c: string) => {
        const idx = parseInt(c);
        return isNaN(idx) ? c : subscripts[idx] || c;
      })
      .join("");
  });
  // Handle superscripts: x^1, x^{10}
  result = result.replace(/\^\{?(\w+)\}?/g, (_, sup) => {
    const superscripts: Record<string, string> = {
      0: "⁰",
      1: "¹",
      2: "²",
      3: "³",
      4: "⁴",
      5: "⁵",
      6: "⁶",
      7: "⁷",
      8: "⁸",
      9: "⁹",
      n: "ⁿ",
      i: "ⁱ",
    };
    return sup
      .split("")
      .map((c: string) => superscripts[c] || c)
      .join("");
  });
  return result;
}

/* ── Configure marked ────────────────────────────────────────────────── */

const marked = new Marked();

function setupMarkedRenderer() {
  marked.use({
    renderer: {
      code({ text, lang }: { text: string; lang?: string }) {
        const content = text.replace(/\n$/, "");
        const id = `__code_${codeBlockStore.size}__`;
        codeBlockStore.set(id, { content, lang });
        return `<div data-code-id="${id}"></div>`;
      },
      link({ href, tokens }: { href: string; tokens: any[] }) {
        const text = tokens.map((t: any) => t.raw || t.text || "").join("");
        return `<a href="${href}" data-link="${href}">${text}</a>`;
      },
    },
  });
}

/* ── Syntax highlighting ─────────────────────────────────────────────── */

interface Token {
  text: string;
  cls?: string;
}

const KW_RE = /^(abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|module|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|true|try|type|typeof|var|void|while|with|yield|fn|pub|self|struct|impl|use|mod|trait|match|loop|move|mut|ref|where|proc|def|elif|else|except|lambda|print|raise|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|ON|GROUP|BY|ORDER|ASC|DESC|LIMIT|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|INTO|VALUES|SET|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|HAVING|UNION|ALL|EXISTS|CASE|WHEN|THEN|ELSE|END)$/;

const STRING_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/;
const COMMENT_RE = /^(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#(?!![!{])[^\n]*)/;
const NUMBER_RE = /^(0x[\da-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)/;
const FUNCTION_RE = /^([a-zA-Z_]\w*)(?=\s*\()/;
const TYPE_RE = /^([A-Z]\w*)/;
const OPERATOR_RE = /^(=>|[!=<>=!]=|&&|\|\||[+\-*/%]=?|\.\.\.?|::)/;
const REGEX_RE = /^\/(?!\/)(?:[^/\\]|\\.)+\/[gimsuy]*/;

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let rest = line;
  while (rest.length > 0) {
    const wsMatch = /^(\s+)/.exec(rest);
    if (wsMatch) {
      tokens.push({ text: wsMatch[1] });
      rest = rest.slice(wsMatch[1].length);
      continue;
    }
    const m =
      COMMENT_RE.exec(rest) ||
      STRING_RE.exec(rest) ||
      REGEX_RE.exec(rest) ||
      NUMBER_RE.exec(rest) ||
      OPERATOR_RE.exec(rest) ||
      FUNCTION_RE.exec(rest) ||
      TYPE_RE.exec(rest) ||
      KW_RE.exec(rest);
    if (m) {
      const raw = m[0];
      let cls: string | undefined;
      if (COMMENT_RE.test(raw)) cls = "tok-comment";
      else if (STRING_RE.test(raw)) cls = "tok-string";
      else if (REGEX_RE.test(raw)) cls = "tok-regex";
      else if (NUMBER_RE.test(raw)) cls = "tok-number";
      else if (OPERATOR_RE.test(raw)) cls = "tok-operator";
      else if (FUNCTION_RE.test(raw)) cls = "tok-function";
      else if (TYPE_RE.test(raw)) cls = "tok-type";
      else if (KW_RE.test(raw)) cls = "tok-keyword";
      tokens.push({ text: raw, cls });
      rest = rest.slice(raw.length);
    } else {
      let end = 1;
      while (end < rest.length && !/[\s"'`/#!0-9A-Z_a-z]"/.test(rest[end])) {
        end++;
      }
      tokens.push({ text: rest.slice(0, end) });
      rest = rest.slice(end);
    }
  }
  return tokens;
}

function HighlightedCode({ content, lang }: { content: string; lang?: string }) {
  const lines = content.split("\n");
  const tokenized = useMemo(
    () => lines.map((line) => (lang ? tokenizeLine(line) : [{ text: line }])),
    [content, lang],
  );
  return (
    <>
      {tokenized.map((tokens, i) => (
        <React.Fragment key={i}>
          {tokens.map((t, j) =>
            t.cls ? (
              <span key={j} className={t.cls}>
                {t.text}
              </span>
            ) : (
              <React.Fragment key={j}>{t.text}</React.Fragment>
            ),
          )}
          {i < tokenized.length - 1 ? "\n" : null}
        </React.Fragment>
      ))}
    </>
  );
}

/* ── Code block with actions ─────────────────────────────────────────── */

function CodeBlock({ content, lang }: { content: string; lang?: string }) {
  return (
    <div className="md-code-wrap">
      <div className="md-code-actions">
        <CopyButton value={content} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Copied" : "Copy"} withArrow>
              <ActionIcon size="sm" variant="subtle" onClick={copy} aria-label="Copy code">
                {copied ? <CheckIcon /> : <CopyIcon />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
        <Menu position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon size="sm" variant="subtle" aria-label="Code actions">
              <DotsIcon />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => vscode.postMessage({ type: "insertAtCursor", code: content })}>
              Insert at cursor
            </Menu.Item>
            <Menu.Item onClick={() => vscode.postMessage({ type: "insertIntoNewFile", code: content })}>
              Insert into new file
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      <pre className="md-code">
        {lang && <span className="md-codelang">{lang}</span>}
        <code>
          <HighlightedCode content={content} lang={lang} />
        </code>
      </pre>
    </div>
  );
}

/* ── Code block store for React rendering ────────────────────────────── */

const codeBlockStore = new Map<string, { content: string; lang?: string }>();

/* ── Main component ──────────────────────────────────────────────────── */

function MarkdownRenderer({ text }: { text: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!ref.current) return;

    const links = ref.current.querySelectorAll<HTMLAnchorElement>("a[data-link]");
    links.forEach((a) => {
      const href = a.getAttribute("data-link");
      a.removeAttribute("data-link");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (href) {
          vscode.postMessage({ type: "openUrl", url: href });
        }
      });
    });

    const codeContainers = ref.current.querySelectorAll<HTMLDivElement>("[data-code-id]");
    codeContainers.forEach((container) => {
      const id = container.getAttribute("data-code-id");
      if (!id) return;
      const block = codeBlockStore.get(id);
      if (!block) return;
      codeBlockStore.delete(id);

      const wrapper = document.createElement("div");
      wrapper.className = "md-code-wrap";

      const actions = document.createElement("div");
      actions.className = "md-code-actions";

      const copyBtn = document.createElement("button");
      copyBtn.className = "md-action-btn";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(block.content);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      });

      const insertBtn = document.createElement("button");
      insertBtn.className = "md-action-btn";
      insertBtn.textContent = "Insert";
      insertBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "insertAtCursor", code: block.content });
      });

      actions.appendChild(copyBtn);
      actions.appendChild(insertBtn);

      const pre = document.createElement("pre");
      pre.className = "md-code";
      if (block.lang) {
        const langLabel = document.createElement("span");
        langLabel.className = "md-codelang";
        langLabel.textContent = block.lang;
        pre.appendChild(langLabel);
      }
      const code = document.createElement("code");
      code.textContent = block.content;
      pre.appendChild(code);

      wrapper.appendChild(actions);
      wrapper.appendChild(pre);
      container.replaceWith(wrapper);
    });
  }, [text]);

  const html = useMemo(() => {
    codeBlockStore.clear();
    setupMarkedRenderer();
    const converted = convertLatexToUnicode(text);
    return marked.parse(converted) as string;
  }, [text]);

  return <div ref={ref} className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MarkdownLite({ text }: { text: string }) {
  return <MarkdownRenderer text={text} />;
}

/* ── Icons ───────────────────────────────────────────────────────────── */

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
