package search

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/jpeg"
	"io"

	_ "image/gif" // decoders for image.Decode
	_ "image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// maxImageBytes bounds what a query image may weigh before decoding.
const maxImageBytes = 64 << 20

// queryImage returns a JPEG data URI of an image scaled so its long edge is
// at most edge pixels, the same treatment the browser gives uploads. The
// embedder does not use more, and a 40-megapixel original is far more than
// an embed request should carry.
func queryImage(r io.Reader, edge int) (string, error) {
	src, _, err := image.Decode(io.LimitReader(r, maxImageBytes))
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if long := max(w, h); long > edge {
		w, h = max(w*edge/long, 1), max(h*edge/long, 1)
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	// White first, so transparency flattens onto white, as in the browser.
	draw.Draw(dst, dst.Bounds(), image.White, image.Point{}, draw.Src)
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 88}); err != nil {
		return "", err
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}
