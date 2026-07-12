import { beforeEach, describe, expect, it, vi } from "vitest";

type OpenRequest = {
  result: IDBDatabase;
  error: DOMException | null;
  onblocked: (() => void) | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  onupgradeneeded: (() => void) | null;
};

function makeDatabase() {
  return {
    close: vi.fn(),
    objectStoreNames: { contains: () => true },
    onversionchange: null as (() => void) | null
  } as unknown as IDBDatabase;
}

describe("openDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shares one connection and releases it on versionchange", async () => {
    const requests: OpenRequest[] = [];
    const open = vi.fn(() => {
      const request: OpenRequest = {
        result: makeDatabase(),
        error: null,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null
      };
      requests.push(request);
      return request as unknown as IDBOpenDBRequest;
    });
    vi.stubGlobal("indexedDB", { open });
    const { openDatabase } = await import("./database");

    const first = openDatabase();
    const second = openDatabase();
    expect(open).toHaveBeenCalledTimes(1);
    requests[0].onsuccess?.();
    const db = await first;
    expect(await second).toBe(db);

    db.onversionchange?.(new Event("versionchange") as IDBVersionChangeEvent);
    expect(db.close).toHaveBeenCalledOnce();

    const reopened = openDatabase();
    expect(open).toHaveBeenCalledTimes(2);
    requests[1].onsuccess?.();
    await reopened;
  });

  it("rejects a blocked upgrade and allows a later retry", async () => {
    const requests: OpenRequest[] = [];
    const open = vi.fn(() => {
      const request: OpenRequest = {
        result: makeDatabase(),
        error: null,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null
      };
      requests.push(request);
      return request as unknown as IDBOpenDBRequest;
    });
    vi.stubGlobal("indexedDB", { open });
    const { openDatabase } = await import("./database");

    const blocked = openDatabase();
    requests[0].onblocked?.();
    await expect(blocked).rejects.toThrow(/Close other Sightlines tabs/);

    const retry = openDatabase();
    expect(open).toHaveBeenCalledTimes(2);
    requests[1].onsuccess?.();
    await expect(retry).resolves.toBe(requests[1].result);
  });
});
