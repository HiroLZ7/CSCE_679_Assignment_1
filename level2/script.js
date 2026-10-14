const DATA_URL = "../temperature_daily.csv";
const YEAR_COUNT = 10;
const chartBox = { width: 100, height: 60, left: 4, right: 4, top: 5, bottom: 5 };
const parseDate = d3.utcParse("%Y-%m-%d");
const formatDate = d3.utcFormat("%b %-d, %Y");
const xScale = d3.scaleLinear([1, 31], [chartBox.left, chartBox.width - chartBox.right]);
let yScale = d3.scaleLinear([0, 40], [chartBox.height - chartBox.bottom, chartBox.top]);

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const state = {
  years: [],
  months: new Map(),
  domain: [0, 40],
  heatMetric: "max",
  heatBounds: { max: [0, 1], min: [0, 1] },
  heatScales: {},
  visible: { max: true, min: true },
  pinnedKey: null,
};

const heatPalettes = {
  max: ["#fffaf0", "#fde5c4", "#f5c0a7", "#e99788"],
  min: ["#f4fbfb", "#d7eff0", "#a6d9da", "#7dbfc3"],
};

const matrix = d3.select("#matrix");
const tooltip = d3.select("#tooltip");
const reading = d3.select("#active-reading");

function groupRows(rows) {
  const groups = d3.group(rows, (row) => `${row.year}-${String(row.month).padStart(2, "0")}`);
  for (const [key, values] of groups) groups.set(key, d3.sort(values, (row) => row.day));
  return groups;
}

function monthlyValue(rows, metric) {
  if (!rows.length) return null;
  return metric === "max"
    ? d3.max(rows, (row) => row.max)
    : d3.min(rows, (row) => row.min);
}

function heatColor(value, metric) {
  return state.heatScales[metric](value);
}

function xPosition(day) {
  return xScale(day);
}

function yPosition(value) {
  return yScale(value);
}

function consecutiveSegments(rows) {
  if (!rows.length) return [];
  const segments = [[rows[0]]];
  for (let index = 1; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows[index - 1];
    if (current.day === previous.day + 1) segments.at(-1).push(current);
    else segments.push([current]);
  }
  return segments;
}

function pathFor(rows, metric) {
  return d3.line().x((row) => xScale(row.day)).y((row) => yScale(row[metric]))(rows);
}

function monthSummary(rows, year, month) {
  if (!rows.length) return `${monthNames[month - 1]} ${year}: no observations`;
  const highest = d3.max(rows, (row) => row.max);
  const lowest = d3.min(rows, (row) => row.min);
  return `${monthNames[month - 1]} ${year}: ${rows.length} days, maximum range up to ${highest} degrees Celsius, minimum range down to ${lowest} degrees Celsius`;
}

function makeMiniChart(year, month) {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const rows = state.months.get(key) || [];
  const expectedDays = new Date(year, month, 0).getDate();
  const isPartial = rows.length > 0 && rows.length < expectedDays;
  const buttonSelection = d3
    .create("button")
    .attr("type", "button")
    .attr("class", `mini-chart${isPartial ? " is-partial" : ""}${rows.length ? "" : " is-missing"}`)
    .attr("data-key", key)
    .attr("aria-label", monthSummary(rows, year, month));
  if (rows.length) {
    buttonSelection.style("background-color", heatColor(monthlyValue(rows, state.heatMetric), state.heatMetric));
  }

  const chart = buttonSelection
    .append("svg")
    .attr("viewBox", `0 0 ${chartBox.width} ${chartBox.height}`)
    .attr("role", "img")
    .attr("aria-hidden", "true");

  if (!rows.length) {
    chart.append("text").attr("x", 50).attr("y", 33).attr("class", "no-data-text").text("No data");
    return buttonSelection.node();
  }

  const midpoint = (state.domain[0] + state.domain[1]) / 2;
  chart
    .append("line")
    .attr("x1", chartBox.left)
    .attr("x2", chartBox.width - chartBox.right)
    .attr("y1", yScale(midpoint))
    .attr("y2", yScale(midpoint))
    .attr("class", "gridline");

  const segments = consecutiveSegments(rows);
  chart
    .selectAll("path.max-line")
    .data(segments)
    .join("path")
    .attr("d", (segment) => pathFor(segment, "max"))
    .attr("class", "max-line");
  chart
    .selectAll("path.min-line")
    .data(segments)
    .join("path")
    .attr("d", (segment) => pathFor(segment, "min"))
    .attr("class", "min-line");

  const guide = chart
    .append("line")
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", chartBox.top)
    .attr("y2", chartBox.height - chartBox.bottom)
    .attr("class", "hover-guide")
    .attr("visibility", "hidden")
    .attr("data-chart-hover-guide", "");
  const maxMarker = chart
    .append("circle")
    .attr("r", 2.8)
    .attr("class", "max-marker")
    .attr("visibility", "hidden")
    .attr("data-chart-hover-marker", "");
  const minMarker = chart
    .append("circle")
    .attr("r", 2.8)
    .attr("class", "min-marker")
    .attr("visibility", "hidden")
    .attr("data-chart-hover-marker", "");
  const hoverLayer = chart
    .append("rect")
    .attr("x", chartBox.left)
    .attr("y", chartBox.top)
    .attr("width", chartBox.width - chartBox.left - chartBox.right)
    .attr("height", chartBox.height - chartBox.top - chartBox.bottom)
    .attr("class", "hover-layer")
    .attr("data-chart-hit", "")
    .attr("data-chart-hover-overlay", "cross-series");

  const showDay = (row, event) => {
    const x = xScale(row.day);
    guide.attr("x1", x).attr("x2", x).attr("visibility", "visible");
    maxMarker.attr("cx", x).attr("cy", yScale(row.max)).attr("visibility", "visible");
    minMarker.attr("cx", x).attr("cy", yScale(row.min)).attr("visibility", "visible");
    showTooltip(row, rows.length, expectedDays, event, buttonSelection.node());
    updateReading(row);
  };

  const bisectDay = d3.bisector((row) => row.day).center;
  hoverLayer.on("pointermove", (event) => {
    const pointerX = d3.pointer(event, hoverLayer.node())[0];
    const targetDay = xScale.invert(pointerX);
    showDay(rows[bisectDay(rows, targetDay)], event);
  });

  buttonSelection
    .on("pointerleave", () => {
      if (state.pinnedKey !== key) {
        hideInspection(guide, maxMarker, minMarker);
        hideTooltip();
        resetReading();
      }
    })
    .on("focus", () => showDay(rows[0], null))
    .on("blur", () => {
      if (state.pinnedKey !== key) {
        hideInspection(guide, maxMarker, minMarker);
        hideTooltip();
        resetReading();
      }
    })
    .on("click", () => {
      const wasPinned = state.pinnedKey === key;
      state.pinnedKey = wasPinned ? null : key;
      d3.selectAll(".mini-chart").classed("is-pinned", function () {
        return this.dataset.key === state.pinnedKey;
      });
      if (wasPinned) {
        hideInspection(guide, maxMarker, minMarker);
        hideTooltip();
        resetReading();
      }
    });

  return buttonSelection.node();
}

