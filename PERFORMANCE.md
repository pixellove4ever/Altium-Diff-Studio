# Performance

The synthetic benchmark detects major regressions in the PCB engine without
depending on a confidential Altium project.

## Running

```bash
npm run test:performance
```

The scenario generates three PCB pairs:

|  Tracks | Content                                          |
| ------: | ------------------------------------------------ |
|  10,000 | Tracks spread across two layers plus 1,000 pads  |
|  50,000 | Tracks spread across two layers plus 5,000 pads  |
| 100,000 | Tracks spread across two layers plus 10,000 pads |

Every 997th track has a modified width in version B. The benchmark measures:

- the full PCB diff bundle
- geometry-bound computation and caching
- spatial-index construction
- 1,000 query batches over tracks and pads

## Indicative Baseline

Local measurement from 2026-07-03:

|  Tracks |     Diff | Bounds | Spatial index | 1,000 queries |
| ------: | -------: | -----: | ------------: | ------------: |
|  10,000 |  52.9 ms | 2.2 ms |        1.4 ms |        0.9 ms |
|  50,000 | 191.4 ms | 5.8 ms |        4.8 ms |        2.2 ms |
| 100,000 | 373.0 ms | 2.2 ms |       13.1 ms |        3.0 ms |

These values are not absolute targets. They vary with the machine, Node.js
version and system load. Automated thresholds are intentionally wider: they are
meant to catch order-of-magnitude regressions, not small millisecond changes.

## Regression Thresholds

|  Tracks | Max diff | Max index build |
| ------: | -------: | --------------: |
|  10,000 | 1,500 ms |        1,000 ms |
|  50,000 | 4,000 ms |        2,500 ms |
| 100,000 | 8,000 ms |        5,000 ms |

The 1,000 query batches must stay below 1,500 ms for each size.

## What This Benchmark Does Not Measure

- Canvas 2D and GPU cost
- JSON parsing and transfer
- Fidelity of Altium-sourced data
- Complex DXF performance
- Maximum memory consumption

Those points require a real regression set and profiling inside the Electron
application. In the advanced PCB tools, enable **Profile PCB rendering**, reset
the counters, then run zoom, pan, hover, net selection and slider scenarios
separately. The panel reports Canvas drawing and hover hit-testing separately,
including average, maximum, latest measurement and sample count.
