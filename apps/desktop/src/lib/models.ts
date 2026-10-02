import type { AgentModel, Effort, Model, ModelId } from "@/types/events";

export function selectionKey(modelId: ModelId, agentModel: AgentModel | null): string {
  return agentModel ? `dray:${agentModel.provider}/${agentModel.id}` : modelId;
}

export function modelKey(model: Model): string {
  return selectionKey(model.id, model.agentModel);
}

export function resolveEffort(model: Model | undefined | null, requested: Effort | null): Effort | null {
  if (!model) return null;
  return [requested, model.defaultEffort, model.efforts[0]].find(
    (value): value is Effort => value != null && model.efforts.includes(value),
  ) ?? null;
}

// Older builds shared the `dray` entry across every OpenAI model. Preserve it
// only for the selected model so other models start with their own defaults.
export function migrateEffortPreferences(
  preferences: Partial<Record<string, Effort>>,
  modelId: ModelId,
  agentModel: AgentModel | null,
): Partial<Record<string, Effort>> {
  if (!preferences.dray) return preferences;
  const { dray, ...perModel } = preferences;
  if (!agentModel) return perModel;
  const key = selectionKey(modelId, agentModel);
  return { ...perModel, [key]: perModel[key] ?? dray };
}
