import { create } from "zustand";
import type { NodeCatalogueEntry } from "../types/catalogue";

interface CatalogueState {
  entries: NodeCatalogueEntry[];
  status: "idle" | "loading" | "loaded" | "error";
  load: () => Promise<void>;
}

export const useCatalogueStore = create<CatalogueState>((set, get) => ({
  entries: [],
  status: "idle",
  load: async () => {
    if (get().status === "loading" || get().status === "loaded") return;
    set({ status: "loading" });
    try {
      const res = await fetch("/node_catalogue.json");
      const entries = (await res.json()) as NodeCatalogueEntry[];
      set({ entries, status: "loaded" });
    } catch {
      set({ status: "error" });
    }
  },
}));