function hideInspection(guide, maxMarker, minMarker) {
  guide.attr("visibility", "hidden");
  maxMarker.attr("visibility", "hidden");
  minMarker.attr("visibility", "hidden");
}

function formattedDate(row) {
  return formatDate(row.dateObject);
}

function tooltipMarkup(row, observedDays, expectedDays) {
  const coverage = observedDays < expectedDays ? `Partial month · ${observedDays}/${expectedDays} days` : `${observedDays} daily observations`;
  const spread = row.max - row.min;
  return [
    `<strong>${formattedDate(row)}</strong>`,
    `<span class="tooltip-meta">${coverage}</span>`,
    state.visible.max ? `<span class="tooltip-max">Maximum ${row.max} °C</span>` : "",
    state.visible.min ? `<span class="tooltip-min">Minimum ${row.min} °C</span>` : "",
    state.visible.max && state.visible.min ? `<span class="tooltip-meta">Daily range ${spread} °C</span>` : "",
  ].join("");
}

function showTooltip(row, observedDays, expectedDays, event, anchor) {
  tooltip.html(tooltipMarkup(row, observedDays, expectedDays)).attr("hidden", null);
  const anchorRect = anchor.getBoundingClientRect();
  const x = event?.clientX || anchorRect.left + anchorRect.width / 2;
  const y = event?.clientY || anchorRect.top + anchorRect.height / 2;
  positionTooltip(x, y);
}

