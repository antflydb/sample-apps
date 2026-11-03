import { Wordmark } from "@antfly/design-system/brand";
import { ArrowUpRightIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { useData } from "../lib/data";
import { goSearch } from "../lib/route";
import type { Page } from "../lib/route";
import { LogoMark } from "./Logo";

const link =
  "rounded-sm px-2 py-1.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30";

export function Header({ page }: { page: Page }) {
  const { config } = useData();
  const toSearch = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    goSearch();
  };
  return (
    <header className="flex h-14 items-center justify-between gap-2">
      <a href="/" onClick={toSearch} className={`-ml-2 flex items-center gap-2 text-foreground ${link}`}>
        <LogoMark className="size-[18px]" />
        <Wordmark className="text-[17px] leading-none">Antfly</Wordmark>
      </a>
      <nav aria-label="Main" className="-mr-2 flex items-center text-sm text-muted-foreground">
        <a href="/" onClick={toSearch} aria-current={page === "search" ? "page" : undefined} className={`${link} aria-[current=page]:text-foreground`}>
          Search
        </a>
        <a href="#/sources" aria-current={page === "sources" ? "page" : undefined} className={`${link} aria-[current=page]:text-foreground`}>
          Sources
        </a>
        {config?.demo && config.repo_url && (
          <a href={config.repo_url} target="_blank" rel="noreferrer" className={`${link} inline-flex items-center gap-0.5`}>
            Run it yourself
            <ArrowUpRightIcon aria-hidden className="size-3.5" />
          </a>
        )}
      </nav>
    </header>
  );
}
