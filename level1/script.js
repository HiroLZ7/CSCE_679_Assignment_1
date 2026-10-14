const DATA_URL = "../temperature_daily.csv";
const parseDate = d3.utcParse("%Y-%m-%d");
const formatMonthKey = d3.utcFormat("%Y-%m");

const state = {
  metric: "max",
  monthly: [],
  monthMap: new Map(),
  years: [],
  selectedKey: null,
  bounds: { max: [0, 1], min: [0, 1] },
  colorScales: {},
};

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const palettes = {
  max: ["#fff3dd", "#efbd65", "#dc6f3b", "#7d2131"],
  min: ["#eef7f5", "#9bcac4", "#3f8f91", "#164f63"],
};

const copy = {
  max: {
    subtitle: "The highest daily temperature recorded in each month.",
    legend: "Monthly maximum temperature",
    valueLabel: "Highest daily temperature",
  },
  min: {
    subtitle: "The lowest daily temperature recorded in each month.",
    legend: "Monthly minimum temperature",
    valueLabel: "Lowest daily temperature",
  },
};

const svg = d3.select("#heatmap");
const tooltip = d3.select("#tooltip");
const selection = d3.select("#selection");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function aggregateByMonth(rows) {
  return d3
    .groups(rows, (row) => formatMonthKey(row.dateObject))
    .map(([key, values]) => {
      const [year, month] = key.split("-").map(Number);
      const max = d3.max(values, (row) => row.max);
      const min = d3.min(values, (row) => row.min);
      const expectedDays = new Date(year, month, 0).getDate();
      return {
        key,
        year,
        month,
        max,
        min,
        maxDates: values.filter((row) => row.max === max).map((row) => row.date),
        minDates: values.filter((row) => row.min === min).map((row) => row.date),
        observedDays: values.length,
        expectedDays,
        isPartial: values.length < expectedDays,
      };
    })
    .sort((a, b) => d3.ascending(a.key, b.key));
}

function createColorScale(metric) {
  const [low, high] = state.bounds[metric];
  const palette = palettes[metric];
  const domain = d3.range(palette.length).map((index) => low + ((high - low) * index) / (palette.length - 1));
  return d3.scaleLinear(domain, palette).interpolate(d3.interpolateRgb).clamp(true);
}

function isoDateToReadable(value) {
  return d3.utcFormat("%b %-d, %Y")(parseDate(value));
}

function sourceDateText(dates) {
  if (dates.length === 1) return isoDateToReadable(dates[0]);
  return `${isoDateToReadable(dates[0])} + ${dates.length - 1} more`;
}

function allCells() {
  return d3.cross(state.years, d3.range(1, 13), (year, month) => {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    return { key, year, month, datum: state.monthMap.get(key) || null };
  });
}

