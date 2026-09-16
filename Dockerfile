FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Templated (not a plain .conf) so nginx's own entrypoint substitutes $BACKEND_INTERNAL_PORT from
# the environment at container start - see nginx.conf.template for why, and docker-compose.yml for
# where that env var is set.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]