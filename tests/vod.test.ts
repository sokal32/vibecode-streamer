import { describe, expect, test } from '@jest/globals';
import { Streamer } from '../src/streamer';

// Mock axios to prevent actual HTTP requests
jest.mock('axios');

describe('VOD Playlist Generation', () => {
  let streamer: Streamer;

  beforeEach(() => {
    streamer = new Streamer();
  });

  test('should generate default VOD variant without duration limit', async () => {
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
variant-0.m3u8`;

    const mockVariantManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:9.009,Segment 1
segment-0.ts
#EXTINF:9.009,Segment 2
segment-1.ts
#EXTINF:9.009,Segment 3
segment-2.ts`;

    const axios = require('axios');
    // First call returns master, second call returns variant
    axios.get
      .mockResolvedValueOnce({ data: mockMasterManifest })
      .mockResolvedValueOnce({ data: mockVariantManifest });

    // First fetch the master
    await streamer.makeVOD('https://example.com/master.m3u8');

    // Then fetch the variant
    const result = await streamer.makeVOD('https://example.com/master.m3u8', 0);

    // Should contain all 3 original segments
    expect(result).toContain('segment-0.ts');
    expect(result).toContain('segment-1.ts');
    expect(result).toContain('segment-2.ts');

    // Should have VOD-specific tags
    expect(result).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(result).toContain('#EXT-X-ENDLIST');

    // Should have target duration
    expect(result).toContain('#EXT-X-TARGETDURATION:');

    // Count segments (each segment has EXTINF + URI)
    const segmentCount = (result.match(/segment-\d+\.ts/g) || []).length;
    expect(segmentCount).toBe(3);
  });

  test('should generate shortened VOD variant with duration limit', async () => {
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

    // First fetch the master
    await streamer.makeVOD('https://example.com/master2.m3u8');

    // Then fetch the variant with duration limit
    const result = await streamer.makeVOD('https://example.com/master2.m3u8', 0, 20);

    // Should have VOD tags
    expect(result).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(result).toContain('#EXT-X-ENDLIST');

    // Count segments
    const segmentCount = (result.match(/segment-\d+\.ts/g) || []).length;
    expect(segmentCount).toBe(2); // Only 2 segments for 20 seconds

    // Should contain first 2 segments
    expect(result).toContain('segment-0.ts');
    expect(result).toContain('segment-1.ts');
  });

  test('should generate extended VOD variant with duration beyond original', async () => {
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

    // First fetch the master
    await streamer.makeVOD('https://example.com/master3.m3u8');

    // Then fetch the variant with extended duration
    const result = await streamer.makeVOD('https://example.com/master3.m3u8', 0, 35);

    // Should have VOD tags
    expect(result).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(result).toContain('#EXT-X-ENDLIST');

    // Count segments
    const segmentCount = (result.match(/segment-\d+\.ts/g) || []).length;
    expect(segmentCount).toBe(4); // 4 segments for 40 seconds (loops back)

    // Should have discontinuity tag when looping
    expect(result).toContain('#EXT-X-DISCONTINUITY');

    // Segments should appear: 0, 1, 0 (with discontinuity), 1
    const lines = result.split('\n');
    const segmentLines = lines.filter(line => line.includes('segment-'));

    expect(segmentLines[0]).toContain('segment-0.ts');
    expect(segmentLines[1]).toContain('segment-1.ts');
    expect(segmentLines[2]).toContain('segment-0.ts'); // Loop back
    expect(segmentLines[3]).toContain('segment-1.ts');
  });

  test('should handle master playlist request for VOD', async () => {
    // Master playlist with ENDLIST tag to indicate VOD
    const mockMasterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-ENDLIST
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
variant-0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
variant-1.m3u8`;

    const axios = require('axios');
    axios.get.mockResolvedValue({ data: mockMasterManifest });

    const result = await streamer.makeVOD('https://example.com/master4.m3u8');

    // Should be a master playlist
    expect(result).toContain('#EXTM3U');
    expect(result).toContain('BANDWIDTH=5000000'); // Master playlists have variant attributes

    // URIs should be rewritten to /vod.m3u8 because of ENDLIST tag
    expect(result).toContain('/vod.m3u8?');
    expect(result).toContain('variant=0');
    expect(result).toContain('variant=1');

    // Should preserve bandwidth attributes
    expect(result).toContain('BANDWIDTH=5000000');
    expect(result).toContain('BANDWIDTH=2500000');
  });
});
