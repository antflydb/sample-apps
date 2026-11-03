// Package web holds the built UI. Run `pnpm build` here before `go build`;
// without it the server runs and says the UI is not built.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
