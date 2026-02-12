/**
 * M3U8 Parser and Encoder Library
 * Supports both Master Playlists and Media Playlists
 * Preserves all attributes exactly as provided
 */

// ============================================================================
// Types
// ============================================================================

export interface M3U8Playlist {
  type: 'master' | 'media';
  version?: number;
  independentSegments?: boolean;
  tags: Tag[];
  segments?: MediaSegment[];
  variants?: Variant[];
  url?: string;
}

export interface Tag {
  name: string;
  value?: string;
  attributes?: Record<string, string>;
  rawLine: string;
}

export interface MediaSegment {
  duration: number;
  title?: string;
  uri: string;
  byteRange?: string;
  discontinuity?: boolean;
  key?: EncryptionKey;
  map?: MediaInitSection;
  programDateTime?: string;
  dateRange?: DateRange;
  tags: Tag[];
}

export interface Variant {
  uri: string;
  bandwidth: number;
  averageBandwidth?: number;
  codecs?: string;
  resolution?: string;
  frameRate?: number;
  hdcpLevel?: string;
  audio?: string;
  video?: string;
  subtitles?: string;
  closedCaptions?: string;
  programId?: number;
  attributes: Record<string, string>;
  tags: Tag[];
}

export interface EncryptionKey {
  method: string;
  uri?: string;
  iv?: string;
  keyFormat?: string;
  keyFormatVersions?: string;
  attributes: Record<string, string>;
}

export interface MediaInitSection {
  uri: string;
  byteRange?: string;
  attributes: Record<string, string>;
}

export interface DateRange {
  id: string;
  classId?: string;
  startDate: string;
  endDate?: string;
  duration?: number;
  plannedDuration?: number;
  attributes: Record<string, string>;
}

// ============================================================================
// Parser
// ============================================================================

