/**
 * A small Prometheus-format metrics registry.
 *
 * Hand-rolled rather than pulled in: the bot needs four metric shapes, the text
 * format is a dozen lines to emit, and a dependency here would be more code to
 * keep current than the thing it replaces.
 */
export type Labels = Readonly<Record<string, string>>;

interface Sample {
  labels: Labels;
  value: number;
}

/** Bucket edges in seconds, covering a fast command to a timing-out one. */
export const DEFAULT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  abstract get type(): string;
  abstract render(): string[];

  protected header(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
  }
}

/** A value that only goes up: requests served, errors seen. */
export class Counter extends Metric {
  private readonly samples = new Map<string, Sample>();

  get type(): string {
    return 'counter';
  }

  increment(labels: Labels = {}, by = 1): void {
    const key = keyOf(labels);
    const existing = this.samples.get(key);

    if (existing) existing.value += by;
    else this.samples.set(key, { labels, value: by });
  }

  get(labels: Labels = {}): number {
    return this.samples.get(keyOf(labels))?.value ?? 0;
  }

  render(): string[] {
    return [...this.header(), ...[...this.samples.values()].map((s) => line(this.name, s))];
  }
}

/** A value that moves in both directions: players connected, queue length. */
export class Gauge extends Metric {
  private readonly samples = new Map<string, Sample>();

  get type(): string {
    return 'gauge';
  }

  set(value: number, labels: Labels = {}): void {
    this.samples.set(keyOf(labels), { labels, value });
  }

  add(delta: number, labels: Labels = {}): void {
    const key = keyOf(labels);
    const existing = this.samples.get(key);

    if (existing) existing.value += delta;
    else this.samples.set(key, { labels, value: delta });
  }

  get(labels: Labels = {}): number {
    return this.samples.get(keyOf(labels))?.value ?? 0;
  }

  render(): string[] {
    return [...this.header(), ...[...this.samples.values()].map((s) => line(this.name, s))];
  }
}

interface HistogramSample {
  labels: Labels;
  counts: number[];
  sum: number;
  count: number;
}

/** A distribution: how long commands take. */
export class Histogram extends Metric {
  private readonly samples = new Map<string, HistogramSample>();

  constructor(
    name: string,
    help: string,
    private readonly buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {
    super(name, help);
  }

  get type(): string {
    return 'histogram';
  }

  observe(value: number, labels: Labels = {}): void {
    const key = keyOf(labels);
    let sample = this.samples.get(key);

    if (!sample) {
      sample = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.samples.set(key, sample);
    }

    // Prometheus buckets are cumulative: an observation counts in its own
    // bucket and in every larger one.
    this.buckets.forEach((edge, index) => {
      if (value <= edge) sample!.counts[index] = (sample!.counts[index] ?? 0) + 1;
    });

    sample.sum += value;
    sample.count += 1;
  }

  render(): string[] {
    const lines = this.header();

    for (const sample of this.samples.values()) {
      this.buckets.forEach((edge, index) => {
        lines.push(
          line(`${this.name}_bucket`, {
            labels: { ...sample.labels, le: String(edge) },
            value: sample.counts[index] ?? 0,
          }),
        );
      });

      lines.push(
        line(`${this.name}_bucket`, {
          labels: { ...sample.labels, le: '+Inf' },
          value: sample.count,
        }),
        line(`${this.name}_sum`, { labels: sample.labels, value: sample.sum }),
        line(`${this.name}_count`, { labels: sample.labels, value: sample.count }),
      );
    }

    return lines;
  }
}

/** Everything the bot exposes, rendered together. */
export class MetricsRegistry {
  private readonly metrics: Metric[] = [];

  counter(name: string, help: string): Counter {
    return this.register(new Counter(name, help));
  }

  gauge(name: string, help: string): Gauge {
    return this.register(new Gauge(name, help));
  }

  histogram(name: string, help: string, buckets?: readonly number[]): Histogram {
    return this.register(new Histogram(name, help, buckets));
  }

  /** Prometheus text exposition format. */
  render(): string {
    return `${this.metrics.flatMap((metric) => metric.render()).join('\n')}\n`;
  }

  private register<T extends Metric>(metric: T): T {
    this.metrics.push(metric);
    return metric;
  }
}

function keyOf(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${labels[name]}`)
    .join(',');
}

function line(name: string, sample: Sample): string {
  const names = Object.keys(sample.labels).sort();
  if (names.length === 0) return `${name} ${sample.value}`;

  const rendered = names.map((label) => `${label}="${escape(sample.labels[label] ?? '')}"`);
  return `${name}{${rendered.join(',')}} ${sample.value}`;
}

/** Label values are quoted, so a quote or newline inside one has to be escaped. */
function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
