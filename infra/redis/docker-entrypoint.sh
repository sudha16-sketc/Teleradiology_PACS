#!/bin/sh
# Render runtime configuration only. No credential is stored in the image: the
# password arrives as an environment variable and is written to a 0600 file in
# the container's ephemeral filesystem on every start.
set -eu

: "${REDIS_PORT:=6379}"
: "${REDIS_DATA_DIR:=/data}"
: "${REDIS_CONFIG_TEMPLATE:=/usr/local/etc/redis/redis.conf.template}"
: "${REDIS_CONFIG_FILE:=/tmp/redis.conf}"
: "${REDIS_MAXMEMORY:=256mb}"
: "${REDIS_MAXMEMORY_POLICY:=volatile-lru}"
: "${REDIS_APPENDONLY:=yes}"
: "${REDIS_CLIENT_IDLE_TIMEOUT:=300}"
: "${REDIS_TCP_KEEPALIVE:=60}"
: "${REDIS_MAXCLIENTS:=500}"

# envsubst reads the process environment; shell-only defaults would render as
# empty strings in the config template.
export REDIS_PORT REDIS_DATA_DIR REDIS_MAXMEMORY REDIS_MAXMEMORY_POLICY \
  REDIS_APPENDONLY REDIS_CLIENT_IDLE_TIMEOUT REDIS_TCP_KEEPALIVE REDIS_MAXCLIENTS \
  REDIS_PASSWORD

if [ -z "${REDIS_PASSWORD:-}" ]; then
  echo "REDIS_PASSWORD must be provided at runtime (never bake it into the image)" >&2
  exit 1
fi

case "$REDIS_PASSWORD" in
  *'"'*|*'\'*)
    echo "REDIS_PASSWORD contains characters that are unsafe in redis.conf; use a URL-safe random value" >&2
    exit 1
    ;;
esac

case "$REDIS_MAXMEMORY_POLICY" in
  volatile-lru|volatile-ttl|allkeys-lru|noeviction) ;;
  *)
    echo "Unsupported REDIS_MAXMEMORY_POLICY: $REDIS_MAXMEMORY_POLICY" >&2
    exit 1
    ;;
esac

mkdir -p "$REDIS_DATA_DIR"
chown -R redis:redis "$REDIS_DATA_DIR" 2>/dev/null || true
chmod 700 "$REDIS_DATA_DIR" 2>/dev/null || true

# Longer names first: envsubst otherwise expands ${REDIS_MAXMEMORY} inside
# ${REDIS_MAXMEMORY_POLICY} and leaves a dangling "_POLICY" in the config.
envsubst '${REDIS_MAXMEMORY_POLICY} ${REDIS_CLIENT_IDLE_TIMEOUT} ${REDIS_CONFIG_TEMPLATE} ${REDIS_CONFIG_FILE} ${REDIS_MAXCLIENTS} ${REDIS_DATA_DIR} ${REDIS_PASSWORD} ${REDIS_APPENDONLY} ${REDIS_MAXMEMORY} ${REDIS_PORT} ${REDIS_TCP_KEEPALIVE}' \
  < "$REDIS_CONFIG_TEMPLATE" > "$REDIS_CONFIG_FILE"
chown redis:redis "$REDIS_CONFIG_FILE"
chmod 600 "$REDIS_CONFIG_FILE"

exec su-exec redis "$@"