export function parseM3U8(content: string): M3U8Playlist {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (!lines[0]?.startsWith('#EXTM3U')) {
    throw new Error('Invalid M3U8: must start with #EXTM3U');
  }

  const playlist: M3U8Playlist = {
    type: 'media',
    tags: [],
  };

  let currentSegment: Partial<MediaSegment> | null = null;
  let currentVariant: Partial<Variant> | null = null;
  let segmentTags: Tag[] = [];
  let variantTags: Tag[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith('#')) {
      // URI line
      if (currentSegment) {
        // Media segment URI
        currentSegment.uri = line;
        playlist.segments = playlist.segments || [];
        playlist.segments.push(currentSegment as MediaSegment);
        currentSegment = null;
        segmentTags = [];
      } else if (currentVariant) {
        // Variant stream URI
        currentVariant.uri = line;
        playlist.variants = playlist.variants || [];
        playlist.variants.push(currentVariant as Variant);
        currentVariant = null;
        variantTags = [];
      }
      continue;
    }

    const tag = parseTag(line);

    // Handle playlist-level tags
    if (tag.name === 'EXT-X-VERSION') {
      playlist.version = parseInt(tag.value || '1', 10);
      playlist.tags.push(tag);
    } else if (tag.name === 'EXT-X-INDEPENDENT-SEGMENTS') {
      playlist.independentSegments = true;
      playlist.tags.push(tag);
    } else if (tag.name === 'EXT-X-STREAM-INF') {
      // Master playlist variant
      playlist.type = 'master';
      const attrs = tag.attributes || {};
      currentVariant = {
        bandwidth: parseInt(attrs.BANDWIDTH || '0', 10),
        averageBandwidth: attrs['AVERAGE-BANDWIDTH'] ? parseInt(attrs['AVERAGE-BANDWIDTH'], 10) : undefined,
        codecs: attrs.CODECS,
        resolution: attrs.RESOLUTION,
        frameRate: attrs['FRAME-RATE'] ? parseFloat(attrs['FRAME-RATE']) : undefined,
        hdcpLevel: attrs['HDCP-LEVEL'],
        audio: attrs.AUDIO,
        video: attrs.VIDEO,
        subtitles: attrs.SUBTITLES,
        closedCaptions: attrs['CLOSED-CAPTIONS'],
        programId: attrs['PROGRAM-ID'] ? parseInt(attrs['PROGRAM-ID'], 10) : undefined,
        attributes: attrs,
        tags: [...variantTags, tag],
        uri: '',
      };
      variantTags = [];
    } else if (tag.name === 'EXTINF') {
      // Media segment
      currentSegment = {
        duration: parseFloat(tag.value?.split(',')[0] || '0'),
        title: tag.value?.split(',').slice(1).join(',') || undefined,
        tags: [...segmentTags, tag],
        uri: '',
      };
      segmentTags = [];
    } else if (tag.name === 'EXT-X-BYTERANGE') {
      if (currentSegment) {
        currentSegment.byteRange = tag.value;
        currentSegment.tags?.push(tag);
      } else {
        segmentTags.push(tag);
      }
    } else if (tag.name === 'EXT-X-DISCONTINUITY') {
      if (currentSegment) {
        currentSegment.discontinuity = true;
        currentSegment.tags?.push(tag);
      } else {
        segmentTags.push(tag);
      }
    } else if (tag.name === 'EXT-X-KEY') {
      const attrs = tag.attributes || {};
      const key: EncryptionKey = {
        method: attrs.METHOD || 'NONE',
        uri: attrs.URI,
        iv: attrs.IV,
        keyFormat: attrs.KEYFORMAT,
        keyFormatVersions: attrs.KEYFORMATVERSIONS,
        attributes: attrs,
      };
      if (currentSegment) {
        currentSegment.key = key;
        currentSegment.tags?.push(tag);
      } else {
        segmentTags.push(tag);
      }
    } else if (tag.name === 'EXT-X-MAP') {
      const attrs = tag.attributes || {};
      const map: MediaInitSection = {
        uri: attrs.URI || '',
        byteRange: attrs.BYTERANGE,
        attributes: attrs,
      };
      if (currentSegment) {
        currentSegment.map = map;
        currentSegment.tags?.push(tag);
      } else {
        segmentTags.push(tag);
      }
    } else if (tag.name === 'EXT-X-PROGRAM-DATE-TIME') {
      if (currentSegment) {
        currentSegment.programDateTime = tag.value;
        currentSegment.tags?.push(tag);
      } else {
        segmentTags.push(tag);
      }
    } else if (tag.name === 'EXT-X-DATERANGE') {
      const attrs = tag.attributes || {};
      const dateRange: DateRange = {
        id: attrs.ID || '',
        classId: attrs.CLASS,
        startDate: attrs['START-DATE'] || '',
        endDate: attrs['END-DATE'],
        duration: attrs.DURATION ? parseFloat(attrs.DURATION) : undefined,
        plannedDuration: attrs['PLANNED-DURATION'] ? parseFloat(attrs['PLANNED-DURATION']) : undefined,
        attributes: attrs,
      };
      if (currentSegment) {
        currentSegment.dateRange = dateRange;
        currentSegment.tags?.push(tag);
      } else {
        segmentTags.push(tag);
      }
    } else if (tag.name === 'EXT-X-MEDIA') {
      // Media rendition (master playlist)
      playlist.type = 'master';
      playlist.tags.push(tag);
    } else if (currentVariant) {
      variantTags.push(tag);
    } else if (currentSegment) {
      currentSegment.tags?.push(tag);
    } else {
      // Check if this is a segment-level tag that should be stored for next segment
      if (isSegmentLevelTag(tag.name)) {
        segmentTags.push(tag);
      } else if (isVariantLevelTag(tag.name)) {
        variantTags.push(tag);
      } else {
        playlist.tags.push(tag);
      }
    }
  }

  return playlist;
}

function parseTag(line: string): Tag {
  const colonIndex = line.indexOf(':');

  if (colonIndex === -1) {
    return {
      name: line.substring(1),
      rawLine: line,
    };
  }

  const name = line.substring(1, colonIndex);
  const valueStr = line.substring(colonIndex + 1);

  // Check if the value contains attributes
  if (hasAttributes(valueStr)) {
    const attributes = parseAttributes(valueStr);
    return {
      name,
      attributes,
      rawLine: line,
    };
  }

  return {
    name,
    value: valueStr,
    rawLine: line,
  };
}

function hasAttributes(value: string): boolean {
  return /[A-Z0-9\-]+=/i.test(value);
}

