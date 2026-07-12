import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import type { ProjectSummary } from "../../domain/project";
import { Button } from "./ui/button";
import { ProjectManager } from "./ProjectManager";

// The topbar caret's whole job is opening the project manager modal — the
// list/rename/delete/export UI that used to live in this file's own
// DropdownMenu now lives in ProjectManager (see that file for why: counts,
// inline rename, and quick export don't fit a DropdownMenuItem).
export function ProjectPicker({
  currentProjectId,
  listProjectSummaries,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onOpenProject,
  onExportProject
}: {
  currentProjectId: string;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  onCreateProject: (title: string) => Promise<void>;
  onRenameProject: (id: string, title: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
  onExportProject: (id: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        aria-label="Manage projects"
        className="icon-button project-switcher-trigger"
        size="icon"
        title="Manage projects"
        variant="ghost"
        onClick={() => setIsOpen(true)}
      >
        <CaretDownIcon aria-hidden="true" size={18} />
      </Button>

      <ProjectManager
        currentProjectId={currentProjectId}
        listProjectSummaries={listProjectSummaries}
        open={isOpen}
        onCreateProject={onCreateProject}
        onDeleteProject={onDeleteProject}
        onExportProject={onExportProject}
        onOpenChange={setIsOpen}
        onOpenProject={onOpenProject}
        onRenameProject={onRenameProject}
      />
    </>
  );
}
