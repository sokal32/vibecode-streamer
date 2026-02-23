import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();

collectDefaultMetrics({ register });

/**
 * Total incoming manifest requests.
 * Labels:
 *   stream   – stream name (from registry) or custom URL
 *   endpoint – "live" | "vod"
 *   type     – "master" | "variant"
 *   result   – "success" | "error"
 */
export const requestsTotal = new Counter({
  name: 'streamer_requests_total',
  help: 'Total number of incoming manifest requests',
  labelNames: ['stream', 'endpoint', 'type', 'result'] as const,
  registers: [register],
});

/**
 * End-to-end latency of a manifest request (from receipt to response sent).
 * Labels: stream, endpoint, type  (same as requestsTotal, minus result)
 */
export const requestDuration = new Histogram({
  name: 'streamer_request_duration_seconds',
  help: 'Duration of manifest request handling in seconds',
  labelNames: ['stream', 'endpoint', 'type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

/**
 * Upstream manifest downloads with HTTP status code.
 * Labels:
 *   stream – stream name or custom URL
 *   type   – "master" | "variant"
 *   status – HTTP status code as a string (e.g. "200", "404") or "error" for network failures
 */
export const upstreamFetchesTotal = new Counter({
  name: 'streamer_upstream_fetches_total',
  help: 'Total upstream manifest fetches from origin, labelled by HTTP status code',
  labelNames: ['stream', 'type', 'status'] as const,
  registers: [register],
});

/**
 * Latency of upstream manifest downloads (excludes cache hits).
 * Labels: stream, type
 */
export const upstreamFetchDuration = new Histogram({
  name: 'streamer_upstream_fetch_duration_seconds',
  help: 'Duration of upstream manifest downloads in seconds',
  labelNames: ['stream', 'type'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * Manifest cache hits (requests served from in-memory cache without a network fetch).
 * Labels: stream, type
 */
export const cacheHitsTotal = new Counter({
  name: 'streamer_cache_hits_total',
  help: 'Total number of manifest cache hits',
  labelNames: ['stream', 'type'] as const,
  registers: [register],
});

/**
 * Manifest requests broken down by endpoint and specific variant track.
 * Labels:
 *   endpoint – "vod" | "live"
 *   type     – "master" | "variant0" | "variant1" | …
 */
export const manifestRequestsTotal = new Counter({
  name: 'streamer_manifest_requests_total',
  help: 'Total manifest requests by endpoint (vod/live) and type (master/variantN)',
  labelNames: ['endpoint', 'type'] as const,
  registers: [register],
});

/**
 * Current number of manifest entries held in the in-memory cache.
 * Useful for spotting unbounded growth (there is no TTL/eviction).
 */
export const cacheSize = new Gauge({
  name: 'streamer_cache_size',
  help: 'Number of manifest entries currently held in the in-memory cache',
  registers: [register],
});
