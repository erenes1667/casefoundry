import type { AppInfo, CaseProject, PhoneRecord, SaveResult } from "./types";

declare global {
  interface Window {
    casefoundry: {
      appInfo(): Promise<AppInfo>;
      listPhones(): Promise<PhoneRecord[]>;
      savePhone(phone: PhoneRecord): Promise<PhoneRecord>;
      savePhones(phones: PhoneRecord[]): Promise<PhoneRecord[]>;
      deletePhone(id: string): Promise<{ deleted: boolean }>;
      resetCatalog(): Promise<PhoneRecord[]>;
      listProjects(): Promise<CaseProject[]>;
      saveProject(project: CaseProject): Promise<CaseProject>;
      deleteProject(id: string): Promise<{ deleted: boolean }>;
      openTextFile(filters: Array<{ name: string; extensions: string[] }>): Promise<{
        canceled: boolean;
        path?: string;
        name?: string;
        text?: string;
      }>;
      saveTextFile(payload: {
        title?: string;
        defaultName: string;
        text: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }): Promise<SaveResult>;
      saveBinaryFile(payload: {
        title?: string;
        defaultName: string;
        base64: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }): Promise<SaveResult>;
      exportDatabase(): Promise<SaveResult>;
      importDatabase(): Promise<{ canceled: boolean; phones?: PhoneRecord[] }>;
      revealDataFolder(): Promise<void>;
      createBackup(): Promise<{ path: string }>;
    };
  }
}

export {};
