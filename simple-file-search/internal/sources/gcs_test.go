package sources

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/api/option"
)

func TestGCSPagesGenerationsAndRanges(t *testing.T) {
	ctx := context.Background()
	generation, reads := "41", 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("alt") == "media" {
			reads++
			if r.URL.Query().Get("generation") != "41" {
				t.Errorf("read lost original generation: %s", r.URL)
			}
			var start, end int
			if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
				t.Error(err)
			}
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/10", start, end))
			w.WriteHeader(206)
			fmt.Fprint(w, "0123456789"[start:end+1])
			return
		}
		if r.URL.Query().Get("prefix") != "docs/" {
			t.Errorf("missing prefix: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("pageToken") == "next" {
			fmt.Fprint(w, `{"items":[{"name":"docs/","size":"0"},{"name":"outside/a","size":"1"}]}`)
		} else {
			fmt.Fprintf(w, `{"nextPageToken":"next","items":[{"name":"docs/a file.pdf","size":"10","generation":"%s","updated":"2026-01-01T00:00:00Z","contentType":"application/pdf"}]}`, generation)
		}
	}))
	defer srv.Close()
	g, err := newGCS(ctx, GCSConfig{Bucket: "example-documents", Prefix: "docs/"}, option.WithEndpoint(srv.URL+"/"), option.WithoutAuthentication())
	if err != nil {
		t.Fatal(err)
	}
	objects, err := g.List(ctx)
	if err != nil || len(objects) != 1 {
		t.Fatalf("list: %v %v", objects, err)
	}
	o := objects[0]
	if o.Path != "a file.pdf" || o.Version != "41" || o.Size != 10 {
		t.Fatalf("metadata: %+v", o)
	}
	generation = "42"
	changed, err := g.List(ctx)
	if err != nil || changed[0].Version != "42" {
		t.Fatalf("replacement: %v %v", changed, err)
	}
	r, err := g.Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err = r.Seek(0, io.SeekEnd); err != nil || reads != 0 {
		t.Fatalf("seek should be lazy: %v", err)
	}
	for _, tc := range []struct {
		offset int64
		whence int
		want   string
	}{{-4, io.SeekEnd, "6789"}, {1, io.SeekStart, "123456789"}} {
		if _, err := r.Seek(tc.offset, tc.whence); err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(r)
		if err != nil || string(b) != tc.want {
			t.Fatalf("read: %q %v", b, err)
		}
	}
	for _, tc := range []struct {
		offset int64
		whence int
	}{{-1, io.SeekStart}, {math.MaxInt64, io.SeekCurrent}, {0, 100}} {
		if _, err := r.Seek(tc.offset, tc.whence); err == nil {
			t.Fatal("invalid seek accepted")
		}
	}
}

func TestGCSReadFailuresDoNotServeDifferentBytes(t *testing.T) {
	for _, status := range []int{403, 404, 200, 206} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status); fmt.Fprint(w, "0123456789") }))
			defer srv.Close()
			g, err := newGCS(context.Background(), GCSConfig{Bucket: "example-documents", Prefix: "docs/"}, option.WithEndpoint(srv.URL+"/"), option.WithoutAuthentication())
			if err != nil {
				t.Fatal(err)
			}
			r, err := g.Open(context.Background(), Object{Key: "docs/a", Version: "1", Size: 10})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			r.Seek(2, io.SeekStart)
			if b, err := io.ReadAll(r); err == nil || len(b) != 0 {
				t.Fatalf("unexpected bytes: %q %v", b, err)
			}
			for _, o := range []Object{{Key: "docs/a", Version: "0"}, {Key: "outside/a", Version: "1"}} {
				if _, err := g.Open(context.Background(), o); err == nil {
					t.Fatal("invalid object accepted")
				}
			}
		})
	}
	if _, err := NewGCS(context.Background(), GCSConfig{Bucket: "gs://invalid"}); err == nil || !strings.Contains(err.Error(), "bucket name") {
		t.Fatal(err)
	}
}
