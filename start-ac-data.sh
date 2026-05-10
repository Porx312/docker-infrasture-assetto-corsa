#!/bin/bash
cd /home/jose/assetto-infra/ac-data

export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
export REDIS_USERNAME=
export REDIS_PASSWORD=
export CONVEX_DEPLOYMENT_URL=https://combative-rhinoceros-728.convex.cloud
export CONVEX_PRODUCT_KEY=dev:combative-rhinoceros-728|eyJ2MiI6IjI0MzhlODVmMjMwNTRhYjY4NjdlNjg4NDZjY2M0MzM4In0=
export CONVEX_WORKER_SECRET=wOo1K4XDp
export CONVEX_INGEST_SECRET=wOo1K4XDp
export AC_INSTANCE_ID=vps-eu-2
export SERVERS_PATH=/home/jose/assetto-install/assetto/server
export RESTART_ON_BOOT=false

exec node dist/index.js >> /home/jose/assetto-infra/ac-data.log 2>&1