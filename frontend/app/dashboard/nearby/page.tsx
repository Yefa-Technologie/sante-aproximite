"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { isChef } from "@/lib/roles";
import { formatLevel, formatType } from "@/lib/format";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { MapPin, LocateFixed, Navigation2 } from "lucide-react";
import type { MapCenter } from "@/components/dashboard/NearbyMap";

const NearbyMap = dynamic(() => import("@/components/dashboard/NearbyMap").then((m) => m.NearbyMap), {
  ssr: false,
});

export default function NearbyPage() {
  const { user, token } = useAuthStore();
  const chef = isChef(user);
  const [radiusKm, setRadiusKm] = useState(20);
  const [search, setSearch] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [centers, setCenters] = useState<MapCenter[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchNearby(position = coords) {
    if (!position) {
      setError("Position indisponible. Cliquez sur 'Utiliser ma position actuelle'.");
      return;
    }
    setError("");
    setInfo("");
    try {
      const baseRadius = radiusKm || 20;
      let data = await apiFetch<MapCenter[]>(
        `/centers/nearby?latitude=${position.lat}&longitude=${position.lon}&radiusKm=${baseRadius}`,
        { token }
      );
      if (data.length === 0) {
        for (const r of [50, 100, 200, 500, 700]) {
          if (r <= baseRadius) continue;
          const widened = await apiFetch<MapCenter[]>(
            `/centers/nearby?latitude=${position.lat}&longitude=${position.lon}&radiusKm=${r}`,
            { token }
          );
          if (widened.length > 0) {
            data = widened;
            setInfo(`Aucun centre dans ${baseRadius} km. Resultats elargis a ${r} km.`);
            break;
          }
        }
      }
      if (data.length === 0) setInfo(`Aucun centre trouve dans ${baseRadius} km.`);
      setCenters(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setCenters([]);
    }
  }

  async function refreshPosition() {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 })
      );
      const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setCoords(next);
      await fetchNearby(next);
    } catch {
      setError("Impossible de recuperer votre position.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!chef) refreshPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return centers;
    return centers.filter((c) => {
      const services = c.services?.map((s) => s.name).join(" ").toLowerCase() || "";
      return (
        c.name?.toLowerCase().includes(q) ||
        c.address?.toLowerCase().includes(q) ||
        c.technicalPlatform?.toLowerCase().includes(q) ||
        services.includes(q)
      );
    });
  }, [centers, search]);

  const selected = filtered.find((c) => c._id === selectedId);

  function navigateTo(center: MapCenter) {
    const lat = center.location.coordinates[1];
    const lon = center.location.coordinates[0];
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, "_blank");
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={MapPin} title="Centres de sante" subtitle="Recherchez les centres proches de votre position" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500">Rayon (km)</label>
          <Input
            type="number"
            min={1}
            max={700}
            className="w-24"
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
          />
        </div>
        <Input
          className="max-w-xs flex-1"
          placeholder="Rechercher: nom, type, service, plateau"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="outline" onClick={refreshPosition} disabled={loading}>
          <LocateFixed className="h-4 w-4" /> Ma position
        </Button>
        <Button onClick={() => fetchNearby()}>Rechercher</Button>
      </div>

      {info ? <Alert variant="info">{info}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="h-[420px] overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
        <NearbyMap coords={coords} centers={filtered} selectedId={selectedId} onSelect={(c) => setSelectedId(c._id)} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.length === 0 ? <p className="text-sm text-slate-400">Aucun centre a afficher pour le moment.</p> : null}
        {filtered.map((center) => (
          <div
            key={center._id}
            className={`flex flex-col gap-1.5 rounded-2xl border bg-white p-4 shadow-sm ${
              selected?._id === center._id ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200"
            }`}
          >
            <h3 className="text-sm font-bold text-slate-900">
              {center.name} - {center.distanceKm ?? "?"} km
            </h3>
            <p className="text-xs text-slate-500">{center.address}</p>
            <p className="text-xs text-slate-600">
              <strong>Niveau:</strong> {formatLevel(center.level)}
            </p>
            <p className="text-xs text-slate-600">
              <strong>Type:</strong> {formatType(center.establishmentType)}
            </p>
            <p className="text-xs text-slate-600">
              <strong>Plateau:</strong> {center.technicalPlatform || "-"}
            </p>
            <p className="text-xs text-slate-600">
              <strong>Services:</strong> {center.services?.map((s) => s.name).join(", ") || "Aucun"}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelectedId(center._id)}>
                Voir sur carte
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigateTo(center)}>
                <Navigation2 className="h-3.5 w-3.5" /> Naviguer
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
