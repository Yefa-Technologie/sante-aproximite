"use client";

export function BarChart({
  data,
  color = "#3b82f6",
  height = 160,
}: {
  data: { label: string; count: number }[];
  color?: string;
  height?: number;
}) {
  const W = 560;
  const H = height;
  const left = 32;
  const right = W - 8;
  const top = 12;
  const bottom = H - 20;
  const areaH = bottom - top;
  const areaW = right - left;
  const maxVal = Math.max(...data.map((d) => d.count), 1);
  const gap = 3;
  const bw = (areaW - gap * (data.length - 1)) / data.length;
  const ticks = [0, 1, 2, 3, 4].map((i) => ({
    val: Math.round((maxVal * i) / 4),
    y: bottom - (i / 4) * areaH,
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="block w-full">
      {ticks.map((tick) => (
        <g key={tick.val}>
          <line x1={left} y1={tick.y} x2={right} y2={tick.y} stroke="#e5e7eb" strokeWidth={1} />
          <text x={left - 4} y={tick.y + 4} fontSize={10} fill="#9ca3af" textAnchor="end">
            {tick.val}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const h = Math.max((d.count / maxVal) * areaH, d.count > 0 ? 3 : 0);
        const x = left + i * (bw + gap);
        const y = bottom - h;
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={bw} height={h} rx={2} fill={color} opacity={0.85} />
            {d.count > 0 ? (
              <text x={x + bw / 2} y={y - 3} fontSize={9} fill={color} textAnchor="middle">
                {d.count}
              </text>
            ) : null}
            <text x={x + bw / 2} y={H - 4} fontSize={9} fill="#6b7280" textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
