import { describe, expect, test } from '@jest/globals';
import { Streamer } from '../src/streamer';
import { parseM3U8 } from '../src/m3u8';

// Mock axios to prevent actual HTTP requests
jest.mock('axios');

describe('Live Playlist Generation', () => {
  let streamer: Streamer;

  beforeEach(() => {
    streamer = new Streamer();
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  test('should generate basic live variant with default window size', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U\n#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0
segment-0.ts
#EXTINF:10.0
segment-1.ts
#EXTINF:10.0
segment-2.ts
#EXTINF:10.0
segment-3.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    const now = start + 5000; // 5 seconds elapsed

    // First fetch the master
    await streamer.convertVODToLive('https://example.com/master.m3u8', undefined, start);

    // Then fetch the variant
    const result = await streamer.convertVODToLive('https://example.com/master.m3u8', 0, start, now);

    // Should NOT have VOD-specific tags
    expect(result).not.toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(result).not.toContain('#EXT-X-ENDLIST');

    // Should have live-specific tags
    expect(result).toContain('#EXT-X-MEDIA-SEQUENCE:');
    expect(result).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:');
    expect(result).toContain('#EXT-X-TARGETDURATION:');

    // Parse and verify segments
    const playlist = parseM3U8(result);
    expect(playlist.segments).toHaveLength(3);
    expect(playlist.segments![0].uri).toBe('https://example.com/segment-0.ts');
    expect(playlist.segments![1].uri).toBe('https://example.com/segment-1.ts');
    expect(playlist.segments![2].uri).toBe('https://example.com/segment-2.ts');
  });

  test('should handle live stream when elapsed time is less than VOD duration', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,Segment 1
segment-0.ts
#EXTINF:10.0,Segment 2
segment-1.ts
#EXTINF:10.0,Segment 3
segment-2.ts
#EXTINF:10.0,Segment 4
segment-3.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    const now = start + 15000; // 15 seconds elapsed (15s < 40s VOD duration)

    // First fetch the master
    await streamer.convertVODToLive('https://example.com/live1.m3u8', undefined, start);

    // Then fetch the variant
    const result = await streamer.convertVODToLive('https://example.com/live1.m3u8', 0, start, now);

    // Should contain media sequence (at 15s, should have passed segment 0)
    expect(result).toContain('#EXT-X-MEDIA-SEQUENCE:1');

    // Should have discontinuity sequence 0 (no loops yet)
    expect(result).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:0');

    // Should NOT have discontinuity tag (no looping yet) - use newline to avoid matching DISCONTINUITY-SEQUENCE
    expect(result).not.toContain('#EXT-X-DISCONTINUITY\n');

    // Parse and verify segments
    const playlist = parseM3U8(result);
    expect(playlist.segments).toHaveLength(3);
    expect(playlist.segments![0].uri).toBe('https://example.com/segment-1.ts');
    expect(playlist.segments![1].uri).toBe('https://example.com/segment-2.ts');
    expect(playlist.segments![2].uri).toBe('https://example.com/segment-3.ts');
  });

  test('should handle live stream when elapsed time exceeds VOD duration (first loop)', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,Segment 1
segment-0.ts
#EXTINF:10.0,Segment 2
segment-1.ts
#EXTINF:10.0,Segment 3
segment-2.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    const now = start + 35000; // 35 seconds elapsed (35s > 30s VOD duration)

    // First fetch the master
    await streamer.convertVODToLive('https://example.com/live2.m3u8', undefined, start);

    // Then fetch the variant
    const result = await streamer.convertVODToLive('https://example.com/live2.m3u8', 0, start, now);

    // Should have discontinuity tag (content looped back) - use newline to avoid matching DISCONTINUITY-SEQUENCE
    expect(result).toContain('#EXT-X-DISCONTINUITY\n');

    // Media sequence should be > 0 (we've passed multiple segments)
    const mediaSeqMatch = result.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    expect(mediaSeqMatch).toBeTruthy();
    const mediaSeq = parseInt(mediaSeqMatch![1]);
    expect(mediaSeq).toBeGreaterThan(0);

    // Discontinuity sequence should still be 0 (discontinuity is in the window but hasn't been removed yet)
    const discSeqMatch = result.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/);
    expect(discSeqMatch).toBeTruthy();
    const discSeq = parseInt(discSeqMatch![1]);
    expect(discSeq).toBe(0);

    // Parse and verify segments
    const playlist = parseM3U8(result);
    expect(playlist.segments).toHaveLength(3);
    expect(playlist.segments![0].uri).toBe('https://example.com/segment-0.ts');
    expect(playlist.segments![1].uri).toBe('https://example.com/segment-1.ts');
    expect(playlist.segments![2].uri).toBe('https://example.com/segment-2.ts');
  });

  test('should handle live stream when elapsed time exceeds VOD duration multiple times', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,Segment 1
segment-0.ts
#EXTINF:10.0,Segment 2
segment-1.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    const now = start + 65000; // 65 seconds elapsed (65s = 3+ loops of 20s VOD)

    // First fetch the master
    await streamer.convertVODToLive('https://example.com/live3.m3u8', undefined, start);

    // Then fetch the variant
    const result = await streamer.convertVODToLive('https://example.com/live3.m3u8', 0, start, now);

    // Should have discontinuity tag - use newline to avoid matching DISCONTINUITY-SEQUENCE
    expect(result).toContain('#EXT-X-DISCONTINUITY\n');

    // Media sequence should be relatively high
    const mediaSeqMatch = result.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    expect(mediaSeqMatch).toBeTruthy();
    const mediaSeq = parseInt(mediaSeqMatch![1]);
    expect(mediaSeq).toBeGreaterThan(2);

    // Discontinuity sequence should account for multiple loops
    const discSeqMatch = result.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/);
    expect(discSeqMatch).toBeTruthy();
    const discSeq = parseInt(discSeqMatch![1]);
    expect(discSeq).toBeGreaterThan(0);

    // Parse and verify segments
    const playlist = parseM3U8(result);
    expect(playlist.segments).toHaveLength(2);
    expect(playlist.segments![0].uri).toBe('https://example.com/segment-0.ts');
    expect(playlist.segments![1].uri).toBe('https://example.com/segment-1.ts');
  });

  test('should support custom window size for live streams', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,Segment 1
segment-0.ts
#EXTINF:10.0,Segment 2
segment-1.ts
#EXTINF:10.0,Segment 3
segment-2.ts
#EXTINF:10.0,Segment 4
segment-3.ts
#EXTINF:10.0,Segment 5
segment-4.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    const now = start + 5000;
    const windowSize = 5;

    // First fetch the master
    await streamer.convertVODToLive('https://example.com/live4.m3u8', undefined, start);

    // Then fetch the variant with custom window size
    const result = await streamer.convertVODToLive('https://example.com/live4.m3u8', 0, start, now, windowSize);

    // Parse and verify segments
    const playlist = parseM3U8(result);
    expect(playlist.segments).toHaveLength(5);
    expect(playlist.segments![0].uri).toBe('https://example.com/segment-0.ts');
    expect(playlist.segments![1].uri).toBe('https://example.com/segment-1.ts');
    expect(playlist.segments![2].uri).toBe('https://example.com/segment-2.ts');
    expect(playlist.segments![3].uri).toBe('https://example.com/segment-3.ts');
    expect(playlist.segments![4].uri).toBe('https://example.com/segment-4.ts');
  });

  test('should handle master playlist request for live', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
variant-0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
variant-1.m3u8`;

    const axios = require('axios');
    axios.get.mockResolvedValue({ data: mockMasterManifest });

    const start = Date.now();
    const result = await streamer.convertVODToLive('https://example.com/live5.m3u8', undefined, start);

    // Should be a master playlist
    expect(result).toContain('#EXTM3U');
    expect(result).toContain('BANDWIDTH=5000000');

    // URIs should be rewritten to /live.m3u8 (no ENDLIST tag)
    expect(result).toContain('/live.m3u8?');
    expect(result).toContain('variant=0');
    expect(result).toContain('variant=1');
    expect(result).toContain(`start=${start}`);

    // Should preserve bandwidth attributes
    expect(result).toContain('BANDWIDTH=5000000');
    expect(result).toContain('BANDWIDTH=2500000');
  });

  test('should correctly wrap elapsed time within VOD duration', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,Segment 1
segment-0.ts
#EXTINF:10.0,Segment 2
segment-1.ts`;

    const axios = require('axios');
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    const start = Date.now();
    // Total VOD duration = 20s, elapsed = 25s, should wrap to 5s position
    const now = start + 25000;

    // First fetch the master
    await streamer.convertVODToLive('https://example.com/live6.m3u8', undefined, start);

    // Then fetch the variant
    const result = await streamer.convertVODToLive('https://example.com/live6.m3u8', 0, start, now);

    // Should have looped, so discontinuity tag should be present - use newline to avoid matching DISCONTINUITY-SEQUENCE
    expect(result).toContain('#EXT-X-DISCONTINUITY\n');

    // Media sequence should be > 0
    const mediaSeqMatch = result.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    expect(mediaSeqMatch).toBeTruthy();
    const mediaSeq = parseInt(mediaSeqMatch![1]);
    expect(mediaSeq).toBeGreaterThan(0);

    // Parse and verify segments
    const playlist = parseM3U8(result);
    expect(playlist.segments).toHaveLength(2);
    expect(playlist.segments![0].uri).toBe('https://example.com/segment-0.ts');
    expect(playlist.segments![1].uri).toBe('https://example.com/segment-1.ts');
  });
});
