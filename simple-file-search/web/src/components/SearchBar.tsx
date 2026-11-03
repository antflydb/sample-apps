import { Spinner } from "@antfly/design-system/primitives";
import { ImagePlusIcon, SearchIcon, XIcon } from "lucide-react";
import { forwardRef, useRef } from "react";
import type { FormEvent, ReactNode } from "react";

export interface Attached {
  /** JPEG data URL, already downscaled. */
  dataURL: string;
  name: string;
}

export interface Like {
  id: string;
  title: string;
  /** Thumbnail when the file is an image. */
  thumb?: string;
}

interface Props {
  text: string;
  image: Attached | null;
  like: Like | null;
  loading: boolean;
  onText: (t: string) => void;
  onPickFile: (f: File) => void;
  onClearImage: () => void;
  onClearLike: () => void;
  onSubmit: () => void;
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { text, image, like, loading, onText, onPickFile, onClearImage, onClearLike, onSubmit },
  inputRef,
) {
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const placeholder = like || image
      ? "Add words, like “at night”"
      : "Search with words, an image, or both";

  return (
    <form role="search" onSubmit={submit} className="w-full">
      <div className="flex h-12 w-full items-center gap-1 rounded-md border border-input bg-background pr-1 pl-2 transition-[border-color,box-shadow] focus-within:border-foreground/70">
        {image && (
          <Chip label={`Remove image ${image.name}`} onRemove={onClearImage}>
            <img src={image.dataURL} alt={image.name} className="size-7 shrink-0 rounded-sm object-cover" />
          </Chip>
        )}
        {like && (
          <Chip label="Stop searching from this file" onRemove={onClearLike}>
            {like.thumb && (
              <img src={like.thumb} alt="" className="size-7 shrink-0 rounded-sm object-cover" />
            )}
            <span className="max-w-[12rem] truncate pl-1 text-sm sm:max-w-[18rem]" title={like.title}>
              <span className="text-muted-foreground">Like </span>
              {like.title}
            </span>
          </Chip>
        )}
        <input
          ref={inputRef}
          type="search"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={placeholder}
          aria-label={image ? "Words to search with the image" : "Search"}
          enterKeyHint="search"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-[15px] [&::-webkit-search-cancel-button]:hidden"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Search with an image"
          title="Search with an image"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <ImagePlusIcon className="size-4" />
        </button>
        <button
          type="submit"
          aria-label="Search"
          disabled={loading}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-100"
        >
          {loading ? <Spinner className="text-muted-foreground" /> : <SearchIcon className="size-4" />}
        </button>
      </div>
    </form>
  );
});

function Chip({
  children,
  label,
  onRemove,
}: {
  children: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="flex h-9 shrink-0 items-center gap-0.5 rounded-sm border border-border bg-secondary py-0.5 pr-0.5 pl-0.5">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        title="Remove"
        className="flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}
