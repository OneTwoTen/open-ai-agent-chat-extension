import * as assert from "assert";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("doct.agent-coding-extension");
  assert.ok(extension, "development extension should be installed in the test host");
  await extension.activate();

  const result = await vscode.commands.executeCommand<{
    posted: Array<Record<string, unknown>>;
    session: {
      transcript: Array<Record<string, unknown>>;
      historyLength: number;
      sessions: Array<{ id: string; title: string }>;
    };
  }>("aiAgentChat.e2e.runScenario", {
    text: "Please read fixture.txt through the read_file tool.",
    attachments: [],
    mockSteps: JSON.parse(process.env.AI_AGENT_CHAT_E2E_MOCK_STEPS || "[]"),
  });

  assert.ok(result, "E2E command should return a scenario result");

  const postedTypes = result.posted.map((msg) => msg.type);
  assert.ok(postedTypes.includes("init"), "webview receives init");
  assert.ok(postedTypes.includes("turnMeta"), "webview receives turn metadata");
  assert.ok(postedTypes.includes("toolCall"), "webview receives tool call");
  assert.ok(postedTypes.includes("toolResult"), "webview receives tool result");
  assert.ok(postedTypes.includes("assistantDelta"), "webview receives assistant text");
  assert.ok(postedTypes.includes("usage"), "webview receives usage updates");
  assert.ok(postedTypes.includes("done"), "webview receives completion");
  assert.ok(postedTypes.includes("sessions"), "webview receives persisted session list");

  const readToolCall = result.posted.find((msg) => msg.type === "toolCall" && msg.name === "read_file");
  assert.deepStrictEqual(readToolCall?.args, { path: "fixture.txt" });

  const readToolResult = result.posted.find((msg) => msg.type === "toolResult" && msg.name === "read_file");
  assert.match(String(readToolResult?.result), /fixture content from VS Code extension host/);

  const workingSet = result.posted.find((msg) => msg.type === "workingSet") as
    | { files?: Array<{ path: string; status: string }> }
    | undefined;
  assert.ok(
    workingSet?.files?.some((file) => file.path === "generated.txt" && file.status === "created"),
    "webview receives working-set updates for tool-created files"
  );

  const assistantText = result.posted
    .filter((msg) => msg.type === "assistantDelta")
    .map((msg) => String(msg.text))
    .join("");
  assert.match(assistantText, /fixture was read successfully/);

  assert.ok(
    result.session.transcript.some((item) => item.kind === "user"),
    "transcript persists user message"
  );
  assert.ok(
    result.session.transcript.some((item) => item.kind === "tool" && item.name === "read_file"),
    "transcript persists tool call"
  );
  assert.ok(
    result.session.transcript.some((item) => item.kind === "assistant"),
    "transcript persists assistant message"
  );
  assert.ok(result.session.historyLength >= 2, "AgentSession history includes user and assistant messages");
  assert.ok(result.session.sessions.length >= 1, "session store contains the completed turn");
  assert.ok(
    result.workingSet.some((file) => file.path === "generated.txt" && file.status === "created"),
    "scenario exposes final working set"
  );
}
