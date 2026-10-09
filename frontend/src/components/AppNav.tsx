import { hrefFor, useRoute, type Route } from "../lib/route";

const TABS: { route: Route; label: string }[] = [
  { route: "editor", label: "Editor" },
  { route: "pipelines", label: "Pipelines" },
];

/** Switches between the app's top-level views. Plain links, so middle-click and copy-link work. */
export function AppNav() {
  const route = useRoute();
  return (
    <nav className="app-nav" aria-label="Main">
      {TABS.map((tab) => (
        <a
          key={tab.route}
          href={hrefFor(tab.route)}
          className={`app-nav-link${route === tab.route ? " active" : ""}`}
          aria-current={route === tab.route ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
