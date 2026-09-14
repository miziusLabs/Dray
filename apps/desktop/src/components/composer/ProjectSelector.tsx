import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Menu, Pencil, Plus, Trash2, X } from "lucide-react";

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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHotkey } from "@/hooks/useHotkey";
import { IS_MAC } from "@/lib/platform";
import { NO_PROJECT_SELECTION } from "@/lib/projects";
import { notifyProjectDrag } from "@/lib/projectDrag";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/events";

export default function ProjectSelector({
  projects,
  value,
  onSelect,
  onAttach,
  onRename,
  onDelete,
  onReorder,
}: {
  projects: Project[];
  value: string | null;
  onSelect: (path: string | null) => void;
  onAttach: () => void;
  onRename: (path: string, name: string) => Promise<boolean>;
  onDelete: (path: string) => Promise<boolean>;
  onReorder: (paths: string[]) => Promise<boolean>;
}) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [draggingProjectPath, setDraggingProjectPath] = useState<string | null>(null);
  // The boundary after row n is represented by n, so the marker can be drawn
  // between rows rather than highlighting the row that would receive the drop.
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const dragRef = useRef<{ path: string; pointerId: number } | null>(null);
  const sortingRef = useRef(false);

  const updateDropIndex = (event: PointerEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const row = target?.closest<HTMLElement>("[data-project-index]");
    if (!row) {
      dropIndexRef.current = null;
      setDropIndex(null);
      return;
    }

    const rowIndex = Number(row.dataset.projectIndex);
    const box = row.getBoundingClientRect();
    const nextIndex = rowIndex + (event.clientY >= box.top + box.height / 2 ? 1 : 0);
    dropIndexRef.current = nextIndex;
    setDropIndex(nextIndex);
  };
  const selectedProject = projects.find((project) => project.path === value);

  // Keep the whole window honest while the handle owns the pointer drag, and
  // restore any cursor the host window had before it started.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftHeld(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftHeld(false);
    };
    const handleWindowBlur = () => setShiftHeld(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!draggingProjectPath) return;

    const root = document.documentElement;
    const previousCursor = root.style.cursor;
    const previousUserSelect = root.style.userSelect;
    root.style.cursor = "grabbing";
    root.style.userSelect = "none";

    return () => {
      root.style.cursor = previousCursor;
      root.style.userSelect = previousUserSelect;
    };
  }, [draggingProjectPath]);

  const moveProject = async (path: string, index: number) => {
    const from = projects.findIndex((project) => project.path === path);
    if (from < 0) return;

    const next = [...projects];
    const [moved] = next.splice(from, 1);
    const insertionIndex = from < index ? index - 1 : index;
    if (insertionIndex === from) return;

    next.splice(insertionIndex, 0, moved);
    sortingRef.current = true;
    setDropIndex(null);
    try {
      await onReorder(next.map((project) => project.path));
    } finally {
      sortingRef.current = false;
      // Reordering replaces the project list while the menu is open. Restore
      // the controlled open state after that update so sorting never dismisses
      // the picker the user is still working in.
      setPickerOpen(true);
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingProjectPath(null);
    setDropIndex(null);
    notifyProjectDrag(false);

    const index = dropIndexRef.current;
    dropIndexRef.current = null;
    if (drag && index !== null) void moveProject(drag.path, index);
  };

  useHotkey("p", () => setPickerOpen(true));

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

  const shortcut = IS_MAC ? "⌘" : "Ctrl";

  return (
    <>
      <DropdownMenu
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open && sortingRef.current) return;
          setPickerOpen(open);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="max-w-40 px-1.5 text-ui text-muted-foreground"
              >
                <span className="truncate">
                  {selectedProject?.name ?? (value === null ? "No Project" : "Attach project")}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            Choose project
            <KbdGroup>
              <Kbd>{shortcut}</Kbd>
              <Kbd>P</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup
            value={value ?? NO_PROJECT_SELECTION}
            onValueChange={(next) =>
              onSelect(next === NO_PROJECT_SELECTION ? null : next)
            }
          >
            {projects.map((project) => (
              <Tooltip key={project.path}>
                <TooltipTrigger asChild>
                  <DropdownMenuRadioItem
                    value={project.path}
                    title={project.path}
                    data-project-index={projects.indexOf(project)}
                    className={cn(
                      "group relative min-h-7 w-full cursor-pointer rounded-md py-0 pr-8 pl-2 text-ui hover:[&>span[data-slot=dropdown-menu-radio-item-indicator]]:opacity-0",
                      draggingProjectPath === project.path && [
                        "opacity-50",
                        "[&>span[data-slot=dropdown-menu-radio-item-indicator]]:opacity-0",
                      ],
                    )}
                  >
                    {dropIndex === projects.indexOf(project) && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-ring"
                      />
                    )}
                    {dropIndex === projects.indexOf(project) + 1 && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-0.5 rounded-full bg-ring"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <div
                      className={cn(
                        "pointer-events-none absolute right-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity",
                        shiftHeld && "group-hover:pointer-events-auto group-hover:opacity-100",
                      )}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Rename ${project.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPickerOpen(false);
                          startEditing(project);
                        }}
                        className="size-6 min-w-6 max-w-6 cursor-pointer rounded-[min(var(--radius-md),10px)] p-0 text-foreground"
                      >
                        <Pencil className="size-3 text-foreground" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${project.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPickerOpen(false);
                          setDeletingProject(project);
                        }}
                        className="size-6 min-w-6 max-w-6 cursor-pointer rounded-[min(var(--radius-md),10px)] p-0 !text-destructive hover:!text-destructive -mr-1.5"
                      >
                        <Trash2
                          className="size-3"
                          color="var(--destructive)"
                          stroke="var(--destructive)"
                          style={{ color: "var(--destructive)", stroke: "var(--destructive)" }}
                          aria-hidden="true"
                        />
                      </Button>
                    </div>
                    <button
                      type="button"
                      aria-label={`Reorder ${project.name}`}
                      title="Reorder project"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        dragRef.current = {
                          path: project.path,
                          pointerId: event.pointerId,
                        };
                        notifyProjectDrag(true);
                        setDraggingProjectPath(project.path);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onPointerMove={(event) => {
                        if (dragRef.current?.pointerId !== event.pointerId) return;
                        updateDropIndex(event);
                      }}
                      onPointerUp={(event) => {
                        if (dragRef.current?.pointerId !== event.pointerId) return;
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        endDrag();
                      }}
                      onPointerCancel={(event) => {
                        if (dragRef.current?.pointerId !== event.pointerId) return;
                        endDrag();
                      }}
                      className={cn(
                        "pointer-events-none absolute right-2 z-10 flex size-5 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
                        shiftHeld
                          ? "group-hover:pointer-events-none group-hover:opacity-0"
                          : "group-hover:pointer-events-auto group-hover:opacity-100",
                        draggingProjectPath === project.path && "cursor-grabbing opacity-100",
                      )}
                    >
                      <Menu className="size-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenuRadioItem>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <Kbd>Shift</Kbd>
                  to show more
                </TooltipContent>
              </Tooltip>
            ))}

            <DropdownMenuRadioItem value={NO_PROJECT_SELECTION} className="text-ui">
              <X />
              No Project
            </DropdownMenuRadioItem>
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
