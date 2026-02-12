FROM node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000
VOLUME /app/data

CMD ["node", "server.js"]
