package syncer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
	"github.com/antflydb/sample-apps/simple-file-search/internal/catalog"
	"github.com/antflydb/sample-apps/simple-file-search/internal/sources"
)

type fakeSource struct{ objs []sources.Object }

func (f *fakeSource) List(context.Context) ([]sources.Object, error) { return f.objs, nil }
func (f *fakeSource) Open(context.Context, sources.Object) (sources.Content, error) {
	return nil, nil
}

// fakeAntfly records batch writes.
type fakeAntfly struct {
	mu      sync.Mutex
	inserts map[string]map[string]any
	deletes []string
}

func (f *fakeAntfly) handler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Inserts map[string]map[string]any `json:"inserts"`
		Deletes []string                  `json:"deletes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.mu.Lock()
	defer f.mu.Unlock()
	for k, v := range body.Inserts {
		f.inserts[k] = v
	}
	f.deletes = append(f.deletes, body.Deletes...)
	w.Write([]byte(`{"status":"committed"}`))
}

func (f *fakeAntfly) reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inserts, f.deletes = map[string]map[string]any{}, nil
}

func keys(m map[string]map[string]any) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func obj(key, mime, version string, size int64) sources.Object {
	return sources.Object{Key: key, Path: key, Name: key, MimeType: mime, Version: version, Size: size, Modified: time.Unix(0, 0)}
}

func TestSyncWritesChangesAndDeletesGoneFiles(t *testing.T) {
	fa := &fakeAntfly{}
	fa.reset()
	srv := httptest.NewServer(http.HandlerFunc(fa.handler))
	defer srv.Close()

	store, err := catalog.Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	cfg := sources.Config{ID: "media", Kind: "s3", Name: "Media", S3: &sources.S3Config{Bucket: "b"}}
	if err := store.AddSource(cfg); err != nil {
		t.Fatal(err)
	}
	src := &fakeSource{objs: []sources.Object{
		obj("a.jpg", "image/jpeg", "1", 1000),
		obj("talk.mp3", "audio/mpeg", "1", 5<<20), // long: transcript only
		obj("clip.mp3", "audio/mpeg", "1", 100<<10),
		obj("report.pdf", "application/pdf", "1", 1000),
		obj("archive.zip", "application/zip", "1", 1000), // not indexable
	}}
	s := &Syncer{
		Antfly: antfly.New(srv.URL, ""), Store: store, Table: "files", PublicURL: "http://app",
		OpenSource: func(context.Context, sources.Config) (sources.Source, error) { return src, nil },
	}

	if err := s.Sync(context.Background(), "media"); err != nil {
		t.Fatal(err)
	}
	if got, want := keys(fa.inserts), []string{"media:a.jpg", "media:clip.mp3", "media:report.pdf", "media:talk.mp3"}; !equal(got, want) {
		t.Fatalf("first sync wrote %v, want %v", got, want)
	}
	img := fa.inserts["media:a.jpg"]
	if img["media_url"] != "http://app/files/media:a.jpg?v=1" || img["url"] != nil {
		t.Errorf("image row: media_url=%v url=%v", img["media_url"], img["url"])
	}
	if fa.inserts["media:talk.mp3"]["media_url"] != nil || fa.inserts["media:talk.mp3"]["url"] == nil {
		t.Errorf("long audio should be transcribed only: %v", fa.inserts["media:talk.mp3"])
	}
	if fa.inserts["media:clip.mp3"]["media_url"] == nil || fa.inserts["media:clip.mp3"]["url"] == nil {
		t.Errorf("short clip should get a vector and a transcript: %v", fa.inserts["media:clip.mp3"])
	}

	// Unchanged: nothing written.
	fa.reset()
	if err := s.Sync(context.Background(), "media"); err != nil {
		t.Fatal(err)
	}
	if len(fa.inserts) != 0 || len(fa.deletes) != 0 {
		t.Fatalf("no-op sync wrote %v, deleted %v", keys(fa.inserts), fa.deletes)
	}

	// One changed, one removed.
	fa.reset()
	src.objs = []sources.Object{
		obj("a.jpg", "image/jpeg", "2", 1000),
		obj("talk.mp3", "audio/mpeg", "1", 5<<20),
		obj("clip.mp3", "audio/mpeg", "1", 100<<10),
	}
	if err := s.Sync(context.Background(), "media"); err != nil {
		t.Fatal(err)
	}
	if got := keys(fa.inserts); !equal(got, []string{"media:a.jpg"}) {
		t.Errorf("changed file: wrote %v", got)
	}
	if !equal(fa.deletes, []string{"media:report.pdf"}) {
		t.Errorf("removed file: deleted %v", fa.deletes)
	}
	if st := s.Status("media"); st.State != "idle" || st.Files != 3 {
		t.Errorf("status = %+v", st)
	}

	// Purge deletes everything the source wrote.
	fa.reset()
	if err := s.Purge(context.Background(), "media"); err != nil {
		t.Fatal(err)
	}
	sort.Strings(fa.deletes)
	if !equal(fa.deletes, []string{"media:a.jpg", "media:clip.mp3", "media:talk.mp3"}) {
		t.Errorf("purge deleted %v", fa.deletes)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
