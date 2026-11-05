// Package server is the HTTP layer: the JSON API, the file route Antfly and
// browsers fetch bytes from, and the embedded UI.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
	"github.com/antflydb/sample-apps/simple-file-search/internal/catalog"
	"github.com/antflydb/sample-apps/simple-file-search/internal/index"
	"github.com/antflydb/sample-apps/simple-file-search/internal/search"
	"github.com/antflydb/sample-apps/simple-file-search/internal/sources"
	"github.com/antflydb/sample-apps/simple-file-search/internal/syncer"
)

type Server struct {
	Antfly   *antfly.Client
	Store    *catalog.Store
	Syncer   *syncer.Syncer
	Searcher *search.Searcher
	Table    string
	Demo     bool
	RepoURL  string
	CacheDir string
	UI       fs.FS // built web/dist; nil serves a placeholder

	mu   sync.Mutex
	open map[string]sources.Source
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/config", s.config)
	mux.HandleFunc("GET /api/sources", s.listSources)
	mux.HandleFunc("POST /api/sources", s.mutating(s.addSource))
	mux.HandleFunc("DELETE /api/sources/{id}", s.mutating(s.removeSource))
	mux.HandleFunc("POST /api/sources/{id}/sync", s.mutating(s.syncSource))
	mux.HandleFunc("GET /api/status", s.status)
	mux.HandleFunc("POST /api/search", s.search)
	mux.HandleFunc("GET /files/{id...}", s.file)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.Handle("/", s.ui())
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) mutating(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.Demo {
			writeError(w, http.StatusForbidden, errors.New("this demo is read-only"))
			return
		}
		h(w, r)
	}
}

func (s *Server) config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"demo":     s.Demo,
		"repo_url": s.RepoURL,
		// Public Drive folders need no per-source key when the server has one.
		"google_api_key": os.Getenv("GOOGLE_API_KEY") != "",
	})
}

type sourceView struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Location string `json:"location"`
	syncer.Status
}

func (s *Server) listSources(w http.ResponseWriter, _ *http.Request) {
	all, err := s.Store.Sources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	out := make([]sourceView, 0, len(all))
	for _, c := range all {
		location := c.Location()
		if c.Kind == "drive" {
			location = "Google Drive folder"
		}
		if s.Demo {
			location = map[string]string{"s3": "S3 bucket", "gcs": "Google Cloud Storage bucket", "drive": "Google Drive folder"}[c.Kind]
		}
		out = append(out, sourceView{ID: c.ID, Kind: c.Kind, Name: c.Name, Location: location, Status: s.Syncer.Status(c.ID)})
	}
	writeJSON(w, http.StatusOK, out)
}

type addRequest struct {
	Kind  string             `json:"kind"`
	Name  string             `json:"name"`
	S3    *sources.S3Config  `json:"s3"`
	GCS   *sources.GCSConfig `json:"gcs"`
	Drive *struct {
		Folder          string `json:"folder"`
		CredentialsJSON string `json:"credentials_json"`
		APIKey          string `json:"api_key"`
	} `json:"drive"`
}

func (s *Server) addSource(w http.ResponseWriter, r *http.Request) {
	var req addRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, errors.New("name is required"))
		return
	}
	cfg := sources.Config{ID: s.newID(req.Name), Kind: req.Kind, Name: req.Name, CreatedAt: time.Now().UTC()}
	switch req.Kind {
	case "gcs":
		if req.GCS == nil {
			writeError(w, http.StatusBadRequest, errors.New("gcs settings are required"))
			return
		}
		cfg.GCS = req.GCS
	case "s3":
		if req.S3 == nil {
			writeError(w, http.StatusBadRequest, errors.New("s3 settings are required"))
			return
		}
		cfg.S3 = req.S3
	case "drive":
		if req.Drive == nil {
			writeError(w, http.StatusBadRequest, errors.New("drive settings are required"))
			return
		}
		cfg.Drive = &sources.DriveConfig{
			FolderID:        sources.ParseFolderID(req.Drive.Folder),
			CredentialsJSON: strings.TrimSpace(req.Drive.CredentialsJSON),
			APIKey:          strings.TrimSpace(req.Drive.APIKey),
		}
	default:
		writeError(w, http.StatusBadRequest, fmt.Errorf("kind must be s3, gcs, or drive"))
		return
	}
	// Check the credentials before saving: list once.
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if cfg.Drive != nil {
		cfg.Drive.CacheDir = s.CacheDir
	}
	src, err := sources.Open(ctx, cfg)
	if err == nil {
		_, err = src.List(ctx)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.Store.AddSource(cfg); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.Syncer.Start(cfg.ID)
	writeJSON(w, http.StatusCreated, sourceView{ID: cfg.ID, Kind: cfg.Kind, Name: cfg.Name, Location: cfg.Location(), Status: syncer.Status{State: "syncing", ByKind: map[string]int{}}})
}

// newID derives a readable, unique id from the source name.
func (s *Server) newID(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case b.Len() > 0 && !strings.HasSuffix(b.String(), "-"):
			b.WriteByte('-')
		}
	}
	base := strings.Trim(b.String(), "-")
	if len(base) > 40 {
		base = base[:40]
	}
	if base == "" {
		base = "source"
	}
	id := base
	for i := 2; ; i++ {
		if _, ok, _ := s.Store.Source(id); !ok {
			return id
		}
		id = fmt.Sprintf("%s-%d", base, i)
	}
}

