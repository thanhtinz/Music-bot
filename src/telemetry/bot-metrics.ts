import { MetricsRegistry } from './metrics';

/**
 * The bot's metrics, defined in one place.
 *
 * Named after what somebody running this would actually ask: is it up, is it
 * playing anything, are commands failing, is the audio node healthy.
 */
export function createBotMetrics() {
  const registry = new MetricsRegistry();

  return {
    registry,

    commands: registry.counter('musicbot_commands_total', 'Commands handled, by name and outcome.'),
    commandDuration: registry.histogram(
      'musicbot_command_duration_seconds',
      'How long a command took to handle.',
    ),

    players: registry.gauge('musicbot_players_active', 'Guilds with a live player.'),
    tracksStarted: registry.counter('musicbot_tracks_started_total', 'Tracks that began playing.'),
    trackErrors: registry.counter(
      'musicbot_track_errors_total',
      'Tracks that failed to play, by reason.',
    ),

    resolverFailures: registry.counter(
      'musicbot_resolver_failures_total',
      'Resolver failures, by source and code.',
    ),

    nodeUp: registry.gauge('musicbot_lavalink_node_up', 'Whether an audio node is connected.'),
    nodePlayers: registry.gauge(
      'musicbot_lavalink_node_players',
      'Players on an audio node, as it last reported.',
    ),

    guilds: registry.gauge('musicbot_guilds', 'Guilds the bot is in.'),
    gatewayLatency: registry.gauge(
      'musicbot_gateway_latency_ms',
      'Round-trip latency to the Discord gateway.',
    ),
  };
}

export type BotMetrics = ReturnType<typeof createBotMetrics>;
