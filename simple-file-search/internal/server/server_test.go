package server

import (
	"github.com/antflydb/sample-apps/simple-file-search/internal/catalog"
	"github.com/antflydb/sample-apps/simple-file-search/internal/sources"
	"github.com/antflydb/sample-apps/simple-file-search/internal/syncer"
	"net/http/httptest"
	"strings"
	"testing"
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
