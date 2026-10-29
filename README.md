# Sante Aproximite

Projet monorepo:
- `backend`: API Node.js + Express + PostgreSQL (auth JWT, gestion centres/services, recherche geolocalisee)
- `mobile`: application mobile Expo (React Native)
- `web-vue`: application web Vue.js (carte, navigation, plaintes, espace chef)

## 1. Fonctionnalites implementees

- Assistant IA mobile : conversation en français, lecture vocale et raccourcis vers les modules accessibles.

### Configuration de l'assistant mobile

L'assistant utilise Google Gemini pour le dialogue, la transcription et la voix, avec des modèles proposés dans l'offre gratuite (sous réserve de quotas et de disponibilité du compte/pays). Créer une clé dans [Google AI Studio](https://aistudio.google.com/apikey) et utiliser un projet **sans facturation activée** pour rester dans le quota gratuit. L'application ne peut pas vérifier le statut de facturation d'une clé. Les quotas peuvent changer et l'accès gratuit n'est pas illimité : [tarifs officiels](https://ai.google.dev/gemini-api/docs/pricing).

Dans `backend/.env`, renseigner `GEMINI_API_KEY`, puis redémarrer le backend. Ne jamais mettre la clé dans les variables `EXPO_PUBLIC_*`. Aucune clé OpenAI n'est nécessaire et aucun repli vers un fournisseur payant n'est effectué. Si le quota Google est atteint, tous les utilisateurs mobiles voient uniquement « Assistant IA indisponible, veuillez réessayer plus tard. » (également pour un compte administrateur utilisant le chat mobile).
Installer les dépendances de `mobile` avec `npm install`, puis relancer Expo. Pour une application native déjà compilée, reconstruire Android/iOS pour intégrer `expo-audio` et la permission microphone. Compatible avec Expo Go SDK 54.

L'entrée « Assistant IA » permet d'écrire ou d'enregistrer une question au micro (Android/iOS). Touchez « Micro », autorisez le micro et parlez : une visualisation sonore suit le niveau du micro. Une pause d'environ 1,6 seconde ou le bouton « Terminer » termine le vocal. Il reste **local**, avec durée, visualisation, lecture d'aperçu et boutons « Envoyer » / « Annuler ». Aucun audio n'est transmis et aucune transcription n'est demandée avant « Envoyer ». « Annuler » supprime le fichier sans appel IA. Chaque vocal est limité à 60 secondes ; un silence prolongé sans parole annule l'enregistrement.

Après « Envoyer », le vocal est transcrit puis la question reçoit une réponse textuelle, avec lecture à voix haute si activée. Un échec produit toujours un retour dans la conversation ; le vocal reste disponible pour réessayer ou annuler. Une transcription déjà réussie est réutilisée lors d'une nouvelle tentative. Le micro ne reprend jamais automatiquement. Le passage en arrière-plan interrompt le micro et la lecture ; un vocal déjà terminé reste disponible au retour sur cet écran.

La connexion est vérifiée avec NetInfo avant les appels : hors connexion, l'assistant affiche « Vous êtes hors connexion, vous ne pouvez donc pas utiliser l’assistant IA. Pour l’utiliser, activez votre connexion internet. » Les messages d'erreur peuvent être lus avec la voix du téléphone, y compris hors connexion, selon les voix installées. Le message « Assistant IA indisponible… » est réservé aux refus de quota/débit. Une panne technique ou un délai dépassé produit « Une erreur est survenue pendant le traitement de votre demande. Veuillez réessayer. » Les requêtes IA ne sont ni mises en file hors ligne ni rejouées contre des serveurs de secours.

Le modèle vocal a un quota distinct du dialogue texte. Si une réponse existe mais que la génération vocale échoue (y compris pour quota vocal), la réponse est lue avec une voix française installée sur le téléphone, sans annoncer que tout l'assistant est indisponible. Le quota vocal reste signalé à l'administrateur. Le bouton d'arrêt coupe aussi cette lecture de secours. Si le moteur vocal du téléphone échoue, seul un message sur l'échec de lecture est affiché ; la réponse textuelle reste disponible. Le rendu de secours dépend des voix installées.

Les dépassements de quota/débit du fournisseur créent un incident persistant dans `assistant_quota_alerts`. Une alerte courriel est envoyée au destinataire `CONTACT_RECIPIENT` via la configuration SMTP existante. Aucun message utilisateur, audio ni clé n'est inclus. Les alertes sont regroupées par modèle et par heure ; un échec SMTP laisse l'incident non notifié et permet une nouvelle tentative après cinq minutes lors d'un prochain dépassement. Les administrateurs `DEVELOPER`, `NATIONAL`, `REGULATOR` voient une alerte dans la barre supérieure de l'espace web d'administration pour les incidents des dernières 24 heures (actualisation toutes les minutes). Ils peuvent aussi consulter les 100 derniers incidents via `GET /api/assistant/admin/alerts`, même si aucune clé Gemini n'est configurée. La livraison du courriel nécessite une configuration SMTP valide ; l'alerte web reste disponible sans SMTP.

L'application utilise les marges système Android/iOS via `react-native-safe-area-context` pour garder les en-têtes, formulaires et pieds de page à l'écart de la barre d'état, des encoches et des boutons de navigation. La connexion et le menu principal utilisent également ces marges.

Dans « Centres de santé », le bouton « Assistant IA » près de la recherche ouvre un assistant dédié avec saisie écrite et micro (vocal à confirmer par Envoyer / Annuler). Exemples : « une maternité près de moi », « un centre avec un scanner à Bouaké ». L'IA extrait uniquement des critères, puis l'application filtre son catalogue local ; aucun établissement n'est inventé ou ajouté par le modèle. « Afficher les centres trouvés » ferme l'assistant et ouvre la liste filtrée, avec les itinéraires disponibles. L’IA interprète la demande naturelle et les synonymes usuels. Le nom est recherché mot par mot, sans imposer une expression exacte : les mots génériques (clinique, centre…) ne masquent pas un nom distinctif, les petites fautes sont tolérées et les correspondances partielles sont signalées. Les résultats sont classés par pertinence puis par distance. Les critères de service actif, équipement et localité restent cumulés ; les accents sont ignorés. Les centres inactifs ou non approuvés sont exclus. La recherche IA parcourt tout le catalogue accessible sans appliquer de rayon, y compris pour une demande « près de moi ». La position GPS sert uniquement à calculer les distances à vol d’oiseau et départager les résultats de même pertinence ; son absence ne masque aucun centre. Chaque résultat et les trois premiers centres résumés dans la réponse vocale indiquent la distance, la région, le district sanitaire et la ville. Les informations manquantes sont signalées : la ville n’est jamais déduite du nom du district sanitaire. Sans correspondance, l'assistant propose de modifier les critères. Les informations correspondent à la dernière synchronisation du catalogue, sans garantie de disponibilité en temps réel. Les erreurs de connexion, quotas et voix utilisent les mêmes règles que l'assistant principal.

API dédiée authentifiée : `POST /api/assistant/center-search`, corps `{ "question": "Une maternité à Bouaké" }`, réponse `{ "intent": { "name": "", "service": "maternité", "equipment": "", "locality": "Bouaké", "nearby": false, "radiusKm": null } }`. Aucun catalogue ni coordonnées GPS n'est envoyé à Gemini pour cette recherche ; seule la demande utilisateur est transmise.

Variables backend optionnelles : `GEMINI_MODEL=gemini-3.1-flash-lite`, `GEMINI_TRANSCRIPTION_MODEL=gemini-3.1-flash-lite`, `GEMINI_SPEECH_MODEL=gemini-2.5-flash-preview-tts`, `GEMINI_SPEECH_VOICE=Aoede`. Le TTS est un modèle preview et possède ses propres quotas. La voix renvoyée en PCM est convertie en WAV mono côté serveur pour la lecture mobile.

La conversation reste en mémoire sur cet écran et n'est pas mise en file d'attente hors ligne. Les messages, enregistrements et textes à lire sont transmis à Google Gemini. Selon les conditions de l'offre gratuite, ces données peuvent servir à améliorer les produits Google : ne pas envoyer de données personnelles ou médicales identifiantes. Les fichiers audio temporaires sont supprimés après transcription, annulation ou fin/arrêt de lecture. Sans clé ou connexion, les raccourcis restent utilisables. L'assistant ne consulte pas le catalogue en direct et renvoie vers la recherche de centres pour les informations locales. Il ne pose pas de diagnostic et n'envoie pas d'alerte à la place de l'utilisateur.

API authentifiée : `POST /api/assistant/chat`, corps `{ "messages": [{ "role": "user", "content": "Comment trouver un centre ?" }] }`. Maximum 12 messages, 2000 caractères chacun. `POST /api/assistant/transcribe`, corps `{ "audio": "<M4A en base64>" }` (3 Mo décodés maximum). `POST /api/assistant/speech`, corps `{ "text": "Bonjour" }` (3500 caractères maximum), renvoie `{ "audio": "<WAV en base64>", "format": "wav" }`. Limite locale de 10 requêtes/minute/utilisateur/route/processus serveur, en plus des quotas Google. Node.js 20+ recommandé.

Vérification : `node --test backend/src/services/assistantService.test.js backend/src/services/assistantQuotaAlert.test.js backend/src/routes/assistantRoutes.test.js mobile/src/audio/voiceActivity.test.cjs mobile/src/audio/assistantFeedback.test.cjs mobile/src/audio/deviceSpeech.test.cjs mobile/src/utils/assistedCenterSearch.test.cjs`.

- Inscription / connexion utilisateur
- Roles:
  - `CHEF_ETABLISSEMENT`: peut creer un centre et declarer ses services
- `USER`: peut consulter les centres les plus proches
- Geolocalisation utilisateur via GPS de l'appareil
- Affichage des centres sur carte native (`react-native-maps`)
- Classement des centres par distance (km)
- Affichage du plateau technique et des services

## 2. Installation

### Prerequis
- Node.js 18+
- PostgreSQL local ou distant

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API: `http://localhost:5000`
Au demarrage, le backend cree automatiquement les tables PostgreSQL si elles n'existent pas.

### Mobile Expo (React Native)
```bash
cd mobile
cp .env.example .env
npm install
npm start
```

Puis:
- `a` dans le terminal Expo pour Android
- ou `npm run android`

### Web Vue.js
```bash
cd web-vue
cp .env.example .env
npm install
npm run dev
```

App web: `http://localhost:5174`

Production (meme backend que mobile):
```bash
cd web-vue
npm run build
```
La build lit `web-vue/.env.production` et pointe vers:
`http://193.168.173.181:5000/api`

## 3. Variables d'environnement

### backend/.env
- `HOST=0.0.0.0`
- `PORT=5000`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sante_aproxmite`
- `JWT_SECRET=change_me_strong_secret`
- `JWT_EXPIRES_IN=7d`
- `JWT_REFRESH_SECRET=change_me_strong_refresh_secret`
- `JWT_REFRESH_EXPIRES_IN=30d`

### mobile/.env
- `EXPO_PUBLIC_API_URL=http://10.0.2.2:5000/api`
- `EXPO_PUBLIC_API_URL_DEV=http://10.0.2.2:5000/api`
- `EXPO_PUBLIC_API_URL_PROD=http://193.168.173.181:5000/api`

### web-vue/.env
- `VITE_API_URL=http://localhost:5000/api`

Pour les tests locaux:
- Emulateur Android / Expo Go Android: `10.0.2.2`
- Telephone physique sur le meme reseau Wi-Fi: remplacer par l'IP locale du PC, par exemple `http://192.168.x.x:5000/api`

### web-vue/.env.production

- `VITE_API_URL=http://193.168.173.181:5000/api`

## 4. Endpoints backend

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`

### Centres
- `GET /api/centers` (auth)
- `GET /api/centers/nearby?latitude=..&longitude=..&radiusKm=20` (auth)
- `POST /api/centers` (auth + role CHEF_ETABLISSEMENT)
- `POST /api/centers/import` (auth + role CHEF_ETABLISSEMENT, import en masse)
- `POST /api/centers/:id/services` (auth + role CHEF_ETABLISSEMENT)
- `POST /api/centers/:id/complaints` (auth, plainte usager)
- `GET /api/centers/:id/complaints` (auth + role CHEF_ETABLISSEMENT, uniquement ses centres)

### Plaintes
- `POST /api/complaints` (auth, centre optionnel)
  - body:
    - `subject` (obligatoire)
    - `message` (obligatoire)
    - `centerId` (optionnel)

Exemple body pour `POST /api/centers/import`:
```json
{
  "centers": [
    {
      "name": "Hopital Regional A",
      "address": "Avenue 1",
      "technicalPlatform": "Urgences, Laboratoire, Imagerie",
      "latitude": 6.5244,
      "longitude": 3.3792,
      "services": [
        { "name": "Urgences" },
        { "name": "Laboratoire", "description": "Analyses medicales" }
      ]
    },
    {
      "name": "Centre Medical B",
      "address": "Boulevard 2",
      "technicalPlatform": "Consultation generale",
      "latitude": 6.452,
      "longitude": 3.395,
      "services": "Consultation, Vaccination"
    }
  ]
}
```

## 5. Flux metier attendu

1. Un chef s'inscrit avec role `CHEF_ETABLISSEMENT`.
2. Il cree un centre de sante (nom, adresse, plateau technique, coordonnees GPS).
3. Il ajoute les services du centre.
4. Un utilisateur standard se connecte.
5. Il ouvre le menu "centres les plus proches".
6. L'application detecte sa position et affiche les centres les plus proches, tries par distance.

## 6. Version native avec Expo

### Lancement Android
```bash
cd mobile
npm install
npm run android
```

### Lancement iOS (macOS)
```bash
cd mobile
npm install
npm run ios
```

Notes:
- Sur Android, acceptez la permission de localisation au premier lancement.
- Si vous testez sur un telephone physique, remplacez `EXPO_PUBLIC_API_URL` par l'IP locale de votre machine (ex: `http://192.168.1.20:5000/api`).

### Bases et alertes des services de secours (mobile et web)
Les utilisateurs publics ne consultent que leurs propres signalements et leur suivi. Les alertes entrantes sont réservées aux comptes SAMU, SAPEUR_POMPIER ou sécurité affectés à une base active du même service. La sélection utilise la ville ou le rayon GPS de cette base (20 km par défaut, configurable de 1 à 200 km), jamais la position du téléphone de l’agent. Sans affectation, aucun signalement entrant n’est visible. Le contrôle s’applique aussi aux prises en charge et mises à jour par identifiant.

Dans le web, Paramètres → Bases de secours et sécurité permet aux comptes DEVELOPER, NATIONAL et REGULATOR de créer, géolocaliser et modifier les bases. Paramètres → Utilisateurs exige une base compatible pour chaque rôle opérationnel. Les comptes existants doivent être affectés explicitement : aucune base n’est choisie automatiquement. Un compte opérationnel peut affecter un compte de son service uniquement à sa propre base. Les comptes multirôles peuvent avoir une base pour chaque service.

API : GET/POST `/api/service-bases`, PUT `/api/service-bases/:id`, GET `/api/service-bases/mine`. Le corps utilisateur utilise `serviceBases: {"SAMU":"123"}`. Migration automatique : colonnes ville, rayon, activation des bases ; table `user_service_bases` avec contrainte de correspondance base/service. Le flux privé `/api/emergency-reports/local-alerts` se rafraîchit toutes les 30 secondes au premier plan, sans cache ni suivi GPS personnel. Les notifications génériques ciblent uniquement les agents habilités des bases concernées ; leur livraison hors application nécessite des jetons Expo et une configuration FCM/APNs valide. Aucun signalement réel ni push réel n’est envoyé par les tests.
