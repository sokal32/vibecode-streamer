import { describe, expect, test } from '@jest/globals';
import { Streamer } from '../src/streamer';
import { parseAdParam, injectAdBreaks, type AdConfig } from '../src/ads';
import { parseM3U8, type MediaSegment, createTag } from '../src/m3u8';

// Mock axios to prevent actual HTTP requests
jest.mock('axios');

// ============================================================================
// Unit tests for parseAdParam
// ============================================================================

describe('parseAdParam', () => {
  test('should parse interval mode', () => {
    const config = parseAdParam('interval,15,30');
    expect(config.mode).toBe('interval');
    expect(config.duration).toBe(15);
    expect(config.interval).toBe(30);
  });

  test('should parse timestamp mode with multiple timestamps', () => {
    const config = parseAdParam('ts,20,00:20:30,01:03:03');
    expect(config.mode).toBe('ts');
    expect(config.duration).toBe(20);
    expect(config.timestamps).toEqual([
      20 * 60 + 30,       // 00:20:30 = 1230s
      1 * 3600 + 3 * 60 + 3, // 01:03:03 = 3783s
    ]);
  });

  test('should parse timestamp mode with single timestamp', () => {
    const config = parseAdParam('ts,10,00:00:30');
    expect(config.mode).toBe('ts');
    expect(config.duration).toBe(10);
    expect(config.timestamps).toEqual([30]);
  });

  test('should throw on unknown mode', () => {
    expect(() => parseAdParam('unknown,10,20')).toThrow('Unknown ad mode');
  });
});

// ============================================================================
// Unit tests for injectAdBreaks
// ============================================================================

