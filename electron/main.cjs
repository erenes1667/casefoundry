const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {
  ValidationError,
  validateBinaryPayload,
  validatePhone,
  validatePhoneList,
} = require("./validate.cjs");

const SCHEMA_VERSION = 1;
let mainWindow;
let store;

function readSeedPhones() {
  const seedPath = app.isPackaged
    ? path.join(process.resourcesPath, "seed-phones.json")
    : path.join(__dirname, "..", "resources", "seed-phones.json");
  return JSON.parse(fs.readFileSync(seedPath, "utf8"));
}

function safeId(value, prefix) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return normalized || `${prefix}-${Date.now()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class CatalogStore {
  constructor() {
    this.directory = app.getPath("userData");
    this.file = path.join(this.directory, "casefoundry-database.json");
    this.backupDirectory = path.join(this.directory, "backups");
    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(this.backupDirectory, { recursive: true });
    this.data = this.load();
  }

  initialData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phones: readSeedPhones(),
      projects: [],
      audit: [
        {
          id: `audit-${Date.now()}`,
          at: new Date().toISOString(),
          action: "catalog_initialized",
          summary: "Created the local CaseFoundry catalog",
        },
      ],
    };
  }

  load() {
    if (!fs.existsSync(this.file)) {
      const initial = this.initialData();
      this.write(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!Array.isArray(parsed.phones) || !Array.isArray(parsed.projects)) {
        throw new Error("Invalid CaseFoundry database structure");
      }
      return parsed;
    } catch (error) {
      const damaged = `${this.file}.damaged-${Date.now()}`;
      fs.copyFileSync(this.file, damaged);
      const initial = this.initialData();
      initial.audit.unshift({
        id: `audit-${Date.now()}`,
        at: new Date().toISOString(),
        action: "catalog_recovered",
        summary: `Recovered from unreadable database: ${error.message}`,
      });
      this.write(initial);
      return initial;
    }
  }

  write(next) {
    next.updatedAt = new Date().toISOString();
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, this.file);
    this.data = next;
  }

  audit(action, summary) {
    this.data.audit.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      action,
      summary,
    });
    this.data.audit = this.data.audit.slice(0, 500);
  }

  listPhones() {
    return clone(this.data.phones);
  }

  savePhone(input) {
    const phone = clone(validatePhone(input));
    phone.id = safeId(phone.id || `${phone.brand}-${phone.model}`, "phone");
    phone.updatedAt = new Date().toISOString();
    phone.createdAt ||= phone.updatedAt;
    const index = this.data.phones.findIndex((entry) => entry.id === phone.id);
    if (index >= 0) this.data.phones[index] = phone;
    else this.data.phones.unshift(phone);
    this.audit("phone_saved", `${phone.brand} ${phone.model}`);
    this.write(this.data);
    return clone(phone);
  }

  savePhones(inputs) {
    // Validate the WHOLE pack before writing any of it, so a bad record at
    // position 40 cannot leave 39 half-imported phones behind.
    const validated = validatePhoneList(inputs);
    const saved = [];
    for (const input of validated) {
      const phone = clone(input);
      phone.id = safeId(phone.id || `${phone.brand}-${phone.model}`, "phone");
      phone.updatedAt = new Date().toISOString();
      phone.createdAt ||= phone.updatedAt;
      const index = this.data.phones.findIndex((entry) => entry.id === phone.id);
      if (index >= 0) this.data.phones[index] = phone;
      else this.data.phones.push(phone);
      saved.push(phone);
    }
    this.audit("phone_pack_saved", `Saved ${saved.length} phone records`);
    this.write(this.data);
    return clone(saved);
  }

  deletePhone(id) {
    const before = this.data.phones.length;
    this.data.phones = this.data.phones.filter((phone) => phone.id !== id);
    const changed = this.data.phones.length !== before;
    if (changed) {
      this.audit("phone_deleted", id);
      this.write(this.data);
    }
    return { deleted: changed };
  }

  listProjects() {
    return clone(this.data.projects);
  }

  saveProject(input) {
    const project = clone(input);
    project.id = safeId(project.id, "project");
    project.updatedAt = new Date().toISOString();
    project.createdAt ||= project.updatedAt;
    const index = this.data.projects.findIndex((entry) => entry.id === project.id);
    if (index >= 0) this.data.projects[index] = project;
    else this.data.projects.unshift(project);
    this.audit("project_saved", project.name || project.id);
    this.write(this.data);
    return clone(project);
  }

  deleteProject(id) {
    const before = this.data.projects.length;
    this.data.projects = this.data.projects.filter((project) => project.id !== id);
    const changed = this.data.projects.length !== before;
    if (changed) {
      this.audit("project_deleted", id);
      this.write(this.data);
    }
    return { deleted: changed };
  }

  replaceDatabase(next) {
    if (
      !next ||
      !Array.isArray(next.phones) ||
      !Array.isArray(next.projects)
    ) {
      throw new Error("This file is not a valid CaseFoundry database");
    }
    // An imported database is untrusted input just like a phone pack.
    //
    // The id normalisation matters as much as the validation. Every other write
    // path repairs a missing id via safeId; this one did not, so a hand-authored
    // or third-party file could install records with no id at all. That is not
    // cosmetic: the Studio device select then receives value={undefined} and
    // becomes uncontrolled, so picking a different phone changes what is shown
    // while the actual selection silently stays on the first record. The user
    // sees one handset selected and exports a case built for another, with no
    // error anywhere.
    next.phones = validatePhoneList(next.phones).map((phone) => ({
      ...phone,
      id: safeId(phone.id || `${phone.brand}-${phone.model}`, "phone"),
    }));
    this.createBackup("before-import");
    next.schemaVersion = SCHEMA_VERSION;
    next.audit ||= [];
    next.audit.unshift({
      id: `audit-${Date.now()}`,
      at: new Date().toISOString(),
      action: "database_imported",
      summary: `Imported ${next.phones.length} phone records`,
    });
    this.write(next);
  }

  createBackup(label = "manual") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(
      this.backupDirectory,
      `casefoundry-${label}-${stamp}.json`,
    );
    fs.copyFileSync(this.file, target);
    return target;
  }

  reset() {
    this.createBackup("before-reset");
    const next = this.initialData();
    next.audit.unshift({
      id: `audit-${Date.now()}`,
      at: new Date().toISOString(),
      action: "catalog_reset",
      summary: "Restored bundled regression devices",
    });
    this.write(next);
    return clone(next.phones);
  }
}

/**
 * Wraps an IPC handler so a validation failure reaches the renderer as a plain
 * message instead of an Electron stack trace, and so unexpected errors are
 * logged in the main process rather than swallowed.
 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(error.message);
      }
      console.error(`[casefoundry] ${channel} failed:`, error);
      throw error;
    }
  });
}

function registerIpc() {
  handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dataDirectory: store.directory,
    databaseFile: store.file,
  }));
  handle("catalog:list", () => store.listPhones());
  handle("catalog:save", (_event, phone) => store.savePhone(phone));
  handle("catalog:save-many", (_event, phones) => store.savePhones(phones));
  handle("catalog:delete", (_event, id) => store.deletePhone(id));
  handle("catalog:reset", () => store.reset());
  handle("projects:list", () => store.listProjects());
  handle("projects:save", (_event, project) => store.saveProject(project));
  handle("projects:delete", (_event, id) => store.deleteProject(id));
  handle("database:reveal", () => shell.showItemInFolder(store.file));
  handle("database:backup", () => ({ path: store.createBackup() }));
  handle("database:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export CaseFoundry database",
      defaultPath: "CaseFoundry-Database.json",
      filters: [{ name: "CaseFoundry database", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(
      result.filePath,
      `${JSON.stringify(store.data, null, 2)}\n`,
      "utf8",
    );
    return { canceled: false, path: result.filePath };
  });
  handle("database:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import CaseFoundry database",
      properties: ["openFile"],
      filters: [{ name: "CaseFoundry database", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const next = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
    store.replaceDatabase(next);
    return { canceled: false, phones: store.listPhones() };
  });
  handle("file:open-text", async (_event, filters = []) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters,
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    return {
      canceled: false,
      path: filePath,
      name: path.basename(filePath),
      text: fs.readFileSync(filePath, "utf8"),
    };
  });
  handle("file:save-text", async (_event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: payload.title || "Save file",
      defaultPath: payload.defaultName,
      filters: payload.filters || [],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, String(payload.text), "utf8");
    return { canceled: false, path: result.filePath };
  });
  handle("file:save-binary", async (_event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: payload.title || "Save printable file",
      defaultPath: payload.defaultName,
      filters: payload.filters || [],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const bytes = Buffer.from(validateBinaryPayload(payload), "base64");
    fs.writeFileSync(result.filePath, bytes);
    return { canceled: false, path: result.filePath, bytes: bytes.length };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 1120,
    minHeight: 720,
    title: "CaseFoundry",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#111311",
    vibrancy: "under-window",
    visualEffectState: "active",
    trafficLightPosition: { x: 18, y: 17 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Only the app's own renderer may be navigated to. The previous check
  // accepted any "file://" URL, which would have allowed navigation to any
  // document on disk.
  const rendererUrl = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : `file://${path.join(__dirname, "..", "dist", "index.html")}`;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl && !url.startsWith(`${rendererUrl}#`)) {
      event.preventDefault();
    }
  });
  // Renderer code must never be able to spawn a Node-enabled child window.
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Surface renderer errors in the terminal during development. Without this a
  // blank panel gives no clue whether the UI crashed or is simply still
  // building geometry.
  if (!app.isPackaged) {
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) console.error(`[renderer] ${message}`);
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) =>
      console.error("[renderer] process gone:", details.reason),
    );
  }

  if (process.env.CASEFOUNDRY_QA_SCREENSHOT && !app.isPackaged) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.CASEFOUNDRY_QA_SCREENSHOT, image.toPNG());
        } finally {
          app.quit();
        }
      }, 2500);
    });
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: "CaseFoundry",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
  ]);
}

app.whenReady().then(() => {
  app.setName("CaseFoundry");
  store = new CatalogStore();
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
