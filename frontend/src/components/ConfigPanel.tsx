import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useEditorStore } from "../store/editorStore";
import { parseCsvFile } from "../lib/csv";
import { getNodeConfigIssues } from "../lib/configValidation";
import { getOrderedParentIds, type GraphEdge } from "../lib/graph";
import { computeNodeOutput } from "../lib/transform";
import { isKnownNodeType, labelForType } from "../types/pipeline";
import type {
  AggregateConfig,
  AggregationFunction,
  AggregationSpec,
  BinaryExpression,
  CastConfig,
  DeduplicateConfig,
  DeduplicateKeep,
  ExpressionColumnSpec,
  ExpressionConfig,
  ExpressionOperand,
  FilterConfig,
  FilterOperator,
  JoinConfig,
  JoinHow,
  PipelineNode,
  RenameConfig,
  SelectConfig,
  SortConfig,
  SourceCsvConfig,
} from "../types/pipeline";

const FILTER_OPERATORS: FilterOperator[] = ["==", "!=", ">", ">=", "<", "<=", "contains"];
const CAST_TYPES = ["string", "int", "float", "boolean", "date"];
const JOIN_HOW_OPTIONS: JoinHow[] = ["inner", "left", "right", "full", "semi", "anti", "cross"];
const AGGREGATION_FUNCTIONS: AggregationFunction[] = [
  "sum",
  "mean",
  "min",
  "max",
  "count",
  "median",
  "std",
  "n_unique",
  "first",
  "last",
];
const DEDUPLICATE_KEEP_OPTIONS: DeduplicateKeep[] = ["first", "last", "any", "none"];
const EXPRESSION_OPERATORS: BinaryExpression["operator"][] = ["+", "-", "*", "/", "concat"];

/**
 * Every edit already saves instantly to the store — there's no separate save step — but nothing on
 * screen said so. This flashes a "Saved" badge whenever the selected node's config actually changes,
 * and stays silent when only the selection itself changes (switching nodes shouldn't flash it).
 */
