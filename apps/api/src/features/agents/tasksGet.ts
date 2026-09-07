import { BadRequestError, NotFoundError } from "@jackline/shared";
import { err, ok, type Result } from "neverthrow";

export type StoredA2aTask = {
  id: string;
  agentId: string;
  state: string;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
};

export type TasksGetResult = {
  taskId: string;
  state: string;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};

/** Pure helper: shape tasks/get from a stored A2A task row. */
export function buildTasksGetResult(
  agentId: string,
  taskId: unknown,
  row: StoredA2aTask | undefined,
): Result<TasksGetResult, BadRequestError | NotFoundError> {
  if (typeof taskId !== "string" || taskId.length === 0) {
    return err(new BadRequestError("taskId is required"));
  }
  if (!row || row.agentId !== agentId) {
    return err(new NotFoundError("Task not found"));
  }
  return ok({
    taskId: row.id,
    state: row.state,
    ...(row.result !== undefined ? { result: row.result } : {}),
    ...(row.error !== undefined ? { error: row.error } : {}),
  });
}

/** Pure helper: validate tool ids are a unique subset of known tenant tools. */
export function validateAgentToolIds(
  requestedToolIds: string[],
  tenantToolIds: ReadonlySet<string>,
): Result<string[], BadRequestError> {
  const uniqueToolIds = [...new Set(requestedToolIds)];
  for (const toolId of uniqueToolIds) {
    if (!tenantToolIds.has(toolId)) {
      return err(
        new BadRequestError(
          "One or more toolIds do not reference tools in this tenant",
        ),
      );
    }
  }
  return ok(uniqueToolIds);
}
