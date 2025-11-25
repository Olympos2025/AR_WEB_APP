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
1. Enable Pages from the repository settings, target the `dist` folder on the `main` branch or use GitHub Actions.
2. Build locally and push `dist/`, or create a Pages workflow:
```
name: Deploy
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

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
