#!/bin/bash

# Update system packages
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
fi

# Install Docker Compose if not installed
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.3/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Create app directory if it doesn't exist
mkdir -p /path/to/app

# Copy necessary files
cp docker-compose.yml /path/to/app/
cp Dockerfile /path/to/app/
cp requirements.txt /path/to/app/
cp -r app /path/to/app/

# Set up environment variables
cat > /path/to/app/.env << EOL
DATABASE_URL=postgresql://postgres:postgres@db:5432/postgres
REDIS_URL=redis://redis:6379/0
REDIS_HOST=redis
REDIS_PORT=6379
EOL

# Start the application
cd /path/to/app
docker-compose up -d 