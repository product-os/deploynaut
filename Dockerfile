FROM node:24-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN HUSKY=0 npm ci --omit=dev && npm cache clean --force

COPY . ./

# https://probot.github.io/docs/configuration/
ENV NODE_ENV="production"

RUN npm run build

CMD [ "npm", "start" ]
