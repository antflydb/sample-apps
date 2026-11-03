// Package catalog keeps the app's own records on local disk: the configured
// sources (with their credentials) and, per source, the files last written
// to Antfly. The ledger is what lets a sync update and delete precisely.
package catalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/antflydb/sample-apps/simple-file-search/internal/sources"
)

type Store struct {
	dir         string
	sourcesFile string
	mu          sync.Mutex
}

// Open uses dir for all records. sourcesFile, when set, replaces
// dir/sources.json, e.g. a secret mounted read-only in a hosted demo.
func Open(dir, sourcesFile string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "ledger"), 0o700); err != nil {
		return nil, err
	}
	if sourcesFile == "" {
		sourcesFile = filepath.Join(dir, "sources.json")
	}
	return &Store{dir: dir, sourcesFile: sourcesFile}, nil
}

func (s *Store) sourcesPath() string { return s.sourcesFile }

func (s *Store) Sources() ([]sources.Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readSources()
}

func (s *Store) readSources() ([]sources.Config, error) {
	b, err := os.ReadFile(s.sourcesPath())
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []sources.Config
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("%s: %w", s.sourcesPath(), err)
	}
	return out, nil
}

func (s *Store) Source(id string) (sources.Config, bool, error) {
	all, err := s.Sources()
	if err != nil {
		return sources.Config{}, false, err
	}
	for _, c := range all {
		if c.ID == id {
			return c, true, nil
		}
	}
	return sources.Config{}, false, nil
}

func (s *Store) AddSource(c sources.Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.readSources()
	if err != nil {
		return err
	}
	for _, e := range all {
		if e.ID == c.ID {
			return fmt.Errorf("a source with id %q already exists", c.ID)
		}
	}
	return writeJSON(s.sourcesPath(), append(all, c))
}

func (s *Store) RemoveSource(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.readSources()
	if err != nil {
		return err
	}
	kept := all[:0]
	for _, c := range all {
		if c.ID != id {
			kept = append(kept, c)
		}
	}
	if err := writeJSON(s.sourcesPath(), kept); err != nil {
		return err
	}
	err = os.Remove(s.ledgerPath(id))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (s *Store) ledgerPath(id string) string { return filepath.Join(s.dir, "ledger", id+".json") }

// Ledger returns the files last written to Antfly for a source, by key.
func (s *Store) Ledger(id string) (map[string]sources.Object, error) {
	b, err := os.ReadFile(s.ledgerPath(id))
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]sources.Object{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]sources.Object{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("%s: %w", s.ledgerPath(id), err)
	}
	return out, nil
}

func (s *Store) SaveLedger(id string, l map[string]sources.Object) error {
	return writeJSON(s.ledgerPath(id), l)
}

// SortedKeys is a small helper for deterministic batches.
func SortedKeys(m map[string]sources.Object) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// writeJSON replaces a file atomically, readable only by this user
// (sources.json holds credentials).
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), path)
}
