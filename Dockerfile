FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
	chromium \
	ca-certificates \
	fonts-liberation \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "index.js"]
