class FilterPanel {
  constructor(initialData, missingGpsCount, config) {
    this.config = config;
    this.missingGpsCount = missingGpsCount;

    this.typeSelector = document.querySelector('#sr-type-selector');
    this.colorBySelector = document.querySelector('#color-by-selector');
    this.mapStyleToggle = document.querySelector('#map-style-toggle');
    this.cityHeatmapToggle = document.querySelector('#city-heatmap-toggle');
    this.brushMapBtn = document.querySelector('#brush-map-btn');
    this.filterSummary = document.querySelector('#filter-summary');
    this.selectedPointPanel = document.querySelector('.selected-point-panel');
    this.selectedPointDetails = document.querySelector('#selected-point-details');
    this.clearSelectionButton = document.querySelector('#clear-selection');
    this.colorLegend = document.querySelector('#color-legend');

    this.missingGpsEl = document.querySelector('#missing-gps');

    this.renderTypeSelector(initialData);
    this.renderMissingGps();
    this.bindEvents();
  }

  bindEvents() {
    this.typeSelector.addEventListener('change', event => {
      this.config.onFilterChange({ selectedType: event.target.value });
    });

    this.colorBySelector.addEventListener('change', event => {
      this.config.onFilterChange({ colorBy: event.target.value });
    });

    this.mapStyleToggle.addEventListener('click', () => {
      const currentStyle = this.mapStyleToggle.textContent.includes('Aerial') ? 'aerial' : 'streets';
      const nextStyle = currentStyle === 'aerial' ? 'streets' : 'aerial';
      this.config.onFilterChange({ mapStyle: nextStyle });
    });

    if (this.cityHeatmapToggle) {
      this.cityHeatmapToggle.addEventListener('click', () => {
        const isOn = this.cityHeatmapToggle.textContent.includes('On');
        this.config.onFilterChange({ showCityHeatmap: !isOn });
      });
    }

    if (this.brushMapBtn) {
      this.brushMapBtn.addEventListener('click', () => {
        if (this.config.onBrushMapToggle) {
          const isNowOn = this.config.onBrushMapToggle();
          this.brushMapBtn.textContent = isNowOn ? 'Brush Map: On' : 'Brush Map: Off';
          this.brushMapBtn.classList.toggle('active', isNowOn);
        }
      });
    }

    this.clearSelectionButton.addEventListener('click', () => {
      if (this.config.onClearSelection) {
        this.config.onClearSelection();
      }
    });
  }

  renderMissingGps() {
    if (!this.missingGpsEl) return;
    if (this.missingGpsCount === 0) {
      this.missingGpsEl.textContent = '';
      return;
    }
    this.missingGpsEl.innerHTML =
      `⚠ <strong>${this.missingGpsCount}</strong> call${this.missingGpsCount !== 1 ? 's' : ''} missing GPS coordinates (excluded from map).`;
  }

