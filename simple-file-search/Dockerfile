FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.26-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/server /server
# Owned by nonroot so a fresh named volume mounted here is writable.
COPY --from=server --chown=65532:65532 /out/data /data
ENV LISTEN=0.0.0.0:8090 DATA_DIR=/data
EXPOSE 8090
ENTRYPOINT ["/server"]
