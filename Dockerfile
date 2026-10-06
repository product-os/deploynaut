FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN HUSKY=0 npm ci --omit=dev && npm cache clean --force

COPY . ./

# https://probot.github.io/docs/configuration/
ENV NODE_ENV="production"

RUN npm run build

CMD [ "npm", "start" ]
