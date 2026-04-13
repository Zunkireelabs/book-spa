# CI/CD Implementation Guide

Complete guide for setting up automated deployment with GitHub Actions, Docker, and Traefik on a VPS.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Repository                         │
├─────────────────────────────────────────────────────────────────┤
│  feature/* ──► PR ──► stage ──► main                            │
│                         │         │                              │
│                    [staging]  [production]                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ SSH Deploy
┌─────────────────────────────────────────────────────────────────┐
│                           VPS Server                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Traefik   │───►│  App (prod) │    │  App (dev)  │         │
│  │  (reverse   │    │  Container  │    │  Container  │         │
│  │   proxy)    │    └─────────────┘    └─────────────┘         │
│  └─────────────┘                                                │
│        │                                                         │
│        ▼                                                         │
│  Let's Encrypt (automatic SSL)                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- VPS with Ubuntu 22.04+ (or similar Linux distro)
- Domain name with DNS access
- GitHub repository
- SSH key pair for deployment

---

## Part 1: VPS Setup

### 1.1 Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### 1.2 Create Shared Docker Network

```bash
# Create external network for Traefik to route traffic
docker network create hosting
```

### 1.3 Set Up Traefik (Reverse Proxy + SSL)

Create directory structure:

```bash
mkdir -p ~/traefik
cd ~/traefik
```

Create `docker-compose.yml`:

```yaml
services:
  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/traefik.yml:ro
      - ./acme.json:/acme.json
    networks:
      - hosting

networks:
  hosting:
    external: true
```

Create `traefik.yml`:

```yaml
api:
  dashboard: false

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: hosting

certificatesResolvers:
  letsencrypt:
    acme:
      email: your-email@example.com  # Change this!
      storage: acme.json
      httpChallenge:
        entryPoint: web
```

Create and secure `acme.json`:

```bash
touch acme.json
chmod 600 acme.json
```

Start Traefik:

```bash
docker compose up -d
```

### 1.4 Create Project Directories

```bash
# For staging
mkdir -p ~/devprojects/your-app

# For production
mkdir -p ~/devprojects/your-app-prod
```

### 1.5 Clone Repository

```bash
# Staging
cd ~/devprojects/your-app
git clone git@github.com:YourOrg/your-repo.git .
git checkout stage

# Production
cd ~/devprojects/your-app-prod
git clone git@github.com:YourOrg/your-repo.git .
git checkout main
```

### 1.6 Set Up SSH Key for GitHub Actions

On your **local machine**:

```bash
# Generate a dedicated deploy key
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key

# Copy the public key
cat ~/.ssh/deploy_key.pub
```

On your **VPS**:

```bash
# Add public key to authorized_keys
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
```

Save the **private key** content for GitHub Secrets (next section).

---

## Part 2: Domain & DNS Setup

### 2.1 Configure DNS Records

Add A records pointing to your VPS IP:

| Type | Name | Value |
|------|------|-------|
| A | `app.yourdomain.com` | `YOUR_VPS_IP` |
| A | `dev-app.yourdomain.com` | `YOUR_VPS_IP` |

Wait for DNS propagation (can take up to 24-48 hours, usually faster).

---

## Part 3: Docker Configuration

### 3.1 Dockerfile (Multi-stage Build)

Create `Dockerfile` in project root:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

# Build arguments for environment variables
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Add more ARGs as needed for your app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html
# Note: Change /app/build to /app/dist for Vite default output

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 3.2 Nginx Configuration

Create `nginx.conf` in project root:

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

### 3.3 Production Docker Compose

Create `docker-compose.yml`:

```yaml
services:
  app:
    container_name: your-app-prod  # Unique container name
    build:
      context: .
      dockerfile: Dockerfile
      args:
        VITE_SUPABASE_URL: https://xxx.supabase.co
        VITE_SUPABASE_ANON_KEY: your-anon-key
        # Add more build args as needed
    networks:
      - hosting
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:80/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    labels:
      # Enable Traefik
      - "traefik.enable=true"
      - "traefik.docker.network=hosting"

      # HTTPS router
      - "traefik.http.routers.your-app-prod.rule=Host(`app.yourdomain.com`)"
      - "traefik.http.routers.your-app-prod.entrypoints=websecure"
      - "traefik.http.routers.your-app-prod.tls=true"
      - "traefik.http.routers.your-app-prod.tls.certresolver=letsencrypt"

      # HTTP router (redirect to HTTPS)
      - "traefik.http.routers.your-app-prod-http.rule=Host(`app.yourdomain.com`)"
      - "traefik.http.routers.your-app-prod-http.entrypoints=web"
      - "traefik.http.routers.your-app-prod-http.middlewares=your-app-prod-redirect"
      - "traefik.http.middlewares.your-app-prod-redirect.redirectscheme.scheme=https"

      # Service port
      - "traefik.http.services.your-app-prod.loadbalancer.server.port=80"

networks:
  hosting:
    external: true
```

### 3.4 Staging Docker Compose

Create `docker-compose.dev.yml`:

```yaml
services:
  app:
    container_name: your-app-dev  # Different container name!
    build:
      context: .
      dockerfile: Dockerfile
      args:
        VITE_SUPABASE_URL: https://xxx.supabase.co
        VITE_SUPABASE_ANON_KEY: your-anon-key
    networks:
      - hosting
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:80/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=hosting"

      # Use dev subdomain
      - "traefik.http.routers.your-app-dev.rule=Host(`dev-app.yourdomain.com`)"
      - "traefik.http.routers.your-app-dev.entrypoints=websecure"
      - "traefik.http.routers.your-app-dev.tls=true"
      - "traefik.http.routers.your-app-dev.tls.certresolver=letsencrypt"

      - "traefik.http.routers.your-app-dev-http.rule=Host(`dev-app.yourdomain.com`)"
      - "traefik.http.routers.your-app-dev-http.entrypoints=web"
      - "traefik.http.routers.your-app-dev-http.middlewares=your-app-dev-redirect"
      - "traefik.http.middlewares.your-app-dev-redirect.redirectscheme.scheme=https"

      - "traefik.http.services.your-app-dev.loadbalancer.server.port=80"

networks:
  hosting:
    external: true
```

---

## Part 4: GitHub Actions Workflows

### 4.1 Set Up GitHub Secrets

Go to: `https://github.com/YourOrg/your-repo/settings/secrets/actions`

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `SSH_HOST` | Your VPS IP address (e.g., `123.45.67.89`) |
| `SSH_USERNAME` | VPS username (e.g., `ubuntu` or `root`) |
| `SSH_PRIVATE_KEY` | Content of your private key file |
| `VITE_SUPABASE_URL` | Your Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |

### 4.2 CI Workflow (Pull Request Validation)

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main, stage]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
```

### 4.3 Deploy to Staging Workflow

Create `.github/workflows/deploy-staging.yml`:

```yaml
name: Deploy to Staging

on:
  push:
    branches: [stage]

concurrency:
  group: deploy-staging
  cancel-in-progress: false

jobs:
  checks:
    name: Pre-deploy Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

  deploy:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: checks
    environment: staging
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USERNAME }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ~/devprojects/your-app
            git pull origin stage
            docker compose -f docker-compose.dev.yml up -d --build

            echo "Waiting for container to be healthy..."
            sleep 10

            for i in $(seq 1 12); do
              STATUS=$(docker inspect --format='{{.State.Health.Status}}' your-app-dev 2>/dev/null || echo "unknown")
              if [ "$STATUS" = "healthy" ]; then
                echo "Container is healthy!"
                exit 0
              fi
              echo "Attempt $i/12: Status is $STATUS, waiting..."
              sleep 10
            done

            echo "Container did not become healthy within 2 minutes"
            docker logs your-app-dev --tail 50
            exit 1

      - name: Verify Health
        run: |
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://dev-app.yourdomain.com)
          if [ "$HTTP_CODE" = "200" ]; then
            echo "Staging health check passed (HTTP $HTTP_CODE)"
          else
            echo "Staging health check failed (HTTP $HTTP_CODE)"
            exit 1
          fi
```

### 4.4 Deploy to Production Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  checks:
    name: Pre-deploy Checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    needs: checks
    environment: production
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USERNAME }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ~/devprojects/your-app-prod
            git pull origin main
            docker compose up -d --build

            echo "Waiting for container to be healthy..."
            sleep 10

            for i in $(seq 1 12); do
              STATUS=$(docker inspect --format='{{.State.Health.Status}}' your-app-prod 2>/dev/null || echo "unknown")
              if [ "$STATUS" = "healthy" ]; then
                echo "Container is healthy!"
                exit 0
              fi
              echo "Attempt $i/12: Status is $STATUS, waiting..."
              sleep 10
            done

            echo "Container did not become healthy within 2 minutes"
            docker logs your-app-prod --tail 50
            exit 1

      - name: Verify Health
        run: |
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://app.yourdomain.com)
          if [ "$HTTP_CODE" = "200" ]; then
            echo "Health check passed (HTTP $HTTP_CODE)"
          else
            echo "Health check failed (HTTP $HTTP_CODE)"
            exit 1
          fi
```

### 4.5 Rollback Workflow (Manual Trigger)

Create `.github/workflows/rollback.yml`:

```yaml
name: Rollback

on:
  workflow_dispatch:
    inputs:
      commit_sha:
        description: "Commit SHA to rollback to"
        required: true
        type: string
      reason:
        description: "Reason for rollback"
        required: false
        type: string
        default: "Production issue"

jobs:
  rollback:
    name: Rollback to ${{ inputs.commit_sha }}
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Rollback via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USERNAME }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ~/devprojects/your-app-prod
            echo "Rolling back to ${{ inputs.commit_sha }}"
            echo "Reason: ${{ inputs.reason }}"

            git fetch origin
            git checkout ${{ inputs.commit_sha }}
            docker compose up -d --build

            echo "Waiting for container to be healthy..."
            sleep 10

            for i in $(seq 1 12); do
              STATUS=$(docker inspect --format='{{.State.Health.Status}}' your-app-prod 2>/dev/null || echo "unknown")
              if [ "$STATUS" = "healthy" ]; then
                echo "Rollback successful! Container is healthy."
                exit 0
              fi
              echo "Attempt $i/12: Status is $STATUS, waiting..."
              sleep 10
            done

            echo "Rollback failed - container did not become healthy"
            docker logs your-app-prod --tail 50
            exit 1

      - name: Verify Health
        run: |
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://app.yourdomain.com)
          if [ "$HTTP_CODE" = "200" ]; then
            echo "Rollback verified (HTTP $HTTP_CODE)"
          else
            echo "Health check failed after rollback (HTTP $HTTP_CODE)"
            exit 1
          fi
```

---

## Part 5: GitHub Environments (Optional but Recommended)

### 5.1 Create Environments

Go to: `https://github.com/YourOrg/your-repo/settings/environments`

Create two environments:

1. **staging**
   - No protection rules needed

2. **production**
   - Add protection rule: "Required reviewers" (optional)
   - Add protection rule: "Wait timer" (optional, e.g., 5 minutes)

This allows you to:
- Require approval before production deploys
- Add environment-specific secrets
- Track deployment history

---

## Part 6: Branching Strategy

```
feature/xyz ──► PR ──► stage ──► main
                        │         │
                     staging   production
```

### Rules

1. **Feature branches** merge to `stage` only (never directly to `main`)
2. **PRs** always target `stage` branch
3. **After testing on stage**, merge `stage` to `main` for production
4. **Never** merge feature branches directly to `main`

### Commands

```bash
# Create feature branch
git checkout stage
git pull origin stage
git checkout -b feature/my-feature

# Work on feature...
git add .
git commit -m "feat: my feature"
git push -u origin feature/my-feature

# Create PR targeting stage
gh pr create --base stage --title "feat: my feature" --body "Description..."

# After PR merged to stage and tested, merge stage to main
git checkout main
git pull origin main
git merge stage
git push origin main
```

---

## Part 7: Troubleshooting

### Common Issues

#### Container not becoming healthy

```bash
# SSH into VPS and check logs
docker logs your-app-prod --tail 100

# Check if container is running
docker ps -a

# Inspect health check
docker inspect your-app-prod | grep -A 20 Health
```

#### Traefik not routing traffic

```bash
# Check Traefik logs
docker logs traefik --tail 100

# Verify container is on hosting network
docker network inspect hosting

# Check Traefik dashboard (if enabled)
curl http://localhost:8080/api/rawdata
```

#### SSL certificate issues

```bash
# Check acme.json for errors
cat ~/traefik/acme.json | jq .

# Ensure acme.json has correct permissions
chmod 600 ~/traefik/acme.json

# Restart Traefik
cd ~/traefik && docker compose restart
```

#### SSH connection failed in GitHub Actions

- Verify `SSH_HOST` is correct IP (not hostname)
- Verify `SSH_USERNAME` matches VPS user
- Verify `SSH_PRIVATE_KEY` includes full key with headers
- Check VPS firewall allows port 22

---

## Part 8: Checklist

### Initial Setup

- [ ] VPS provisioned with SSH access
- [ ] Docker and Docker Compose installed
- [ ] `hosting` network created
- [ ] Traefik running and healthy
- [ ] DNS A records configured
- [ ] Project directories created
- [ ] Repository cloned to VPS (both stage and prod)
- [ ] SSH deploy key generated and configured

### GitHub Setup

- [ ] Secrets configured (SSH_HOST, SSH_USERNAME, SSH_PRIVATE_KEY, etc.)
- [ ] Environments created (staging, production)
- [ ] Branch protection rules configured (optional)

### Project Files

- [ ] `Dockerfile` created
- [ ] `nginx.conf` created
- [ ] `docker-compose.yml` created (production)
- [ ] `docker-compose.dev.yml` created (staging)
- [ ] `.github/workflows/ci.yml` created
- [ ] `.github/workflows/deploy-staging.yml` created
- [ ] `.github/workflows/deploy.yml` created
- [ ] `.github/workflows/rollback.yml` created

### Testing

- [ ] Push to `stage` triggers staging deployment
- [ ] Staging site accessible via HTTPS
- [ ] Push to `main` triggers production deployment
- [ ] Production site accessible via HTTPS
- [ ] Rollback workflow tested

---

## Quick Reference

| Action | Command/URL |
|--------|-------------|
| View staging | `https://dev-app.yourdomain.com` |
| View production | `https://app.yourdomain.com` |
| Check workflow runs | `https://github.com/YourOrg/your-repo/actions` |
| Trigger rollback | Actions > Rollback > Run workflow |
| View secrets | `https://github.com/YourOrg/your-repo/settings/secrets/actions` |
| SSH to VPS | `ssh user@your-vps-ip` |
| View container logs | `docker logs your-app-prod --tail 100` |
| Restart container | `docker compose up -d --build` |

---

*Guide created for BooX project - adaptable for any Docker-based web application.*
