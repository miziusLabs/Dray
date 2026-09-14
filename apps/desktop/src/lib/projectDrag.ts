export const PROJECT_DRAG_EVENT = "dray:project-drag";

export function notifyProjectDrag(active: boolean) {
  window.dispatchEvent(
    new CustomEvent<{ active: boolean }>(PROJECT_DRAG_EVENT, {
      detail: { active },
    }),
  );
}