describe('injectAdBreaks', () => {
  function makeSegment(duration: number, uri: string): MediaSegment {
    return {
      duration,
      uri,
      tags: [createTag('EXTINF', `${duration},`)],
    };
  }

  test('should inject CUE-OUT and CUE-IN for interval mode', () => {
    const segments: MediaSegment[] = [
      makeSegment(10, 'seg-0.ts'),
      makeSegment(10, 'seg-1.ts'),
      makeSegment(10, 'seg-2.ts'),
      makeSegment(10, 'seg-3.ts'), // starts at t=30, ad starts at t=30
      makeSegment(10, 'seg-4.ts'), // starts at t=40, CUE-OUT-CONT (10s of 15s)
      makeSegment(10, 'seg-5.ts'), // starts at t=50, CUE-IN (ad ended at t=45)
    ];

    const config: AdConfig = { mode: 'interval', duration: 15, interval: 30 };
    injectAdBreaks(segments, config, 0);

    // seg-3 at t=30: CUE-OUT
    expect(segments[3].tags[0].name).toBe('EXT-X-CUE-OUT');
    expect(segments[3].tags[0].value).toBe('15');

    // seg-4 at t=40: CUE-OUT-CONT (10s elapsed of 15s)
    expect(segments[4].tags[0].name).toBe('EXT-X-CUE-OUT-CONT');
    expect(segments[4].tags[0].value).toBe('10.0/15');

    // seg-5 at t=50: CUE-IN (ad ended at t=45)
    expect(segments[5].tags[0].name).toBe('EXT-X-CUE-IN');

    // seg-0, seg-1, seg-2 should not have ad tags
    expect(segments[0].tags[0].name).toBe('EXTINF');
    expect(segments[1].tags[0].name).toBe('EXTINF');
    expect(segments[2].tags[0].name).toBe('EXTINF');
  });

  test('should inject CUE-OUT and CUE-IN for timestamp mode', () => {
    const segments: MediaSegment[] = [
      makeSegment(10, 'seg-0.ts'),
      makeSegment(10, 'seg-1.ts'),
      makeSegment(10, 'seg-2.ts'), // starts at t=20
      makeSegment(10, 'seg-3.ts'), // starts at t=30, ad (started at t=25) still active (ends at t=35)
      makeSegment(10, 'seg-4.ts'), // starts at t=40, CUE-IN
    ];

    const config: AdConfig = { mode: 'ts', duration: 10, timestamps: [25] };
    injectAdBreaks(segments, config, 0);

    // seg-2 at t=20: not in ad (ad starts at 25, seg starts at 20)
    expect(segments[2].tags[0].name).toBe('EXTINF');

    // seg-3 at t=30: CUE-OUT-CONT (5s into 10s ad that started at t=25)
    expect(segments[3].tags[0].name).toBe('EXT-X-CUE-OUT-CONT');
    expect(segments[3].tags[0].value).toBe('5.0/10');

    // seg-4 at t=40: CUE-IN
    expect(segments[4].tags[0].name).toBe('EXT-X-CUE-IN');
  });

  test('should inject CUE-OUT at exact segment boundary', () => {
    const segments: MediaSegment[] = [
      makeSegment(10, 'seg-0.ts'),
      makeSegment(10, 'seg-1.ts'), // starts at t=10, ad starts at t=10
      makeSegment(10, 'seg-2.ts'), // starts at t=20, CUE-IN (ad ends at t=15)
    ];

    const config: AdConfig = { mode: 'ts', duration: 5, timestamps: [10] };
    injectAdBreaks(segments, config, 0);

    expect(segments[1].tags[0].name).toBe('EXT-X-CUE-OUT');
    expect(segments[1].tags[0].value).toBe('5');
    expect(segments[2].tags[0].name).toBe('EXT-X-CUE-IN');
  });

  test('should handle ad break starting before the window (live)', () => {
    // Window starts at t=35, ad break started at t=30 with 15s duration (ends at t=45)
    const segments: MediaSegment[] = [
      makeSegment(10, 'seg-0.ts'), // t=35: in ad, 5s elapsed
      makeSegment(10, 'seg-1.ts'), // t=45: CUE-IN (ad ended)
      makeSegment(10, 'seg-2.ts'), // t=55: normal
    ];

    const config: AdConfig = { mode: 'ts', duration: 15, timestamps: [30] };
    injectAdBreaks(segments, config, 35);

    expect(segments[0].tags[0].name).toBe('EXT-X-CUE-OUT-CONT');
    expect(segments[0].tags[0].value).toBe('5.0/15');
    expect(segments[1].tags[0].name).toBe('EXT-X-CUE-IN');
    expect(segments[2].tags[0].name).toBe('EXTINF');
  });

  test('should handle multiple ad breaks', () => {
    const segments: MediaSegment[] = [
      makeSegment(10, 'seg-0.ts'), // t=0
      makeSegment(10, 'seg-1.ts'), // t=10, ad #1 starts
      makeSegment(10, 'seg-2.ts'), // t=20, CUE-IN
      makeSegment(10, 'seg-3.ts'), // t=30, ad #2 starts
      makeSegment(10, 'seg-4.ts'), // t=40, CUE-IN
    ];

    const config: AdConfig = { mode: 'ts', duration: 5, timestamps: [10, 30] };
    injectAdBreaks(segments, config, 0);

    expect(segments[0].tags[0].name).toBe('EXTINF');
    expect(segments[1].tags[0].name).toBe('EXT-X-CUE-OUT');
    expect(segments[2].tags[0].name).toBe('EXT-X-CUE-IN');
    expect(segments[3].tags[0].name).toBe('EXT-X-CUE-OUT');
    expect(segments[4].tags[0].name).toBe('EXT-X-CUE-IN');
  });

  test('should not inject when no ad breaks overlap the window', () => {
    const segments: MediaSegment[] = [
      makeSegment(10, 'seg-0.ts'),
      makeSegment(10, 'seg-1.ts'),
    ];

    const config: AdConfig = { mode: 'ts', duration: 5, timestamps: [100] };
    injectAdBreaks(segments, config, 0);

    // No ad tags injected
    expect(segments[0].tags).toHaveLength(1);
    expect(segments[1].tags).toHaveLength(1);
  });

  test('should handle interval with startOffset (live window)', () => {
    // interval=30, duration=10, window starts at t=55
    // Ad breaks at t=30 (ends t=40), t=60 (ends t=70)
    const segments: MediaSegment[] = [
      makeSegment(10, 'seg-0.ts'), // t=55: normal
      makeSegment(10, 'seg-1.ts'), // t=65: in ad (started at t=60), 5s elapsed
      makeSegment(10, 'seg-2.ts'), // t=75: CUE-IN (ad ended at t=70)
    ];

    const config: AdConfig = { mode: 'interval', duration: 10, interval: 30 };
    injectAdBreaks(segments, config, 55);

    expect(segments[0].tags[0].name).toBe('EXTINF');
    expect(segments[1].tags[0].name).toBe('EXT-X-CUE-OUT-CONT');
    expect(segments[1].tags[0].value).toBe('5.0/10');
    expect(segments[2].tags[0].name).toBe('EXT-X-CUE-IN');
  });
});

// ============================================================================
// Integration tests: VOD with ads
// ============================================================================

