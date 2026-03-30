// 32-color palette for ordinal categorical scales (agency, neighborhood, srType).
// Drawn from multiple D3 schemes to ensure no two categories share the same color
// even when there are more than 10 unique values.
const CATEGORICAL_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
  '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5',
  '#393b79', '#637939', '#8c6d31', '#843c39', '#7b4173',
  '#17475e', '#3b6e37', '#6b2d2d', '#455a3e', '#3d3d3d',
  '#f0a500', '#00897b',
];

class LeafletMap {

  /**
   * Class constructor with basic configuration
   * @param {Object}
   * @param {Array}
   */
  constructor(_config, _data) {
    this.config = {
      parentElement: _config.parentElement,
      onPointSelect: _config.onPointSelect || null,
      onMapClick: _config.onMapClick || null,
    };
    this.data = _data;
    this.colorData = _data;
    this.colorBy = 'timeGap';
    this.mapStyle = 'aerial';
    this.selectedPoint = null;
    this.ordinalScale = d3.scaleOrdinal(CATEGORICAL_PALETTE);
    this.brushMode = false;
    this.initVis();
  }

  /**
   * We initialize scales/axes and append static elements, such as axis titles.
   */
  initVis() {
    let vis = this;

    vis.esriUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    vis.esriAttr = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

    vis.topoUrl = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
    vis.topoAttr = 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

    vis.thOutUrl = 'https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={apikey}';
    vis.thOutAttr = '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    vis.stUrl = 'https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.{ext}';
    vis.stAttr = 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a> &mdash; Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    vis.aerialLayer = L.tileLayer(vis.esriUrl, {
      id: 'esri-image',
      attribution: vis.esriAttr,
      ext: 'png'
    });

    vis.streetLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        id: 'esri-street',
        attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NGA, EPA, USDA',
        ext: 'png'
      }
    );

    vis.theMap = L.map('my-map', {
      center: [30, 0],
      zoom: 2,
      layers: [vis.aerialLayer]
    });

    vis.fitToData(vis.data);

    L.svg({ clickable: true }).addTo(vis.theMap);
    vis.overlay = d3.select(vis.theMap.getPanes().overlayPane);
    vis.svg = vis.overlay.select('svg').attr('pointer-events', 'auto');
    vis.g = vis.svg.append('g').attr('class', 'leaflet-zoom-hide');

    // Add clear button control
    vis.addClearButtonControl();

    vis.renderVis();

    vis.theMap.on('viewreset zoomend move', function() {
      vis.updateVis();
    });

    vis.theMap.on('click', function() {
      if (!vis.brushMode && vis.config.onMapClick) {
        vis.config.onMapClick();
      }
    });

    // Brush SVG overlay sits above the map but below the UI panels
    vis.brushSvg = d3.select('body')
      .append('svg')
      .attr('id', 'map-brush-svg')
      .style('position', 'fixed')
      .style('inset', '0')
      .style('width', '100vw')
      .style('height', '100vh')
      .style('z-index', '850')
      .style('pointer-events', 'none');

    vis.brushSvg.append('style').text(`
      #map-brush-svg .selection {
        fill: #3b82f6; fill-opacity: 0.07;
        stroke: #3b82f6; stroke-width: 1;
        stroke-dasharray: none;
      }
      #map-brush-svg .handle { fill: #3b82f6; opacity: 0.55; rx: 3; }
      #map-brush-svg .overlay { cursor: crosshair; }
    `);

    vis.brushG = vis.brushSvg.append('g');

    vis.mapBrush = d3.brush()
      .on('end', event => vis._onMapBrushEnd(event));
  }

  /**
   * Handles the end of a map brush selection, collecting points within the rectangle.
   */
  _onMapBrushEnd(event) {
    const vis = this;
    if (!event.sourceEvent) return;

    if (!event.selection) {
      globalState.brushedPoints = [];
      updateApp();
      return;
    }

    const [[px0, py0], [px1, py1]] = event.selection;

    // #my-map is fixed at viewport origin so container points equal viewport points
    const selected = vis.data.filter(d => {
      const pt = vis.theMap.latLngToContainerPoint([d.latitude, d.longitude]);
      return pt.x >= px0 && pt.x <= px1 && pt.y >= py0 && pt.y <= py1;
    });

    globalState.brushedPoints = selected;
    console.log(`[mapBrush] ${selected.length} points selected`);
    updateApp();
  }

  /**
   * Toggles brush selection mode on the map. Returns the new mode state.
   */
  toggleBrushMode() {
    const vis = this;
    vis.brushMode = !vis.brushMode;

    if (vis.brushMode) {
      vis.mapBrush.extent([[0, 0], [window.innerWidth, window.innerHeight]]);
      vis.brushG.call(vis.mapBrush);
      vis.brushSvg.style('pointer-events', 'all');
      vis.theMap.dragging.disable();
      vis.theMap.scrollWheelZoom.disable();
      vis.theMap.doubleClickZoom.disable();
    } else {
      vis.brushSvg.style('pointer-events', 'none');
      vis.brushG.selectAll('*').remove();
      globalState.brushedPoints = [];
      vis.theMap.dragging.enable();
      vis.theMap.scrollWheelZoom.enable();
      vis.theMap.doubleClickZoom.enable();
      updateApp();
    }
    return vis.brushMode;
  }

  updateVis() {
    let vis = this;

    vis.Dots
      .attr('cx', d => vis.theMap.latLngToLayerPoint([d.latitude, d.longitude]).x)
      .attr('cy', d => vis.theMap.latLngToLayerPoint([d.latitude, d.longitude]).y)
      .attr('fill', d => vis.getPointColor(d))
      .attr('r', d => vis.getPointRadius(d))
      .attr('stroke-width', d => vis.getPointStrokeWidth(d))
      .attr('opacity', d => vis.getPointOpacity(d))
      .classed('selected-point-blink', d => vis.selectedPoint && d.SR_NUMBER === vis.selectedPoint.SR_NUMBER);
  }

  updateState(globalState, filteredData, colorBaseData) {
    // Handle Basemap toggle
    if (this.mapStyle !== globalState.mapStyle) {
      const currentLayer = this.mapStyle === 'aerial' ? this.aerialLayer : this.streetLayer;
      const nextLayer = globalState.mapStyle === 'aerial' ? this.aerialLayer : this.streetLayer;

      if (this.theMap.hasLayer(currentLayer)) this.theMap.removeLayer(currentLayer);
      if (!this.theMap.hasLayer(nextLayer)) this.theMap.addLayer(nextLayer);

      this.mapStyle = globalState.mapStyle;
    }

    // Update local properties
    this.colorBy = globalState.colorBy;
    this.selectedPoint = globalState.selectedPoint;
    this.data = filteredData;
    // colorBaseData is filtered only by Request Type (not chart clicks),
    // so color scales stay stable when cross-filtering between charts
    this.colorData = colorBaseData || filteredData;

    // Re-render
    this.updateColorScales();
    this.renderVis();
    this.updateClearButtonState();
  }

  getRequestedDate(d) {
    return new Date(d.DATE_CREATED || '');
  }

  getUpdatedDate(d) {
    return new Date(d.DATE_LAST_UPDATE || d.DATE_CLOSED || '');
  }

  getTimeGapDays(d) {
    const requestedDate = this.getRequestedDate(d);
    const updatedDate = this.getUpdatedDate(d);

    if (!Number.isFinite(requestedDate.getTime()) || !Number.isFinite(updatedDate.getTime())) {
      return null;
    }

    return Math.max(0, (updatedDate - requestedDate) / (1000 * 60 * 60 * 24));
  }

  updateColorScales() {
    const vis = this;

    if (vis.colorBy === 'timeGap') {
      const values = vis.colorData
        .map(d => vis.getTimeGapDays(d))
        .filter(v => Number.isFinite(v));
      const extent = values.length > 0 ? d3.extent(values) : [0, 1];
      const domain = extent[0] === extent[1] ? [extent[0], extent[0] + 1] : extent;
      vis.timeGapScale = d3.scaleSequential(d3.interpolateYlOrRd).domain(domain);
      return;
    }

    // Priority uses the fixed PRIORITY_COLORS map — no ordinal domain needed
    if (vis.colorBy === 'priority') return;

    const categories = vis.colorBy === 'neighborhood'
      ? [...new Set(vis.colorData.map(d => d.NEIGHBORHOOD || 'Unknown'))]
      : vis.colorBy === 'srType'
      ? [...new Set(vis.colorData.map(d => d.srType || 'Unknown'))]
      : [...new Set(vis.colorData.map(d => d.DEPT_NAME || 'Unknown'))];

    vis.ordinalScale.domain(categories.sort(d3.ascending));
  }

  getPointColor(d) {
    const vis = this;
    const overrides = (globalState.colorOverrides || {})[vis.colorBy] || {};

    if (vis.colorBy === 'timeGap') {
      const days = vis.getTimeGapDays(d);
      return Number.isFinite(days) ? vis.timeGapScale(days) : '#9aa5b1';
    }

    if (vis.colorBy === 'neighborhood') {
      const cat = d.NEIGHBORHOOD || 'Unknown';
      return overrides[cat] || vis.ordinalScale(cat);
    }

    if (vis.colorBy === 'priority') {
      const cat = d.PRIORITY || 'Unknown';
      return overrides[cat] || PRIORITY_COLORS[cat] || PRIORITY_COLOR_DEFAULT;
    }

    if (vis.colorBy === 'srType') {
      const cat = d.srType || 'Unknown';
      return overrides[cat] || vis.ordinalScale(cat);
    }

    const cat = d.DEPT_NAME || 'Unknown';
    return overrides[cat] || vis.ordinalScale(cat);
  }

  getPointOpacity(d) {
    if (!globalState.brushedPoints || globalState.brushedPoints.length === 0) return 1;
    return globalState.brushedPoints.some(b => b.SR_NUMBER === d.SR_NUMBER) ? 1 : 0.15;
  }

  getPointRadius(d) {
    const zoom = this.theMap ? this.theMap.getZoom() : 2;
    const baseRadius = Math.max(3, Math.min(10, 2.5 + (zoom * 0.35)));
    const isSelected = this.selectedPoint && d.SR_NUMBER === this.selectedPoint.SR_NUMBER;
    return isSelected ? baseRadius + 2 : baseRadius;
  }

  getPointStrokeWidth(d) {
    const isSelected = this.selectedPoint && d.SR_NUMBER === this.selectedPoint.SR_NUMBER;
    return isSelected ? 2 : 1;
  }

  renderVis() {
    let vis = this;

    vis.updateColorScales();

    console.log(`[renderVis] Attempting to draw ${vis.data.length} points.`);

    vis.Dots = vis.g.selectAll('circle')
      .data(vis.data, d => d.SR_NUMBER)
      .join(
        enter => enter.append('circle')
          .style('cursor', 'pointer')
          .attr('fill', d => vis.getPointColor(d))
          .attr('stroke', 'black')
          .attr('r', d => vis.getPointRadius(d)),
        update => update,
        exit => exit.remove()
      );
    
    vis.Dots
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this)
          .transition()
          .duration('150')
          .attr('stroke', 'red')
          .attr('r', vis.getPointRadius(d) + 1.5);

        d3.select('#tooltip')
          .style('opacity', 1)
          .style('z-index', 1000000)
          .html(`<div class="tooltip-label">
            <strong>Call Date:</strong> ${d.DATE_CREATED || 'N/A'}<br>
            <strong>Last Update Date:</strong> ${(raw => { const p = new Date(raw); return raw && !isNaN(p) ? p.toISOString().slice(0,10) : 'N/A'; })(d.DATE_LAST_UPDATE || d.DATE_CLOSED)}<br>
            <strong>Agency:</strong> ${d.DEPT_NAME || 'N/A'}<br>
            <strong>Call Type:</strong> ${d.SR_TYPE || 'N/A'}<br>
            <strong>Description:</strong> ${d.SR_TYPE_DESC || d.GROUP_DESC || 'N/A'}
          </div>`);
      })
      .on('mousemove', event => {
        d3.select('#tooltip')
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY + 10) + 'px');
      })
      .on('mouseleave', function() {
        d3.select(this)
          .transition()
          .duration('150')
          .attr('stroke', 'black')
          .attr('r', d => vis.getPointRadius(d));

        d3.select('#tooltip').style('opacity', 0);
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        if (vis.config.onPointSelect) {
          vis.config.onPointSelect(d);
        }
      });

    vis.updateVis();
  }

  fitToData(data) {
    let vis = this;
    const validPoints = data.filter(d => Number.isFinite(d.latitude) && Number.isFinite(d.longitude));

    if (validPoints.length > 0) {
      const bounds = L.latLngBounds(validPoints.map(d => [d.latitude, d.longitude]));
      const leftColW = document.querySelector('.left-column')?.offsetWidth || 270;
      const chartsW = document.querySelector('.charts-panel')?.offsetWidth || 330;
      const timelineH = document.querySelector('.timeline-panel')?.offsetHeight || 130;

      vis.theMap.fitBounds(bounds, {
        paddingTopLeft: [55 + leftColW - 400, 50],
        paddingBottomRight:[12 + chartsW + 20,  12 + timelineH + 20],
        maxZoom: 14
      });
      vis.theMap.setZoom(Math.min(vis.theMap.getZoom(), 14));
      vis.theMap.setMinZoom(vis.theMap.getZoom());
    }
  }

  addClearButtonControl() {
    let vis = this;

    const ClearControl = L.Control.extend({
      options: {
        position: 'topright'
      },
      onAdd: function(map) {
        const container = L.DomUtil.create('div', 'leaflet-control leaflet-bar');
        const button = L.DomUtil.create('button', 'leaflet-control-clear', container);
        button.innerHTML = 'Clear';
        button.style.cssText = 'background-color: #e74c3c; color: white; border: none; padding: 8px 14px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; opacity: 0.4; transition: all 0.2s;';
        button.disabled = !vis.selectedPoint;

        button.addEventListener('mouseover', function() {
          if (vis.selectedPoint) {
            this.style.backgroundColor = '#000000';
          }
        });

        button.addEventListener('mouseleave', function() {
          if (vis.selectedPoint) {
            this.style.backgroundColor = '#e74c3c';
          }
        });

        button.addEventListener('click', function(e) {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          if (vis.selectedPoint && vis.config.onPointSelect) {
            vis.config.onPointSelect(null);
          }
        });

        return container;
      }
    });

    vis.clearControl = new ClearControl();
    vis.clearControl.addTo(vis.theMap);
  }

  updateClearButtonState() {
    let vis = this;
    if (vis.clearControl) {
      const button = vis.clearControl._container.querySelector('.leaflet-control-clear');
      if (button) {
        const hasSelection = !!vis.selectedPoint;
        button.style.opacity = hasSelection ? '1' : '0.4';
        button.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
        button.disabled = !hasSelection;
      }
    }
  }
}