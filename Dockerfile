# The bridge has no dependencies, so there is nothing to install and no build
# step — copying the source is the whole image.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY bin ./bin
COPY src ./src

USER node

# stdio transport: the container's stdin/stdout ARE the transport, so run it
# with `docker run -i --rm` and never allocate a TTY (-t corrupts the stream).
ENTRYPOINT ["node", "bin/greencalculus-mcp.js"]
