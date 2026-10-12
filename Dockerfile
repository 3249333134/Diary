FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/dist ./packages/contracts/dist
RUN npm ci --omit=dev
COPY apps/api/dist ./apps/api/dist
COPY apps/web/dist ./apps/web/dist
EXPOSE 4319
CMD ["node", "apps/api/dist/index.js"]
