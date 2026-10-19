FROM node:20-alpine
# 7-Zip builds the .zip / .7z downloads (the binary bundled in npm's
# 7zip-bin is built for glibc and does not run on Alpine)
RUN apk add --no-cache 7zip
ENV SEVEN_ZIP_PATH=/usr/bin/7z
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8000
CMD ["node", "server.mjs"]
