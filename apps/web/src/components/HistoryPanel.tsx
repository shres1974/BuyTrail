import type { variantHistory } from "@buytrail/services";
import { LiveBadge, SampleBadge } from "./ui";

type History = Awaited<ReturnType<typeof variantHistory>>;

/** Accessible history: SVG chart with text summary and a table alternative (Section 5, 15). */
export function HistoryPanel({ history }: { history: History }) {
  if (!history.available) {
    return <p className="mt-2 text-sm text-muted">{history.reason} No chart is shown rather than an invented one.</p>;
  }
  const pts = history.points.filter((p) => p.lowestKnownTotal);
  const vals = pts.map((p) => Number(p.lowestKnownTotal!.amountMinor));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const W = 520;
  const H = 140;
  const pad = 8;
  const dates = history.points.map((p) => p.date);
  const x = (d: string) => pad + ((dates.indexOf(d) / Math.max(1, dates.length - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - ((v - min) / Math.max(1, max - min)) * (H - 2 * pad);
  // Break the line at gaps (missing days or days with no in-stock total): never interpolate.
  const segments: string[] = [];
  let cur: string[] = [];
  let prevDate: string | null = null;
  for (const p of history.points) {
    const contiguous = prevDate && (new Date(p.date).getTime() - new Date(prevDate).getTime()) / 86400_000 === 1;
    if (!p.lowestKnownTotal || (prevDate && !contiguous)) {
      if (cur.length > 1) segments.push(cur.join(" "));
      cur = [];
    }
    if (p.lowestKnownTotal) cur.push(`${x(p.date).toFixed(1)},${y(Number(p.lowestKnownTotal.amountMinor)).toFixed(1)}`);
    prevDate = p.date;
  }
  if (cur.length > 1) segments.push(cur.join(" "));

  return (
    <div className="mt-2 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {history.isDemo ? <SampleBadge /> : <LiveBadge />}
        <span className="text-muted">{history.coverageLabel}</span>
      </div>
      {history.lowestLabel && <p className="font-medium">{history.lowestLabel}</p>}
      <p className="text-xs text-muted">
        {history.series}. {history.observationCount} observations from {history.sources.length} seller{history.sources.length === 1 ? "" : "s"}.
        {history.gaps.length > 0 && <> Gaps: {history.gaps.join("; ")}.</>}
      </p>
      {pts.length > 1 && (
        <svg role="img" aria-label={`Chart of daily lowest known total. ${history.lowestLabel ?? ""}`} viewBox={`0 0 ${W} ${H}`} className="h-36 w-full rounded-md bg-paper">
          {segments.map((seg, i) => (
            <polyline key={i} points={seg} fill="none" stroke="#0f6b66" strokeWidth={2} />
          ))}
          {pts.map((p) => (
            <circle key={p.date} cx={x(p.date)} cy={y(Number(p.lowestKnownTotal!.amountMinor))} r={2.5} fill="#0f6b66" />
          ))}
        </svg>
      )}
      <details>
        <summary className="cursor-pointer text-teal underline">Show history as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Daily price history</caption>
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className="py-1">Date (UTC)</th>
                <th scope="col" className="py-1">Lowest known total</th>
                <th scope="col" className="py-1">Lowest item price</th>
                <th scope="col" className="py-1">Observations</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {history.points.map((p) => (
                <tr key={p.date} className="border-t border-line">
                  <td className="py-1">{p.date}</td>
                  <td className="py-1">{p.lowestKnownTotal?.display ?? "—"}</td>
                  <td className="py-1">{p.lowestItemPrice?.display ?? "—"}</td>
                  <td className="py-1">{p.observations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
