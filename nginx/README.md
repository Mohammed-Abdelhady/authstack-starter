# Nginx Production Configuration

This directory contains the production nginx configuration for the FULL-MERN-AUTH-Boilerplate project.

## Overview

The nginx setup provides:

- **Reverse Proxy**: Routes traffic between frontend and backend services
- **SSL/TLS Termination**: Handles HTTPS encryption with automatic certificate renewal
- **Rate Limiting**: Protects against DDoS and brute force attacks
- **Gzip Compression**: Optimizes content delivery
- **Health Checks**: Monitors service availability

## Architecture

```
Internet
    ↓
Nginx (Port 80/443)
    ↓
├── Frontend (Next.js) - Port 3000
└── Backend (NestJS) - Port 5000
```

## File Structure

```
nginx/
├── Dockerfile                  # Nginx container build configuration
├── nginx.conf                  # Main nginx configuration
├── production-nginx.conf       # Production configuration template
├── ssl/                        # SSL certificates (create this directory)
│   ├── fullchain.pem           # Full certificate chain
│   ├── privkey.pem             # Private key
│   └── chain.pem               # Intermediate certificate chain
└── README.md                   # This file
```

## Configuration Features

### Security

- **TLS 1.2/1.3 Only**: Modern, secure protocols
- **Strong Ciphers**: Uses only secure cipher suites
- **Security Headers**: nginx adds none. The frontend and the backend each send their own, including HSTS and the content security policy. See [production security settings](../docs/operations/production-security.md).
- **Rate Limiting**: Multiple zones for different endpoint types
- **Hidden Files**: Blocks access to sensitive files

### Performance

- **HTTP/2**: Multiplexing and header compression
- **Gzip Compression**: Reduces payload sizes
- **Static Assets**: `/_next/static/` is passed to the frontend, which marks those files immutable for a year
- **Keepalive Connections**: Reduces connection overhead
- **Buffer Optimization**: Tuned for production workloads

### Routing

- **API Routes**: `/api/*` → Backend service
- **Auth Routes**: `/api/auth/*` → Backend with stricter rate limiting
- **Health Check**: `/health` → Backend health endpoint
- **Frontend**: `/` → Frontend application
- **Build output**: `/_next/static/*` → Frontend, with no rate limit

## Setup Instructions

### 1. Create SSL Directory

```bash
mkdir -p nginx/ssl
```

### 2. Obtain SSL Certificates

#### Option A: Using Let's Encrypt (Recommended)

First, start the services without SSL:

```bash
docker-compose -f docker-compose.prod.yml up -d mongodb backend frontend nginx
```

Then obtain certificates using certbot:

```bash
docker-compose -f docker-compose.prod.yml run --rm certbot certonly --webroot \
  --webroot-path /var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email \
  -d yourdomain.com \
  -d www.yourdomain.com
```

Copy certificates to nginx ssl directory:

```bash
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/yourdomain.com/chain.pem nginx/ssl/
```

Restart nginx:

```bash
docker-compose -f docker-compose.prod.yml restart nginx
```

#### Option B: Using Self-Signed Certificates (Development Only)

Generate self-signed certificates:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

Create chain.pem (copy of fullchain.pem for self-signed):

```bash
cp nginx/ssl/fullchain.pem nginx/ssl/chain.pem
```

#### Option C: Using Existing Certificates

Copy your existing certificates to the `nginx/ssl/` directory:

- `fullchain.pem` - Full certificate chain
- `privkey.pem` - Private key
- `chain.pem` - Intermediate certificate chain

### 3. Configure Environment Variables

Create or update `.env` file:

```env
# Domain configuration
NGINX_HOST=yourdomain.com

# Frontend configuration
NEXT_PUBLIC_API_URL=https://yourdomain.com
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# Backend configuration
CLIENT_URL=https://yourdomain.com

# MongoDB configuration
MONGO_USERNAME=admin
MONGO_PASSWORD=your-secure-password
```

