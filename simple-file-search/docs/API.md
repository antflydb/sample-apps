# HTTP API

The Go server serves the built UI from `/` and this JSON API under `/api`.
All bodies are JSON unless noted.

## GET /api/config

```json
{ "demo": true, "repo_url": "https://github.com/antflydb/sample-apps/tree/main/simple-file-search" }
```

`demo: true` means the deployment is a read-only showcase: sources cannot be
added, removed, or synced from the UI.

## GET /api/sources

```json
[
  {
    "id": "nasa-media",
    "kind": "s3",
    "name": "NASA media",
    "location": "s3://antfly-nasa-demo/media/",
    "status": "idle",
    "last_synced_at": "2026-11-02T21:04:00Z",
    "error": "",
    "files": 412,
    "by_kind": { "image": 300, "audio": 112 }
  },
  {
    "id": "mission-reports",
    "kind": "drive",
    "name": "Mission reports",
    "location": "Google Drive folder",
    "status": "syncing",
    "last_synced_at": null,
    "error": "",
    "files": 40,
    "by_kind": { "pdf": 38, "text": 2 }
  }
]
```

`status` is `idle`, `syncing`, or `error` (then `error` holds the message).
`kind` values for files: `image`, `audio`, `video`, `pdf`, `text`.

## POST /api/sources (not in demo mode)

```json
{ "kind": "s3", "name": "Photos",
  "s3": { "bucket": "my-bucket", "prefix": "photos/", "region": "us-east-1",
          "endpoint": "", "access_key_id": "...", "secret_access_key": "..." } }
```

```json
{ "kind": "drive", "name": "Reports",
  "drive": { "folder": "https://drive.google.com/drive/folders/<id>",
             "credentials_json": "{...service account key...}" } }
```

```json
{ "kind": "gcs", "name": "Documents",
  "gcs": { "bucket": "example-documents", "prefix": "demo/" } }
```

GCS uses the server's Application Default Credentials. In demo mode,
source locations are provider labels rather than bucket names or prefixes.

Returns the created source (shape as above). Errors: `400 {"error": "..."}`.

## DELETE /api/sources/{id} (not in demo mode)

Removes the source and its indexed files. `204`.

## POST /api/sources/{id}/sync (not in demo mode)

Starts a sync now. `202`.

## GET /api/status

Indexing progress across all sources.

```json
{ "files": 452, "indexed": 430, "pending": 22, "failed": 0 }
```

## POST /api/search

Any combination of `text` and `image`, or of `text` and `like` (a result
`id`, for "More like this"). Words and a picture or file become one query
vector, so the words refine it. With `like`, `image` is ignored, and the
response also carries `like`: the starting file's `id`, `title`, `kind`, and
`file_url`.

```json
{ "text": "astronaut repairing a telescope",
  "image": "data:image/jpeg;base64,...",
  "like": "",
  "limit": 20 }
```

```json
{
  "took_ms": 182,
  "results": [
    {
      "id": "nasa-media:images/sts61-eva-034.jpg",
      "title": "sts61-eva-034.jpg",
      "kind": "image",
      "mime_type": "image/jpeg",
      "source": { "id": "nasa-media", "kind": "s3", "name": "NASA media" },
      "path": "images/sts61-eva-034.jpg",
      "file_url": "/files/nasa-media%3Aimages%2Fsts61-eva-034.jpg",
      "web_url": "",
      "score": 0.81,
      "matches": []
    },
    {
      "id": "nasa-media:audio/apollo11-small-step.mp3",
      "title": "apollo11-small-step.mp3",
      "kind": "audio",
      "mime_type": "audio/mpeg",
      "source": { "id": "nasa-media", "kind": "s3", "name": "NASA media" },
      "path": "audio/apollo11-small-step.mp3",
      "file_url": "/files/...",
      "web_url": "",
      "score": 0.66,
      "matches": [
        { "type": "segment", "start_ms": 2130, "end_ms": 9800,
          "text": "That's one small step for man..." }
      ]
    },
    {
      "id": "mission-reports:1AbC...",
      "title": "STS-61 Mission Report",
      "kind": "pdf",
      "mime_type": "application/pdf",
      "source": { "id": "mission-reports", "kind": "drive", "name": "Mission reports" },
      "path": "STS-61 Mission Report.pdf",
      "file_url": "/files/...",
      "web_url": "https://drive.google.com/file/d/1AbC.../view",
      "score": 0.74,
      "matches": [
        { "type": "page", "page": 47, "text": "EVA 3 replaced the Wide Field..." },
        { "type": "page", "page": 52, "text": "...corrective optics installed..." }
      ]
    }
  ]
}
```

- `matches` is the evidence: `page` (PDF page, 1-based), `segment` (audio
  time range in ms), or `text` (a passage of a text file). Empty for images
  and short clips that matched as a whole.
- `file_url` streams the original through the app (images render inline,
  audio/video play and seek, PDFs open; append `#page=N` for a page).
- `web_url` links to the file in its source (Drive) when one exists.
