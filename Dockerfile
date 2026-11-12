# Legacy Node/SQLite API (pre-cutover reference and rollback image). Since MAZ-97 it serves
# only /api/: the browser app is the penny-web image (deploy/web), and the Expo web export
# is retired.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATABASE_PATH=/data/penny.sqlite
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src/domain/ledger.ts ./src/domain/ledger.ts
COPY src/domain/households.ts ./src/domain/households.ts
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "server/index.ts"]
