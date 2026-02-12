import express from 'express';
import { Streamer } from './src/streamer';

const app = express();
const streamer = new Streamer();

app.get('/live.m3u8', async (req, res) => {
  try {
    const stream = req.query.stream?.toString();
    const variant = req.query.variant ? +req.query.variant : undefined;
    const start = req.query.start ? +req.query.start : Date.now();
    const now = req.query.now ? +req.query.now : Date.now();
    const windowSize = req.query.windowSize ? +req.query.windowSize : undefined;

    const manifest = await streamer.convertVODToLive(stream, variant, start, now, windowSize);

    await streamer.sendManifest(res, manifest);
  } catch (error) {
    console.error('Error processing Live request:', error);
    res.status(500).send((error as Error).message);
  }
});

app.get('/vod.m3u8', async (req, res) => {
  try {
    const stream = req.query.stream?.toString();
    const variant = req.query.variant ? +req.query.variant : undefined;
    const duration = req.query.duration ? +req.query.duration : undefined;

    const manifest = await streamer.makeVOD(stream, variant, duration);
    
    await streamer.sendManifest(res, manifest);
  } catch (error) {
    console.error('Error processing VOD request:', error);
    res.status(500).send((error as Error).message);
  }
});

app.get('/health', (_req, res) => {
  res.sendStatus(200);
});

const port = process.env.PORT ? +process.env.PORT : 3000;

app.listen(port, () => {
  console.log(`HLS VOD-to-Live stream converter is running on port ${port}`);
});
