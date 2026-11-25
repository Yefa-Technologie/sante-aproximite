# Signalements sur les lieux et affectation aux secours

Le module sanitaire et le module sécurité partagent les mêmes contrôles. Aucun périmètre officiel n’est inclus. Les polygones de Bouaké et Korhogo dans les tests sont des carrés **FICTIFS**, sans valeur territoriale ou opérationnelle.

## Fonctionnement

- Le téléphone demande une position précise, l’affiche sur une carte sans saisie ni déplacement manuel du point et indique la précision annoncée. Un nouveau relevé est exigé juste avant l’envoi.
- La confirmation « Je confirme être sur les lieux ou à proximité immédiate de l’incident signalé. » est obligatoire. Le formulaire rappelle de se mettre en sécurité et de ne pas s’exposer pour une photo. Les photos et le nombre estimé de victimes sont facultatifs.
- Refus, GPS désactivé, délai d’acquisition dépassé, précision insuffisante ou position périmée bloquent l’envoi et affichent comment réessayer. Une connexion au serveur est nécessaire. Aucune urgence n’est stockée pour un envoi différé ; les anciennes urgences de la file hors ligne ne sont plus rejouées.
- Le serveur valide latitude/longitude numériques, horodatage, précision et confirmation. Il refuse aussi l’indicateur de simulation GPS lorsqu’il est fourni par le téléphone. **Cela ne prouve pas que les coordonnées sont authentiques : un client modifié peut falsifier ses données.** Aucun mécanisme d’attestation matérielle n’existait dans le projet et aucune garantie absolue n’est annoncée.
- Le serveur sélectionne les polygones actifs du service demandé. Un seul centre actif correspondant : affectation enregistrée. Aucun centre, plusieurs centres différents, ou centre inactif : « À affecter », avec motif. Deux polygones du même centre ne créent pas d’ambiguïté. Une frontière commune à plusieurs centres est traitée prudemment comme ambiguë. Les exclusions intérieures sont prises en charge.
- Modifier un périmètre ne réaffecte pas silencieusement les dossiers existants. Un transfert explicite est nécessaire. La désactivation d’un centre remet ses dossiers actifs dans la file « À affecter », retire les accès de renfort correspondants et prévient la coordination, dans une même transaction.

## Configuration web et droits

Dans **Paramètres → Bases de secours et sécurité** :

1. Créer les centres réels, avec leur service et leur géolocalisation.
2. Enregistrer leurs périmètres validés sous forme de GeoJSON `Polygon`, sommets `[longitude, latitude]`, contours fermés. Aucun exemple de contour de production n’est fourni. Les contours ouverts, croisés, dégénérés ou traversant l’antiméridien sont refusés ; diviser ces derniers en zones distinctes. Limites : 20 contours et 2000 sommets par zone.
3. Affecter chaque agent à une base du même service dans **Utilisateurs**.
4. Attribuer explicitement les droits : coordination globale (y compris « À affecter »), coordination de centres déterminés, ou responsable de centres auxquels le compte est effectivement rattaché. L’administration des bases seule ne donne pas accès aux incidents.
5. Régler les seuils GPS et les protections ci-dessous, puis les ajuster après des essais sur le terrain.

| Paramètre | Valeur initiale | Plage |
| --- | --- | --- |
| Ancienneté maximale de la position | strictement moins de 60 s | 5 à 600 s |
| Précision annoncée maximale | 100 m | 1 à 5000 m |
| Signalements par minute et déclarant, tous services confondus | 3 | 1 à 30 |
| Fenêtre de doublon probable | 15 min | 1 à 120 min |
| Distance de doublon probable | 150 m | 10 à 2000 m |

Une tolérance de 5 secondes est appliquée aux petits décalages d’horloge vers le futur. L’acquisition mobile expire après 20 secondes ; l’utilisateur peut réessayer. Les seuils métier sont conservés dans `incident_policy`, lisibles par le mobile et modifiables via le web. Les zones marquées fictives doivent porter TEST/FICTIF dans leur nom et sont **exclues du routage en production** ; seuls les tests avec `NODE_ENV=test` les utilisent.

