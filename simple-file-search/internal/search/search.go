// Package search turns a request (text, an image, or both, or "more like
// this") into one Antfly query over both indexes, grouped by file.
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
	"github.com/antflydb/sample-apps/simple-file-search/internal/index"
)

type Request struct {
	Text  string `json:"text"`
	Image string `json:"image"` // data: URI
	Like  string `json:"like"`  // file id
	Limit int    `json:"limit"`
}

type Response struct {
	TookMS  int64    `json:"took_ms"`
	Results []Result `json:"results"`
	// Like describes the file a "more like this" search started from, so a
	// page loaded from a URL can show its name and thumbnail.
	Like *LikeFile `json:"like,omitempty"`
}

type LikeFile struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	FileURL string `json:"file_url"`
}

type Result struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Kind     string  `json:"kind"`
	MimeType string  `json:"mime_type"`
	Source   Source  `json:"source"`
	Path     string  `json:"path"`
	FileURL  string  `json:"file_url"`
	WebURL   string  `json:"web_url"`
	Score    float64 `json:"score"`
	Matches  []Match `json:"matches"`

	rank float64 // Score plus fullTextBonus; ordering only
	// junkLead: the file's best-ranked passage is a scrap ("C-8", a row of
	// dots), so its similarity score came from noise, not content.
	junkLead bool
}

type Source struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type Match struct {
	Type    string `json:"type"` // page, segment, text
	Page    int    `json:"page,omitempty"`
	StartMS int64  `json:"start_ms"`
	EndMS   int64  `json:"end_ms"`
	Text    string `json:"text"`
}

// Like describes the file a "more like this" search starts from.
type Like struct {
	ID       string
	Title    string
	Version  string
	Kind     string // image, audio, pdf, ...
	FetchURL string // URL Antfly can fetch the file from
	Native   bool   // the file has a native media vector (image, short audio)
	// Open reads the file's bytes, for combining an image with words.
	Open func(ctx context.Context) (io.ReadCloser, error)
}

type Searcher struct {
	Antfly   *antfly.Client
	Table    string
	Embedder string
	// FileURL builds the browser-facing URL for a file.
	FileURL func(id, version string) string
	// LookupLike resolves a file id for "more like this".
	LookupLike func(id string) (Like, bool)
}

var docFields = []string{"title", "kind", "mime_type", "source_id", "source_kind", "source_name", "path", "web_url", "version"}