function useSavedIndicator(nodeId: string, configJson: string): boolean {
  const [justSaved, setJustSaved] = useState(false);
  const lastNodeId = useRef<string | null>(null);
  const lastConfig = useRef<string | null>(null);

  useEffect(() => {
    if (lastNodeId.current !== nodeId) {
      lastNodeId.current = nodeId;
      lastConfig.current = configJson;
      setJustSaved(false);
      return;
    }
    if (lastConfig.current !== configJson) {
      lastConfig.current = configJson;
      setJustSaved(true);
      const timer = setTimeout(() => setJustSaved(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [nodeId, configJson]);

  return justSaved;
}

export function ConfigPanel() {
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const updateNodeConfig = useEditorStore((s) => s.updateNodeConfig);
  const removeNode = useEditorStore((s) => s.removeNode);
  const sourceTables = useEditorStore((s) => s.sourceTables);
  const setSourceTable = useEditorStore((s) => s.setSourceTable);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  const pipelineNodes: PipelineNode[] = useMemo(
    () => nodes.map((n) => ({ id: n.id, type: n.data.nodeType, config: n.data.config })),
    [nodes],
  );
  const graphEdges: GraphEdge[] = useMemo(
    () => edges.map((e) => ({ source: e.source, target: e.target, targetHandle: e.targetHandle })),
    [edges],
  );

  const isJoin = selectedNode?.data.nodeType === "transform.join";

  const upstreamColumns = useMemo(() => {
    if (!selectedNode || isJoin) return [];
    const [parentId] = getOrderedParentIds(selectedNode.id, graphEdges);
    if (!parentId) return [];
    return computeNodeOutput(parentId, pipelineNodes, graphEdges, sourceTables)?.columns ?? [];
  }, [selectedNode, isJoin, pipelineNodes, graphEdges, sourceTables]);

  const joinInputs = useMemo(() => {
    if (!selectedNode || !isJoin) return { leftColumns: [] as string[], rightColumns: [] as string[] };
    const [leftId, rightId] = getOrderedParentIds(selectedNode.id, graphEdges);
    const leftColumns = leftId ? (computeNodeOutput(leftId, pipelineNodes, graphEdges, sourceTables)?.columns ?? []) : [];
    const rightColumns = rightId
      ? (computeNodeOutput(rightId, pipelineNodes, graphEdges, sourceTables)?.columns ?? [])
      : [];
    return { leftColumns, rightColumns };
  }, [selectedNode, isJoin, pipelineNodes, graphEdges, sourceTables]);

  const known = selectedNode ? isKnownNodeType(selectedNode.data.nodeType) : false;
  const configJson = useMemo(() => JSON.stringify(selectedNode?.data.config ?? {}), [selectedNode]);
  const justSaved = useSavedIndicator(selectedNode?.id ?? "", configJson);
  const configIssues = useMemo(() => {
    if (!selectedNode || !known) return [];
    return getNodeConfigIssues(selectedNode.data.nodeType, selectedNode.data.config);
  }, [selectedNode, known]);

  if (!selectedNode) {
    return (
      <aside className="config-panel">
        <h2>Configuration</h2>
        <p className="config-panel-hint">Select a node to configure it.</p>
      </aside>
    );
  }

  const { id, data } = selectedNode;
  const setConfig = (config: Record<string, unknown>) => updateNodeConfig(id, config);

  return (
    <aside className="config-panel">
      <div className="config-panel-header-row">
        <h2>{labelForType(data.nodeType)}</h2>
        <span className={`saved-badge${justSaved ? " visible" : ""}`} aria-live="polite">
          &#10003; Saved
        </span>
      </div>
      <div className="config-panel-id">{id}</div>

      {known && configIssues.length > 0 && (
        <div className="config-issues">
          {configIssues.map((message, i) => (
            <div className="config-issue" key={i}>
              &#9888; {message}
            </div>
          ))}
        </div>
      )}

      {!known && (
        <div className="config-form">
          <p className="config-panel-hint">
            This node type isn't supported by the editor yet. Its configuration is shown read-only below.
          </p>
          <pre className="config-raw-json">{JSON.stringify(data.config, null, 2)}</pre>
        </div>
      )}

      {data.nodeType === "source.csv" && (
        <SourceCsvForm
          config={data.config as unknown as SourceCsvConfig}
          onChange={setConfig}
          onFile={async (file) => {
            const table = await parseCsvFile(file);
            setSourceTable(id, table);
            setConfig({
              ...(data.config as unknown as SourceCsvConfig),
              path: (data.config as unknown as SourceCsvConfig).path || file.name,
            });
          }}
          hasData={Boolean(sourceTables[id])}
        />
      )}

      {data.nodeType === "transform.select" && (
        <ColumnCheckboxForm
          available={upstreamColumns}
          selected={(data.config as unknown as SelectConfig).columns ?? []}
          onChange={(columns) => setConfig({ columns })}
          emptyHint="Connect this node to an upstream source with data to choose columns."
        />
      )}

      {data.nodeType === "transform.filter" && (
        <FilterForm available={upstreamColumns} config={data.config as unknown as FilterConfig} onChange={setConfig} />
      )}

      {data.nodeType === "transform.rename" && (
        <RenameForm available={upstreamColumns} config={data.config as unknown as RenameConfig} onChange={setConfig} />
      )}

      {data.nodeType === "transform.cast" && (
        <CastForm available={upstreamColumns} config={data.config as unknown as CastConfig} onChange={setConfig} />
      )}

      {data.nodeType === "transform.join" && (
        <JoinForm
          leftColumns={joinInputs.leftColumns}
          rightColumns={joinInputs.rightColumns}
          config={data.config as unknown as JoinConfig}
          onChange={setConfig}
        />
      )}

      {data.nodeType === "transform.aggregate" && (
        <AggregateForm available={upstreamColumns} config={data.config as unknown as AggregateConfig} onChange={setConfig} />
      )}

      {data.nodeType === "transform.sort" && (
        <SortForm available={upstreamColumns} config={data.config as unknown as SortConfig} onChange={setConfig} />
      )}

      {data.nodeType === "transform.deduplicate" && (
        <DeduplicateForm
          available={upstreamColumns}
          config={data.config as unknown as DeduplicateConfig}
          onChange={setConfig}
        />
      )}

      {data.nodeType === "transform.expression" && (
        <ExpressionForm
          available={upstreamColumns}
          config={data.config as unknown as ExpressionConfig}
          onChange={setConfig}
        />
      )}

      <button className="danger-button" onClick={() => removeNode(id)}>
        Delete node
      </button>
    </aside>
  );
}

function SourceCsvForm({
  config,
  onChange,
  onFile,
  hasData,
}: {
  config: SourceCsvConfig;
  onChange: (c: Record<string, unknown>) => void;
  onFile: (file: File) => void;
  hasData: boolean;
}) {
  return (
    <div className="config-form">
      <label>
        Path (used at execution time)
        <input
          type="text"
          value={config.path}
          placeholder="example_data/sales.csv"
          className={config.path.trim() === "" ? "input-invalid" : undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...config, path: e.target.value })}
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={config.has_header}
          onChange={(e) => onChange({ ...config, has_header: e.target.checked })}
        />
        Has header row
      </label>
      <label>
        Upload CSV for schema &amp; preview
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
      {hasData && <p className="config-form-note">CSV loaded — downstream nodes can now select columns.</p>}
    </div>
  );
}

function ColumnCheckboxForm({
  available,
  selected,
  onChange,
  emptyHint,
}: {
  available: string[];
  selected: string[];
  onChange: (columns: string[]) => void;
  emptyHint: string;
}) {
  if (available.length === 0) {
    return <p className="config-panel-hint">{emptyHint}</p>;
  }

  const toggle = (column: string, checked: boolean) => {
    if (checked) {
      onChange([...available.filter((c) => selected.includes(c) || c === column)]);
    } else {
      onChange(selected.filter((c) => c !== column));
    }
  };

  return (
    <div className="config-form">
      {available.map((column) => (
        <label className="checkbox-row" key={column}>
          <input type="checkbox" checked={selected.includes(column)} onChange={(e) => toggle(column, e.target.checked)} />
          {column}
        </label>
      ))}
    </div>
  );
}

function FilterForm({
  available,
  config,
  onChange,
}: {
  available: string[];
  config: FilterConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  return (
    <div className="config-form">
      <label>
        Column
        <select
          value={config.column}
          className={config.column === "" ? "input-invalid" : undefined}
          onChange={(e) => onChange({ ...config, column: e.target.value })}
        >
          <option value="">Select a column</option>
          {available.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Operator
        <select value={config.operator} onChange={(e) => onChange({ ...config, operator: e.target.value as FilterOperator })}>
          {FILTER_OPERATORS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value
        <input
          type="text"
          value={config.value}
          className={config.value.trim() === "" ? "input-invalid" : undefined}
          onChange={(e) => onChange({ ...config, value: e.target.value })}
        />
      </label>
    </div>
  );
}

function RenameForm({
  available,
  config,
  onChange,
}: {
  available: string[];
  config: RenameConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  if (available.length === 0) {
    return <p className="config-panel-hint">Connect this node to an upstream source with data to rename columns.</p>;
  }

  const setMapping = (original: string, next: string) => {
    const mapping = { ...(config.mapping ?? {}) };
    if (!next || next === original) {
      delete mapping[original];
    } else {
      mapping[original] = next;
    }
    onChange({ mapping });
  };

  return (
    <div className="config-form">
      {available.map((column) => (
        <label key={column}>
          {column}
          <input type="text" value={config.mapping?.[column] ?? column} onChange={(e) => setMapping(column, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

function CastForm({
  available,
  config,
  onChange,
}: {
  available: string[];
  config: CastConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  if (available.length === 0) {
    return <p className="config-panel-hint">Connect this node to an upstream source with data to cast columns.</p>;
  }

  const columns = config.columns ?? {};
  const setType = (col: string, type: string) => {
    const next = { ...columns };
    if (!type) delete next[col];
    else next[col] = type;
    onChange({ columns: next });
  };

  return (
    <div className="config-form">
      {available.map((column) => (
        <label key={column}>
          {column}
          <select value={columns[column] ?? ""} onChange={(e) => setType(column, e.target.value)}>
            <option value="">no change</option>
            {CAST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function JoinForm({
  leftColumns,
  rightColumns,
  config,
  onChange,
}: {
  leftColumns: string[];
  rightColumns: string[];
  config: JoinConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const mode: "same" | "different" = config.on ? "same" : "different";

  return (
    <div className="config-form">
      <label>
        Join type
        <select value={config.how} onChange={(e) => onChange({ ...config, how: e.target.value as JoinHow })}>
          {JOIN_HOW_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>

      {config.how !== "cross" && (
        <>
          <label>
            Key mode
            <select
              value={mode}
              onChange={(e) => {
                if (e.target.value === "same") {
                  onChange({ ...config, on: leftColumns[0] ?? "", left_on: null, right_on: null });
                } else {
                  onChange({ ...config, on: null, left_on: leftColumns[0] ?? "", right_on: rightColumns[0] ?? "" });
                }
              }}
            >
              <option value="same">Same column name on both sides</option>
              <option value="different">Different column names</option>
            </select>
          </label>

          {mode === "same" ? (
            <label>
              Join column
              <select
                value={typeof config.on === "string" ? config.on : ""}
                onChange={(e) => onChange({ ...config, on: e.target.value })}
              >
                {leftColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Left column
                <select
                  value={typeof config.left_on === "string" ? config.left_on : ""}
                  onChange={(e) => onChange({ ...config, left_on: e.target.value })}
                >
                  {leftColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Right column
                <select
                  value={typeof config.right_on === "string" ? config.right_on : ""}
                  onChange={(e) => onChange({ ...config, right_on: e.target.value })}
                >
                  {rightColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}

      <p className="config-panel-hint">
        Left input ({leftColumns.length ? leftColumns.join(", ") : "not connected"})
        <br />
        Right input ({rightColumns.length ? rightColumns.join(", ") : "not connected"})
      </p>
    </div>
  );
}

function AggregateForm({
  available,
  config,
  onChange,
}: {
  available: string[];
  config: AggregateConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const groupBy = config.group_by ?? [];
  const aggregations = config.aggregations ?? [];

  const toggleGroupBy = (col: string, checked: boolean) => {
    onChange({ ...config, group_by: checked ? [...groupBy, col] : groupBy.filter((c) => c !== col) });
  };

  const updateAgg = (index: number, patch: Partial<AggregationSpec>) => {
    onChange({ ...config, aggregations: aggregations.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  };

  const addAgg = () => {
    onChange({
      ...config,
      aggregations: [...aggregations, { column: available[0] ?? "", function: "sum" as AggregationFunction, alias: "" }],
    });
  };

  const removeAgg = (index: number) => {
    onChange({ ...config, aggregations: aggregations.filter((_, i) => i !== index) });
  };

  if (available.length === 0) {
    return <p className="config-panel-hint">Connect this node to an upstream source with data to aggregate.</p>;
  }

  return (
    <div className="config-form">
      <div className="config-form-subhead">Group by</div>
      {available.map((col) => (
        <label className="checkbox-row" key={col}>
          <input type="checkbox" checked={groupBy.includes(col)} onChange={(e) => toggleGroupBy(col, e.target.checked)} />
          {col}
        </label>
      ))}

      <div className="config-form-subhead">Aggregations ({aggregations.length})</div>
      {aggregations.length > 0 && (
        <p className="config-form-list-hint">Each row below is saved immediately — use &#10005; to remove one.</p>
      )}
      {aggregations.map((agg, i) => (
        <div className="config-form-row" key={i}>
          <select value={agg.column} onChange={(e) => updateAgg(i, { column: e.target.value })}>
            {available.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={agg.function} onChange={(e) => updateAgg(i, { function: e.target.value as AggregationFunction })}>
            {AGGREGATION_FUNCTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="alias"
            value={agg.alias ?? ""}
            onChange={(e) => updateAgg(i, { alias: e.target.value })}
          />
          <button
            type="button"
            className="remove-row-button"
            title="Remove this aggregation"
            aria-label="Remove this aggregation"
            onClick={() => removeAgg(i)}
          >
            &#10005;
          </button>
        </div>
      ))}
      <button type="button" onClick={addAgg}>
        + Add aggregation
      </button>
    </div>
  );
}

function SortForm({
  available,
  config,
  onChange,
}: {
  available: string[];
  config: SortConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const by = config.by ?? [];
  const descending = config.descending ?? false;
  const descArr = Array.isArray(descending) ? descending : by.map(() => descending);

  const addColumn = (col: string) => {
    if (!col || by.includes(col)) return;
    onChange({ ...config, by: [...by, col], descending: [...descArr, false] });
  };
  const removeColumn = (index: number) => {
    onChange({ ...config, by: by.filter((_, i) => i !== index), descending: descArr.filter((_, i) => i !== index) });
  };
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= by.length) return;
    const nextBy = [...by];
    const nextDesc = [...descArr];
    [nextBy[index], nextBy[target]] = [nextBy[target], nextBy[index]];
    [nextDesc[index], nextDesc[target]] = [nextDesc[target], nextDesc[index]];
    onChange({ ...config, by: nextBy, descending: nextDesc });
  };
  const toggleDesc = (index: number, checked: boolean) => {
    const next = [...descArr];
    next[index] = checked;
    onChange({ ...config, descending: next });
  };

  const remaining = available.filter((c) => !by.includes(c));

  if (available.length === 0) {
    return <p className="config-panel-hint">Connect this node to an upstream source with data to sort.</p>;
  }

  return (
    <div className="config-form">
      <div className="config-form-subhead">Sort by ({by.length})</div>
      {by.length > 0 && (
        <p className="config-form-list-hint">Each row below is saved immediately — use &#10005; to remove one.</p>
      )}
      {by.map((col, i) => (
        <div className="config-form-row" key={col}>
          <span className="sort-column-name">
            {i + 1}. {col}
          </span>
          <label className="checkbox-row">
            <input type="checkbox" checked={descArr[i] ?? false} onChange={(e) => toggleDesc(i, e.target.checked)} />
            desc
          </label>
          <button type="button" title="Move up" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
            &#8593;
          </button>
          <button
            type="button"
            title="Move down"
            aria-label="Move down"
            onClick={() => move(i, 1)}
            disabled={i === by.length - 1}
          >
            &#8595;
          </button>
          <button
            type="button"
            className="remove-row-button"
            title="Remove this sort column"
            aria-label="Remove this sort column"
            onClick={() => removeColumn(i)}
          >
            &#10005;
          </button>
        </div>
      ))}
      {remaining.length > 0 && (
        <select value="" onChange={(e) => addColumn(e.target.value)}>
          <option value="">+ Add sort column</option>
          {remaining.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function DeduplicateForm({
  available,
  config,
  onChange,
}: {
  available: string[];
  config: DeduplicateConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  if (available.length === 0) {
    return <p className="config-panel-hint">Connect this node to an upstream source with data to deduplicate.</p>;
  }

  const subset = config.subset ?? [];
  const toggle = (col: string, checked: boolean) => {
    const next = checked ? [...subset, col] : subset.filter((c) => c !== col);
    onChange({ ...config, subset: next.length ? next : null });
  };

  return (
    <div className="config-form">
      <div className="config-form-subhead">Match on (none selected = all columns)</div>
      {available.map((col) => (
        <label className="checkbox-row" key={col}>
          <input type="checkbox" checked={subset.includes(col)} onChange={(e) => toggle(col, e.target.checked)} />
          {col}
        </label>
      ))}
      <label>
        Keep
        <select value={config.keep} onChange={(e) => onChange({ ...config, keep: e.target.value as DeduplicateKeep })}>
          {DEDUPLICATE_KEEP_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function OperandInput({
  available,
  operand,
  onChange,
}: {
  available: string[];
  operand: ExpressionOperand;
  onChange: (o: ExpressionOperand) => void;
}) {
  return (
    <span className="operand-input">
      <select
        value={operand.type}
        onChange={(e) =>
          onChange(
            e.target.value === "column" ? { type: "column", name: available[0] ?? "" } : { type: "literal", value: "" },
          )
        }
      >
        <option value="column">column</option>
        <option value="literal">value</option>
      </select>
      {operand.type === "column" ? (
        <select value={operand.name} onChange={(e) => onChange({ type: "column", name: e.target.value })}>
          {available.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input type="text" value={operand.value} onChange={(e) => onChange({ type: "literal", value: e.target.value })} />
      )}
    </span>
  );
}

function ExpressionForm({
  available,
  config,
  onChange,
}: {
  available: string[];
  config: ExpressionConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const columns = config.columns ?? [];

  const update = (i: number, patch: Partial<ExpressionColumnSpec>) => {
    onChange({ columns: columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  };
  const updateExpr = (i: number, patch: Partial<BinaryExpression>) => {
    update(i, { expression: { ...columns[i].expression, ...patch } });
  };
  const add = () => {
    onChange({
      columns: [
        ...columns,
        {
          alias: "",
          expression: {
            type: "binary_operation",
            operator: "+",
            left: { type: "column", name: available[0] ?? "" },
            right: { type: "literal", value: "" },
          },
        },
      ],
    });
  };
  const remove = (i: number) => onChange({ columns: columns.filter((_, idx) => idx !== i) });

  if (available.length === 0) {
    return <p className="config-panel-hint">Connect this node to an upstream source with data to add calculations.</p>;
  }

  const aliasCounts = columns.reduce<Record<string, number>>((acc, c) => {
    const key = c.alias.trim();
    if (key) acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="config-form">
      <div className="config-form-subhead">Calculated columns ({columns.length})</div>
      {columns.length > 0 && (
        <p className="config-form-list-hint">
          Each row below is already added to this node — use &#10005; to remove one. Click "+ Add calculated column" only
          to create another.
        </p>
      )}
      {columns.map((spec, i) => {
        const trimmedAlias = spec.alias.trim();
        const invalidAlias = trimmedAlias === "" || aliasCounts[trimmedAlias] > 1;
        return (
          <div className="expression-row" key={i}>
            <input
              type="text"
              placeholder="new column name"
              value={spec.alias}
              className={invalidAlias ? "input-invalid" : undefined}
              onChange={(e) => update(i, { alias: e.target.value })}
            />
            <OperandInput available={available} operand={spec.expression.left} onChange={(left) => updateExpr(i, { left })} />
            <select
              value={spec.expression.operator}
              onChange={(e) => updateExpr(i, { operator: e.target.value as BinaryExpression["operator"] })}
            >
              {EXPRESSION_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <OperandInput available={available} operand={spec.expression.right} onChange={(right) => updateExpr(i, { right })} />
            <button
              type="button"
              className="remove-row-button"
              title="Remove this calculated column"
              aria-label="Remove this calculated column"
              onClick={() => remove(i)}
            >
              &#10005;
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add}>
        + Add calculated column
      </button>
    </div>
  );
}
