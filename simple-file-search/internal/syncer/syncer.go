// Package syncer mirrors each source into the Antfly table: it lists the
// source, writes rows for new and changed files, and deletes rows for files
// that are gone. Antfly fetches the bytes and indexes them on its own.
package syncer

import (
	"context"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
	"github.com/antflydb/sample-apps/simple-file-search/internal/catalog"
	"github.com/antflydb/sample-apps/simple-file-search/internal/sources"
)

// embeddinggemma2 embeds at most 30 seconds of audio per part. Listings carry
// no duration, so size stands in for it: 480 KB is 30s of 128 kbps MP3.
// Longer recordings are still searchable through their transcripts.
const shortAudioMaxBytes = 480 << 10

const batchSize = 100

type Status struct {
	State      string         `json:"status"` // idle, syncing, error
	Error      string         `json:"error"`
	LastSynced *time.Time     `json:"last_synced_at"`
	Files      int            `json:"files"`
	ByKind     map[string]int `json:"by_kind"`
}

type Syncer struct {
	Antfly    *antfly.Client
	Store     *catalog.Store
	Table     string
	PublicURL string // where Antfly reaches this app's /files route
	CacheDir  string
	// OpenSource opens a configured source; nil means sources.Open.
	OpenSource func(context.Context, sources.Config) (sources.Source, error)

	mu      sync.Mutex
	status  map[string]*Status
	running map[string]bool
}

func (s *Syncer) Status(id string) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st, ok := s.status[id]; ok {
		cp := *st
		return cp
	}
	// Not synced since this process started: report what the ledger holds.
	st := Status{State: "idle", ByKind: map[string]int{}}
	if l, err := s.Store.Ledger(id); err == nil {
		for _, o := range l {
			st.Files++
			st.ByKind[sources.Kind(o.MimeType, o.Name)]++
		}
	}
	return st
}

func (s *Syncer) setStatus(id string, f func(*Status)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status == nil {
		s.status = map[string]*Status{}
	}
	st, ok := s.status[id]
	if !ok {
		st = &Status{State: "idle", ByKind: map[string]int{}}
		s.status[id] = st
	}
	f(st)
}

// Start syncs the source in the background unless a sync is already running.
func (s *Syncer) Start(id string) {
	s.mu.Lock()
	if s.running == nil {
		s.running = map[string]bool{}
	}
	if s.running[id] {
		s.mu.Unlock()
		return
	}
	s.running[id] = true
	s.mu.Unlock()
	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.running, id)
			s.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		defer cancel()
		if err := s.Sync(ctx, id); err != nil {
			slog.Error("sync failed", "source", id, "err", err)
		}
	}()
}

// Every starts a sync of all sources now and then on the interval.
func (s *Syncer) Every(ctx context.Context, interval time.Duration) {
	tick := func() {
		all, err := s.Store.Sources()
		if err != nil {
			slog.Error("read sources", "err", err)
			return
		}
		for _, c := range all {
			s.Start(c.ID)
		}
	}
	tick()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick()
		}
	}
}

