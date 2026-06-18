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
  executeCommand: async () => undefined,
};

export default { FileType, Uri, workspace, window, languages, commands };
