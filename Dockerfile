# ADR-0005: one long-running Node container serving the built board and the API, beside a
# Postgres container. This is the image the compose file runs, locally and on the VPS.
#
# Two stages, because the build needs TypeScript, Vite and every devDependency, and the
# thing that runs at 09:00 in the salon should carry none of them.

FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so a change to source does not re-download the world. package.json
# and the lockfile change far less often than src/ does.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# tsc -b, then vite build for the board, then tsc for the server. See package.json.
RUN npm run build


FROM node:22-alpine AS runtime

# WORKDIR is load-bearing, not decoration. The server reads `express.static('dist')` and
# the migration runner reads `'migrations'`, both relative to the working directory. Start
# this process anywhere else and it serves no board and applies no migrations.
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# Not built, read at runtime: server/migrate.ts applies every .sql file in here that has
# not run yet, on every start, under an advisory lock.
COPY migrations ./migrations

# The node images ship this user. Nothing here needs root, and the process only ever reads
# the files above.
USER node

EXPOSE 3000

# No --env-file here, unlike `npm start`. Compose supplies the environment, and a .env file
# is deliberately never copied into the image - see .dockerignore.
CMD ["node", "dist-server/server/index.js"]
