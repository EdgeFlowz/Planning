# Frontend — Pipeline Editor

A React Flow–based visual editor for building pipeline definitions. Lets you upload a CSV, chain
together transform nodes on a canvas, preview the transformed data live, and export a pipeline
definition JSON in the exact shape the backend expects (`backend/app/domain/models.py`):
`{ schema_version, pipeline_id, nodes: [{id, type, config}], edges: [{source, target}] }`.

## Run it

```bash
npm install
npm run dev
```

Open the printed local URL. Click **Load Example** to load `example_data/sales.csv` and
`example_data/sales_pipeline.json` and see them running through the editor.

**Run Pipeline** and **Save Pipeline** call the backend API (proxied from `/api/*` to
`http://127.0.0.1:8000` — see `vite.config.ts`), so the API server, worker, and Redis must all be
running first (see [`../backend/README.md`](../backend/README.md)). Everything else (canvas,
config panel, live data preview) works with the frontend alone.

## How it works

- **Node palette** (left) — drag a node type onto the canvas.
- **Canvas** (center) — `@xyflow/react` graph. Connect a node's bottom handle to the next node's
  top handle. Connecting a new edge into a target replaces any existing edge into it, since these
  transform nodes take a single input.
- **Config panel** (right) — configure the selected node. Column pickers are populated from the
  live upstream schema, computed by walking the graph back to the nearest `source.csv` node.
- **Data preview** (bottom left) — runs the pipeline, from the uploaded CSV through every node up
  to the selected one, entirely in the browser (`src/lib/transform.ts`), so you can see the effect
  of each step without a backend.
- **Pipeline Definition** (bottom right) — the live JSON export. **Export JSON** downloads it.
- **Run Pipeline** — submits the pipeline definition to the backend as an async job
  (`POST /v1/jobs`) and polls its status (`src/hooks/useJobPolling.ts`) until it reaches a
  terminal state (succeeded/failed/cancelled), showing results or errors and a **Cancel** button
  while the job is queued/running.
- **Save Pipeline** — persists the pipeline definition to the backend's pipeline store.

Supported node types: `source.csv`, `transform.select`, `transform.filter`, `transform.rename`,
`transform.drop`. Add new types by extending `src/types/pipeline.ts` (config shape + default),
`src/lib/transform.ts` (preview behavior), and `src/components/ConfigPanel.tsx` (config form).

Uploaded CSV data lives only in browser state (`sourceTables` in `src/store/editorStore.ts`) — it
is never written into the exported pipeline JSON. Only the `path` you type in the source node's
config is included, since the backend reads the file itself at execution time.
