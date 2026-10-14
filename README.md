# Temperature visualization

The project now opens with a chooser for two related visualizations:

- **Level 1** aggregates `temperature_daily.csv` into one heatmap cell per month and year.
- **Level 2** retains that monthly heat encoding and adds daily maximum and minimum lines inside each cell for 2008–2017.

Both visualizations use **D3.js v7.9.0** for CSV loading, data grouping, scales, color interpolation, SVG generation, and interaction updates. Level 1 uses D3 band scales and axes; Level 2 uses D3 linear scales, line generators, bisectors, and data joins for the small multiples.

## Run locally

From this folder, start any local static web server. For example:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) and choose a level.

- Level 1: [http://localhost:8000/level1/](http://localhost:8000/level1/)
- Level 2: [http://localhost:8000/level2/](http://localhost:8000/level2/)
