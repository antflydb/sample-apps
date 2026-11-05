# Simple file search

Search photos, audio, and PDFs in S3 buckets and Google Drive folders with
text, an image, or both at once. One query can return a photo, the second
of a recording where something was said, and the page of a report that
describes it.

The app lists your sources and writes one row per file to
[Antfly](https://github.com/antflydb/antfly). Antfly does the rest: it fetches
each file, embeds images and short clips with EmbeddingGemma 2, extracts PDF
pages, transcribes recordings with Whisper, and serves hybrid search over all
of it.

## How it works

```
S3 bucket ─┐                         ┌─ media index: one EmbeddingGemma 2 vector
           ├─ app: list, diff, write ┤  per photo and per clip of 30s or less
Drive  ────┘   one row per file      └─ document_units: PDF pages, transcripts
                                          └─ chunks: full-text + vectors
```

- **Sync.** Every 15 minutes (or on demand) the app lists each source and
  writes rows for new and changed files, then deletes rows for files that are
  gone. A row holds metadata and a URL; the bytes stay in the source.
- **Indexing.** Antfly fetches each file from the app's `/files` route (or
  straight from S3 if you give Antfly the bucket's credentials) and runs the
  enrichments defined in [`internal/index/schema.go`](internal/index/schema.go).
- **Search.** Text runs as hybrid search across both indexes. An image, with
  or without words, becomes a single EmbeddingGemma 2 vector, so "at night"
  refines the picture instead of being a separate search. "More like this"
  starts from any result, and words refine it the same way. Results are
  grouped by file, with the matching pages and transcript passages attached.

## Run it

### macOS (Apple silicon)

Install Antfly 0.3.0-rc.10 or newer, Go 1.26, and pnpm, then:

```sh
scripts/run-local.sh
```

Open http://127.0.0.1:8090 and add a source. The first run downloads
EmbeddingGemma 2 and Whisper (about 2.5 GB).

### Container

The `Dockerfile` builds the app alone. Point it at an Antfly that serves
EmbeddingGemma 2, such as Antfly Cloud or a Mac running the script above, and
set `PUBLIC_URL` to an address that Antfly can reach the app at:

```sh
docker build -t simple-file-search .
docker run -p 8090:8090 -v file-search-data:/data \
  -e ANTFLY_URL=https://your-instance.example -e ANTFLY_API_KEY=... \
  -e PUBLIC_URL=https://search.example.com \
  simple-file-search
```

## Sources

**S3 or S3-compatible (R2, MinIO, GCS interoperability).** Bucket, optional
prefix, region, endpoint for non-AWS stores, and a read-only access key.

**Google Drive.** Paste the folder URL. Google Docs and Slides are indexed as
text, and Sheets as CSV. How the app reads the folder depends on how it is shared:

- *Anyone with the link:* a Google API key from a project with the Drive API
  enabled. Paste it with the folder, or set `GOOGLE_API_KEY` once on the
  server.
- *Private:* create a service account, share the folder with its
  `client_email` (Viewer is enough), and paste its JSON key.
- *Neither given:* the server's own Google identity, such as a Cloud Run
  service account the folder is shared with.

Credentials stay in `data/sources.json` on the app's disk (mode 0600). They
are never written to Antfly.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `ANTFLY_URL` | `http://127.0.0.1:8080` | Antfly server |
| `ANTFLY_API_KEY` | | for Antfly with auth (e.g. Antfly Cloud) |
| `PUBLIC_URL` | `http://127.0.0.1:8090` | where Antfly reaches this app to fetch files |
| `LISTEN` | `127.0.0.1:8090` | |
| `DATA_DIR` | `data` | sources, sync ledger, Drive cache |
| `SOURCES_FILE` | `$DATA_DIR/sources.json` | source list; point at a mounted secret to preconfigure sources |
| `TABLE` | `files` | Antfly table |
| `EMBEDDER` | `google/embeddinggemma-2:bf16-safetensors-bundle-v1` | |
| `TRANSCRIBER` | `openai/whisper-small` | `none` to skip audio transcripts |
| `SYNC_INTERVAL` | `15m` | |
| `DEMO` | `false` | read-only: no adding, removing, or syncing from the UI |
| `GOOGLE_API_KEY` | | reads public Drive folders that have no key of their own |

Antfly needs two settings, both in [`deploy/antfly.json`](deploy/antfly.json):
`public_inference.enabled` (image queries are embedded through `/ai/v1/embed`)
and a `remote_content` allowlist that lets it fetch from this app.

The app has no login. Run it on a private network or behind your own
authentication: anyone who can reach it can search your files and read them
through `/files`.

## Google Cloud Storage

Configure GCS through `SOURCES_FILE` (a JSON array), or `POST /api/sources`
when demo mode is disabled. The add-source dialog currently offers S3 and
Drive. GCS uses Application Default Credentials: attach a service account
with `roles/storage.objectViewer` on the source bucket, or use local ADC
for development. No service account key or HMAC credential belongs in the
source configuration.

```json
[{"id":"documents","kind":"gcs","name":"Documents",
  "gcs":{"bucket":"example-documents","prefix":"demo/"}}]
```

Only objects under the prefix are listed. GCS generation numbers detect
changes. Objects must be stored without content encoding (for example,
without `Content-Encoding: gzip`) so byte offsets and file sizes stay stable.
Ranged downloads are pinned to the listed generation. Enable
bucket versioning if earlier generations must remain readable while a sync
is in progress. Antfly fetches GCS content through the app's `/files` route;
it needs network access to `PUBLIC_URL`, not bucket credentials.

## Demo corpus

The demo uses public-domain NASA photos, recordings, and technical reports.
`scripts/fetch-nasa-corpus.py` downloads the set (`--no-audio` leaves out the
recordings, for an Antfly without a transcriber), and
`scripts/audit-extraction.py` flags PDFs whose extracted text came back
without spaces between words, which makes them hard to search; the fetch
script leaves out the reports it found.

## License

MIT. See [LICENSE](../LICENSE).

## Development

```sh
cd web && pnpm install && pnpm mock   # UI against fixtures
go run ./cmd/server                   # API on :8090; `pnpm dev` proxies to it
```
