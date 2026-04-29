type Labels = Record<string, string | number | boolean | null | undefined>;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();

function key(name: string, labels: Labels = {}): string {
  const pairs = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return pairs.length ? `${name}{${pairs.join(",")}}` : name;
}

export function inc(name: string, labels?: Labels, by = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function setGauge(name: string, value: number, labels?: Labels): void {
  gauges.set(key(name, labels), value);
}

export function observeMs(name: string, ms: number, labels?: Labels): void {
  inc(`${name}_count`, labels);
  inc(`${name}_sum`, labels, ms / 1000);
  setGauge(`${name}_last_seconds`, ms / 1000, labels);
}

export function prometheusText(): string {
  const lines = [
    "# HELP owl_info OWL process info.",
    "# TYPE owl_info gauge",
    `owl_info{service="owl-ui"} 1`,
  ];
  for (const [k, v] of counters) lines.push(`${k} ${v}`);
  for (const [k, v] of gauges) lines.push(`${k} ${v}`);
  return `${lines.join("\n")}\n`;
}
