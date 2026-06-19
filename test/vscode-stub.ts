/**
 * Minimal stand-in for the `vscode` module so extension code can be imported
 * in plain Node unit tests. Only members touched during module evaluation
 * need to exist; methods used at runtime are stubbed as no-ops since the
 * tests under test/ never execute tool bodies that call them.
 */

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export const Uri = {
  file: (p: string) => ({ fsPath: p, path: p }),
  parse: (value: string) => ({
    fsPath: value.startsWith("file://") ? value.replace(/^file:\/\//, "") : value,
    path: value,
    scheme: value.split(":")[0],
    authority: "",
    toString: () => value,
  }),
  joinPath: (base: { fsPath?: string }, ...parts: string[]) => ({
    fsPath: [base?.fsPath ?? "", ...parts].join("/"),
  }),
};

export const workspace = {
  fs: {
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    readDirectory: async () => [],
    createDirectory: async () => undefined,
    delete: async () => undefined,
    rename: async () => undefined,
    stat: async () => ({ size: 0 }),
  },
  getConfiguration: () => ({ get: <T>(_k: string, d?: T) => d }),
  findFiles: async () => [],
  workspaceFolders: [] as unknown[],
};

export const window = {
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  activeTextEditor: undefined,
  tabGroups: { all: [] as unknown[] },
};

export const languages = {
  getDiagnostics: () => [] as unknown[],
};

export const commands = {
  getCommands: async () => [] as string[],
  executeCommand: async () => undefined,
};

export const env = {
  remoteName: undefined as string | undefined,
  asExternalUri: async (uri: unknown) => uri,
  openExternal: async () => true,
};

export enum ViewColumn {
  Active = -1,
  Beside = -2,
}

export default { FileType, Uri, workspace, window, languages, commands, env, ViewColumn };
