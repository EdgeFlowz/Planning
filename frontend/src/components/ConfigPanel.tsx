import { useMemo, type ChangeEvent } from "react";
import { useEditorStore } from "../store/editorStore";
import { parseCsvFile } from "../lib/csv";
import { getAncestorChain } from "../lib/graph";
import { computeChainOutput } from "../lib/transform";
import { NODE_TYPE_LABELS } from "../types/pipeline";
import type {
  DropConfig,
  FilterConfig,
  FilterOperator,
  PipelineEdge,
  PipelineNode,
  RenameConfig,
  SelectConfig,
  SourceCsvConfig,
} from "../types/pipeline";

const FILTER_OPERATORS: FilterOperator[] = ["==", "!=", ">", ">=", "<", "<=", "contains"];

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
  const pipelineEdges: PipelineEdge[] = useMemo(
    () => edges.map((e) => ({ source: e.source, target: e.target })),
    [edges],
  );

  const upstreamColumns = useMemo(() => {
    if (!selectedNode) return [];
    const chain = getAncestorChain(selectedNode.id, pipelineNodes, pipelineEdges);
    const parentChain = chain.slice(0, -1);
    const table = computeChainOutput(parentChain, sourceTables);
    return table?.columns ?? [];
  }, [selectedNode, pipelineNodes, pipelineEdges, sourceTables]);

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
      <h2>{NODE_TYPE_LABELS[data.nodeType]}</h2>
      <div className="config-panel-id">{id}</div>

      {data.nodeType === "source.csv" && (
        <SourceCsvForm
          config={data.config as unknown as SourceCsvConfig}
          onChange={setConfig}
          onFile={async (file) => {
            const table = await parseCsvFile(file);
            setSourceTable(id, table);
            setConfig({ ...(data.config as unknown as SourceCsvConfig), path: (data.config as unknown as SourceCsvConfig).path || file.name });
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

      {data.nodeType === "transform.drop" && (
        <ColumnCheckboxForm
          available={upstreamColumns}
          selected={(data.config as unknown as DropConfig).columns ?? []}
          onChange={(columns) => setConfig({ columns })}
          emptyHint="Connect this node to an upstream source with data to choose columns."
        />
      )}

      {data.nodeType === "transform.filter" && (
        <FilterForm
          available={upstreamColumns}
          config={data.config as unknown as FilterConfig}
          onChange={setConfig}
        />
      )}

      {data.nodeType === "transform.rename" && (
        <RenameForm
          available={upstreamColumns}
          config={data.config as unknown as RenameConfig}
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
          <input
            type="checkbox"
            checked={selected.includes(column)}
            onChange={(e) => toggle(column, e.target.checked)}
          />
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
        <select
          value={config.operator}
          onChange={(e) => onChange({ ...config, operator: e.target.value as FilterOperator })}
        >
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
          <input
            type="text"
            value={config.mapping?.[column] ?? column}
            onChange={(e) => setMapping(column, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
