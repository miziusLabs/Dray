import BranchSelector from "@/components/composer/BranchSelector";
import ModelSelector from "@/components/composer/ModelSelector";
import PermissionSelector from "@/components/composer/PermissionSelector";
import ProjectSelector from "@/components/composer/ProjectSelector";
import WorktreeToggle from "@/components/composer/WorktreeToggle";
import type {
  ApprovalPolicy,
  BranchList,
  Effort,
  Model,
  ModelId,
  Project,
} from "@/types/events";

export type ComposerToolbarProps = {
  models: Model[];
  modelId: ModelId;
  effort: Effort | null;
  onModelChange: (modelId: ModelId, effort: Effort | null) => void;

  permissionMode: ApprovalPolicy;
  onPermissionModeChange: (mode: ApprovalPolicy) => void;

  projects: Project[];
  projectPath: string | null;
  onSelectProject: (path: string) => void;
  onAttachProject: () => void;

  branches: BranchList | null;
  branch: string | null;
  onSelectBranch: (branch: string) => void;

  useWorktree: boolean;
  onToggleWorktree: () => void;

  /// Where the session runs is fixed at creation, so the last three controls
  /// only exist before one starts.
  isNewSession: boolean;
};

/// The row under the composer. Model and permission change a running session in
/// place; project, branch, and worktree decide where it starts and disappear
/// once it has — a control that can never be used is noise, and the session
/// header already shows the project and branch.
export default function ComposerToolbar({
  models,
  modelId,
  effort,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
  projects,
  projectPath,
  onSelectProject,
  onAttachProject,
  branches,
  branch,
  onSelectBranch,
  useWorktree,
  onToggleWorktree,
  isNewSession,
}: ComposerToolbarProps) {
  return (
    <div className="flex min-w-0 items-center gap-0.5 px-1 pt-1.5">
      <PermissionSelector value={permissionMode} onChange={onPermissionModeChange} />

      <ModelSelector
        models={models}
        modelId={modelId}
        effort={effort}
        onChange={onModelChange}
      />

      {isNewSession && (
        <>
          <ProjectSelector
            projects={projects}
            value={projectPath}
            onSelect={onSelectProject}
            onAttach={onAttachProject}
          />

          {/* Both describe a repo, so neither means anything until one is
              picked — and a worktree has nothing to fork from. */}
          {projectPath && (
            <>
              <WorktreeToggle on={useWorktree} onToggle={onToggleWorktree} />

              <BranchSelector
                branches={branches}
                value={branch}
                onSelect={onSelectBranch}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
