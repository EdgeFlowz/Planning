import { useCallback, useEffect, useState, type DragEvent } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCatalogueStore } from "../store/catalogueStore";
import { useEditorStore } from "../store/editorStore";
import { useInteractionStore } from "../store/interactionStore";
import { iconForEntry } from "../lib/catalogueDisplay";
import { canConnect } from "../lib/connectionRules";
import { portsForEntry } from "../lib/ports";

const CATEGORY_LABELS: Record<string, string> = {
  source: "Sources",
  transform: "Transforms",
  sink: "Sinks",
};

const CATEGORY_ORDER = ["source", "transform", "sink"];

const COLLAPSED_STORAGE_KEY = "node-palette-collapsed";

function loadCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function NodePalette() {
  const entries = useCatalogueStore((s) => s.entries);
  const status = useCatalogueStore((s) => s.status);
  const load = useCatalogueStore((s) => s.load);
  const addNode = useEditorStore((s) => s.addNode);
  const onConnect = useEditorStore((s) => s.onConnect);
  const setPaletteDragType = useInteractionStore((s) => s.setPaletteDragType);
  const clearInteraction = useInteractionStore((s) => s.clear);
  const { screenToFlowPosition } = useReactFlow();

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsedState);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      // ignore — persistence is a nice-to-have, not a requirement
    }
  }, [collapsed]);

  const toggleCategory = (category: string) => {
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const onDragStart = (event: DragEvent<HTMLElement>, type: string) => {
    event.dataTransfer.setData("application/pipeline-node-type", type);
    event.dataTransfer.effectAllowed = "move";
    // The canvas can't read dataTransfer during dragover, so it reads the type from here instead.
    setPaletteDragType(type);

    // The browser's default drag image is a washed-out screenshot of the whole palette row;
    // a compact chip reads much better against the canvas.
    const chip = event.currentTarget.querySelector(".node-palette-label");
    if (chip instanceof HTMLElement) {
      const ghost = chip.cloneNode(true) as HTMLElement;
      ghost.className = "node-drag-chip";
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 12);
      // Can't remove it synchronously — the browser snapshots it after this handler returns.
      setTimeout(() => ghost.remove(), 0);
    }
  };

  const onDragEnd = () => clearInteraction();

  /**
   * Click/Enter path: places the node at the centre of the viewport and wires it to the current
   * selection when that's legal. This is also what makes the palette usable from the keyboard —
   * the drag-only version had no keyboard equivalent at all.
   */
  const addAtViewportCentre = useCallback(
    (type: string) => {
      const canvas = document.querySelector(".canvas-wrapper");
      const rect = canvas?.getBoundingClientRect();
      const centre = screenToFlowPosition({
        x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
        y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
      });

      const selectedNodeId = useEditorStore.getState().selectedNodeId;
      const newId = addNode(type, centre);
      if (!selectedNodeId) return;

      const catalogue = useCatalogueStore.getState().entries;
      const ports = portsForEntry(catalogue.find((e) => e.type === type));
      // Read the graph back *after* addNode so the new node is present for the legality check.
      const { nodes, edges } = useEditorStore.getState();
      const ctx = { nodes, edges, entries: catalogue };

      // Try selected -> new first (the common "continue the chain" case), then new -> selected.
      const forward = { source: selectedNodeId, sourceHandle: null, target: newId, targetHandle: null };
      const backward = { source: newId, sourceHandle: null, target: selectedNodeId, targetHandle: null };

      if (ports.inputs.length === 1 && canConnect(forward, ctx).ok) onConnect(forward);
      else if (ports.outputs.length === 1 && canConnect(backward, ctx).ok) onConnect(backward);
    },
    [screenToFlowPosition, addNode, onConnect],
  );

  const q = query.trim().toLowerCase();
  const matchesQuery = (entry: { display_name: string; type: string }) =>
    !q || entry.display_name.toLowerCase().includes(q) || entry.type.toLowerCase().includes(q);

  const renderedCategories = CATEGORY_ORDER.map((category) => ({
    category,
    categoryEntries: entries.filter((e) => e.category === category && matchesQuery(e)),
  })).filter(({ categoryEntries }) => categoryEntries.length > 0);

  return (
    <aside className="node-palette">
      <h2>Nodes</h2>
      <p className="node-palette-hint">Drag onto the canvas, or click to add</p>
      {status === "error" && <p className="node-palette-hint">Couldn't load the node catalogue.</p>}

      <input
        type="text"
        className="node-palette-search"
        placeholder="Search nodes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {q && renderedCategories.length === 0 && <p className="node-palette-hint">No nodes match "{query}"</p>}

      {renderedCategories.map(({ category, categoryEntries }) => {
        const isCollapsed = q ? false : !!collapsed[category];

        return (
          <div key={category} className="node-palette-category">
            <button
              type="button"
              className="node-palette-category-label"
              onClick={() => toggleCategory(category)}
              aria-expanded={!isCollapsed}
            >
              <span className="node-palette-category-chevron">{isCollapsed ? "▸" : "▾"}</span>
              {CATEGORY_LABELS[category] ?? category}
            </button>
            {!isCollapsed &&
              categoryEntries.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  className="node-palette-item"
                  draggable
                  onDragStart={(e) => onDragStart(e, entry.type)}
                  onDragEnd={onDragEnd}
                  onClick={() => addAtViewportCentre(entry.type)}
                  title={
                    entry.implemented
                      ? "Drag onto the canvas, or click to add and connect"
                      : "No backend connector yet — the pipeline can be built, not run"
                  }
                >
                  <span className="node-palette-icon">{iconForEntry(entry)}</span>
                  <div>
                    <div className="node-palette-label">{entry.display_name}</div>
                    <div className="node-palette-description">
                      {entry.implemented ? entry.type : `${entry.type} — backend execution pending`}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        );
      })}
    </aside>
  );
}
