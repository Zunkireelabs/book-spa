# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
# Feature flags are NOT passed as individual build-args/ARGs (that required
# a matching edit in both this file and every deploy workflow per flag —
# forgotten twice already, see .env.staging/.env.production's own header).
# Instead they live in the committed .env.staging / .env.production files,
# which Vite loads automatically based on BUILD_MODE below.
ARG BUILD_MODE=production
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build --mode ${BUILD_MODE}

# Stage 2: Serve
FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
