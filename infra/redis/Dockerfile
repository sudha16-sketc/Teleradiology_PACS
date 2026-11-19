FROM docker.io/library/redis:7.4-alpine

# envsubst renders the runtime-only config template; su-exec drops root after
# fixing ownership of the persistent data directory (Render disks and Podman
# named volumes are often created root-owned).
RUN apk add --no-cache gettext su-exec

ENV REDIS_PORT=6379 \
    REDIS_DATA_DIR=/data \
    REDIS_CONFIG_TEMPLATE=/usr/local/etc/redis/redis.conf.template \
    REDIS_CONFIG_FILE=/tmp/redis.conf

RUN mkdir -p /data /usr/local/etc/redis

COPY redis.conf /usr/local/etc/redis/redis.conf.template
COPY docker-entrypoint.sh /usr/local/bin/axis-redis-entrypoint.sh
RUN chmod 0755 /usr/local/bin/axis-redis-entrypoint.sh

# Render private services must bind a port. Redis only listens on the container
# network; no public endpoint is created by this image.
EXPOSE 6379
STOPSIGNAL SIGTERM

# REDISCLI_AUTH is supplied at runtime (the password is never baked into the
# image), so the authenticated ping matches the requirepass configuration.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD sh -c 'redis-cli ping | grep -q PONG'

ENTRYPOINT ["/usr/local/bin/axis-redis-entrypoint.sh"]
CMD ["redis-server", "/tmp/redis.conf"]
