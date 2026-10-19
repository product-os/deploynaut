FROM node:24-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN HUSKY=0 npm ci --omit=dev && npm cache clean --force

COPY . ./

# https://probot.github.io/docs/configuration/
ENV NODE_ENV="production"

RUN npm run build

CMD [ "npm", "start" ]
