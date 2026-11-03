import { Header } from "./components/Header";
import { DataProvider } from "./lib/data";
import { usePage } from "./lib/route";
import { SearchPage } from "./pages/SearchPage";
import { SourcesPage } from "./pages/SourcesPage";

export function App() {
  const page = usePage();
  return (
    <DataProvider>
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <Header page={page} />
        <main>
          {/* Search stays mounted so results survive a trip to Sources. */}
          <SearchPage active={page === "search"} />
          {page === "sources" && <SourcesPage />}
        </main>
      </div>
    </DataProvider>
  );
}