  renderColorLegend(globalState, filteredData) {
    if (!this.colorLegend) return;
    this.colorLegend.innerHTML = '';

    if (globalState.colorBy === 'timeGap') {
      // Build gradient stops from d3.interpolateYlOrRd
      const stops = d3.range(11).map(i => d3.interpolateYlOrRd(i / 10));

      // Mirror the domain logic from leafletMap.js
      const values = filteredData.map(d => {
        const req = new Date(d.DATE_CREATED || d.DATE_TIME_RECEIVED || d.TIME_RECEIVED || '');
        const upd = new Date(d.DATE_LAST_UPDATE || d.DATE_STATUS_CHANGE || d.DATE_CLOSED || '');
        if (!isFinite(req) || !isFinite(upd)) return null;
        return Math.max(0, (upd - req) / 86400000);
      }).filter(v => v !== null);

      const [minDays, maxDays] = values.length > 0 ? d3.extent(values) : [0, 1];

      this.colorLegend.innerHTML = `
        <div class="legend-gradient-bar" style="background: linear-gradient(to right, ${stops.join(',')})"></div>
        <div class="legend-gradient-labels">
          <span>${Math.round(minDays)} days</span>
          <span>${Math.round(maxDays)} days</span>
        </div>`;
    } else if (globalState.colorBy === 'priority') {
      const labelMap = { 'STANDARD': 'Standard', 'HAZARDOUS': 'Hazardous', 'PRIORITY': 'Priority' };
      const priorityOverrides = (globalState.colorOverrides || {}).priority || {};
      const hasOverrides = Object.keys(priorityOverrides).length > 0;
      const items = Object.entries(PRIORITY_COLORS).map(([key, defaultColor]) => {
        const hex = d3.color(priorityOverrides[key] || defaultColor)?.formatHex() || defaultColor;
        return `
          <div class="legend-swatch-item">
            <input type="color" class="legend-color-picker" value="${hex}" data-category="${key}" title="Customize color">
            <span class="legend-swatch-label">${labelMap[key] || key}</span>
          </div>`;
      }).join('');
      const resetHtml = hasOverrides ? `<button class="legend-reset-btn">Reset colors</button>` : '';
      this.colorLegend.innerHTML = `<div class="legend-swatch-list">${items}</div>${resetHtml}`;
      this._bindColorPickerEvents('priority');
    } else {
      // Ordinal scale for neighborhood, agency, and srType
      const accessor = {
        neighborhood: d => d.NEIGHBORHOOD || 'Unknown',
        agency:       d => d.DEPT_NAME    || 'Unknown',
        srType:       d => d.srType       || 'Unknown',
      }[globalState.colorBy];

      const categories = [...new Set(filteredData.map(accessor))].sort(d3.ascending);
      const scale = d3.scaleOrdinal(CATEGORICAL_PALETTE).domain(categories);
      const overrides = (globalState.colorOverrides || {})[globalState.colorBy] || {};
      const hasOverrides = categories.some(cat => overrides[cat]);

      const items = categories.map(cat => {
        const hex = d3.color(overrides[cat] || scale(cat))?.formatHex() || '#cccccc';
        const safeAttr = cat.replace(/"/g, '&quot;');
        return `
          <div class="legend-swatch-item">
            <input type="color" class="legend-color-picker" value="${hex}" data-category="${safeAttr}" title="Customize color">
            <span class="legend-swatch-label">${cat}</span>
          </div>`;
      }).join('');
      const resetHtml = hasOverrides ? `<button class="legend-reset-btn">Reset colors</button>` : '';
      this.colorLegend.innerHTML = `<div class="legend-swatch-list">${items}</div>${resetHtml}`;
      this._bindColorPickerEvents(globalState.colorBy);
    }
  }

  _bindColorPickerEvents(colorBy) {
    this.colorLegend.querySelectorAll('.legend-color-picker').forEach(input => {
      input.addEventListener('change', e => {
        const category = e.target.getAttribute('data-category');
        if (this.config.onColorOverride) {
          this.config.onColorOverride(colorBy, category, e.target.value);
        }
      });
    });
    const resetBtn = this.colorLegend.querySelector('.legend-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (this.config.onColorReset) this.config.onColorReset(colorBy);
      });
    }
  }

  renderTypeSelector(data) {
    const countsByType = d3.rollups(
      data,
      values => values.length,
      d => d.srType
    ).sort((a, b) => d3.ascending(a[0], b[0]));

    this.typeSelector.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'ALL';
    allOption.textContent = `All Types (${data.length})`;
    this.typeSelector.appendChild(allOption);

    countsByType.forEach(([srType, count]) => {
      const option = document.createElement('option');
      option.value = srType;
      option.textContent = `${srType} (${count})`;
      this.typeSelector.appendChild(option);
    });
  }

  // Called by main.js whenever global state changes
  updateUI(globalState, visibleCount, totalCount, filteredData, colorBaseData) {
    // 1. Sync Map Style Button Text
    this.mapStyleToggle.textContent = globalState.mapStyle === 'aerial'
      ? 'Basemap: Aerial'
      : 'Basemap: Roads/Boundaries';
    if (this.cityHeatmapToggle) {
      this.cityHeatmapToggle.textContent = globalState.showCityHeatmap
        ? 'City Heatmap: On'
        : 'City Heatmap: Off';
      this.cityHeatmapToggle.classList.toggle('active', !!globalState.showCityHeatmap);
    }

    // 2. Sync Selectors (in case state was changed externally)
    this.typeSelector.value = globalState.selectedType;
    this.colorBySelector.value = globalState.colorBy;

    // 3. Update Summary Text
    const totalTypes = this.typeSelector.options.length - 1; // minus "ALL"
    this.filterSummary.textContent = `${visibleCount} points visible across ${totalTypes} request types.`;

    // 4. Update Color Legend (use colorBaseData so legend stays stable during cross-chart filtering)
    this.renderColorLegend(globalState, colorBaseData || filteredData || []);

    // 5. Show clear button whenever any chart selection is active
    const hasAnySelection = globalState.selectedPoint !== null
      || (globalState.selectedSrTypes || []).length > 0
      || (globalState.selectedNeighborhoods || []).length > 0
      || (globalState.selectedPriorities || []).length > 0
      || (globalState.selectedAgencies || []).length > 0
      || (globalState.selectedMethods || []).length > 0
      || globalState.selectedDateRange !== null;
    this.clearSelectionButton.style.display = hasAnySelection ? 'block' : 'none';

    // 6. Update Selected Point Panel
    if (!globalState.selectedPoint) {
      this.selectedPointPanel.style.display = 'none';
      this.selectedPointDetails.innerHTML = '';
    } else {
      this.selectedPointPanel.style.display = 'block';
      const excludeFields = new Set(['MISSING_GPS', 'latitude', 'longitude', 'srType', 'dateReceived', 'dateResolved']);
      const rows = Object.entries(globalState.selectedPoint)
        .filter(([key]) => !excludeFields.has(key))
        .map(([key, value]) => {
          let display = (value === null || value === undefined || value === '') ? 'N/A' : value;
          // Format date fields to YYYY-MM-DD to match DATE_CREATED
          if ((key === 'DATE_CLOSED' || key === 'DATE_LAST_UPDATE') && display !== 'N/A') {
            const d = new Date(display);
            if (!isNaN(d.getTime())) display = d.toISOString().slice(0, 10);
          }
          return `<div class="detail-row"><span class="detail-key">${key}:</span> ${display}</div>`;
        });
      this.selectedPointDetails.innerHTML = rows.join('');
    }
  }
}