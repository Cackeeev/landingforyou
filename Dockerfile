FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 DATA_DIR=/var/data/landingforyou
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY templates ./templates
COPY scripts ./scripts
RUN mkdir -p /var/data/landingforyou && chown -R node:node /app /var/data/landingforyou
USER node
EXPOSE 10000
CMD ["node", "src/server.mjs"]
