FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --production=false

COPY backend/tsconfig.json ./
COPY backend/src ./src

RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "dist/index.js"]
