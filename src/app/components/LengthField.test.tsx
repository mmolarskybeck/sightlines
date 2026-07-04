import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LengthField } from "./LengthField";

afterEach(cleanup);

function renderField(overrides: Partial<ComponentProps<typeof LengthField>> = {}) {
  const onCommit = overrides.onCommit ?? vi.fn();
  render(
    <LengthField
      label="Width"
      valueMm={undefined}
      displayUnit="in"
      parseUnit="in"
      placeholder="e.g. 24"
      onCommit={onCommit}
      {...overrides}
    />
  );
  return { onCommit, input: screen.getByRole("textbox") as HTMLInputElement };
}

describe("LengthField", () => {
  it("commits on Enter and reformats to the display unit", async () => {
    const onCommit = vi.fn();
    const { input } = renderField({ onCommit });

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // 12 in -> 304.8 mm, reformatted back as inches (reformat lands a
    // microtask after the awaited commit resolves).
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(304.8, 5));
    await waitFor(() => expect(input.value).toBe('12"'));
  });

  it("clearable empty commits via onClear once, only when a value existed", () => {
    const onClear = vi.fn();
    const { input, onCommit } = renderField({
      clearable: true,
      valueMm: 304.8,
      onClear
    });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("clearable empty does nothing when there was no value", () => {
    const onClear = vi.fn();
    const { input } = renderField({ clearable: true, valueMm: undefined, onClear });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onClear).not.toHaveBeenCalled();
  });

  it("rejects non-positive input when positiveOnly, with the label in the message", () => {
    const { input, onCommit } = renderField({ positiveOnly: true });

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("Width must be greater than zero.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("surfaces the rejection message from an async onCommit", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("Cannot resize below its opening."));
    const { input } = renderField({ onCommit });

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText("Cannot resize below its opening.")).toBeInTheDocument()
    );
  });

  it("shows a conversion hint while typing and clears it after commit", async () => {
    const { input } = renderField({ onCommit: vi.fn() });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "30cm" } });

    // 30 cm normalizes to 11 13/16" in an inches field.
    expect(screen.getByText(/→\s*11 13\/16"/)).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(input.value).toBe('11 13/16"'));
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
});
