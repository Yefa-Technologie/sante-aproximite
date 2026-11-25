# Carte géographique des secours

La carte unique de ServiceCoverageMap affiche le découpage régions/départements, les points GPS des bases et les périmètres opérationnels dans le même système de coordonnées longitude/latitude. Elle ne charge ni PDF ni image de carte.

## Fond actif : civ-operational-background.json

- 31 régions et 2 districts autonomes, 109 départements correspondant au découpage représenté par le document de référence, dont Ouellé.
- Géométries sources : CNTIG / OCHA West and Central Africa (ROWCA), COD-AB Côte d’Ivoire, version 01, limites datées de 2018. Téléchargement HDX consulté le 30 octobre 2026.
- Source : https://data.humdata.org/dataset/cod-ab-civ
- Licence : Creative Commons Attribution 3.0 Intergovernmental Organisations, https://creativecommons.org/licenses/by/3.0/igo/ .
- Archive source : civ_admin_boundaries.geojson.zip, ressource 321e55d2-3486-400a-a855-4b749cf9ef88 du jeu HDX.
- Attention aux niveaux : dans cette source, civ_admin1 représente les régions/districts autonomes, civ_admin2 les départements et civ_admin3 les sous-préfectures. Les noms génériques de niveaux indiqués dans certaines métadonnées HDX ne correspondent pas à ces appellations ivoiriennes.

### Mise à jour documentée d’Ouellé

La source géographique étant antérieure à 2020, le département d’Ouellé est reconstitué par union des polygones de sous-préfectures Ouellé, Ananda et Akpassanou (orthographe du fichier source). Daoukro conserve Daoukro, Ettrokro, N’Gattakro et Samanza.

Référence officielle : communiqué du Conseil des ministres du 23 septembre 2020, https://www.presidence.ci/wp-content/uploads/2020/09/CCM-du-23-09-2020.pdf . Le communiqué utilise l’orthographe Akpassounou.

Le générateur vérifie que cette opération ne crée ni chevauchement ni perte de couverture entre Ouellé et Daoukro. Il ne s’agit pas d’un nouveau relevé officiel des frontières. Les géométries sont simplifiées à 0,001 degré pour l’affichage, avec préservation de la validité de chaque polygone. Les détails graphiques des contours peuvent différer des tracés cartographiques du document.

### Régénération

Dépendance : Python avec Shapely. Extraire l’archive HDX puis exécuter depuis la racine :

    python scripts/build-rescue-map-background.py --source chemin/vers/archive_extraite

Vérifications effectuées : 109 identifiants départementaux uniques, géométries valides, couverture Daoukro/Ouellé, positions GPS Bouaké et Korhogo dans les bons départements, affichage et filtres dans le navigateur avec données fictives.

## Présentation

La palette des régions s’inspire du document fourni : Jfblanc, Wikimedia Commons, « Map of Côte d’Ivoire Regions and Departments with Names (FR) », CC BY-SA 4.0. Les tracés du SVG illustratif ne sont pas utilisés pour placer les points GPS.

https://commons.wikimedia.org/wiki/File:Map_of_C%C3%B4te_d%27Ivoire_Regions_and_Departments_with_Names_(FR).svg

Les anciens fichiers civ-adm0/1/2.geojson et sources.json proviennent de geoBoundaries et ne sont plus chargés par la carte active.

## Zones d’intervention

Le fond administratif fournit des repères visuels. Il ne crée ni ne modifie automatiquement les zones d’intervention. Celles-ci restent définies dans emergency_zones et validées côté serveur. Aucune base n’obtient un territoire ou des droits par simple affichage sur cette carte.


## Recherche de villes et positionnement des bases

civ-localities.json contient les lieux habités de l’extrait Côte d’Ivoire de GeoNames, téléchargé le 30 octobre 2026 : https://download.geonames.org/export/dump/CI.zip . Attribution GeoNames, CC BY 4.0, https://www.geonames.org/export/ . Le fichier est distribué avec l’application : la recherche ne dépend pas du service de géocodage GeoNames.

Filtrage : classe P, hors lieux abandonnés/détruits/historiques PPLQ/PPLW/PPLH. Noms, alias, latitude/longitude WGS84 et population proviennent de l’extrait. La liste est triée par population décroissante puis par nom pour présenter les villes principales en premier. Les coordonnées d’une ville servent à centrer la carte ; le point peut ensuite être déplacé jusqu’au site de la base. Les tuiles de détail sont fournies par OpenStreetMap et nécessitent Internet.

Le formulaire GeoJSON de création manuelle des périmètres a été retiré. Les zones se choisissent sur la carte administrative ; les zones existantes peuvent être activées ou désactivées sans suppression des données.


### Avertissement de position éloignée de la localité

Le sélecteur garde le centre de la ville/village choisi, même si le point de la base est déplacé. Au-delà d’un rayon de repère de 5 km par défaut, modifiable dans le formulaire (0,1 à 100 km), il affiche un avertissement non bloquant. La distance utilise la formule de Haversine ; le repère est visible comme un cercle sur la carte. Il ne s’agit pas d’une frontière communale : GeoNames fournit des points, pas les polygones des villes. En édition, le centre de localité homonyme le plus proche de la position initialement enregistrée sert de repère. Une ville saisie librement sans correspondance sélectionnée n’a pas de frontière déduite arbitrairement.

Vérifications navigateur : avertissement lorsque le point s’éloigne, disparition au retour, modification du rayon et enregistrement réussi malgré l’avertissement, avec API simulées.
