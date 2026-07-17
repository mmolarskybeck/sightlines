import { describe, expect, it } from "vitest";
import { savedViewThumbnailKey } from "./savedViewThumbnailRepository";

describe("savedViewThumbnailKey", () => {
  it("composes the project and view ids with a ':' separator", () => {
    expect(savedViewThumbnailKey("proj-1", "view-9")).toBe("proj-1:view-9");
  });

  it("keeps one project's keys inside a prefix range that excludes others", () => {
    // deleteByProject deletes the range [`${id}:`, `${id}:￿`]. The ':' separator
    // (0x3A) sorts below the '￿' ceiling, and fixed-length ids mean one id
    // is never a prefix of another — so no sibling project's key sneaks in.
    const key = savedViewThumbnailKey("abc", "v1");
    expect(key >= "abc:").toBe(true);
    expect(key <= "abc:￿").toBe(true);
    // A different same-length project id falls outside the range.
    const other = savedViewThumbnailKey("abd", "v1");
    expect(other <= "abc:￿").toBe(false);
  });
});
