FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --frozen-lockfile
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --frozen-lockfile
COPY --from=builder /app/build ./build
ENV NODE_ENV=production
ENV TRANSPORT=http
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "build/index.js"]
