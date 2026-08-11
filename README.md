# CaseFoundry for macOS

CaseFoundry is an offline desktop workshop for maintaining evidence-backed phone geometry and turning it into printable case models. It combines a scalable local phone catalog, a canonical hardware-placement editor, a parametric solid engine, manufacturability checks, a live 3D preview, material tuning, and binary STL / multipart 3MF export.

This release is intentionally honest about certainty. The bundled S24+, S23 FE, A52s 5G, and A52 records are useful regression fixtures, but their hardware placement is reference-derived and their physical-fit state is `not-tested`. CaseFoundry never promotes them to fit-validated automatically.

## Install

Download the latest build from [GitHub Releases](https://github.com/erenes1667/casefoundry/releases/latest), then choose the archive that matches your Mac:

- `CaseFoundry-2026.8.3-arm64.zip`: Apple Silicon, including M1, M2, M3, M4, and later Apple chips.
- `CaseFoundry-2026.8.3-x64.zip`: Intel Macs.

Unzip the archive, move `CaseFoundry.app` to Applications, then right-click it and choose **Open** the first time.

The builds are not signed or notarized because that requires the owner's Apple Developer certificate on macOS. If Gatekeeper still blocks the app after right-clicking Open, remove only this app's quarantine attribute in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/CaseFoundry.app
```

Do not use that command on a broader folder.

## What is included

- Native macOS application bundles for Apple Silicon and Intel.
- Offline JSON database with atomic writes, recoverable backups, audit history, import, and export.
- Paged phone catalog designed for thousands of revisions.
- JSON and CSV phone-pack import with feature-level geometry and provenance.
- Canonical coordinates: `+X = screen-right`, `+Y = top`, `+Z = screen`.
- Measurement editor for body, camera, flash, buttons, ports, speakers, microphones, sources, and validation status.
- Rigid open-lip, TPU bumper, hybrid backplate, and translucent-art architectures.
- Plain, Asanoha Kumiko, reinforced Sakura, signal-garden, and contour-field artwork systems.
- Exterior engraving, sealed buried inlay, and vented construction modes.
- Real constructive-solid geometry with camera and hardware subtraction.
- Binary STL and multipart 3MF export.
- Separate shell and buried-art objects in sealed 3MF files.
- Material rules for solid PLA, PLA Silk, TPU 95A, PETG Basic, and translucent PETG.
- Bambu Lab P2S starting profiles for a 0.4 mm nozzle.
- Live DFM score, blocking export gates, and explicit physical-fit warnings.
- Small camera, controls, and bottom-port fit-coupon generator.
- Mandatory measured USB-C geometry with 7 mm clearance for the molded cable end.
- Regression runner that constructs, bounds-checks, triangulates, and serializes each bundled device.

## Recommended first workflow

1. Open **Phone Database** and select the exact phone revision.
2. Open **Measurement Lab** and check the model number, button side, camera envelope, and port placement.
3. Keep the record `reference-derived` unless you have stronger evidence.
4. Open **Case Studio**, choose the material, and press **Auto-tune material**.
5. Build the geometry and resolve any red preflight findings.
6. Export **Fit coupons** before printing the full case.
7. Test the coupon on the physical phone.
8. Record the result in **Measurement Lab**. Only then mark Physical fit as Passed.
9. Export 3MF for Bambu Studio. Use STL when a single-material mesh is enough.

## The button-side rule

CaseFoundry stores hardware in a handset-fixed coordinate system. `screenRight` means the physical right edge while looking at the screen. A rear view naturally mirrors that edge visually, but the stored X value and generated cutout do not swap.

Rigid materials automatically use one open control-side notch. They do not generate a sidewall bridge over the buttons. Covered buttons are available only for the flexible TPU architecture.

## Translucent PETG artwork

The translucent-art preset uses:

- 1.70 mm walls
- 1.35 mm backplate
- 0.40 mm buried artwork
- approximately 0.32 mm continuous exterior skin
- at least approximately 0.60 mm phone-facing skin
- separate named shell and artwork objects in 3MF

Assign translucent PETG to the shell and a compatible opaque PETG to the artwork object. Do not assume PLA will bond reliably when buried inside PETG. FDM PETG can look clear and deep when dry, slow, hot, and printed with aligned solid paths, but it will not become optical glass.

## Bundled print profiles

The profiles are practical starting points, not guaranteed machine presets. Calibrate flow ratio and pressure advance, dry the filament, clean the plate, and inspect the first layer. Refer to [PRINT_GUIDE.md](docs/PRINT_GUIDE.md) for the exact included values and preparation notes.

## Phone packs

CaseFoundry can merge a JSON or CSV phone pack in one atomic transaction. JSON can be an array of phone records or an object containing a `phones` array. CSV carries body columns plus `featuresJson` and `sourcesJson` cells so feature-level evidence survives round trips.

See [PHONE_PACK_SCHEMA.md](docs/PHONE_PACK_SCHEMA.md) for the field contract, coordinate rules, confidence guidance, and example.

## Local data

The database lives in Electron's macOS application-data folder and is shown inside **Settings**. CaseFoundry writes a temporary file and renames it atomically. It also creates recoverable timestamped backups before full imports and resets.

There is no account, telemetry, or cloud dependency.

## Security and privacy

CaseFoundry keeps phone records and projects in the local macOS application-data directory. The app does not require credentials and does not include analytics or telemetry. Donor discovery requests public MakerWorld search metadata, then opens model pages in the user's browser instead of downloading gated files.

Do not commit exported databases, private phone packs, signing certificates, or local configuration. Report suspected vulnerabilities through this repository's private vulnerability-reporting form rather than a public issue.

## Development

Requirements: Node.js 22 or later and npm.

```bash
npm install
npm test
npm run build
npm run dev
```

Cross-package unsigned macOS ZIPs:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac
```

Generate reference exports:

```bash
npm run export:references
```

## Verification performed for this release

- TypeScript typecheck passed.
- Vite production build passed.
- Nineteen automated core database and geometry tests passed.
- Forty-six donor-measurement, validation, export, and real-slicer gate tests passed.
- The screen-right control-notch test probes both physical sides and confirms material is removed only on the intended edge.
- All four bundled phone fixtures construct as positive solids.
- Binary STL export passed.
- Multipart sealed-art 3MF export passed and opens as a valid ZIP/OPC package.
- The fit-coupon set is smaller than the full case and exports as non-empty geometry.
- Both macOS ZIP archives passed full archive-integrity checks.
- Apple Silicon bundle contains a Mach-O `arm64` executable.
- Intel bundle contains a Mach-O `x86_64` executable.
- Both bundles contain the renderer, preload, main process, icon, and seed catalog.

The Apple Silicon package was launched on macOS after packaging. Its Case Studio preflight displayed the enforced 7.0 mm USB-C cable clearance. The downloadable applications remain unsigned and unnotarized.

## License

CaseFoundry source code is available under the [MIT License](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency and
interoperability-data notices.
