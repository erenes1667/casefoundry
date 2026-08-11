# CaseFoundry 2026.8 release notes

## Product surface

- Complete offline macOS desktop application.
- Native Apple Silicon and Intel bundles.
- Evidence-backed phone catalog with revision, source, confidence, validation, tags, and audit history.
- Bulk JSON / CSV phone-pack workflow suitable for thousands of records.
- Full body and hardware measurement editor.
- Canonical coordinate diagrams with explicit rear-view mirroring.
- Parametric case generator and interactive WebGL preview.
- Material-aware architecture tuning and blocking DFM gates.
- Real binary STL and multipart 3MF export.
- Fit-coupon export for camera, controls, and bottom ports.
- A measured USB-C feature is required, with a 7 mm minimum cable-housing opening.
- Local backup, database import/export, and recovery reset.

## Geometry safeguards

- Rigid button enclosure bridges are blocked.
- The rigid control side is one open notch.
- Top and bottom openings preserve protective corners.
- USB-C keeps its 7 mm cable approach clearance even when the bottom is open.
- Camera cutouts use individual lenses/flash or a measured camera island.
- Artwork is clipped to edge margins and camera keepouts.
- Sakura uses reinforced filled petals and centers.
- Asanoha strokes are clamped to a printable nozzle-aware width.
- Sealed artwork stays between continuous exterior and phone-facing skins.
- Export is blocked below material wall, backplate, or residual-skin floors.

## Bundled phone fixtures

- Samsung Galaxy S24+, SM-S926 family.
- Samsung Galaxy S23 FE, SM-S711 family.
- Samsung Galaxy A52s 5G, SM-A528 family.
- Samsung Galaxy A52 / A52 5G compatibility candidate.

Body dimensions include manufacturer evidence. Hardware placement is reference-derived. None of the bundled records claims a physical-fit pass.

## Verification

- 19 automated core tests passed.
- 46 donor-measurement, validation, export, and real-slicer gate tests passed.
- 4/4 bundled phone solids passed construction and positive-bounds checks.
- Physical screen-right button notch probe passed.
- Wrong-side material-presence control probe passed.
- Binary STL serialization passed.
- Multipart 3MF package serialization passed.
- Fit-coupon size and export checks passed.
- Apple Silicon and Intel archive integrity passed.
- Mach-O architecture checks passed.

## Known operational limitation

The downloadable apps are unsigned. Apple signing and notarization require the user's Apple Developer certificate and must be performed on macOS. Use right-click Open for the first launch or follow the narrow quarantine-removal command in the README.
