export const state = {
  configuration: new Map(),
  installedExtensions: new Set(),
  workspaceFolderResolver: () => undefined,
  warnings: [],
  errors: [],
  informationMessages: [],
  outputChannels: [],
  treeViews: [],
  decorationProviders: [],
  statusBarItems: [],
  registeredCommands: new Map(),
  executedCommands: [],
  quickPickRequests: [],
  quickPickSelection: undefined,
  warningRequests: [],
  warningChoice: undefined,
  configurationInspections: new Map(),
  configurationUpdates: [],
};

export class EventEmitter {
  listeners = new Set();
  values = [];

  event = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(value) {
    this.values.push(value);
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose() {
    this.listeners.clear();
  }
}

export class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

export class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

export class MarkdownString {
  constructor(value = "") {
    this.value = value;
  }
}

export class Uri {
  constructor({ scheme, path = "", fsPath = "" }) {
    this.scheme = scheme;
    this.path = path;
    this.fsPath = fsPath;
  }

  static from(parts) {
    return new Uri(parts);
  }

  static file(fsPath) {
    return new Uri({ scheme: "file", path: fsPath, fsPath });
  }
}

export class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class OutputChannel {
  lines = [];
  clearCount = 0;

  constructor(name) {
    this.name = name;
  }

  clear() {
    this.clearCount += 1;
    this.lines = [];
  }

  appendLine(line) {
    this.lines.push(line);
  }

  dispose() {}
}

class TreeView {
  checkboxListeners = [];

  constructor(id, options) {
    this.id = id;
    this.options = options;
  }

  onDidChangeCheckboxState(listener) {
    this.checkboxListeners.push(listener);
    return { dispose() {} };
  }

  async emitCheckboxState(items) {
    for (const listener of this.checkboxListeners) {
      await listener({ items });
    }
  }

  dispose() {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const TreeItemCheckboxState = {
  Unchecked: 0,
  Checked: 1,
};

class StatusBarItem {
  text = "";
  tooltip = "";
  command;
  name = "";

  show() {
    state.statusBarItems.push(this);
  }

  hide() {}

  dispose() {}
}

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const env = {
  uriScheme: "vscode",
  appName: "Visual Studio Code",
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const workspace = {
  workspaceFolders: undefined,

  getConfiguration(section, resource) {
    return {
      get(key, defaultValue) {
        const value = state.configuration.get(`${section}.${key}`);
        return value === undefined ? defaultValue : value;
      },

      inspect(key) {
        return state.configurationInspections.get(`${section}.${key}`);
      },

      async update(key, value, target) {
        state.configurationUpdates.push({ section, key, value, target, resource });
        state.configuration.set(`${section}.${key}`, value);
      },
    };
  },

  getWorkspaceFolder(uri) {
    return state.workspaceFolderResolver(uri);
  },

  onDidChangeConfiguration() {
    return { dispose() {} };
  },

  onDidChangeWorkspaceFolders() {
    return { dispose() {} };
  },
};

export const extensions = {
  getExtension(id) {
    return state.installedExtensions.has(id) ? { id } : undefined;
  },

  onDidChange() {
    return { dispose() {} };
  },
};

export const window = {
  createOutputChannel(name) {
    const channel = new OutputChannel(name);
    state.outputChannels.push(channel);
    return channel;
  },

  createTreeView(id, options) {
    const view = new TreeView(id, options);
    state.treeViews.push(view);
    return view;
  },

  registerFileDecorationProvider(provider) {
    state.decorationProviders.push(provider);
    return { dispose() {} };
  },

  createStatusBarItem(alignment, priority) {
    const item = new StatusBarItem();
    item.alignment = alignment;
    item.priority = priority;
    return item;
  },

  async showQuickPick(items, options) {
    state.quickPickRequests.push({ items, options });
    return state.quickPickSelection;
  },

  async showWarningMessage(message, ...rest) {
    state.warnings.push(message);
    state.warningRequests.push({
      message,
      modal: rest.some((arg) => arg && typeof arg === "object" && arg.modal === true),
      actions: rest.filter((arg) => typeof arg === "string"),
    });
    return state.warningChoice;
  },

  async showErrorMessage(message) {
    state.errors.push(message);
  },

  async showInformationMessage(message) {
    state.informationMessages.push(message);
  },
};

export const commands = {
  registerCommand(id, handler) {
    state.registeredCommands.set(id, handler);
    return { dispose: () => state.registeredCommands.delete(id) };
  },

  async executeCommand(id, ...args) {
    state.executedCommands.push([id, ...args]);
    const handler = state.registeredCommands.get(id);
    return handler?.(...args);
  },
};

export function resetVscodeMock() {
  state.configuration.clear();
  state.installedExtensions.clear();
  state.workspaceFolderResolver = () => undefined;
  state.warnings = [];
  state.errors = [];
  state.informationMessages = [];
  state.outputChannels = [];
  state.treeViews = [];
  state.decorationProviders = [];
  state.statusBarItems = [];
  state.registeredCommands.clear();
  state.executedCommands = [];
  state.quickPickRequests = [];
  state.quickPickSelection = undefined;
  state.warningRequests = [];
  state.warningChoice = undefined;
  state.configurationInspections.clear();
  state.configurationUpdates = [];
  workspace.workspaceFolders = undefined;
  env.uriScheme = "vscode";
  env.appName = "Visual Studio Code";
}

export const vscode = {
  ConfigurationTarget,
  EventEmitter,
  MarkdownString,
  StatusBarAlignment,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCheckboxState,
  TreeItemCollapsibleState,
  Uri,
  commands,
  env,
  extensions,
  window,
  workspace,
};
