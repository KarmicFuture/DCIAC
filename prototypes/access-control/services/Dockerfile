# One Dockerfile, two targets. Build context: prototypes/access-control
#   docker build -f services/Dockerfile --target service -t dciac-service .
#   docker build -f services/Dockerfile --target gateway -t dciac-gateway .

FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json styles.css ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.12-slim AS service
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DCIAC_DB=/data/dciac.sqlite DCIAC_SEED_DB=/app/data/unubtanium.sqlite \
    DCIAC_HOST=0.0.0.0 DCIAC_PORT=8080
WORKDIR /app
COPY server ./server
COPY services ./services
COPY data/unubtanium.sqlite ./data/unubtanium.sqlite
RUN useradd --uid 10001 --no-create-home dciac && mkdir -p /data && chown dciac /data
USER dciac
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python3 -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/readyz',timeout=2).status==200 else 1)"
CMD ["python3", "services/service.py"]

FROM python:3.12-slim AS gateway
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DCIAC_HOST=0.0.0.0 DCIAC_PORT=8766
WORKDIR /app
COPY serve.py ./serve.py
COPY server ./server
COPY services ./services
COPY --from=web /app/dist ./dist
RUN useradd --uid 10001 --no-create-home dciac
USER dciac
EXPOSE 8766
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python3 -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8766/healthz',timeout=2).status==200 else 1)"
CMD ["python3", "services/gateway.py"]
