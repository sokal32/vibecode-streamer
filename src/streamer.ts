import type { Response } from "express";
import { createHash } from 'crypto';
import axios from "axios";
import { streams } from "../streams";
import { parseM3U8, encodeM3U8, createTag, type M3U8Playlist, type MediaSegment, updateOrAddTag } from "./m3u8";

export class Streamer {
  private readonly defaultWindowSize = 3;

  private cache: Record<string, M3U8Playlist> = {};

  async makeVOD(stream?: string, variant?: number, duration?: number): Promise<string> {
    const streamURL = this.resolveStreamURL(stream);
    const manifest = structuredClone(await this.fetchManifest(streamURL, variant));

    return variant !== undefined
      ? this.fitVariant(manifest, duration)
      : this.generateMaster(manifest);
  }

  async convertVODToLive(stream?: string, variant?: number, start = Date.now(), now = Date.now(), windowSize = this.defaultWindowSize): Promise<string> {
    const streamURL = this.resolveStreamURL(stream);
    const manifest = structuredClone(await this.fetchManifest(streamURL, variant));

    return variant !== undefined
      ? this.shuffleVariant(manifest, start, now, windowSize)
      : this.generateMaster(manifest, start);
  }

  // Replace variant URIs with our links
  private generateMaster(manifest: M3U8Playlist, start?: number): string {
    // TODO: need to handle audio streams here too
    if (manifest.variants) {
      const isVOD = !!manifest.tags.find(t => t.name === 'EXT-X-ENDLIST');

      manifest.variants.forEach((stream, i) => {
        const searchParams = new URLSearchParams();
        searchParams.append('variant', `${i}`);
        searchParams.append('start', (start ?? 0).toString());

        stream.uri = `/${isVOD ? 'vod' : 'live'}.m3u8?${searchParams.toString()}`;
      });
    }

    return encodeM3U8(manifest);
  }

  // Generate VOD variant stream with optional specified duration
  private fitVariant(manifest: M3U8Playlist, duration?: number): string {
    // If we don't limit/extend duration or have empty segments list we just encode playlist as is
    if (!manifest.segments?.length || !duration) {
      return this.generateVODVariant(manifest);
    }

    const vod = manifest.segments || [];
    const segments: MediaSegment[] = [];

    let accumulatedDuration = 0;
    let i = 0;

    // Build segment list until we reach or exceed the target duration
    while (accumulatedDuration < duration) {
      const segment = { ...vod[i % vod.length] };

      // Add discontinuity when looping back to the start
      if (i >= vod.length && i % vod.length === 0) {
        segment.discontinuity = true;
        // Add discontinuity tag to segment's tags array
        segment.tags = [createTag('EXT-X-DISCONTINUITY'), ...(segment.tags || [])];
      }

      segments.push(segment);
      accumulatedDuration += segment.duration;
      i++;
    }

    manifest.segments = segments;

    return this.generateVODVariant(manifest);
  }

  // Generate VOD variant M3U8 playlist
  private generateVODVariant(manifest: M3U8Playlist): string {
    const targetDuration = (manifest.segments || []).reduce((max, { duration }) => Math.max(max, duration), 0);

    updateOrAddTag(manifest, 'EXT-X-TARGETDURATION', Math.ceil(targetDuration).toString());
    updateOrAddTag(manifest, 'EXT-X-PLAYLIST-TYPE', 'VOD');
    updateOrAddTag(manifest, 'EXT-X-ENDLIST');

    return encodeM3U8(manifest);
  }

