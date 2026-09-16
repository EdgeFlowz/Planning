import type { NodeCatalogueEntry } from "../types/catalogue";

/**
 * Per-type icons would need updating every time the backend adds a node type — one more piece of
 * frontend code a new connector/transform would require. A category-level icon is the one bit of
 * presentation the schema-driven catalog doesn't carry, so it's the one thing still hardcoded here.
 */
const CATEGORY_ICONS: Record<string, string> = {
  source: "\u{1F4C4}",
  transform: "\u{1F9EE}",
  sink: "\u{1F4BE}",
};

export function iconForEntry(entry: Pick<NodeCatalogueEntry, "category">): string {
  return CATEGORY_ICONS[entry.category] ?? "\u{1F9E9}";
}

export function labelForEntry(entry: Pick<NodeCatalogueEntry, "display_name" | "type"> | undefined, type: string): string {
  return entry?.display_name ?? type;
}
