FROM node:24-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN HUSKY=0 npm ci --omit=dev && npm cache clean --force

COPY . ./

# https://probot.github.io/docs/configuration/
ENV NODE_ENV="production"

RUN npm run build

CMD [ "npm", "start" ]
