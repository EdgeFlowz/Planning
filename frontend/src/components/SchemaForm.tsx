import { buildDefaultConfig, discriminatorKey, resolveSchema, unionBranches, type JsonSchema } from "../lib/jsonSchema";

/**
 * Columns available to "x-widget: column" fields. `columns` is the default list (a single-input
 * node's upstream output); `leftColumns`/`rightColumns` override it for a two-input node's
 * `left_on`/`right_on` fields (transform.join) — there's no way to express "which side" in JSON
 * Schema itself, so this is the one place the generic form still needs a field-name convention.
 */
export interface SchemaFormContext {
  columns: string[];
  leftColumns?: string[];
  rightColumns?: string[];
}

interface FieldProps {
  schema: JsonSchema;
  root: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  context: SchemaFormContext;
  fieldKey?: string;
}

export function SchemaForm({
  schema,
  config,
  onChange,
  context,
}: {
  schema: JsonSchema;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  context: SchemaFormContext;
}) {
  if (!schema || Object.keys(schema).length === 0) {
    return <p className="config-panel-hint">This node type has no configurable fields.</p>;
  }
  return (
    <div className="config-form">
      <ObjectFields schema={schema} root={schema} value={config} onChange={onChange as (v: unknown) => void} context={context} />
    </div>
  );
}

function ObjectFields({ schema, root, value, onChange, context }: FieldProps) {
  const resolved = resolveSchema(schema, root);
  const properties: Record<string, JsonSchema> = resolved.properties ?? {};
  const obj = (value as Record<string, unknown>) ?? {};

  return (
    <>
      {Object.entries(properties).map(([key, propSchema]) => {
        const resolvedProp = resolveSchema(propSchema, root);
        // The discriminator tag itself ("type": "column" / "literal" / ...) is set by choosing
        // the branch, not edited directly.
        if (key === "type" && resolvedProp.const !== undefined) return null;

        const label = resolvedProp.title ?? key;
        return (
          <label key={key} className="config-field">
            <span className="config-field-label">{label}</span>
            <FieldEditor
              schema={propSchema}
              root={root}
              value={obj[key]}
              onChange={(v) => onChange({ ...obj, [key]: v })}
              context={context}
              fieldKey={key}
            />
          </label>
        );
      })}
    </>
  );
}

function FieldEditor({ schema, root, value, onChange, context, fieldKey }: FieldProps) {
  const resolved = resolveSchema(schema, root);

  // Column-referencing fields need runtime data (the node's actual upstream columns) that no
  // schema can express — these `x-widget` extras are set on the backend's Pydantic fields
  // specifically so the generic form knows to resolve against `context` instead of free text.
  if (resolved["x-widget"] === "column") {
    return <ColumnWidget schema={resolved} root={root} value={value} onChange={onChange} context={context} fieldKey={fieldKey} />;
  }
  if (resolved["x-widget"] === "column-map") {
    return <ColumnMapWidget schema={resolved} root={root} value={value} onChange={onChange} context={context} />;
  }

  const branches = unionBranches(resolved, root);
  if (branches) {
    return <UnionField branches={branches} root={root} value={value} onChange={onChange} context={context} fieldKey={fieldKey} />;
  }

  if (resolved.enum) {
    return <EnumSelect options={resolved.enum} value={value} onChange={onChange} />;
  }

  switch (resolved.type) {
    case "boolean":
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "string":
      return <input type="text" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "integer":
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : 0}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
      );
    case "object":
      return (
        <div className="config-form-nested">
          <ObjectFields schema={resolved} root={root} value={value} onChange={onChange} context={context} />
        </div>
      );
    case "array":
      return <ArrayField schema={resolved} root={root} value={value} onChange={onChange} context={context} />;
    default:
      return <span className="config-panel-hint">Unsupported field type.</span>;
  }
}

/** Fields tagged x-widget: "column" — a single column reference, or a set of them. */
function ColumnWidget({ schema, root, value, onChange, context, fieldKey }: FieldProps) {
  const branches = unionBranches(schema, root);
  const branchTypes = branches?.map((b) => b.type) ?? [schema.type];
  const hasArray = branchTypes.includes("array");
  const hasScalar = branchTypes.includes("string");
  // A field offering both a single column and a list of columns (transform.join's on/left_on/
  // right_on) renders as the simpler single-select; one offering only a list (subset, group_by,
  // by, columns) renders as a checkbox list.
  const isArray = hasArray && !hasScalar;
  const isNullable = branchTypes.includes("null");

  const options =
    fieldKey === "left_on"
      ? (context.leftColumns ?? context.columns)
      : fieldKey === "right_on"
        ? (context.rightColumns ?? context.columns)
        : context.columns;

  if (options.length === 0) {
    return <p className="config-panel-hint">Connect an upstream node with data to choose columns.</p>;
  }

  if (isArray) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (col: string, checked: boolean) => {
      const next = checked ? [...selected, col] : selected.filter((c) => c !== col);
      onChange(next.length > 0 || !isNullable ? next : null);
    };
    return (
      <div className="config-checkbox-list">
        {options.map((col) => (
          <label className="checkbox-row" key={col}>
            <input type="checkbox" checked={selected.includes(col)} onChange={(e) => toggle(col, e.target.checked)} />
            {col}
          </label>
        ))}
      </div>
    );
  }

  const current = typeof value === "string" ? value : "";
  return (
    <select value={current} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
      <option value="">choose column</option>
      {options.map((col) => (
        <option key={col} value={col}>
          {col}
        </option>
      ))}
    </select>
  );
}

