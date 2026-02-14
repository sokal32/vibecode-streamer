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

### Using with Video.js

```html
<!DOCTYPE html>
<html>
<head>
  <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
</head>
<body>
  <video id="my-video" class="video-js" controls preload="auto" width="640" height="264">
    <source src="http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0" type="application/x-mpegURL">
  </video>

  <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
  <script>
    var player = videojs('my-video');
  </script>
</body>
</html>
```

### Using with FFmpeg

```bash
# Play live stream
ffplay "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0"

# Record live stream to file
ffmpeg -i "http://localhost:3000/live.m3u8?stream=BigBuckBunny&variant=0" \
  -c copy output.mp4
```

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

## Architecture

### Project Structure

```
streamer/
├── src/
│   ├── streamer.ts      # Core streaming logic
│   └── m3u8.ts          # M3U8 parser and encoder
├── streams.ts           # Predefined test streams
├── main.ts              # Express server setup
└── package.json
```

### Key Components

- **Streamer Class** ([src/streamer.ts](src/streamer.ts)) - Main logic for VOD and live conversion
- **M3U8 Parser** ([src/m3u8.ts](src/m3u8.ts)) - Handles parsing and encoding of M3U8 playlists
- **Express Server** ([main.ts](main.ts)) - HTTP API endpoints

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |

## Testing

Run the test suite:

```bash
npm test
```

## SSL

To play stream in browser you need to enable HTTPS.
You need to enable it in `.env` by setting `SSL=1` and optionally paths and passphrase (`SSL_KEY_PATH`, `SSL_CERT_PATH`, `SSL_PASSPHRASE`).
You can use your own key/cert or generate it with `openssl`:

```bash
mkdir cert
cd cert
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -sha256 -days 365
```

## Limitations

- Audio-only streams are not fully supported in master manifest generation (see TODO in [src/streamer.ts:32](src/streamer.ts#L32))
- Caching is in-memory only (will not persist across restarts)
- No authentication or rate limiting included

## Contributing

This project demonstrates AI-assisted development. Contributions are welcome to enhance functionality, add features, or improve documentation.

## License

CC-BY-4.0

## Credits

- Test streams provided by [Mux](https://mux.com/) - https://test-streams.mux.dev/
- Developed through collaborative effort between human direction and AI code generation
