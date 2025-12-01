# FieldAR

Mobile-first web app for visualizing KML/KMZ geospatial data in location-based AR using A-Frame + AR.js. Built with Vite + TypeScript, TailwindCSS, and MapLibre GL for a 2D fallback map.

## Features
- Load KML or KMZ files locally (no uploads) and render in AR.
- Location-based overlays with manual styling controls, transparency, and simplification.
- GPS accuracy and heading indicators with alignment controls and height offset.
- 2D MapLibre fallback when permissions are denied.
- Multi-language UI (Greek default, English available).
- Example dataset in `examples/sample.kml` for quick testing.

## Getting Started
```
npm install
npm run dev
```
Open the printed HTTPS tunnel or localhost URL in a modern browser. AR sensors require HTTPS on mobile.

### Dependency note
- KML parsing bundles `@tmcw/togeojson@5.0.1` from npm, so installs must include this dependency but no external CDN access is required at runtime.

### Live URL
- After you push to GitHub and let the Pages workflow run, the app will be available at `https://<your-username>.github.io/<repository-name>/` (example: `https://example.github.io/fieldar-web-ar/`).

#### Quick deploy commands
```bash
git remote add origin https://github.com/<your-username>/<repository-name>.git
git branch -M main
git push -u origin main
# then enable GitHub Pages → Source: GitHub Actions (if not already enabled)
```

### Building
```
npm run build
```
The static assets are emitted to `dist/` and can be served as-is from any HTTPS host.

### Testing
```
npm test
```
Runs unit tests for geometry helpers and simplification.

## Deployment
### GitHub Pages
1. Push this repository to GitHub (e.g., `fieldar-web-ar`) and enable Pages → **Source: GitHub Actions**.
2. The included workflow `.github/workflows/deploy.yml` will build and publish `dist/` automatically on each push to `main`.
3. After the first successful run, your live URL will be `https://<your-username>.github.io/<repository-name>/` (for example `https://example.github.io/fieldar-web-ar/`).

### Netlify
```
netlify init
netlify deploy --prod --dir=dist
```

### Vercel
```
vercel
```

## HTTPS Requirement
Camera, geolocation, and orientation APIs only work on secure origins. Host the built `dist/` directory on HTTPS and open the public URL on your device (iOS Safari 15+ or Android Chrome).

## Project Structure
- `src/ui/` – React UI components.
- `src/ar/` – AR scene helpers and renderer hook.
- `src/geo/` – Geometry helpers, simplification, and KML/KMZ loader.
- `src/i18n/` – Translation JSON files.
- `examples/` – Sample KML for quick load.
