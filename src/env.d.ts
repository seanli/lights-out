declare const __BUILD_ID__: string;
interface Window {
  claude?: { hot?: { snapshot(fn: () => unknown): void; ready?: (start: (data: any) => void) => void; data?: any } };
  __lightsOut?: { debug: import('./contracts/services').DebugService; kernel?: unknown };
}
