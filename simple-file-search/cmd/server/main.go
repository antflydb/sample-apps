// Command server runs the app: sync workers, the search API, and the UI.
// Configuration is environment variables; see README.md.
package main

import (
	"context"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
	"github.com/antflydb/sample-apps/simple-file-search/internal/catalog"
	"github.com/antflydb/sample-apps/simple-file-search/internal/index"
	"github.com/antflydb/sample-apps/simple-file-search/internal/search"
	"github.com/antflydb/sample-apps/simple-file-search/internal/server"
	"github.com/antflydb/sample-apps/simple-file-search/internal/sources"
	"github.com/antflydb/sample-apps/simple-file-search/internal/syncer"
	"github.com/antflydb/sample-apps/simple-file-search/web"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	listen := env("LISTEN", "127.0.0.1:8090")
	publicURL := env("PUBLIC_URL", "http://"+listen)
	antflyURL := env("ANTFLY_URL", "http://127.0.0.1:8080")
	table := env("TABLE", "files")
	embedder := env("EMBEDDER", "google/embeddinggemma-2:bf16-safetensors-bundle-v1")
	transcriber := env("TRANSCRIBER", "openai/whisper-small")
	if transcriber == "none" {
		transcriber = ""
	}
	dataDir := env("DATA_DIR", "data")
	demo, _ := strconv.ParseBool(env("DEMO", "false"))
	interval, err := time.ParseDuration(env("SYNC_INTERVAL", "15m"))
	if err != nil {
		slog.Error("SYNC_INTERVAL", "err", err)
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := antfly.New(antflyURL, os.Getenv("ANTFLY_API_KEY"))
	// Antfly may still be starting (e.g. alongside this app in containers): retry for a while.
	for attempt := 1; ; attempt++ {
		err := index.Ensure(ctx, client, table, index.Models{Embedder: embedder, Transcriber: transcriber})
		if err == nil {
			break
		}
		if attempt == 30 || ctx.Err() != nil {
			slog.Error("set up Antfly table", "antfly", antflyURL, "err", err)
			os.Exit(1)
		}
		slog.Warn("waiting for Antfly", "antfly", antflyURL, "err", err)
		time.Sleep(5 * time.Second)
	}
	store, err := catalog.Open(dataDir, os.Getenv("SOURCES_FILE"))
	if err != nil {
		slog.Error("open data dir", "err", err)
		os.Exit(1)
	}
	cacheDir := filepath.Join(dataDir, "cache")
	sync := &syncer.Syncer{Antfly: client, Store: store, Table: table, PublicURL: publicURL, CacheDir: cacheDir}

	srv := &server.Server{
		Antfly:   client,
		Store:    store,
		Syncer:   sync,
		Table:    table,
		Demo:     demo,
		RepoURL:  env("REPO_URL", "https://github.com/antflydb/sample-apps/tree/main/simple-file-search"),
		CacheDir: cacheDir,
	}
	if ui, err := fs.Sub(web.Dist, "dist"); err == nil {
		if _, err := fs.Stat(ui, "index.html"); err == nil {
			srv.UI = ui
		}
	}
	srv.Searcher = &search.Searcher{
		Antfly:   client,
		Table:    table,
		Embedder: embedder,
		FileURL:  func(id, version string) string { return syncer.FileURL("", id, version) },
		LookupLike: func(id string) (search.Like, bool) {
			cfg, obj, ok := srv.Lookup(id)
			if !ok {
				return search.Like{}, false
			}
			doc := sync.Document(cfg, obj)
			mediaURL, _ := doc["media_url"].(string)
			return search.Like{
				ID:       id,
				Title:    obj.Name,
				Version:  obj.Version,
				Kind:     sources.Kind(obj.MimeType, obj.Name),
				FetchURL: mediaURL,
				Native:   mediaURL != "",
				Open: func(ctx context.Context) (io.ReadCloser, error) {
					c, _, err := srv.OpenFile(ctx, id)
					return c, err
				},
			}, true
		},
	}

	go sync.Every(ctx, interval)

	httpServer := &http.Server{Addr: listen, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	slog.Info("listening", "addr", listen, "antfly", antflyURL, "table", table, "demo", demo)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("serve", "err", err)
		os.Exit(1)
	}
}
