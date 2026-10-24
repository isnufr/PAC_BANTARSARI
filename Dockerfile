FROM node:22-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Create directory for persistent SQLite database
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

# Mount persistent volume here in Coolify / Docker
VOLUME ["/app/data"]

CMD ["npm", "start"]