La file de coordination globale doit être surveillée. Aucun compte existant ne reçoit automatiquement un droit de coordination. Les droits multirôles et multibases restent explicites.

## Confidentialité et suivi

Les listes, détails, cartes, statistiques, exports CSV, photos, notifications et rafraîchissements périodiques utilisent le centre affecté ou une autorisation de renfort enregistrée. Une requête modifiée, `all=true`, un identifiant deviné ou un nom de ville différent ne donnent aucun accès supplémentaire. Le déclarant garde l’accès à ses propres dossiers. Les photos sont chargées dans les détails autorisés, pas dans les listes en masse. Les listes sont paginées par 300 dossiers avec `beforeId` ; les exports CSV couvrent tous les dossiers autorisés et neutralisent les cellules interprétables comme formules.

Les anciens compteurs d’incidents dans les statistiques respectent aussi ce périmètre. Les événements opérationnels ne sont pas exposés dans les statistiques génériques d’activité. Aucun canal WebSocket/SSE n’existait ; les écrans se rafraîchissent toutes les 15 secondes et le bandeau toutes les 30 secondes, sans cache hors ligne des incidents.

Statuts : `PENDING_ASSIGNMENT` (À affecter), `NEW`, `ACKNOWLEDGED`, `EN_ROUTE` (Équipe envoyée), `ON_SITE`, `COMPLETED`, `UNCONFIRMED`, `DUPLICATE`. Les anciens statuts terminaux `CLOSED`/`RESOLVED` restent lisibles. Les agents suivent la progression ; une correction exceptionnelle est réservée à la coordination. « Non confirmé » et « Doublon » exigent un motif.

Les changements, transferts et renforts conservent auteur, date, ancien/nouveau statut, centres et motif dans `incident_history`. Un transfert retire l’accès de l’ancien centre et réinitialise la prise en charge. Un renfort autorise explicitement un centre supplémentaire ; son accès peut être révoqué par un responsable habilité. Le destinataire doit être actif et du même service. La coordination peut affecter manuellement un dossier de la file.

Les notifications sont mises en file durable dans la transaction de création/transfert. Le worker les traite toutes les 15 secondes, revérifie les droits avant chaque envoi et retente en cas d’échec (12 tentatives espacées d’au moins une minute). Un ticket accepté par Expo est enregistré ; il ne prouve pas la réception physique. La notification générique ne contient ni téléphone, ni photo, ni description médicale ni coordonnées GPS. Elle ne modifie jamais le statut. Un jeton d’installation appartient à un seul compte ; il est retiré lors d’une déconnexion en ligne. La livraison sur téléphone fermé reste dépendante de FCM/APNs, des permissions, du réseau et du système mobile ; elle doit être vérifiée sur un appareil de production.

La répétition d’un même `clientRequestId` réutilise le dossier existant. Les écritures d’un déclarant sont sérialisées par verrou transactionnel PostgreSQL. Les incidents proches sont signalés comme doublons probables, conservés et soumis à la vérification des secours ; aucune suppression automatique n’a lieu.

## API

- `GET/PUT /api/incidents/policy` : lecture des seuils / gestion par l’administration.
- `GET/POST /api/incidents/zones`, `PUT /api/incidents/zones/:id` : périmètres configurés par l’administration.
- `GET /api/incidents/access/mine`, `GET /api/incidents/access`, `PUT /api/incidents/access/:userId` : droits explicites de coordination/responsable.
- `GET /api/incidents/transfer-targets` : centres destinataires pour les responsables habilités.
- `GET /api/incidents/{medical|security}` : dossiers autorisés ; `queue=1`, `status`, `dateFrom`, `dateTo`, `beforeId` disponibles.
- `GET /api/incidents/{kind}/map`, `/stats`, `/export`, `/:id`, `/:id/photos/:index` : même périmètre d’accès.
- `PATCH /api/incidents/{kind}/:id/status` : changement avec historique.
- `POST /api/incidents/{kind}/:id/transfer` : `{mode: "TRANSFER" | "REINFORCEMENT", targetBaseId, reason, authorizeTarget: true}`.
- `POST /api/incidents/{kind}/:id/revoke-reinforcement` : retrait d’un accès de renfort avec motif.
- Les créations existantes `/api/emergency-reports` et `/api/security-alerts` exigent désormais `latitude`, `longitude`, `locationTimestamp` (millisecondes Unix), `accuracyMeters`, `presenceConfirmed: true`, `clientRequestId` et les champs métier habituels. `victimCount` est un entier facultatif. Les anciennes routes de traitement délèguent au même service sécurisé ; aucun contournement de compatibilité n’est prévu.

