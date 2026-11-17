# Adaptador de referencia POL-IAQ ⇄ CAD municipal (Modo A).
# Construir desde la raíz del repositorio:
#   docker build -f services/cad-adaptador/Dockerfile -t poliaq-cad-adaptador .
# Sirve para las dos formas de despliegue (alojado por POL-IAQ o instalado en el municipio):
# cambia solo la configuración (ver docs/interconexion/ADAPTADOR.md).
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/cad-adaptador/package.json services/cad-adaptador/
RUN pnpm install --frozen-lockfile --filter @pol-iaq/cad-adaptador... --prod=false
COPY packages/shared packages/shared
COPY services/cad-adaptador services/cad-adaptador
RUN pnpm --filter @pol-iaq/shared build && pnpm --filter @pol-iaq/cad-adaptador build \
 && pnpm deploy --filter @pol-iaq/cad-adaptador --prod --legacy /salida

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /salida /app
USER node
EXPOSE 4100
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT:-4100}/salud || exit 1
CMD ["node", "dist/main.js"]
