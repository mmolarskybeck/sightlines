import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LengthField } from "./LengthField";

afterEach(cleanup);

function renderField(overrides: Partial<ComponentProps<typeof LengthField>> = {}) {
  const onCommit = overrides.onCommit ?? vi.fn();
  const result = render(
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
  return { onCommit, input: screen.getByRole("textbox") as HTMLInputElement, ...result };
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

  it("does not reserve a blank message row", () => {
    const { container } = renderField({ valueMm: 304.8 });

    expect(container.querySelector(".field-hint, .length-field-hint, .field-error")).toBeNull();
  });

  it("shows accepted formats while focused when no conversion or error takes precedence", () => {
    const { input } = renderField({ valueMm: 304.8 });

    fireEvent.focus(input);

    expect(screen.getByText(/Accepts 12'/)).toBeInTheDocument();
  });

  it("suppresses the focus-only accepted-formats hint under hideFocusHint", () => {
    // The hint is the one message that toggles purely on focus/blur; a
    // content-sized centered container (e.g. a compact dialog) suppresses it so
    // the box doesn't resize mid-click and slide action buttons off the pointer.
    const { input, container } = renderField({ valueMm: 304.8, hideFocusHint: true });

    fireEvent.focus(input);

    expect(screen.queryByText(/Accepts 12'/)).not.toBeInTheDocument();
    // No message row means no reserved height to appear or vanish on blur.
    expect(container.querySelector(".field-hint, .length-field-hint, .field-error")).toBeNull();
  });

  it("still shows a conversion hint under hideFocusHint (only the focus hint is gated)", () => {
    const { input } = renderField({ hideFocusHint: true });

    // A cm value in an inch field yields a live conversion hint, which is not
    // focus-gated and must survive the suppression.
    fireEvent.change(input, { target: { value: "5 cm" } });

    expect(screen.getByText(/→/)).toBeInTheDocument();
  });

  it("keeps the placeholder available to return after focus guidance closes", () => {
    const { input } = renderField({ placeholder: "e.g. 24" });

    expect(input).toHaveAttribute("placeholder", "e.g. 24");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).toHaveClass("length-field-input");

    fireEvent.focus(input);
    expect(screen.getByText(/Accepts 12'/)).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "e.g. 24");

    fireEvent.blur(input);
    expect(screen.queryByText(/Accepts 12'/)).not.toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "e.g. 24");
  });

  it("appends field-specific focus guidance to the standard accepted formats", () => {
    const { input } = renderField({
      valueMm: 304.8,
      focusHint: "Applies to every wall in Main Gallery."
    });

    fireEvent.focus(input);

    expect(
      screen.getByText(/Accepts 12'.*Applies to every wall in Main Gallery\./)
    ).toBeInTheDocument();
  });

  it("renders no stepper buttons when stepMm is not provided (regression guard)", () => {
    renderField({ valueMm: 304.8 });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  describe("stepMm", () => {
    it("renders a stepper column when stepMm is provided", () => {
      renderField({ valueMm: 304.8, stepMm: 25.4 });

      expect(screen.getByRole("button", { name: "Increase Width" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Decrease Width" })).toBeInTheDocument();
    });

    it("ArrowUp in the input commits valueMm + stepMm", () => {
      const onCommit = vi.fn();
      const { input } = renderField({ valueMm: 304.8, stepMm: 25.4, onCommit });

      fireEvent.keyDown(input, { key: "ArrowUp" });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(expect.closeTo(330.2, 5));
    });

    it("ArrowDown in the input commits valueMm - stepMm", () => {
      const onCommit = vi.fn();
      const { input } = renderField({ valueMm: 304.8, stepMm: 25.4, onCommit });

      fireEvent.keyDown(input, { key: "ArrowDown" });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(expect.closeTo(279.4, 5));
    });

    it("clicking the increase chevron commits valueMm + stepMm", () => {
      const onCommit = vi.fn();
      renderField({ valueMm: 304.8, stepMm: 25.4, onCommit });

      fireEvent.click(screen.getByRole("button", { name: "Increase Width" }));

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(expect.closeTo(330.2, 5));
    });

    it("clicking the decrease chevron commits valueMm - stepMm", () => {
      const onCommit = vi.fn();
      renderField({ valueMm: 304.8, stepMm: 25.4, onCommit });

      fireEvent.click(screen.getByRole("button", { name: "Decrease Width" }));

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(expect.closeTo(279.4, 5));
    });

    it("steps from the committed valueMm when the input text is unparseable", () => {
      const onCommit = vi.fn();
      const { input } = renderField({ valueMm: 304.8, stepMm: 25.4, onCommit });

      fireEvent.change(input, { target: { value: "garbage" } });
      fireEvent.keyDown(input, { key: "ArrowUp" });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(expect.closeTo(330.2, 5));
    });
  });

  describe("Escape-to-revert", () => {
    it("restores the committed text and clears the error on a dirty field", () => {
      const { input } = renderField({ valueMm: 304.8 });

      fireEvent.change(input, { target: { value: "nonsense" } });
      fireEvent.blur(input);
      // The bad edit is showing an error and the invalid state.
      expect(screen.getByText(/measurement/i)).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "true");

      fireEvent.keyDown(input, { key: "Escape" });

      expect(input.value).toBe('12"');
      expect(input).toHaveAttribute("aria-invalid", "false");
      expect(screen.queryByText(/measurement/i)).not.toBeInTheDocument();
    });

    it("stops propagation on a dirty field so a global Escape handler can't fire", () => {
      const { input } = renderField({ valueMm: 304.8 });
      fireEvent.change(input, { target: { value: "99" } });

      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true
      });
      const stopPropagation = vi.spyOn(event, "stopPropagation");
      input.dispatchEvent(event);

      // The value-restore itself is covered above; here we only assert the
      // event is contained so a future global deselect-on-Escape can't fire.
      expect(stopPropagation).toHaveBeenCalled();
    });

    it("does not stop propagation on a clean field (lets a global Escape through)", () => {
      const { input } = renderField({ valueMm: 304.8 });

      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true
      });
      const stopPropagation = vi.spyOn(event, "stopPropagation");
      input.dispatchEvent(event);

      expect(stopPropagation).not.toHaveBeenCalled();
      // Untouched: the committed value stays put.
      expect(input.value).toBe('12"');
    });
  });

  describe("onEnterWhenClean", () => {
    it("fires onEnterWhenClean (not onCommit) on Enter when the value is unchanged", () => {
      const onCommit = vi.fn();
      const onEnterWhenClean = vi.fn();
      const { input } = renderField({
        valueMm: 304.8,
        onCommit,
        onEnterWhenClean
      });

      fireEvent.keyDown(input, { key: "Enter" });

      expect(onEnterWhenClean).toHaveBeenCalledTimes(1);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("fires onCommit (not onEnterWhenClean) on Enter when the value changed", () => {
      const onCommit = vi.fn();
      const onEnterWhenClean = vi.fn();
      const { input } = renderField({
        valueMm: 304.8,
        onCommit,
        onEnterWhenClean
      });

      fireEvent.change(input, { target: { value: "24" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onEnterWhenClean).not.toHaveBeenCalled();
    });
  });
});