describe('VOD with Ad Breaks', () => {
  let streamer: Streamer;

  beforeEach(() => {
    streamer = new Streamer();
    jest.clearAllMocks();
  });

  test('should inject ad breaks into VOD variant (interval mode)', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment-0.ts
#EXTINF:10.0,
segment-1.ts
#EXTINF:10.0,
segment-2.ts
#EXTINF:10.0,
segment-3.ts
#EXTINF:10.0,
segment-4.ts
#EXTINF:10.0,
segment-5.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    await streamer.makeVOD('https://example.com/ad-vod1.m3u8');

    // interval=30 → ad at t=30 with 15s duration (ends at t=45)
    // seg-3(t=30): CUE-OUT, seg-4(t=40): CUE-OUT-CONT, seg-5(t=50): CUE-IN
    const ad: AdConfig = { mode: 'interval', duration: 15, interval: 30 };
    const result = await streamer.makeVOD('https://example.com/ad-vod1.m3u8', 0, undefined, ad);

    // Should have VOD tags
    expect(result).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(result).toContain('#EXT-X-ENDLIST');

    // Ad at t=30: seg-3 gets CUE-OUT, seg-4 gets CUE-OUT-CONT, seg-5 gets CUE-IN
    expect(result).toContain('#EXT-X-CUE-OUT:15');
    expect(result).toContain('#EXT-X-CUE-OUT-CONT:10.0/15');
    expect(result).toContain('#EXT-X-CUE-IN');

    // Verify order via parsing
    const playlist = parseM3U8(result);
    expect(playlist.segments).toHaveLength(6);
  });

  test('should inject ad breaks into VOD variant (timestamp mode)', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment-0.ts
#EXTINF:10.0,
segment-1.ts
#EXTINF:10.0,
segment-2.ts
#EXTINF:10.0,
segment-3.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    await streamer.makeVOD('https://example.com/ad-vod2.m3u8');

    const ad: AdConfig = { mode: 'ts', duration: 5, timestamps: [10] };
    const result = await streamer.makeVOD('https://example.com/ad-vod2.m3u8', 0, undefined, ad);

    // CUE-OUT at seg-1 (t=10), CUE-IN at seg-2 (t=20)
    expect(result).toContain('#EXT-X-CUE-OUT:5');
    expect(result).toContain('#EXT-X-CUE-IN');
  });

  test('should propagate ad param in master playlist variant URIs', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
variant-0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
variant-1.m3u8`;

    const axios = require('axios');
    axios.get.mockResolvedValue({ data: mockMasterManifest });

    const ad: AdConfig = { mode: 'interval', duration: 15, interval: 30 };
    const result = await streamer.makeVOD('https://example.com/ad-master.m3u8', undefined, undefined, ad);

    // Variant URIs should contain ad param
    expect(result).toContain('ad=interval');
    expect(result).toContain('/vod.m3u8?');
  });
});

// ============================================================================
// Integration tests: Live with ads
// ============================================================================

describe('Live with Ad Breaks', () => {
  let streamer: Streamer;

  beforeEach(() => {
    streamer = new Streamer();
    jest.clearAllMocks();
  });

  test('should inject ad breaks into live variant (interval mode)', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment-0.ts
#EXTINF:10.0,
segment-1.ts
#EXTINF:10.0,
segment-2.ts
#EXTINF:10.0,
segment-3.ts
#EXTINF:10.0,
segment-4.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    const now = start + 25000; // 25s elapsed, window slides to [seg-1, seg-2, seg-3] at ~t=10-40

    await streamer.convertVODToLive('https://example.com/ad-live1.m3u8', undefined, start);

    // interval=20 → ad at t=20 with 10s duration (ends at t=30)
    const ad: AdConfig = { mode: 'interval', duration: 10, interval: 20 };
    // Window at 25s elapsed: [seg-1(t=10), seg-2(t=20), seg-3(t=30)], ad at t=20
    const result = await streamer.convertVODToLive('https://example.com/ad-live1.m3u8', 0, start, now, undefined, ad);

    // Should have live tags
    expect(result).not.toContain('#EXT-X-ENDLIST');
    expect(result).toContain('#EXT-X-MEDIA-SEQUENCE:');

    // Should have ad tags in the window
    expect(result).toContain('EXT-X-CUE-OUT');
  });

  test('should inject ad breaks into live variant (timestamp mode)', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment-0.ts
#EXTINF:10.0,
segment-1.ts
#EXTINF:10.0,
segment-2.ts
#EXTINF:10.0,
segment-3.ts
#EXTINF:10.0,
segment-4.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    const now = start + 5000; // 5s elapsed, window is [seg-0, seg-1, seg-2] at t=0-30

    await streamer.convertVODToLive('https://example.com/ad-live2.m3u8', undefined, start);

    // Ad at t=10 with 5s duration
    const ad: AdConfig = { mode: 'ts', duration: 5, timestamps: [10] };
    const result = await streamer.convertVODToLive('https://example.com/ad-live2.m3u8', 0, start, now, undefined, ad);

    // seg-1 at t=10: CUE-OUT, seg-2 at t=20: CUE-IN
    expect(result).toContain('#EXT-X-CUE-OUT:5');
    expect(result).toContain('#EXT-X-CUE-IN');
  });

  test('should propagate ad param in live master playlist variant URIs', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
variant-0.m3u8`;

    const axios = require('axios');
    axios.get.mockResolvedValue({ data: mockMasterManifest });

    const start = Date.now();
    const ad: AdConfig = { mode: 'ts', duration: 20, timestamps: [30] };
    const result = await streamer.convertVODToLive('https://example.com/ad-live3.m3u8', undefined, start, undefined, undefined, ad);

    expect(result).toContain('ad=ts');
    expect(result).toContain('/live.m3u8?');
  });
});
