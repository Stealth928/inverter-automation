FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production || npm install --production

# copy app
COPY . .

# Expose port used by backend
EXPOSE 3000

# default env
ENV NODE_ENV=production

# Start command
CMD ["node", "server.js"]
