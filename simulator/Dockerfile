FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY device.js ./

# By default, Node.js uses system DNS, which works fine with Docker.
CMD ["node", "device.js"]
