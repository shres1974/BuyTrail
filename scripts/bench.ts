/**
 * pnpm bench [--seconds N] [--rps N] [--warmup N] — HTTP benchmark of the public read APIs
 * against a running web server (Section 30.1). Prints measured percentiles; nothing is assumed.
 * Mix: 40% exact-model search, 30% category search, 30% variant offers.
 */
import "./_env";
import { DEMO_VARIANTS } from "@buytrail/providers";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const BASE = process.env.BENCH_BASE_URL ?? "http://localhost:3000";
const SECONDS = arg("seconds", 60);
const RPS = arg("rps", 20);
const WARMUP = arg("warmup", 10);

const models = [...new Set(DEMO_VARIANTS.map((v) => v.modelCode))];
const cats = ["monitor", "headphones", "kettle", "blender", "toaster"];
let i = 0;
function nextRequest(): { kind: string; url: string } {
  i++;
  const r = i % 10;
  if (r < 4) return { kind: "search_exact", url: `${BASE}/api/search?q=${encodeURIComponent(models[i % models.length]!)}` };
  if (r < 7) return { kind: "search_category", url: `${BASE}/api/search?q=${cats[i % cats.length]}` };
  const v = DEMO_VARIANTS[i % DEMO_VARIANTS.length]!;
  return { kind: "offers", url: `${BASE}/api/variants/${v.id}/offers` };
}

type Sample = { kind: string; ms: number; ok: boolean };
async function run(seconds: number, record: boolean): Promise<Sample[]> {
  const samples: Sample[] = [];
  const inflight: Promise<void>[] = [];
  const start = Date.now();
  const interval = 1000 / RPS;
  // Search is rate-limited; run the server with SEARCH_RATE_LIMIT_PER_MINUTE raised for benchmarks.
  for (let n = 0; Date.now() - start < seconds * 1000; n++) {
    const due = start + n * interval;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const req = nextRequest();
    const t0 = performance.now();
    inflight.push(
      fetch(req.url)
        .then(async (res) => {
          await res.arrayBuffer();
          if (record) samples.push({ kind: req.kind, ms: performance.now() - t0, ok: res.ok });
        })
        .catch(() => {
          if (record) samples.push({ kind: req.kind, ms: performance.now() - t0, ok: false });
        }),
    );
  }
  await Promise.all(inflight);
  return samples;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! : NaN;
};

async function main() {
  const cold = performance.now();
  await fetch(`${BASE}/api/search?q=CP27Q`).then((r) => r.arrayBuffer());
  const coldMs = performance.now() - cold;
  await run(WARMUP, false);
  const samples = await run(SECONDS, true);
  const kinds = [...new Set(samples.map((s) => s.kind))];
  const by = Object.fromEntries(
    kinds.map((k) => {
      const xs = samples.filter((s) => s.kind === k);
      const ms = xs.map((s) => s.ms);
      return [k, { n: xs.length, errors: xs.filter((s) => !s.ok).length, p50: +pct(ms, 50).toFixed(1), p95: +pct(ms, 95).toFixed(1), p99: +pct(ms, 99).toFixed(1) }];
    }),
  );
  const all = samples.map((s) => s.ms);
  console.log(
    JSON.stringify(
      {
        base: BASE,
        targetRps: RPS,
        seconds: SECONDS,
        warmupSeconds: WARMUP,
        firstRequestMs: +coldMs.toFixed(1),
        total: { n: samples.length, achievedRps: +(samples.length / SECONDS).toFixed(1), errors: samples.filter((s) => !s.ok).length, p50: +pct(all, 50).toFixed(1), p95: +pct(all, 95).toFixed(1), p99: +pct(all, 99).toFixed(1) },
        byKind: by,
        node: process.version,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
