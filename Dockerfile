FROM node:22-alpine as build
ARG VITE_BACKEND_PORT
ENV VITE_BACKEND_PORT=$VITE_BACKEND_PORT
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]