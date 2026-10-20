export interface RawAction {
  id?: string;
  timestampUtcMs?: string;
  scope?: string;
  type: string;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export function stampActions(
  actions: RawAction[],
  now: () => Date,
  uuid: () => string,
  defaultScope: string,
): RawAction[] {
  return actions.map((action) => ({
    ...action,
    id: action.id ? action.id : uuid(),
    timestampUtcMs: action.timestampUtcMs
      ? action.timestampUtcMs
      : now().toISOString(),
    scope: action.scope ? action.scope : defaultScope,
  }));
}
