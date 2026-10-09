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
  type NodeChange,
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
  ESTIMATED_NODE_SIZE,
  nodeGeometry,
  planPaletteDrop,
  previewHandles,
  sameCandidate,
  snapPosition,
  type NodeGeometry,
} from "../lib/proximity";
import type { EditorNode } from "../types/editor";

const nodeTypes = { pipelineNode: PipelineNodeView };
const edgeTypes = { [PIPELINE_EDGE_TYPE]: PipelineEdge };

const GHOST_NODE_SIZE = ESTIMATED_NODE_SIZE;
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
  const setPendingSnap = useInteractionStore((s) => s.setPendingSnap);
  const clearInteraction = useInteractionStore((s) => s.clear);

  const { screenToFlowPosition } = useReactFlow();
  const storeApi = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const { onNodeDragStart, onNodeDrag, onNodeDragStop } = useProximityConnect();

  const [dropActive, setDropActive] = useState(false);
  // Tracks whether a reconnect ended on a handle; if not, the edge was dropped on empty canvas
  // and should be deleted (React Flow has no single callback for "dropped nowhere").
  const reconnectLanded = useRef(true);
  // `dragover` fires every ~50ms even while the pointer is still; skip the work when nothing moved.
  const lastDragPoint = useRef<{ x: number; y: number; type: string } | null>(null);

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

  /** Geometry of every real node on the canvas — never the palette-drag stand-in. */
  const collectCanvasGeometry = useCallback((): NodeGeometry[] => {
    const geometry: NodeGeometry[] = [];
    for (const node of storeApi.getState().nodeLookup.values()) {
      if (node.id !== DRAG_PREVIEW_ID) geometry.push(nodeGeometry(node));
    }
    return geometry;
  }, [storeApi]);

  // React Flow measures the drag stand-in and emits changes for it like any other node. Drop those
  // before they reach the store, so the preview can never be mistaken for part of the pipeline.
  const handleNodesChange = useCallback(
    (changes: NodeChange<EditorNode>[]) => {
      const real = changes.filter((c) => !("id" in c) || c.id !== DRAG_PREVIEW_ID);
      if (real.length > 0) onNodesChange(real);

      // A node created already connected was placed from an estimate of its size. Its first
      // measurement is the moment its real handle positions are known, so line it up again now.
      // React Flow updates its lookup before emitting the change, so the bounds read here are fresh.
      const pending = useInteractionStore.getState().pendingSnap;
      if (!pending || !real.some((c) => c.type === "dimensions" && c.id === pending.nodeId)) return;
      setPendingSnap(null);

      const internal = storeApi.getState().nodeLookup.get(pending.nodeId);
      if (!internal) return;
      const geometry = nodeGeometry(internal);
      const mine = geometry.points.find((p) => p.type === pending.handleType && p.handleId === pending.handleId);
      if (!mine) return;

      const obstacles = collectCanvasGeometry()
        .filter((g) => g.id !== pending.nodeId)
        .map((g) => g.rect);
      const position = snapPosition(
        { mine, theirs: pending.theirs },
        geometry.rect,
        useEditorStore.getState().flowDirection,
        obstacles,
      );
      if (position.x !== geometry.rect.x || position.y !== geometry.rect.y) {
        onNodesChange([{ type: "position", id: pending.nodeId, position }]);
      }
    },
    [onNodesChange, setPendingSnap, storeApi, collectCanvasGeometry],
  );

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const { nodes: n, edges: e } = useEditorStore.getState();
      const entries = useCatalogueStore.getState().entries;
      return canConnect(connection as Connection, { nodes: n, edges: e, entries }).ok;
    },
    [],
  );

  /** What releasing palette item `type` at this screen point would do. */
  const planDropAt = useCallback(
    (type: string, client: { x: number; y: number }) => {
      const entries = useCatalogueStore.getState().entries;
      const { nodes: n, edges: e, flowDirection: dir } = useEditorStore.getState();
      return planPaletteDrop({
        previewId: DRAG_PREVIEW_ID,
        nodeType: type,
        centre: screenToFlowPosition(client),
        size: GHOST_NODE_SIZE,
        ports: portsForEntry(entries.find((entry) => entry.type === type)),
        direction: dir,
        others: collectCanvasGeometry(),
        nodes: n,
        edges: e,
        entries,
      });
    },
    [screenToFlowPosition, collectCanvasGeometry],
  );

  const clearDropPreview = useCallback(() => {
    lastDragPoint.current = null;
    const state = useInteractionStore.getState();
    if (state.ghost) setGhost(null);
    if (state.spliceEdgeId) setSpliceEdgeId(null);
    if (state.dragPreview) setDragPreview(null);
  }, [setGhost, setSpliceEdgeId, setDragPreview]);

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      // Must run on every dragover, or the browser treats the canvas as not accepting the drop.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      // `dataTransfer.getData` is blocked during dragover for security, so the palette stashes
      // the type in the interaction store on drag start.
      const type = useInteractionStore.getState().paletteDragType;
      if (!type) return;

      const last = lastDragPoint.current;
      if (last && last.x === event.clientX && last.y === event.clientY && last.type === type) return;
      lastDragPoint.current = { x: event.clientX, y: event.clientY, type };

      const plan = planDropAt(type, { x: event.clientX, y: event.clientY });
      const state = useInteractionStore.getState();

      if (plan.kind === "splice") {
        if (state.spliceEdgeId !== plan.edgeId) setSpliceEdgeId(plan.edgeId);
        if (state.ghost) setGhost(null);
        if (state.dragPreview) setDragPreview(null);
        return;
      }
      if (state.spliceEdgeId) setSpliceEdgeId(null);

      if (plan.kind === "place") {
        if (state.ghost) setGhost(null);
        if (state.dragPreview) setDragPreview(null);
        return;
      }

      // Show the stand-in where the node will actually land — snapped beside its new neighbour —
      // with the preview edge drawn to it. Only replace the preview when it really moves, so
      // React Flow isn't handed a new node object on every pointer event.
      if (!sameCandidate(plan.candidate, state.ghost)) setGhost(plan.candidate);
      const preview = state.dragPreview;
      if (
        !preview ||
        preview.type !== type ||
        preview.position.x !== plan.position.x ||
        preview.position.y !== plan.position.y
      ) {
        setDragPreview({ type, position: plan.position });
      }
    },
    [planDropAt, setGhost, setSpliceEdgeId, setDragPreview],
  );

  const onDragEnter = useCallback(() => setDropActive(true), []);

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      // dragleave also fires when the pointer crosses onto a child element. `relatedTarget` would
      // say which, but Safari reports it as null for drag events, so judge by pointer position.
      const rect = event.currentTarget.getBoundingClientRect();
      const inside =
        event.clientX > rect.left &&
        event.clientX < rect.right &&
        event.clientY > rect.top &&
        event.clientY < rect.bottom;
      if (inside) return;
      setDropActive(false);
      clearDropPreview();
    },
    [clearDropPreview],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDropActive(false);

      const type =
        event.dataTransfer.getData("application/pipeline-node-type") ||
        useInteractionStore.getState().paletteDragType;
      clearDropPreview();
      clearInteraction();
      if (!type) return;

      // Re-plan from the release point rather than trusting whatever the last dragover stored.
      const plan = planDropAt(type, { x: event.clientX, y: event.clientY });

      if (plan.kind === "splice" && insertNodeOnEdge(plan.edgeId, type, plan.position)) return;

      const newId = addNode(type, plan.position);
      if (plan.kind !== "connect") return;

      // The plan was made against a stand-in id; retarget it at the node that now exists.
      const { connection: c, mine, theirs } = plan.candidate;
      onConnect({
        ...c,
        source: c.source === DRAG_PREVIEW_ID ? newId : c.source,
        target: c.target === DRAG_PREVIEW_ID ? newId : c.target,
      });
      setPendingSnap({ nodeId: newId, handleType: mine.type, handleId: mine.handleId, theirs });
    },
    [planDropAt, clearDropPreview, clearInteraction, insertNodeOnEdge, addNode, onConnect, setPendingSnap],
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
  // The stand-in is given its size and handle bounds up front. It's re-created whenever it moves,
  // and React Flow discards measurements for a new node object that doesn't carry them — so a
  // measured-only stand-in would flicker and its preview edge would never get drawn.
  const renderedNodes = useMemo(() => {
    if (!dragPreview) return nodes;
    const ports = portsForEntry(catalogueEntries.find((e) => e.type === dragPreview.type));
    return [
      ...nodes,
      {
        id: DRAG_PREVIEW_ID,
        type: "pipelineNode",
        position: dragPreview.position,
        data: { nodeType: dragPreview.type, config: {} },
        width: GHOST_NODE_SIZE.width,
        height: GHOST_NODE_SIZE.height,
        measured: GHOST_NODE_SIZE,
        handles: previewHandles(GHOST_NODE_SIZE, ports, flowDirection),
        draggable: false,
        selectable: false,
        deletable: false,
        className: "node-drag-preview",
      } as (typeof nodes)[number],
    ];
  }, [nodes, dragPreview, catalogueEntries, flowDirection]);

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
