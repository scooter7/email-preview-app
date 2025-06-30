# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /app

# Install Google Chrome and necessary dependencies for Puppeteer
# This is the most reliable way to ensure Chrome is available
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    # -- Install Chrome --
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    # We install a specific, stable version of Google Chrome
    && apt-get install -y google-chrome-stable \
    # -- Clean up --
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install app dependencies
# We set an environment variable to tell Puppeteer to skip its own download
# because we have already installed a system-wide Chrome.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm install --no-optional

# Copy the rest of your application code
COPY . .

# Your app binds to port 3000, so we expose it
EXPOSE 3000

# Define the command to run your app
CMD ["node", "app.js"]