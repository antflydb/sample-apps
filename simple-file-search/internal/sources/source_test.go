package sources

import "testing"

func TestKind(t *testing.T) {
	for _, tc := range []struct{ mime, name, want string }{
		{"image/jpeg", "a.jpg", "image"},
		{"", "a.PNG", "image"},
		{"image/gif", "a.gif", ""}, // not embeddable
		{"audio/mpeg", "a.mp3", "audio"},
		{"video/mp4", "a.mp4", "video"},
		{"application/pdf", "a.pdf", "pdf"},
		{"application/octet-stream", "notes.md", "text"},
		{"text/plain; charset=utf-8", "a.txt", "text"},
		{"application/zip", "a.zip", ""},
	} {
		if got := Kind(tc.mime, tc.name); got != tc.want {
			t.Errorf("Kind(%q, %q) = %q, want %q", tc.mime, tc.name, got, tc.want)
		}
	}
}

func TestParseFolderID(t *testing.T) {
	for in, want := range map[string]string{
		"1AbC_d-9": "1AbC_d-9",
		"https://drive.google.com/drive/folders/1AbC":                 "1AbC",
		"https://drive.google.com/drive/u/0/folders/1AbC?usp=sharing": "1AbC",
		"https://drive.google.com/open?id=1AbC&x=y":                   "1AbC",
	} {
		if got := ParseFolderID(in); got != want {
			t.Errorf("ParseFolderID(%q) = %q, want %q", in, got, want)
		}
	}
}
