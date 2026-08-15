import { err, ok, type Result } from "neverthrow";
import {
  BadRequestError,
  JacklineError,
  type ToolHttpMethod,
} from "@jackline/shared";

export type OpenApiImportedTool = {
  name: string;
  description: string | null;
  httpMethod: ToolHttpMethod;
  pathTemplate: string;
  inputSchema: Record<string, unknown>;
};

type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
};

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
]);

function sanitizeToolName(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned || "operation";
}

function uniqueName(base: string, used: Set<string>): string {
  let candidate = sanitizeToolName(base);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let i = 2;
  while (used.has(`${candidate}_${i}`)) i += 1;
  const next = `${candidate}_${i}`;
  used.add(next);
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function resolveRef(
  root: Record<string, unknown>,
  node: unknown,
  depth = 0,
): unknown {
  if (depth > 8 || !isRecord(node) || typeof node["$ref"] !== "string") {
    return node;
  }
  const ref = node["$ref"];
  if (!ref.startsWith("#/")) return node;
  const parts = ref.slice(2).split("/");
  let cur: unknown = root;
  for (const part of parts) {
    if (!isRecord(cur) || !(part in cur)) return node;
    cur = cur[part];
  }
  return resolveRef(root, cur, depth + 1);
}

function paramSchema(
  root: Record<string, unknown>,
  param: Record<string, unknown>,
): JsonSchemaObject {
  const schema = isRecord(param["schema"])
    ? (resolveRef(root, param["schema"]) as JsonSchemaObject)
    : { type: "string" };
  const description =
    typeof param["description"] === "string"
      ? param["description"]
      : typeof schema.description === "string"
        ? schema.description
        : undefined;
  return description ? { ...schema, description } : { ...schema };
}

/**
 * Parse an OpenAPI 3.x JSON document into Jackline HTTP tool bindings.
 * Supports path/query params and JSON request bodies. Skips unsupported ops.
 */
export function importToolsFromOpenApi(
  document: unknown,
): Result<OpenApiImportedTool[], JacklineError> {
  if (!isRecord(document)) {
    return err(new BadRequestError("OpenAPI document must be a JSON object"));
  }

  const version =
    typeof document["openapi"] === "string"
      ? document["openapi"]
      : typeof document["swagger"] === "string"
        ? document["swagger"]
        : null;

  if (!version || !(version.startsWith("3.") || version.startsWith("2."))) {
    return err(
      new BadRequestError("Only OpenAPI 3.x (or Swagger 2) JSON is supported"),
    );
  }

  const paths = document["paths"];
  if (!isRecord(paths)) {
    return err(new BadRequestError("OpenAPI document has no paths object"));
  }

  const usedNames = new Set<string>();
  const tools: OpenApiImportedTool[] = [];

  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;

    for (const [methodKey, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(methodKey.toLowerCase())) continue;
      if (!isRecord(operation)) continue;

      const httpMethod = methodKey.toUpperCase() as ToolHttpMethod;
      const operationId =
        typeof operation["operationId"] === "string"
          ? operation["operationId"]
          : `${httpMethod}_${pathTemplate}`;
      const summary =
        typeof operation["summary"] === "string"
          ? operation["summary"]
          : typeof operation["description"] === "string"
            ? operation["description"]
            : null;

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      const parameters = Array.isArray(operation["parameters"])
        ? operation["parameters"]
        : [];
      const pathItemParams = Array.isArray(pathItem["parameters"])
        ? pathItem["parameters"]
        : [];

      for (const raw of [...pathItemParams, ...parameters]) {
        const resolved = resolveRef(document, raw);
        if (!isRecord(resolved)) continue;
        const name = resolved["name"];
        const location = resolved["in"];
        if (typeof name !== "string") continue;
        if (location !== "path" && location !== "query") continue;
        properties[name] = paramSchema(document, resolved);
        if (resolved["required"] === true || location === "path") {
          required.push(name);
        }
      }

      const requestBody = resolveRef(document, operation["requestBody"]);
      if (isRecord(requestBody)) {
        const content = requestBody["content"];
        if (isRecord(content)) {
          const json =
            content["application/json"] ??
            content["application/*+json"] ??
            Object.values(content)[0];
          if (isRecord(json)) {
            const bodySchema = resolveRef(document, json["schema"]);
            if (isRecord(bodySchema)) {
              if (
                bodySchema["type"] === "object" &&
                isRecord(bodySchema["properties"])
              ) {
                for (const [key, value] of Object.entries(
                  bodySchema["properties"],
                )) {
                  properties[key] = resolveRef(document, value);
                }
                if (Array.isArray(bodySchema["required"])) {
                  for (const key of bodySchema["required"]) {
                    if (typeof key === "string") required.push(key);
                  }
                }
              } else {
                properties["body"] = bodySchema;
                if (requestBody["required"] === true) required.push("body");
              }
            }
          }
        }
      }

      const inputSchema: Record<string, unknown> = {
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) {
        inputSchema["required"] = [...new Set(required)];
      }

      tools.push({
        name: uniqueName(operationId, usedNames),
        description: summary,
        httpMethod,
        pathTemplate,
        inputSchema,
      });
    }
  }

  if (tools.length === 0) {
    return err(
      new BadRequestError("OpenAPI document contained no importable operations"),
    );
  }

  return ok(tools);
}
