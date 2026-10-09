import { useSyncExternalStore } from "react";

/**
 * The app's top-level views. Routing is hash-based so each view has a URL (back/forward and
 * bookmarks work) without a router dependency or any server-side configuration.
 */
export type Route = "editor" | "pipelines";

const HASHES: Record<Route, string> = {
  editor: "#/",
  pipelines: "#/pipelines",
};

function currentRoute(): Route {
  return window.location.hash === HASHES.pipelines ? "pipelines" : "editor";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute);
}

export function hrefFor(route: Route): string {
  return HASHES[route];
}

export function navigate(route: Route): void {
  window.location.hash = HASHES[route];
}