func (s *Searcher) Search(ctx context.Context, r Request) (*Response, error) {
	start := time.Now()
	limit := r.Limit
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	r.Text = strings.TrimSpace(r.Text)
	q := map[string]any{
		"table":   s.Table,
		"indexes": []string{index.MediaIndex, index.ChunksIndex},
		"fields":  docFields,
		"limit":   limit * 2,
		"hierarchy": map[string]any{"group_by": map[string]any{
			"level":   "source",
			"matches": map[string]any{"limit": 5, "fields": []string{"text", "_start_time_ms", "_end_time_ms"}},
		}},
	}

	exclude := ""
	var likeFile *LikeFile
	var parts []antfly.EmbedPart
	textQuery := r.Like == "" && r.Image == ""
	switch {
	case r.Like != "":
		like, ok := s.LookupLike(r.Like)
		if !ok {
			return nil, fmt.Errorf("unknown file %q", r.Like)
		}
		exclude = like.ID
		likeFile = &LikeFile{ID: like.ID, Title: like.Title, Kind: like.Kind, FileURL: s.FileURL(like.ID, like.Version)}
		if r.Text != "" {
			// Words refine the file, as they refine an uploaded image: both
			// become one query vector.
			vec, err := s.likeWithText(ctx, like, r.Text)
			if err != nil {
				return nil, err
			}
			q["embeddings"] = map[string]any{index.MediaIndex: vec, index.ChunksIndex: vec}
		} else if like.Native {
			// Embed the file itself, the same way it was indexed.
			q["semantic_search"] = like.FetchURL
			q["embedding_template"] = "{{remoteMedia url=this}}"
		} else {
			text, err := s.leadText(ctx, like.ID)
			if err != nil {
				return nil, err
			}
			if text == "" {
				return &Response{TookMS: time.Since(start).Milliseconds(), Results: []Result{}, Like: likeFile}, nil
			}
			parts = []antfly.EmbedPart{{Type: "text", Text: text}}
		}
	case r.Image != "" || r.Text != "":
		if r.Text != "" {
			parts = append(parts, antfly.EmbedPart{Type: "text", Text: r.Text})
		}
		if r.Image != "" {
			if !strings.HasPrefix(r.Image, "data:image/") {
				return nil, fmt.Errorf("image must be a data:image/... URI")
			}
			parts = append(parts, antfly.EmbedPart{Type: "image_url", ImageURL: map[string]string{"url": r.Image}})
		} else {
			q["full_text_search"] = map[string]any{"query": r.Text}
		}
	default:
		return &Response{Results: []Result{}}, nil
	}

	if len(parts) != 0 {
		// Embed once for both indexes so the caller can handle model startup
		// before the database query. Text-only searches still include full text.
		vec, err := s.Antfly.EmbedQuery(ctx, s.Embedder, parts)
		if err != nil {
			return nil, fmt.Errorf("embed query: %w", err)
		}
		q["embeddings"] = map[string]any{index.MediaIndex: vec, index.ChunksIndex: vec}
	}

	resp, err := s.Antfly.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	var results []Result
	best := 0.0
	for _, h := range resp.Hits.Hits {
		if h.ID == exclude {
			continue
		}
		res := s.result(h, textQuery)
		// A document hit that matched on a scrap of text ("C-8") matched on
		// noise: near-empty passages embed close to every query.
		if (res.Kind == "pdf" || res.Kind == "text") && (len(res.Matches) == 0 || res.junkLead) {
			continue
		}
		best = math.Max(best, res.Score)
		results = append(results, res)
	}
	// Rank fusion gives every index's best hit a high rank, even a poor one.
	// Every index uses the same embedding model, so cosine similarity is
	// comparable across them: rank by it, keep only results close to the
	// best, and let a full-text match break near-ties.
	sort.SliceStable(results, func(i, j int) bool { return results[i].rank > results[j].rank })
	out := &Response{Results: []Result{}, Like: likeFile}
	for _, res := range results {
		if res.Score < best-relevanceWindow {
			continue
		}
		out.Results = append(out.Results, res)
		if len(out.Results) == limit {
			break
		}
	}
	out.TookMS = time.Since(start).Milliseconds()
	return out, nil
}

// relevanceWindow is how far below the best cosine similarity a result may
// fall and still be shown. Tuned by eye on the NASA corpus with
// EmbeddingGemma 2: unrelated cross-modal hits sit 0.08 to 0.2 below.
const relevanceWindow = 0.08

// fullTextBonus lifts a file whose text also matched the words of the query.
const fullTextBonus = 0.02

// mediaCalibration puts text-to-image similarity on the same footing as
// text-to-text: with EmbeddingGemma 2, equally relevant photos score about
// 0.02 to 0.03 below equally relevant passages for the same text query.
const mediaCalibration = 0.02

// minEvidence is the shortest passage worth showing as evidence.
const minEvidence = 25

// readable reports whether a passage is prose a reader could use: long
// enough, mostly letters (not a table of figures or a row of dots), and
// split into words (some PDFs extract with no spaces at all).
func readable(text string) bool {
	if len(text) < minEvidence {
		return false
	}
	letters, words, long := 0, 0, 0
	for _, r := range text {
		if unicode.IsLetter(r) {
			letters++
		}
	}
	for _, w := range strings.Fields(text) {
		words++
		if len(w) > 24 {
			long++
		}
	}
	return letters*2 >= len(text) && long*4 < words
}

// likeWithText embeds a file together with words. Images go in as pixels;
// documents and recordings as the start of their text or transcript.
func (s *Searcher) likeWithText(ctx context.Context, like Like, text string) ([]float64, error) {
	parts := []antfly.EmbedPart{{Type: "text", Text: text}}
	if like.Kind == "image" && like.Open != nil {
		rc, err := like.Open(ctx)
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		uri, err := queryImage(rc, 1024)
		if err != nil {
			return nil, err
		}
		parts = append(parts, antfly.EmbedPart{Type: "image_url", ImageURL: map[string]string{"url": uri}})
	} else {
		lead, err := s.leadText(ctx, like.ID)
		if err != nil {
			return nil, err
		}
		if lead != "" {
			parts = append(parts, antfly.EmbedPart{Type: "text", Text: lead})
		}
	}
	vec, err := s.Antfly.EmbedQuery(ctx, s.Embedder, parts)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}
	return vec, nil
}

