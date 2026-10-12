# Deployment Guide

This guide covers deploying the FULL-MERN-AUTH-Boilerplate application using Docker Compose and Vercel.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Docker Development Setup](#docker-development-setup)
- [Docker Production Setup](#docker-production-setup)
- [Dependency Overrides](#dependency-overrides)
- [Vercel Deployment](#vercel-deployment)
- [Troubleshooting](deployment-custom-domain.md#troubleshooting)

---

## Prerequisites

Before deploying, ensure you have:

- **Docker** (v20.10 or later) - [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose** (v2.0 or later) - Included with Docker Desktop
- **Node.js** (22.12 through 22.x) - [Install Node.js](https://nodejs.org/)
- **pnpm** 12.6.0, enabled with `corepack enable` and `corepack prepare pnpm@12.6.0 --activate`
- **Git** - For cloning the repository

### Verify Installation

```bash
docker --version
docker compose version
node --version
git --version
```

---

## Docker Development Setup

### Quick Start

1. **Clone the repository**

```bash
git clone https://github.com/Mohammed-Abdelhady/nextjs-nestjs-oauth-rbac-boilerplate.git
cd nextjs-nestjs-oauth-rbac-boilerplate
```

2. **Create environment file**

```bash
cp .env.docker.example .env.docker
```

3. **Start all services**

```bash
docker compose --env-file .env.docker up --build
```

This will:

- Start MongoDB on port 27017
- Start the NestJS backend on port 5000
- Start the Next.js frontend on port 3000
- Enable hot reload for both backend and frontend

4. **Access the application**

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000
- MongoDB: mongodb://localhost:27017

### Development Commands

```bash
# Start all services in detached mode
docker compose up -d

# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mongodb

# Stop all services
docker compose down

# Stop and remove volumes (deletes database data)
docker compose down -v

# Rebuild a specific service
docker compose up -d --build backend

# Rebuild all services
docker compose up -d --build
```

### Hot Reload

Both backend and frontend support hot reload in development mode:

- **Backend**: Changes to TypeScript files trigger automatic rebuild
- **Frontend**: Changes to React/Next.js files trigger automatic rebuild

### Volume Management

MongoDB data persists in a named volume (`mongo-data`):

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect FULL-MERN-AUTH-Boilerplate_mongo-data

# Backup volume
docker run --rm -v nextjs-nestjs-oauth-rbac-boilerplate_mongo-data:/data -v $(pwd):/backup alpine tar czf /backup/mongo-backup.tar.gz /data

# Restore volume
docker run --rm -v nextjs-nestjs-oauth-rbac-boilerplate_mongo-data:/data -v $(pwd):/backup alpine tar xzf /backup/mongo-backup.tar.gz -C /
```

---

## Docker Production Setup

### Quick Start

1. **Create production environment file**

```bash
cp .env.docker.example .env.docker.prod
```

2. **Edit `.env.docker.prod` with production values**

```bash
# Production configuration
NODE_ENV=production
MONGO_URI=mongodb://admin:your_secure_password@mongodb:27017/authboiler?authSource=admin
MONGO_USERNAME=admin
MONGO_PASSWORD=your_secure_password
CLIENT_URL=https://yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

3. **Start production stack**

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Production Commands

```bash
# Start production stack
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Stop production stack
docker compose -f docker-compose.prod.yml down

# Rebuild and restart
docker compose -f docker-compose.prod.yml up -d --build

# Scale services (if needed)
docker compose -f docker-compose.prod.yml up -d --scale backend=2
```

Rate limits are counted inside each backend process, so two instances allow each client twice every limit. Read [rate limits count per server process](production-security.md#rate-limits-count-per-server-process) before you scale the backend.

### Security Best Practices

1. **Use strong passwords** for MongoDB authentication
2. **Don't commit** `.env.docker.prod` to version control
3. **Use HTTPS** in production (reverse proxy with nginx/caddy)
4. **Configure firewall** to only expose necessary ports
5. **Regular backups** of MongoDB volume
6. **Monitor logs** for suspicious activity
7. **Keep nginx and `trust proxy` in sync.** Every nginx proxy location declares
   `X-Forwarded-For` from `$remote_addr` instead of appending the incoming header,
   because the backend runs with `trust proxy = 1` and `@nestjs/throttler` keys its
   buckets on `req.ip`. If you ever put a load balancer or CDN in front of nginx,
   those directives and `trust proxy` must change together, and the backend must stay
   unreachable except through nginx - a client that connects to it directly sets
   `X-Forwarded-For` itself and picks its own throttle bucket.
8. **Let the backend check its own settings.** With `NODE_ENV=production` it refuses to
   start on an `http` or localhost `CLIENT_URL`, on Swagger without a second switch,
   and on seed settings. See [production security settings](production-security.md).
9. **Send each security header from one layer.** nginx adds none. The frontend and the
   backend send their own, listed in the same guide.

### Resource Limits

Production compose file includes resource limits:

- **MongoDB**: 1GB memory, 1 CPU
- **Backend**: 512MB memory, 0.5 CPU
- **Frontend**: 512MB memory, 0.5 CPU

Adjust these in [`docker-compose.prod.yml`](../../docker-compose.prod.yml) as needed.

---

## Dependency Overrides

`pnpm-workspace.yaml` carries the repository's security overrides:

```yaml
overrides:
  diff: '>=8.0.3'
  lodash: ^4.18.1
  '@nestjs/platform-express>multer': 2.4.0
```

The nested selector replaces only the framework's `multer` dependency. The backend's
former local `diff` override is covered by the root selector. The committed lockfile
records the resolved graph, verified by `pnpm install --frozen-lockfile`.

Revisit these entries when upstream dependencies accept the reviewed versions.
Compare advisories and dependency paths per workspace before dropping an override.
`pnpm audit --json` audits the shared graph; its importer paths identify the affected
workspaces.

The images enable Corepack and activate pnpm 12.6.0. They fetch the complete locked
graph before copying sources and running an offline frozen install. The backend
deploy step runs `pnpm --filter backend deploy --prod --frozen-lockfile /out/backend`.
It reads registry metadata for the generated lockfile check, while package files
come from the store populated by `pnpm fetch`. The compiled `dist` directory is
copied into the backend runtime. The frontend runtime keeps Next.js standalone
output. The test-only MongoDB binary download is disabled inside image builds.

---

## Vercel Deployment

### Prerequisites

- Vercel account (free tier available)
- Vercel CLI installed: `pnpm add -g vercel`

### Deploy Frontend to Vercel

1. **Navigate to frontend directory**

```bash
cd frontend
```

2. **Login to Vercel**

```bash
vercel login
```

3. **Deploy preview**

```bash
vercel
```

4. **Configure environment variables in Vercel dashboard**

Go to your project settings in Vercel and add:

| Variable              | Value                        | Environment |
| --------------------- | ---------------------------- | ----------- |
| `NEXT_PUBLIC_API_URL` | `https://api.yourdomain.com` | Production  |

5. **Deploy to production**

```bash
vercel --prod
```

### Vercel Configuration

Use Node 22, set the Root Directory to `frontend`, and include source files outside
that directory in the Build Step so the root workspace config and `shared/*` are
available. Enable Corepack with the project variable `ENABLE_EXPERIMENTAL_COREPACK=1`.
The install command activates pnpm 12.6.0 and uses `corepack pnpm` for a frozen install.
See [Vercel package managers](https://vercel.com/docs/package-managers) and
[shared monorepo files](https://vercel.com/docs/monorepos/monorepo-faq).

The [`vercel.json`](../../frontend/vercel.json) file includes:

- **Framework**: Next.js (optimized)
- **Build Command**: `corepack pnpm run build`
- **Output Directory**: `.next`
- **Caching**: Optimized for static assets

### Automatic Deployments

Connect your Git repository to Vercel for automatic deployments:

1. Go to Vercel dashboard
2. Click "Add New Project"
3. Import your Git repository
4. Configure root directory: `frontend`
5. Add environment variables
6. Deploy!

Now every push to `main` will trigger a production deployment, and every PR will create a preview deployment.

## More sections

- [Custom domains and deployment troubleshooting](deployment-custom-domain.md)
