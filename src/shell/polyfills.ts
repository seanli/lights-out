// Small fallbacks for older phone browsers (iOS Safari before 15.4). Imported first by the entry point.
// State is plain data, so a JSON round-trip is a faithful clone here.
if (typeof globalThis.structuredClone !== 'function') {
  (globalThis as { structuredClone?: unknown }).structuredClone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value: function at<T>(this: T[], i: number): T | undefined {
      const n = Math.trunc(i) || 0;
      return this[n < 0 ? this.length + n : n];
    },
  });
}
export {};
