FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv curl libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN python3 -m venv /opt/python && /opt/python/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/python/bin:$PATH" NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 DIRTIQ_DATABASE_DIR=/app/data DIRTIQ_MODEL_DIR=/app/data/models OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/data/dirtiq_model_*.pkl /app/data/
COPY --from=build /app/data/feature_params_*.json /app/data/
COPY scripts ./scripts
COPY src/lib/mrp-lineup.ts ./src/lib/mrp-lineup.ts
COPY scripts/start-production.sh ./start-production.sh
EXPOSE 3000
CMD ["sh", "./start-production.sh"]
