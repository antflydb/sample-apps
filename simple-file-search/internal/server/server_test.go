package server

import "testing"

func TestInertType(t *testing.T) {
	for mt, want := range map[string]bool{
		"image/jpeg":                true,
		"audio/mpeg":                true,
		"application/pdf":           true,
		"text/plain; charset=utf-8": true,
		"image/svg+xml":             false,
		"text/html":                 false,
		"application/xhtml+xml":     false,
		"application/octet-stream":  false,
		"":                          false,
	} {
		if got := inertType(mt); got != want {
			t.Errorf("inertType(%q) = %v", mt, got)
		}
	}
}
