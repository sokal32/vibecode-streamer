import { describe, expect, test } from '@jest/globals';
import { parseM3U8, encodeM3U8, createTag } from '../src/m3u8';

describe('M3U8 manifest parsing, modifying, and encoding', () => {
  test('should parse, modify, and encode M3U8 manifest', () => {
    const originalManifest = `#EXTM3U
#EXTINF:9.009,Segment 1
segment-0.ts
#EXTINF:9.009,Segment 2
segment-1.ts
#EXTINF:9.009,Segment 3
segment-2.ts`;

    // Parse the manifest
    const playlist = parseM3U8(originalManifest);

    // Verify parsing worked
    expect(playlist.segments).toHaveLength(3);
    expect(playlist.segments![0].uri).toBe('segment-0.ts');

    // Modify: add a new media item
    playlist.segments!.push({
      duration: 9.009,
      title: 'Segment 4',
      uri: 'segment-3.ts',
      tags: [createTag('EXTINF', '9.009,Segment 4')],
    });

    // Encode back to text
    const encodedManifest = encodeM3U8(playlist);

    // Verify the manifest was parsed, modified, and encoded correctly
    expect(encodedManifest).toContain('#EXTM3U');
    expect(encodedManifest).toContain('segment-0.ts');
    expect(encodedManifest).toContain('segment-1.ts');
    expect(encodedManifest).toContain('segment-2.ts');
    expect(encodedManifest).toContain('segment-3.ts');
    expect(playlist.segments).toHaveLength(4);

    // Parse the encoded manifest again to verify sustainability
    const reparsedPlaylist = parseM3U8(encodedManifest);

    // Verify the reparsed playlist matches the modified one
    expect(reparsedPlaylist.segments).toHaveLength(4);
    expect(reparsedPlaylist.segments![0].uri).toBe('segment-0.ts');
    expect(reparsedPlaylist.segments![1].uri).toBe('segment-1.ts');
    expect(reparsedPlaylist.segments![2].uri).toBe('segment-2.ts');
    expect(reparsedPlaylist.segments![3].uri).toBe('segment-3.ts');
    expect(reparsedPlaylist.segments![3].title).toBe('Segment 4');
    expect(reparsedPlaylist.segments![3].duration).toBe(9.009);
  });
});
