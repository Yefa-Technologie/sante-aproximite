#!/bin/bash
set -euo pipefail

APP_DIR="/var/www/sante-aproximite"
BACKEND_DIR="$APP_DIR/backend"
WEB_DIR="$APP_DIR/frontend"
# Adresse publique du site : utilisee dans le QR code des centres (page /avis/..., routee par nginx vers l'API).
PUBLIC_BASE_URL_DEFAULT="https://sante-aproximite.yefa-technologie.org"
# Nom PM2 et port du site Next.js (nginx : location / -> 127.0.0.1:3000).
WEB_PM2_NAME="${WEB_PM2_NAME:-sante-frontend}"
WEB_PORT="${WEB_PORT:-3000}"

echo "==> Deploiement Sante Aproximite"
echo "Dossier cible : $APP_DIR"

# Next.js 16 exige Node >= 20.9 : on charge Node 20 via nvm (le Node systeme est en v18).
export NVM_DIR="${NVM_DIR:-/root/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" > /dev/null
  nvm use 20 > /dev/null
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node $(node -v) detecte : Node 20 ou plus est requis (installez-le avec nvm : nvm install 20)."
  exit 1
fi
echo "Node $(node -v)"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Le depot Git n'existe pas dans $APP_DIR."
  echo "Clonez d'abord le projet dans ce dossier, puis relancez ce script."
  exit 1
fi

cd "$APP_DIR"
git pull --ff-only

echo "==> Backend"
cd "$BACKEND_DIR"
npm ci --no-audit --no-fund

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Fichier backend/.env cree. Pensez a verifier DATABASE_URL et les secrets JWT."
fi

if ! grep -q "^PUBLIC_BASE_URL=." .env; then
  sed -i '/^PUBLIC_BASE_URL=/d' .env
  # Garantit un retour a la ligne final avant d'ajouter la variable.
  [ -n "$(tail -c 1 .env)" ] && echo >> .env
  echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL_DEFAULT" >> .env
  echo "PUBLIC_BASE_URL ajoute a backend/.env ($PUBLIC_BASE_URL_DEFAULT)"
fi

# Les migrations de base de donnees s'executent au demarrage du backend.
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> Frontend web (Next.js)"
cd "$WEB_DIR"
npm ci --no-audit --no-fund
# Sans NEXT_PUBLIC_API_URL, le frontend utilise l'API de production (lib/api-client.ts).
# Pas de suppression prealable de .next : si la compilation echoue, le site en ligne continue de tourner.
npm run build

if pm2 describe "$WEB_PM2_NAME" > /dev/null 2>&1; then
  pm2 restart "$WEB_PM2_NAME" --update-env
else
  pm2 start "$WEB_DIR/node_modules/.bin/next" --name "$WEB_PM2_NAME" --cwd "$WEB_DIR" --interpreter "$(command -v node)" -- start -p "$WEB_PORT"
fi
pm2 save

echo "==> Verification"
sleep 5
curl -fsS "http://127.0.0.1:8081/api/health" > /dev/null && echo "API : OK" || echo "API : injoignable (pm2 logs sante-aproxmite-api)"
curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" && echo "Web : OK" || echo "Web : injoignable (pm2 logs $WEB_PM2_NAME)"

echo "==> Termine"
echo "API PM2 : sante-aproxmite-api (port 8081)"
echo "Web PM2 : $WEB_PM2_NAME (port $WEB_PORT)"