function renderHeatmap() {
  const margins = { top: 54, right: 18, bottom: 18, left: 92 };
  const cellWidth = 46;
  const cellHeight = 38;
  const width = margins.left + margins.right + state.years.length * cellWidth;
  const height = margins.top + margins.bottom + 12 * cellHeight;
  const x = d3
    .scaleBand(state.years.map(String), [margins.left, width - margins.right])
    .paddingInner(0.08)
    .paddingOuter(0.04);
  const y = d3
    .scaleBand(d3.range(1, 13), [margins.top, height - margins.bottom])
    .paddingInner(0.08)
    .paddingOuter(0.04);

  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  svg.append("title").attr("id", "heatmap-title").text("Monthly temperature heatmap");
  svg
    .append("desc")
    .attr("id", "heatmap-desc")
    .text("Years run from left to right and months from top to bottom. Cell color encodes temperature.");

  const pattern = svg
    .append("defs")
    .append("pattern")
    .attr("id", "missing-pattern")
    .attr("width", 8)
    .attr("height", 8)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("patternTransform", "rotate(45)");
  pattern.append("rect").attr("width", 8).attr("height", 8).attr("fill", "#e4e3dd");
  pattern.append("line").attr("y2", 8).attr("stroke", "#c2c1bb").attr("stroke-width", 2);

  svg
    .append("text")
    .attr("x", margins.left + ((width - margins.left - margins.right) / 2))
    .attr("y", 12)
    .attr("class", "axis-label")
    .attr("text-anchor", "middle")
    .text("Year");

  svg
    .append("g")
    .attr("class", "d3-axis d3-axis-years")
    .attr("transform", `translate(0,${margins.top - 8})`)
    .call(d3.axisTop(x).tickSize(0))
    .call((axis) => axis.select(".domain").remove())
    .call((axis) => axis.selectAll("text").attr("class", "year-label"));

  svg
    .append("g")
    .attr("class", "d3-axis d3-axis-months")
    .attr("transform", `translate(${margins.left - 6},0)`)
    .call(d3.axisLeft(y).tickSize(0).tickFormat((month) => monthNames[month - 1].slice(0, 3)))
    .call((axis) => axis.select(".domain").remove())
    .call((axis) => axis.selectAll("text").attr("class", "month-label"));

  svg
    .append("g")
    .attr("class", "heat-cells")
    .selectAll("rect")
    .data(allCells(), (cell) => cell.key)
    .join("rect")
    .attr("x", (cell) => x(String(cell.year)))
    .attr("y", (cell) => y(cell.month))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("rx", 4)
    .attr("fill", (cell) => cell.datum ? state.colorScales[state.metric](cell.datum[state.metric]) : "url(#missing-pattern)")
    .attr("class", (cell) => [
      "heat-cell",
      cell.datum?.isPartial ? "is-partial" : "",
      state.selectedKey === cell.key ? "is-selected" : "",
    ].filter(Boolean).join(" "))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", cellAriaLabel)
    .attr("data-key", (cell) => cell.key)
    .on("pointerenter", showTooltip)
    .on("pointermove", positionTooltip)
    .on("pointerleave", hideTooltip)
    .on("focus", showTooltip)
    .on("blur", hideTooltip)
    .on("click", (_, cell) => selectMonth(cell))
    .on("keydown", (event, cell) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectMonth(cell);
      }
    });
}

function cellAriaLabel(cell) {
  if (!cell.datum) return `${monthNames[cell.month - 1]} ${cell.year}: no data`;
  return `${monthNames[cell.month - 1]} ${cell.year}: ${copy[state.metric].valueLabel} ${cell.datum[state.metric]} degrees Celsius`;
}

function tooltipMarkup(cell) {
  const heading = `${monthNames[cell.month - 1]} ${cell.year}`;
  if (!cell.datum) {
    return `<strong>${heading}</strong><span class="tooltip-meta">No observations available</span>`;
  }

  const datum = cell.datum;
  const coverage = datum.isPartial
    ? `Partial data · ${datum.observedDays}/${datum.expectedDays} days`
    : `${datum.observedDays} daily observations`;
  return [
    `<strong>${heading}</strong>`,
    `<span class="tooltip-meta">${coverage}</span>`,
    `<span class="tooltip-value">${copy[state.metric].valueLabel}: ${datum[state.metric]} °C</span>`,
    `<span class="tooltip-meta">Recorded ${sourceDateText(datum[`${state.metric}Dates`])}</span>`,
  ].join("");
}

function showTooltip(event, cell) {
  tooltip.html(tooltipMarkup(cell)).attr("hidden", null);
  positionTooltip(event);
}

