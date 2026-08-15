# CaseFoundry print guide

## First rule: print the fit coupons

The fit-coupon export contains three small test regions:

- camera envelope and protective corner
- open control-side notch
- bottom ports and edge opening

Print these before a decorative full case. Check camera clearance, button click access, cable insertion, speaker clearance, corner retention, and removal. Record the exact handset model number and fit result in Measurement Lab.

## Bambu Lab P2S starting profiles

All values assume a 0.4 mm nozzle.

| Material | Layer | Nozzle | Bed | Walls | Outer wall | First layer | Cooling |
|---|---:|---:|---:|---:|---:|---:|---|
| PLA Solid | 0.16 mm | 220 °C | 55 °C | 3 | 60 mm/s | 20 mm/s | 0% for 2 layers, then 80–100% |
| PLA Silk | 0.16 mm | 225 °C | 55 °C | 4 | 45 mm/s | 18 mm/s | 0% for 2 layers, then 70–90% |
| PETG Basic | 0.16 mm | 255 °C | 70 °C | 4 | 45 mm/s | 18 mm/s | 20–50%, bridges 80% |
| PETG Translucent | 0.10 mm | 260 °C | 70 °C | 1 | 18 mm/s | 15 mm/s | 0–20%, bridges 50% |
| TPU 95A | 0.20 mm | 230 °C | 40 °C | 4 | 30 mm/s | 15 mm/s | 40–70% |

These are starting points. A filament manufacturer's temperature range and a calibrated printer profile take priority.

## General preparation

- Dry PETG and TPU before printing. Translucent PETG is especially sensitive to moisture bubbles.
- Wash the plate with dish soap and water, then avoid touching the print area.
- Use a thin release layer on Smooth PEI for PETG.
- Print back-flat with the exterior face on the build plate.
- Inspect the first layer before leaving the machine.
- Use a brim only when your plate condition or artwork mode needs it. Sealed artwork starts on a continuous shell skin and normally avoids loose motif islands.
- Verify flow ratio and pressure advance for the exact filament.

## PLA and PLA Silk

Rigid PLA cases use the open-lip architecture. The top, bottom, and control side have open reliefs, and the screen retention is limited to protected corner clips. Covered control bridges are blocked.

PLA Silk has weaker layer bonding than ordinary PLA. CaseFoundry auto-tunes it to 2.0 mm walls, a 1.9 mm back, a 0.32 mm artwork depth, and four print-profile walls.

## PETG Basic

PETG Basic is a good rigid case material when you want more impact tolerance than PLA. The included case preset uses 1.8 mm walls and a 1.7 mm back. Keep the filament dry and avoid excessive fan outside bridges.

## Translucent PETG

For the best depth effect:

- use the sealed buried-inlay construction
- use 1.55 mm back thickness and 0.40 mm artwork depth
- keep the shell and inlay as separate 3MF objects
- assign translucent PETG to the shell
- assign compatible opaque PETG to the inlay
- use aligned solid paths, slow extrusion, low cooling, and dry filament
- avoid a PLA inlay inside a PETG shell

The result can look luminous and layered, but FDM layer interfaces and surface texture prevent true optical-glass clarity.

## Embedded MagSafe-compatible ring

Use the measured dimensions of the exact ring you will install. The default pocket is for a 56 mm outside diameter, 46 mm inside diameter, and 1.0 mm thick insert, with 0.25 mm radial clearance and 0.20 mm vertical clearance.

- Export 3MF. STL cannot carry the insertion pause.
- Print back-flat with the exterior face on the plate.
- Keep the ring away from the printer until the pause.
- Confirm polarity before placement.
- Press the ring fully into the open pocket. It must sit below the sealing layer.
- Remove loose adhesive liner, metal fragments, and debris before resuming.
- Resume only after confirming the nozzle path is unobstructed.

CaseFoundry aligns the cavity boundaries to the active layer height and pauses before the first layer that closes the phone-facing cover. The bundled phone records do not claim measured charging-coil positions, so center alignment remains a physical verification step.

Decorative builds reserve a clean annular frame around the insert and place one enlarged matching motif inside the ring. The background field does not run underneath the pocket.

## TPU 95A

Use an external spool path appropriate for flexible filament and keep volumetric speed conservative. The TPU architecture can use covered button pads because the wall can flex. Confirm button pressure with the fit coupon.

## Artwork modes

| Mode | Construction | Phone-facing surface | First-layer behavior |
|---|---|---|---|
| Sealed | Buried cavity plus separate inlay | Continuous | Continuous shell skin |
| Engraved | Shallow exterior subtraction | Continuous | Motifs are recessed; reinforced filled geometry avoids hairline solids |
| Vented | Through-cut | Open to phone | Highest dust and first-layer risk |

## Bambu Studio import

Prefer 3MF for sealed art and embedded inserts. It contains named shell and artwork objects, real process settings, and the insertion pause when enabled. Import as one assembly if prompted, assign materials per object, keep the objects aligned at their original coordinates, and slice back-flat.

STL is a single merged solid. It is useful for one-material printing but cannot preserve a separate inlay material assignment.
