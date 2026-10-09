import { ReactFlowProvider } from "@xyflow/react";
import { Toolbar } from "./components/Toolbar";
import { NodePalette } from "./components/NodePalette";
import { Canvas } from "./components/Canvas";
import { ConfigPanel } from "./components/ConfigPanel";
import { DataPreviewTable } from "./components/DataPreviewTable";
import { JsonPreview } from "./components/JsonPreview";
import { PipelinesPage } from "./components/PipelinesPage";
import { useRoute } from "./lib/route";
import "./App.css";

function App() {
  const route = useRoute();

  // The editor's state lives in its stores, so leaving and returning to it keeps the canvas.
  if (route === "pipelines") {
    return (
      <div className="app-shell">
        <PipelinesPage />
      </div>
    );
  }

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
