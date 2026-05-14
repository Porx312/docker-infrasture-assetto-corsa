FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git bash

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm install typescript && ./node_modules/.bin/tsc

ENV SERVERS_PATH=/home/jose/assetto-infra/server
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]