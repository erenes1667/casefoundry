# CaseFoundry 2026.8.7 artifact manifest

## macOS applications

| Artifact | Architecture | Size | SHA-256 |
|---|---|---:|---|
| `CaseFoundry-2026.8.7-arm64.zip` | Apple Silicon / Mach-O arm64 | 124,779,294 bytes | `c34024106b00ded0edaa4ffd6ed8f7308eb1ec5be6ab10523c03defe3eee8f27` |
| `CaseFoundry-2026.8.7-x64.zip` | Intel / Mach-O x86_64 | 126,899,030 bytes | `eba0714db7ed4d559bea4695dbb86a07d35119fd590447acc7299fe6804efcac` |

Both ZIP archives passed full `unzip -t` checks. Their app bundles contain:

- `Contents/MacOS/CaseFoundry`
- `Contents/Resources/app.asar`
- `Contents/Resources/icon.icns`
- `Contents/Resources/seed-phones.json`
- renderer entry point
- isolated preload bridge
- main process

Bundle identifier: `com.casefoundry.desktop`  
Application version: `2026.8.7`

## Verification

- 41 automated core tests passed.
- 52 donor-measurement, validation, export, and real Bambu Studio slicing gates passed.
- USB-C geometry reserves at least 7.0 mm of vertical cable-housing clearance.
- USB-C validation blocks phone records without a measured USB-C port.
- MagSafe insert geometry is layer-aligned and the real sliced plate G-code contains the insertion pause.
- Rear-camera overlap, undersized covers, invalid rings, and insufficient back thickness block export.
- Apple Silicon and Intel Mach-O architecture checks passed.
- The rebuilt Apple Silicon package launched successfully on macOS.
- Case Studio displayed the MagSafe controls, insertion-pause summary, all six artwork choices, and the USB-C clearance gate.
- Source and packaged application scans found no secrets or private-path references.
- The downloadable applications are unsigned and unnotarized.
