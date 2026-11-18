import { useState, type ComponentProps } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import type { ProjectSummary } from "../../../domain/project";
import type {
  CloudBackupProviderStatus,
  CloudProjectFolder,
  SyncHeadListing
} from "../../cloud/provider";
import type { CloudProjectsStatus } from "../../store/cloudProjectsSlice";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { DeferredDialog, deferredModule } from "../shared/DeferredDialog";
import type { ProjectManager } from "./ProjectManager";

// Out of the entry chunk: fetched on first open (warmed on hover/focus of the
// caret), since most sessions never open the project manager.
const projectManagerModule = deferredModule<ComponentProps<typeof ProjectManager>>(() =>
  import("./ProjectManager").then((module) => module.ProjectManager)
);
const preloadProjectManager = () => {
  projectManagerModule.preload().catch(() => {});
};

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
  cloudSyncHeads,
  cloudProjectOpening,
  onRefreshCloudProjects,
  onOpenCloudProject,
  onOpenSyncedCloudProject,
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
  cloudSyncHeads: SyncHeadListing[] | null;
  cloudProjectOpening: string | null;
  onRefreshCloudProjects: () => Promise<void>;
  onOpenCloudProject: (folder: CloudProjectFolder) => Promise<boolean>;
  onOpenSyncedCloudProject: (head: SyncHeadListing) => Promise<boolean>;
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
            onFocus={preloadProjectManager}
            onPointerEnter={preloadProjectManager}
          >
            <CaretDownIcon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          Switch or manage projects
        </TooltipContent>
      </Tooltip>

      <DeferredDialog
        className="project-manager-dialog"
        module={projectManagerModule}
        open={isOpen}
        title="Projects"
        onOpenChange={setIsOpen}
        props={{
          cloudBackupConfigured,
          cloudBackupProviderStatus,
          cloudProjectOpening,
          cloudProjects,
          cloudProjectsStatus,
          cloudSyncHeads,
          currentProjectId,
          listProjectSummaries,
          onCreateProject,
          onDeleteProject,
          onDuplicateProject,
          onExportProject,
          onOpenCloudProject,
          onOpenProject,
          onOpenSyncedCloudProject,
          onReconnectCloudBackup,
          onRefreshCloudProjects,
          onRenameProject
        }}
      />
    </>
  );
}
