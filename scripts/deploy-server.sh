#!/bin/bash
set -euo pipefail

APP_DIR="/var/www/sante-aproximite"
BACKEND_DIR="$APP_DIR/backend"
WEB_DIR="$APP_DIR/frontend"
PUBLIC_BASE_URL_DEFAULT="http://193.168.173.181:8081"
WEB_PORT="${WEB_PORT:-3000}"

echo "==> Deploiement Sante Aproximite"
echo "Dossier cible : $APP_DIR"

mkdir -p "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Le depot Git n'existe pas dans $APP_DIR."
  echo "Clonez d'abord le projet dans ce dossier, puis relancez ce script."
  exit 1
fi

cd "$APP_DIR"
git pull --ff-only

echo "==> Backend"
cd "$BACKEND_DIR"
npm ci

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Fichier backend/.env cree. Pensez a verifier DATABASE_URL et les secrets JWT."
fi

# URL publique utilisee dans le QR code des centres (page /avis/...).
if ! grep -q "^PUBLIC_BASE_URL=." .env; then
  sed -i '/^PUBLIC_BASE_URL=/d' .env
  echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL_DEFAULT" >> .env
  echo "PUBLIC_BASE_URL ajoute a backend/.env ($PUBLIC_BASE_URL_DEFAULT)"
fi

# Les migrations de base de donnees s'executent au demarrage du backend.
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> Frontend web (Next.js)"
cd "$WEB_DIR"
npm ci
# Sans NEXT_PUBLIC_API_URL, le frontend utilise l'API de production (lib/api-client.ts).
rm -rf .next
npm run build

if pm2 describe sante-aproxmite-web > /dev/null 2>&1; then
  pm2 restart sante-aproxmite-web --update-env
else
  pm2 start npm --name sante-aproxmite-web --cwd "$WEB_DIR" -- run start -- -p "$WEB_PORT"
fi
pm2 save

echo "==> Termine"
echo "API PM2 : sante-aproxmite-api (port 8081)"
echo "Web PM2 : sante-aproxmite-web (port $WEB_PORT)"
