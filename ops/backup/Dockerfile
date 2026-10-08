FROM node:22-alpine
RUN apk add --no-cache postgresql-client
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backup.mjs ./
CMD ["node","backup.mjs"]
