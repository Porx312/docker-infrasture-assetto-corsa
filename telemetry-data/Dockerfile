FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV SERVERS_PATH=/opt/assetto/servers
ENV AC_INSTANCE_ID=vps-1
ENV REDIS_HOST=redis-12827.c99.us-east-1-4.ec2.cloud.redislabs.com
ENV REDIS_PORT=12827
ENV REDIS_USERNAME=default
ENV REDIS_SSL=false

CMD ["python", "main.py"]