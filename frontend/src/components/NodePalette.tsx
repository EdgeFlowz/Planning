import { useEffect, type DragEvent } from "react";
import { useCatalogueStore } from "../store/catalogueStore";
import { isKnownNodeType } from "../types/pipeline";
import type { NodeType } from "../types/pipeline";

const ICONS: Record<string, string> = {
  "source.csv": "\u{1F4C4}",
  "source.parquet": "\u{1F4C4}",
  "source.sql": "\u{1F5C3}️",
  "transform.select": "\u{1F3AF}",
  "transform.filter": "\u{1F50D}",
  "transform.rename": "✏️",
  "transform.cast": "\u{1F501}",
  "transform.join": "\u{1F517}",
  "transform.aggregate": "Σ",
  "transform.sort": "↕️",
  "transform.deduplicate": "\u{1F9F9}",
  "transform.expression": "\u{1F9EE}",
  "sink.csv": "\u{1F4BE}",
  "sink.parquet": "\u{1F4BE}",
  "sink.sql": "\u{1F5C3}️",
};

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

  const onDragStart = (event: DragEvent<HTMLDivElement>, type: NodeType) => {
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
            {categoryEntries.map((entry) => {
              // "usable" means the editor knows how to build/configure this node type. The catalogue's
              // own `implemented` flag tracks backend execution readiness (a real I/O connector, etc.),
              // which is a separate concern — you can still define a pipeline before it can be run.
              const usable = isKnownNodeType(entry.type);
              return (
                <div
                  key={entry.type}
                  className={`node-palette-item${usable ? "" : " disabled"}`}
                  draggable={usable}
                  onDragStart={usable ? (e) => onDragStart(e, entry.type as NodeType) : undefined}
                  title={usable ? undefined : "Not yet supported by the editor"}
                >
                  <span className="node-palette-icon">{ICONS[entry.type] ?? "\u{1F9E9}"}</span>
                  <div>
                    <div className="node-palette-label">{entry.display_name}</div>
                    <div className="node-palette-description">
                      {usable
                        ? entry.implemented
                          ? entry.type
                          : `${entry.type} — backend execution pending`
                        : `${entry.type} — coming soon`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}
