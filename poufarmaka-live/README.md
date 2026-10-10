# Farmakeia (PouFarmaka Vercel frontend)

This directory serves `https://poufarmaka.vercel.app` from the existing Express Vercel project. Other applications in the repository are independent and unchanged.

The visual identity draws on Greek printed guides, shop signs and modernist graphics around 1960. It uses warm paper, bottle-green pharmacy lettering, restrained ochre, double rules and original geometric neighbourhood artwork. GFS Didot and GFS Neohellenic are contemporary digital revivals of established Greek types; Noto Sans keeps small controls readable. The design is an interpretation, not a reproduction or a claim that the service existed in 1960.

Visual references inspected:
- Frederick Vincent Carabott, Greek Tourist Board poster, 1961: https://a-g-i.org/design/griechenland
- M. Katsourakis, Athens Festival poster, 1960 (photolithography): https://vergosauctions.com/index.php/auctions/detail/category/4/auction/3702/item/24029
- Original Athens street/shop photograph from the 1960s: https://www.greecetravel.com/photos/sixties/athens1/PhotoAlbum1/mikras-asias029_jpg_view.htm
- Greek Font Society type histories: https://www.greekfontsociety-gfs.gr/typefaces/20th_21st_century

No reference photograph or poster is reproduced in the app. `public/neighborhood.svg` and `public/pharmacy-mark.svg` are original vector artwork. Motion is limited to short entrance transitions, button feedback and location/status pulses, with reduced-motion support. Dialog headings and close controls remain visible while their content scrolls. The redesign does not alter source data, search logic or native permission requests; the reported iOS Home Screen permission denial remains unverified on a physical device.

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

Home-screen location flow (PF-LOC-5): the first standalone launch waits for the location button. It calls `getCurrentPosition` synchronously from the tap and starts `watchPosition` only after the first successful fix. A local boolean remembers that standalone activation succeeded (no coordinates and no assumption that OS permission is still granted). Later launches resume automatically; denial or an explicit pause/manual origin clears that preference. Safari/browser startup behavior remains unchanged. Denial is final for that attempt, with no retry loop or alternative-origin workaround. This improves the permission-request flow but cannot override an iOS permission denial.
