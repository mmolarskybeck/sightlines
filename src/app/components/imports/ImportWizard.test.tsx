import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportWizard from "./ImportWizard";

function renderWizard() {
  return render(
    <ImportWizard
      intakeState="idle"
      open
      projectUnit="in"
      onImportDrafts={vi.fn()}
      onImportImages={vi.fn()}
      onOpenChange={vi.fn()}
    />
  );
}

function imageFile(name: string, type = "image/jpeg") {
  return new File(["fake"], name, { type });
}

function csvFile(name = "metadata.csv") {
  const contents = "Title,Artist\nMona Lisa,Leonardo";
  const file = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode(contents).buffer
  });
  return file;
}

afterEach(() => {
  cleanup();
});

describe("ImportWizard upload step", () => {
  it("imports images directly and allows selected image files to be changed", async () => {
    const onImportImages = vi.fn().mockResolvedValue(undefined);

    render(
      <ImportWizard
        intakeState="idle"
        open
        projectUnit="in"
        onImportDrafts={vi.fn()}
        onImportImages={onImportImages}
        onOpenChange={vi.fn()}
      />
    );

    const imageInput = document.querySelector(
      'input[accept="image/jpeg,image/png,image/webp"]'
    ) as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: { files: [imageFile("one.jpg"), imageFile("two.png", "image/png")] }
    });

    expect(await screen.findByText("2 images")).toBeInTheDocument();
    expect(screen.getByText("one.jpg")).toBeInTheDocument();
    expect(screen.getByText("two.png")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Remove two.png"));
    expect(screen.queryByText("two.png")).not.toBeInTheDocument();

    fireEvent.change(imageInput, {
      target: { files: [imageFile("three.webp", "image/webp")] }
    });

    expect(screen.getByText("2 images")).toBeInTheDocument();
    expect(screen.getByText("one.jpg")).toBeInTheDocument();
    expect(screen.getByText("three.webp")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import images" }));

    await waitFor(() => expect(onImportImages).toHaveBeenCalledTimes(1));
    expect(onImportImages.mock.calls[0][0].map((file: File) => file.name)).toEqual([
      "one.jpg",
      "three.webp"
    ]);
  });

  it("can clear all images and clears spreadsheet metadata without clearing images", async () => {
    renderWizard();

    const imageInput = document.querySelector(
      'input[accept="image/jpeg,image/png,image/webp"]'
    ) as HTMLInputElement;
    const spreadsheetInput = document.querySelector(
      'input[accept=".csv,.tsv,.xlsx,.xls"]'
    ) as HTMLInputElement;

    fireEvent.change(imageInput, {
      target: { files: [imageFile("keeper.jpg"), imageFile("remove-me.jpg")] }
    });
    expect(await screen.findByText("2 images")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.queryByText("keeper.jpg")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import images" })).toBeDisabled();

    fireEvent.change(imageInput, {
      target: { files: [imageFile("keeper.jpg")] }
    });
    fireEvent.change(spreadsheetInput, {
      target: { files: [csvFile()] }
    });

    expect(await screen.findByText("metadata.csv")).toBeInTheDocument();
    expect(screen.getByText("keeper.jpg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByText("metadata.csv")).not.toBeInTheDocument();
    expect(screen.getByText("keeper.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import images" })).toBeEnabled();
  });

  it("allows images to be added after a spreadsheet has already populated the metadata well", async () => {
    renderWizard();

    const imageInput = document.querySelector(
      'input[accept="image/jpeg,image/png,image/webp"]'
    ) as HTMLInputElement;
    const spreadsheetInput = document.querySelector(
      'input[accept=".csv,.tsv,.xlsx,.xls"]'
    ) as HTMLInputElement;

    fireEvent.change(spreadsheetInput, {
      target: { files: [csvFile()] }
    });

    expect(await screen.findByText("metadata.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    fireEvent.change(imageInput, {
      target: { files: [imageFile("after-csv.jpg", "")] }
    });

    expect(await screen.findByText("1 images")).toBeInTheDocument();
    expect(screen.getByText("after-csv.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});
