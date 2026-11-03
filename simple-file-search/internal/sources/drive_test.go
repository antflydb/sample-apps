package sources

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A public folder read with an API key: every call carries the key, listing
// recurses into subfolders, and downloads come through the cache.
func TestDriveAPIKey(t *testing.T) {
	files := map[string][]map[string]any{
		"root": {
			{"id": "sub", "name": "Sub", "mimeType": "application/vnd.google-apps.folder"},
			{"id": "img", "name": "DSCF3459.jpg", "mimeType": "image/jpeg", "size": "5", "md5Checksum": "abc", "modifiedTime": "2026-11-01T00:00:00Z"},
		},
		"sub": {
			{"id": "doc", "name": "Notes", "mimeType": "application/vnd.google-apps.document", "version": "7"},
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("key"); got != "k123" {
			t.Errorf("%s: key = %q", r.URL.Path, got)
		}
		if r.Header.Get("Authorization") != "" {
			t.Errorf("%s: unexpected Authorization header", r.URL.Path)
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/files"):
			q := r.URL.Query().Get("q")
			parent := strings.Split(strings.TrimPrefix(q, "'"), "'")[0]
			json.NewEncoder(w).Encode(map[string]any{"files": files[parent]})
		case strings.HasSuffix(r.URL.Path, "/files/img"):
			io.WriteString(w, "JPEG!")
		case strings.HasSuffix(r.URL.Path, "/files/doc/export"):
			io.WriteString(w, "hello")
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	t.Setenv("GOOGLE_API_KEY", "")
	d, err := NewDrive(context.Background(), DriveConfig{
		FolderID: "https://drive.google.com/drive/folders/root?usp=sharing",
		APIKey:   "k123",
		CacheDir: t.TempDir(),
		endpoint: srv.URL + "/drive/v3/",
	})
	if err != nil {
		t.Fatal(err)
	}
	objs, err := d.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(objs) != 2 {
		t.Fatalf("got %d objects: %+v", len(objs), objs)
	}
	want := map[string]string{"DSCF3459.jpg": "JPEG!", "Sub/Notes": "hello"}
	for _, o := range objs {
		c, err := d.Open(context.Background(), o)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(c)
		c.Close()
		if string(b) != want[o.Path] {
			t.Errorf("%s: got %q", o.Path, b)
		}
	}
}

// With no per-source credentials, GOOGLE_API_KEY is used.
func TestDriveEnvAPIKey(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Query().Get("key")
		io.WriteString(w, `{"files":[]}`)
	}))
	defer srv.Close()
	t.Setenv("GOOGLE_API_KEY", "envkey")
	d, err := NewDrive(context.Background(), DriveConfig{FolderID: "root", CacheDir: t.TempDir(), endpoint: srv.URL + "/drive/v3/"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.List(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got != "envkey" {
		t.Fatalf("key = %q", got)
	}
}
