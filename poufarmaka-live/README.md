# Farmakeia (PouFarmaka Vercel frontend)

This directory serves `https://poufarmaka.vercel.app` from the existing Express Vercel project. Other applications in the repository are independent and unchanged.

The original night visual design is retained. Pharmacy wordmarks and pharmacy indicators use green; the surrounding dark navy, pink/cyan accents, typography, sunset stripes and motion remain.

Functionality ported from the Sites Farmakeia app (source version 18, commit aff5a0046063f1ef128ae8c0cc263a3a523c0c3e):
- Automatic 5 → 10 → 50 km search, no manual city or radius controls.
- Address suggestions; manual map origin; city source selected internally.
- Native first position request, continuous foreground movement, follow/pause, manual origin cancellation, home-screen/browser help without bypassing permission.
- Fresh verified time intervals in Europe/Athens, overnight duties, custom time and hospital specialties.
- Actual route-time ranking with distance fallback and optional natural-language preference recognition through the existing API.
- Dark OSM tiles and EOX Sentinel-2 cloudless 2024 satellite imagery with attribution. Satellite is noncommercial CC BY-NC-SA 4.0, not live imagery.
- Small intro, separate location frame, readable popups, distinct cards, route summary outside the map and reduced-motion support.

`server.js` continues to proxy the original Sites APIs. The existing data collector and schedule remain there; no new credentials, duplicated ingestion or data sources are introduced. The frontend does not store location history.

Run `npm test` (Node standard library, no installed dependencies needed). To run the server use the existing Express dependency and `npm start`.

Location tests use simulated native callbacks. Actual iOS Safari/Edge/home-screen permissions require device testing; no permission override is claimed.
