import { useEffect, useState, type DragEvent } from "react";
import { useCatalogueStore } from "../store/catalogueStore";
import { iconForEntry } from "../lib/catalogueDisplay";

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

  const onDragStart = (event: DragEvent<HTMLDivElement>, type: string) => {
    event.dataTransfer.setData("application/pipeline-node-type", type);
    event.dataTransfer.effectAllowed = "move";
  };

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
      <p className="node-palette-hint">Drag onto the canvas</p>
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
