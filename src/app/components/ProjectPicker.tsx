import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import type { ProjectSummary } from "../../domain/project";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ProjectManager } from "./ProjectManager";

// Topbar project caret opens the project manager modal.
export function ProjectPicker({
  currentProjectId,
  listProjectSummaries,
  onCreateProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
  onOpenProject,
  onExportProject
}: {
  currentProjectId: string;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  onCreateProject: (title: string) => Promise<void>;
  onDuplicateProject: (id: string) => Promise<void>;
  onRenameProject: (id: string, title: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
  onExportProject: (id: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Manage projects"
            className="icon-button project-switcher-trigger"
            size="icon"
            variant="ghost"
            onClick={() => setIsOpen(true)}
          >
            <CaretDownIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          Switch or manage projects
        </TooltipContent>
      </Tooltip>

      <ProjectManager
        currentProjectId={currentProjectId}
        listProjectSummaries={listProjectSummaries}
        open={isOpen}
        onCreateProject={onCreateProject}
        onDeleteProject={onDeleteProject}
        onDuplicateProject={onDuplicateProject}
        onExportProject={onExportProject}
        onOpenChange={setIsOpen}
        onOpenProject={onOpenProject}
        onRenameProject={onRenameProject}
      />
    </>
  );
}
