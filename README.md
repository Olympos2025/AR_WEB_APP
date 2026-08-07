# FieldAR

Mobile-first web AR για γεωχωρικά δεδομένα: φόρτωσε **KML, KMZ, GeoJSON, GPX ή Shapefile** και δες σημεία, γραμμές και πολύγωνα — με όλη τη γεωμετρία τους (κορυφές/nodes) — μέσα από την κάμερα του κινητού, τοποθετημένα στις πραγματικές τους συντεταγμένες. Τρέχει σε browser (iOS Safari, Android Chrome, tablets) χωρίς εγκατάσταση εφαρμογής.

## Δυνατότητες

- **Φόρτωση αρχείων πολλών μορφών**: KML, KMZ, GeoJSON/JSON, GPX, Shapefile (`.zip` ή επιλογή `.shp+.dbf+.prj` μαζί).
  - Αναπροβολή συντεταγμένων μέσω proj4: shapefile με `.prj`, GeoJSON με δηλωμένο CRS, και **αυτόματη αναγνώριση ΕΓΣΑ87 (EPSG:2100)** για ελληνικά δεδομένα.
- **Πραγματικό 3D AR** (Three.js): η κάμερα του κινητού + GPS + αισθητήρες προσανατολισμού προβάλλουν κάθε κορυφή της γεωμετρίας σε σωστή προοπτική. Πολύγωνα με γέμισμα/περίγραμμα/τρύπες, γραμμές με όλα τα nodes, σημεία με pin και markers κορυφών.
- **Λογαριασμοί χρηστών**: εγγραφή/σύνδεση· κάθε αρχείο που φορτώνεις αποθηκεύεται στον λογαριασμό σου και ξαναφορτώνεται από τη λίστα «Αποθηκευμένα αρχεία».
  - Με τον included Node server: πραγματικοί λογαριασμοί (JWT) κοινοί σε όλες τις συσκευές.
  - Σε στατικό hosting (π.χ. GitHub Pages): αυτόματο fallback σε τοπικό λογαριασμό συσκευής (IndexedDB).
- **Πίνακας layers**: ορατότητα, χρώματα γεμίσματος/περιγράμματος/γραμμών/σημείων, αδιαφάνεια ανά layer, πάχη, μέγεθος σημείων, **ετικέτες on/off με επιλογή πεδίου (στήλης)**, χρώμα/μέγεθος ετικέτας, εστίαση στον χάρτη.
- **Υπόβαθρα μέσα στο AR (πιλοτικό)**: street map (OSM), τοπογραφικό (OpenTopoMap) ή δορυφορικό (Esri) «στρωμένο» στο έδαφος γύρω από τον χρήστη, με ρύθμιση διαφάνειας.
- **2D χάρτης** (MapLibre) με τα ίδια layers/συμβολισμούς και επιλογή υποβάθρου, για έλεγχο πριν βγεις στο πεδίο.
- **Βαθμονόμηση AR**: διόρθωση πυξίδας ±180°, υψομετρική μετατόπιση, οπτικό πεδίο κάμερας, χρήση/παράβλεψη υψομέτρων αρχείου.
- Ελληνικό UI (προεπιλογή) + Αγγλικά.

## Γρήγορη εκκίνηση

```bash
npm install
npm run dev          # μόνο frontend (τοπικοί λογαριασμοί συσκευής)
```

Με πλήρεις λογαριασμούς server:

```bash
npm run start        # build + Node server στο http://localhost:8080
# ή ξεχωριστά: npm run build && npm run server
```

Άνοιξε τη διεύθυνση σε κινητό μέσω **HTTPS** (βλ. παρακάτω) — οι αισθητήρες απαιτούν secure context.

## Χρήση στο πεδίο

1. Φόρτωσε τα αρχεία σου (κουμπί «Φόρτωση γεωχωρικών αρχείων» — για shapefile επίλεξε το `.zip` ή μαζί τα `.shp`, `.dbf`, `.prj`).
2. Έλεγξε τη θέση τους στον 2D χάρτη και ρύθμισε συμβολισμό/ετικέτες από τον πίνακα layers.
3. Πάτα «Έναρξη AR» και δώσε άδειες για κάμερα, τοποθεσία και αισθητήρες κίνησης.
4. Από τις «Ρυθμίσεις» μέσα στο AR: βαθμονόμησε την πυξίδα ώστε γνωστά σημεία να «κάθονται» σωστά, και ενεργοποίησε προαιρετικά υπόβαθρο AR.

> Ακρίβεια: εξαρτάται από το GPS του κινητού (τυπικά ±3–10 m) και την πυξίδα. Το slider βαθμονόμησης πυξίδας διορθώνει τη συστηματική απόκλιση επί τόπου.

---

# English

Browser-based location AR for geospatial files. Load **KML, KMZ, GeoJSON, GPX or Shapefile** and see every point, line and polygon — full geometry, all vertices — through the phone camera at its true coordinates. Works on iOS Safari and Android Chrome, phones and tablets, no app install.

## Architecture

- `src/geo/` – format loaders (KML/KMZ, GeoJSON, GPX, shapefile via shpjs), proj4 reprojection (EPSG:2100 heuristic for Greek data), geometry utils.
- `src/ar/` – Three.js AR engine: device-orientation quaternion camera, ENU world frame anchored at first GPS fix, per-vertex geometry building, screen-space label sprites, tiled basemap ground plane (pilot).
- `src/state/` – layer model (style, labels, visibility).
- `src/map/` – MapLibre 2D map with per-layer styling and label layers.
- `src/account/` – account abstraction: REST client (JWT) when the API responds, IndexedDB device-local fallback otherwise.
- `server/` – Express API (register/login, per-user layer storage as JSON on disk) that also serves the built frontend.

## Accounts & deployment modes

| Hosting | Accounts |
|---|---|
| `npm run start` (Node server, e.g. Render/Railway/Fly/VPS) | Real accounts, layers stored server-side, shared across devices |
| Static `dist/` (GitHub Pages, Netlify, Vercel) | Automatic fallback to device-local accounts (IndexedDB) |

To point a static frontend at a separately hosted API, set `VITE_API_URL` at build time:

```bash
VITE_API_URL=https://your-api.example.com npm run build
```

Server environment variables: `PORT` (default 8080), `JWT_SECRET` (auto-generated and persisted if unset), `FIELDAR_DATA_DIR` (default `server/data`).

## Building & testing

```bash
npm run build   # static assets in dist/
npm test        # vitest: geometry utils, loaders (EPSG:2100 reprojection), simplification
```

## Deployment

### GitHub Pages
Push to `main`; the workflow `.github/workflows/deploy.yml` builds and publishes `dist/` (accounts run in device-local mode).

### Node server
Deploy the repo to any Node 20+ host and run `npm run start`. The same process serves the app and the API over one origin.

## HTTPS requirement

Camera, geolocation and orientation sensors only work on secure origins. Use the deployed HTTPS URL on the device (or `localhost` during development). For quick phone testing against a dev machine, tunnel with e.g. `ngrok http 5173`.

## Basemap attribution

© OpenStreetMap contributors · © OpenTopoMap (CC-BY-SA) · © Esri & contributors · Dark Matter © CartoDB
