import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEditorStore } from "../store/editorStore";
import { useCatalogueStore } from "../store/catalogueStore";
import { useInteractionStore } from "../store/interactionStore";
import { PipelineNodeView } from "../nodes/PipelineNodeView";
import { PipelineEdge } from "./PipelineEdge";
import { useProximityConnect } from "../hooks/useProximityConnect";
import { canConnect } from "../lib/connectionRules";
import { portsForEntry } from "../lib/ports";
import { PIPELINE_EDGE_TYPE } from "../lib/serialize";
import {
  collectHandlePoints,
  findBestPair,
  findEdgeNearPoint,
  sameCandidate,
  virtualHandlePoints,
  type HandlePoint,
} from "../lib/proximity";

const nodeTypes = { pipelineNode: PipelineNodeView };
const edgeTypes = { [PIPELINE_EDGE_TYPE]: PipelineEdge };

/** Approximate rendered size of a node, used to preview a palette drop before the node exists. */
const GHOST_NODE_SIZE = { width: 180, height: 84 };
const DRAG_PREVIEW_ID = "__dragging__";

export function Canvas() {
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const onNodesChange = useEditorStore((s) => s.onNodesChange);
  const onEdgesChange = useEditorStore((s) => s.onEdgesChange);
  const onConnect = useEditorStore((s) => s.onConnect);
  const addNode = useEditorStore((s) => s.addNode);
  const insertNodeOnEdge = useEditorStore((s) => s.insertNodeOnEdge);
  const reconnectEdgeAction = useEditorStore((s) => s.reconnectEdge);
  const removeEdge = useEditorStore((s) => s.removeEdge);
  const setSelectedNode = useEditorStore((s) => s.setSelectedNode);
  const pruneRemovedNodes = useEditorStore((s) => s.pruneRemovedNodes);
  const flowDirection = useEditorStore((s) => s.flowDirection);

  const ghost = useInteractionStore((s) => s.ghost);
  const spliceEdgeId = useInteractionStore((s) => s.spliceEdgeId);
  const dragPreview = useInteractionStore((s) => s.dragPreview);
  const setGhost = useInteractionStore((s) => s.setGhost);
  const setSpliceEdgeId = useInteractionStore((s) => s.setSpliceEdgeId);
  const setDragPreview = useInteractionStore((s) => s.setDragPreview);
  const clearInteraction = useInteractionStore((s) => s.clear);

  const { screenToFlowPosition } = useReactFlow();
  const storeApi = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const { onNodeDragStart, onNodeDrag, onNodeDragStop } = useProximityConnect();

  const [dropActive, setDropActive] = useState(false);
  // Tracks whether a reconnect ended on a handle; if not, the edge was dropped on empty canvas
  // and should be deleted (React Flow has no single callback for "dropped nowhere").
  const reconnectLanded = useRef(true);

  // React Flow caches each node's handle positions, and two things invalidate that cache without
  // changing the node itself: flipping the flow axis (handles move to another side) and the
  // catalogue arriving (port topology is derived from it, so handles can appear or disappear).
  // Stale bounds would render edges to where handles used to be and misdirect proximity snapping.
  const catalogueEntries = useCatalogueStore((s) => s.entries);
  useEffect(() => {
    nodes.forEach((n) => updateNodeInternals(n.id));
  }, [flowDirection, catalogueEntries, nodes, updateNodeInternals]);

  const onNodesDelete = useCallback(
    (deleted: Node[]) => pruneRemovedNodes(deleted.map((n) => n.id)),
    [pruneRemovedNodes],
  );

  // React Flow measures the drag stand-in and emits changes for it like any other node. Drop those
  // before they reach the store, so the preview can never be mistaken for part of the pipeline.
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const real = changes.filter((c) => !("id" in c) || c.id !== DRAG_PREVIEW_ID);
      if (real.length > 0) onNodesChange(real);
    },
    [onNodesChange],
  );

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const { nodes: n, edges: e } = useEditorStore.getState();
      const entries = useCatalogueStore.getState().entries;
      return canConnect(connection as Connection, { nodes: n, edges: e, entries }).ok;
    },
    [],
  );

  /** Handle points for every node currently on the canvas, keyed by node id. */
  const collectCanvasPoints = useCallback(() => {
    const byNode = new Map<string, HandlePoint[]>();
    const all: HandlePoint[] = [];
    for (const node of storeApi.getState().nodeLookup.values()) {
      const points = collectHandlePoints(node);
      byNode.set(node.id, points);
      all.push(...points);
    }
    return { byNode, all };
  }, [storeApi]);

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      // `dataTransfer.getData` is blocked during dragover for security, so the palette stashes
      // the type in the interaction store on drag start.
      const type = useInteractionStore.getState().paletteDragType;
      if (!type) return;

      const entries = useCatalogueStore.getState().entries;
      const ports = portsForEntry(entries.find((e) => e.type === type));
      const centre = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const { byNode, all } = collectCanvasPoints();
      const { nodes: n, edges: e, flowDirection: dir } = useEditorStore.getState();

      // Dropping onto an existing connection splices the node into it — but only if the node has
      // both an input and an output to splice with.
      const canSplice = ports.inputs.length > 0 && ports.outputs.length > 0;
      const hitEdge = canSplice ? findEdgeNearPoint(centre, e, byNode, dir) : null;
      if (hitEdge) {
        if (useInteractionStore.getState().spliceEdgeId !== hitEdge.id) setSpliceEdgeId(hitEdge.id);
        if (useInteractionStore.getState().ghost) setGhost(null);
        setDragPreview(null);
        return;
      }
      if (useInteractionStore.getState().spliceEdgeId) setSpliceEdgeId(null);

      // Otherwise preview the connection the drop would make, using a stand-in node at the cursor.
      const previewPosition = {
        x: centre.x - GHOST_NODE_SIZE.width / 2,
        y: centre.y - GHOST_NODE_SIZE.height / 2,
      };
      const preview = virtualHandlePoints(DRAG_PREVIEW_ID, centre, GHOST_NODE_SIZE, ports, dir);
      const previewNode = {
        id: DRAG_PREVIEW_ID,
        type: "pipelineNode",
        position: previewPosition,
        data: { nodeType: type, config: {} },
      } as (typeof n)[number];

      const candidate = findBestPair(preview, all, { nodes: [...n, previewNode], edges: e, entries }, dir);
      const current = useInteractionStore.getState().ghost;
      if (!sameCandidate(candidate, current)) setGhost(candidate);

      // The stand-in has to be a real node on the canvas or the preview edge has nothing to
      // attach to and React Flow drops it silently.
      setDragPreview(candidate ? { type, position: previewPosition } : null);
    },
    [screenToFlowPosition, collectCanvasPoints, setGhost, setSpliceEdgeId, setDragPreview],
  );

  const onDragEnter = useCallback(() => setDropActive(true), []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    // dragleave fires when crossing onto a child element too; ignore those.
    if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return;
    setDropActive(false);
    useInteractionStore.getState().setGhost(null);
    useInteractionStore.getState().setSpliceEdgeId(null);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDropActive(false);

      const type =
        event.dataTransfer.getData("application/pipeline-node-type") ||
        useInteractionStore.getState().paletteDragType;
      const pendingGhost = useInteractionStore.getState().ghost;
      const pendingSplice = useInteractionStore.getState().spliceEdgeId;
      clearInteraction();
      if (!type) return;

      const centre = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const position = { x: centre.x - GHOST_NODE_SIZE.width / 2, y: centre.y - GHOST_NODE_SIZE.height / 2 };

      if (pendingSplice && insertNodeOnEdge(pendingSplice, type, position)) return;

      const newId = addNode(type, position);
      if (pendingGhost) {
        // The preview was made against a stand-in id; retarget it at the node that now exists.
        const c = pendingGhost.connection;
        onConnect({
          ...c,
          source: c.source === DRAG_PREVIEW_ID ? newId : c.source,
          target: c.target === DRAG_PREVIEW_ID ? newId : c.target,
        });
      }
    },
    [screenToFlowPosition, clearInteraction, insertNodeOnEdge, addNode, onConnect],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => setSelectedNode(node.id),
    [setSelectedNode],
  );

  const onPaneClick = useCallback(() => setSelectedNode(null), [setSelectedNode]);

  const onReconnectStart = useCallback(() => {
    reconnectLanded.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      reconnectLanded.current = true;
      reconnectEdgeAction(oldEdge, connection);
    },
    [reconnectEdgeAction],
  );

  const onReconnectEnd = useCallback(
    (_event: unknown, edge: Edge) => {
      if (!reconnectLanded.current) removeEdge(edge.id);
      reconnectLanded.current = true;
    },
    [removeEdge],
  );

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  // Markers are <defs> elements, so they don't inherit the edge's stroke — each needs its colour
  // set explicitly or it renders in the default grey.
  const defaultEdgeOptions = useMemo(
    () => ({
      type: PIPELINE_EDGE_TYPE,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#94a3b8" },
    }),
    [],
  );

  // Both the ghost edge and the drag stand-in live only in the render arrays — never in the
  // editor store, so neither can reach the exported pipeline JSON or the preview panel.
  const renderedNodes = useMemo(() => {
    if (!dragPreview) return nodes;
    return [
      ...nodes,
      {
        id: DRAG_PREVIEW_ID,
        type: "pipelineNode",
        position: dragPreview.position,
        data: { nodeType: dragPreview.type, config: {} },
        draggable: false,
        selectable: false,
        deletable: false,
        className: "node-drag-preview",
      } as (typeof nodes)[number],
    ];
  }, [nodes, dragPreview]);

  const renderedEdges = useMemo(() => {
    const marked = spliceEdgeId
      ? edges.map((e) => (e.id === spliceEdgeId ? { ...e, className: "edge-splice-target" } : e))
      : edges;
    if (!ghost) return marked;
    const c = ghost.connection;
    return [
      ...marked,
      {
        id: "__ghost__",
        source: c.source,
        target: c.target,
        sourceHandle: c.sourceHandle,
        targetHandle: c.targetHandle,
        className: "edge-ghost",
        selectable: false,
        deletable: false,
        focusable: false,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#7c3aed" },
      } as Edge,
    ];
  }, [edges, ghost, spliceEdgeId]);

  return (
    <div
      className={`canvas-wrapper${dropActive ? " drop-active" : ""}`}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodesDelete={onNodesDelete}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        // Default is 20px, which demands near-pixel accuracy on release.
        connectionRadius={45}
        connectionLineType={ConnectionLineType.Bezier}
        proOptions={proOptions}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="canvas-empty-hint">
          <strong>Drag a node here to start</strong>
          <span>Drop nodes near each other and they connect automatically.</span>
        </div>
      )}
    </div>
  );
}