  // Generate Live variant stream from VOD manifest by shuffling segments
  private shuffleVariant(manifest: M3U8Playlist, start: number, now: number, windowSize: number): string {
    const vod = manifest.segments || [];
    // Clamp window size to VOD length to avoid having fewer segments than expected
    const actualWindowSize = Math.min(windowSize, vod.length);
    const output: MediaSegment[] = vod.slice(0, actualWindowSize).map(s => structuredClone(s));

    let i = 0;
    let mediaSequence = 0;
    let discontinuitySequence = 0;
    let elapsed = (now - start) / 1000;
    let hasLooped = false;

    while (elapsed > vod[i].duration) {
      const segment = structuredClone(vod[i]);

      // Handle discontinuity at the start of each VOD loop
      if (i === 0 && mediaSequence > 0) {
        hasLooped = true;
        segment.discontinuity = true;
        segment.tags = [createTag('EXT-X-DISCONTINUITY'), ...(segment.tags || [])];
      }

      // Push segment to tail and remove from head (shuffle)
      output.push(segment);

      const removed = output.shift();
      if (removed?.discontinuity) {
        discontinuitySequence++;
      }

      elapsed -= segment.duration;
      mediaSequence += 1;

      i += 1;
      if (i >= vod.length) {
        i = 0;
        hasLooped = true;
      }
    }

    // If we've looped but the current head segment doesn't have a discontinuity tag yet,
    // we need to add it because the head is the next segment to be played after looping
    if (hasLooped && i === 0 && !output[0].discontinuity) {
      output[0].discontinuity = true;
      output[0].tags = [createTag('EXT-X-DISCONTINUITY'), ...(output[0].tags || [])];
    }

    manifest.segments = output;

    return this.generateVariant(manifest, mediaSequence, discontinuitySequence);
  }

  // Generate Live variant M3U8 playlist
  private generateVariant(manifest: M3U8Playlist, mediaSequence: number, discontinuitySequence: number) {
    // Guard against empty segments
    if (!manifest.segments?.length) {
      return encodeM3U8(manifest);
    }

    const targetDuration = manifest.segments.reduce((max, { duration }) => Math.max(max, duration), 0);

    updateOrAddTag(manifest, 'EXT-X-TARGETDURATION', Math.ceil(targetDuration).toString());
    updateOrAddTag(manifest, 'EXT-X-MEDIA-SEQUENCE', mediaSequence.toString());
    updateOrAddTag(manifest, 'EXT-X-DISCONTINUITY-SEQUENCE', discontinuitySequence.toString());

    // Remove VOD-specific tags
    manifest.tags = manifest.tags.filter(t =>
      t.name !== 'EXT-X-PLAYLIST-TYPE' && t.name !== 'EXT-X-ENDLIST'
    );

    return encodeM3U8(manifest);
  }

  // Download from origin and cache manifest (master or variant)
  private async fetchManifest(streamURL: string, variant?: number): Promise<M3U8Playlist> {
    const targetKey = this.getCacheKey(streamURL, variant); // Could be master or variant manifest cache key
    const masterKey = this.getCacheKey(streamURL);

    if (this.cache[targetKey]) {
      return this.cache[targetKey];
    }

    let url = streamURL;

    // If a variant is specified, get the master manifest first to get the variant URI
    if (variant !== undefined) {
      const master = this.cache[masterKey];
      if (!master) {
        throw new Error('Received request to variant before master');
      }

      const targetVariant = master.variants?.[variant];
      if (!targetVariant) {
        throw new Error(`Requested variant index is out of range (max: ${(master.variants?.length ?? 0) - 1})`);
      }

      url = this.resolveRelativeUrl(targetVariant.uri, streamURL);
    }

    const manifest = await this.downloadManifest(url);
    const parsed = parseM3U8(manifest);

    this.cache[targetKey] = parsed;

    return parsed;
  }

  private async downloadManifest(url: string): Promise<string> {
    const response = await axios.get<string>(url, { responseType: 'text' });

    if (!response?.data || !response.data.includes('#EXTM3U')) {
      throw new Error('Invalid manifest content');
    }

    return response.data;
  }

  async sendManifest(res: Response, manifest: string) {
    res.set("Content-Type", "application/vnd.apple.mpegurl");
    
    res.header("Access-Control-Allow-Headers", "Range");
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Expose-Headers", "Content-Length, Content-Range");

    res.send(Buffer.from(manifest, "utf-8"));
  }

  private resolveStreamURL(stream?: string): string {
    if (!stream) {
      return streams.BigBuckBunny;
    }
    return streams[stream] ?? stream;
  }

  private resolveRelativeUrl(relativeURL: string, streamURL: string) {
    // Use URL constructor to properly resolve relative paths
    return new URL(relativeURL, streamURL).toString();
  }

  private getCacheKey(url: string, variant?: number): string {
    const name = variant ?? 'master';
    const hash = createHash('sha256').update(url).digest('hex');

    return `manifest/${hash}/${name}`;
  }
}
