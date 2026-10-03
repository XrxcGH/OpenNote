# Pen corpus

Real pen recordings that two measurements share: the budget page of Phase 3, and measurement M2 of Phase 5. One set of data stands in for handwriting in both, so the size of a page and the cost of drawing it come from the same strokes.

Until recordings are added here, the generator in `tests/perf/core` draws synthetic handwriting that is shaped like a Surface Pen. When this folder holds recordings, the generator uses them instead, for the pen profile they name.

## Files

Each `*.pen.json` file holds the strokes of one recording session:

```json
{
  "profile": "surface_pen",
  "device": "Surface Laptop Studio 2 with Surface Pen",
  "strokes": [
    {"points": [[x, y, pressure, tiltX, tiltY, ms], [x, y, pressure, tiltX, tiltY, ms]]}
  ]
}
```

| Field | Meaning |
|---|---|
| `profile` | The pen profile the recording matches: `surface_pen`, `wacom`, or `fine_tilt`. Measurements that test another profile keep their synthetic strokes |
| `device` | A note for people about what recorded it |
| `points` | One array per report: `x` and `y` in page units, `pressure` from 0 to 1, `tiltX` and `tiltY` in degrees as Pointer Events report them, and `ms`, the milliseconds since the stroke's first point |

Record the values as the device reported them, before any pressure curve or smoothing, with the page at 100% zoom. Strokes need at least 2 points. The generator moves a stroke to where it writes, so the recorded position doesn't matter.

Record your own handwriting only, and don't write anything private. The files are committed to the repository.
