FROM alpine:3.19

# Install dependencies
RUN apk add --no-cache curl bash

# Download and install Temporal CLI
RUN curl -sSf https://temporal.download/cli.sh | sh

# Add temporal to PATH
ENV PATH="/root/.temporalio/bin:${PATH}"

# Create data directory
RUN mkdir -p /data

# Expose ports
# 7233 - gRPC frontend
# 8233 - Web UI
EXPOSE 7233 8233

# Start Temporal dev server with persistent storage
CMD ["temporal", "server", "start-dev", "--ip", "0.0.0.0", "--db-filename", "/data/temporal.db", "--ui-port", "8233"]
