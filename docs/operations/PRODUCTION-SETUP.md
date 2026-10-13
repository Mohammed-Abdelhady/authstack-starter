# Production Setup Guide

This guide explains how to deploy the AuthStack Starter application to production using the automated setup script.

## Overview

The production setup includes:

- **Nginx Reverse Proxy**: Handles SSL termination and routing
- **Let's Encrypt SSL Certificates**: Automatic HTTPS with free certificates
- **Docker Compose**: Orchestrates all services
- **Interactive Setup Script**: Guides you through configuration

## Prerequisites

Before starting, ensure you have:

1. **Server Requirements**:
   - Ubuntu 20.04+ or similar Linux distribution
   - Minimum 2GB RAM (4GB recommended)
   - 20GB free disk space
   - Root or sudo access

2. **Domain Name**:
   - Registered domain (e.g., `example.com`)
   - DNS configured to point to your server IP
   - Both `@` (apex) and `www` records recommended

3. **Software Installed**:
   - Docker (20.10+)
   - Docker Compose (2.0+)
   - OpenSSL
   - Git

### Installing Prerequisites

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install OpenSSL
sudo apt install -y openssl

# Add your user to docker group (optional)
sudo usermod -aG docker $USER
```

## Quick Start

The easiest way to set up production is using the interactive setup script:

```bash
# Clone the repository
git clone <your-repo-url>
cd authstack-starter

# Run the setup script
./setup-production.sh
```

The script will guide you through:

1. Domain configuration (main, frontend, backend domains)
2. Email configuration for SSL certificates
3. SSL certificate type selection (Let's Encrypt or self-signed)
4. MongoDB credentials
5. Application settings
6. Port configuration

## Manual Setup

If you prefer manual configuration, follow these steps:

### 1. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Domain Configuration
NGINX_HOST=example.com
MAIN_DOMAIN=example.com
FRONTEND_DOMAIN=www.example.com
BACKEND_DOMAIN=api.example.com

# Frontend Configuration
NEXT_PUBLIC_API_URL=https://api.example.com

# Backend Configuration
CLIENT_URL=https://www.example.com

# MongoDB Configuration
MONGO_USERNAME=admin
MONGO_PASSWORD=your-secure-password
MONGO_URI=mongodb://admin:your-secure-password@mongodb:27017/authboiler?authSource=admin

# Application Configuration
NODE_ENV=production
APP_NAME=authstack-starter

# SSL Configuration
SSL_TYPE=letsencrypt
SSL_EMAIL=admin@example.com

# Port Configuration
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
```

### 2. Update Nginx Configuration

Edit [`nginx/nginx.conf`](../../nginx/nginx.conf) and replace `server_name _;` with your domains:

```nginx
server_name example.com www.example.com;
```

### 3. Obtain SSL Certificates

#### Option A: Let's Encrypt (Recommended)

```bash
# Create SSL directory
mkdir -p nginx/ssl

# Start services without nginx
docker-compose -f docker-compose.prod.yml up -d mongodb backend frontend

# Wait for services to be ready
sleep 15

# Obtain certificates
docker-compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email admin@example.com \
  --agree-tos \
  --no-eff-email \
  -d example.com \
  -d www.example.com

# Copy certificates to ssl directory
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/example.com/fullchain.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/example.com/privkey.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/example.com/chain.pem nginx/ssl/

# Set permissions
chmod 644 nginx/ssl/*.pem
```

#### Option B: Self-Signed (Development Only)

```bash
# Create SSL directory
mkdir -p nginx/ssl

# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=example.com"

# Create chain.pem
cp nginx/ssl/fullchain.pem nginx/ssl/chain.pem

# Set permissions
chmod 644 nginx/ssl/*.pem
```

### 4. Start Services

```bash
# Build and start all services
docker-compose -f docker-compose.prod.yml up -d --build

# Check service status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

## DNS Configuration

Ensure your DNS records point to your server:

| Type | Name | Value          |
| ---- | ---- | -------------- |
| A    | @    | Your server IP |
| A    | www  | Your server IP |
| A    | api  | Your server IP |

Example for Cloudflare:

```
A    example.com    192.0.2.1
A    www.example.com 192.0.2.1
A    api.example.com 192.0.2.1
```

## Firewall Configuration

Configure your firewall to allow necessary traffic:

```bash
# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

## Service Management

### Starting Services

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Stopping Services

```bash
docker-compose -f docker-compose.prod.yml down
```

### Restarting Services

```bash
# Restart all services
docker-compose -f docker-compose.prod.yml restart

# Restart specific service
docker-compose -f docker-compose.prod.yml restart nginx
```

