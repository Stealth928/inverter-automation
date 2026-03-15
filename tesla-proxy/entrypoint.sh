#!/bin/sh
set -e

# Cloud Run sets PORT; default to 8080
PORT="${PORT:-8080}"
# Internal TLS port for the tesla-http-proxy binary (never exposed externally)
INTERNAL_PORT=8081

if [ -z "$TESLA_PROXY_AUTH_TOKEN" ]; then
  echo "ERROR: TESLA_PROXY_AUTH_TOKEN is required"
  exit 1
fi
TESLA_PROXY_AUTH_TOKEN="$(printf '%s' "$TESLA_PROXY_AUTH_TOKEN" | tr -d '\r\n')"

# Resolve private key from env var or file mount
if [ -n "$TESLA_PRIVATE_KEY_PEM" ]; then
  printf '%s\n' "$TESLA_PRIVATE_KEY_PEM" > /tmp/private-key.pem
  chmod 600 /tmp/private-key.pem
  KEY_FILE="/tmp/private-key.pem"
elif [ -f "/secrets/private-key" ]; then
  KEY_FILE="/secrets/private-key"
elif [ -f "/secrets/private-key.pem" ]; then
  KEY_FILE="/secrets/private-key.pem"
else
  echo "ERROR: No private key found. Set TESLA_PRIVATE_KEY_PEM env or mount secret file."
  exit 1
fi

echo "Using key file: $KEY_FILE"
head -1 "$KEY_FILE"

# Generate self-signed TLS cert for the internal tesla-http-proxy server
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout /tmp/tls.key -out /tmp/tls.crt \
  -days 3650 -nodes -subj "/CN=tesla-proxy-internal" 2>/dev/null

# Write nginx config:
# - listens on $PORT (plain HTTP, what Cloud Run forwards to us)
# - reverse proxies to tesla-http-proxy running HTTPS on localhost:$INTERNAL_PORT
cat > /tmp/nginx.conf << EOF
worker_processes 1;
events {}
http {
    map \$http_x_tesla_proxy_token \$proxy_token_ok {
        default 0;
        "${TESLA_PROXY_AUTH_TOKEN}" 1;
    }
    access_log /dev/stdout;
    error_log /dev/stderr;
    server {
        listen ${PORT};
    location = /health {
      return 200 'OK';
      add_header Content-Type text/plain;
    }
        location / {
      if (\$proxy_token_ok = 0) {
        return 403;
      }
            proxy_pass https://127.0.0.1:${INTERNAL_PORT};
            proxy_ssl_verify off;
            proxy_pass_request_headers on;
            proxy_pass_request_body on;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Tesla-Proxy-Token "";
            proxy_read_timeout 60s;
        }
    }
}
EOF

# Start tesla-http-proxy on internal HTTPS port
echo "Starting tesla-http-proxy on 127.0.0.1:${INTERNAL_PORT} (HTTPS, internal)"
tesla-http-proxy \
  -key-file "$KEY_FILE" \
  -cert /tmp/tls.crt \
  -tls-key /tmp/tls.key \
  -host 127.0.0.1 \
  -port "$INTERNAL_PORT" \
  -timeout 30s \
  -verbose &
PROXY_PID=$!

# Give the proxy a moment to bind
sleep 1

# Start nginx in foreground on external PORT
echo "Starting nginx on 0.0.0.0:${PORT} (plain HTTP front-end)"
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
