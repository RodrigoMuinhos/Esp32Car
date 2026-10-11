# Public demonstration (SIMULAÇÃO only): the panel and the simulated race in one service.
# No boards, no wheels: nothing here can move a real car. For the event, run the app on the PC Central.
FROM node:20-slim AS panel
WORKDIR /panel
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN VITE_DEMO=1 npx vite build

FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY --from=panel /panel/dist frontend/dist
ENV RC_DEMO=1 PYTHONUNBUFFERED=1 PORT=8080
EXPOSE 8080
CMD ["python", "-m", "backend.server", "--demo"]
