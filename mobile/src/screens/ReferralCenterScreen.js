import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch } from "../api/client";
import { DropdownField } from "../components/DropdownField";
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
import {
  activeServices,
  buildOfferingOptions,
  centerHasPlatformItem,
  findMatchingService,
  toOfferingKey,
} from "../utils/centerOfferings";

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
  const [coords, setCoords] = useState(null);
  const [radiusKm, setRadiusKm] = useState("15");
  const [searchQuery, setSearchQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [serviceFilter, setServiceFilter] = useState("ALL");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sortMode, setSortMode] = useState("DISTANCE");
  const [catalogCenters, setCatalogCenters] = useState([]);
  const [selectedCenterId, setSelectedCenterId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [ownCenterIds, setOwnCenterIds] = useState([]);
  const [regions, setRegions] = useState([]);
  const [allDistricts, setAllDistricts] = useState([]);
  const noticeTimeoutRef = useRef(null);
  const [referralTarget, setReferralTarget] = useState(null);
  const [referralPhone, setReferralPhone] = useState("");
  const [referralPatientName, setReferralPatientName] = useState("");
  const [referralReason, setReferralReason] = useState("");
  const [referralServiceName, setReferralServiceName] = useState("");
  const [referralServiceDropdownOpen, setReferralServiceDropdownOpen] = useState(false);
  const [referralError, setReferralError] = useState("");
  const [referralSubmitting, setReferralSubmitting] = useState(false);

  function formatServiceOption(service) {
    const beds = Number(service?.bedsAvailable) || 0;
    return `${service?.name || ""} - ${beds > 0 ? `${beds} place(s)` : "Complet"}`;
  }

  const allRoles = useMemo(() => {
    const roles = Array.isArray(user?.roles) ? user.roles.map((entry) => String(entry?.role || entry).toUpperCase()) : [];
    return new Set([String(user?.role || "").toUpperCase(), ...roles]);
  }, [user]);

  const isEtablissementAccount = allRoles.has("CHEF_ETABLISSEMENT") || allRoles.has("ETABLISSEMENT");

  // Le centre de l'utilisateur est exclu : on ne s'oriente pas un patient a soi-meme.
  useEffect(() => {
    if (!token || !isEtablissementAccount) { setOwnCenterIds([]); return undefined; }
    let active = true;
    const cacheKey = user?.id ? `sante_aproxmite_chef_center_${user.id}` : null;
    if (cacheKey) {
      AsyncStorage.getItem(cacheKey)
        .then((cached) => { if (active && cached) setOwnCenterIds((prev) => (prev.length ? prev : [String(cached)])); })
        .catch(() => {});
    }
    apiFetch("/centers?includeInactive=1", { token })
      .then((data) => {
        if (!active || !Array.isArray(data)) return;
        // Un compte etablissement ne recoit que ses centres ; un compte a portee plus large (developpeur,
        // national...) recoit tout le catalogue : on ne garde alors que les centres qu'il a crees.
        const mine = data.length <= 10 ? data : data.filter((center) => String(center.createdBy) === String(user?.id));
        setOwnCenterIds(mine.map((center) => String(center._id)));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [token, isEtablissementAccount, user?.id]);

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

  function applyCatalogToState(catalog) {
    setCatalogCenters(Array.isArray(catalog?.centers) ? catalog.centers : []);
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
      await fetchCenters(position);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  // Tout le catalogue est affiche des l'ouverture (toutes les regions, tous les services).
  // La position n'est demandee que pour calculer les distances.
  useEffect(() => {
    if (!token) return undefined;
    let mounted = true;
    (async () => {
      try {
        let catalog = await loadCenterCatalog(token);
        if (!Array.isArray(catalog?.centers) || catalog.centers.length === 0) {
          catalog = await ensureCatalogDownloaded(token);
        }
        if (mounted) applyCatalogToState(catalog);
        syncCenterCatalog(token).then((fresh) => { if (mounted) applyCatalogToState(fresh); }).catch(() => {});
      } catch (err) {
        if (mounted) setError(err.message || "Impossible de charger la liste des centres.");
      } finally {
        if (mounted) setCatalogLoading(false);
      }
      try {
        const position = await loadPosition();
        if (mounted) setCoords(position);
      } catch {
        // sans localisation : liste sans distances
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

  // Centres avec distance (si position connue). Le rayon ne s'applique qu'aux comptes non-etablissement.
  const centers = useMemo(() => {
    const parsedRadius = isEtablissementAccount ? null : parseRadiusKm(radiusKm);
    const excluded = new Set(ownCenterIds);
    const list = catalogCenters.filter((center) => !excluded.has(String(center._id))).map((center) => {
      let distanceKm = null;
      if (coords && hasValidCoordinates(center)) {
        distanceKm = Number(haversineKm(
          coords.lat, coords.lon,
          Number(center.location.coordinates[1]), Number(center.location.coordinates[0])
        ).toFixed(2));
      }
      return { ...center, distanceKm, services: activeServices(center) };
    });
    if (!coords || parsedRadius === null) return list;
    return list.filter((center) => center.distanceKm == null || center.distanceKm <= parsedRadius);
  }, [catalogCenters, coords, radiusKm, isEtablissementAccount, ownCenterIds]);

  const regionOptions = useMemo(() => {
    const counts = new Map();
    centers.forEach((center) => {
      const code = String(center.regionCode || "").toUpperCase();
      if (code) counts.set(code, (counts.get(code) || 0) + 1);
    });
    const list = regions.length
      ? regions.map((region) => ({ code: String(region.code).toUpperCase(), name: region.name || region.code }))
      : [...counts.keys()].map((code) => ({ code, name: regionsByCode[code] || code }));
    return list
      .map((region) => ({ ...region, count: counts.get(region.code) || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [centers, regions, regionsByCode]);

  const regionScopedCenters = useMemo(
    () => (regionFilter === "ALL" ? centers : centers.filter((center) => String(center.regionCode || "").toUpperCase() === regionFilter)),
    [centers, regionFilter]
  );

  const serviceOptions = useMemo(() => buildOfferingOptions(regionScopedCenters, "SERVICE"), [regionScopedCenters]);
  const platformOptions = useMemo(() => buildOfferingOptions(regionScopedCenters, "PLATFORM"), [regionScopedCenters]);

  // Centres qui proposent le service / l'equipement choisi (avant filtre ville).
  const offeringCenters = useMemo(() => {
    return regionScopedCenters
      .map((center) => ({
        ...center,
        matchedService: serviceFilter === "ALL" ? null : findMatchingService(center, serviceFilter),
      }))
      .filter((center) => serviceFilter === "ALL" || center.matchedService)
      .filter((center) => platformFilter === "ALL" || centerHasPlatformItem(center, platformFilter));
  }, [regionScopedCenters, serviceFilter, platformFilter]);

  const cityOptions = useMemo(() => {
    const counts = new Map();
    offeringCenters.forEach((center) => {
      const city = extractCenterCity(center, districtsByCode, regionsByCode);
      if (city) counts.set(city, (counts.get(city) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [offeringCenters, districtsByCode, regionsByCode]);

  const filteredCenters = useMemo(() => {
    const q = normalizeSearchValue(searchQuery);
    const cityQ = normalizeSearchValue(cityFilter);
    const list = offeringCenters.filter((center) => {
      const centerCity = normalizeSearchValue(extractCenterCity(center, districtsByCode, regionsByCode));
      if (cityQ && !centerCity.includes(cityQ)) return false;
      if (onlyAvailable) {
        const beds = center.matchedService
          ? Number(center.matchedService.bedsAvailable) || 0
          : center.services.reduce((sum, service) => sum + (Number(service.bedsAvailable) || 0), 0);
        if (beds <= 0) return false;
      }
      if (!q) return true;
      const servicesText = center.services.map((service) => toOfferingKey(service.name)).join(" ");
      return (
        String(center?.name || "").toLowerCase().includes(q) ||
        String(center?.address || "").toLowerCase().includes(q) ||
        String(center?.technicalPlatform || "").toLowerCase().includes(q) ||
        servicesText.includes(toOfferingKey(q)) ||
        centerCity.includes(q)
      );
    });
    const bedsOf = (center) => (center.matchedService
      ? Number(center.matchedService.bedsAvailable) || 0
      : center.services.reduce((sum, service) => sum + (Number(service.bedsAvailable) || 0), 0));
    const byDistance = (a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return String(a.name || "").localeCompare(String(b.name || ""));
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    };
    return list.sort(sortMode === "BEDS" ? (a, b) => bedsOf(b) - bedsOf(a) || byDistance(a, b) : byDistance);
  }, [offeringCenters, searchQuery, cityFilter, onlyAvailable, sortMode, districtsByCode, regionsByCode]);

  const totalBedsShown = useMemo(
    () => filteredCenters.reduce((sum, center) => sum + (center.matchedService
      ? Number(center.matchedService.bedsAvailable) || 0
      : center.services.reduce((acc, service) => acc + (Number(service.bedsAvailable) || 0), 0)), 0),
    [filteredCenters]
  );

  const selectedServiceLabel = serviceOptions.find((item) => item.key === serviceFilter)?.label || "";
  const selectedPlatformLabel = platformOptions.find((item) => item.key === platformFilter)?.label || "";

  function toggleSelectCenter(center) {
    setSelectedCenterId((prev) => (prev === center._id ? "" : center._id));
  }

  function openReferralForm(center) {
    setReferralTarget(center);
    setReferralPhone("");
    setReferralPatientName("");
    setReferralReason("");
    setReferralServiceName(center?.matchedService?.name || "");
    setReferralServiceDropdownOpen(false);
    setReferralError("");
  }

  function closeReferralForm() {
    if (referralSubmitting) return;
    setReferralTarget(null);
  }

  async function submitReferral() {
    const phone = referralPhone.trim();
    if (!phone) {
      setReferralError("Le numero de telephone du patient est requis.");
      return;
    }
    setReferralSubmitting(true);
    setReferralError("");
    try {
      await apiFetch("/referrals", {
        token,
        method: "POST",
        body: {
          destinationCenterId: referralTarget._id,
          patientPhone: phone,
          patientName: referralPatientName.trim() || undefined,
          serviceName: referralServiceName || undefined,
          reason: referralReason.trim() || undefined,
        },
      });
      setReferralTarget(null);
      showCatalogNotice(`Patient oriente vers ${referralTarget.name}. Le centre a ete notifie.`);
    } catch (err) {
      setReferralError(err.message);
    } finally {
      setReferralSubmitting(false);
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
        <Text style={styles.filterLabel}>Region</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} keyboardShouldPersistTaps="handled">
          {[{ code: "ALL", name: "Toutes les regions", count: centers.length }, ...regionOptions].map((region) => {
            const active = regionFilter === region.code;
            return (
              <Pressable
                key={`ref_region_${region.code}`}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => { setRegionFilter(region.code); setCityFilter(""); }}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{region.name} ({region.count})</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.filterLabel}>Service</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} keyboardShouldPersistTaps="handled">
          {[{ key: "ALL", label: "Tous les services", centerCount: regionScopedCenters.length }, ...serviceOptions].map((item) => {
            const active = serviceFilter === item.key;
            return (
              <Pressable
                key={`ref_service_${item.key}`}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => { setServiceFilter(item.key); setCityFilter(""); }}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{item.label} ({item.centerCount})</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.filterLabel}>Plateau technique</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} keyboardShouldPersistTaps="handled">
          {[{ key: "ALL", label: "Tous les plateaux", centerCount: regionScopedCenters.length }, ...platformOptions].map((item) => {
            const active = platformFilter === item.key;
            return (
              <Pressable
                key={`ref_platform_${item.key}`}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => { setPlatformFilter(item.key); setCityFilter(""); }}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{item.label} ({item.centerCount})</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.filterLabel}>Ville / district</Text>
        <TextInput
          style={styles.cityInput}
          value={cityFilter}
          onChangeText={setCityFilter}
          placeholder="Rechercher une ville ou un district"
          placeholderTextColor={C.textLight}
        />
        {cityOptions.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} keyboardShouldPersistTaps="handled">
            {cityOptions.map((city) => {
              const active = cityFilter === city.name;
              return (
                <Pressable
                  key={`ref_city_${city.name}`}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setCityFilter(active ? "" : city.name)}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{city.name} ({city.count})</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} keyboardShouldPersistTaps="handled">
          <Pressable style={[styles.sortChip, sortMode === "DISTANCE" && styles.sortChipActive]} onPress={() => setSortMode("DISTANCE")}>
            <Text style={[styles.sortChipText, sortMode === "DISTANCE" && styles.sortChipTextActive]}>Plus proches</Text>
          </Pressable>
          <Pressable style={[styles.sortChip, sortMode === "BEDS" && styles.sortChipActive]} onPress={() => setSortMode("BEDS")}>
            <Text style={[styles.sortChipText, sortMode === "BEDS" && styles.sortChipTextActive]}>Plus de places</Text>
          </Pressable>
          <Pressable style={[styles.sortChip, onlyAvailable && styles.sortChipActive]} onPress={() => setOnlyAvailable((value) => !value)}>
            <Text style={[styles.sortChipText, onlyAvailable && styles.sortChipTextActive]}>{onlyAvailable ? "✓ " : ""}Places disponibles uniquement</Text>
          </Pressable>
        </ScrollView>

        <Text style={styles.resultsSummary}>
          {filteredCenters.length} centre{filteredCenters.length > 1 ? "s" : ""}
          {selectedServiceLabel ? ` · ${selectedServiceLabel}` : ""}
          {selectedPlatformLabel ? ` · ${selectedPlatformLabel}` : ""}
          {` · ${totalBedsShown} place(s) disponible(s)`}
          {!coords ? " · activez la localisation pour voir les distances" : ""}
        </Text>
      </View>

      {error ? <Text style={styles.errorBar}>{error}</Text> : null}
      {catalogNotice ? (
        <View style={styles.noticeBar}>
          <Text style={styles.noticeBarText}>{catalogNotice.message}</Text>
        </View>
      ) : null}

      {(
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
            loading || catalogLoading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Chargement...</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Aucun centre trouve pour cette reference.</Text>
              </View>
            )
          }
          renderItem={({ item: center }) => (
            <Pressable
              style={[styles.centerCard, center._id === selectedCenterId && styles.centerCardSelected]}
              onPress={() => toggleSelectCenter(center)}
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

              {center.matchedService ? (
                <View style={styles.matchBox}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.matchLabel}>SERVICE RECHERCHE</Text>
                    <Text style={styles.matchName}>{center.matchedService.name}</Text>
                  </View>
                  <View style={[styles.matchBeds, (Number(center.matchedService.bedsAvailable) || 0) > 0 ? styles.matchBedsOk : styles.matchBedsFull]}>
                    <Text style={[styles.matchBedsValue, { color: (Number(center.matchedService.bedsAvailable) || 0) > 0 ? C.green : C.red }]}>
                      {Number(center.matchedService.bedsAvailable) || 0}
                    </Text>
                    <Text style={[styles.matchBedsText, { color: (Number(center.matchedService.bedsAvailable) || 0) > 0 ? C.green : C.red }]}>
                      {(Number(center.matchedService.bedsAvailable) || 0) > 0 ? "place(s) libre(s)" : "complet"}
                    </Text>
                  </View>
                </View>
              ) : null}

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
                {Array.isArray(center.services) && center.services.length > 0 ? (
                  <View style={{ gap: 4, marginTop: 2 }}>
                    {center.services.map((service) => {
                      const beds = Number(service?.bedsAvailable) || 0;
                      return (
                        <View key={service.name} style={styles.serviceBedsRow}>
                          <Text style={styles.metaValue}>{service.name}</Text>
                          <Text style={[styles.serviceBedsBadge, beds > 0 ? styles.serviceBedsBadgeOk : styles.serviceBedsBadgeFull]}>
                            {beds > 0 ? `${beds} place(s)` : "Complet"}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.metaValue}>Aucun service disponible</Text>
                )}
              </View>

              <View style={styles.actionRow}>
                <Pressable style={styles.primaryBtn} onPress={() => openReferralForm(center)}>
                  <Text style={styles.primaryBtnText}>Orienter / deposer</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={() => startNavigation(center)}>
                  <Text style={styles.secondaryBtnText}>Itineraire</Text>
                </Pressable>
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!referralTarget} transparent animationType="fade" onRequestClose={closeReferralForm}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Orienter un patient</Text>
            <Text style={styles.modalSubtitle}>
              Vers {referralTarget?.name}. Le centre sera informe et devra confirmer la reception.
            </Text>

            <Text style={styles.modalLabel}>Telephone du patient *</Text>
            <TextInput
              style={styles.modalInput}
              value={referralPhone}
              onChangeText={setReferralPhone}
              placeholder="Ex: 07 00 00 00 00"
              placeholderTextColor={C.textLight}
              keyboardType="phone-pad"
            />

            <Text style={styles.modalLabel}>Nom du patient (optionnel)</Text>
            <TextInput
              style={styles.modalInput}
              value={referralPatientName}
              onChangeText={setReferralPatientName}
              placeholder="Nom et prenoms"
              placeholderTextColor={C.textLight}
            />

            {Array.isArray(referralTarget?.services) && referralTarget.services.length > 0 ? (
              <View style={{ marginTop: 10 }}>
                <DropdownField
                  label="Service concerne (optionnel)"
                  placeholder="- Selectionner un service -"
                  selectedLabel={
                    referralServiceName
                      ? formatServiceOption(referralTarget.services.find((s) => s.name === referralServiceName))
                      : ""
                  }
                  options={referralTarget.services}
                  getOptionKey={(option) => option.name}
                  renderOption={formatServiceOption}
                  isOpen={referralServiceDropdownOpen}
                  onToggle={() => setReferralServiceDropdownOpen((prev) => !prev)}
                  onSelect={(name) => {
                    setReferralServiceName(name);
                    setReferralServiceDropdownOpen(false);
                  }}
                  emptyText="Aucun service disponible."
                />
                {referralServiceName &&
                (Number(referralTarget.services.find((s) => s.name === referralServiceName)?.bedsAvailable) || 0) <= 0 ? (
                  <Text style={styles.modalWarning}>Ce service est complet. L'orientation reste possible.</Text>
                ) : null}
              </View>
            ) : null}

            <Text style={[styles.modalLabel, { marginTop: 10 }]}>Motif (optionnel)</Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextArea]}
              value={referralReason}
              onChangeText={setReferralReason}
              placeholder="Raison de l'orientation"
              placeholderTextColor={C.textLight}
              multiline
            />

            {referralError ? <Text style={styles.modalError}>{referralError}</Text> : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={closeReferralForm} disabled={referralSubmitting}>
                <Text style={styles.modalCancelBtnText}>Annuler</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSubmitBtn, referralSubmitting && { opacity: 0.6 }]}
                onPress={submitReferral}
                disabled={referralSubmitting}
              >
                <Text style={styles.modalSubmitBtnText}>{referralSubmitting ? "Envoi..." : "Confirmer l'orientation"}</Text>
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
    backgroundColor: C.primary,
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
  filterLabel: { fontSize: 11, fontWeight: "800", color: C.textMuted, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: -2 },
  sortChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.bg,
  },
  sortChipActive: { backgroundColor: C.textDark, borderColor: C.textDark },
  sortChipText: { color: C.textMed, fontSize: 12, fontWeight: "700" },
  sortChipTextActive: { color: "#fff" },
  resultsSummary: { fontSize: 12, fontWeight: "700", color: C.textMed },
  matchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.primaryLight,
    borderRadius: R.sm,
    padding: 10,
  },
  matchLabel: { fontSize: 10, fontWeight: "800", color: C.primary, letterSpacing: 0.8 },
  matchName: { fontSize: 15, fontWeight: "800", color: C.textDark, marginTop: 1 },
  matchBeds: { borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", minWidth: 84 },
  matchBedsOk: { backgroundColor: C.greenLight },
  matchBedsFull: { backgroundColor: "#FFFFFF" },
  matchBedsValue: { fontSize: 22, fontWeight: "900" },
  matchBedsText: { fontSize: 10, fontWeight: "800" },
  filterChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: C.surface,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipText: { color: C.textMed, fontSize: 12, fontWeight: "700" },
  filterChipTextActive: { color: "#fff" },
  errorBar: { color: C.red, fontSize: 13, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.redLight },
  noticeBar: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.greenLight, borderBottomWidth: 1, borderBottomColor: "#b7ebc6" },
  noticeBarText: { color: C.green, fontSize: 13, fontWeight: "700" },
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
  centerCardSelected: { borderColor: C.primary, borderWidth: 2 },
  centerCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  centerCardTitleWrap: { flex: 1 },
  centerName: { fontSize: 15, fontWeight: "700", color: C.textDark },
  centerAddress: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  distanceBadge: { backgroundColor: C.primaryLight, borderRadius: R.full, paddingHorizontal: 10, paddingVertical: 4 },
  distanceBadgeText: { color: C.primary, fontWeight: "700", fontSize: 12 },
  divider: { height: 1, backgroundColor: C.border },
  centerMeta: { gap: 2 },
  metaLabel: { fontSize: 11, color: C.textMuted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 13, color: C.textMed },
  serviceBedsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  serviceBedsBadge: { fontSize: 11, fontWeight: "800", borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  serviceBedsBadgeOk: { color: C.green, backgroundColor: C.greenLight },
  serviceBedsBadgeFull: { color: C.red, backgroundColor: C.redLight },
  actionRow: { flexDirection: "row", gap: 8 },
  primaryBtn: {
    flex: 1,
    borderRadius: R.sm,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: C.primary,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  secondaryBtn: {
    borderRadius: R.sm,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  secondaryBtnText: { color: C.textMed, fontWeight: "700", fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: C.surface,
    borderRadius: R.md,
    padding: 18,
    gap: 4,
    ...S.md,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: C.textDark },
  modalSubtitle: { fontSize: 12, color: C.textMuted, marginBottom: 10, lineHeight: 18 },
  modalLabel: { fontSize: 12, fontWeight: "700", color: C.textMed, marginTop: 8, marginBottom: 4 },
  modalInput: {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: C.textDark,
  },
  modalTextArea: { minHeight: 70, textAlignVertical: "top" },
  modalError: { color: C.red, fontSize: 12, marginTop: 8 },
  modalWarning: { color: C.amber, fontSize: 12, marginTop: 6 },
  modalActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  modalCancelBtn: {
    flex: 1,
    borderRadius: R.sm,
    paddingVertical: 11,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  modalCancelBtnText: { color: C.textMed, fontWeight: "700", fontSize: 13 },
  modalSubmitBtn: {
    flex: 2,
    borderRadius: R.sm,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: C.primary,
  },
  modalSubmitBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
