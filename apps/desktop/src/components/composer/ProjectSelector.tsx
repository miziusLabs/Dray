import { useRef, useState } from "react";
import { FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Project } from "@/types/events";

export default function ProjectSelector({
  projects,
  value,
  onSelect,
  onAttach,
  onRename,
  onDelete,
}: {
  projects: Project[];
  value: string | null;
  onSelect: (path: string) => void;
  onAttach: () => void;
  onRename: (path: string, name: string) => Promise<boolean>;
  onDelete: (path: string) => Promise<boolean>;
}) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A context menu is portalled outside the dropdown. Keep its project row
  // mounted while focus moves between those two portals, then close both.
  const contextMenuOpen = useRef(false);
  const selectedProject = projects.find((project) => project.path === value);

  const startEditing = (project: Project) => {
    setEditName(project.name);
    setEditingProject(project);
  };

  const saveName = async () => {
    if (!editingProject || !editName.trim()) return;

    setSaving(true);
    const saved = await onRename(editingProject.path, editName.trim());
    setSaving(false);
    if (saved) setEditingProject(null);
  };

  // Nothing to choose between yet, so the trigger does the only useful thing
  // rather than opening a menu whose sole item is the same action.
  if (projects.length === 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAttach}
        className="gap-1.5 px-1.5 text-ui text-muted-foreground"
      >
        <FolderPlus className="size-3.5 shrink-0" />
        Attach project
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu
        open={pickerOpen}
        onOpenChange={(open) => {
          if (open || !contextMenuOpen.current) setPickerOpen(open);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-w-40 px-1.5 text-ui text-muted-foreground"
          >
            <span className="truncate">
              {selectedProject?.name ?? "Attach project"}
            </span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onSelect}>
            {projects.map((project) => (
              <ContextMenu
                key={project.path}
                onOpenChange={(open) => {
                  contextMenuOpen.current = open;
                  if (!open) setPickerOpen(false);
                }}
              >
                <ContextMenuTrigger asChild>
                  <DropdownMenuRadioItem
                    value={project.path}
                    title={project.path}
                    className="text-ui"
                  >
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuRadioItem>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => startEditing(project)}>
                    <Pencil />
                    Edit
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => setDeletingProject(project)}
                  >
                    <Trash2 />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuItem onSelect={onAttach} className="text-ui">
            <Plus />
            Attach project…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={editingProject !== null}
        onOpenChange={(open) => !open && !saving && setEditingProject(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Change the name shown in the project picker.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <Input
              autoFocus
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              aria-label="Project name"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setEditingProject(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || !editName.trim()}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingProject !== null}
        onOpenChange={(open) => !open && setDeletingProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingProject?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project from the picker. Existing sessions are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (deletingProject) void onDelete(deletingProject.path);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