function positionTooltip(event) {
  if (tooltip.attr("hidden") !== null) return;
  const node = event.currentTarget;
  const targetRect = node.getBoundingClientRect();
  const anchorX = event.clientX || targetRect.left + targetRect.width / 2;
  const anchorY = event.clientY || targetRect.top;
  const tooltipRect = tooltip.node().getBoundingClientRect();
  const left = Math.min(window.innerWidth - tooltipRect.width - 10, Math.max(10, anchorX + 12));
  const preferredTop = anchorY - tooltipRect.height - 12;
  const top = preferredTop > 8 ? preferredTop : anchorY + 12;
  tooltip.style("left", `${left}px`).style("top", `${top}px`);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function selectMonth(cell) {
  state.selectedKey = cell.key;
  svg.selectAll(".heat-cell").classed("is-selected", (candidate) => candidate.key === cell.key);
  if (!cell.datum) {
    selection.html(`<span class="selection-label">${monthNames[cell.month - 1]} ${cell.year}</span><strong>No observations available.</strong>`);
    return;
  }
  const datum = cell.datum;
  const partial = datum.isPartial ? ` · partial month (${datum.observedDays}/${datum.expectedDays} days)` : "";
  selection.html([
    `<span class="selection-label">${monthNames[cell.month - 1]} ${cell.year}</span>`,
    `<strong>${datum[state.metric]} °C on ${sourceDateText(datum[`${state.metric}Dates`])}${partial}</strong>`,
  ].join(""));
}

function renderLegend() {
  const metric = state.metric;
  const [low, high] = state.bounds[metric];
  d3.select("#legend-scale").style("background", `linear-gradient(90deg, ${palettes[metric].join(", ")})`);
  d3
    .select("#legend-ticks")
    .selectAll("span")
    .data(d3.range(5).map((index) => low + ((high - low) * index) / 4))
    .join("span")
    .text((value) => `${Math.round(value)}°`);
}

function updateMetric(metric) {
  state.metric = metric;
  d3.selectAll(".metric-button")
    .classed("is-active", function () { return this.dataset.metric === metric; })
    .attr("aria-pressed", function () { return String(this.dataset.metric === metric); });
  d3.select("#subtitle").text(copy[metric].subtitle);
  d3.select("#legend-label").text(copy[metric].legend);

  svg
    .selectAll(".heat-cell")
    .attr("aria-label", cellAriaLabel)
    .transition()
    .duration(reduceMotion ? 0 : 260)
    .attr("fill", (cell) => cell.datum ? state.colorScales[metric](cell.datum[metric]) : "url(#missing-pattern)");
  renderLegend();

  if (state.selectedKey) {
    const [year, month] = state.selectedKey.split("-").map(Number);
    selectMonth({ key: state.selectedKey, year, month, datum: state.monthMap.get(state.selectedKey) || null });
  }
}

async function init() {
  try {
    const rows = await d3.csv(DATA_URL, (row) => ({
      date: row.date,
      dateObject: parseDate(row.date),
      max: +row.max_temperature,
      min: +row.min_temperature,
    }));
    const monthly = aggregateByMonth(rows);
    const [firstYear, lastYear] = d3.extent(rows, (row) => row.dateObject.getUTCFullYear());

    state.years = d3.range(firstYear, lastYear + 1);
    state.monthly = monthly;
    state.monthMap = new Map(monthly.map((entry) => [entry.key, entry]));
    state.bounds.max = d3.extent(monthly, (entry) => entry.max);
    state.bounds.min = d3.extent(monthly, (entry) => entry.min);
    state.colorScales.max = createColorScale("max");
    state.colorScales.min = createColorScale("min");

    const partialCount = d3.sum(monthly, (entry) => entry.isPartial ? 1 : 0);
    d3.select("#data-note").text([
      `${rows.length.toLocaleString()} daily records aggregated into ${monthly.length} months.`,
      `${partialCount} months have incomplete daily coverage and use a dashed outline; striped cells have no observations.`,
    ].join(" "));

    renderHeatmap();
    renderLegend();
  } catch (error) {
    selection
      .attr("role", "alert")
      .html(`<span class="selection-label">Unable to load data</span><strong>${error.message}</strong>`);
  }
}

d3.selectAll(".metric-button").on("click", function () {
  updateMetric(this.dataset.metric);
});

init();