func (s *Server) removeSource(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Syncer.Purge(r.Context(), id); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if err := s.Store.RemoveSource(id); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.mu.Lock()
	delete(s.open, id)
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) syncSource(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, ok, _ := s.Store.Source(id); !ok {
		writeError(w, http.StatusNotFound, errors.New("no such source"))
		return
	}
	s.Syncer.Start(id)
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	all, err := s.Store.Sources()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	files := 0
	for _, c := range all {
		files += s.Syncer.Status(c.ID).Files
	}
	// A file is done when every index has covered, skipped, or failed it.
	pending, failed := 0, 0
	for _, name := range []string{index.MediaIndex, index.ChunksIndex} {
		st, err := s.Antfly.IndexStatus(r.Context(), s.Table, name)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		cov := coverage(st)
		pending, failed = max(pending, cov["pending"]), max(failed, cov["failed"])
	}
	indexed := max(0, files-pending-failed)
	writeJSON(w, http.StatusOK, map[string]int{"files": files, "indexed": indexed, "pending": pending, "failed": failed})
}

func coverage(st map[string]any) map[string]int {
	out := map[string]int{}
	status, _ := st["status"].(map[string]any)
	cov, _ := status["source_coverage"].(map[string]any)
	for _, k := range []string{"total", "covered", "skipped", "failed"} {
		if v, ok := cov[k].(float64); ok {
			out[k] = int(v)
		}
	}
	// "pending" is sometimes absent while Antfly is mid-update; derive it.
	out["pending"] = max(0, out["total"]-out["covered"]-out["skipped"]-out["failed"])
	return out
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	var req search.Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	resp, err := s.Searcher.Search(ctx, req)
	if err != nil {
		var upstream *antfly.Error
		if errors.As(err, &upstream) {
			if seconds := upstream.StartupRetrySeconds(); seconds > 0 {
				w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
				w.Header().Set("Cache-Control", "no-store")
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{
					"code":  "INFERENCE_STARTING",
					"error": "Search is warming up.",
				})
				return
			}
		}
		slog.Error("search", "err", err)
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// Lookup resolves a file id to its source config and ledger entry.
func (s *Server) Lookup(id string) (sources.Config, sources.Object, bool) {
	sourceID, key, ok := syncer.SplitDocID(id)
	if !ok {
		return sources.Config{}, sources.Object{}, false
	}
	cfg, ok, err := s.Store.Source(sourceID)
	if err != nil || !ok {
		return sources.Config{}, sources.Object{}, false
	}
	ledger, err := s.Store.Ledger(sourceID)
	if err != nil {
		return sources.Config{}, sources.Object{}, false
	}
	obj, ok := ledger[key]
	return cfg, obj, ok
}

func (s *Server) source(ctx context.Context, cfg sources.Config) (sources.Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if src, ok := s.open[cfg.ID]; ok {
		return src, nil
	}
	if cfg.Drive != nil {
		cfg.Drive.CacheDir = s.CacheDir
	}
	src, err := sources.Open(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if s.open == nil {
		s.open = map[string]sources.Source{}
	}
	s.open[cfg.ID] = src
	return src, nil
}

// file streams a file's bytes with range support. Antfly fetches from here
// when indexing; browsers use it for previews and playback.
// OpenFile reads a stored file's bytes from its source.
func (s *Server) OpenFile(ctx context.Context, id string) (sources.Content, sources.Object, error) {
	cfg, obj, ok := s.Lookup(id)
	if !ok {
		return nil, sources.Object{}, fmt.Errorf("unknown file %q", id)
	}
	src, err := s.source(ctx, cfg)
	if err != nil {
		return nil, obj, err
	}
	content, err := src.Open(ctx, obj)
	return content, obj, err
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	cfg, obj, ok := s.Lookup(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	if version := r.URL.Query().Get("v"); version != "" && version != obj.Version {
		http.Error(w, "file version changed; retry with the current file URL", http.StatusConflict)
		return
	}
	src, err := s.source(r.Context(), cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	content, err := src.Open(r.Context(), obj)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer content.Close()
	w.Header().Set("Content-Type", obj.MimeType)
	w.Header().Set("ETag", `"`+obj.Version+`"`)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Disposition", "inline")
	// Files come from buckets and folders the app does not control. Keep an
	// HTML or SVG file from running script on this origin, which also serves
	// the API. Raster images, audio, video, and PDFs carry no script here,
	// and a sandbox would block the browser's PDF viewer.
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !inertType(obj.MimeType) {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
	}
	// Read errors happen after the headers are sent, where ServeContent can
	// only cut the body short; log them so a truncated fetch has a cause.
	http.ServeContent(w, r, obj.Name, obj.Modified, loggedReader{content, r.PathValue("id")})
}

type loggedReader struct {
	sources.Content
	id string
}

func (l loggedReader) Read(p []byte) (int, error) {
	n, err := l.Content.Read(p)
	if err != nil && !errors.Is(err, io.EOF) {
		slog.Error("read file", "id", l.id, "err", err)
	}
	return n, err
}

func (s *Server) ui() http.Handler {
	if s.UI == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "UI not built: run `pnpm --dir web build`", http.StatusNotFound)
		})
	}
	files := http.FileServerFS(s.UI)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Client-side routes fall back to index.html.
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p != "" {
			if _, err := fs.Stat(s.UI, p); err != nil {
				r = r.Clone(r.Context())
				r.URL.Path = "/"
			}
		}
		files.ServeHTTP(w, r)
	})
}

// inertType reports whether browsers display this type without running
// script from it.
func inertType(mimeType string) bool {
	mt := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	switch {
	case mt == "image/svg+xml":
		return false
	case strings.HasPrefix(mt, "image/"), strings.HasPrefix(mt, "audio/"), strings.HasPrefix(mt, "video/"):
		return true
	case mt == "application/pdf", mt == "text/plain", mt == "text/csv":
		return true
	}
	return false
}
