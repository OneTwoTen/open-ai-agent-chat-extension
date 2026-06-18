import * as path from "path";
import * as vscode from "vscode";

export function resolveAgentchatDir(workspaceRoot: string): string {
  const configured = vscode.workspace
    .getConfiguration("aiAgentChat")
    .get<string>("agentchatPath", "");
  return configured || path.join(workspaceRoot, ".agentchat");
}

export function resolveStorageDir(context: vscode.ExtensionContext): vscode.Uri {
  const configured = vscode.workspace
    .getConfiguration("aiAgentChat")
    .get<string>("storagePath", "");
  if (configured) {
    return vscode.Uri.file(configured);
  }
  return context.storageUri ?? context.globalStorageUri;
}
