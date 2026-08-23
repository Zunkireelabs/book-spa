# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ARG VITE_ENABLE_MEMBERSHIP
ARG VITE_ENABLE_VOUCHERS
ARG VITE_ENABLE_CUSTOMER_REFERRALS
ARG VITE_ENABLE_OUTREACH
ARG VITE_ENABLE_PLATFORM_ADMIN
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
