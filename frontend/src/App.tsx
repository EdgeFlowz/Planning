import { ReactFlowProvider } from "@xyflow/react";
import { Toolbar } from "./components/Toolbar";
import { NodePalette } from "./components/NodePalette";
import { Canvas } from "./components/Canvas";
import { ConfigPanel } from "./components/ConfigPanel";
import { DataPreviewTable } from "./components/DataPreviewTable";
import { JsonPreview } from "./components/JsonPreview";
import "./App.css";

function App() {
  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <Toolbar />
        <div className="app-body">
          <NodePalette />
          <Canvas />
          <ConfigPanel />
        </div>
        <div className="app-bottom">
          <DataPreviewTable />
          <JsonPreview />
        </div>
      </div>
    </ReactFlowProvider>
  );
}

export default App;
