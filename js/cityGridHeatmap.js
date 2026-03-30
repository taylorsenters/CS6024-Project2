class CityGridHeatmap {
  constructor(_config, _allData) {
    this.config = {
      map: _config.map
    };
    this.allData = _allData || [];
    this.visible = false;
    this.gridLayer = L.layerGroup();
    this.labelLayer = L.layerGroup();

    this.initGridBounds();
  }

  initGridBounds() {
    const valid = this.allData.filter(d => Number.isFinite(d.latitude) && Number.isFinite(d.longitude));
    if (valid.length === 0) {
      this.bounds = null;
      return;
    }

    const latExtent = d3.extent(valid, d => d.latitude);
    const lngExtent = d3.extent(valid, d => d.longitude);

    const latPad = (latExtent[1] - latExtent[0]) * 0.03 || 0.01;
    const lngPad = (lngExtent[1] - lngExtent[0]) * 0.03 || 0.01;

    this.bounds = {
      minLat: latExtent[0] - latPad,
      maxLat: latExtent[1] + latPad,
      minLng: lngExtent[0] - lngPad,
      maxLng: lngExtent[1] + lngPad
    };

    const latSpan = this.bounds.maxLat - this.bounds.minLat;
    const lngSpan = this.bounds.maxLng - this.bounds.minLng;
    const ratio = lngSpan / Math.max(latSpan, 1e-9);
    const targetCells = 196;
    this.rows = Math.max(8, Math.round(Math.sqrt(targetCells / Math.max(ratio, 1e-9))));
    this.cols = Math.max(8, Math.round(this.rows * ratio));
  }

  setVisible(isVisible) {
    if (this.visible === isVisible) return;
    this.visible = isVisible;

    if (this.visible) {
      this.gridLayer.addTo(this.config.map);
      this.labelLayer.addTo(this.config.map);
    } else {
      this.config.map.removeLayer(this.gridLayer);
      this.config.map.removeLayer(this.labelLayer);
    }
  }

  updateData(data, isVisible) {
    this.setVisible(!!isVisible);
    if (!this.visible) return;
    if (!this.bounds) return;

    const prepared = this.buildGridCounts(data || []);
    this.renderGrid(prepared);
  }

  buildGridCounts(data) {
    const { minLat, maxLat, minLng, maxLng } = this.bounds;
    const latStep = (maxLat - minLat) / this.rows;
    const lngStep = (maxLng - minLng) / this.cols;
    const cells = Array.from({ length: this.rows * this.cols }, () => 0);

    data.forEach(d => {
      const lat = d.latitude;
      const lng = d.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return;

      const row = Math.min(this.rows - 1, Math.max(0, Math.floor((lat - minLat) / latStep)));
      const col = Math.min(this.cols - 1, Math.max(0, Math.floor((lng - minLng) / lngStep)));
      cells[(row * this.cols) + col] += 1;
    });

    return { cells, latStep, lngStep };
  }

  renderGrid(prepared) {
    const { minLat, minLng } = this.bounds;
    const { cells, latStep, lngStep } = prepared;
    const maxCount = d3.max(cells) || 1;

    // sqrt normalization so dense grid cells don't dominate the color range.
    const sqrtNorm = d3.scaleSqrt().domain([0, maxCount]).range([0, 1]).clamp(true);
    const colorScale = count => d3.interpolateYlGnBu(sqrtNorm(count));

    this.gridLayer.clearLayers();
    this.labelLayer.clearLayers();

    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const idx = (row * this.cols) + col;
        const count = cells[idx];
        const south = minLat + (row * latStep);
        const north = south + latStep;
        const west = minLng + (col * lngStep);
        const east = west + lngStep;

        const rect = L.rectangle([[south, west], [north, east]], {
          className: 'city-grid-heatmap-cell',
          color: '#1f2933',
          weight: 0.35,
          fillColor: colorScale(count),
          fillOpacity: count > 0 ? 0.58 : 0.08,
          interactive: false
        });
        rect.addTo(this.gridLayer);

        if (count > 0) {
          const center = [south + (latStep / 2), west + (lngStep / 2)];
          const marker = L.marker(center, {
            icon: L.divIcon({
              className: 'city-grid-heatmap-label',
              html: `<span>${count}</span>`,
              iconSize: [26, 14]
            }),
            interactive: false
          });
          marker.addTo(this.labelLayer);
        }
      }
    }
  }
}
