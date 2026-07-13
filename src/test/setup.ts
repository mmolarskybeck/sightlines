import "@testing-library/jest-dom/vitest";

// Node 22+ defines its own global `localStorage`/`sessionStorage` (an
// accessor that throws unless the process is launched with
// `--localstorage-file`). In this jsdom test environment `window` is
// `globalThis` itself, so that pre-existing Node property shadows jsdom's
// real Storage implementation instead of being replaced by it — any code
// under test that reads/writes localStorage (workspace preferences, etc.)
// would otherwise silently get a non-functional stub. Swap in a small
// in-memory Storage polyfill whenever the built-in one isn't usable.
class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function installWorkingStorage(propertyName: "localStorage" | "sessionStorage") {
  const current = (globalThis as unknown as Record<string, unknown>)[propertyName] as
    | Storage
    | undefined;

  if (current && typeof current.setItem === "function") return;

  Object.defineProperty(globalThis, propertyName, {
    configurable: true,
    enumerable: true,
    value: new MemoryStorage(),
    writable: true
  });
}

installWorkingStorage("localStorage");
installWorkingStorage("sessionStorage");

// Radix primitives measure their hidden form-control mirrors with
// ResizeObserver. jsdom does not implement it, so provide the inert contract
// tests need; layout itself is verified in the browser, not in jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
