FROM node:22-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN HUSKY=0 npm ci --unsafe-perm --production && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

CMD [ "npm", "start" ]
