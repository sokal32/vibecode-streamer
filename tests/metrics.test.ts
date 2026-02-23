import { describe, expect, test, beforeEach } from '@jest/globals';
import { Streamer } from '../src/streamer';
import {
  register,
  cacheHitsTotal,
  upstreamFetchesTotal,
  cacheSize,
  upstreamFetchDuration,
} from '../src/metrics';

jest.mock('axios');

const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0
segment-0.ts
#EXTINF:10.0
segment-1.ts`;

// Find the value matching a label set, optionally filtering by metricName suffix (e.g. '_count')
async function getMetricValue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metric: { get(): Promise<{ values: any[] }> },
  labels: Record<string, string>,
  metricNameSuffix?: string,
): Promise<number> {
  const data = await metric.get();
  const match = data.values.find(
    (v: { labels: Record<string, string>; value: number; metricName?: string }) =>
      Object.entries(labels).every(([k, val]) => v.labels[k] === val) &&
      (!metricNameSuffix || v.metricName?.endsWith(metricNameSuffix)),
  );
  return match?.value ?? 0;
}

describe('Metrics', () => {
  let streamer: Streamer;

  beforeEach(() => {
    streamer = new Streamer();
    jest.clearAllMocks();
    register.resetMetrics();
    // Default: isAxiosError returns false (plain network error, no HTTP status)
    const axios = require('axios');
    axios.isAxiosError = jest.fn().mockReturnValue(false);
  });

  test('increments upstreamFetchesTotal with status "200" on a successful fetch', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({ status: 200, data: mockMasterManifest });

    await streamer.makeVOD('https://example.com/master.m3u8');

    const value = await getMetricValue(upstreamFetchesTotal, {
      stream: 'https://example.com/master.m3u8',
      type: 'master',
      status: '200',
    });
    expect(value).toBe(1);
  });

  test('increments upstreamFetchesTotal with status "error" on a network failure', async () => {
    const axios = require('axios');
    axios.get.mockRejectedValue(new Error('Network error'));

    await expect(streamer.makeVOD('https://example.com/master.m3u8')).rejects.toThrow();

    const value = await getMetricValue(upstreamFetchesTotal, {
      stream: 'https://example.com/master.m3u8',
      type: 'master',
      status: 'error',
    });
    expect(value).toBe(1);
  });

  test('records HTTP error status code in upstreamFetchesTotal', async () => {
    const axios = require('axios');
    const err = Object.assign(new Error('Not Found'), { response: { status: 404 } });
    axios.get.mockRejectedValue(err);
    axios.isAxiosError = jest.fn().mockReturnValue(true);

    await expect(streamer.makeVOD('https://example.com/master.m3u8')).rejects.toThrow();

    const value = await getMetricValue(upstreamFetchesTotal, {
      stream: 'https://example.com/master.m3u8',
      type: 'master',
      status: '404',
    });
    expect(value).toBe(1);
  });

  test('records separate upstreamFetchesTotal entries for master and variant downloads', async () => {
    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ status: 200, data: mockMasterManifest })
      .mockResolvedValueOnce({ status: 200, data: mockVariantManifest });

    await streamer.makeVOD('https://example.com/master.m3u8', 0);

    const masterFetches = await getMetricValue(upstreamFetchesTotal, {
      stream: 'https://example.com/master.m3u8',
      type: 'master',
      status: '200',
    });
    const variantFetches = await getMetricValue(upstreamFetchesTotal, {
      stream: 'https://example.com/master.m3u8',
      type: 'variant',
      status: '200',
    });

    expect(masterFetches).toBe(1);
    expect(variantFetches).toBe(1);
  });

  test('increments cacheHitsTotal when a manifest is served from cache', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({ status: 200, data: mockMasterManifest });

    // First call populates the cache; second call is a cache hit
    await streamer.makeVOD('https://example.com/master.m3u8');
    await streamer.makeVOD('https://example.com/master.m3u8');

    const value = await getMetricValue(cacheHitsTotal, {
      stream: 'https://example.com/master.m3u8',
      type: 'master',
    });
    expect(value).toBe(1);
  });

  test('cacheHitsTotal is not incremented on the first (cold) fetch', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({ status: 200, data: mockMasterManifest });

    await streamer.makeVOD('https://example.com/master.m3u8');

    const value = await getMetricValue(cacheHitsTotal, {
      stream: 'https://example.com/master.m3u8',
      type: 'master',
    });
    expect(value).toBe(0);
  });

  test('sets cacheSize gauge to 2 after fetching master and variant manifests', async () => {
    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ status: 200, data: mockMasterManifest })
      .mockResolvedValueOnce({ status: 200, data: mockVariantManifest });

    await streamer.makeVOD('https://example.com/master.m3u8', 0);

    const data = await cacheSize.get();
    expect(data.values[0]?.value).toBe(2);
  });

  test('records an upstreamFetchDuration observation for each upstream download', async () => {
    const axios = require('axios');
    axios.get.mockResolvedValue({ status: 200, data: mockMasterManifest });

    await streamer.makeVOD('https://example.com/master.m3u8');

    const count = await getMetricValue(
      upstreamFetchDuration,
      { stream: 'https://example.com/master.m3u8', type: 'master' },
      '_count',
    );
    expect(count).toBe(1);
  });

  test('records upstreamFetchDuration even when the fetch fails', async () => {
    const axios = require('axios');
    axios.get.mockRejectedValue(new Error('Network error'));

    await expect(streamer.makeVOD('https://example.com/master.m3u8')).rejects.toThrow();

    const count = await getMetricValue(
      upstreamFetchDuration,
      { stream: 'https://example.com/master.m3u8', type: 'master' },
      '_count',
    );
    expect(count).toBe(1);
  });
});
