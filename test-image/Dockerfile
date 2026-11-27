FROM ghcr.io/koenkk/zigbee2mqtt:2.13.0@sha256:4fb4db4d49a217bed6d0204f454ce809febc565bbe051b85c556ee2bcef73d8c

LABEL org.opencontainers.image.source="https://github.com/torrescd/zigbee-herdsman"
LABEL org.opencontainers.image.title="Zigbee2MQTT WSD005 reply-handling test"

# The build context is dist/controller/model from a v10.8.0 build.
COPY endpoint.* /app/node_modules/.pnpm/zigbee-herdsman@10.8.0/node_modules/zigbee-herdsman/dist/controller/model/
