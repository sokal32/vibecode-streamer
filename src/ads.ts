import { createTag, type MediaSegment } from './m3u8';

export interface AdConfig {
  mode: 'interval' | 'ts';
  duration: number;       // ad break duration in seconds
  interval?: number;      // interval mode: seconds between ad break starts
  timestamps?: number[];  // ts mode: ad break start times in seconds
}

export function parseAdParam(param: string): AdConfig {
  const parts = param.split(',');
  const mode = parts[0];

  if (mode === 'interval') {
    return {
      mode: 'interval',
      duration: parseFloat(parts[1]),
      interval: parseFloat(parts[2]),
    };
  }

  if (mode === 'ts') {
    return {
      mode: 'ts',
      duration: parseFloat(parts[1]),
      timestamps: parts.slice(2).map(parseTimestamp),
    };
  }

  throw new Error(`Unknown ad mode: ${mode}`);
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/**
 * Get all ad break start times that overlap with the segment window [windowStart, windowEnd)
 */
function getAdBreakStarts(config: AdConfig, windowStart: number, windowEnd: number): number[] {
  if (config.mode === 'ts') {
    return (config.timestamps || []).filter(t =>
      t < windowEnd && (t + config.duration) > windowStart
    );
  }

  // Interval mode: breaks at interval, 2*interval, 3*interval, ...
  const starts: number[] = [];
  let t = config.interval!;

  while (t < windowEnd) {
    if ((t + config.duration) > windowStart) {
      starts.push(t);
    }
    t += config.interval!;
  }

  return starts;
}

/**
 * Inject SCTE ad break tags (EXT-X-CUE-OUT/CONT/IN) into segments.
 * Mutates the segments array in place.
 *
 * @param segments - Playlist segments to inject into
 * @param config - Ad break configuration
 * @param startOffset - Absolute playback time (seconds) of the first segment
 */
export function injectAdBreaks(segments: MediaSegment[], config: AdConfig, startOffset: number): void {
  if (!segments.length) return;

  const windowDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const adBreakStarts = getAdBreakStarts(config, startOffset, startOffset + windowDuration);
  if (!adBreakStarts.length) return;

  let currentTime = startOffset;
  let prevInAd = false;

  for (const segment of segments) {
    const segStart = currentTime;

    // Find which ad break (if any) this segment falls into
    let activeAd: number | null = null;
    for (const adStart of adBreakStarts) {
      if (segStart >= adStart - 0.001 && segStart < adStart + config.duration) {
        activeAd = adStart;
        break;
      }
    }

    if (activeAd !== null) {
      const elapsed = segStart - activeAd;

      if (elapsed < 0.001) {
        // First segment of ad break
        segment.tags = [createTag('EXT-X-CUE-OUT', config.duration.toString()), ...segment.tags];
      } else {
        // Continuation within ad break
        segment.tags = [createTag('EXT-X-CUE-OUT-CONT', `${elapsed.toFixed(1)}/${config.duration}`), ...segment.tags];
      }
      prevInAd = true;
    } else {
      if (prevInAd) {
        // Previous segment was in ad, this one isn't — return to content
        segment.tags = [createTag('EXT-X-CUE-IN'), ...segment.tags];
      }
      prevInAd = false;
    }

    currentTime += segment.duration;
  }
}
