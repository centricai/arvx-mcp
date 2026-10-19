FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tools.js http.js ./

USER node

ENV PORT=8080
EXPOSE 8080

CMD ["node", "http.js"]
