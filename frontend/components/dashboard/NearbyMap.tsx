"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapCenter = {
  _id: string;
  name: string;
  address: string;
  level: string;
  establishmentType: string;
  technicalPlatform: string;
  distanceKm?: number;
  services: { name: string }[];
  location: { coordinates: [number, number] };
};

function markerColor(center: MapCenter) {
  if (center.establishmentType === "PUBLIQUE") return "#1d4ed8";
  if (center.establishmentType === "PRIVE") return "#16a34a";
  if (center.establishmentType === "CONFESSIONNEL") return "#d97706";
  return "#475569";
}

function pinIcon(color: string, symbol: string, size = 18) {
  const pinSize = size + 8;
  return L.divIcon({
    className: "custom-map-pin",
    html: `<div style="width:${pinSize}px;height:${pinSize}px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 3px 10px rgba(15,23,42,.35);display:grid;place-items:center;color:#fff;font-size:${
      size - 6
    }px;font-weight:700;">${symbol}</div>`,
    iconSize: [pinSize, pinSize],
    iconAnchor: [pinSize / 2, pinSize / 2],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [40, 40] });
    else if (points.length === 1) map.setView(points[0], 12);
  }, [map, points]);
  return null;
}

export function NearbyMap({
  coords,
  centers,
  selectedId,
  onSelect,
}: {
  coords: { lat: number; lon: number } | null;
  centers: MapCenter[];
  selectedId: string;
  onSelect: (center: MapCenter) => void;
}) {
  const validCenters = centers.filter(
    (c) => Number.isFinite(c.location?.coordinates?.[1]) && Number.isFinite(c.location?.coordinates?.[0])
  );
  const selected = validCenters.find((c) => c._id === selectedId);
  const points: [number, number][] = [
    ...(coords ? ([[coords.lat, coords.lon]] as [number, number][]) : []),
    ...validCenters.map((c) => [c.location.coordinates[1], c.location.coordinates[0]] as [number, number]),
  ];

  return (
    <MapContainer center={[6.5244, 3.3792]} zoom={11} className="h-full w-full">
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {!selected && points.length > 0 ? <FitBounds points={points} /> : null}
      {coords ? (
        <Marker position={[coords.lat, coords.lon]} icon={pinIcon("#0ea5e9", "📍", 20)}>
          <Popup>Votre position actuelle</Popup>
        </Marker>
      ) : null}
      {validCenters.map((center) => {
        const lat = center.location.coordinates[1];
        const lon = center.location.coordinates[0];
        return (
          <Marker
            key={center._id}
            position={[lat, lon]}
            icon={pinIcon(markerColor(center), "🏥")}
            eventHandlers={{ click: () => onSelect(center) }}
          >
            <Tooltip direction="top">
              {center.name} - {center.distanceKm ?? "?"} km
            </Tooltip>
            <Popup maxWidth={320}>
              <div className="min-w-[220px] text-sm">
                <strong>{center.name}</strong>
                <br />
                <span className="text-xs text-slate-500">{center.address}</span>
                <br />
                <span className="text-xs">Distance: {center.distanceKm ?? "-"} km</span>
                <br />
                <span className="text-xs">Plateau: {center.technicalPlatform || "-"}</span>
                <br />
                <span className="text-xs">
                  Services: {center.services?.map((s) => s.name).join(", ") || "Aucun"}
                </span>
              </div>
            </Popup>
          </Marker>
        );
      })}
      {selected && coords ? (
        <Polyline
          positions={[
            [coords.lat, coords.lon],
            [selected.location.coordinates[1], selected.location.coordinates[0]],
          ]}
          color="#0b7285"
          weight={4}
        />
      ) : null}
    </MapContainer>
  );
}
