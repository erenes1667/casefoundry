const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("casefoundry", {
  appInfo: () => ipcRenderer.invoke("app:info"),
  listPhones: () => ipcRenderer.invoke("catalog:list"),
  savePhone: (phone) => ipcRenderer.invoke("catalog:save", phone),
  savePhones: (phones) => ipcRenderer.invoke("catalog:save-many", phones),
  deletePhone: (id) => ipcRenderer.invoke("catalog:delete", id),
  resetCatalog: () => ipcRenderer.invoke("catalog:reset"),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  saveProject: (project) => ipcRenderer.invoke("projects:save", project),
  deleteProject: (id) => ipcRenderer.invoke("projects:delete", id),
  openTextFile: (filters) => ipcRenderer.invoke("file:open-text", filters),
  saveTextFile: (payload) => ipcRenderer.invoke("file:save-text", payload),
  saveBinaryFile: (payload) => ipcRenderer.invoke("file:save-binary", payload),
  exportDatabase: () => ipcRenderer.invoke("database:export"),
  importDatabase: () => ipcRenderer.invoke("database:import"),
  revealDataFolder: () => ipcRenderer.invoke("database:reveal"),
  createBackup: () => ipcRenderer.invoke("database:backup"),
});
