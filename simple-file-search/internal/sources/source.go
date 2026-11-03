// Package sources lists files in remote stores and streams their bytes.
// Listing returns metadata only; Antfly fetches content when it indexes.
package sources

import (
	"context"
	"fmt"
	"io"
	"mime"
	"path"
	"strings"
	"time"
)

// Object is one file in a source.
type Object struct {
	Key      string    `json:"key"`  // stable identity within the source (S3 key, Drive file ID)
	Path     string    `json:"path"` // human path within the source
	Name     string    `json:"name"`
	MimeType string    `json:"mime_type"` // type of the bytes Open returns
	Size     int64     `json:"size"`
	Version  string    `json:"version"` // changes whenever the content changes
	Modified time.Time `json:"modified"`
	WebURL   string    `json:"web_url,omitempty"`
	Export   bool      `json:"export,omitempty"` // Google-native file, served as an export to MimeType
}

// Content is an open file. Seeking lets the HTTP layer serve byte ranges,
// which Antfly and browsers both use for media.
type Content interface {
	io.ReadSeekCloser
}

type Source interface {
	List(ctx context.Context) ([]Object, error)
	Open(ctx context.Context, obj Object) (Content, error)
}

// Config is a saved source. Secrets live here, on the app's disk, never in Antfly.
type Config struct {
	ID        string       `json:"id"`
	Kind      string       `json:"kind"` // "s3" or "drive"
	Name      string       `json:"name"`
	S3        *S3Config    `json:"s3,omitempty"`
	Drive     *DriveConfig `json:"drive,omitempty"`
	CreatedAt time.Time    `json:"created_at"`
}

func (c Config) Location() string {
	switch c.Kind {
	case "s3":
		return "s3://" + path.Join(c.S3.Bucket, c.S3.Prefix) + "/"
	case "drive":
		return "https://drive.google.com/drive/folders/" + c.Drive.FolderID
	}
	return ""
}

// NativeURL returns a URL Antfly can fetch itself (s3://bucket/key), or ""
// when Antfly should fetch through this app.
func (c Config) NativeURL(o Object) string {
	if c.Kind == "s3" && c.S3 != nil && c.S3.AntflyFetch {
		return "s3://" + c.S3.Bucket + "/" + o.Key
	}
	return ""
}

func Open(ctx context.Context, c Config) (Source, error) {
	switch c.Kind {
	case "s3":
		if c.S3 == nil {
			return nil, fmt.Errorf("s3 source %q has no s3 settings", c.ID)
		}
		return NewS3(*c.S3)
	case "drive":
		if c.Drive == nil {
			return nil, fmt.Errorf("drive source %q has no drive settings", c.ID)
		}
		return NewDrive(ctx, *c.Drive)
	}
	return nil, fmt.Errorf("unknown source kind %q", c.Kind)
}

// Kind classifies a file by what the index can do with it. "" means skip.
func Kind(mimeType, name string) string {
	mt := strings.ToLower(mimeType)
	if mt == "" || mt == "application/octet-stream" {
		mt = mime.TypeByExtension(strings.ToLower(path.Ext(name)))
	}
	if i := strings.IndexByte(mt, ';'); i >= 0 {
		mt = mt[:i]
	}
	switch {
	case mt == "image/jpeg", mt == "image/png", mt == "image/webp":
		return "image"
	case strings.HasPrefix(mt, "audio/"):
		return "audio"
	case strings.HasPrefix(mt, "video/"):
		return "video"
	case mt == "application/pdf":
		return "pdf"
	case strings.HasPrefix(mt, "text/"),
		mt == "application/json",
		mt == "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		mt == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return "text"
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".md", ".markdown", ".txt":
		return "text"
	}
	return ""
}

// NormalizeMime fills a missing content type from the file name.
func NormalizeMime(mimeType, name string) string {
	if mimeType != "" && mimeType != "application/octet-stream" && mimeType != "binary/octet-stream" {
		return mimeType
	}
	if t := mime.TypeByExtension(strings.ToLower(path.Ext(name))); t != "" {
		return t
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".md", ".markdown":
		return "text/markdown"
	}
	return "application/octet-stream"
}
