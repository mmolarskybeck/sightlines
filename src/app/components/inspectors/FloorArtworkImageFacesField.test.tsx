import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloorArtworkImageFacesField } from "./FloorArtworkImageFacesField";

afterEach(cleanup);

describe("FloorArtworkImageFacesField", () => {
  it("shows Front and Back already pressed when imageFaces is absent (the default, not blankness)", () => {
    render(<FloorArtworkImageFacesField imageFaces={undefined} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Front face" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Back face" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    for (const label of ["Top face", "Left face", "Right face", "Bottom face"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    }
  });

  it("reflects a stored imageFaces array instead of the default once one exists", () => {
    render(<FloorArtworkImageFacesField imageFaces={["top"]} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Top face" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Front face" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("turning on an additional face calls onChange with the full next set, default faces included", () => {
    const onChange = vi.fn();
    render(<FloorArtworkImageFacesField imageFaces={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Top face" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const faces = onChange.mock.calls[0][0] as string[];
    expect(new Set(faces)).toEqual(new Set(["front", "back", "top"]));
  });

  it("turning a face off removes only that face from the set", () => {
    const onChange = vi.fn();
    render(
      <FloorArtworkImageFacesField imageFaces={["front", "back", "top"]} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Back face" }));

    expect(onChange).toHaveBeenCalledWith(["front", "top"]);
  });

  // The sharpest trap this control has to avoid: clearing the last face must
  // persist a literal empty array, not silently fall back to the default.
  // `faces.length ? faces : undefined` here would make "off" unreachable —
  // see the doc comment on ArtworkFloorObject.imageFaces in domain/project.ts.
  it("turning off the last active face persists an EMPTY array, not the default", () => {
    const onChange = vi.fn();
    render(<FloorArtworkImageFacesField imageFaces={["top"]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Top face" }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(onChange).not.toHaveBeenCalledWith(["front", "back"]);
  });

  it("turning off the last of the (absent, default) front/back pair also persists an EMPTY array", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FloorArtworkImageFacesField imageFaces={undefined} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Front face" }));
    expect(onChange).toHaveBeenLastCalledWith(["back"]);

    // Simulate the store committing that write back down as props, then
    // clear the remaining face.
    rerender(<FloorArtworkImageFacesField imageFaces={["back"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Back face" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("every face toggle exposes real pressed-button semantics", () => {
    render(<FloorArtworkImageFacesField imageFaces={[]} onChange={vi.fn()} />);

    for (const label of [
      "Front face",
      "Back face",
      "Top face",
      "Left face",
      "Right face",
      "Bottom face"
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-pressed", "false");
      expect(button).not.toBeDisabled();
    }
  });
});
