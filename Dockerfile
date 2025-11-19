# ---- Base Stage ----
# Sets up Node.js environment.
FROM node:20-slim AS base
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y openssh-client
# RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# USER appuser

RUN corepack enable

FROM base AS deps
WORKDIR /usr/src/app
COPY package.json ./ package-lock.json* ./
COPY .nvmrc ./
COPY scripts ./scripts/
RUN npm install


COPY proxy.config.docker.json ./proxy.config.json

# Create data directory and generate SSH host key
RUN mkdir -p .data/ssh && \
    if [ ! -f ./.data/ssh/host_key ]; then \
        ssh-keygen -t rsa -b 4096 -f ./.data/ssh/host_key -N ""; \
    fi

# Expose ports for HTTP and SSH
EXPOSE 8000
EXPOSE 2222

# Set the command to start the server
CMD ["npm", "start"]
