// Package index owns the Antfly table layout: one table of files, whose
// enrichments turn each file into searchable vectors and passages.
//
//	file row ── media_url ──► "media" index: one embeddinggemma2 vector per image
//	         │                                (and per audio clip of 30s or less)
//	         └─ url ──► document_units (PDF pages, audio transcripts, text)
//	                      └─► document_chunks ──► full-text + "chunks" index
package index

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
)

const (
	MediaIndex  = "media"
	ChunksIndex = "chunks"
	Dimensions  = 768
)

type Models struct {
	Embedder    string // e.g. google/embeddinggemma-2:bf16-safetensors-bundle-v1
	Transcriber string // e.g. openai/whisper-small; empty disables transcription
}

// Ensure creates the table, enrichments, and indexes when the table is missing.
// An existing table is left alone; change the layout by recreating the table.
func Ensure(ctx context.Context, c *antfly.Client, table string, m Models) error {
	ok, err := c.TableExists(ctx, table)
	if err != nil {
		return fmt.Errorf("check table: %w", err)
	}
	// Each step checks what already exists, so a run that failed partway
	// (Antfly still loading models, say) is finished by the next attempt.
	if !ok {
		if err := c.CreateTable(ctx, table, map[string]any{"num_shards": 1}); err != nil {
			return fmt.Errorf("create table: %w", err)
		}
	}

	extraction := map[string]any{
		"source": map[string]any{"content_type_field": "mime_type", "filename_field": "filename"},
	}
	if m.Transcriber != "" {
		extraction["transcription"] = map[string]any{
			"transcriber": map[string]any{"provider": "antfly", "model": m.Transcriber},
		}
	}
	producer, _ := json.Marshal(map[string]any{"type": "document_extraction", "config": extraction})
	if err := c.PutEnrichment(ctx, table, "document_units", map[string]any{
		"kind":          "asset",
		"field":         "url",
		"content_type":  "application/json",
		"producer_json": string(producer),
	}); err != nil {
		return fmt.Errorf("document_units enrichment: %w", err)
	}
	if err := c.PutEnrichment(ctx, table, "document_chunks", map[string]any{
		"kind":                 "chunk",
		"source_artifact_name": "document_units",
		"field":                "text",
		"chunk_size":           256,
		"full_text_index":      true,
	}); err != nil {
		return fmt.Errorf("document_chunks enrichment: %w", err)
	}

	embedder := map[string]any{"provider": "antfly", "model": m.Embedder}
	if err := ensureIndex(ctx, c, table, ChunksIndex, map[string]any{
		"type":            "embeddings",
		"dimension":       Dimensions,
		"distance_metric": "cosine",
		"coverage_policy": "partial", // images have no text; that is expected
		"embedder":        embedder,
		"sources":         []map[string]any{{"artifact": "chunk_vectors"}},
		"enrichments": []map[string]any{{
			"name":                 "chunk_vectors",
			"kind":                 "embedding",
			"field":                "text",
			"source_artifact_name": "document_chunks",
			"expected_dims":        Dimensions,
		}},
	}); err != nil {
		return fmt.Errorf("chunks index: %w", err)
	}
	if err := ensureIndex(ctx, c, table, MediaIndex, map[string]any{
		"type":            "embeddings",
		"dimension":       Dimensions,
		"distance_metric": "cosine",
		"coverage_policy": "partial",
		"embedder":        embedder,
		"template":        "{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}",
	}); err != nil {
		return fmt.Errorf("media index: %w", err)
	}
	return nil
}

func ensureIndex(ctx context.Context, c *antfly.Client, table, name string, body map[string]any) error {
	ok, err := c.IndexExists(ctx, table, name)
	if err != nil || ok {
		return err
	}
	return c.CreateIndex(ctx, table, name, body)
}
