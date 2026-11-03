import { useEffect, useState } from "react";

export type Page = "search" | "sources";

// Hash routing for the Sources page keeps the app working behind any static
// file server, with no fallback rule needed. Search state lives in ?q= / ?like=.
function currentPage(): Page {
  return window.location.hash === "#/sources" ? "sources" : "search";
}

export function usePage(): Page {
  const [page, setPage] = useState<Page>(currentPage);
  useEffect(() => {
    const update = () => setPage(currentPage());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return page;
}

export function goSearch() {
  if (currentPage() === "search") return;
  const { pathname, search } = window.location;
  history.pushState(history.state, "", pathname + search);
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}