function positionTooltip(x, y) {
  const rect = tooltip.node().getBoundingClientRect();
  const gap = 12;
  const left = Math.min(window.innerWidth - rect.width - 10, Math.max(10, x + gap));
  const preferredTop = y - rect.height - gap;
  const top = preferredTop > 8 ? preferredTop : y + gap;
  tooltip.style("left", `${left}px`).style("top", `${top}px`);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function updateReading(row) {
  const parts = [`${formattedDate(row)}`];
  if (state.visible.max) parts.push(`max ${row.max} °C`);
  if (state.visible.min) parts.push(`min ${row.min} °C`);
  if (state.visible.max && state.visible.min) parts.push(`range ${row.max - row.min} °C`);
  reading.text(parts.join(" · "));
}

function resetReading() {
  reading.text("Hover or focus a month to inspect its daily values.");
}

function renderMatrix() {
  const items = [
    { type: "label", className: "corner-label", text: "Month ↓ · Year →", key: "corner" },
    ...state.years.map((year) => ({ type: "label", className: "year-label", text: year, key: `year-${year}` })),
  ];
  monthNames.forEach((monthName, monthIndex) => {
    items.push({ type: "label", className: "month-label", text: monthName.slice(0, 3), key: `month-${monthIndex + 1}` });
    state.years.forEach((year) => {
      items.push({ type: "chart", year, month: monthIndex + 1, key: `${year}-${monthIndex + 1}` });
    });
  });

  matrix
    .selectAll(":scope > .matrix-item")
    .data(items, (item) => item.key)
    .join((enter) => enter.append((item) => {
      if (item.type === "chart") return makeMiniChart(item.year, item.month);
      const label = document.createElement("div");
      label.className = item.className;
      label.textContent = item.text;
      return label;
    }))
    .classed("matrix-item", true);
}

function updateSeriesVisibility() {
  matrix.classed("hide-max", !state.visible.max).classed("hide-min", !state.visible.min);
}

function renderHeatLegend() {
  const metric = state.heatMetric;
  const [low, high] = state.heatBounds[metric];
  d3.select("#heat-legend-label").text(`Monthly ${metric === "max" ? "maximum" : "minimum"} temperature`);
  d3.select("#heat-legend-scale").style("background", `linear-gradient(90deg, ${heatPalettes[metric].join(", ")})`);
  d3
    .select("#heat-legend-ticks")
    .selectAll("span")
    .data(d3.range(5).map((index) => low + ((high - low) * index) / 4))
    .join("span")
    .text((value) => `${Math.round(value)}°`);
}

function updateHeatMetric(metric) {
  state.heatMetric = metric;
  d3.selectAll(".metric-button")
    .classed("is-active", function () { return this.dataset.heatMetric === metric; })
    .attr("aria-pressed", function () { return String(this.dataset.heatMetric === metric); });
  d3.selectAll(".mini-chart:not(.is-missing)")
    .transition()
    .duration(220)
    .style("background-color", function () {
      const rows = state.months.get(this.dataset.key) || [];
      return heatColor(monthlyValue(rows, metric), metric);
    });
  renderHeatLegend();
}

async function init() {
  try {
    const rows = await d3.csv(DATA_URL, (row) => {
      const dateObject = parseDate(row.date);
      return {
        date: row.date,
        dateObject,
        year: dateObject.getUTCFullYear(),
        month: dateObject.getUTCMonth() + 1,
        day: dateObject.getUTCDate(),
        max: +row.max_temperature,
        min: +row.min_temperature,
      };
    });
    const lastYear = d3.max(rows, (row) => row.year);
    const firstYear = lastYear - YEAR_COUNT + 1;
    const focusedRows = rows.filter((row) => row.year >= firstYear && row.year <= lastYear);
    const values = focusedRows.flatMap((row) => [row.min, row.max]);
    const [observedLow, observedHigh] = d3.extent(values);
    const domainLow = Math.floor((observedLow - 2) / 5) * 5;
    const domainHigh = Math.ceil((observedHigh + 2) / 5) * 5;

    state.years = d3.range(firstYear, lastYear + 1);
    state.months = groupRows(focusedRows);
    state.domain = [domainLow, domainHigh];
    yScale = d3.scaleLinear(state.domain, [chartBox.height - chartBox.bottom, chartBox.top]);
    const monthlyMaxima = [...state.months.values()].map((monthRows) => monthlyValue(monthRows, "max"));
    const monthlyMinima = [...state.months.values()].map((monthRows) => monthlyValue(monthRows, "min"));
    state.heatBounds.max = d3.extent(monthlyMaxima);
    state.heatBounds.min = d3.extent(monthlyMinima);
    for (const metric of ["max", "min"]) {
      const [low, high] = state.heatBounds[metric];
      const palette = heatPalettes[metric];
      const domain = d3.range(palette.length).map((index) => low + ((high - low) * index) / (palette.length - 1));
      state.heatScales[metric] = d3.scaleLinear(domain, palette).interpolate(d3.interpolateRgb).clamp(true);
    }

    d3.select("#scale-note").text(`Shared y-scale ${domainLow}–${domainHigh} °C`);
    const partialMonths = d3.sum([...state.months.entries()], ([key, monthRows]) => {
      const [year, month] = key.split("-").map(Number);
      return monthRows.length < new Date(year, month, 0).getDate() ? 1 : 0;
    });
    const matrixMonths = YEAR_COUNT * 12;
    const missingMonths = matrixMonths - state.months.size;
    d3.select("#data-note").text([
      `${focusedRows.length.toLocaleString()} daily records from ${firstYear}–${lastYear}.`,
      `${partialMonths} partial months use dashed borders; ${missingMonths} months with no observations are striped.`,
    ].join(" "));

    renderMatrix();
    updateSeriesVisibility();
    renderHeatLegend();
  } catch (error) {
    reading.text(`${error.message} Run the project from a local web server.`).attr("role", "alert");
  }
}

d3.selectAll(".legend-item").on("click", function () {
    const series = this.dataset.series;
    const otherSeries = series === "max" ? "min" : "max";
    if (state.visible[series] && !state.visible[otherSeries]) return;
    state.visible[series] = !state.visible[series];
    d3.select(this).attr("aria-pressed", String(state.visible[series]));
    updateSeriesVisibility();
    hideTooltip();
    resetReading();
});

d3.selectAll(".metric-button").on("click", function () {
  updateHeatMetric(this.dataset.heatMetric);
});

init();
