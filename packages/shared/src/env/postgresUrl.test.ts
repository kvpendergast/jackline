import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPostgresUrl, resolvePostgresUrl } from "./postgresUrl.js";

describe("buildPostgresUrl", () => {
  it("omits password segment when unset", () => {
    assert.equal(
      buildPostgresUrl({
        user: "postgres",
        host: "127.0.0.1",
        port: 5432,
        database: "jackline",
      }),
      "postgresql://postgres@127.0.0.1:5432/jackline",
    );
  });

  it("percent-encodes userinfo when a password is provided", () => {
    const url = buildPostgresUrl({
      user: "app",
      password: String.fromCharCode(112),
      host: "db.internal",
      database: "app",
    });
    assert.equal(url, "postgresql://app:p@db.internal:5432/app");
  });
});

describe("resolvePostgresUrl", () => {
  it("prefers DATABASE_URL", () => {
    assert.equal(
      resolvePostgresUrl({ DATABASE_URL: "postgresql://example" }),
      "postgresql://example",
    );
  });

  it("builds from POSTGRES_* when DATABASE_URL is absent", () => {
    assert.equal(
      resolvePostgresUrl({
        POSTGRES_USER: "postgres",
        POSTGRES_DB: "jackline",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5432",
      }),
      "postgresql://postgres@127.0.0.1:5432/jackline",
    );
  });
});
