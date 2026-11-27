export interface BudgetNotification {
  budgetDisplayName?: string;
  costAmount: number;
  budgetAmount: number;
  currencyCode?: string;
  alertThresholdExceeded?: number;
  forecastThresholdExceeded?: number;
  costIntervalStart?: string;
  budgetAmountType?: string;
}

export type ParseResult =
  | { ok: true; notification: BudgetNotification }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Finite JSON numbers only. Numeric strings are rejected so a bad publisher cannot slip through. */
function readAmount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function readOptionalAmount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return readAmount(value);
}

/**
 * Budget notifications arrive as a Pub/Sub CloudEvent. `message.data` is a
 * base64-encoded JSON object. Accepts either the full CloudEvent or the
 * inner `{ message }` payload.
 */
export function parseBudgetCloudEvent(event: unknown): ParseResult {
  if (!isRecord(event)) {
    return { ok: false, reason: "budget event is not an object" };
  }

  const carrier = isRecord(event["data"]) ? event["data"] : event;
  const message = isRecord(carrier["message"]) ? carrier["message"] : undefined;
  const encoded = message?.["data"];
  if (typeof encoded !== "string" || encoded.trim() === "") {
    return { ok: false, reason: "budget event is missing message.data" };
  }

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `budget event data is not base64: ${detail}` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoded) as unknown;
  } catch {
    return { ok: false, reason: "budget event data is not JSON" };
  }
  if (!isRecord(payload)) {
    return { ok: false, reason: "budget event JSON is not an object" };
  }

  const costAmount = readAmount(payload["costAmount"]);
  const budgetAmount = readAmount(payload["budgetAmount"]);
  if (costAmount === undefined || budgetAmount === undefined) {
    return {
      ok: false,
      reason: "budget event is missing numeric costAmount and budgetAmount",
    };
  }

  const notification: BudgetNotification = {
    costAmount,
    budgetAmount,
  };
  const budgetDisplayName = readString(payload["budgetDisplayName"]);
  if (budgetDisplayName !== undefined) notification.budgetDisplayName = budgetDisplayName;
  const currencyCode = readString(payload["currencyCode"]);
  if (currencyCode !== undefined) notification.currencyCode = currencyCode;
  const costIntervalStart = readString(payload["costIntervalStart"]);
  if (costIntervalStart !== undefined) notification.costIntervalStart = costIntervalStart;
  const budgetAmountType = readString(payload["budgetAmountType"]);
  if (budgetAmountType !== undefined) notification.budgetAmountType = budgetAmountType;

  const alertThresholdExceeded = readOptionalAmount(payload["alertThresholdExceeded"]);
  if (alertThresholdExceeded !== undefined) {
    notification.alertThresholdExceeded = alertThresholdExceeded;
  }
  const forecastThresholdExceeded = readOptionalAmount(payload["forecastThresholdExceeded"]);
  if (forecastThresholdExceeded !== undefined) {
    notification.forecastThresholdExceeded = forecastThresholdExceeded;
  }

  return { ok: true, notification };
}
