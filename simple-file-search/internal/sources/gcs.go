package sources

import (
	"context"
	"fmt"
	"io"
	"math"
	"path"
	"strconv"
	"strings"
	"time"

	"google.golang.org/api/option"
	"google.golang.org/api/storage/v1"
)

// GCSConfig uses the host's Application Default Credentials. Source files
// contain only a bucket and object-name prefix, never Google credentials.
type GCSConfig struct {
	Bucket string `json:"bucket"`
	Prefix string `json:"prefix,omitempty"`
}

type GCS struct {
	cfg GCSConfig
	svc *storage.Service
}

func NewGCS(ctx context.Context, cfg GCSConfig) (*GCS, error) {
	return newGCS(ctx, cfg)
}

func newGCS(ctx context.Context, cfg GCSConfig, opts ...option.ClientOption) (*GCS, error) {
	if cfg.Bucket == "" || strings.ContainsAny(cfg.Bucket, "/\\\r\n") || strings.TrimSpace(cfg.Bucket) != cfg.Bucket {
		return nil, fmt.Errorf("gcs: a bucket name is required (without gs:// or a path)")
	}
	opts = append([]option.ClientOption{option.WithScopes(storage.DevstorageReadOnlyScope)}, opts...)
	svc, err := storage.NewService(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("gcs: initialize credentials: %w", err)
	}
	return &GCS{cfg: cfg, svc: svc}, nil
}

func (g *GCS) List(ctx context.Context) ([]Object, error) {
	var out []Object
	err := g.svc.Objects.List(g.cfg.Bucket).Prefix(g.cfg.Prefix).Versions(false).
		Pages(ctx, func(page *storage.Objects) error {
			for _, o := range page.Items {
				if !strings.HasPrefix(o.Name, g.cfg.Prefix) || strings.HasSuffix(o.Name, "/") || o.Size == 0 {
					continue
				}
				if o.Size > math.MaxInt64 || o.Generation <= 0 {
					return fmt.Errorf("gcs: invalid object size or generation")
				}
				if o.ContentEncoding != "" && o.ContentEncoding != "identity" {
					return fmt.Errorf("gcs: content-encoded objects cannot be served with stable byte ranges")
				}
				modified, err := time.Parse(time.RFC3339Nano, o.Updated)
				if err != nil {
					return fmt.Errorf("gcs: invalid object modification time")
				}
				name := path.Base(o.Name)
				out = append(out, Object{Key: o.Name, Path: strings.TrimPrefix(o.Name, g.cfg.Prefix),
					Name: name, MimeType: NormalizeMime(o.ContentType, name), Size: int64(o.Size),
					Version: strconv.FormatInt(o.Generation, 10), Modified: modified})
			}
			return nil
		})
	if err != nil {
		return nil, fmt.Errorf("gcs: list: %w", err)
	}
	return out, nil
}

func (g *GCS) Open(ctx context.Context, obj Object) (Content, error) {
	generation, err := strconv.ParseInt(obj.Version, 10, 64)
	if err != nil || generation <= 0 || obj.Size < 0 || !strings.HasPrefix(obj.Key, g.cfg.Prefix) {
		return nil, fmt.Errorf("gcs: invalid object generation, size, or prefix")
	}
	return &gcsReader{ctx: ctx, g: g, obj: obj, generation: generation}, nil
}

// A new ranged read after each seek is pinned to the listed generation. A
// replaced or deleted object must not silently return a newer file's bytes.
type gcsReader struct {
	ctx        context.Context
	g          *GCS
	obj        Object
	generation int64
	pos        int64
	body       io.ReadCloser
	closed     bool
}

func (r *gcsReader) Read(p []byte) (int, error) {
	if r.closed {
		return 0, fmt.Errorf("gcs: read after close")
	}
	if len(p) == 0 {
		return 0, nil
	}
	if r.pos >= r.obj.Size {
		return 0, io.EOF
	}
	if r.body == nil {
		call := r.g.svc.Objects.Get(r.g.cfg.Bucket, r.obj.Key).Generation(r.generation).Context(r.ctx)
		call.Header().Set("Range", fmt.Sprintf("bytes=%d-%d", r.pos, r.obj.Size-1))
		resp, err := call.Download()
		if err != nil {
			return 0, fmt.Errorf("gcs: read generation: %w", err)
		}
		if resp.StatusCode != 206 && !(r.pos == 0 && resp.StatusCode == 200) {
			resp.Body.Close()
			return 0, fmt.Errorf("gcs: server did not honor requested range")
		}
		if resp.StatusCode == 206 {
			var start, end, total int64
			_, err := fmt.Sscanf(resp.Header.Get("Content-Range"), "bytes %d-%d/%d", &start, &end, &total)
			if err != nil || start != r.pos || end != r.obj.Size-1 || total != r.obj.Size {
				resp.Body.Close()
				return 0, fmt.Errorf("gcs: unexpected response byte range")
			}
		}
		r.body = resp.Body
	}
	if remaining := r.obj.Size - r.pos; int64(len(p)) > remaining {
		p = p[:remaining]
	}
	n, err := r.body.Read(p)
	r.pos += int64(n)
	if err == io.EOF && r.pos < r.obj.Size {
		err = io.ErrUnexpectedEOF
	}
	return n, err
}

func (r *gcsReader) Seek(offset int64, whence int) (int64, error) {
	if r.closed {
		return r.pos, fmt.Errorf("gcs: seek after close")
	}
	var base int64
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		base = r.pos
	case io.SeekEnd:
		base = r.obj.Size
	default:
		return r.pos, fmt.Errorf("gcs: invalid seek origin")
	}
	if (offset > 0 && base > math.MaxInt64-offset) || offset < -base {
		return r.pos, fmt.Errorf("gcs: invalid seek offset")
	}
	pos := base + offset
	if pos != r.pos && r.body != nil {
		r.body.Close()
		r.body = nil
	}
	r.pos = pos
	return pos, nil
}

func (r *gcsReader) Close() error {
	r.closed = true
	if r.body != nil {
		err := r.body.Close()
		r.body = nil
		return err
	}
	return nil
}
