import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBudgetCloudEvent, type BudgetNotification } from "./parse.js";

const sample: BudgetNotification = {
  budgetDisplayName: "Jackline monthly budget",
  alertThresholdExceeded: 1,
  costAmount: 35.01,
  costIntervalStart: "2026-11-01T00:00:00Z",
  budgetAmount: 35,
  budgetAmountType: "SPECIFIED_AMOUNT",
  currencyCode: "USD",
};

function cloudEvent(payload: unknown, data?: string): unknown {
  return {
    specversion: "1.0",
    id: "evt-1",
    type: "google.cloud.pubsub.topic.v1.messagePublished",
    source: "//pubsub.googleapis.com/projects/mesh-505410/topics/jackline-budget",
    data: {
      subscription: "projects/mesh-505410/subscriptions/jackline-budget-sub",
      message: {
        messageId: "m1",
        data: data ?? Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
      },
    },
  };
}

describe("parseBudgetCloudEvent", () => {
  it("decodes a Pub/Sub CloudEvent budget notification", () => {
    const parsed = parseBudgetCloudEvent(cloudEvent(sample));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.notification.costAmount, 35.01);
    assert.equal(parsed.notification.budgetAmount, 35);
    assert.equal(parsed.notification.currencyCode, "USD");
    assert.equal(parsed.notification.budgetDisplayName, "Jackline monthly budget");
    assert.equal(parsed.notification.alertThresholdExceeded, 1);
    assert.equal(parsed.notification.forecastThresholdExceeded, undefined);
  });

  it("accepts the inner Pub/Sub payload without the CloudEvent envelope", () => {
    const event = cloudEvent(sample);
    const data = (event as { data: unknown }).data;
    const parsed = parseBudgetCloudEvent(data);
    assert.equal(parsed.ok, true);
  });

  it("keeps an optional forecast threshold without requiring it", () => {
    const parsed = parseBudgetCloudEvent(
      cloudEvent({ ...sample, costAmount: 10, forecastThresholdExceeded: 1 }),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.notification.forecastThresholdExceeded, 1);
    assert.equal(parsed.notification.costAmount, 10);
  });

  it("rejects missing, non-object, and non-json payloads", () => {
    assert.equal(parseBudgetCloudEvent(null).ok, false);
    assert.equal(parseBudgetCloudEvent({}).ok, false);
    assert.equal(parseBudgetCloudEvent({ data: {} }).ok, false);
    assert.equal(parseBudgetCloudEvent({ message: {} }).ok, false);
    const notJson = parseBudgetCloudEvent(
      cloudEvent(null, Buffer.from("not-json", "utf8").toString("base64")),
    );
    assert.equal(notJson.ok, false);
    if (notJson.ok) return;
    assert.match(notJson.reason, /not JSON/);
  });

  it("rejects payloads that are not numeric cost and budget amounts", () => {
    const cases = [
      {},
      { costAmount: "35", budgetAmount: 35 },
      { costAmount: 35, budgetAmount: "35" },
      { costAmount: null, budgetAmount: 35 },
      { costAmount: Number.NaN, budgetAmount: 35 },
      { costAmount: Number.POSITIVE_INFINITY, budgetAmount: 35 },
    ];
    for (const payload of cases) {
      const parsed = parseBudgetCloudEvent(cloudEvent(payload));
      assert.equal(parsed.ok, false, JSON.stringify(payload));
    }
  });
});
