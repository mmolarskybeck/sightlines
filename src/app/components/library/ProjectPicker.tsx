import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import type { ProjectSummary } from "../../../domain/project";
import type {
  CloudBackupProviderStatus,
  CloudProjectFolder
} from "../../cloud/provider";
import type { CloudProjectsStatus } from "../../store/cloudProjectsSlice";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
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
  onExportProject,
  cloudBackupConfigured,
  cloudBackupProviderStatus,
  cloudProjects,
  cloudProjectsStatus,
  cloudProjectOpening,
  onRefreshCloudProjects,
  onOpenCloudProject,
  onReconnectCloudBackup
}: {
  currentProjectId: string;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  onCreateProject: (title: string) => Promise<void>;
  onDuplicateProject: (id: string) => Promise<void>;
  onRenameProject: (id: string, title: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
  onExportProject: (id: string) => Promise<void>;
  cloudBackupConfigured: boolean;
  cloudBackupProviderStatus: CloudBackupProviderStatus;
  cloudProjects: CloudProjectFolder[] | null;
  cloudProjectsStatus: CloudProjectsStatus;
  cloudProjectOpening: string | null;
  onRefreshCloudProjects: () => Promise<void>;
  onOpenCloudProject: (folder: CloudProjectFolder) => Promise<boolean>;
  onReconnectCloudBackup: () => Promise<void>;
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
        cloudBackupConfigured={cloudBackupConfigured}
        cloudBackupProviderStatus={cloudBackupProviderStatus}
        cloudProjectOpening={cloudProjectOpening}
        cloudProjects={cloudProjects}
        cloudProjectsStatus={cloudProjectsStatus}
        currentProjectId={currentProjectId}
        listProjectSummaries={listProjectSummaries}
        open={isOpen}
        onCreateProject={onCreateProject}
        onDeleteProject={onDeleteProject}
        onDuplicateProject={onDuplicateProject}
        onExportProject={onExportProject}
        onOpenChange={setIsOpen}
        onOpenCloudProject={onOpenCloudProject}
        onOpenProject={onOpenProject}
        onReconnectCloudBackup={onReconnectCloudBackup}
        onRefreshCloudProjects={onRefreshCloudProjects}
        onRenameProject={onRenameProject}
      />
    </>
  );
}
