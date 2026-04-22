export {};

declare global {
  interface Window {
    mlc?: {
      isElectron: boolean;
      platform?: string;
      arch?: string;
      isMac?: boolean;
      isAppleSilicon?: boolean;
      getModels: () => Promise<any[]>;
      searchModels: (payload: any) => Promise<any[]>;
      getModelFiles: (payload: any) => Promise<any[]>;
      downloadAndConvert: (payload: any) => Promise<any>;
      deleteModel: (payload: any) => Promise<any>;
      chat: (payload: any) => Promise<any>;
      cancelChat: (payload: any) => Promise<any>;
      onDownloadProgress: (handler: (data: any) => void) => (() => void) | void;
      onChatToken: (handler: (data: any) => void) => (() => void) | void;
      getPerformanceSnapshot: () => Promise<any>;
      resetPerformanceSnapshot: () => Promise<any>;
      getSession?: () => Promise<any>;
      setSession?: (payload: any) => Promise<any>;
      httpRequest?: (payload: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }) => Promise<{
        ok: boolean;
        status: number;
        headers?: Record<string, string>;
        bodyText?: string;
      }>;
      getSetting: (key: string) => Promise<any>;
      getManySettings?: (keys: string[]) => Promise<Record<string, any>>;
      setSetting: (key: string, value: any) => Promise<any>;
      setManySettings?: (values: Record<string, any>) => Promise<any>;
    };
  }
}
