export interface NodeCatalogueEntry {
  type: string;
  category: "source" | "transform" | "sink";
  display_name: string;
  implemented: boolean;
  config_schema: Record<string, unknown>;
  input_ports: string[];
  output_ports: string[];
}
