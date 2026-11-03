package sources

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type DriveConfig struct {
	FolderID string `json:"folder_id"`
	// CredentialsJSON is a service-account key, for private folders. Share the
	// folder with the account's client_email (read access is enough).
	CredentialsJSON string `json:"credentials_json,omitempty"`
	// APIKey reads folders shared as "Anyone with the link". It needs the
	// Drive API enabled on the key's project.
	APIKey   string `json:"api_key,omitempty"`
	CacheDir string `json:"-"`
	endpoint string // tests point this at a fake Drive API
}

// Google-native files have no bytes of their own; export them as text.
var driveExports = map[string]string{
	"application/vnd.google-apps.document":     "text/plain",
	"application/vnd.google-apps.presentation": "text/plain",
	"application/vnd.google-apps.spreadsheet":  "text/csv",
}

var folderURL = regexp.MustCompile(`/folders/([A-Za-z0-9_-]+)`)

// ParseFolderID accepts a folder ID or a Drive folder URL.
func ParseFolderID(s string) string {
	s = strings.TrimSpace(s)
	if m := folderURL.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	if i := strings.Index(s, "id="); i >= 0 {
		s = s[i+3:]
		if j := strings.IndexByte(s, '&'); j >= 0 {
			s = s[:j]
		}
	}
	return s
}

type Drive struct {
	cfg DriveConfig
	svc *drive.Service
}

func NewDrive(ctx context.Context, cfg DriveConfig) (*Drive, error) {
	cfg.FolderID = ParseFolderID(cfg.FolderID)
	if cfg.FolderID == "" {
		return nil, fmt.Errorf("drive: folder is required")
	}
	apiKey := cfg.APIKey
	if apiKey == "" && cfg.CredentialsJSON == "" {
		apiKey = os.Getenv("GOOGLE_API_KEY")
	}
	var auth option.ClientOption
	switch {
	case cfg.CredentialsJSON != "":
		creds, err := google.CredentialsFromJSON(ctx, []byte(cfg.CredentialsJSON), drive.DriveReadonlyScope)
		if err != nil {
			return nil, fmt.Errorf("drive: credentials: %w", err)
		}
		auth = option.WithCredentials(creds)
	case apiKey != "":
		auth = option.WithAPIKey(apiKey)
	default:
		// The host's own identity, e.g. a Cloud Run service account the
		// folder is shared with.
		creds, err := google.FindDefaultCredentials(ctx, drive.DriveReadonlyScope)
		if err != nil {
			return nil, fmt.Errorf("drive: no credentials: add a service account key, an API key for a public folder, or set GOOGLE_API_KEY")
		}
		auth = option.WithCredentials(creds)
	}
	opts := []option.ClientOption{auth}
	if cfg.endpoint != "" {
		opts = append(opts, option.WithEndpoint(cfg.endpoint))
	}
	svc, err := drive.NewService(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("drive: %w", err)
	}
	if cfg.CacheDir == "" {
		cfg.CacheDir = filepath.Join(os.TempDir(), "simple-file-search", "drive")
	}
	return &Drive{cfg: cfg, svc: svc}, nil
}

const driveFields = "nextPageToken, files(id, name, mimeType, size, md5Checksum, version, modifiedTime, webViewLink)"

func (d *Drive) List(ctx context.Context) ([]Object, error) {
	var out []Object
	type dir struct{ id, path string }
	queue := []dir{{d.cfg.FolderID, ""}}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		q := fmt.Sprintf("'%s' in parents and trashed = false", cur.id)
		call := d.svc.Files.List().Q(q).Fields(driveFields).PageSize(1000).
			SupportsAllDrives(true).IncludeItemsFromAllDrives(true).Context(ctx)
		err := call.Pages(ctx, func(page *drive.FileList) error {
			for _, f := range page.Files {
				p := path.Join(cur.path, f.Name)
				if f.MimeType == "application/vnd.google-apps.folder" {
					queue = append(queue, dir{f.Id, p})
					continue
				}
				mt, name := f.MimeType, f.Name
				export, isExport := driveExports[f.MimeType]
				if isExport {
					mt = export
				} else if strings.HasPrefix(f.MimeType, "application/vnd.google-apps.") {
					continue // forms, drawings, shortcuts: nothing to index
				}
				// Version must change when content does: md5 for uploaded files,
				// the revision counter for Google-native files.
				version := f.Md5Checksum
				if version == "" {
					version = fmt.Sprintf("v%d", f.Version)
				}
				modified, _ := time.Parse(time.RFC3339, f.ModifiedTime)
				out = append(out, Object{
					Key:      f.Id,
					Path:     p,
					Name:     name,
					MimeType: NormalizeMime(mt, name),
					Size:     f.Size,
					Version:  version,
					Modified: modified,
					WebURL:   f.WebViewLink,
					Export:   isExport,
				})
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("drive: list folder %s: %w", cur.id, err)
		}
	}
	return out, nil
}

// Open serves a file from the on-disk cache, downloading it first if this
// version is not cached yet. Drive downloads are not seekable; the cache is.
func (d *Drive) Open(ctx context.Context, obj Object) (Content, error) {
	sum := sha256.Sum256([]byte(obj.Key + "\x00" + obj.Version))
	p := filepath.Join(d.cfg.CacheDir, hex.EncodeToString(sum[:16]))
	if f, err := os.Open(p); err == nil {
		return f, nil
	}
	if err := os.MkdirAll(d.cfg.CacheDir, 0o700); err != nil {
		return nil, err
	}
	var body io.ReadCloser
	if obj.Export {
		resp, err := d.svc.Files.Export(obj.Key, obj.MimeType).Context(ctx).Download()
		if err != nil {
			return nil, fmt.Errorf("drive: export %s: %w", obj.Name, err)
		}
		body = resp.Body
	} else {
		resp, err := d.svc.Files.Get(obj.Key).SupportsAllDrives(true).Context(ctx).Download()
		if err != nil {
			return nil, fmt.Errorf("drive: download %s: %w", obj.Name, err)
		}
		body = resp.Body
	}
	defer body.Close()
	tmp, err := os.CreateTemp(d.cfg.CacheDir, "dl-*")
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(tmp, body); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, fmt.Errorf("drive: download %s: %w", obj.Name, err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return nil, err
	}
	if err := os.Rename(tmp.Name(), p); err != nil {
		os.Remove(tmp.Name())
		return nil, err
	}
	return os.Open(p)
}
