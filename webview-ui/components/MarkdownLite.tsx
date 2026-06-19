import { ActionIcon, CopyButton, Menu, Tooltip, Typography } from "@mantine/core";
import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { vscode } from "../vscodeApi";

/**
 * Full markdown rendering (GFM: headings, lists, tables, links, etc.) via
 * react-markdown. Code blocks get copy + insert actions; links open in the
 * user's browser through the extension host.
 */
export function MarkdownLite({ text }: { text: string }) {
  return (
    <Typography className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  vscode.postMessage({ type: "openUrl", url: href });
                }
              }}
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const raw = String(children ?? "");
            const langMatch = /language-(\w+)/.exec(className || "");
            const isBlock = !!langMatch || raw.includes("\n");
            if (!isBlock) {
              return <code className="md-inline">{children}</code>;
            }
            const content = raw.replace(/\n$/, "");
            return <CodeBlock content={content} lang={langMatch?.[1]} />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </Typography>
  );
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
    // Leading whitespace
    const wsMatch = /^(\s+)/.exec(rest);
    if (wsMatch) {
      tokens.push({ text: wsMatch[1] });
      rest = rest.slice(wsMatch[1].length);
      continue;
    }
    // Order matters: comments & strings first, then others
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
      // Accumulate plain text until next potential token start
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
