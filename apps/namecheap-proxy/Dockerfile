FROM node:20-alpine

WORKDIR /app
COPY package.json server.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "server.js"]
