"use client";

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; count: number; color: string }[];
  centerLabel: string;
  centerValue: number;
}) {
  const CIRC = 2 * Math.PI * 60;
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const visible = segments.filter((s) => s.count > 0);
  const arcs = visible.reduce<{ label: string; count: number; color: string; dash: number; gap: number; dashoffset: number }[]>(
    (acc, seg) => {
      const cumulative = acc.reduce((sum, a) => sum + a.dash, 0);
      const dash = total > 0 ? (seg.count / total) * CIRC : 0;
      const dashoffset = CIRC - cumulative;
      acc.push({ ...seg, dash, gap: CIRC - dash, dashoffset });
      return acc;
    },
    []
  );

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 180 180" className="h-40 w-40 shrink-0">
        <circle cx="90" cy="90" r="60" fill="none" stroke="#f1f5f9" strokeWidth="26" />
        {arcs.map((seg) => (
          <circle
            key={seg.label}
            cx="90"
            cy="90"
            r="60"
            fill="none"
            stroke={seg.color}
            strokeWidth="26"
            strokeDasharray={`${seg.dash} ${seg.gap}`}
            strokeDashoffset={seg.dashoffset}
            transform="rotate(-90 90 90)"
          />
        ))}
        <text x="90" y="86" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1e293b">
          {centerValue}
        </text>
        <text x="90" y="103" textAnchor="middle" fontSize="10" fill="#64748b">
          {centerLabel}
        </text>
      </svg>
      <div className="flex flex-col gap-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: seg.color }} />
            <span className="flex-1 text-slate-600">{seg.label}</span>
            <span className="font-bold text-slate-900">{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