// leadText returns the start of a file's extracted text, used to find files
// like a PDF or transcript.
func (s *Searcher) leadText(ctx context.Context, id string) (string, error) {
	resp, err := s.Antfly.Query(ctx, map[string]any{
		"table":  s.Table,
		"fields": []string{"text"},
		"limit":  3,
		"hierarchy": map[string]any{"children": map[string]any{
			"parent": map[string]any{"level": "source", "id": id},
			"level":  "unit",
		}},
		"order_by": []map[string]any{{"field": "_hierarchy.position"}},
	})
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, h := range resp.Hits.Hits {
		if t, _ := h.Source["text"].(string); t != "" {
			b.WriteString(t)
			b.WriteString("\n")
		}
		if b.Len() > 2000 {
			break
		}
	}
	text := b.String()
	if len(text) > 2000 {
		text = text[:2000]
	}
	return strings.TrimSpace(text), nil
}

func str(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return s
}

func (s *Searcher) result(h antfly.Hit, textQuery bool) Result {
	src := h.Source
	res := Result{
		ID:       h.ID,
		Title:    str(src, "title"),
		Kind:     str(src, "kind"),
		MimeType: str(src, "mime_type"),
		Source:   Source{ID: str(src, "source_id"), Kind: str(src, "source_kind"), Name: str(src, "source_name")},
		Path:     str(src, "path"),
		WebURL:   str(src, "web_url"),
		FileURL:  s.FileURL(h.ID, str(src, "version")),
		Matches:  []Match{},
	}
	// Merged hits carry a rank-fusion score; the per-index cosine similarity
	// is the number that means something to a reader.
	for name, v := range h.IndexScores {
		if name != "full_text" {
			res.Score = math.Max(res.Score, v)
		}
	}
	res.rank = res.Score
	if _, ok := h.IndexScores["full_text"]; ok {
		res.rank += fullTextBonus
	}
	if textQuery && h.IndexScores[index.MediaIndex] >= res.Score {
		res.rank += mediaCalibration
	}
	res.Score = math.Round(res.Score*100) / 100

	var hier struct {
		Matches []antfly.Hit `json:"matches"`
	}
	if len(h.Hierarchy) > 0 {
		_ = json.Unmarshal(h.Hierarchy, &hier)
	}
	matches := hier.Matches
	if len(matches) == 0 && len(h.Matches) > 0 {
		_ = json.Unmarshal(h.Matches, &matches)
	}
	seen := map[string]bool{}
	lead := true // the next passage is the file's best-ranked one
	for _, m := range matches {
		if m.ID == h.ID {
			continue // the file itself, matched through its media vector
		}
		text := strings.Join(strings.Fields(str(m.Source, "text")), " ")
		first := lead
		lead = false
		if !readable(text) {
			res.junkLead = res.junkLead || first
			continue
		}
		// The same passage can match through both full-text and vectors.
		if seen[text] {
			continue
		}
		seen[text] = true
		if len(text) > 280 {
			text = text[:280] + "…"
		}
		var unit struct {
			ParentUnitID string `json:"parent_unit_id"`
		}
		_ = json.Unmarshal(m.Hierarchy, &unit)
		match := Match{Type: "text", Text: text}
		if startMS, ok := m.Source["_start_time_ms"].(float64); ok {
			match.Type, match.StartMS = "segment", int64(startMS)
			if endMS, ok := m.Source["_end_time_ms"].(float64); ok {
				match.EndMS = int64(endMS)
			}
		} else if p, ok := strings.CutPrefix(unit.ParentUnitID, "page:"); ok {
			if n, err := strconv.Atoi(p); err == nil {
				match.Type, match.Page = "page", n
			}
		}
		res.Matches = append(res.Matches, match)
	}
	return res
}
