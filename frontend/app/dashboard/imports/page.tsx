"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Upload } from "lucide-react";

function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const headers = lines[0].split(delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] || "").trim(); });
    return row;
  });
}

function getAny(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return "";
}

type ParsedCenter = {
  name: string; address: string; technicalPlatform: string; latitude: number; longitude: number;
  level: string; establishmentType: string; establishmentCode?: string; regionCode?: string; districtCode?: string;
  services: { name: string }[];
};

function mapRow(row: Record<string, string>): ParsedCenter | null {
  const name = getAny(row, ["name", "Name", "nom", "Nom"]);
  const address = getAny(row, ["address", "Address", "adresse", "Adresse"]) || "Adresse non renseignee";
  const technicalPlatform = getAny(row, ["technicalPlatform", "plateau", "plateauTechnique"]) || "Non renseigne";
  const latitude = Number(getAny(row, ["latitude", "Latitude", "lat"]));
  const longitude = Number(getAny(row, ["longitude", "Longitude", "lon", "lng"]));
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const level = getAny(row, ["level", "Level", "niveau"]).toUpperCase() || "CENTRE_SANTE";
  const establishmentType = getAny(row, ["establishmentType", "type", "Type"]).toUpperCase() || "PUBLIQUE";
  const establishmentCode = getAny(row, ["establishmentCode", "code", "Code"]);
  const regionCode = getAny(row, ["regionCode", "region", "Region"]).toUpperCase();
  const districtCode = getAny(row, ["districtCode", "district", "District"]).toUpperCase();
  const services = getAny(row, ["services", "Services"]).split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n }));
  return {
    name, address, technicalPlatform, latitude, longitude, level, establishmentType,
    ...(establishmentCode ? { establishmentCode } : {}),
    ...(regionCode ? { regionCode } : {}),
    ...(districtCode ? { districtCode } : {}),
    services,
  };
}

export default function ImportsPage() {
  const { token } = useAuthStore();
  const [rows, setRows] = useState<ParsedCenter[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function onFile(file: File) {
    setError("");
    setSuccess("");
    try {
      const text = await file.text();
      const parsed = parseCsv(text).map(mapRow).filter((r): r is ParsedCenter => r !== null);
      setRows(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fichier illisible");
    }
  }

  async function runImport() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const chunkSize = 300;
      let total = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const result = await apiFetch<{ importedCount: number }>("/centers/import", { token, method: "POST", body: { centers: chunk } });
        total += Number(result.importedCount || 0);
      }
      setSuccess(`${total} centre(s) importe(s)`);
      setRows([]);
    } catch (err) {
      if (err instanceof ApiError) {
        const firstError = (err.data as { errors?: { index: number; message: string }[] })?.errors?.[0];
        setError(firstError ? `${err.message} (ligne ${firstError.index + 1}: ${firstError.message})` : err.message);
      } else {
        setError(err instanceof Error ? err.message : "Erreur");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader icon={Upload} title="Importations" subtitle="Import en masse de centres via un fichier CSV" />

      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
        <input
          type="file"
          accept=".csv"
          className="hidden"
          id="import-file"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <label htmlFor="import-file" className="cursor-pointer text-sm font-semibold text-red-600">
          Choisir un fichier CSV
        </label>
        <p className="mt-2 text-xs text-slate-400">
          Colonnes attendues : name, address, technicalPlatform, latitude, longitude, level, establishmentType,
          establishmentCode, regionCode, districtCode, services
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      {rows.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">{rows.length} centre(s) prets a importer</p>
            <Button onClick={runImport} disabled={loading}>{loading ? "Import en cours..." : "Lancer l'import"}</Button>
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left font-bold text-slate-400">
                  <th className="p-2">Nom</th><th className="p-2">Adresse</th><th className="p-2">Niveau</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="p-2">{r.name}</td><td className="p-2">{r.address}</td><td className="p-2">{r.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
