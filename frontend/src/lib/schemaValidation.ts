import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

// strict:false because the catalog schemas carry backend-only annotations (x-widget) ajv doesn't
// know about; they're valid JSON Schema, just outside ajv's "strict mode" vocabulary.
const ajv = new Ajv({ strict: false, allErrors: true });

const compiled = new WeakMap<object, ValidateFunction>();

function compiledValidator(schema: Record<string, unknown>): ValidateFunction {
  let validate = compiled.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  return validate;
}

/**
 * A oneOf/anyOf failure reports one error per non-matching branch, which reads as noise once a
 * config is even slightly wrong (see backend's discriminated Expression schema). Collapsing by
 * instancePath keeps the message that actually explains the failure and drops the redundant
 * per-branch detail.
 */
function summarizeErrors(errors: ErrorObject[]): string[] {
  const byPath = new Map<string, ErrorObject[]>();
  for (const err of errors) {
    if (err.keyword === "const") continue; // internal discriminator plumbing, never user-facing
    const list = byPath.get(err.instancePath) ?? [];
    list.push(err);
    byPath.set(err.instancePath, list);
  }

  const messages: string[] = [];
  for (const [path, group] of byPath) {
    const label = path ? path.replace(/^\//, "").replace(/\//g, ".") : "config";
    const union = group.find((e) => e.keyword === "oneOf" || e.keyword === "anyOf");
    if (union) {
      messages.push(`${label}: doesn't match any of the allowed shapes.`);
      continue;
    }
    for (const e of group) {
      if (e.keyword === "required") {
        const missing = (e.params as { missingProperty: string }).missingProperty;
        messages.push(`${label === "config" ? missing : `${label}.${missing}`} is required.`);
      } else {
        messages.push(`${label}: ${e.message}.`);
      }
    }
  }
  return messages;
}

/** Structural config issues per the node's own config_schema — required fields, enums, types. */
export function getSchemaIssues(schema: Record<string, unknown> | undefined, config: Record<string, unknown>): string[] {
  if (!schema || Object.keys(schema).length === 0) return [];
  const validate = compiledValidator(schema);
  return validate(config) ? [] : summarizeErrors(validate.errors ?? []);
}
