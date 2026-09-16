import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { useCatalogueStore } from "../store/catalogueStore";
import { parseCsvFile } from "../lib/csv";
import { getSchemaIssues } from "../lib/schemaValidation";
import { getOrderedParentIds, type GraphEdge } from "../lib/graph";
import { computeNodeOutput } from "../lib/transform";
import { labelForEntry } from "../lib/catalogueDisplay";
import { SchemaForm, type SchemaFormContext } from "./SchemaForm";
import type { PipelineNode } from "../types/pipeline";

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
  const catalogueEntries = useCatalogueStore((s) => s.entries);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const entry = selectedNode ? catalogueEntries.find((e) => e.type === selectedNode.data.nodeType) : undefined;

  const pipelineNodes: PipelineNode[] = useMemo(
    () => nodes.map((n) => ({ id: n.id, type: n.data.nodeType, config: n.data.config })),
    [nodes],
  );
  const graphEdges: GraphEdge[] = useMemo(
    () => edges.map((e) => ({ source: e.source, target: e.target, targetHandle: e.targetHandle })),
    [edges],
  );

  // Join is the one node shape config_schema can't describe (it needs two independent upstream
  // inputs, which is port topology, not config shape) — everything else here is generic.
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

  const formContext: SchemaFormContext = isJoin
    ? { columns: [...new Set([...joinInputs.leftColumns, ...joinInputs.rightColumns])], ...joinInputs }
    : { columns: upstreamColumns };

  const configJson = useMemo(() => JSON.stringify(selectedNode?.data.config ?? {}), [selectedNode]);
  const justSaved = useSavedIndicator(selectedNode?.id ?? "", configJson);
  const configIssues = useMemo(() => {
    if (!selectedNode || !entry) return [];
    return getSchemaIssues(entry.config_schema, selectedNode.data.config);
  }, [selectedNode, entry]);

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
        <h2>{labelForEntry(entry, data.nodeType)}</h2>
        <span className={`saved-badge${justSaved ? " visible" : ""}`} aria-live="polite">
          &#10003; Saved
        </span>
      </div>
      <div className="config-panel-id">{id}</div>

      {configIssues.length > 0 && (
        <div className="config-issues">
          {configIssues.map((message, i) => (
            <div className="config-issue" key={i}>
              &#9888; {message}
            </div>
          ))}
        </div>
      )}

      {!entry && (
        <div className="config-form">
          <p className="config-panel-hint">
            "{data.nodeType}" isn't in the node catalog (yet). Its configuration is shown read-only below.
          </p>
          <pre className="config-raw-json">{JSON.stringify(data.config, null, 2)}</pre>
        </div>
      )}

      {entry && <SchemaForm schema={entry.config_schema} config={data.config} onChange={setConfig} context={formContext} />}

      {data.nodeType === "source.csv" && (
        <div className="config-form">
          <label>
            Upload CSV for schema &amp; preview
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const table = await parseCsvFile(file);
                setSourceTable(id, table);
                const path = (data.config as { path?: string }).path;
                if (!path) setConfig({ ...data.config, path: file.name });
              }}
            />
          </label>
          {sourceTables[id] && <p className="config-form-note">CSV loaded — downstream nodes can now select columns.</p>}
        </div>
      )}

      <button className="danger-button" onClick={() => removeNode(id)}>
        Delete node
      </button>
    </aside>
  );
}
