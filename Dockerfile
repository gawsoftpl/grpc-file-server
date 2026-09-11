FROM node:24-alpine AS builder

WORKDIR /project

ARG ENV

COPY package.json .

RUN npm install

COPY . .

RUN npm run build

# Download GRPC healthcheck
RUN GRPC_HEALTH_PROBE_VERSION=v0.4.34  \
    && wget -qO/bin/grpc_health_probe https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64 \
    && chmod +x /bin/grpc_health_probe

USER node

FROM node:24-alpine AS prod

WORKDIR /project

COPY package.json .

RUN npm install --omit=dev

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS deploy

COPY --from=builder /bin/grpc_health_probe /bin/grpc_health_probe

WORKDIR /project

COPY package.json /project/package.json
COPY protos /project/protos
COPY --from=prod /project/node_modules /project/node_modules

# Copy data from builder
COPY --from=builder /project/dist /project/dist

EXPOSE 3000

CMD ["/project/dist/main" ]
