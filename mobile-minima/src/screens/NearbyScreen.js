import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { apiFetch, trackEvent } from "../api/client";
import {
  ensureCatalogDownloaded,
  getCenterCatalogMeta,
  loadCenterCatalog,
  META_KEY_INITIAL_LOAD_NOTIFIED,
  setCenterCatalogMeta,
  syncCenterCatalog,
} from "../storage/centerCatalog";
import {
  loadCachedAllDistricts,
  loadCachedDistricts,
  loadCachedRegions,
  saveCachedAllDistricts,
  saveCachedDistricts,
  saveCachedRegions,
} from "../storage/geoCatalog";
import { useAuth } from "../context/AuthContext";
import { C, R, S, shared } from "../theme";

const MAX_MAP_CENTER_MARKERS = 200;
const MAX_MAP_BASE_MARKERS = 120;
const CITY_ROW_HEIGHT = 64;
const CITY_ROW_GAP = 10;

function hasValidCoordinates(center) {
  const lat = Number(center?.location?.coordinates?.[1]);
  const lon = Number(center?.location?.coordinates?.[0]);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function hasValidBaseCoordinates(base) {
  const lat = Number(base?.location?.coordinates?.[1]);
  const lon = Number(base?.location?.coordinates?.[0]);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function getBaseServiceLabel(serviceType) {
  const value = String(serviceType || "").toUpperCase();
  if (value === "SAMU") return "SAMU";
  if (value === "SAPEUR_POMPIER") return "Sapeurs-Pompiers";
  if (value === "POLICE") return "Poste de police";
  if (value === "GENDARMERIE") return "Brigade de gendarmerie";
  if (value === "PROTECTION_CIVILE") return "Protection Civile";
  return serviceType || "Base";
}

function getBaseColor(serviceType) {
  const value = String(serviceType || "").toUpperCase();
  if (value === "SAMU") return C.amber;
  if (value === "SAPEUR_POMPIER") return C.red;
  if (value === "POLICE") return C.primary;
  if (value === "GENDARMERIE") return C.teal;
  if (value === "PROTECTION_CIVILE") return C.purple;
  return C.textMuted;
}

function parseRadiusKm(rawValue) {
  const normalized = String(rawValue ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  if (parsed > 300) return null;
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

export function NearbyScreen() {
  const { token, user } = useAuth();
  const mapRef = useRef(null);
  const [coords, setCoords] = useState(null);
  const [radiusKm, setRadiusKm] = useState("5");
  const [searchQuery, setSearchQuery] = useState("");
  const [centers, setCenters] = useState([]);
  const [allCenters, setAllCenters] = useState([]);
  const [browseMode, setBrowseMode] = useState("PROXIMITY");
  const [regions, setRegions] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [selectedRegionCode, setSelectedRegionCode] = useState("");
  const [selectedDistrictCode, setSelectedDistrictCode] = useState("");
  const [allDistricts, setAllDistricts] = useState([]);
  const [cityQuery, setCityQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedCenterId, setSelectedCenterId] = useState("");
  const [emergencyBases, setEmergencyBases] = useState([]);
  const [baseServiceFilter, setBaseServiceFilter] = useState("ALL");
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [visitedCenters, setVisitedCenters] = useState({});
  const [declaringCenterId, setDeclaringCenterId] = useState("");
  const [checkinModal, setCheckinModal] = useState({ centerId: null, code: "", loading: false, error: "" });
  const [catalogStatus, setCatalogStatus] = useState({
    ready: false,
    lastSyncAt: null,
    centerCount: 0,
  });
  const [catalogNotice, setCatalogNotice] = useState(null);
  const noticeTimeoutRef = useRef(null);

  function showCatalogNotice(message, { tone = "success", durationMs = 30000 } = {}) {
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
    const parsedRadius = parseRadiusKm(radiusValue);
    const sourceCenters = Array.isArray(catalog?.centers) ? catalog.centers : [];
    setAllCenters(sourceCenters);
    setCatalogStatus({
      ready: true,
      lastSyncAt: catalog?.lastSyncAt || null,
      centerCount: sourceCenters.length,
    });
    if (!position || parsedRadius === null) return;
    const safeData = sourceCenters
      .filter(hasValidCoordinates)
      .map((center) => {
        const lat = Number(center.location.coordinates[1]);
        const lon = Number(center.location.coordinates[0]);
        const distanceKm = haversineKm(position.lat, position.lon, lat, lon);
        return { ...center, distanceKm: Number(distanceKm.toFixed(2)) };
      })
      .filter((center) => center.distanceKm <= parsedRadius)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    setCenters(safeData);
    if (safeData.length === 0) setSelectedCenterId("");
  }

  async function loadPosition() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") throw new Error("Permission de localisation refusee");
    const current = await Location.getCurrentPositionAsync({});
    return { lat: current.coords.latitude, lon: current.coords.longitude };
  }

  async function fetchNearby(position = coords, { silent = false } = {}) {
    if (!position) return;
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const parsedRadius = parseRadiusKm(radiusKm);
      if (parsedRadius === null) throw new Error("Rayon invalide. Entrez une valeur entre 1 et 300 km.");
      const localCatalog = await loadCenterCatalog(token);
      const shouldForceFullSync = parsedRadius >= 500;
      if (localCatalog.centers.length === 0) {
        const syncResult = await ensureCatalogDownloaded(token, { forcePrompt: !silent });
        const alreadyNotified = await getCenterCatalogMeta(META_KEY_INITIAL_LOAD_NOTIFIED);
        if (!alreadyNotified && syncResult.centers.length > 0) {
          showCatalogNotice("Les donnees locales sont pretes pour une utilisation hors ligne.");
          await setCenterCatalogMeta(META_KEY_INITIAL_LOAD_NOTIFIED, new Date().toISOString());
        }
      } else {
        applyCatalogToState(localCatalog, position, radiusKm);
        syncCenterCatalog(token, { forceFull: shouldForceFullSync })
          .then((syncResult) => {
            applyCatalogToState(syncResult, position, radiusKm);
          })
          .catch(() => {});
      }
      const refreshedCatalog = await loadCenterCatalog(token);
      applyCatalogToState(refreshedCatalog, position, radiusKm);
      try {
        const bases = await apiFetch(
          `/emergency-reports/bases/nearby?latitude=${position.lat}&longitude=${position.lon}&radiusKm=${parsedRadius}`,
          { token }
        );
        setEmergencyBases(Array.isArray(bases) ? bases : []);
      } catch {
        setEmergencyBases([]);
      }
    } catch (err) {
      const currentCatalog = await loadCenterCatalog(token).catch(() => ({ centers: [] }));
      const hasLocalCenters = Array.isArray(currentCatalog?.centers) && currentCatalog.centers.length > 0;
      if (!hasLocalCenters) {
        setError(err.message);
        setCatalogStatus((prev) => ({ ...prev, ready: false }));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Le catalogue se charge independamment de la localisation : le mode
      // "Par region"/"Par ville" doit fonctionner meme si la permission est refusee.
      try {
        let catalog = await loadCenterCatalog(token);
        if (!mounted) return;
        if (!Array.isArray(catalog?.centers) || catalog.centers.length === 0) {
          catalog = await ensureCatalogDownloaded(token);
          if (!mounted) return;
        }
        setAllCenters(Array.isArray(catalog?.centers) ? catalog.centers : []);
        setCatalogStatus({
          ready: true,
          lastSyncAt: catalog?.lastSyncAt || null,
          centerCount: Array.isArray(catalog?.centers) ? catalog.centers.length : 0,
        });
      } catch (err) {
        if (mounted) {
          setError(err.message || "Impossible de charger la liste des centres.");
        }
      }

      try {
        const position = await loadPosition();
        if (!mounted) return;
        setCoords(position);
        const catalog = await loadCenterCatalog(token);
        if (!mounted) return;
        if (Array.isArray(catalog.centers) && catalog.centers.length > 0) {
          applyCatalogToState(catalog, position, radiusKm);
          fetchNearby(position, { silent: true }).catch(() => {});
          return;
        }
        await fetchNearby(position);
      } catch (err) {
        if (mounted && browseMode === "PROXIMITY") setError(err.message);
      }
    })();
    return () => { mounted = false; };
  }, [token]);

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
    if (!token || !selectedRegionCode) { setDistricts([]); return; }
    let mounted = true;
    (async () => {
      const cached = await loadCachedDistricts(selectedRegionCode);
      if (mounted && cached.length > 0) setDistricts(cached);
      try {
        const data = await apiFetch(`/geo/districts?regionCode=${encodeURIComponent(selectedRegionCode)}`, { token });
        const list = Array.isArray(data) ? data : [];
        if (mounted) setDistricts(list);
        saveCachedDistricts(selectedRegionCode, list).catch(() => {});
      } catch {
        // hors ligne : on garde la liste en cache si elle existe, sinon vide
        if (mounted && cached.length === 0) setDistricts([]);
      }
    })();
    return () => { mounted = false; };
  }, [token, selectedRegionCode]);

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
    return () => {
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!coords) return undefined;
    const interval = setInterval(() => { fetchNearby(coords, { silent: true }).catch(() => {}); }, 30000);
    return () => clearInterval(interval);
  }, [coords, radiusKm, token]);

  useEffect(() => {
    if (!coords) return undefined;
    const parsedRadius = parseRadiusKm(radiusKm);
    if (parsedRadius === null) return undefined;
    const timer = setTimeout(() => { fetchNearby(coords).catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [coords, radiusKm]);

  function selectCenter(center) {
    setSelectedCenterId(center._id);
    if (browseMode !== "PROXIMITY") return;
    setIsMapFullscreen(true);
    const centerPoint = {
      latitude: center.location.coordinates[1],
      longitude: center.location.coordinates[0]
    };
    if (coords && mapRef.current) {
      mapRef.current.fitToCoordinates(
        [{ latitude: coords.lat, longitude: coords.lon }, centerPoint],
        { edgePadding: { top: 90, right: 90, bottom: 90, left: 90 }, animated: true }
      );
      return;
    }
    if (mapRef.current) {
      mapRef.current.animateToRegion({ ...centerPoint, latitudeDelta: 0.06, longitudeDelta: 0.06 }, 700);
    }
  }

  const canSeeBedAvailability = useMemo(() => {
    const normalize = (value) => String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    const roles = new Set([
      normalize(user?.role),
      ...(Array.isArray(user?.roles) ? user.roles.map((entry) => normalize(entry?.role || entry)) : [])
    ]);
    return roles.has("ETABLISSEMENT") || roles.has("CHEF_ETABLISSEMENT")
      || roles.has("SAPEUR_POMPIER") || roles.has("SAPPEUR_POMPIER");
  }, [user]);

  const normalizedCenters = useMemo(
    () => centers.filter(hasValidCoordinates).map((center) => ({
      ...center,
      services: Array.isArray(center.services) ? center.services : []
    })),
    [centers]
  );

  const selectedCenter = normalizedCenters.find((center) => center._id === selectedCenterId) || null;

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

  const mapRegion = useMemo(() => {
    if (!coords) return { latitude: 6.5244, longitude: 3.3792, latitudeDelta: 0.25, longitudeDelta: 0.25 };
    return { latitude: coords.lat, longitude: coords.lon, latitudeDelta: 0.13, longitudeDelta: 0.13 };
  }, [coords]);

  const filteredCenters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return normalizedCenters;
    return normalizedCenters.filter((center) => {
      const hasNameMatch = String(center.name || "").toLowerCase().includes(q);
      const hasServiceMatch = Array.isArray(center.services)
        ? center.services.some((service) => String(service.name || "").toLowerCase().includes(q))
        : false;
      return hasNameMatch || hasServiceMatch;
    });
  }, [normalizedCenters, searchQuery]);

  const regionFilteredCenters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = allCenters.map((center) => ({
      ...center,
      services: Array.isArray(center.services) ? center.services : []
    }));
    if (selectedRegionCode) {
      list = list.filter((center) => String(center.regionCode || "").toUpperCase() === selectedRegionCode);
    }
    if (selectedDistrictCode) {
      list = list.filter((center) => String(center.districtCode || "").toUpperCase() === selectedDistrictCode);
    }
    if (q) {
      list = list.filter((center) => {
        const hasNameMatch = String(center.name || "").toLowerCase().includes(q);
        const hasAddrMatch = String(center.address || "").toLowerCase().includes(q);
        const hasPlatformMatch = String(center.technicalPlatform || "").toLowerCase().includes(q);
        const hasServiceMatch = Array.isArray(center.services)
          ? center.services.some((service) => String(service.name || "").toLowerCase().includes(q))
          : false;
        return hasNameMatch || hasAddrMatch || hasPlatformMatch || hasServiceMatch;
      });
    }
    return list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [allCenters, selectedRegionCode, selectedDistrictCode, searchQuery]);

  const cityOptions = useMemo(() => {
    const counts = new Map();
    for (const center of allCenters) {
      const code = String(center.districtCode || "").toUpperCase();
      if (!code) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    const list = allDistricts.map((district) => ({
      code: district.code,
      name: district.name,
      count: counts.get(String(district.code || "").toUpperCase()) || 0
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    const q = cityQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => item.name.toLowerCase().includes(q));
  }, [allCenters, allDistricts, cityQuery]);

  const selectedCityInfo = useMemo(
    () => allDistricts.find((district) => district.code === selectedCity) || null,
    [allDistricts, selectedCity]
  );

  const selectedCityCenters = useMemo(() => {
    if (!selectedCity) return [];
    const q = searchQuery.trim().toLowerCase();
    let list = allCenters
      .filter((center) => String(center.districtCode || "").toUpperCase() === selectedCity)
      .map((center) => ({
        ...center,
        services: Array.isArray(center.services) ? center.services : []
      }));
    if (q) {
      list = list.filter((center) => {
        const hasNameMatch = String(center.name || "").toLowerCase().includes(q);
        const hasPlatformMatch = String(center.technicalPlatform || "").toLowerCase().includes(q);
        const hasServiceMatch = Array.isArray(center.services)
          ? center.services.some((service) => String(service.name || "").toLowerCase().includes(q))
          : false;
        return hasNameMatch || hasPlatformMatch || hasServiceMatch;
      });
    }
    return list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [allCenters, selectedCity, searchQuery]);

  const activeCenters =
    browseMode === "PROXIMITY" ? filteredCenters
    : browseMode === "CITY" ? selectedCityCenters
    : regionFilteredCenters;

  const safeEmergencyBases = useMemo(() => emergencyBases.filter(hasValidBaseCoordinates), [emergencyBases]);
  const filteredEmergencyBases = useMemo(() => {
    if (baseServiceFilter === "ALL") return safeEmergencyBases;
    return safeEmergencyBases.filter(
      (base) => String(base?.serviceType || "").toUpperCase() === baseServiceFilter
    );
  }, [safeEmergencyBases, baseServiceFilter]);

  useEffect(() => {
    if (!token) return;
    apiFetch("/centers/my-visits", { token })
      .then((data) => {
        const map = {};
        (data.visits || []).forEach((v) => { map[String(v.centerId)] = v.type; });
        setVisitedCenters(map);
      })
      .catch(() => {});
  }, [token]);

  async function declareVisit(centerId) {
    setDeclaringCenterId(String(centerId));
    try {
      await apiFetch(`/centers/${centerId}/declare-visit`, { token, method: "POST" });
      setVisitedCenters((prev) => ({ ...prev, [String(centerId)]: "SELF_DECLARED" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeclaringCenterId("");
    }
  }

  async function submitCheckin() {
    if (!checkinModal.code.trim()) {
      setCheckinModal((prev) => ({ ...prev, error: "Entrez le code du centre" }));
      return;
    }
    setCheckinModal((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      await apiFetch(`/centers/${checkinModal.centerId}/checkin`, {
        token,
        method: "POST",
        body: { code: checkinModal.code.trim() },
      });
      setVisitedCenters((prev) => ({ ...prev, [String(checkinModal.centerId)]: "CODE" }));
      setCheckinModal({ centerId: null, code: "", loading: false, error: "" });
    } catch (err) {
      setCheckinModal((prev) => ({ ...prev, loading: false, error: err.message || "Code incorrect" }));
    }
  }

  useEffect(() => {
    if (!mapRef.current || !coords || selectedCenter || isMapFullscreen) return;
    if (filteredCenters.length === 0) {
      mapRef.current.animateToRegion({ latitude: coords.lat, longitude: coords.lon, latitudeDelta: 0.12, longitudeDelta: 0.12 }, 500);
      return;
    }
    const points = [
      { latitude: coords.lat, longitude: coords.lon },
      ...filteredCenters.map((center) => ({
        latitude: center.location.coordinates[1],
        longitude: center.location.coordinates[0]
      }))
    ];
    mapRef.current.fitToCoordinates(points, { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true });
  }, [coords, filteredCenters, selectedCenter, isMapFullscreen]);

  return (
    <View style={styles.container}>
      {!isMapFullscreen ? (
        <View style={styles.modeToggleRow}>
          <Pressable
            style={[styles.modeToggleBtn, browseMode === "PROXIMITY" && styles.modeToggleBtnActive]}
            onPress={() => { setCityQuery(""); setSelectedCity(""); setBrowseMode("PROXIMITY"); }}
          >
            <Text style={[styles.modeToggleText, browseMode === "PROXIMITY" && styles.modeToggleTextActive]}>
              A proximite
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeToggleBtn, browseMode === "REGION" && styles.modeToggleBtnActive]}
            onPress={() => { setCityQuery(""); setSelectedCity(""); setBrowseMode("REGION"); }}
          >
            <Text style={[styles.modeToggleText, browseMode === "REGION" && styles.modeToggleTextActive]}>
              Par region / district
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modeToggleBtn, browseMode === "CITY" && styles.modeToggleBtnActive]}
            onPress={() => {
              setSelectedRegionCode("");
              setSelectedDistrictCode("");
              setBrowseMode("CITY");
            }}
          >
            <Text style={[styles.modeToggleText, browseMode === "CITY" && styles.modeToggleTextActive]}>
              Par ville
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!isMapFullscreen && browseMode === "CITY" && !selectedCity ? (
        <View style={styles.cityInputWrap}>
          <TextInput
            style={styles.cityInput}
            value={cityQuery}
            onChangeText={setCityQuery}
            placeholder="Rechercher commune ou ville..."
            placeholderTextColor={C.textLight}
          />
        </View>
      ) : null}

      {!isMapFullscreen && browseMode === "CITY" && selectedCity ? (
        <View style={styles.cityHeaderRow}>
          <Pressable style={styles.cityBackBtn} onPress={() => setSelectedCity("")}>
            <Text style={styles.cityBackBtnText}>‹ Villes</Text>
          </Pressable>
          <Text style={styles.cityHeaderTitle} numberOfLines={1}>{selectedCityInfo?.name || selectedCity}</Text>
        </View>
      ) : null}

      {!isMapFullscreen && (browseMode !== "CITY" || selectedCity) ? (
        <View style={styles.toolbar}>
          {browseMode === "PROXIMITY" ? (
            <View style={styles.radiusWrap}>
              <Text style={styles.radiusLabel}>Rayon (km)</Text>
              <TextInput
                style={styles.radiusInput}
                keyboardType="numeric"
                value={radiusKm}
                onChangeText={setRadiusKm}
              />
            </View>
          ) : null}
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={
              browseMode === "CITY"
                ? "Nom, plateau technique ou service..."
                : "Rechercher par nom ou service..."
            }
            placeholderTextColor={C.textLight}
          />
          {browseMode === "PROXIMITY" ? (
            <Pressable style={styles.searchBtn} onPress={() => fetchNearby()}>
              <Text style={styles.searchBtnText}>{loading ? "..." : "OK"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!isMapFullscreen && browseMode === "REGION" ? (
        <View style={styles.geoFilterWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.geoChipRow}>
            <Pressable
              style={[styles.geoChip, !selectedRegionCode && styles.geoChipActive]}
              onPress={() => { setSelectedRegionCode(""); setSelectedDistrictCode(""); }}
            >
              <Text style={[styles.geoChipText, !selectedRegionCode && styles.geoChipTextActive]}>Toutes les regions</Text>
            </Pressable>
            {regions.map((region) => {
              const active = selectedRegionCode === region.code;
              return (
                <Pressable
                  key={region.code}
                  style={[styles.geoChip, active && styles.geoChipActive]}
                  onPress={() => { setSelectedRegionCode(active ? "" : region.code); setSelectedDistrictCode(""); }}
                >
                  <Text style={[styles.geoChipText, active && styles.geoChipTextActive]}>{region.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {selectedRegionCode && districts.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.geoChipRow}>
              <Pressable
                style={[styles.geoChip, !selectedDistrictCode && styles.geoChipActive]}
                onPress={() => setSelectedDistrictCode("")}
              >
                <Text style={[styles.geoChipText, !selectedDistrictCode && styles.geoChipTextActive]}>Tous les districts</Text>
              </Pressable>
              {districts.map((district) => {
                const active = selectedDistrictCode === district.code;
                return (
                  <Pressable
                    key={district.code}
                    style={[styles.geoChip, active && styles.geoChipActive]}
                    onPress={() => setSelectedDistrictCode(active ? "" : district.code)}
                  >
                    <Text style={[styles.geoChipText, active && styles.geoChipTextActive]}>{district.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.errorBar}>{error}</Text> : null}
      {catalogNotice ? (
        <View
          style={[
            styles.noticeBar,
            catalogNotice.tone === "success" ? styles.noticeBarSuccess : styles.noticeBarInfo,
          ]}
        >
          <Text
            style={[
              styles.noticeBarText,
              catalogNotice.tone === "success" ? styles.noticeBarTextSuccess : styles.noticeBarTextInfo,
            ]}
          >
            {catalogNotice.message}
          </Text>
        </View>
      ) : null}
      {browseMode === "PROXIMITY" ? (
        <View style={isMapFullscreen ? styles.mapFullscreenWrap : undefined}>
          <MapView
            ref={mapRef}
            style={isMapFullscreen ? styles.mapFullscreen : styles.map}
            initialRegion={mapRegion}
          >
            {coords ? (
              <Marker coordinate={{ latitude: coords.lat, longitude: coords.lon }} title="Vous" pinColor={C.primary} />
            ) : null}
            {filteredCenters.slice(0, MAX_MAP_CENTER_MARKERS).map((center) => (
              <Marker
                key={center._id}
                coordinate={{ latitude: center.location.coordinates[1], longitude: center.location.coordinates[0] }}
                title={`${center.name} (${center.distanceKm} km)`}
                description={center.technicalPlatform}
                pinColor={center._id === selectedCenterId ? C.primary : undefined}
                onPress={() => selectCenter(center)}
              />
            ))}
            {filteredEmergencyBases.slice(0, MAX_MAP_BASE_MARKERS).map((base) => (
              <Marker
                key={`base_${base.id}`}
                coordinate={{ latitude: Number(base.location.coordinates[1]), longitude: Number(base.location.coordinates[0]) }}
                title={`${base.name} (${getBaseServiceLabel(base.serviceType)})`}
                description={base.address}
                pinColor={getBaseColor(base.serviceType)}
              />
            ))}
            {coords && selectedCenter ? (
              <Polyline
                coordinates={[
                  { latitude: coords.lat, longitude: coords.lon },
                  { latitude: selectedCenter.location.coordinates[1], longitude: selectedCenter.location.coordinates[0] }
                ]}
                strokeWidth={4}
                strokeColor={C.primary}
              />
            ) : null}
          </MapView>
          {isMapFullscreen ? (
            <Pressable style={styles.closeMapBtn} onPress={() => { setIsMapFullscreen(false); setSelectedCenterId(""); }}>
              <Text style={styles.closeMapBtnText}>✕ Fermer la carte</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!isMapFullscreen && browseMode === "CITY" && !selectedCity ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          data={cityOptions}
          keyExtractor={(item) => item.code}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={10}
          removeClippedSubviews
          getItemLayout={(_, index) => ({
            length: CITY_ROW_HEIGHT,
            offset: (CITY_ROW_HEIGHT + CITY_ROW_GAP) * index,
            index,
          })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>Aucune ville trouvee.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.cityRow} onPress={() => setSelectedCity(item.code)}>
              <View style={styles.cityRowIcon}>
                <Text style={styles.cityRowIconText}>🏥</Text>
              </View>
              <View style={styles.cityRowTextWrap}>
                <Text style={styles.cityRowName}>{item.name}</Text>
                <Text style={styles.cityRowCount}>{item.count} centre{item.count > 1 ? "s" : ""}</Text>
              </View>
              <Text style={styles.cityRowArrow}>›</Text>
            </Pressable>
          )}
        />
      ) : null}

      {!isMapFullscreen && !(browseMode === "CITY" && !selectedCity) ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          data={activeCenters}
          keyExtractor={(center) => center._id}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={!loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                {browseMode === "PROXIMITY"
                  ? "Aucun centre trouve dans ce rayon."
                  : "Aucun centre trouve pour cette recherche."}
              </Text>
            </View>
          ) : null}
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
                {center.distanceKm != null ? (
                  <View style={styles.distanceBadge}>
                    <Text style={styles.distanceBadgeText}>{center.distanceKm} km</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.divider} />

              <View style={styles.centerMeta}>
                <Text style={styles.metaLabel}>Plateau technique</Text>
                <Text style={styles.metaValue}>{center.technicalPlatform || "-"}</Text>
              </View>
              
              {/* Section Services améliorée */}
              {center.services && center.services.length > 0 ? (
                <View style={styles.servicesSection}>
                  <Text style={styles.metaLabel}>Services disponibles</Text>
                  <View style={styles.servicesList}>
                    {center.services.map((service, index) => (
                      <View key={`${center._id}_service_${index}`} style={styles.serviceTag}>
                        <Text style={styles.serviceTagText}>
                          {service.name}
                        </Text>
                        {service.description ? (
                          <Text style={styles.serviceDescription}>
                            {service.description}
                          </Text>
                        ) : null}
                        {canSeeBedAvailability ? (
                          <Text style={styles.serviceBedsText}>
                            {service.bedsAvailable || 0} place{(service.bedsAvailable || 0) > 1 ? "s" : ""} disponible{(service.bedsAvailable || 0) > 1 ? "s" : ""}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.centerMeta}>
                  <Text style={styles.metaLabel}>Services</Text>
                  <Text style={styles.metaValue}>Aucun service disponible</Text>
                </View>
              )}

              {visitedCenters[String(center._id)] ? (
                <View style={styles.visitedBadgeRow}>
                  <View style={[
                    styles.visitedBadge,
                    visitedCenters[String(center._id)] === "CODE" || visitedCenters[String(center._id)] === "PROFESSIONAL"
                      ? styles.visitedBadgeVerified
                      : null
                  ]}>
                    <Text style={[
                      styles.visitedBadgeText,
                      visitedCenters[String(center._id)] === "CODE" || visitedCenters[String(center._id)] === "PROFESSIONAL"
                        ? styles.visitedBadgeTextVerified
                        : null
                    ]}>
                      {visitedCenters[String(center._id)] === "CODE" || visitedCenters[String(center._id)] === "PROFESSIONAL"
                        ? "Visite verifiee"
                        : "Visite declaree"}
                    </Text>
                  </View>
                  {visitedCenters[String(center._id)] === "SELF_DECLARED" ? (
                    <Pressable
                      onPress={() => setCheckinModal({ centerId: center._id, code: "", loading: false, error: "" })}
                    >
                      <Text style={styles.verifyLink}>Entrer le code du centre</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={styles.visitGate}>
                  <Text style={styles.visitGateText}>Declarez votre visite a ce centre</Text>
                  <Pressable
                    style={[styles.visitBtn, declaringCenterId === String(center._id) && { opacity: 0.6 }]}
                    onPress={() => declareVisit(center._id)}
                    disabled={declaringCenterId === String(center._id)}
                  >
                    <Text style={styles.visitBtnText}>
                      {declaringCenterId === String(center._id) ? "..." : "J'ai visite ce centre"}
                    </Text>
                  </Pressable>
                </View>
              )}

              <Pressable style={styles.navBtn} onPress={() => startNavigation(center)}>
                <Text style={styles.navBtnText}>Itineraire</Text>
              </Pressable>
            </Pressable>
          )}
          ListFooterComponent={
            browseMode === "PROXIMITY" && safeEmergencyBases.length > 0 ? (
              <View style={styles.baseSection}>
                <Text style={styles.baseSectionTitle}>Services d'urgence et de securite a proximite</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.baseFilterRow}>
                  {[
                    { key: "ALL", label: "Tous" },
                    { key: "SAMU", label: "SAMU" },
                    { key: "SAPEUR_POMPIER", label: "Pompiers" },
                    { key: "POLICE", label: "Police" },
                    { key: "GENDARMERIE", label: "Gendarmerie" },
                    { key: "PROTECTION_CIVILE", label: "Protection Civile" },
                  ].map((item) => {
                    const active = baseServiceFilter === item.key;
                    return (
                      <Pressable
                        key={`base_filter_${item.key}`}
                        style={[
                          styles.baseFilterChip,
                          active && { backgroundColor: C.primary, borderColor: C.primary },
                        ]}
                        onPress={() => setBaseServiceFilter(item.key)}
                      >
                        <Text
                          style={[
                            styles.baseFilterChipText,
                            active && { color: "#fff" },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {filteredEmergencyBases.map((base) => (
                  <View
                    key={`base_${base.id}`}
                    style={[styles.baseCard, { borderLeftColor: getBaseColor(base.serviceType) }]}
                  >
                    <Text style={styles.baseName}>{base.name}</Text>
                    <Text style={styles.baseMeta}>{getBaseServiceLabel(base.serviceType)} · {base.address}</Text>
                    {base.distanceKm != null ? <Text style={styles.baseMeta}>{base.distanceKm} km</Text> : null}
                  </View>
                ))}
                {filteredEmergencyBases.length === 0 ? (
                  <Text style={styles.baseMeta}>Aucun service pour ce filtre.</Text>
                ) : null}
              </View>
            ) : null
          }
        />
      ) : null}
      <Modal
        visible={checkinModal.centerId != null}
        transparent
        animationType="fade"
        onRequestClose={() => setCheckinModal({ centerId: null, code: "", loading: false, error: "" })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Enregistrer ma visite</Text>
            <Text style={styles.modalDesc}>
              Entrez le code affiche au centre de sante pour confirmer votre visite.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={checkinModal.code}
              onChangeText={(v) => setCheckinModal((prev) => ({ ...prev, code: v.toUpperCase(), error: "" }))}
              placeholder="Code du centre (ex: A3F7K2)"
              placeholderTextColor={C.textLight}
              autoCapitalize="characters"
              maxLength={8}
            />
            {checkinModal.error ? <Text style={styles.modalError}>{checkinModal.error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setCheckinModal({ centerId: null, code: "", loading: false, error: "" })}
              >
                <Text style={styles.modalCancelText}>Annuler</Text>
              </Pressable>
              <Pressable style={styles.modalConfirmBtn} onPress={submitCheckin}>
                <Text style={styles.modalConfirmText}>{checkinModal.loading ? "..." : "Confirmer"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  modeToggleRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: C.surface,
  },
  modeToggleBtn: {
    flex: 1,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: C.bg,
  },
  modeToggleBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  modeToggleText:      { color: C.textMed, fontWeight: "700", fontSize: 12.5 },
  modeToggleTextActive:{ color: "#fff" },

  geoFilterWrap: {
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  cityInputWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: C.surface,
  },
  cityInput: {
    width: "100%",
    backgroundColor: C.bg,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: C.textDark,
  },
  cityHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: C.surface,
  },
  cityBackBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.bg,
  },
  cityBackBtnText: { color: C.primary, fontWeight: "700", fontSize: 13 },
  cityHeaderTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: C.textDark },

  cityRow: {
    height: CITY_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    ...S.sm,
  },
  cityRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  cityRowIconText: { fontSize: 16 },
  cityRowTextWrap: { flex: 1 },
  cityRowName: { fontSize: 14.5, fontWeight: "700", color: C.textDark },
  cityRowCount: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  cityRowArrow: { fontSize: 20, color: C.textLight, fontWeight: "700" },
  geoChipRow: { gap: 8 },
  geoChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.bg,
  },
  geoChipActive:     { backgroundColor: C.primary, borderColor: C.primary },
  geoChipText:       { color: C.textMed, fontWeight: "600", fontSize: 12 },
  geoChipTextActive: { color: "#fff" },

  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  radiusWrap: { alignItems: "center", gap: 2 },
  radiusLabel: { fontSize: 10, color: C.textMuted, fontWeight: "600" },
  radiusInput: {
    width: 56,
    backgroundColor: C.bg,
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
    backgroundColor: C.bg,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: C.textDark,
  },
  searchBtn: {
    backgroundColor: C.primary,
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  errorBar: { color: C.red, fontSize: 13, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.redLight },
  noticeBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  noticeBarSuccess: {
    backgroundColor: C.greenLight,
    borderBottomColor: "#b7ebc6",
  },
  noticeBarInfo: {
    backgroundColor: C.primaryLight,
    borderBottomColor: "#bed4ff",
  },
  noticeBarText: {
    fontSize: 13,
    fontWeight: "700",
  },
  noticeBarTextSuccess: { color: C.green },
  noticeBarTextInfo: { color: C.primary },
  map: { height: 260, width: "100%" },
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

  list:        { flex: 1 },
  listContent: { padding: 12, gap: 10, paddingBottom: 28 },

  emptyState: { alignItems: "center", paddingVertical: 32 },
  emptyStateText: { color: C.textMuted, fontSize: 14 },

  centerCard: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
    ...S.sm,
  },
  centerCardSelected: { borderColor: C.primary, borderWidth: 2 },
  centerCardHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  centerCardTitleWrap:{ flex: 1 },
  centerName:         { fontSize: 15, fontWeight: "700", color: C.textDark },
  centerAddress:      { fontSize: 12, color: C.textMuted, marginTop: 2 },
  distanceBadge: {
    backgroundColor: C.primaryLight,
    borderRadius: R.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  distanceBadgeText: { color: C.primary, fontWeight: "700", fontSize: 12 },

  divider: { height: 1, backgroundColor: C.border },

  centerMeta:  { gap: 2 },
  metaLabel:   { fontSize: 11, color: C.textMuted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue:   { fontSize: 13, color: C.textMed },

  // Nouveaux styles pour les services
  servicesSection: {
    gap: 6,
    marginTop: 4,
  },
  servicesList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  serviceTag: {
    backgroundColor: C.primaryLight,
    borderRadius: R.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.primary,
  },
  serviceTagText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.primary,
  },
  serviceDescription: {
    fontSize: 10,
    color: C.textMuted,
    marginTop: 2,
  },
  serviceBedsText: {
    fontSize: 10,
    color: C.green,
    fontWeight: "700",
    marginTop: 2,
  },

  navBtn: {
    backgroundColor: C.teal,
    borderRadius: R.sm,
    paddingVertical: 9,
    alignItems: "center",
  },
  navBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  baseSection:      { gap: 8, marginTop: 4 },
  baseSectionTitle: { fontSize: 14, fontWeight: "800", color: C.textDark },
  baseFilterRow: { gap: 8 },
  baseFilterChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.surface,
  },
  baseFilterChipText: { color: C.textMed, fontSize: 12, fontWeight: "700" },
  baseCard: {
    backgroundColor: C.surface,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    padding: 12,
    gap: 3,
  },
  baseName: { fontWeight: "700", color: C.textDark, fontSize: 13 },
  baseMeta: { color: C.textMuted, fontSize: 12 },

  visitedBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  visitedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.greenLight,
    borderRadius: R.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  visitedBadgeVerified: {
    backgroundColor: C.primaryLight,
  },
  visitedBadgeText: { color: C.green, fontWeight: "700", fontSize: 12 },
  visitedBadgeTextVerified: { color: C.primary },
  verifyLink: { color: C.primary, fontSize: 12, fontWeight: "600", textDecorationLine: "underline" },

  visitGate: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.bg,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  visitGateText: { flex: 1, color: C.textMuted, fontSize: 12 },
  visitBtn: {
    backgroundColor: C.primary,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  visitBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalBox: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    padding: 20,
    width: "100%",
    gap: 14,
    ...S.md,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: C.textDark },
  modalDesc: { fontSize: 13, color: C.textMed, lineHeight: 18 },
  modalInput: {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: C.textDark,
    letterSpacing: 3,
    textAlign: "center",
    fontWeight: "700",
  },
  modalError: { color: C.red, fontSize: 13, fontWeight: "600" },
  modalActions: { flexDirection: "row", gap: 10 },
  modalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: C.bg,
  },
  modalCancelText: { color: C.textMed, fontWeight: "700", fontSize: 14 },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: R.sm,
    paddingVertical: 10,
    alignItems: "center",
  },
  modalConfirmText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
