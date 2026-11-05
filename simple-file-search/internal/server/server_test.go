package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
	"github.com/antflydb/sample-apps/simple-file-search/internal/catalog"
	"github.com/antflydb/sample-apps/simple-file-search/internal/search"
	"github.com/antflydb/sample-apps/simple-file-search/internal/sources"
	"github.com/antflydb/sample-apps/simple-file-search/internal/syncer"
)

func TestInertType(t *testing.T) {
	for mt, want := range map[string]bool{
		"image/jpeg":                true,
		"audio/mpeg":                true,
		"application/pdf":           true,
		"text/plain; charset=utf-8": true,
		"image/svg+xml":             false,
		"text/html":                 false,
		"application/xhtml+xml":     false,
		"application/octet-stream":  false,
		"":                          false,
	} {
		if got := inertType(mt); got != want {
			t.Errorf("inertType(%q) = %v", mt, got)
		}
	}
}

func TestDemoSourcesHideLocationsAndRejectMutations(t *testing.T) {
	store, err := catalog.Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddSource(sources.Config{ID: "documents", Kind: "gcs", Name: "Documents", GCS: &sources.GCSConfig{Bucket: "private-bucket", Prefix: "private-prefix/"}}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: store, Syncer: &syncer.Syncer{Store: store}, Demo: true}
	h := srv.Handler()
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", "/api/sources", nil))
	if r.Code != 200 || strings.Contains(r.Body.String(), "private-") || !strings.Contains(r.Body.String(), "Google Cloud Storage bucket") {
		t.Fatalf("source view: %s", r.Body)
	}
	for _, tc := range []struct{ method, path string }{{"POST", "/api/sources"}, {"DELETE", "/api/sources/documents"}, {"POST", "/api/sources/documents/sync"}} {
		r = httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(tc.method, tc.path, nil))
		if r.Code != 403 {
			t.Fatalf("demo mutation allowed: %+v => %d", tc, r.Code)
		}
	}
}

func TestFileRejectsStaleVersionBeforeOpeningSource(t *testing.T) {
	store, err := catalog.Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddSource(sources.Config{ID: "documents", Kind: "gcs", GCS: &sources.GCSConfig{Bucket: "example-documents"}}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveLedger("documents", map[string]sources.Object{"a.pdf": {Key: "a.pdf", Version: "42", Size: 10}}); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: store}
	r := httptest.NewRecorder()
	s.Handler().ServeHTTP(r, httptest.NewRequest("GET", "/files/documents:a.pdf?v=41", nil))
	if r.Code != 409 {
		t.Fatalf("stale request: %d %s", r.Code, r.Body)
	}
}

func TestSearchColdStart(t *testing.T) {
	const starting = `{"error":"INFERENCE_STARTING","phase":"starting_gpu","retryable":true,"retry_after_ms":30500}`
	for _, tc := range []struct {
		name      string
		status    int
		body      string
		wantRetry bool
	}{
		{"confirmed startup", 503, starting, true},
		{"overload", 429, starting, false},
		{"capacity unavailable", 503, "no capacity", false},
		{"not retryable", 503, `{"error":"INFERENCE_STARTING","retryable":false,"retry_after_ms":30000}`, false},
		{"missing delay", 503, `{"error":"INFERENCE_STARTING","retryable":true}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/ai/v1/embed" {
					t.Errorf("unexpected upstream path %s", r.URL.Path)
				}
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer upstream.Close()
			s := &Server{Searcher: &search.Searcher{Antfly: antfly.New(upstream.URL, ""), Embedder: "test-embedder"}}
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/search", strings.NewReader(`{"text":"telescope"}`)))
			if !tc.wantRetry {
				if w.Code != 502 || w.Header().Get("Retry-After") != "" {
					t.Fatalf("unexpected retry: %d %v", w.Code, w.Header())
				}
				return
			}
			var result map[string]string
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if w.Code != 503 || w.Header().Get("Retry-After") != "31" || w.Header().Get("Cache-Control") != "no-store" || result["code"] != "INFERENCE_STARTING" {
				t.Fatalf("cold response: %d %v %s", w.Code, w.Header(), w.Body)
			}
		})
	}
}
