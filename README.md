# Docker Infrastructure for Assetto Corsa Server

Automated infrastructure for managing Assetto Corsa dedicated servers with Redis-based event streaming and Convex cloud integration.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Production VPS                          │
├───────────────────┬────────────────────────────────────────┤
│   telemetry-data  │              ac-data                   │
│   (Python/Docker) │              (Node.js)                   │
│                   │                                         │
│ • Reads server    │ • Reads config snapshots from Redis     │
│   configs         │ • Applies configs to AC servers         │
│ • Sends events    │ • Spawns AC servers (32-bit native)     │
│   to Redis        │ • Forwards data to Convex cloud         │
└───────────────────┴────────────────────────────────────────┘
                              │
                              ▼
                        ┌──────────┐
                        │  Redis   │
                        │ (Local)  │
                        └──────────┘
                              │
                              ▼
                        ┌──────────┐
                        │  Convex  │
                        │ (Cloud)  │
                        └──────────┘
```

## Services

| Service | Description | Port |
|---------|-------------|------|
| `telemetry-data` | Python service that reads AC server configs and publishes events to Redis | UDP 9000-9010 |
| `ac-data` | Node.js service that manages AC server lifecycle and forwards data to Convex | TCP 3000 |
| `redis` | Local Redis for event streaming (dev only) | TCP 6379 |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Redis (local for dev, cloud for prod)
- AC Server installed at `/home/jose/assetto-install/assetto/server`

### Development

```bash
# Clone the repo
git clone https://github.com/Porx312/docker-infrasture-assetto-corsa.git
cd docker-infrasture-assetto-corsa

# Copy environment template
cp .env.example .env.local
# Edit .env.local with your Redis/Convex credentials

# Start telemetry-data in Docker (reads AC config, sends events to Redis)
docker compose -f docker-compose.dev.yml up -d telemetry-data

# Start ac-data on host (spawns AC servers, forwards to Convex)
cd ac-data && npm install && npm run build && node dist/index.js &
```

### Production

```bash
# Copy production environment
cp .env.example .env.production
# Edit .env.production with Redis Cloud credentials

# Start all services
docker compose -f docker-compose.prod.yml up -d
```

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AC_INSTANCE_ID` | Unique identifier for this VPS | `vps-eu-2` |
| `REDIS_HOST` | Redis host | `127.0.0.1` (local) or `redis-xxxx.ec2.cloud.redislabs.com` |
| `REDIS_PORT` | Redis port | `6379` |
| `SERVERS_PATH` | Path to AC server folders | `/home/user/assetto/server` |
| `CONVEX_DEPLOYMENT_URL` | Convex deployment URL | `https://xxxx.convex.cloud` |
| `CONVEX_PRODUCT_KEY` | Convex product key | `dev:xxxx` |

## Deployment

### Automatic Deployment (GitHub Actions)

Push to `main` branch triggers automatic deployment to VPS.

Required secrets in GitHub:
- `VPS_HOST` - VPS IP address
- `VPS_USER` - SSH username
- `VPS_SSH_KEY` - SSH private key
- `DOCKER_USERNAME` - Docker Hub username
- `DOCKER_TOKEN` - Docker Hub access token
- `CONVEX_*` - Convex credentials

### Manual Deployment

```bash
git clone https://github.com/Porx312/docker-infrasture-assetto-corsa.git
cd docker-infrasture-assetto-corsa
cp .env.example .env.local
# Edit .env.local with your credentials
docker compose -f docker-compose.dev.yml up -d
```

## License

MIT
