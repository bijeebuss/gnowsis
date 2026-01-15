FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Add PostgreSQL official repository for pgvector
RUN apt-get update && \
    apt-get install -y curl ca-certificates gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg && \
    echo "deb http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y postgresql-client postgresql postgresql-15-pgvector && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Configure PostgreSQL: set password and create database
RUN service postgresql start && \
    su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\"" && \
    su - postgres -c "createdb tldr" && \
    service postgresql stop

# Configure PostgreSQL to allow password authentication from localhost
RUN sed -i 's/peer/scram-sha-256/g' /etc/postgresql/15/main/pg_hba.conf

# Install Temporal CLI
RUN curl -sSf https://temporal.download/cli.sh | sh

# Add temporal to PATH for the node user
ENV PATH="/root/.temporalio/bin:${PATH}"

# Switch to node user for the remaining operations
USER node

# Install Temporal CLI for node user as well
RUN curl -sSf https://temporal.download/cli.sh | sh

# Add temporal to PATH for node user
ENV PATH="/home/node/.temporalio/bin:${PATH}"

# Install Claude CLI as part of the build
RUN curl -fsSL https://claude.ai/install.sh | bash

# Switch back to root for any final setup
USER root
