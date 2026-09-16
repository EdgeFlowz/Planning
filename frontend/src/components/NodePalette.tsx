import { useEffect, type DragEvent } from "react";
import { useCatalogueStore } from "../store/catalogueStore";
import { iconForEntry } from "../lib/catalogueDisplay";

const CATEGORY_LABELS: Record<string, string> = {
  source: "Sources",
  transform: "Transforms",
  sink: "Sinks",
};

const CATEGORY_ORDER = ["source", "transform", "sink"];

export function NodePalette() {
  const entries = useCatalogueStore((s) => s.entries);
  const status = useCatalogueStore((s) => s.status);
  const load = useCatalogueStore((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  const onDragStart = (event: DragEvent<HTMLDivElement>, type: string) => {
    event.dataTransfer.setData("application/pipeline-node-type", type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="node-palette">
      <h2>Nodes</h2>
      <p className="node-palette-hint">Drag onto the canvas</p>
      {status === "error" && <p className="node-palette-hint">Couldn't load the node catalogue.</p>}

      {CATEGORY_ORDER.map((category) => {
        const categoryEntries = entries.filter((e) => e.category === category);
        if (categoryEntries.length === 0) return null;

        return (
          <div key={category} className="node-palette-category">
            <div className="node-palette-category-label">{CATEGORY_LABELS[category] ?? category}</div>
            {categoryEntries.map((entry) => (
              <div
                key={entry.type}
                className="node-palette-item"
                draggable
                onDragStart={(e) => onDragStart(e, entry.type)}
                title={entry.implemented ? undefined : "No backend connector yet — the pipeline can be built, not run"}
              >
                <span className="node-palette-icon">{iconForEntry(entry)}</span>
                <div>
                  <div className="node-palette-label">{entry.display_name}</div>
                  <div className="node-palette-description">
                    {entry.implemented ? entry.type : `${entry.type} — backend execution pending`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
