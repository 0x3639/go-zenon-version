FROM golang:1.24-alpine AS build
RUN apk add --no-cache build-base
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go test -race ./... && CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /discovery .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates libgcc && addgroup -S -g 10001 app && adduser -S -D -u 10001 -G app app && mkdir /data && chown app:app /data
COPY --from=build /discovery /usr/local/bin/discovery
USER app
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["discovery"]
