import type { NodeCatalogueEntry } from "../types/catalogue";

export interface NodePorts {
  inputs: string[];
  outputs: string[];
}

/**
 * The port topology of a node, taken from the catalogue when the backend declares it and
 * derived from the node's category otherwise.
 *
 * Only `transform.join` (left/right inputs) and `transform.conditional` (true/false outputs)
 * currently declare ports in backend/app; everything else ships empty tuples, so the
 * category fallback supplies the ordinary one-in/one-out shape.
 */
export function portsForEntry(entry: NodeCatalogueEntry | undefined): NodePorts {
  if (!entry) return { inputs: ["input"], outputs: ["output"] };

  const declaredInputs = entry.input_ports ?? [];
  const declaredOutputs = entry.output_ports ?? [];

  const fallback: NodePorts =
    entry.category === "source"
      ? { inputs: [], outputs: ["output"] }
      : entry.category === "sink"
        ? { inputs: ["input"], outputs: [] }
        : { inputs: ["input"], outputs: ["output"] };

  const ports =
    declaredInputs.length > 0 || declaredOutputs.length > 0
      ? { inputs: [...declaredInputs], outputs: [...declaredOutputs] }
      : fallback;

  // Category invariants win over whatever the catalogue claims. `NodeMetadata` in the backend
  // defaults both port tuples to a single port, so a connector that doesn't override them
  // advertises a shape its own validator rejects (a source with an inbound port). Enforcing it
  // here means a stale or wrong catalogue can't let the user draw an edge the backend refuses.
  if (entry.category === "source") ports.inputs = [];
  if (entry.category === "sink") ports.outputs = [];

  return ports;
}

/**
 * The React Flow handle id to use for a port.
 *
 * A side with a single port renders its handle with *no* id, because `toPipelineDefinition`
 * (lib/serialize.ts) only writes `input`/`output` into the exported JSON when a handle id is
 * set. Keeping single-port handles anonymous is what keeps exported pipelines unchanged.
 */
export function handleIdFor(ports: string[], port: string): string | undefined {
  return ports.length > 1 ? port : undefined;
}

/** Whether `port` is a valid named port on `ports`, treating null/undefined as the single-port case. */
export function hasPort(ports: string[], port: string | null | undefined): boolean {
  if (port == null) return ports.length === 1;
  return ports.includes(port);
}
