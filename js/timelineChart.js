class TimelineChart {

  /**
   * @param {Object} _config
   *   - parentElement : CSS selector for the container (e.g. '#chart-timeline')
   *   - onBrushSelect : callback(dateRange)  dateRange = [Date, Date] | null
   */
  constructor(_config) {
    this.config = {
      parentElement: _config.parentElement,
      onBrushSelect: _config.onBrushSelect || null,
      margin: { top: 8, right: 16, bottom: 24, left: 40 }
    };

    this.data = [];
    this.aggregated = [];
    this.selectedDateRange = null;
    this.dateField = 'dateReceived';
    this.tooltip = d3.select('#tooltip');
    this.tooltipOffset = 12;

    this.initVis();
  }

  /* ────────────────────────────────────────────
   * 1.  ONE-TIME SETUP
   * ──────────────────────────────────────────── */
  initVis() {
    const vis = this;
    const m = vis.config.margin;

    vis.container = document.querySelector(vis.config.parentElement);
    vis.totalWidth = vis.container.clientWidth;
    vis.totalHeight = vis.container.clientHeight;
    vis.width = vis.totalWidth - m.left - m.right;
    vis.height = vis.totalHeight - m.top - m.bottom;

    // SVG root
    vis.svg = d3.select(vis.container)
      .append('svg')
      .attr('class', 'timeline-chart-svg')
      .attr('width', vis.totalWidth)
      .attr('height', vis.totalHeight);

    // Chart group (shifted by margins)
    vis.chart = vis.svg.append('g')
      .attr('transform', `translate(${m.left},${m.top})`);

    // Scales
    vis.xScale = d3.scaleTime().range([0, vis.width]);
    vis.yScale = d3.scaleLinear().range([vis.height, 0]);

    // Axis groups
    vis.xAxisG = vis.chart.append('g')
      .attr('class', 'timeline-x-axis')
      .attr('transform', `translate(0,${vis.height})`);

    vis.yAxisG = vis.chart.append('g')
      .attr('class', 'timeline-y-axis');

    // Y-axis label
    vis.yLabel = vis.chart.append('text')
      .attr('class', 'timeline-y-label')
      .attr('transform', `translate(${-m.left + 11}, ${vis.height / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .text('Calls');

    // Bar group (drawn below brush so brush overlay stays interactive)
    vis.barsG = vis.chart.append('g')
      .attr('class', 'timeline-bars');
    vis.trendlineG = vis.chart.append('g')
      .attr('class', 'timeline-trendline');

    // D3 brush for date-range selection
    vis.brush = d3.brushX()
      .extent([[0, 0], [vis.width, vis.height]])
      .on('brush', function (event) {
        vis.handleBrushMove(event);
      })
      .on('end', function (event) {
        if (!event.sourceEvent) return;   // ignore programmatic clears
        vis.handleBrushEnd(event);
      });

    vis.brushG = vis.chart.append('g')
      .attr('class', 'timeline-brush')
      .call(vis.brush);

    // The brush overlay intercepts all pointer events, so bar mouseover handlers never fire.
    // Instead, listen on the brush group itself to show a bar tooltip on hover.
    vis.brushG
      .on('mousemove.bartooltip', function (event) {
        if (event.buttons !== 0) return;  // skip while dragging (brush handles it)
        if (!vis.aggregated || vis.aggregated.length === 0) return;

        const [mx] = d3.pointer(event, vis.chart.node());
        const closest = vis.aggregated.reduce((best, d) =>
          Math.abs(vis.xScale(d.date) - mx) < Math.abs(vis.xScale(best.date) - mx) ? d : best
        );

        const bw = (vis.barWidth || 10) / 2 + 4;
        if (Math.abs(vis.xScale(closest.date) - mx) > bw) {
          vis.tooltip.style('opacity', 0);
          return;
        }

        const fmt = d => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
        vis.tooltip
          .style('opacity', 1)
          .style('z-index', 1000000)
          .html(`<div class="tooltip-label timeline-tooltip"><strong>${fmt(closest.date)}</strong><br>Calls: <strong>${closest.count}</strong></div>`);
        vis.positionTooltip(event);
      })
      .on('mouseleave.bartooltip', function () {
        vis.tooltip.style('opacity', 0);
      });

    // Resize listener
    window.addEventListener('resize', () => vis.handleResize());
  }

  /* ────────────────────────────────────────────
   * 2.  RESIZE HANDLER
   * ──────────────────────────────────────────── */
  handleResize() {
    const vis = this;
    const m = vis.config.margin;

    vis.totalWidth = vis.container.clientWidth;
    vis.totalHeight = vis.container.clientHeight;
    vis.width = vis.totalWidth - m.left - m.right;
    vis.height = vis.totalHeight - m.top - m.bottom;

    vis.svg.attr('width', vis.totalWidth).attr('height', vis.totalHeight);
    vis.xScale.range([0, vis.width]);
    vis.yScale.range([vis.height, 0]);
    vis.xAxisG.attr('transform', `translate(0,${vis.height})`);

    vis.brush.extent([[0, 0], [vis.width, vis.height]]);
    vis.brushG.call(vis.brush);

    if (vis.yLabel) {
      vis.yLabel.attr('transform', `translate(${-m.left + 11}, ${vis.height / 2}) rotate(-90)`);
    }

    if (vis.aggregated.length > 0) {
      vis.renderVis();
    }
  }

  /* ────────────────────────────────────────────
   * 3.  PUBLIC UPDATE  (called by main.js)
   * ──────────────────────────────────────────── */
  update(data, selectedDateRange, dateField) {
    const vis = this;
    vis.data = data || [];
    vis.selectedDateRange = selectedDateRange || null;
    vis.dateField = dateField || 'dateReceived';
    vis.updateVis();

    // Sync the brush rectangle to match the current selectedDateRange
    if (!vis.selectedDateRange) {
      vis.brushG.call(vis.brush.move, null);
    } else {
      var x0 = Math.max(0, Math.min(vis.width, vis.xScale(vis.selectedDateRange[0])));
      var x1 = Math.max(0, Math.min(vis.width, vis.xScale(vis.selectedDateRange[1])));
      vis.brushG.call(vis.brush.move, [x0, x1]);
    }
  }

  /* ────────────────────────────────────────────
   * 4.  AGGREGATE & SET SCALES
   * ──────────────────────────────────────────── */
  updateVis() {
    const vis = this;

    // Keep only records with a valid parsed date
    const validData = vis.data.filter(d => d[vis.dateField]);

    // Group by calendar day  →  [ [dateStr, [records…]], … ]
    const formatDay = d3.timeFormat('%Y-%m-%d');
    const grouped = d3.rollups(
      validData,
      records => records,
      d => formatDay(d[vis.dateField])
    );

    // Convert to flat array:  { date, dateStr, count, records }
    vis.aggregated = grouped.map(([dateStr, records]) => ({
      date: records[0][vis.dateField],
      dateStr: dateStr,
      count: records.length,
      records: records
    })).sort((a, b) => a.date - b.date);

    // X domain: pad by one day on each side so edge bars aren't clipped
    if (vis.aggregated.length === 0) {
      vis.xScale.domain([new Date(), new Date()]);
      vis.yScale.domain([0, 1]);
    } else {
      const dateExtent = d3.extent(vis.aggregated, d => d.date);
      const dayMs = 86400000;
      vis.xScale.domain([
        new Date(dateExtent[0].getTime() - dayMs),
        new Date(dateExtent[1].getTime() + dayMs)
      ]);
      vis.yScale.domain([0, d3.max(vis.aggregated, d => d.count) || 1]).nice();
    }

    vis.renderVis();
  }

  /* ────────────────────────────────────────────
   * 5.  DRAW BARS + AXES
   * ──────────────────────────────────────────── */
  renderVis() {
    const vis = this;

    // Adaptive bar width
    const numBars = vis.aggregated.length;
    const barWidth = numBars > 1
      ? Math.max(2, Math.min(30, (vis.width / numBars) * 0.75))
      : 20;
    vis.barWidth = barWidth; // stored for hover tooltip detection

    // Helper: is a bar inside the brushed range?
    const isInRange = (d) => {
      if (!vis.selectedDateRange) return true;
      return d.date >= vis.selectedDateRange[0] && d.date <= vis.selectedDateRange[1];
    };

    // ─── Bars ───
    vis.barsG.selectAll('.timeline-bar')
      .data(vis.aggregated, d => d.dateStr)
      .join(
        enter => enter.append('rect').attr('class', 'timeline-bar'),
        update => update,
        exit => exit.remove()
      )
      .attr('x', d => vis.xScale(d.date) - barWidth / 2)
      .attr('y', d => vis.yScale(d.count))
      .attr('width', barWidth)
      .attr('height', d => vis.height - vis.yScale(d.count))
      .attr('fill', d => isInRange(d) ? '#4299e1' : '#cbd5e0')
      .attr('opacity', d => isInRange(d) ? 0.88 : 0.3)
      .attr('rx', 1)
      .on('mouseover', function (event, d) {
        d3.select(this).attr('fill', '#2b6cb0').attr('opacity', 1);

        var sample = d.records[0];
        vis.tooltip
          .style('opacity', 1)
          .style('z-index', 1000000)
          .html(
            '<div class="tooltip-label timeline-tooltip">' +
              '<strong>Hovered Date:</strong> ' + (d.dateStr || 'N/A') + '<br>' +
              '<strong>Date Received:</strong> ' + (sample.DATE_CREATED || 'N/A') + '<br>' +
              '<strong>Time Received:</strong> ' + (sample.TIME_RECEIVED || 'N/A') + '<br>' +
              '<strong>Date Closed:</strong> ' + (sample.DATE_CLOSED || 'N/A') + '<br>' +
              '<strong>Total Calls:</strong> ' + d.count +
            '</div>'
          );

        vis.positionTooltip(event);
      })
      .on('mousemove', event => vis.positionTooltip(event))
      .on('mouseleave', function (event, d) {
        d3.select(this)
          .attr('fill', isInRange(d) ? '#4299e1' : '#cbd5e0')
          .attr('opacity', isInRange(d) ? 0.88 : 0.3);
        vis.tooltip.style('opacity', 0);
      });

    // ─── Trendline ───
    const lineGenerator = d3.line()
      .x(d => vis.xScale(d.date))
      .y(d => vis.yScale(d.count))
      .curve(d3.curveMonotoneX);

    const trendData = vis.aggregated.filter(d => d.count > 0);
    vis.trendlineG.selectAll('.timeline-trendline-path')
      .data(trendData.length > 1 ? [trendData] : [])
      .join(
        enter => enter.append('path').attr('class', 'timeline-trendline-path'),
        update => update,
        exit => exit.remove()
      )
      .attr('fill', 'none')
      .attr('stroke', '#1d4ed8')
      .attr('stroke-width', 2)
      .attr('opacity', 0.95)
      .attr('d', lineGenerator);

    // ─── X Axis ───
    vis.xAxisG.call(
      d3.axisBottom(vis.xScale)
        .ticks(Math.max(3, Math.floor(vis.width / 65)))
        .tickFormat(d => `${d.getMonth() + 1}/${d.getDate()}`)
        .tickSizeOuter(0)
    );

    // ─── Y Axis ───
    vis.yAxisG.call(
      d3.axisLeft(vis.yScale)
        .ticks(Math.max(2, Math.floor(vis.height / 25)))
        .tickSizeOuter(0)
    );
  }

  /* ────────────────────────────────────────────
   * 6.  BRUSH END HANDLER
   * ──────────────────────────────────────────── */
  handleBrushEnd(event) {
    const vis = this;

    // Brush was cleared (user clicked outside the selection)
    if (!event.selection) {
      vis.tooltip.style('opacity', 0);
      if (vis.config.onBrushSelect) {
        vis.config.onBrushSelect(null);
      }
      return;
    }

    // Convert pixel range → date range
    const [x0, x1] = event.selection;
    var dateRange = [vis.xScale.invert(x0), vis.xScale.invert(x1)];

    if (vis.config.onBrushSelect) {
      vis.config.onBrushSelect(dateRange);
    }
  }

  handleBrushMove(event) {
    const vis = this;
    if (!event.sourceEvent) return;
    if (!event.selection) return;

    const [x0, x1] = event.selection;
    const startDate = vis.xScale.invert(x0);
    const endDate = vis.xScale.invert(x1);
    const fmt = d => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

    const totalCalls = vis.aggregated
      .filter(d => d.date >= startDate && d.date <= endDate)
      .reduce((sum, d) => sum + d.count, 0);

    vis.tooltip
      .style('opacity', 1)
      .style('z-index', 1000000)
      .html(
        '<div class="tooltip-label timeline-tooltip">' +
          '<strong>' + fmt(startDate) + ' – ' + fmt(endDate) + '</strong><br>' +
          'Calls in range: <strong>' + totalCalls + '</strong>' +
        '</div>'
      )
      .style('left', ((event.sourceEvent && event.sourceEvent.pageX) ? event.sourceEvent.pageX : 16) + 'px')
      .style('top', ((event.sourceEvent && event.sourceEvent.pageY) ? event.sourceEvent.pageY : 16) + 'px');
  }

  /* ────────────────────────────────────────────
   * 7.  TOOLTIP POSITIONING
   * ──────────────────────────────────────────── */
  positionTooltip(event) {
    const vis = this;
    const node = vis.tooltip.node();
    if (!node) return;

    const tipW = node.offsetWidth || 0;
    const tipH = node.offsetHeight || 0;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    var left = event.pageX + vis.tooltipOffset;
    var top = event.pageY + vis.tooltipOffset;

    if (left + tipW > vpW - 4) left = event.pageX - tipW - vis.tooltipOffset;
    if (top + tipH > vpH - 4) top = event.pageY - tipH - vis.tooltipOffset;

    left = Math.max(4, Math.min(left, vpW - tipW - 4));
    top = Math.max(4, Math.min(top, vpH - tipH - 4));

    vis.tooltip.style('left', left + 'px').style('top', top + 'px');
  }
}
