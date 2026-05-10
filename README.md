# Docker Infrastructure for Assetto Corsa Server

Automated infrastructure for managing Assetto Corsa dedicated servers with Redis-based event streaming and Convex cloud integration.

## Architecture

```
Python (Docker) ──writes──> Redis (Local) ──reads──> Node.js (Host) ──forwards──> Convex (Cloud)
     │                                       │
     │                                       └── Spawns AC Servers (32-bit native)
     └── Reads AC server configs, sends events
```

## Services

| Service | Language | Runs in | Purpose |
|---------|----------|---------|---------|
| `telemetry-data` | Python | Docker | Reads AC server configs, publishes events to Redis |
| `ac-data` | Node.js | Host (not Docker) | Manages AC server lifecycle, forwards to Convex |

## Prerequisites

- Docker & Docker Compose
- Redis (local for dev, cloud for prod)
- AC Server installed at `/home/jose/assetto-install/assetto/server`

## Quick Setup on New Server

### 1. Clone the repo

```bash
git clone https://github.com/Porx312/docker-infrasture-assetto-corsa.git
cd docker-infrasture-assetto-corsa
```

### 2. Configure environment

```bash
cp .env.example .env.local
nano .env.local  # Edit with your Redis and Convex credentials
```

### 3. Start telemetry-data (Docker)

```bash
docker compose -f docker-compose.dev.yml up -d telemetry-data
```

### 4. Start ac-data (Host)

```bash
cd ac-data
npm install
npm run build
node dist/index.js &
```

### 5. Verify it's working

```bash
# Check telemetry logs
docker logs -f assetto-telemetry-data

# Check Redis events
redis-cli xlen ac:events
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AC_INSTANCE_ID` | Unique ID for this VPS | `vps-eu-1` |
| `REDIS_HOST` | Redis host | `127.0.0.1` |
| `REDIS_PORT` | Redis port | `6379` |
| `SERVERS_PATH` | Path to AC server configs | `/home/jose/assetto-install/assetto/server` |
| `CONVEX_DEPLOYMENT_URL` | Convex cloud URL | - |
| `CONVEX_PRODUCT_KEY` | Convex product key | - |

## Auto-Deployment (GitHub Actions)

Push to `main` branch → automatically deploys to your VPS.

### Required GitHub Secrets

In GitHub repo → Settings → Secrets:

```
VPS_HOST=your-vps-ip
VPS_USER=your-username
VPS_SSH_KEY=your-private-ssh-key
CONVEX_DEPLOYMENT_URL=https://your-deployment.convex.cloud
CONVEX_PRODUCT_KEY=dev:your-deployment|your-key
CONVEX_WORKER_SECRET=your-secret
CONVEX_INGEST_SECRET=your-secret
```

## Troubleshooting

### telemetry-data not connecting to Redis
```bash
# Check Redis is running
redis-cli ping

# Check telemetry logs
docker logs assetto-telemetry-data
```

### ac-data not spawning AC servers
```bash
# Check if ports are available
netstat -tlnp | grep -E "9600|9610|9620"

# Check ac-data logs
tail -f ac-data.log
```

### Cars showing as "empty slots"
- Only `ks_toyota_gt86` has complete content locally
- Other cars in Convex config will be filtered out automatically

## License

MIT