function parseAttributes(attrStr: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let currentKey = '';
  let currentValue = '';
  let inQuotes = false;
  let i = 0;

  while (i < attrStr.length) {
    const char = attrStr[i];

    if (!currentKey) {
      // Looking for key
      const equalIndex = attrStr.indexOf('=', i);
      if (equalIndex === -1) break;

      currentKey = attrStr.substring(i, equalIndex).trim();
      i = equalIndex + 1;
      continue;
    }

    // Reading value
    if (char === '"' && !inQuotes) {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === '"' && inQuotes) {
      inQuotes = false;
      attributes[currentKey] = currentValue;
      currentKey = '';
      currentValue = '';
      i++;
      // Skip comma and whitespace
      while (i < attrStr.length && (attrStr[i] === ',' || attrStr[i] === ' ')) {
        i++;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      if (currentKey) {
        attributes[currentKey] = currentValue;
        currentKey = '';
        currentValue = '';
      }
      i++;
      // Skip whitespace
      while (i < attrStr.length && attrStr[i] === ' ') {
        i++;
      }
      continue;
    }

    currentValue += char;
    i++;
  }

  if (currentKey && currentValue) {
    attributes[currentKey] = currentValue;
  }

  return attributes;
}

function isSegmentLevelTag(name: string): boolean {
  return [
    'EXT-X-KEY',
    'EXT-X-MAP',
    'EXT-X-PROGRAM-DATE-TIME',
    'EXT-X-DATERANGE',
  ].includes(name);
}

function isVariantLevelTag(name: string): boolean {
  return [
    'EXT-X-I-FRAME-STREAM-INF',
  ].includes(name);
}

// ============================================================================
// Encoder
// ============================================================================

export function encodeM3U8(playlist: M3U8Playlist): string {
  const lines: string[] = ['#EXTM3U'];

  // Add playlist-level tags
  for (const tag of playlist.tags) {
    lines.push(tag.rawLine);
  }

  if (playlist.type === 'master' && playlist.variants) {
    // Encode master playlist
    for (const variant of playlist.variants) {
      for (const tag of variant.tags) {
        lines.push(tag.rawLine);
      }
      lines.push(variant.uri);
    }
  } else if (playlist.type === 'media' && playlist.segments) {
    // Encode media playlist
    for (const segment of playlist.segments) {
      for (const tag of segment.tags) {
        lines.push(tag.rawLine);
      }
      lines.push(segment.uri);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Utility Functions
// ============================================================================

export function encodeAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([key, value]) => {
      // Quote values if they contain special characters or are specific types
      if (needsQuotes(key, value)) {
        return `${key}="${value}"`;
      }
      return `${key}=${value}`;
    })
    .join(',');
}

function needsQuotes(key: string, value: string): boolean {
  // These attributes typically need quotes
  const quotedAttributes = ['URI', 'CODECS', 'AUDIO', 'VIDEO', 'SUBTITLES', 'CLOSED-CAPTIONS', 'NAME', 'GROUP-ID', 'LANGUAGE', 'STABLE-VARIANT-ID', 'ID', 'CLASS', 'START-DATE', 'END-DATE'];

  if (quotedAttributes.includes(key)) {
    return true;
  }

  // Quote if value contains special characters
  return /[,\s":]/.test(value);
}

export function createTag(name: string, value?: string, attributes?: Record<string, string>): Tag {
  let rawLine = `#${name}`;

  if (attributes) {
    rawLine += `:${encodeAttributes(attributes)}`;
  } else if (value !== undefined) {
    rawLine += `:${value}`;
  }

  return {
    name,
    value,
    attributes,
    rawLine,
  };
}

// ============================================================================
// Helper Functions for Modifying Playlists
// ============================================================================

export function updateTagAttribute(tag: Tag, key: string, value: string): Tag {
  if (!tag.attributes) {
    tag.attributes = {};
  }

  tag.attributes[key] = value;

  // Rebuild rawLine
  if (tag.attributes) {
    tag.rawLine = `#${tag.name}:${encodeAttributes(tag.attributes)}`;
  }

  return tag;
}

export function updateTagValue(tag: Tag, value: string): Tag {
  tag.value = value;
  tag.rawLine = `#${tag.name}:${value}`;
  return tag;
}

export function findTag(tags: Tag[], name: string): Tag | undefined {
  return tags.find(tag => tag.name === name);
}

export function filterTags(tags: Tag[], name: string): Tag[] {
  return tags.filter(tag => tag.name === name);
}

export function updateOrAddTag(manifest: M3U8Playlist, name: string, value?: string): void {
  const tag = manifest.tags.find(t => t.name === name);
  if (tag) {
    tag.value = value;
    tag.rawLine = value !== undefined ? `#${name}:${value}` : `#${name}`;
  } else {
    manifest.tags.push(createTag(name, value));
  }
}
