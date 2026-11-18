import { describe, expect, it } from "vitest";
import { formatStorageBytes } from "./formatStorageBytes";

describe("formatStorageBytes", () => {
  it("uses bytes below 1000, singular for one", () => {
    expect(formatStorageBytes(0)).toBe("0 bytes");
    expect(formatStorageBytes(1)).toBe("1 byte");
    expect(formatStorageBytes(999)).toBe("999 bytes");
  });

  it("rounds kilobytes to whole numbers", () => {
    expect(formatStorageBytes(1000)).toBe("1 KB");
    expect(formatStorageBytes(4096)).toBe("4 KB");
    expect(formatStorageBytes(999_400)).toBe("999 KB");
  });

  it("shows one decimal for megabytes under 100, none from 100", () => {
    expect(formatStorageBytes(32_400_000)).toBe("32.4 MB");
    expect(formatStorageBytes(1_000_000)).toBe("1.0 MB");
    expect(formatStorageBytes(184_000_000)).toBe("184 MB");
  });

  it("shows two decimals for gigabytes", () => {
    expect(formatStorageBytes(2_150_000_000)).toBe("2.15 GB");
  });
});
