// Package antfly is a small client for the parts of the Antfly HTTP API this
// app uses: table and index setup, batch writes, queries, and query embeddings.
package antfly

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	base   string // e.g. http://127.0.0.1:8080
	apiKey string
	http   *http.Client
}

func New(baseURL, apiKey string) *Client {
	return &Client{
		base:   strings.TrimRight(baseURL, "/"),
		apiKey: apiKey,
		http:   &http.Client{Timeout: 10 * time.Minute},
	}
}

// Error is a non-2xx response from Antfly.
type Error struct {
	Status int
	Body   string
}

func (e *Error) Error() string { return fmt.Sprintf("antfly: %d: %s", e.Status, e.Body) }

// StartupRetrySeconds reports the server's retry hint for a confirmed cold start.
func (e *Error) StartupRetrySeconds() int64 {
	if e.Status != http.StatusServiceUnavailable {
		return 0
	}
	var body struct {
		Code         string `json:"error"`
		Retryable    bool   `json:"retryable"`
		RetryAfterMS int64  `json:"retry_after_ms"`
	}
	if json.Unmarshal([]byte(e.Body), &body) != nil || body.Code != "INFERENCE_STARTING" || !body.Retryable || body.RetryAfterMS <= 0 {
		return 0
	}
	return 1 + (body.RetryAfterMS-1)/1000
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return &Error{Status: resp.StatusCode, Body: strings.TrimSpace(string(raw))}
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func tablePath(table string) string { return "/db/v1/tables/" + url.PathEscape(table) }

// TableExists reports whether the table is present.
func (c *Client) TableExists(ctx context.Context, table string) (bool, error) {
	err := c.do(ctx, http.MethodGet, tablePath(table), nil, nil)
	var ae *Error
	if err == nil {
		return true, nil
	}
	if asError(err, &ae) && ae.Status == http.StatusNotFound {
		return false, nil
	}
	return false, err
}

func (c *Client) CreateTable(ctx context.Context, table string, body map[string]any) error {
	return c.do(ctx, http.MethodPost, tablePath(table), body, nil)
}

// PutEnrichment declares a table-level artifact enrichment.
func (c *Client) PutEnrichment(ctx context.Context, table, artifact string, body map[string]any) error {
	return c.do(ctx, http.MethodPut, tablePath(table)+"/artifacts/"+url.PathEscape(artifact)+"/enrichment", body, nil)
}

func (c *Client) CreateIndex(ctx context.Context, table, index string, body map[string]any) error {
	return c.do(ctx, http.MethodPost, tablePath(table)+"/indexes/"+url.PathEscape(index), body, nil)
}

// IndexExists reports whether the index is present.
func (c *Client) IndexExists(ctx context.Context, table, index string) (bool, error) {
	err := c.do(ctx, http.MethodGet, tablePath(table)+"/indexes/"+url.PathEscape(index), nil, nil)
	var ae *Error
	if err == nil {
		return true, nil
	}
	if asError(err, &ae) && ae.Status == http.StatusNotFound {
		return false, nil
	}
	return false, err
}

// IndexStatus returns the raw index description including runtime status.
func (c *Client) IndexStatus(ctx context.Context, table, index string) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, http.MethodGet, tablePath(table)+"/indexes/"+url.PathEscape(index), nil, &out)
	return out, err
}

// Batch writes inserts (full documents, keyed) and deletes in one request.
func (c *Client) Batch(ctx context.Context, table string, inserts map[string]map[string]any, deletes []string) error {
	body := map[string]any{}
	if len(inserts) > 0 {
		body["inserts"] = inserts
	}
	if len(deletes) > 0 {
		body["deletes"] = deletes
	}
	if len(body) == 0 {
		return nil
	}
	return c.do(ctx, http.MethodPost, tablePath(table)+"/batch", body, nil)
}

// RepairArtifacts reprocesses failed enrichment work (for example a fetch
// that failed transiently) in one bounded pass.
func (c *Client) RepairArtifacts(ctx context.Context, table string) error {
	return c.do(ctx, http.MethodPost, tablePath(table)+"/repair/run", map[string]any{"target": "artifact", "limit": 500}, nil)
}

// Query runs a query and returns the first response.
func (c *Client) Query(ctx context.Context, body map[string]any) (*QueryResponse, error) {
	var out struct {
		Responses []QueryResponse `json:"responses"`
	}
	if err := c.do(ctx, http.MethodPost, "/db/v1/query", body, &out); err != nil {
		return nil, err
	}
	if len(out.Responses) == 0 {
		return &QueryResponse{}, nil
	}
	r := out.Responses[0]
	if r.Error != "" {
		return nil, fmt.Errorf("antfly query: %s", r.Error)
	}
	return &r, nil
}

type QueryResponse struct {
	Took  int64  `json:"took"`
	Error string `json:"error"`
	Hits  struct {
		Total struct {
			Value int `json:"value"`
		} `json:"total"`
		Hits []Hit `json:"hits"`
	} `json:"hits"`
}

type Hit struct {
	ID          string             `json:"_id"`
	Score       float64            `json:"_score"`
	IndexScores map[string]float64 `json:"_index_scores"`
	Source      map[string]any     `json:"_source"`
	Hierarchy   json.RawMessage    `json:"hierarchy"`
	Matches     json.RawMessage    `json:"matches"`
}

// EmbedPart is one ordered part of a grouped embedding input.
type EmbedPart struct {
	Type     string            `json:"type"`
	Text     string            `json:"text,omitempty"`
	ImageURL map[string]string `json:"image_url,omitempty"`
}

// EmbedQuery embeds text and media parts as one group (one vector) with the
// retrieval-query role, for composed text+image search.
func (c *Client) EmbedQuery(ctx context.Context, model string, parts []EmbedPart) ([]float64, error) {
	body := map[string]any{
		"model":     model,
		"task_type": "RETRIEVAL_QUERY",
		"input":     []map[string]any{{"content": parts}},
	}
	var out struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/ai/v1/embed", body, &out); err != nil {
		return nil, err
	}
	if len(out.Data) != 1 {
		return nil, fmt.Errorf("antfly embed: expected 1 vector, got %d", len(out.Data))
	}
	return out.Data[0].Embedding, nil
}

func asError(err error, target **Error) bool {
	e, ok := err.(*Error)
	if ok {
		*target = e
	}
	return ok
}
