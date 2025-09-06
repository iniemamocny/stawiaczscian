FROM node:20

# Install Blender
RUN apt-get update && apt-get install -y blender && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

ENTRYPOINT ["node", "server.js"]
