import type { DragEvent } from "react";
import { NODE_TYPE_LABELS, type NodeType } from "../types/pipeline";

const PALETTE: { type: NodeType; icon: string; description: string }[] = [
  { type: "source.csv", icon: "\u{1F4C4}", description: "Read rows from a CSV file" },
  { type: "transform.select", icon: "\u{1F3AF}", description: "Keep only chosen columns" },
  { type: "transform.filter", icon: "\u{1F50D}", description: "Keep rows matching a condition" },
  { type: "transform.rename", icon: "✏️", description: "Rename columns" },
  { type: "transform.drop", icon: "\u{1F5D1}️", description: "Remove chosen columns" },
];

export function NodePalette() {
  const onDragStart = (event: DragEvent<HTMLDivElement>, type: NodeType) => {
    event.dataTransfer.setData("application/pipeline-node-type", type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="node-palette">
      <h2>Nodes</h2>
      <p className="node-palette-hint">Drag onto the canvas</p>
      {PALETTE.map((item) => (
        <div
          key={item.type}
          className="node-palette-item"
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
        >
          <span className="node-palette-icon">{item.icon}</span>
          <div>
            <div className="node-palette-label">{NODE_TYPE_LABELS[item.type]}</div>
            <div className="node-palette-description">{item.description}</div>
          </div>
        </div>
      ))}
    </aside>
  );
}