### 4. Update nginx.conf

Replace `yourdomain.com` in [`nginx.conf`](./nginx.conf) with your actual domain:

```nginx
server_name yourdomain.com www.yourdomain.com;
```

### 5. Start Services

```bash
# Build and start all services
docker-compose -f docker-compose.prod.yml up -d --build

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Check service status
docker-compose -f docker-compose.prod.yml ps
```

## Usage

### Starting Services

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Stopping Services

```bash
docker-compose -f docker-compose.prod.yml down
```

### Viewing Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f nginx
```

### Restarting Nginx

```bash
docker-compose -f docker-compose.prod.yml restart nginx
```

### Reloading Nginx Configuration

```bash
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### Testing Configuration

```bash
docker-compose -f docker-compose.prod.yml exec nginx nginx -t
```

## Monitoring

### Health Checks

Nginx includes a health check that monitors the backend health endpoint:

```bash
curl http://localhost/health
```

### Logs

Access logs: `/var/log/nginx/access.log`
Error logs: `/var/log/nginx/error.log`

View logs in Docker:

```bash
docker-compose -f docker-compose.prod.yml logs nginx
```

## Rate Limiting

The configuration includes three rate limiting zones:

1. **General**: 10 requests/second (default for most routes)
2. **API**: 20 requests/second (for API endpoints)
3. **Auth**: 5 requests/second (for authentication endpoints)

Adjust these values in [`nginx.conf`](./nginx.conf) based on your needs.

## Troubleshooting

### SSL Certificate Issues

**Problem**: Nginx fails to start with SSL errors

**Solution**: Ensure certificates exist and have correct permissions:

```bash
ls -la nginx/ssl/
chmod 644 nginx/ssl/*.pem
```

### Port Conflicts

**Problem**: Ports 80 or 443 already in use

**Solution**: Stop conflicting services or change port mappings in [`docker-compose.prod.yml`](../docker-compose.prod.yml)

### Upstream Connection Errors

**Problem**: Nginx can't connect to backend/frontend

**Solution**: Check if services are running and healthy:

```bash
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs backend
docker-compose -f docker-compose.prod.yml logs frontend
```

### Certificate Renewal

The certbot container automatically renews certificates every 12 hours. After renewal, restart nginx:

```bash
# Copy renewed certificates
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
docker cp authboiler-certbot-prod:/etc/letsencrypt/live/yourdomain.com/chain.pem nginx/ssl/

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

## Security Best Practices

1. **Keep Nginx Updated**: Regularly update the base image
2. **Use Strong SSL Certificates**: Prefer Let's Encrypt over self-signed
3. **Monitor Logs**: Regularly check access and error logs
4. **Adjust Rate Limits**: Tune based on your traffic patterns
5. **Enable Firewall**: Restrict access to necessary ports only
6. **Regular Backups**: Backup SSL certificates and configuration
7. **Disable Unused Features**: Remove any unused nginx modules

## Performance Tuning

### Worker Processes

The configuration uses `worker_processes auto`, which automatically sets the number of worker processes based on CPU cores.

### Connections

- `worker_connections 2048`: Maximum connections per worker
- `keepalive_timeout 65`: Keep connections alive for 65 seconds

### Buffer Sizes

Adjust buffer sizes based on your application needs:

- `client_max_body_size 1m`: Largest request body. The backend reads JSON up to 100 kB, so raise both together if you add uploads
- `client_body_buffer_size 128k`: Buffer size for request body

## Additional Resources

- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt](https://letsencrypt.org/)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
- [OWASP Security Headers](https://owasp.org/www-project-secure-headers/)

## Support

For issues or questions:

1. Check the logs: `docker-compose -f docker-compose.prod.yml logs nginx`
2. Test configuration: `docker-compose -f docker-compose.prod.yml exec nginx nginx -t`
3. Review the main project documentation
