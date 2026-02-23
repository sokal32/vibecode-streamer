import * as fs from 'fs';
import * as https from 'https';
import dotenv from 'dotenv';
import express from 'express';
import { Streamer } from './src/streamer';
import { register, requestsTotal, requestDuration, manifestRequestsTotal } from './src/metrics';

const app = express();
const streamer = new Streamer();

app.get('/live.m3u8', async (req, res) => {
  const stream = req.query.stream?.toString() ?? 'BigBuckBunny';
  const type = req.query.variant !== undefined ? 'variant' : 'master';
  const typeLabel = req.query.variant !== undefined ? `variant${req.query.variant}` : 'master';
  const endTimer = requestDuration.startTimer({ stream, endpoint: 'live', type });
  manifestRequestsTotal.inc({ endpoint: 'live', type: typeLabel });
  try {
    const variant = req.query.variant ? +req.query.variant : undefined;
    const start = req.query.start ? +req.query.start : Date.now();
    const now = req.query.now ? +req.query.now : Date.now();
    const windowSize = req.query.windowSize ? +req.query.windowSize : undefined;

    const manifest = await streamer.convertVODToLive(req.query.stream?.toString(), variant, start, now, windowSize);

    await streamer.sendManifest(res, manifest);
    requestsTotal.inc({ stream, endpoint: 'live', type, result: 'success' });
  } catch (error) {
    console.error('Error processing Live request:', error);
    res.status(500).send((error as Error).message);
    requestsTotal.inc({ stream, endpoint: 'live', type, result: 'error' });
  } finally {
    endTimer();
  }
});

app.get('/vod.m3u8', async (req, res) => {
  const stream = req.query.stream?.toString() ?? 'BigBuckBunny';
  const type = req.query.variant !== undefined ? 'variant' : 'master';
  const typeLabel = req.query.variant !== undefined ? `variant${req.query.variant}` : 'master';
  const endTimer = requestDuration.startTimer({ stream, endpoint: 'vod', type });
  manifestRequestsTotal.inc({ endpoint: 'vod', type: typeLabel });
  try {
    const variant = req.query.variant ? +req.query.variant : undefined;
    const duration = req.query.duration ? +req.query.duration : undefined;

    const manifest = await streamer.makeVOD(req.query.stream?.toString(), variant, duration);

    await streamer.sendManifest(res, manifest);
    requestsTotal.inc({ stream, endpoint: 'vod', type, result: 'success' });
  } catch (error) {
    console.error('Error processing VOD request:', error);
    res.status(500).send((error as Error).message);
    requestsTotal.inc({ stream, endpoint: 'vod', type, result: 'error' });
  } finally {
    endTimer();
  }
});

app.get('/health', (_req, res) => {
  res.sendStatus(200);
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

dotenv.config();

const port = process.env.PORT ? +process.env.PORT : 3000;
const isHTTPS = process.env.SSL !== '';

if (isHTTPS) {
  const options = process.env.SSL == '' ? {} : {
    key: fs.readFileSync(process.env.SSL_KEY_PATH || 'cert/key.pem'),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'cert/cert.pem'),
    passphrase: process.env.SSL_PASSPHRASE || undefined,
  };

  https.createServer(options, app).listen(port, () =>
    console.log(`HLS VOD-to-Live stream converter is running on port ${port}`)
  );
} else {
  app.listen(port, () =>
    console.log(`HLS VOD-to-Live stream converter is running on port ${port}`)
  );
}