## Migration et livraison

La migration automatique au démarrage crée les paramètres, zones, droits, autorisations de renfort, historique et file de notifications ; elle ajoute les métadonnées GPS et l’affectation aux deux tables de signalements. Les dossiers actifs historiques sans centre déterminé passent en « À affecter » avec une entrée de migration ; les dossiers terminés restent terminés. Aucun périmètre ni rattachement géographique n’est deviné. Les sauvegardes habituelles de la base doivent précéder une mise en production.

**Déployer le backend et la nouvelle version mobile ensemble** : les anciennes versions mobiles n’envoient pas toutes les données GPS exigées et leurs créations seront refusées. Préparer les centres réels, leurs polygones validés et un compte de coordination avant l’ouverture opérationnelle. Ne jamais utiliser `NODE_ENV=test` en production.

## Vérifications reproductibles

Depuis `backend` :

```powershell
node --test src/services/*.test.js src/routes/*.test.js src/config/*.test.js
$env:RUN_INCIDENT_DB_TESTS='1'
node --test src/services/incidentIntegration.test.js
```

Le test d’intégration refuse une base distante et utilise exclusivement des tables temporaires sur une connexion locale ; il applique d’abord les migrations locales. Aucun vrai signalement, périmètre opérationnel, compte ou push n’est créé par ses scénarios. Les notifications y sont simulées. Il couvre la validation GPS, les routes historiques, Bouaké/Korhogo **FICTIFS**, les accès directs croisés, cartes/photos/stats/exports, file de coordination, droits, historique, renfort, révocation, transfert, idempotence, protection contre les répétitions et doublons probables.

Depuis `mobile` : `node --test src/utils/*.test.cjs src/api/*.test.cjs src/audio/*.test.cjs`. Depuis `frontend` : `node --test lib/api-client.test.cjs` (export et expiration de session). Compiler aussi le JavaScript mobile avec Babel/Metro et construire le web avec `npm run build` depuis `frontend`. Compléter sur téléphone réel : permission refusée, GPS désactivé/imprécis, nouveau relevé avant envoi et réception effective d’un push signé en production.


### Sélection des territoires sur la carte

Dans Paramètres → Bases de secours et sécurité, cliquer sur « Sélectionner les zones d’intervention ». Choisir le niveau Départements ou Régions et districts autonomes, puis cliquer sur les territoires à couvrir. Un second clic retire le territoire. La liste des territoires sélectionnés permet aussi de les retirer individuellement.

Choisir une base active, confirmer sa responsabilité sur ces territoires, puis enregistrer. Jusqu’à 25 territoires peuvent être sélectionnés. Un territoire constitué de plusieurs polygones est enregistré en plusieurs zones pour conserver toutes ses parties. Les zones déjà configurées sont conservées ; aucune affectation historique n’est recalculée.

POST /api/incidents/zones/selection, réservé aux administrateurs des bases : {baseId,isTest,zones:[{name,geometry:GeoJSONPolygon}]}. Tous les contours sont validés avant écriture et sauvegardés dans une transaction unique (50 contours maximum). Les répétitions du même contour actif pour la même base et le même type réel/test réutilisent la zone existante. Une base inactive ou non approuvée est refusée. Les règles existantes continuent à traiter les chevauchements entre bases du même service en « À affecter ».

Vérifications : test PostgreSQL/HTTP avec données FICTIVES exclusivement dans des tables temporaires, refus sans droit, validation des contours, rejet d’une base inactive, absence de doublons au réessai, annulation complète sur échec SQL et routage d’un nouvel incident avec cloisonnement entre bases. Vérification navigateur de la sélection multiple, de la confirmation obligatoire et d’un territoire à plusieurs parties, avec API simulées.
