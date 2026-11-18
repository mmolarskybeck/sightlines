import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewArtworkDialog } from "./NewArtworkDialog";

afterEach(cleanup);

function commit(label: string, value: string) {
  const input = screen.getByRole("textbox", { name: new RegExp(label) });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("NewArtworkDialog", () => {
  it("asks for a size instead of creating when a dimension is missing, then creates in mm", async () => {
    const onCreate = vi.fn(async () => "id");
    const onOpenChange = vi.fn();
    render(<NewArtworkDialog open unit="cm" onCreate={onCreate} onOpenChange={onOpenChange} />);
    const add = screen.getByRole("button", { name: "Add work" });
    // Never size-disabled: a disabled button would swallow the click that
    // follows a size field's blur commit.
    expect(add).toBeEnabled();
    commit("Width", "50");
    fireEvent.click(add);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a width and height");
    expect(onCreate).not.toHaveBeenCalled();
    commit("Height", "70");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: " Study " }
    });
    fireEvent.click(add);
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate).toHaveBeenCalledWith({
      title: "Study",
      artist: undefined,
      widthMm: 500,
      heightMm: 700,
      placementForm: "wall"
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