### Viewing Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f nginx
docker-compose -f docker-compose.prod.yml logs -f backend
docker-compose -f docker-compose.prod.yml logs -f frontend
```

### Checking Service Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

### Updating Services

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose -f docker-compose.prod.yml up -d --build
```

## SSL Certificate Renewal

The certbot container automatically renews certificates every 12 hours. After renewal, restart nginx:

```bash
# Copy renewed certificates
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/example.com/fullchain.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/example.com/privkey.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/example.com/chain.pem nginx/ssl/

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs for errors
docker-compose -f docker-compose.prod.yml logs

# Check disk space
df -h

# Check Docker resources
docker system df
```

### SSL Certificate Issues

```bash
# Check certificate files
ls -la nginx/ssl/

# Test nginx configuration
docker-compose -f docker-compose.prod.yml exec nginx nginx -t

# Check certificate expiration
openssl x509 -in nginx/ssl/fullchain.pem -noout -dates
```

### Port Already in Use

```bash
# Check what's using the port
sudo lsof -i :80
sudo lsof -i :443

# Stop conflicting services
sudo systemctl stop nginx  # If nginx is installed on host
```

### DNS Not Resolving

```bash
# Check DNS propagation
dig example.com
dig www.example.com
dig api.example.com

# Check from server
curl -I http://localhost
```

### Database Connection Issues

```bash
# Check MongoDB status
docker-compose -f docker-compose.prod.yml logs mongodb

# Test MongoDB connection
docker-compose -f docker-compose.prod.yml exec mongodb mongosh \
  --username admin \
  --password your-password \
  --authenticationDatabase admin \
  --eval "db.adminCommand('ping')"
```

## Monitoring

### Health Checks

```bash
# Backend health
curl https://api.example.com/health

# Frontend health
curl -I https://www.example.com
```

### Resource Monitoring

```bash
# Container resource usage
docker stats

# Disk usage
docker system df

# Service status
docker-compose -f docker-compose.prod.yml ps
```

### Log Monitoring

```bash
# Follow all logs
docker-compose -f docker-compose.prod.yml logs -f

# Filter by service
docker-compose -f docker-compose.prod.yml logs -f nginx | grep error
```

## Security Best Practices

1. **Use Strong Passwords**: Generate secure passwords for MongoDB
2. **Keep Software Updated**: Regularly update Docker and system packages
3. **Monitor Logs**: Regularly check access and error logs
4. **Use Firewall**: Restrict access to necessary ports only
5. **Backup Data**: Regularly backup MongoDB data and SSL certificates
6. **SSL Certificates**: Use Let's Encrypt, not self-signed certificates
7. **Rate Limiting**: Adjust rate limits based on your traffic
8. **Environment Variables**: Never commit `.env` files to version control

## Performance Tuning

### Nginx Performance

Edit [`nginx/nginx.conf`](../../nginx/nginx.conf) to adjust:

```nginx
# Worker processes (usually auto is best)
worker_processes auto;

# Worker connections
worker_connections 2048;

# Keepalive timeout
keepalive_timeout 65;

# Client max body size. The backend reads JSON up to 100 kB.
client_max_body_size 1m;
```

### Docker Resources

Edit [`docker-compose.prod.yml`](../../docker-compose.prod.yml) to adjust limits:

```yaml
deploy:
  resources:
    limits:
      memory: 512M
      cpus: '0.5'
    reservations:
      memory: 256M
      cpus: '0.25'
```

## Backup and Restore

### Backup MongoDB Data

```bash
# Create backup
docker-compose -f docker-compose.prod.yml exec mongodb mongodump \
  --username admin \
  --password your-password \
  --authenticationDatabase admin \
  --out /backup

# Copy backup from container
docker cp authboiler-mongodb-prod:/backup ./mongodb-backup-$(date +%Y%m%d)
```

### Restore MongoDB Data

```bash
# Copy backup to container
docker cp ./mongodb-backup-20240101 authboiler-mongodb-prod:/restore

# Restore from backup
docker-compose -f docker-compose.prod.yml exec mongodb mongorestore \
  --username admin \
  --password your-password \
  --authenticationDatabase admin \
  /restore
```

### Backup SSL Certificates

```bash
# Create backup directory
mkdir -p backups/ssl-$(date +%Y%m%d)

# Copy certificates
cp nginx/ssl/*.pem backups/ssl-$(date +%Y%m%d)/
```

## Additional Resources

- [Nginx Documentation](https://nginx.org/en/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [Let's Encrypt](https://letsencrypt.org/)
- [MongoDB Documentation](https://docs.mongodb.com/)

## Support

For issues or questions:

1. Check the logs: `docker-compose -f docker-compose.prod.yml logs`
2. Review this documentation
3. Check the [nginx README](../../nginx/README.md)
4. Open an issue on GitHub
