import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function csvFileWith(name: string, contents: string) {
  const file = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode(contents).buffer
  });
  return file;
}

// A spreadsheet whose read rejects — the only path in the wizard that surfaces
// the inline error banner without reaching for a real SheetJS workbook.
function unreadableSpreadsheet(name = "broken.xlsx", message = "Could not open workbook.") {
  const file = new File(["x"], name, { type: "application/vnd.ms-excel" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => {
      throw new Error(message);
    }
  });
  return file;
}

function spreadsheetInput() {
  return document.querySelector('input[accept=".csv,.tsv,.xlsx,.xls"]') as HTMLInputElement;
}

function imageInput() {
  return document.querySelector(
    'input[accept="image/jpeg,image/png,image/webp"]'
  ) as HTMLInputElement;
}

function stepNav() {
  return within(screen.getByLabelText("Import steps"));
}

// The step rail and the footer both carry a button called "Review"; the footer
// is everything outside the rail.
function footerButton(name: string) {
  const match = screen
    .getAllByRole("button", { name })
    .find((button) => button.closest(".import-steps") === null);
  if (!match) throw new Error(`No footer button named ${name}`);
  return match;
}

function expectActiveStep(label: "Upload" | "Map" | "Review") {
  expect(stepNav().getByRole("button", { name: label })).toHaveAttribute("aria-current", "step");
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

const TWO_ROW_CSV = [
  "Title,Artist,Date,Dimensions",
  "Mona Lisa,Leonardo,1503,77 x 53 cm",
  "The Scream,Munch,1893,91 x 73 cm"
].join("\n");

const OTHER_CSV = ["Title,Artist", "Guernica,Picasso"].join("\n");

describe("ImportWizard step transitions", () => {
  it("opens on the upload step with the later steps locked", () => {
    renderWizard();

    expectActiveStep("Upload");
    expect(stepNav().getByRole("button", { name: "Map" })).toBeDisabled();
    expect(stepNav().getByRole("button", { name: "Review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import images" })).toBeDisabled();
    expect(screen.getByText("Choose source files")).toBeInTheDocument();
  });

  it("keeps the images-only path on upload and imports straight from there", async () => {
    const onImportImages = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <ImportWizard
        intakeState="idle"
        open
        projectUnit="in"
        onImportDrafts={vi.fn()}
        onImportImages={onImportImages}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.change(imageInput(), { target: { files: [imageFile("one.jpg")] } });
    expect(await screen.findByText("1 images")).toBeInTheDocument();

    // Images alone never unlock Map/Review — there is no table to map.
    expectActiveStep("Upload");
    expect(stepNav().getByRole("button", { name: "Map" })).toBeDisabled();
    expect(stepNav().getByRole("button", { name: "Review" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Import images" }));
    await waitFor(() => expect(onImportImages).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("walks upload to map to review once a spreadsheet is loaded", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    expect(await screen.findByText("works.csv")).toBeInTheDocument();

    // A readable table unlocks both later steps at once.
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Map" })).toBeEnabled());
    expect(stepNav().getByRole("button", { name: "Review" })).toBeEnabled();
    expectActiveStep("Upload");

    fireEvent.click(footerButton("Continue"));
    expectActiveStep("Map");
    expect(screen.getByText("Map spreadsheet columns")).toBeInTheDocument();

    fireEvent.click(footerButton("Review"));
    expectActiveStep("Review");
    expect(screen.getByText("Review imported works")).toBeInTheDocument();
    expect(screen.getByLabelText("Import Mona Lisa")).toBeChecked();
    expect(screen.getByLabelText("Import The Scream")).toBeChecked();
  });

  it("re-locks map and review when the spreadsheet is cleared", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Map" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByText("works.csv")).not.toBeInTheDocument();
    expect(stepNav().getByRole("button", { name: "Map" })).toBeDisabled();
    expect(stepNav().getByRole("button", { name: "Review" })).toBeDisabled();
    // Clearing the spreadsheet does not move the wizard off the step it is on.
    expectActiveStep("Upload");
  });

  it("returns to upload from review with the spreadsheet still loaded", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Map" })).toBeEnabled());
    fireEvent.click(footerButton("Continue"));
    fireEvent.click(footerButton("Review"));
    expectActiveStep("Review");

    fireEvent.click(stepNav().getByRole("button", { name: "Upload" }));

    expectActiveStep("Upload");
    expect(screen.getByText("works.csv")).toBeInTheDocument();
    expect(footerButton("Continue")).toBeEnabled();
  });

  it("resets downstream drafts when a different spreadsheet replaces the first", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Map" })).toBeEnabled());
    fireEvent.click(footerButton("Continue"));
    fireEvent.click(footerButton("Review"));
    expect(screen.getByLabelText("Import Mona Lisa")).toBeInTheDocument();

    fireEvent.click(stepNav().getByRole("button", { name: "Upload" }));
    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("other.csv", OTHER_CSV)] }
    });
    expect(await screen.findByText("other.csv")).toBeInTheDocument();

    fireEvent.click(footerButton("Continue"));
    fireEvent.click(footerButton("Review"));

    // Drafts, selection and image choices all come from the new table only.
    expect(screen.getByLabelText("Import Guernica")).toBeChecked();
    expect(screen.queryByLabelText("Import Mona Lisa")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Import The Scream")).not.toBeInTheDocument();
  });

  it("starts clean on upload after the dialog closes and reopens", async () => {
    const props = {
      intakeState: "idle" as const,
      projectUnit: "in" as const,
      onImportDrafts: vi.fn(),
      onImportImages: vi.fn(),
      onOpenChange: vi.fn()
    };
    const view = render(<ImportWizard open {...props} />);

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    fireEvent.change(imageInput(), { target: { files: [imageFile("one.jpg")] } });
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Map" })).toBeEnabled());
    fireEvent.click(footerButton("Continue"));
    expectActiveStep("Map");

    view.rerender(<ImportWizard open={false} {...props} />);
    view.rerender(<ImportWizard open {...props} />);

    expectActiveStep("Upload");
    expect(screen.queryByText("works.csv")).not.toBeInTheDocument();
    expect(screen.queryByText("1 images")).not.toBeInTheDocument();
    expect(stepNav().getByRole("button", { name: "Map" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import images" })).toBeDisabled();
  });

  it("shows a read failure and clears it once a readable spreadsheet arrives", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [unreadableSpreadsheet("broken.xlsx", "Could not open workbook.")] }
    });

    expect(await screen.findByText("Could not open workbook.")).toBeInTheDocument();
    expect(stepNav().getByRole("button", { name: "Map" })).toBeDisabled();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });

    expect(await screen.findByText("works.csv")).toBeInTheDocument();
    expect(screen.queryByText("Could not open workbook.")).not.toBeInTheDocument();
  });

  it("clears a read failure when the spreadsheet well is cleared", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    expect(await screen.findByText("works.csv")).toBeInTheDocument();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [unreadableSpreadsheet("broken.xlsx", "Nope.")] }
    });
    expect(await screen.findByText("Nope.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("Nope.")).not.toBeInTheDocument();
  });

  it("imports the selected drafts from review and closes", async () => {
    const onImportDrafts = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <ImportWizard
        intakeState="idle"
        open
        projectUnit="in"
        onImportDrafts={onImportDrafts}
        onImportImages={vi.fn()}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Map" })).toBeEnabled());
    fireEvent.click(footerButton("Continue"));
    fireEvent.click(footerButton("Review"));

    fireEvent.click(screen.getByLabelText("Import The Scream"));
    fireEvent.click(footerButton("Import"));

    await waitFor(() => expect(onImportDrafts).toHaveBeenCalledTimes(1));
    const drafts = onImportDrafts.mock.calls[0][0];
    expect(drafts.map((draft: { artwork: { title?: string } }) => draft.artwork.title)).toEqual([
      "Mona Lisa",
      "The Scream"
    ]);
    expect(drafts.map((draft: { selected: boolean }) => draft.selected)).toEqual([true, false]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables Import on review once every row is deselected", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Map" })).toBeEnabled());
    fireEvent.click(footerButton("Continue"));
    fireEvent.click(footerButton("Review"));

    expect(footerButton("Import")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Import Mona Lisa"));
    fireEvent.click(screen.getByLabelText("Import The Scream"));
    expect(footerButton("Import")).toBeDisabled();
  });

  it("jumps straight to review from the step rail without passing through map", async () => {
    renderWizard();

    fireEvent.change(spreadsheetInput(), {
      target: { files: [csvFileWith("works.csv", TWO_ROW_CSV)] }
    });
    await waitFor(() => expect(stepNav().getByRole("button", { name: "Review" })).toBeEnabled());

    fireEvent.click(stepNav().getByRole("button", { name: "Review" }));

    expectActiveStep("Review");
    expect(screen.getByLabelText("Import Mona Lisa")).toBeInTheDocument();
  });
});
