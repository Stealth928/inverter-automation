FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git
RUN git clone --depth 1 https://github.com/teslamotors/vehicle-command.git /src
WORKDIR /src
RUN go build -o /go/bin/tesla-http-proxy ./cmd/tesla-http-proxy

FROM alpine:3.20
# nginx: plain HTTP front-end on $PORT (Cloud Run forwards plain HTTP to containers)
# openssl: generate self-signed cert for the internal tesla-http-proxy TLS server
RUN apk add --no-cache ca-certificates nginx openssl
COPY --from=builder /go/bin/tesla-http-proxy /usr/local/bin/tesla-http-proxy
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
