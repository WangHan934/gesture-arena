FROM node:24-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 8000
USER node
CMD ["node", "server.mjs"]
