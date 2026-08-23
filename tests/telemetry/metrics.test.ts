import { describe, expect, it } from 'vitest';

import { MetricsRegistry } from '../../src/telemetry/metrics';

describe('Counter', () => {
  it('counts up and renders the Prometheus shape', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('bot_things_total', 'Things.');

    counter.increment();
    counter.increment();

    expect(registry.render()).toBe(
      [
        '# HELP bot_things_total Things.',
        '# TYPE bot_things_total counter',
        'bot_things_total 2',
      ].join('\n') + '\n',
    );
  });

  it('keeps label sets apart', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('bot_commands_total', 'Commands.');

    counter.increment({ command: 'play', status: 'ok' });
    counter.increment({ command: 'play', status: 'ok' });
    counter.increment({ command: 'skip', status: 'ok' });

    expect(counter.get({ command: 'play', status: 'ok' })).toBe(2);
    expect(counter.get({ command: 'skip', status: 'ok' })).toBe(1);
  });

  it('treats the same labels in any order as one series', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('bot_commands_total', 'Commands.');

    counter.increment({ a: '1', b: '2' });
    counter.increment({ b: '2', a: '1' });

    expect(counter.get({ a: '1', b: '2' })).toBe(2);
  });

  it('renders labels in a stable order', () => {
    const registry = new MetricsRegistry();
    registry.counter('bot_x_total', 'X.').increment({ zebra: 'z', alpha: 'a' });

    expect(registry.render()).toContain('bot_x_total{alpha="a",zebra="z"} 1');
  });

  it('escapes what would break the format', () => {
    const registry = new MetricsRegistry();
    registry.counter('bot_x_total', 'X.').increment({ label: 'a"b\\c\nd' });

    expect(registry.render()).toContain('label="a\\"b\\\\c\\nd"');
  });

  it('counts by an amount when given one', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('bot_x_total', 'X.');

    counter.increment({}, 5);

    expect(counter.get()).toBe(5);
  });
});

describe('Gauge', () => {
  it('goes both ways', () => {
    const registry = new MetricsRegistry();
    const gauge = registry.gauge('bot_players', 'Players.');

    gauge.set(4);
    expect(gauge.get()).toBe(4);

    gauge.add(-3);
    expect(gauge.get()).toBe(1);
  });

  it('replaces rather than accumulates on set', () => {
    const registry = new MetricsRegistry();
    const gauge = registry.gauge('bot_players', 'Players.');

    gauge.set(4);
    gauge.set(2);

    expect(gauge.get()).toBe(2);
  });

  it('reads zero for a series never touched', () => {
    const registry = new MetricsRegistry();
    expect(registry.gauge('bot_x', 'X.').get({ node: 'never' })).toBe(0);
  });
});

describe('Histogram', () => {
  it('makes its buckets cumulative, as the format requires', () => {
    const registry = new MetricsRegistry();
    const histogram = registry.histogram('bot_seconds', 'Seconds.', [0.1, 1, 10]);

    histogram.observe(0.05);
    histogram.observe(0.5);
    histogram.observe(5);

    const rendered = registry.render();
    // 0.05 alone is under 0.1; 0.05 and 0.5 are under 1; all three under 10.
    expect(rendered).toContain('bot_seconds_bucket{le="0.1"} 1');
    expect(rendered).toContain('bot_seconds_bucket{le="1"} 2');
    expect(rendered).toContain('bot_seconds_bucket{le="10"} 3');
    expect(rendered).toContain('bot_seconds_bucket{le="+Inf"} 3');
  });

  it('counts an observation past every bucket in +Inf only', () => {
    const registry = new MetricsRegistry();
    const histogram = registry.histogram('bot_seconds', 'Seconds.', [0.1]);

    histogram.observe(99);

    const rendered = registry.render();
    expect(rendered).toContain('bot_seconds_bucket{le="0.1"} 0');
    expect(rendered).toContain('bot_seconds_bucket{le="+Inf"} 1');
  });

  it('reports the sum and the count', () => {
    const registry = new MetricsRegistry();
    const histogram = registry.histogram('bot_seconds', 'Seconds.', [1]);

    histogram.observe(0.25);
    histogram.observe(0.75);

    const rendered = registry.render();
    expect(rendered).toContain('bot_seconds_sum 1');
    expect(rendered).toContain('bot_seconds_count 2');
  });

  it('keeps label sets apart', () => {
    const registry = new MetricsRegistry();
    const histogram = registry.histogram('bot_seconds', 'Seconds.', [1]);

    histogram.observe(0.5, { command: 'play' });
    histogram.observe(0.5, { command: 'skip' });

    const rendered = registry.render();
    expect(rendered).toContain('bot_seconds_count{command="play"} 1');
    expect(rendered).toContain('bot_seconds_count{command="skip"} 1');
  });
});

describe('MetricsRegistry', () => {
  it('renders every metric, ending with a newline', () => {
    const registry = new MetricsRegistry();
    registry.counter('a_total', 'A.').increment();
    registry.gauge('b', 'B.').set(1);

    const rendered = registry.render();
    expect(rendered).toContain('a_total 1');
    expect(rendered).toContain('b 1');
    expect(rendered.endsWith('\n')).toBe(true);
  });

  it('renders a metric that has never been touched as just its header', () => {
    const registry = new MetricsRegistry();
    registry.counter('untouched_total', 'Nothing yet.');

    // A declared-but-empty metric still tells a scraper the series exists.
    expect(registry.render()).toContain('# TYPE untouched_total counter');
  });
});
