# Deploiement serveur et build mobile

## Cible

- Serveur: `193.168.173.181`
- Dossier applicatif: `/var/www/sante-aproximite`
- Backend Node/Express via `pm2`
- Port backend: `8081`
- API publique: `http://193.168.173.181:8081/api`

## 1. Preparation du serveur

Sur le serveur, en root:

```bash
cd /var/www
mkdir -p /var/www/sante-aproximite
cd /var/www/sante-aproximite
# cloner ici le depot Git
```

Puis:

```bash
cd /var/www/sante-aproximite
bash scripts/setup-server.sh
```

## 2. Configuration backend

Creer ou verifier `/var/www/sante-aproximite/backend/.env`:

```env
HOST=0.0.0.0
PORT=8081
DATABASE_URL=postgresql://sante_user:change_me_db_password@localhost:5432/sante_aproxmite
JWT_SECRET=change_me_strong_secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=change_me_strong_refresh_secret
JWT_REFRESH_EXPIRES_IN=30d
```

## 3. Demarrage avec PM2

```bash
cd /var/www/sante-aproximite
bash scripts/deploy-server.sh
pm2 status
pm2 logs sante-aproxmite-api
```

Le process PM2 utilise:
- fichier: `/var/www/sante-aproximite/backend/ecosystem.config.cjs`
- nom PM2: `sante-aproxmite-api`

## 4. Site web (Next.js)

Le site web est dans `frontend/`. Il appelle par defaut l'API de production
(`http://193.168.173.181:8081/api`, voir `frontend/lib/api-client.ts`) ; pour une autre API,
definir `NEXT_PUBLIC_API_URL` avant le build.

`scripts/deploy-server.sh` le compile et le lance avec PM2 :
- nom PM2 : `sante-aproxmite-web`
- port : `3000` (modifiable avec `WEB_PORT=xxxx bash scripts/deploy-server.sh`)

Le script ajoute aussi `PUBLIC_BASE_URL=http://193.168.173.181:8081` dans `backend/.env`
si absent : c'est l'adresse mise dans le QR code des centres (page publique `/avis/...`).

## 5. Application mobile

Le mobile est maintenant prepare pour attaquer la meme API publique:

```env
EXPO_PUBLIC_API_URL=http://193.168.173.181:8081/api
EXPO_PUBLIC_API_URL_PROD=http://193.168.173.181:8081/api
```

Pour une build Android locale:

```bash
cd mobile
copy .env.example .env
npm ci
npx expo export --platform android
```

Pour une build Android via EAS:

```bash
cd mobile
copy .env.example .env
npm ci
npx eas build --platform android --profile production
```

## 6. Verification rapide

Tester l'API:

```bash
curl http://193.168.173.181:8081/api/health
```

Si la route `/api/health` n'existe pas encore, tester une route connue comme:

```bash
curl -X POST http://193.168.173.181:8081/api/auth/login
```
