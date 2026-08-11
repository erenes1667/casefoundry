# CaseFoundry phone-pack schema

## Canonical axes

Coordinates are handset-fixed and never depend on the current preview camera:

| Axis | Positive direction | Zero |
|---|---|---|
| X | Physical screen-right | Body centerline |
| Y | Top of the handset | Body midpoint |
| Z | Toward the screen | Nominal back plane |

When the handset is shown from the rear, X appears mirrored visually. Do not negate feature X values when switching between screen and rear views.

## Required record fields

```json
{
  "id": "samsung-galaxy-example-sm-x000",
  "brand": "Samsung",
  "model": "Galaxy Example",
  "variant": "SM-X000 family",
  "modelNumbers": ["SM-X000B"],
  "chassisFamily": "galaxy-example",
  "releaseYear": 2026,
  "revision": 1,
  "status": "provisional",
  "confidence": 25,
  "dimensions": {
    "width": 75.0,
    "length": 158.0,
    "depth": 8.0,
    "cornerRadius": 9.0
  },
  "features": [],
  "sources": [],
  "validation": {
    "geometry": "not-run",
    "slice": "not-run",
    "physicalFit": "not-tested"
  },
  "tags": ["imported"],
  "notes": "Feature placement still needs measurement.",
  "createdAt": "2026-08-08T00:00:00.000Z",
  "updatedAt": "2026-08-08T00:00:00.000Z"
}
```

Body width, length, and depth must be positive. A missing status becomes `provisional`, and a missing confidence becomes 25.

## Feature record

```json
{
  "id": "example-volume",
  "name": "Volume rocker",
  "kind": "button",
  "side": "screenRight",
  "shape": "slot",
  "center": { "x": 37.5, "y": 29.0, "z": 5.0 },
  "size": { "x": 1.2, "y": 21.0, "z": 3.0 },
  "confidence": 82,
  "notes": "Measured from lower edge to center."
}
```

Supported feature kinds:

- `camera`
- `cameraIsland`
- `flash`
- `button`
- `port`
- `speaker`
- `microphone`
- `simTray`
- `sPen`
- `coil`
- `antenna`
- `other`

Supported sides: `back`, `screen`, `screenLeft`, `screenRight`, `top`, and `bottom`.

Supported shapes: `circle`, `slot`, `rect`, and `roundedRect`.

Every exportable phone record must include a measured USB-C `port` feature on
the `top` or `bottom` side. CaseFoundry reserves a minimum 7 mm vertical opening
around that feature for the cable's molded plug housing, including when the end
of the case is otherwise open.

## Sources

Every measurement source has a type and grade:

```json
{
  "id": "source-physical-001",
  "title": "Caliper measurement, handset serial recorded internally",
  "kind": "physical-measurement",
  "grade": "A"
}
```

Source kinds are `manufacturer`, `licensed-cad`, `physical-measurement`, `calibrated-scan`, `reference-mesh`, `community`, and `inference`.

Suggested grades:

| Grade | Meaning |
|---|---|
| A | Manufacturer dimension, licensed CAD, or controlled physical measurement |
| B | Calibrated reference mesh or repeatable measurement with clear provenance |
| C | Strong community measurement or compatibility inference |
| D | Unconfirmed visual estimate |

## Evidence status

| Status | Use |
|---|---|
| `production-ready` | Exact revision has passed geometry, slicing, repeated physical fit, and production review |
| `fit-validated` | Exact revision has a recorded physical-fit pass |
| `reference-derived` | Placement comes from a supplied/reference mesh |
| `measured` | Placement has physical or calibrated measurement but may not have a fit print |
| `sourced` | Body or feature data is supported by published sources |
| `compatibility-candidate` | Shared chassis is plausible but not physically proven |
| `provisional` | Incomplete or low-confidence draft |

`physicalFit: passed` must refer to the exact chassis revision. A matching outer dimension is not enough.

## CSV columns

The app exports and imports these columns:

```text
id,brand,model,variant,modelNumbers,chassisFamily,releaseYear,revision,status,confidence,width,length,depth,cornerRadius,tags,featuresJson,sourcesJson,notes
```

Use `|` or `;` between model numbers and tags. `featuresJson` and `sourcesJson` contain JSON arrays escaped as ordinary CSV cells.

## Scaling to thousands

Import large packs through **Phone Database → Import pack**. The renderer validates the pack first, then the main process writes all records in one transaction and appends one audit event. Search and display are paged in groups of 50 to avoid rendering the whole catalog at once.
