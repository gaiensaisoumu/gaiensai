declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    onOfflineReady?: () => void;
    onNeedRefresh?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => void;
}
