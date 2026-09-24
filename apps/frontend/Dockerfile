FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["sh","-c","npx vite preview --host 0.0.0.0 --port ${PORT:-3000}"]
