# syntax=docker/dockerfile:1
FROM golang:1.25.7-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/jifo-api ./cmd/api

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 jifo \
    && adduser -S -D -H -u 10001 -G jifo jifo \
    && mkdir -p /app/migrations /data/media \
    && chown -R jifo:jifo /app /data/media

WORKDIR /app
COPY --from=build --chown=jifo:jifo /out/jifo-api /app/jifo-api
COPY --chown=jifo:jifo migrations/ /app/migrations/

USER jifo
EXPOSE 8080
ENV ADDR=:8080 MEDIA_ROOT=/data/media JIFO_MIGRATIONS_DIR=/app/migrations

ENTRYPOINT ["/app/jifo-api"]
