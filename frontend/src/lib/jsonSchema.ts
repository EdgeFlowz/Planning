/**
 * Small helpers for treating a node's `config_schema` (real JSON Schema from the backend
 * catalog, see backend/app/catalog.py) as the source of truth for the config editor: resolving
 * `$ref`s against the schema's own `$defs`, building a valid empty config from scratch, and
 * inspecting `oneOf`/`anyOf` branches generically.
 */

export type JsonSchema = Record<string, any>;

export function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (schema && typeof schema.$ref === "string") {
    const path = schema.$ref.replace(/^#\//, "").split("/");
    let node: any = root;
    for (const key of path) node = node?.[key];
    return node ? resolveSchema(node, root) : schema;
  }
  return schema ?? {};
}

/** The resolved branch schemas of a oneOf/anyOf field, or undefined if this isn't a union. */
export function unionBranches(schema: JsonSchema, root: JsonSchema): JsonSchema[] | undefined {
  const branches = schema.oneOf ?? schema.anyOf;
  if (!Array.isArray(branches)) return undefined;
  return branches.map((b: JsonSchema) => resolveSchema(b, root));
}

/**
 * A shared string property (conventionally "type") whose `const` value differs across every
 * branch of a union — i.e. a discriminated union like the expression grammar's
 * column/literal/binary_operation. Returns null for a plain nullable-type union (str | null, etc).
 */
export function discriminatorKey(branches: JsonSchema[]): string | null {
  if (branches.length < 2 || !branches.every((b) => b.type === "object" && b.properties)) return null;
  for (const key of Object.keys(branches[0].properties)) {
    if (branches.every((b) => typeof b.properties?.[key]?.const === "string")) {
      const values = branches.map((b) => b.properties[key].const);
      if (new Set(values).size === values.length) return key;
    }
  }
  return null;
}

function firstDefinedBranch(schema: JsonSchema, root: JsonSchema): JsonSchema | undefined {
  const branches = unionBranches(schema, root);
  if (!branches) return undefined;
  return branches.find((b) => b.type !== "null") ?? branches[0];
}

/**
 * Builds a config object that satisfies `schema` well enough to hand to the form: every
 * required field present with a type-appropriate empty value, every field with an explicit
 * schema default carrying that default. Mirrors what a human filling in the form from scratch
 * would start with.
 */
export function buildDefaultConfig(schema: JsonSchema, root: JsonSchema = schema): unknown {
  const resolved = resolveSchema(schema, root);

  if ("default" in resolved) return structuredClone(resolved.default);
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.enum) return resolved.enum[0];

  const branch = firstDefinedBranch(resolved, root);
  if (branch) return buildDefaultConfig(branch, root);

  switch (resolved.type) {
    case "object": {
      const obj: Record<string, unknown> = {};
      const required = new Set<string>(resolved.required ?? []);
      for (const [key, propSchema] of Object.entries<JsonSchema>(resolved.properties ?? {})) {
        const resolvedProp = resolveSchema(propSchema, root);
        if (required.has(key) || "default" in resolvedProp) {
          obj[key] = buildDefaultConfig(propSchema, root);
        }
      }
      return obj;
    }
    case "array":
      return [];
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

/** A short, generic "field: value" preview of a config for the node card / palette — not as
 * tailored as a hand-written per-type summary, but needs no per-type frontend code to stay
 * accurate as the backend catalog grows. */
export function summarizeConfig(schema: JsonSchema, config: Record<string, unknown>): string {
  if (!schema || Object.keys(schema).length === 0) return "no configurable fields";

  const parts: string[] = [];
  for (const [key, propSchema] of Object.entries<JsonSchema>(schema.properties ?? {})) {
    const resolved = resolveSchema(propSchema, schema);
    if (key === "type" && resolved.const !== undefined) continue;

    const value = (config as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;

    const rendered = Array.isArray(value)
      ? value.join(", ")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    parts.push(`${resolved.title ?? key}: ${rendered}`);
  }
  return parts.length ? parts.join(" · ") : "not configured";
}
