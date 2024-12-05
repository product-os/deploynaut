FROM node:22-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN HUSKY=0 npm ci --omit=dev && npm cache clean --force

COPY . ./

ENV NODE_ENV="production"

RUN npm run build

CMD [ "npm", "start" ]
