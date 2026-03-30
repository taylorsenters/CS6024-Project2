class BarChart {
  constructor(_config, _data) {
    this.config = {
      parentElement: _config.parentElement,
      legendElement: _config.legendElement || null,
      xKey: _config.xKey,
      yKey: _config.yKey || 'Count',
      scrollable: _config.scrollable || false,
      barHeight: _config.barHeight || 12,
      barGap: _config.barGap || 3,
      margin: _config.margin || { top: 6, right: 28, bottom: 6, left: 108 },
      onBarSelect: _config.onBarSelect || null,
      topN: _config.topN || null,
      label: _config.label || _config.xKey
    };
    this.data = _data;
    this.colorBaseData = _data;
    this.selectedValues = [];
    this.colorScale = Object.assign(count => d3.interpolateYlGnBu(0.3 + 0.7 * count), { domain: () => [0, 1] });
    this.tooltip = d3.select('#tooltip');
    this.tooltipOffset = 12;
    this.initVis();
  }

  initVis() {
    const vis = this;
    const m   = vis.config.margin;

    vis.container = document.querySelector(vis.config.parentElement);
    vis.totalWidth = vis.container.clientWidth;
    vis.width      = vis.totalWidth - m.left - m.right;

    if (vis.config.scrollable) {
      vis.container.style.overflowY = 'auto';
      vis.container.style.overflowX = 'hidden';
    } else {
      vis.height = vis.container.clientHeight - m.top - m.bottom;
    }

    vis.svg = d3.select(vis.container)
      .append('svg')
        .attr('class', 'bar-chart')
        .attr('width', vis.totalWidth);

    if (!vis.config.scrollable) {
      vis.svg.attr('height', vis.container.clientHeight);
    }

    vis.chart = vis.svg.append('g')
      .attr('transform', `translate(${m.left},${m.top})`);

    vis.xScale = d3.scaleLinear().range([0, vis.width]);
    vis.yScale = d3.scaleBand().paddingInner(0.22).paddingOuter(0.1);

    vis.yAxisG = vis.chart.append('g').attr('class', 'bar-chart-axis bar-chart-y-axis');

    vis.updateVis();
  }

  updateVis() {
    const vis = this;
    const m   = vis.config.margin;

    // Aggregate: count records per category
    const counts = d3.rollup(vis.data, v => v.length, d => d[vis.config.xKey]);
    vis.aggregated = Array.from(counts, ([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);

    // Apply top-N limit, bucketing the remainder into "Other"
    if (vis.config.topN && vis.aggregated.length > vis.config.topN) {
      const top = vis.aggregated.slice(0, vis.config.topN);
      const otherCount = vis.aggregated.slice(vis.config.topN).reduce((sum, d) => sum + d.value, 0);
      vis.aggregated = [...top, { key: 'Other', value: otherCount }];
    }

    vis.totalCount = d3.sum(vis.aggregated, d => d.value);

    // Measure widest y-axis label and fit the left margin to it
    const ruler = vis.svg.append('text')
      .style('visibility', 'hidden')
      .style('font-size', '9px')
      .style('font-family', '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif');
    const maxLabelW = d3.max(vis.aggregated, d => { ruler.text(d.key); return ruler.node().getComputedTextLength(); }) || 0;
    ruler.remove();
    const dynamicLeft = Math.ceil(maxLabelW) + 10;

    vis.totalWidth = vis.container.clientWidth;
    vis.width = vis.totalWidth - dynamicLeft - m.right;
    vis.svg.attr('width', vis.totalWidth);
    vis.chart.attr('transform', `translate(${dynamicLeft},${m.top})`);

    if (vis.config.scrollable) {
      const containerHeight = vis.container.clientHeight;
      const availableHeight = containerHeight - m.top - m.bottom;
      const naturalHeight   = vis.aggregated.length * (vis.config.barHeight + vis.config.barGap);

      // Expand bars to fill when they fit; use fixed sizes and scroll when they don't
      vis.height = naturalHeight > availableHeight ? naturalHeight : availableHeight;
      vis.svg.attr('height', vis.height + m.top + m.bottom);
    }

    vis.xScale.domain([0, d3.max(vis.aggregated, d => d.value) || 1]).range([0, vis.width]);
    vis.yScale.range([0, vis.height]).domain(vis.aggregated.map(d => d.key));

    // Compute sequential color scale from base data so colors stay stable during cross-filtering
    const baseCounts = d3.rollup(vis.colorBaseData, v => v.length, d => d[vis.config.xKey]);
    const maxBaseCount = d3.max(Array.from(baseCounts.values())) || 1;
    // Sqrt-normalize the domain so colors spread across skewed distributions:
    const sqrtNorm = d3.scaleSqrt().domain([0, maxBaseCount]).range([0.2, 1]).clamp(true);
    vis.colorScale = Object.assign(
      count => d3.interpolateYlGnBu(sqrtNorm(count)),
      { domain: () => [0, maxBaseCount] }
    );

    vis.renderLegend();
    vis.renderVis();
  }

  renderLegend() {
    const vis = this;
    if (!vis.config.legendElement) return;
    const container = document.querySelector(vis.config.legendElement);
    if (!container) return;
    const max = vis.colorScale.domain()[1];
    const stops = d3.range(11).map(i => d3.interpolateYlGnBu(0.2 + 0.8 * Math.sqrt(i / 10)));
    const clearButtonStyle = vis.selectedValues.length > 0 ? 'opacity: 1; cursor: pointer;' : 'opacity: 0.4; cursor: not-allowed;';
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <div style="flex: 1; min-width: 0;">
          <div class="legend-gradient-bar" style="background: linear-gradient(to right, ${stops.join(',')})"></div>
          <div class="legend-gradient-labels">
            <span>0 calls</span>
            <span>${Math.round(max)} calls</span>
          </div>
        </div>
        <button class="chart-clear-btn" style="${clearButtonStyle}">Clear</button>
      </div>`;
    
    const btn = container.querySelector('.chart-clear-btn');
    if (btn) {
      btn.addEventListener('mouseover', function() {
        if (vis.selectedValues.length > 0) this.style.backgroundColor = '#7f1d1d';
      });
      btn.addEventListener('mouseleave', function() {
        this.style.backgroundColor = '';
      });
      btn.addEventListener('click', function() {
        if (vis.selectedValues.length > 0 && vis.config.onBarSelect) {
          vis.config.onBarSelect([]);
        }
      });
    }
  }

  renderVis() {
    const vis = this;

    // --- Bars ---
    vis.chart.selectAll('.bar-chart-bar')
      .data(vis.aggregated, d => d.key)
      .join(
        enter => enter.append('rect').attr('class', 'bar-chart-bar').attr('x', 0),
        update => update,
        exit => exit.remove()
      )
      .attr('y',      d => vis.yScale(d.key))
      .attr('height', vis.yScale.bandwidth())
      .attr('width',  d => vis.xScale(d.value))
      .attr('fill',   d => vis.colorScale(d.value))
      .attr('stroke', 'rgba(0,0,0,0.45)')
      .attr('stroke-width', 0.75)
      .attr('opacity', d => vis.selectedValues.length === 0 || vis.selectedValues.includes(d.key) ? 1 : 0.2)
      .classed('active', d => vis.selectedValues.includes(d.key))
      .on('mouseover', function(event, d) {
        const c = d3.color(vis.colorScale(d.value));
        if (c) d3.select(this).attr('fill', c.darker(0.5).toString());
        vis.tooltip
          .style('opacity', 1)
          .style('z-index', 1000000)
          .html(`<div class="tooltip-label bar-tooltip"><strong>${vis.config.label}:</strong> ${d.key}<br><strong>Calls:</strong> ${d.value}<br><strong>Share:</strong> ${vis.totalCount > 0 ? ((d.value / vis.totalCount) * 100).toFixed(1) : '0.0'}%</div>`);
        vis.positionTooltip(event);
      })
      .on('mousemove', event => vis.positionTooltip(event))
      .on('mouseleave', function(event, d) {
        d3.select(this)
          .attr('fill', vis.colorScale(d.value))
          .attr('opacity', vis.selectedValues.length === 0 || vis.selectedValues.includes(d.key) ? 1 : 0.2);
        vis.tooltip.style('opacity', 0);
      })
      .on('click', (_, d) => {
        if (!vis.config.onBarSelect || d.key === 'Other') return;
        const next = vis.selectedValues.includes(d.key)
          ? vis.selectedValues.filter(k => k !== d.key)
          : [...vis.selectedValues, d.key];
        vis.config.onBarSelect(next);
      });

    // --- Value labels (drawn to the right of each bar) ---
    vis.chart.selectAll('.bar-chart-label')
      .data(vis.aggregated, d => d.key)
      .join(
        enter => enter.append('text')
          .attr('class', 'bar-chart-label')
          .attr('x',      d => vis.xScale(d.value) + 3)
          .attr('y',      d => vis.yScale(d.key) + vis.yScale.bandwidth() / 2)
          .attr('dy', '0.35em')
          .text(d => d.value),
        update => update
          .attr('x',  d => vis.xScale(d.value) + 3)
          .attr('y',  d => vis.yScale(d.key) + vis.yScale.bandwidth() / 2)
          .text(d => d.value),
        exit => exit.remove()
      );

    // --- Y axis (category labels) ---
    vis.yAxisG.call(
      d3.axisLeft(vis.yScale)
        .tickSizeOuter(0)
        .tickSizeInner(0)
        .tickPadding(6)
    );
  }

  update(newData, selectedValues, colorBaseData) {
    this.data = newData;
    this.colorBaseData = colorBaseData || newData;
    this.selectedValues = selectedValues || [];
    this.updateVis();
  }

  positionTooltip(event) {
    const vis = this;
    const tooltipNode = vis.tooltip.node();
    if (!tooltipNode) return;

    const tipWidth  = tooltipNode.offsetWidth  || 0;
    const tipHeight = tooltipNode.offsetHeight || 0;
    const vpWidth   = window.innerWidth;
    const vpHeight  = window.innerHeight;

    let left = event.pageX + vis.tooltipOffset;
    let top  = event.pageY + vis.tooltipOffset;

    if (left + tipWidth  > vpWidth  - 4) left = event.pageX - tipWidth  - vis.tooltipOffset;
    if (top  + tipHeight > vpHeight - 4) top  = event.pageY - tipHeight - vis.tooltipOffset;

    left = Math.max(4, Math.min(left, vpWidth  - tipWidth  - 4));
    top  = Math.max(4, Math.min(top,  vpHeight - tipHeight - 4));

    vis.tooltip.style('left', `${left}px`).style('top', `${top}px`);
  }
}