func (s *Syncer) Sync(ctx context.Context, id string) (err error) {
	cfg, ok, err := s.Store.Source(id)
	if err != nil || !ok {
		return err
	}
	s.setStatus(id, func(st *Status) { st.State, st.Error = "syncing", "" })
	defer func() {
		s.setStatus(id, func(st *Status) {
			if err != nil {
				st.State, st.Error = "error", err.Error()
				return
			}
			now := time.Now().UTC()
			st.State, st.LastSynced = "idle", &now
		})
	}()

	if cfg.Drive != nil {
		cfg.Drive.CacheDir = s.CacheDir
	}
	open := s.OpenSource
	if open == nil {
		open = sources.Open
	}
	src, err := open(ctx, cfg)
	if err != nil {
		return err
	}
	listed, err := src.List(ctx)
	if err != nil {
		return err
	}
	ledger, err := s.Store.Ledger(id)
	if err != nil {
		return err
	}

	current := map[string]sources.Object{}
	byKind := map[string]int{}
	for _, o := range listed {
		kind := sources.Kind(o.MimeType, o.Name)
		if kind == "" {
			continue
		}
		current[o.Key] = o
		byKind[kind]++
	}
	s.setStatus(id, func(st *Status) { st.Files, st.ByKind = len(current), byKind })

	// Write new and changed files.
	inserts := map[string]map[string]any{}
	flush := func() error {
		if len(inserts) == 0 {
			return nil
		}
		if err := s.Antfly.Batch(ctx, s.Table, inserts, nil); err != nil {
			return err
		}
		for _, doc := range inserts {
			k := doc["key"].(string)
			ledger[k] = current[k]
		}
		inserts = map[string]map[string]any{}
		return s.Store.SaveLedger(id, ledger)
	}
	for _, k := range catalog.SortedKeys(current) {
		o := current[k]
		if prev, ok := ledger[k]; ok && prev.Version == o.Version && prev.Path == o.Path {
			continue
		}
		inserts[DocID(id, k)] = s.Document(cfg, o)
		if len(inserts) >= batchSize {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := flush(); err != nil {
		return err
	}

	// Delete files that are gone from the source.
	var gone []string
	for k := range ledger {
		if _, ok := current[k]; !ok {
			gone = append(gone, k)
		}
	}
	for len(gone) > 0 {
		n := min(batchSize, len(gone))
		ids := make([]string, n)
		for i, k := range gone[:n] {
			ids[i] = DocID(id, k)
		}
		if err := s.Antfly.Batch(ctx, s.Table, nil, ids); err != nil {
			return err
		}
		for _, k := range gone[:n] {
			delete(ledger, k)
		}
		if err := s.Store.SaveLedger(id, ledger); err != nil {
			return err
		}
		gone = gone[n:]
	}
	// Retry anything Antfly failed to fetch or extract since the last pass.
	if err := s.Antfly.RepairArtifacts(ctx, s.Table); err != nil {
		slog.Warn("repair", "err", err)
	}
	slog.Info("synced", "source", id, "files", len(current))
	return nil
}

// Purge deletes every row the source wrote.
func (s *Syncer) Purge(ctx context.Context, id string) error {
	ledger, err := s.Store.Ledger(id)
	if err != nil {
		return err
	}
	keys := catalog.SortedKeys(ledger)
	for len(keys) > 0 {
		n := min(batchSize, len(keys))
		ids := make([]string, n)
		for i, k := range keys[:n] {
			ids[i] = DocID(id, k)
		}
		if err := s.Antfly.Batch(ctx, s.Table, nil, ids); err != nil {
			return err
		}
		keys = keys[n:]
	}
	s.mu.Lock()
	delete(s.status, id)
	s.mu.Unlock()
	return nil
}

// DocID is the Antfly key for a file: "<source id>:<key in source>".
func DocID(sourceID, key string) string { return sourceID + ":" + key }

// SplitDocID reverses DocID.
func SplitDocID(docID string) (sourceID, key string, ok bool) {
	return strings.Cut(docID, ":")
}

// FileURL is the app route that streams a file's bytes.
func FileURL(base, docID, version string) string {
	u := strings.TrimRight(base, "/") + "/files/" + url.PathEscape(docID)
	if version != "" {
		u += "?v=" + url.QueryEscape(version)
	}
	return u
}

// Document is the Antfly row for a file.
func (s *Syncer) Document(cfg sources.Config, o sources.Object) map[string]any {
	kind := sources.Kind(o.MimeType, o.Name)
	fetch := cfg.NativeURL(o)
	if fetch == "" {
		fetch = FileURL(s.PublicURL, DocID(cfg.ID, o.Key), o.Version)
	}
	doc := map[string]any{
		"source_id":   cfg.ID,
		"source_kind": cfg.Kind,
		"source_name": cfg.Name,
		"key":         o.Key,
		"path":        o.Path,
		"title":       o.Name,
		"filename":    o.Name,
		"mime_type":   o.MimeType,
		"kind":        kind,
		"size":        o.Size,
		"version":     o.Version,
		"modified":    o.Modified.UTC().Format(time.RFC3339),
	}
	if o.WebURL != "" {
		doc["web_url"] = o.WebURL
	}
	switch kind {
	case "image":
		doc["media_url"] = fetch
	case "audio":
		doc["url"] = fetch // transcript passages with timestamps
		if o.Size <= shortAudioMaxBytes {
			doc["media_url"] = fetch // plus a native audio vector
		}
	default: // pdf, text, video (audio track is transcribed)
		doc["url"] = fetch
	}
	return doc
}
