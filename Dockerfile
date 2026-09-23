FROM node:22-alpine
WORKDIR /app
COPY package.json render.yaml .env.example Dockerfile ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY services ./services
COPY scripts ./scripts
COPY test ./test
COPY data ./data
RUN npm test && npm run check
CMD ["npm", "start"]
