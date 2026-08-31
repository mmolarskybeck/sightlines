import "@testing-library/jest-dom/vitest";

// Node 22+ ships a native Storage whose Web IDL named-property setter swallows
// vi.spyOn's defineProperty as a stored item, so spies silently never install.
// Always replace it with a plain, spyable in-memory Storage for tests.
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
  Object.defineProperty(globalThis, propertyName, {
    configurable: true,
    enumerable: true,
    value: new MemoryStorage(),
    writable: true
  });
}

installWorkingStorage("localStorage");
installWorkingStorage("sessionStorage");

// cmdk keeps its highlighted row in view with scrollIntoView, which jsdom does
// not implement at all (not even as a no-op). Same deal as ResizeObserver
// below: there is no layout to scroll here, only a method that must exist.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Radix needs ResizeObserver; jsdom layout tests only need an inert contract.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
