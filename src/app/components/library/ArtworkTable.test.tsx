import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Artwork } from "../../../domain/project";
import { ArtworkTable, type ArtworkTableRow } from "./ArtworkTable";

afterEach(cleanup);

const make = (id: string, title: string): Artwork => ({
  id,
  schemaVersion: 1,
  title,
  artist: "A",
  dimensions: { status: "unknown" },
  metadata: {}
});
const rows: ArtworkTableRow[] = ["a", "b", "c", "d"].map((id) => ({
  id,
  artwork: make(id, `Work ${id}`),
  rowNumber: id.charCodeAt(0) - 96,
  isPlaced: id === "a",
  location: id === "a" ? "Gallery 1 · North" : ""
}));

function Harness({ initial = [], visible = rows, scope = "library" }: { initial?: string[]; visible?: ArtworkTableRow[]; scope?: "library" | "checklist" }) {
  const [checked, setChecked] = useState(new Set(initial));
  return (
    <>
      <ArtworkTable
        scope={scope}
        rows={visible}
        thumbnails={new Map()}
        unit="in"
        checked={checked}
        onCheckedChange={setChecked}
        sort={{ key: "title" }}
        onSort={() => {}}
        checklistIds={new Set()}
      />
      <output data-testid="checked">{[...checked].sort().join(",")}</output>
    </>
  );
}
const out = () => screen.getByTestId("checked").textContent;

describe("ArtworkTable", () => {
  it("header checkbox selects only visible rows and preserves hidden checked ids", () => {
    render(<Harness initial={["hidden"]} visible={rows.slice(0, 2)} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown artworks" }));
    expect(out()).toBe("a,b,hidden");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown artworks" }));
    expect(out()).toBe("hidden");
  });

  it("shift-click checks the range between anchor and target", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Work a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Work c" }), { shiftKey: true });
    expect(out()).toBe("a,b,c");
  });

  it("renders #, Status and Location columns in checklist scope", () => {
    render(<Harness scope="checklist" />);
    expect(screen.getByRole("columnheader", { name: /#/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Status/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Location" })).toBeTruthy();
    expect(screen.getByText("Placed")).toBeTruthy();
    expect(screen.getAllByText("Unplaced")).toHaveLength(3);
    expect(screen.getByText("Gallery 1 · North")).toBeTruthy();
  });
});
