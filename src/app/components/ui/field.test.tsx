import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field } from "./field";
import { Input } from "./input";

afterEach(cleanup);

describe("Field", () => {
  it("associates a stacked label with its wrapped input", () => {
    render(
      <Field label="Width">
        <Input />
      </Field>
    );

    expect(screen.getByRole("textbox", { name: "Width" })).toBeInTheDocument();
  });

  it("associates an inline label through htmlFor", () => {
    render(
      <Field htmlFor="finish" label="Finish" layout="inline">
        <Input id="finish" />
      </Field>
    );

    expect(screen.getByRole("textbox", { name: "Finish" })).toBeInTheDocument();
  });

  it("renders no helper row until a message exists", () => {
    const { rerender } = render(
      <Field label="Height">
        <Input />
      </Field>
    );

    expect(screen.queryByText("Accepted formats")).not.toBeInTheDocument();

    rerender(
      <Field label="Height" message="Accepted formats">
        <Input />
      </Field>
    );

    expect(screen.getByText("Accepted formats")).toBeInTheDocument();
  });
});
