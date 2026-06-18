import { ActionIcon, CopyButton, Menu, Tooltip, Typography } from "@mantine/core";
import React from "react";
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
                  vscode.postMessage({ type: "openExternal", url: href });
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
        <code>{content}</code>
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
