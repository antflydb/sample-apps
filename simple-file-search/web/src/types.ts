// Shapes from docs/API.md. Keep in sync with the Go server.

export type FileKind = "image" | "audio" | "video" | "pdf" | "text";
export type SourceKind = "s3" | "drive";
export type SourceStatus = "idle" | "syncing" | "error";

export interface Config {
  demo: boolean;
  repo_url: string;
  google_api_key?: boolean;
}

export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  location: string;
  status: SourceStatus;
  last_synced_at: string | null;
  error: string;
  files: number;
  by_kind: Partial<Record<FileKind, number>>;
}

export interface Status {
  files: number;
  indexed: number;
  pending: number;
  failed: number;
}

export type Match =
  | { type: "page"; page: number; text: string }
  | { type: "segment"; start_ms: number; end_ms: number; text: string }
  | { type: "text"; text: string };

export interface Result {
  id: string;
  title: string;
  kind: FileKind;
  mime_type: string;
  source: { id: string; kind: SourceKind; name: string };
  path: string;
  file_url: string;
  web_url: string;
  score: number;
  matches: Match[] | null;
}

export interface SearchRequest {
  text?: string;
  image?: string;
  like?: string;
  limit?: number;
}

export interface SearchResponse {
  took_ms: number;
  results: Result[];
  /** The file a "more like this" search started from. */
  like?: { id: string; title: string; kind: FileKind; file_url: string };
}

export type NewSource =
  | {
      kind: "s3";
      name: string;
      s3: {
        bucket: string;
        prefix: string;
        region: string;
        endpoint: string;
        access_key_id: string;
        secret_access_key: string;
      };
    }
  | {
      kind: "drive";
      name: string;
      drive: { folder: string; credentials_json?: string; api_key?: string };
    };
