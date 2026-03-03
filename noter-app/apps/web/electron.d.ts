export {};

declare global {
  interface Window {
    mlc?: {
      isElectron: boolean;
      getModels: () => Promise<any[]>;
      searchModels: (payload: any) => Promise<any[]>;
      getModelFiles: (payload: any) => Promise<any[]>;
      downloadAndConvert: (payload: any) => Promise<any>;
      deleteModel: (payload: any) => Promise<any>;
      chat: (payload: any) => Promise<any>;
      cancelChat: (payload: any) => Promise<any>;
      onDownloadProgress: (handler: (data: any) => void) => (() => void) | void;
      onChatToken: (handler: (data: any) => void) => (() => void) | void;
      getSetting: (key: string) => Promise<any>;
      setSetting: (key: string, value: any) => Promise<any>;
    };
  }
}
