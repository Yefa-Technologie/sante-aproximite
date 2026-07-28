import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { apiFetch } from "../api/client";
import {
  ensureCatalogDownloaded,
  getCenterCatalogMeta,
  loadCenterCatalog,
  META_KEY_INITIAL_LOAD_NOTIFIED,
  setCenterCatalogMeta,
  syncCenterCatalog,
} from "../storage/centerCatalog";
import { loadCachedAllDistricts, loadCachedRegions, saveCachedAllDistricts, saveCachedRegions } from "../storage/geoCatalog";
import { useAuth } from "../context/AuthContext";
import { C, R, S } from "../theme";

const MAX_MAP_CENTER_MARKERS = 200;

function hasValidCoordinates(center) {
  const lat = Number(center?.location?.coordinates?.[1]);
  const lon = Number(center?.location?.coordinates?.[0]);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function parseRadiusKm(rawValue) {
  const normalized = String(rawValue ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 700) return null;
  return parsed;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function normalizeSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function extractCenterCity(center, districtsByCode, regionsByCode) {
  const districtCode = String(center?.districtCode || "").trim().toUpperCase();
  const regionCode = String(center?.regionCode || "").trim().toUpperCase();
  const address = String(center?.address || "").trim();
  const parts = address.split(",").map((item) => item.trim()).filter(Boolean);
  if (districtCode && districtsByCode?.[districtCode]) return districtsByCode[districtCode];
  if (parts.length >= 2) return parts[parts.length - 2];
  if (parts.length === 1) return parts[0];
  if (regionCode && regionsByCode?.[regionCode]) return regionsByCode[regionCode];
  return "";
}

export function ReferralCenterScreen() {
  const { token, user } = useAuth();
  const mapRef = useRef(null);
  const [coords, setCoords] = useState(null);
  const [radiusKm, setRadiusKm] = useState("15");
  const [searchQuery, setSearchQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("ALL");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [centers, setCenters] = useState([]);
  const [selectedCenterId, setSelectedCenterId] = useState("");
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [regions, setRegions] = useState([]);
  const [allDistricts, setAllDistricts] = useState([]);
  const noticeTimeoutRef = useRef(null);

  const allRoles = useMemo(() => {
    const roles = Array.isArray(user?.roles) ? user.roles.map((entry) => String(entry?.role || entry).toUpperCase()) : [];
    return new Set([String(user?.role || "").toUpperCase(), ...roles]);
  }, [user]);

  const isEtablissementAccount = allRoles.has("CHEF_ETABLISSEMENT") || allRoles.has("ETABLISSEMENT");

  const actorLabel = useMemo(() => {
    if (allRoles.has("SAMU")) return "SAMU";
    if (allRoles.has("SAPEUR_POMPIER") || allRoles.has("SAPPEUR_POMPIER")) return "Sapeurs-Pompiers";
    if (isEtablissementAccount) return "Centre de sante";
    return "Service de sante";
  }, [allRoles, isEtablissementAccount]);

  const districtsByCode = useMemo(() => {
    const map = {};
    allDistricts.forEach((d) => { if (d?.code) map[String(d.code).toUpperCase()] = d.name || d.code; });
    return map;
  }, [allDistricts]);

  const regionsByCode = useMemo(() => {
    const map = {};
    regions.forEach((r) => { if (r?.code) map[String(r.code).toUpperCase()] = r.name || r.code; });
    return map;
  }, [regions]);

  function showCatalogNotice(message, { tone = "success", durationMs = 12000 } = {}) {
    if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    setCatalogNotice({ message, tone });
    if (durationMs > 0) {
      noticeTimeoutRef.current = setTimeout(() => {
        setCatalogNotice(null);
        noticeTimeoutRef.current = null;
      }, durationMs);
    }
  }

  function applyCatalogToState(catalog, position, radiusValue) {
    const parsedRadius = isEtablissementAccount ? null : parseRadiusKm(radiusValue);
    if (!position) return;
    if (!isEtablissementAccount && parsedRadius === null) return;
    const sourceCenters = Array.isArray(catalog?.centers) ? catalog.centers : [];
    const safeData = sourceCenters
      .filter(hasValidCoordinates)
      .map((center) => {
        const lat = Number(center.location.coordinates[1]);
        const lon = Number(center.location.coordinates[0]);
        const distanceKm = haversineKm(position.lat, position.lon, lat, lon);
        return {
          ...center,
          distanceKm: Number(distanceKm.toFixed(2)),
          services: Array.isArray(center?.services) ? center.services : [],
        };
      })
      .filter((center) => isEtablissementAccount || center.distanceKm <= parsedRadius)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    setCenters(safeData);
    if (!safeData.some((center) => center._id === selectedCenterId)) setSelectedCenterId("");
  }

  async function loadPosition() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") throw new Error("Permission de localisation refusee");
    const current = await Location.getCurrentPositionAsync({});
    return { lat: current.coords.latitude, lon: current.coords.longitude };
  }

  async function fetchCenters(position = coords, { silent = false } = {}) {
    if (!position) return;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const parsedRadius = isEtablissementAccount ? null : parseRadiusKm(radiusKm);
      if (!isEtablissementAccount && parsedRadius === null) {
        throw new Error("Rayon invalide. Entrez une valeur entre 1 et 700 km.");
      }
      const localCatalog = await loadCenterCatalog(token);
      const shouldForceFullSync = isEtablissementAccount || parsedRadius >= 500;
      if (localCatalog.centers.length === 0) {
        const syncResult = await ensureCatalogDownloaded(token, { forcePrompt: !silent });
        const alreadyNotified = await getCenterCatalogMeta(META_KEY_INITIAL_LOAD_NOTIFIED);
        if (!alreadyNotified && syncResult.centers.length > 0) {
          showCatalogNotice("Les centres sont maintenant disponibles hors ligne.");
          await setCenterCatalogMeta(META_KEY_INITIAL_LOAD_NOTIFIED, new Date().toISOString());
        }
      } else {
        applyCatalogToState(localCatalog, position, radiusKm);
        syncCenterCatalog(token, { forceFull: shouldForceFullSync })
          .then((syncResult) => applyCatalogToState(syncResult, position, radiusKm))
          .catch(() => {});
      }
      const refreshedCatalog = await loadCenterCatalog(token);
      applyCatalogToState(refreshedCatalog, position, radiusKm);
    } catch (err) {
      const currentCatalog = await loadCenterCatalog(token).catch(() => ({ centers: [] }));
      const hasLocalCenters = Array.isArray(currentCatalog?.centers) && currentCatalog.centers.length > 0;
      if (!hasLocalCenters) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function runSearch() {
    setError("");
    setLoading(true);
    try {
      let position = coords;
      if (!position) {
        position = await loadPosition();
        setCoords(position);
      }
      setHasSearched(true);
      await fetchCenters(position);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    (async () => {
      const cached = await loadCachedRegions();
      if (mounted && cached.length > 0) setRegions(cached);
      try {
        const data = await apiFetch("/geo/regions", { token });
        const list = Array.isArray(data) ? data : [];
        if (mounted) setRegions(list);
        saveCachedRegions(list).catch(() => {});
      } catch {
        // hors ligne ou backend injoignable : on garde la liste en cache
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    (async () => {
      const cached = await loadCachedAllDistricts();
      if (mounted && cached.length > 0) setAllDistricts(cached);
      try {
        const data = await apiFetch("/geo/districts", { token });
        const list = Array.isArray(data) ? data : [];
        if (mounted) setAllDistricts(list);
        saveCachedAllDistricts(list).catch(() => {});
      } catch {
        // hors ligne ou backend injoignable : on garde la liste en cache
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  useEffect(() => {
    if (!coords) return undefined;
    if (!isEtablissementAccount) {
      const parsedRadius = parseRadiusKm(radiusKm);
      if (parsedRadius === null) return undefined;
    }
    const timer = setTimeout(() => { fetchCenters(coords).catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [coords, radiusKm, isEtablissementAccount]);

  const cityOptions = useMemo(() => {
    const values = Array.from(
      new Set(centers.map((center) => extractCenterCity(center, districtsByCode, regionsByCode)).filter(Boolean))
    );
    return values.sort((a, b) => a.localeCompare(b));
  }, [centers, districtsByCode, regionsByCode]);

  const serviceOptions = useMemo(() => {
    const values = Array.from(
      new Set(
        centers.flatMap((center) =>
          Array.isArray(center?.services)
            ? center.services.map((service) => String(service?.name || "").trim()).filter(Boolean)
            : []
        )
      )
    );
    return values.sort((a, b) => a.localeCompare(b));
  }, [centers]);

  const platformOptions = useMemo(() => {
    const values = Array.from(
      new Set(centers.map((center) => String(center?.technicalPlatform || "").trim()).filter(Boolean))
    );
    return values.sort((a, b) => a.localeCompare(b));
  }, [centers]);

  const filteredCenters = useMemo(() => {
    const q = normalizeSearchValue(searchQuery);
    return centers.filter((center) => {
      const centerCity = normalizeSearchValue(extractCenterCity(center, districtsByCode, regionsByCode));
      const servicesText = Array.isArray(center?.services)
        ? center.services.map((service) => String(service?.name || "").toLowerCase()).join(" ")
        : "";
      const cityMatches = !cityFilter || centerCity.includes(normalizeSearchValue(cityFilter));
      const serviceMatches =
        serviceFilter === "ALL" ||
        (Array.isArray(center?.services)
          ? center.services.some((service) => String(service?.name || "").trim() === serviceFilter)
          : false);
      const platformMatches =
        platformFilter === "ALL" || String(center?.technicalPlatform || "").trim() === platformFilter;
      const textMatches =
        !q ||
        String(center?.name || "").toLowerCase().includes(q) ||
        String(center?.address || "").toLowerCase().includes(q) ||
        String(center?.technicalPlatform || "").toLowerCase().includes(q) ||
        servicesText.includes(q) ||
        centerCity.includes(q);
      return cityMatches && serviceMatches && platformMatches && textMatches;
    });
  }, [centers, searchQuery, cityFilter, serviceFilter, platformFilter, districtsByCode, regionsByCode]);

  const selectedCenter = filteredCenters.find((center) => center._id === selectedCenterId) || null;

  const mapRegion = useMemo(() => {
    if (!coords) return { latitude: 6.5244, longitude: 3.3792, latitudeDelta: 0.25, longitudeDelta: 0.25 };
    return { latitude: coords.lat, longitude: coords.lon, latitudeDelta: 0.13, longitudeDelta: 0.13 };
  }, [coords]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !coords || selectedCenter || isMapFullscreen) return;
    try {
      if (filteredCenters.length === 0) {
        mapRef.current.animateToRegion({ latitude: coords.lat, longitude: coords.lon, latitudeDelta: 0.12, longitudeDelta: 0.12 }, 500);
        return;
      }
      const points = [
        { latitude: coords.lat, longitude: coords.lon },
        ...filteredCenters.map((center) => ({
          latitude: center.location.coordinates[1],
          longitude: center.location.coordinates[0],
        })),
      ];
      mapRef.current.fitToCoordinates(points, { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true });
    } catch {
      // la vue native de la carte n'est pas encore prete, on ignore silencieusement
    }
  }, [mapReady, coords, filteredCenters, selectedCenter, isMapFullscreen]);

  function selectCenter(center) {
    setSelectedCenterId(center._id);
    setIsMapFullscreen(true);
    const centerPoint = {
      latitude: center.location.coordinates[1],
      longitude: center.location.coordinates[0],
    };
    if (!mapReady || !mapRef.current) return;
    try {
      if (coords) {
        mapRef.current.fitToCoordinates(
          [{ latitude: coords.lat, longitude: coords.lon }, centerPoint],
          { edgePadding: { top: 90, right: 90, bottom: 90, left: 90 }, animated: true }
        );
        return;
      }
      mapRef.current.animateToRegion({ ...centerPoint, latitudeDelta: 0.06, longitudeDelta: 0.06 }, 700);
    } catch {
      // la vue native de la carte n'est pas encore prete, on ignore silencieusement
    }
  }

  async function startNavigation(center) {
    const lat = center.location.coordinates[1];
    const lon = center.location.coordinates[0];
    const googleWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    const googleNavUrl = `google.navigation:q=${lat},${lon}`;
    const appleMapsUrl = `http://maps.apple.com/?daddr=${lat},${lon}`;
    const targetUrl = Platform.OS === "ios" ? appleMapsUrl : googleNavUrl;
    try {
      const supported = await Linking.canOpenURL(targetUrl);
      await Linking.openURL(supported ? targetUrl : googleWebUrl);
    } catch {
      setError("Impossible d'ouvrir la navigation");
    }
  }

  return (
    <View style={styles.container}>
      {!isMapFullscreen ? (
        <>
          <View style={styles.headerCard}>
            <Text style={styles.headerTitle}>Reference malade</Text>
            <Text style={styles.headerText}>
              Module reserve aux comptes {actorLabel}. Trouvez un centre de sante pour une reference, un depot patient ou une orientation rapide.
            </Text>
          </View>

          <View style={styles.toolbar}>
            {!isEtablissementAccount ? (
              <View style={styles.radiusWrap}>
                <Text style={styles.radiusLabel}>Rayon (km)</Text>
                <TextInput style={styles.radiusInput} keyboardType="numeric" value={radiusKm} onChangeText={setRadiusKm} />
              </View>
            ) : null}
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Nom du centre, service, ville..."
              placeholderTextColor={C.textLight}
            />
            <Pressable style={styles.searchBtn} onPress={runSearch}>
              <Text style={styles.searchBtnText}>{loading ? "..." : "OK"}</Text>
            </Pressable>
          </View>

          <View style={styles.filtersPanel}>
            <TextInput
              style={styles.cityInput}
              value={cityFilter}
              onChangeText={setCityFilter}
              placeholder="Ville ou district"
              placeholderTextColor={C.textLight}
            />
            {cityOptions.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {cityOptions.slice(0, 12).map((city) => {
                  const active = cityFilter === city;
                  return (
                    <Pressable
                      key={`ref_city_${city}`}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setCityFilter(active ? "" : city)}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{city}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {[{ key: "ALL", label: "Tous les services" }, ...serviceOptions.map((item) => ({ key: item, label: item }))].map((item) => {
                const active = serviceFilter === item.key;
                return (
                  <Pressable
                    key={`ref_service_${item.key}`}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setServiceFilter(item.key)}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {[{ key: "ALL", label: "Tous les plateaux" }, ...platformOptions.map((item) => ({ key: item, label: item }))].map((item) => {
                const active = platformFilter === item.key;
                return (
                  <Pressable
                    key={`ref_platform_${item.key}`}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setPlatformFilter(item.key)}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </>
      ) : null}

      {error ? <Text style={styles.errorBar}>{error}</Text> : null}
      {catalogNotice ? (
        <View style={styles.noticeBar}>
          <Text style={styles.noticeBarText}>{catalogNotice.message}</Text>
        </View>
      ) : null}

      {!hasSearched ? (
        <View style={styles.searchPromptState}>
          <Text style={styles.searchPromptText}>
            Renseignez vos criteres (nom, service, ville, plateau technique{isEtablissementAccount ? "" : ", rayon"}) puis appuyez sur OK pour lancer la recherche.
          </Text>
        </View>
      ) : (
      <>
      <View style={isMapFullscreen ? styles.mapFullscreenWrap : undefined}>
        <MapView
          ref={mapRef}
          style={isMapFullscreen ? styles.mapFullscreen : styles.map}
          initialRegion={mapRegion}
          onMapReady={() => setMapReady(true)}
        >
          {coords ? <Marker coordinate={{ latitude: coords.lat, longitude: coords.lon }} title="Vous" pinColor={C.primary} /> : null}
          {filteredCenters.slice(0, MAX_MAP_CENTER_MARKERS).map((center) => (
            <Marker
              key={center._id}
              coordinate={{ latitude: center.location.coordinates[1], longitude: center.location.coordinates[0] }}
              title={`${center.name} (${center.distanceKm} km)`}
              description={center.technicalPlatform}
              pinColor={center._id === selectedCenterId ? C.red : undefined}
              onPress={() => selectCenter(center)}
            />
          ))}
          {coords && selectedCenter ? (
            <Polyline
              coordinates={[
                { latitude: coords.lat, longitude: coords.lon },
                { latitude: selectedCenter.location.coordinates[1], longitude: selectedCenter.location.coordinates[0] },
              ]}
              strokeWidth={4}
              strokeColor={C.red}
            />
          ) : null}
        </MapView>
        {isMapFullscreen ? (
          <Pressable style={styles.closeMapBtn} onPress={() => { setIsMapFullscreen(false); setSelectedCenterId(""); }}>
            <Text style={styles.closeMapBtnText}>✕ Fermer la carte</Text>
          </Pressable>
        ) : null}
      </View>

      {!isMapFullscreen ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          data={filteredCenters}
          keyExtractor={(center) => center._id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Aucun centre trouve pour cette reference.</Text>
              </View>
            ) : null
          }
          renderItem={({ item: center }) => (
            <Pressable
              style={[styles.centerCard, center._id === selectedCenterId && styles.centerCardSelected]}
              onPress={() => selectCenter(center)}
            >
              <View style={styles.centerCardHeader}>
                <View style={styles.centerCardTitleWrap}>
                  <Text style={styles.centerName}>{center.name}</Text>
                  <Text style={styles.centerAddress}>{center.address}</Text>
                </View>
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceBadgeText}>{center.distanceKm} km</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.centerMeta}>
                <Text style={styles.metaLabel}>Ville / district</Text>
                <Text style={styles.metaValue}>{extractCenterCity(center, districtsByCode, regionsByCode) || "-"}</Text>
              </View>
              <View style={styles.centerMeta}>
                <Text style={styles.metaLabel}>Plateau technique</Text>
                <Text style={styles.metaValue}>{center.technicalPlatform || "-"}</Text>
              </View>
              <View style={styles.centerMeta}>
                <Text style={styles.metaLabel}>Services disponibles</Text>
                <Text style={styles.metaValue}>
                  {Array.isArray(center.services) && center.services.length > 0
                    ? center.services.map((service) => service.name).join(", ")
                    : "Aucun service disponible"}
                </Text>
              </View>

              <View style={styles.actionRow}>
                <Pressable style={styles.secondaryBtn} onPress={() => selectCenter(center)}>
                  <Text style={styles.secondaryBtnText}>Voir sur carte</Text>
                </Pressable>
                <Pressable style={styles.primaryBtn} onPress={() => startNavigation(center)}>
                  <Text style={styles.primaryBtnText}>Orienter / deposer</Text>
                </Pressable>
              </View>
            </Pressable>
          )}
        />
      ) : null}
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerCard: {
    margin: 12,
    marginBottom: 0,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 4,
    ...S.sm,
  },
  headerTitle: { fontSize: 16, fontWeight: "800", color: C.textDark },
  headerText: { fontSize: 12, color: C.textMed, lineHeight: 18 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  radiusWrap: { alignItems: "center", gap: 2 },
  radiusLabel: { fontSize: 10, color: C.textMuted, fontWeight: "600" },
  radiusInput: {
    width: 56,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: C.textDark,
    textAlign: "center",
  },
  searchInput: {
    flex: 1,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: C.textDark,
  },
  searchBtn: {
    backgroundColor: C.red,
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  filtersPanel: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  cityInput: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: C.textDark,
  },
  chipsRow: { gap: 8 },
  filterChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.surface,
  },
  filterChipActive: { backgroundColor: C.red, borderColor: C.red },
  filterChipText: { color: C.textMed, fontSize: 12, fontWeight: "700" },
  filterChipTextActive: { color: "#fff" },
  errorBar: { color: C.red, fontSize: 13, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.redLight },
  noticeBar: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.greenLight, borderBottomWidth: 1, borderBottomColor: "#b7ebc6" },
  noticeBarText: { color: C.green, fontSize: 13, fontWeight: "700" },
  map: { height: 240, width: "100%" },
  mapFullscreenWrap: { flex: 1 },
  mapFullscreen: { flex: 1, width: "100%" },
  closeMapBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    backgroundColor: C.textDark,
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...S.sm,
  },
  closeMapBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 10, paddingBottom: 28 },
  emptyState: { alignItems: "center", paddingVertical: 32 },
  emptyStateText: { color: C.textMuted, fontSize: 14 },
  searchPromptState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  searchPromptText: { color: C.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  centerCard: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
    ...S.sm,
  },
  centerCardSelected: { borderColor: C.red, borderWidth: 2 },
  centerCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  centerCardTitleWrap: { flex: 1 },
  centerName: { fontSize: 15, fontWeight: "700", color: C.textDark },
  centerAddress: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  distanceBadge: { backgroundColor: C.redLight, borderRadius: R.full, paddingHorizontal: 10, paddingVertical: 4 },
  distanceBadgeText: { color: C.red, fontWeight: "700", fontSize: 12 },
  divider: { height: 1, backgroundColor: C.border },
  centerMeta: { gap: 2 },
  metaLabel: { fontSize: 11, color: C.textMuted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 13, color: C.textMed },
  actionRow: { flexDirection: "row", gap: 8 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: C.bg,
  },
  secondaryBtnText: { color: C.textMed, fontWeight: "700", fontSize: 13 },
  primaryBtn: {
    flex: 1,
    borderRadius: R.sm,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: C.red,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
