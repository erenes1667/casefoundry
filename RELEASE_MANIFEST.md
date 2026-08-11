# CaseFoundry 2026.8.3 artifact manifest

## macOS applications

| Artifact | Architecture | Size | SHA-256 |
|---|---|---:|---|
| `CaseFoundry-2026.8.3-arm64.zip` | Apple Silicon / Mach-O arm64 | 124,772,816 bytes | `9bf956c5ab3791fb490415444b4fdf198e7a706dbd63ce5381ded26c68b65e2d` |
| `CaseFoundry-2026.8.3-x64.zip` | Intel / Mach-O x86_64 | 126,892,552 bytes | `ce4cdcfd8ac4e9d5c583ce04bf536a8497f452737d3fed413da10279f1ad5a26` |

Both ZIP archives passed full `unzip -t` checks. Their app bundles contain:

- `Contents/MacOS/CaseFoundry`
- `Contents/Resources/app.asar`
- `Contents/Resources/icon.icns`
- `Contents/Resources/seed-phones.json`
- renderer entry point
- isolated preload bridge
- main process

Bundle identifier: `com.casefoundry.desktop`  
Application version: `2026.8.3`

## Verification

- 19 automated core tests passed.
- 46 donor-measurement, validation, export, and real Bambu Studio slicing gates passed.
- USB-C geometry reserves at least 7.0 mm of vertical cable-housing clearance.
- USB-C validation blocks phone records without a measured USB-C port.
- Apple Silicon and Intel Mach-O architecture checks passed.
- The rebuilt Apple Silicon package launched successfully on macOS.
- Case Studio displayed the USB-C clearance gate as passed.
- Source and packaged application scans found no secrets or private-path references.
- The downloadable applications are unsigned and unnotarized.
