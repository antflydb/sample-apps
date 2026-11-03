package sources

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3Config struct {
	Bucket          string `json:"bucket"`
	Prefix          string `json:"prefix,omitempty"`
	Region          string `json:"region,omitempty"`
	Endpoint        string `json:"endpoint,omitempty"` // empty for AWS; host[:port] or URL for S3-compatible stores
	AccessKeyID     string `json:"access_key_id,omitempty"`
	SecretAccessKey string `json:"secret_access_key,omitempty"`
	// AntflyFetch hands Antfly s3:// URLs instead of app URLs. Antfly's
	// remote_content config must then hold credentials for this bucket.
	AntflyFetch bool `json:"antfly_fetch,omitempty"`
}

type S3 struct {
	cfg    S3Config
	client *minio.Client
}

func NewS3(cfg S3Config) (*S3, error) {
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("s3: bucket is required")
	}
	endpoint, secure := "s3.amazonaws.com", true
	if cfg.Endpoint != "" {
		endpoint = cfg.Endpoint
		switch {
		case strings.HasPrefix(endpoint, "http://"):
			endpoint, secure = strings.TrimPrefix(endpoint, "http://"), false
		case strings.HasPrefix(endpoint, "https://"):
			endpoint = strings.TrimPrefix(endpoint, "https://")
		}
		endpoint = strings.TrimRight(endpoint, "/")
	}
	var creds *credentials.Credentials
	if cfg.AccessKeyID != "" {
		creds = credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, "")
	} else {
		creds = credentials.NewChainCredentials([]credentials.Provider{
			&credentials.EnvAWS{}, &credentials.FileAWSCredentials{}, &credentials.IAM{},
		})
	}
	client, err := minio.New(endpoint, &minio.Options{Creds: creds, Secure: secure, Region: cfg.Region})
	if err != nil {
		return nil, fmt.Errorf("s3: %w", err)
	}
	return &S3{cfg: cfg, client: client}, nil
}

func (s *S3) List(ctx context.Context) ([]Object, error) {
	var out []Object
	for o := range s.client.ListObjects(ctx, s.cfg.Bucket, minio.ListObjectsOptions{Prefix: s.cfg.Prefix, Recursive: true}) {
		if o.Err != nil {
			return nil, fmt.Errorf("s3: list %s: %w", s.cfg.Bucket, o.Err)
		}
		if strings.HasSuffix(o.Key, "/") || o.Size == 0 {
			continue
		}
		name := path.Base(o.Key)
		out = append(out, Object{
			Key:      o.Key,
			Path:     strings.TrimPrefix(o.Key, s.cfg.Prefix),
			Name:     name,
			MimeType: NormalizeMime(o.ContentType, name),
			Size:     o.Size,
			Version:  strings.Trim(o.ETag, `"`),
			Modified: o.LastModified,
		})
	}
	return out, nil
}

// Open returns a reader that issues one ranged GET from wherever it was
// last seeked to. HTTP range serving seeks to the end (for the size) and to
// the range start before reading, so nothing is fetched until it is needed.
func (s *S3) Open(ctx context.Context, obj Object) (Content, error) {
	return &s3Reader{ctx: ctx, s: s, key: obj.Key, size: obj.Size}, nil
}

type s3Reader struct {
	ctx  context.Context
	s    *S3
	key  string
	size int64
	pos  int64
	body io.ReadCloser
}

func (r *s3Reader) Read(p []byte) (int, error) {
	if r.pos >= r.size {
		return 0, io.EOF
	}
	if r.body == nil {
		opts := minio.GetObjectOptions{}
		if r.pos > 0 {
			if err := opts.SetRange(r.pos, r.size-1); err != nil {
				return 0, err
			}
		}
		core := minio.Core{Client: r.s.client}
		body, _, _, err := core.GetObject(r.ctx, r.s.cfg.Bucket, r.key, opts)
		if err != nil {
			return 0, fmt.Errorf("s3: get %s: %w", r.key, err)
		}
		r.body = body
	}
	n, err := r.body.Read(p)
	r.pos += int64(n)
	return n, err
}

func (r *s3Reader) Seek(offset int64, whence int) (int64, error) {
	var pos int64
	switch whence {
	case io.SeekStart:
		pos = offset
	case io.SeekCurrent:
		pos = r.pos + offset
	case io.SeekEnd:
		pos = r.size + offset
	}
	if pos < 0 {
		return 0, fmt.Errorf("s3: negative seek")
	}
	if pos != r.pos {
		r.Close()
		r.pos = pos
	}
	return pos, nil
}

func (r *s3Reader) Close() error {
	if r.body == nil {
		return nil
	}
	err := r.body.Close()
	r.body = nil
	return err
}