/** dict[str, V] fields tagged x-widget: "column-map" — one row per upstream column (rename's
 * new-name mapping, cast's per-column target type). */
function ColumnMapWidget({ schema, root, value, onChange, context }: FieldProps) {
  const valueSchema = resolveSchema(schema.additionalProperties ?? { type: "string" }, root);
  const map = (value as Record<string, string>) ?? {};

  if (context.columns.length === 0) {
    return <p className="config-panel-hint">Connect an upstream node with data to configure this.</p>;
  }

  const setValue = (col: string, v: string) => {
    const next = { ...map };
    if (v === "") delete next[col];
    else next[col] = v;
    onChange(next);
  };

  return (
    <div className="config-form-list">
      {context.columns.map((col) => (
        <label className="config-form-row" key={col}>
          <span className="sort-column-name">{col}</span>
          {valueSchema.enum ? (
            <select value={map[col] ?? ""} onChange={(e) => setValue(col, e.target.value)}>
              <option value="">no change</option>
              {valueSchema.enum.map((opt: string) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" placeholder={col} value={map[col] ?? ""} onChange={(e) => setValue(col, e.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

function pickRenderBranch(branches: JsonSchema[], value: unknown): JsonSchema {
  const nonNull = branches.filter((b) => b.type !== "null");
  const byValueType = nonNull.find((b) => {
    if (typeof value === "boolean") return b.type === "boolean";
    if (typeof value === "string") return b.type === "string";
    if (typeof value === "number") return b.type === "number" || b.type === "integer";
    if (Array.isArray(value)) return b.type === "array";
    if (value && typeof value === "object") return b.type === "object";
    return false;
  });
  return byValueType ?? nonNull[0] ?? branches[0];
}

/** oneOf/anyOf fields without an x-widget: either a discriminated union (the expression grammar)
 * or a plain "could be one of a few JS types" union (e.g. a literal's value, or a bool-or-per-item
 * list flag) — rendered as whichever branch best matches the value already there. */
function UnionField({
  branches,
  root,
  value,
  onChange,
  context,
  fieldKey,
}: {
  branches: JsonSchema[];
  root: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  context: SchemaFormContext;
  fieldKey?: string;
}) {
  const nonNull = branches.filter((b) => b.type !== "null");
  if (nonNull.length === 0) return null;

  const discKey = discriminatorKey(nonNull);
  if (discKey) {
    const currentTag = (value as Record<string, unknown> | undefined)?.[discKey] as string | undefined;
    const activeBranch = nonNull.find((b) => b.properties[discKey].const === currentTag) ?? nonNull[0];

    const setTag = (tag: string) => {
      const branch = nonNull.find((b) => b.properties[discKey].const === tag);
      if (branch) onChange(buildDefaultConfig(branch, root));
    };

    return (
      <div className="config-form-union">
        <select value={activeBranch.properties[discKey].const} onChange={(e) => setTag(e.target.value)}>
          {nonNull.map((b) => (
            <option key={b.properties[discKey].const} value={b.properties[discKey].const}>
              {b.title ?? b.properties[discKey].const}
            </option>
          ))}
        </select>
        <ObjectFields schema={activeBranch} root={root} value={value} onChange={onChange} context={context} />
      </div>
    );
  }

  const branch = pickRenderBranch(nonNull, value);
  return <FieldEditor schema={branch} root={root} value={value} onChange={onChange} context={context} fieldKey={fieldKey} />;
}

function EnumSelect({ options, value, onChange }: { options: unknown[]; value: unknown; onChange: (v: unknown) => void }) {
  const current = value === undefined || value === null ? String(options[0]) : String(value);
  return (
    <select value={current} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => (
        <option key={String(opt)} value={String(opt)}>
          {String(opt)}
        </option>
      ))}
    </select>
  );
}

/** Repeatable rows for array-of-object fields (aggregate's aggregations, expression's columns). */
function ArrayField({ schema, root, value, onChange, context }: FieldProps) {
  const itemSchema = resolveSchema(schema.items ?? { type: "string" }, root);
  const list = Array.isArray(value) ? value : [];

  const updateItem = (i: number, v: unknown) => onChange(list.map((item, idx) => (idx === i ? v : item)));
  const removeItem = (i: number) => onChange(list.filter((_, idx) => idx !== i));
  const addItem = () => onChange([...list, buildDefaultConfig(itemSchema, root)]);

  return (
    <div className="config-form-list">
      {list.map((item, i) => (
        <div className="config-form-row config-form-row-bordered" key={i}>
          <div className="config-form-row-body">
            {itemSchema.type === "object" ? (
              <ObjectFields schema={itemSchema} root={root} value={item} onChange={(v) => updateItem(i, v)} context={context} />
            ) : (
              <FieldEditor schema={itemSchema} root={root} value={item} onChange={(v) => updateItem(i, v)} context={context} />
            )}
          </div>
          <button type="button" className="remove-row-button" aria-label="Remove" onClick={() => removeItem(i)}>
            &#10005;
          </button>
        </div>
      ))}
      <button type="button" onClick={addItem}>
        + Add
      </button>
    </div>
  );
}
