# HLS VOD-to-Live Stream Converter

> **Note:** This project is a collaborative effort between human creativity and AI assistance. The majority of the codebase was generated and refined through neural network collaboration, demonstrating the potential of human-AI pair programming.

A TypeScript application that converts HLS VOD (Video on Demand) streams into live streaming format. This tool allows you to simulate live streaming behavior from static VOD content by manipulating M3U8 playlists with proper media sequencing and discontinuity handling.

## Features

- **VOD-to-Live Conversion**: Transforms static VOD manifests into live streaming playlists
- **Multi-Variant Support**: Handles master playlists with multiple quality variants
- **Sliding Window**: Implements proper HLS sliding window mechanism for live streams
- **Discontinuity Handling**: Correctly manages discontinuity tags when looping content
- **Duration Control**: Extend or limit VOD content to specific durations
- **Manifest Caching**: Caches manifests for improved performance
- **CORS Enabled**: Supports cross-origin requests for web players
- **Ad Break Injection**: Insert SCTE-35 ad markers (CUE-OUT/CUE-IN) at fixed intervals or specific timestamps

## Test Streams

All test streams used in this repository are sourced from the [Mux test streams page](https://test-streams.mux.dev/). The following pre-configured streams are available:

- **BigBuckBunny** - Standard test stream
- **ARTEChina** - Alternative test content
- **DKTurntable** - PTS shifted by 2.3s
- **TearsOfSteal** - Includes IMSC Captions

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

## Installation

```bash
npm install
```

## Development

Start the development server with auto-reload:

```bash
npm run dev
```

The server will start on port 3000 by default (configurable via `PORT` environment variable).

## Production

Build the application:

```bash
npm run build
```

Start the production server:

```bash
npm start
```

## API Endpoints

### GET `/vod.m3u8`

Generate or manipulate a VOD (Video on Demand) manifest.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `stream` | string | Yes | Stream identifier (e.g., "BigBuckBunny") or full URL to HLS manifest |
| `variant` | number | No | Variant index for quality selection. If omitted, returns master manifest |
| `duration` | number | No | Target duration in seconds. Content will loop to fill duration if needed |
| `ad` | string | No | Ad break configuration (see [Ad Breaks](#ad-breaks) below) |

**Examples:**

```bash
# Get master manifest for BigBuckBunny
curl "http://localhost:3000/vod.m3u8?stream=BigBuckBunny"

# Get specific variant (variant 0) for BigBuckBunny
curl "http://localhost:3000/vod.m3u8?stream=BigBuckBunny&variant=0"

# Get 120-second duration VOD (will loop if original is shorter)
curl "http://localhost:3000/vod.m3u8?stream=BigBuckBunny&variant=0&duration=120"

# Use custom stream URL
curl "http://localhost:3000/vod.m3u8?stream=https://example.com/vod/master.m3u8"

# VOD with 15-second ad breaks every 30 seconds
curl "http://localhost:3000/vod.m3u8?stream=BigBuckBunny&variant=0&ad=interval,15,30"

# VOD with 20-second ad breaks at specific timestamps
curl "http://localhost:3000/vod.m3u8?stream=BigBuckBunny&variant=0&ad=ts,20,00:05:00,00:15:30"
```

**Response:**
- Content-Type: `application/vnd.apple.mpegurl`
- Body: M3U8 playlist with `EXT-X-ENDLIST` tag (VOD)

---

### GET `/live.m3u8`

Convert a VOD stream to live streaming format with sliding window behavior.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `stream` | string | Yes | Stream identifier (e.g., "BigBuckBunny") or full URL to HLS manifest |
| `variant` | number | No | Variant index for quality selection. If omitted, returns master manifest |
| `start` | number | No | Stream start timestamp in milliseconds (epoch). Defaults to current time |
| `now` | number | No | Current timestamp in milliseconds (epoch). Defaults to current time |
| `windowSize` | number | No | Number of segments in the sliding window (default: 3) |
| `ad` | string | No | Ad break configuration (see [Ad Breaks](#ad-breaks) below) |

**Examples:**

```bash
# Get live master manifest
curl "http://localhost:3000/live.m3u8?stream=BigBuckBunny"

# Get live variant with default sliding window
curl "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0"

# Simulate live stream that started 5 minutes ago
START_TIME=$(($(date +%s) * 1000 - 300000))
curl "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0&start=${START_TIME}"

# Custom window size (5 segments instead of default 3)
curl "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0&windowSize=5"

# Custom stream URL in live mode
curl "http://localhost:3000/live.m3u8?stream=https://example.com/vod/master.m3u8&variant=0"

# Live stream with 10-second ad breaks every 60 seconds
curl "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0&ad=interval,10,60"
```

**Response:**
- Content-Type: `application/vnd.apple.mpegurl`
- Body: M3U8 playlist with `EXT-X-MEDIA-SEQUENCE` and `EXT-X-DISCONTINUITY-SEQUENCE` tags (Live)

**Live Stream Behavior:**

The live endpoint simulates a live stream by:
1. Calculating elapsed time since `start` timestamp
2. Creating a sliding window of segments from the VOD content
3. Looping the VOD content with proper discontinuity markers
4. Updating `EXT-X-MEDIA-SEQUENCE` to reflect the current position
5. Omitting `EXT-X-ENDLIST` tag to indicate ongoing stream

---

### GET `/health`

Health check endpoint for monitoring and load balancers.

**Response:**
- Status: 200 OK

**Example:**

```bash
curl "http://localhost:3000/health"
```

## Usage Examples

### Using with FFmpeg

```bash
# Play live stream
ffplay "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0"

# Record live stream to file
ffmpeg -i "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0" \
  -c copy output.mp4
```

### Using with Video.js

```html
<!DOCTYPE html>
<html>
<head>
  <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
</head>
<body>
  <video id="my-video" class="video-js" controls preload="auto" width="640" height="264">
    <source src="https://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0" type="application/x-mpegURL">
  </video>

  <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
  <script>
    var player = videojs('my-video');
  </script>
</body>
</html>
```

> **Note:** This example uses `https://localhost` to work in browser environment, which requires SSL to be enabled. See [SSL configuration](#ssl-configuration) for setup instructions.

## How It Works

### VOD Mode

1. Fetches the master manifest from the source URL
2. Optionally fetches a specific variant manifest
3. If `duration` is specified, loops segments to reach target duration
4. Adds VOD-specific tags (`EXT-X-PLAYLIST-TYPE:VOD`, `EXT-X-ENDLIST`)
5. Returns the processed manifest

### Live Mode

1. Fetches the VOD manifest from the source
2. Calculates elapsed time since the `start` timestamp
3. Determines which segments should be in the current sliding window
4. Adds discontinuity tags when looping back to the beginning
5. Sets proper `EXT-X-MEDIA-SEQUENCE` and `EXT-X-DISCONTINUITY-SEQUENCE`
6. Removes VOD-specific tags to indicate live streaming
7. Returns a live manifest that updates over time

## Ad Breaks

The `ad` query parameter injects SCTE-35 style ad markers (`EXT-X-CUE-OUT`, `EXT-X-CUE-OUT-CONT`, `EXT-X-CUE-IN`) into both VOD and live playlists. This is useful for testing ad insertion workflows and SSAI (Server-Side Ad Insertion) integrations.

The parameter format is a comma-separated string. The first value selects the mode:

### Interval Mode

Insert ad breaks at regular intervals.

**Format:** `interval,<duration>,<interval>`

| Field | Description |
|-------|-------------|
| `duration` | Length of each ad break in seconds |
| `interval` | Seconds between ad break start times |

```bash
# 15-second ad break every 30 seconds
ad=interval,15,30
```

### Timestamp Mode

Insert ad breaks at specific times in the stream.

**Format:** `ts,<duration>,<time1>,<time2>,...`

| Field | Description |
|-------|-------------|
| `duration` | Length of each ad break in seconds |
| `timeN` | Ad break start time in `HH:MM:SS` format |

```bash
# 20-second ad breaks at 5 minutes and 15 minutes 30 seconds
ad=ts,20,00:05:00,00:15:30
```

### Generated Tags

The following HLS tags are injected into the segment playlist:

| Tag | When |
|-----|------|
| `#EXT-X-CUE-OUT:<duration>` | First segment of an ad break |
| `#EXT-X-CUE-OUT-CONT:<elapsed>/<duration>` | Continuation segments within the ad break |
| `#EXT-X-CUE-IN` | First segment after the ad break ends |

When requesting a master playlist with the `ad` parameter, variant URIs are automatically rewritten to include the ad configuration so that all variant requests carry the same ad breaks.

## Architecture

### Project Structure

```
streamer/
├── src/
│   ├── streamer.ts      # Core streaming logic
│   ├── m3u8.ts          # M3U8 parser and encoder
│   └── ads.ts           # Ad break injection (SCTE-35 markers)
├── tests/
│   └── ads.test.ts      # Ad break unit and integration tests
├── streams.ts           # Predefined test streams
├── main.ts              # Express server setup
└── package.json
```

### Key Components

- **Streamer Class** ([src/streamer.ts](src/streamer.ts)) - Main logic for VOD and live conversion
- **M3U8 Parser** ([src/m3u8.ts](src/m3u8.ts)) - Handles parsing and encoding of M3U8 playlists
- **Ad Breaks** ([src/ads.ts](src/ads.ts)) - Parses ad config and injects CUE-OUT/CUE-IN tags into segments
- **Express Server** ([main.ts](main.ts)) - HTTP API endpoints

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |

### SSL configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SSL` | Any non-empty value enables HTTPS; leave empty to disable | _(empty)_ |
| `SSL_KEY_PATH` | Path to the private key file | `cert/key.pem` |
| `SSL_CERT_PATH` | Path to the certificate file | `cert/cert.pem` |
| `SSL_PASSPHRASE` | Passphrase for the private key (if set during generation) | _(none)_ |

The Docker Compose setup runs with `SSL=` (disabled) since production deployments typically terminate TLS at a reverse proxy like nginx with Let's Encrypt.

### Generating a self-signed certificate (interactive mode)

```bash
mkdir ./cert
openssl req -x509 -newkey rsa:4096 -keyout cert/key.pem -out cert/cert.pem -sha256 -days 365
```

## Testing

Run the test suite:

```bash
npm test
```

Most browsers block mixed content and refuse to load HTTP streams on HTTPS pages. To test playback locally, the server supports HTTPS with a self-signed certificate.

## Limitations

- Caching is in-memory only (will not persist across restarts)
- No authentication or rate limiting included

## Contributing

This project demonstrates AI-assisted development. Contributions are welcome to enhance functionality, add features, or improve documentation.

## License

CC-BY-4.0

## Credits

- Test streams provided by [Mux](https://mux.com/) - https://test-streams.mux.dev/
- Developed through collaborative effort between human direction and AI code generation (Antrophic)
