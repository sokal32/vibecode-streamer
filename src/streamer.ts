import type { Response } from "express";
import { createHash } from 'crypto';
import axios from "axios";
import { streams } from "../streams";
import { parseM3U8, encodeM3U8, createTag, type M3U8Playlist, type MediaSegment, updateOrAddTag, updateTagAttribute } from "./m3u8";

export class Streamer {
  private readonly defaultWindowSize = 3;

  private cache: Record<string, M3U8Playlist> = {};

  async makeVOD(stream?: string, variant?: number, duration?: number): Promise<string> {
    const streamURL = this.resolveStreamURL(stream);
    const manifest = await this.fetchManifest(streamURL, variant);

    return variant !== undefined
      ? this.fitVariant(manifest, duration)
      : this.generateMaster('vod', stream, manifest, 0, duration);
  }

  async convertVODToLive(stream?: string, variant?: number, start = Date.now(), now = Date.now(), windowSize = this.defaultWindowSize): Promise<string> {
    const streamURL = this.resolveStreamURL(stream);
    const manifest = await this.fetchManifest(streamURL, variant);

    return variant !== undefined
      ? this.shuffleVariant(manifest, start, now, windowSize)
      : this.generateMaster('live', stream, manifest, start);
  }

  // Replace variant and media rendition URIs with our links
  private generateMaster(type: 'vod' | 'live', stream: string | undefined, manifest: M3U8Playlist, start: number, duration?: number): string {
    const output = structuredClone(manifest);
    let index = 0;

    // Rewrite EXT-X-STREAM-INF variant URIs
    if (output.variants) {
      for (const playlist of output.variants) {
        playlist.uri = `/${type}.m3u8?${this.buildVariantQuery(index, stream, start, duration)}`;
        index++;
      }
    }

    // Rewrite EXT-X-MEDIA rendition URIs
    for (const tag of output.tags) {
      if (tag.name === 'EXT-X-MEDIA' && tag.attributes?.URI) {
        updateTagAttribute(tag, 'URI', `/${type}.m3u8?${this.buildVariantQuery(index, stream, start, duration)}`);
        index++;
      }
    }

    return encodeM3U8(output);
  }

  private buildVariantQuery(index: number, stream?: string, start?: number, duration?: number): string {
    const params = new URLSearchParams();

    params.append('variant', `${index}`);
    
    if (stream) params.append('stream', stream);
    if (start) params.append('start', `${start}`);
    if (duration) params.append('duration', `${duration}`);

    return params.toString();
  }

  // Generate VOD variant stream with optional specified duration
  private fitVariant(manifest: M3U8Playlist, duration?: number): string {
    // If we don't limit/extend duration or have empty segments list we just encode playlist as is
    if (!manifest.segments?.length || !duration) {
      return this.generateVODVariant(manifest);
    }

    const output = structuredClone(manifest);
    const vod = output.segments || [];
    const segments: MediaSegment[] = [];

    let accumulatedDuration = 0;
    let i = 0;

    // Build segment list until we reach or exceed the target duration
    while (accumulatedDuration < duration) {
      const segment = structuredClone(vod[i % vod.length]);

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

    output.segments = segments;

    return this.generateVODVariant(output);
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
    const output = structuredClone(manifest);
    const vod = manifest.segments || [];
    // Clamp window size to VOD length to avoid having fewer segments than expected
    const actualWindowSize = Math.min(windowSize, vod.length);
    const segments: MediaSegment[] = vod.slice(0, actualWindowSize).map(s => structuredClone(s));

    let nextTailIndex = actualWindowSize;
    let mediaSequence = 0;
    let discontinuitySequence = 0;
    let elapsed = (now - start) / 1000;

    while (elapsed > segments[0].duration) {
      const nextIdx = nextTailIndex % vod.length;
      const segment = structuredClone(vod[nextIdx]);

      // Handle discontinuity at the start of each VOD loop
      if (nextIdx === 0) {
        segment.discontinuity = true;
        segment.tags = [createTag('EXT-X-DISCONTINUITY'), ...(segment.tags || [])];
      }

      // Push next segment to tail and remove elapsed head (sliding window)
      segments.push(segment);

      const removed = segments.shift()!;
      if (removed.discontinuity) {
        discontinuitySequence++;
      }

      elapsed -= removed.duration;
      mediaSequence += 1;
      nextTailIndex += 1;
    }

    output.segments = segments;

    return this.generateVariant(output, mediaSequence, discontinuitySequence);
  }

  // Generate Live variant M3U8 playlist
  private generateVariant(manifest: M3U8Playlist, mediaSequence: number, discontinuitySequence: number) {
    if (!manifest.segments?.length) {
      return encodeM3U8(manifest);
    }

    const targetDuration = manifest.segments.reduce((max, { duration }) => Math.max(max, duration), 0);

    updateOrAddTag(manifest, 'EXT-X-TARGETDURATION', Math.ceil(targetDuration).toString());
    updateOrAddTag(manifest, 'EXT-X-MEDIA-SEQUENCE', mediaSequence.toString());
    updateOrAddTag(manifest, 'EXT-X-DISCONTINUITY-SEQUENCE', discontinuitySequence.toString());
    updateOrAddTag(manifest, 'EXT-X-START', 'TIME-OFFSET=0.0');

    // Remove VOD-specific tags
    manifest.tags = manifest.tags.filter(t => !['EXT-X-PLAYLIST-TYPE', 'EXT-X-ENDLIST'].includes(t.name));

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
      let master = this.cache[masterKey];
      if (!master) {
        const masterManifest = await this.downloadManifest(streamURL);
        master = parseM3U8(masterManifest);
        this.cache[masterKey] = master;
      }
      url = this.normalizeVariantURI(master, streamURL, variant);
    }

    const manifest = await this.downloadManifest(url);
    const parsed = parseM3U8(manifest);

    this.cache[targetKey] = parsed;

    parsed.segments?.forEach((segment) => this.normalizeSegmentURI(segment, url));

    return parsed;
  }

  private normalizeVariantURI(master: M3U8Playlist, streamURL: string, variant: number) {
    const variantCount = master.variants?.length ?? 0;
    const mediaTags = master.tags.filter(t => t.name === 'EXT-X-MEDIA' && t.attributes?.URI);

    if (variant < variantCount) {
      return this.normalizeRelativeURL(master.variants![variant].uri, streamURL);
    } else {
      const mediaTag = mediaTags[variant - variantCount];
      if (!mediaTag) {
        throw new Error(`Requested variant index is out of range (max: ${variantCount + mediaTags.length - 1})`);
      }
      return this.normalizeRelativeURL(mediaTag.attributes!.URI, streamURL);
    }
  }

  private normalizeSegmentURI(segment: MediaSegment, streamURL: string) {
    segment.uri = this.normalizeRelativeURL(segment.uri, streamURL);

    if (segment.map) {
      const resolved = this.normalizeRelativeURL(segment.map.uri, streamURL);
      const mapTag = segment.tags.find(t => t.name === 'EXT-X-MAP');
      if (mapTag) {
        updateTagAttribute(mapTag, 'URI', resolved);
      }
      segment.map.uri = resolved;
    }
  }

  private normalizeRelativeURL(relativeURL: string, streamURL: string) {
    return new URL(relativeURL, streamURL).toString();
  }

  private resolveStreamURL(stream?: string): string {
    if (!stream) {
      return streams.BigBuckBunny;
    }
    return streams[stream] ?? stream;
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

  private getCacheKey(url: string, variant?: number): string {
    const name = variant ?? 'master';
    const hash = createHash('sha256').update(url).digest('hex');

    return `${hash}-${name}`;
  }
}
