FROM node:20-alpine

# Install dependencies needed for Functions (including functions-framework)
WORKDIR /workspace

# Copy package manifest & install
COPY package.json package-lock.json* ./
RUN npm install --production

# Add functions code
COPY . .

# Install functions-framework to run as a simple HTTP server
RUN npm install @google-cloud/functions-framework --no-audit --no-fund --production

# Expose port - functions-framework default 8080 (we'll set 5001 externally)
EXPOSE 8080

# Set environment (the functions-framework expects to find the exported function named 'api')
ENV FUNCTION_TARGET=api
ENV FUNCTION_SIGNATURE_TYPE=http

# Start using functions-framework
CMD ["npx", "@google-cloud/functions-framework", "--target=api", "--port=8080", "--source=."]
