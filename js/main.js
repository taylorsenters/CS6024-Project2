let leafletMap;
let filterPanel;
let neighborhoodHeatmap;
let cityGridHeatmap;
let priorityPieChart;
let timelineChart;
let srTypeChart;
let methodChart;
let deptChart;
let allData = [];

// ── Timeline animation state ───────────────────────────────
let animationTimer = null;

function showAnimationTooltip(startDate, endDate) {
  var fmt = d3.timeFormat('%b %d, %Y');
  var panel = document.querySelector('.timeline-panel');
  if (!panel) return;
  var rect = panel.getBoundingClientRect();

  d3.select('#tooltip')
    .style('opacity', 1)
    .style('z-index', 1000000)
    .html(
      '<div class="tooltip-label timeline-tooltip">' +
        '<strong>From:</strong> ' + fmt(startDate) + '<br>' +
        '<strong>To:</strong> ' + fmt(endDate) +
      '</div>'
    )
    .style('left', (rect.left + rect.width / 2 - 60) + 'px')
    .style('top', (rect.top - 52) + 'px');
}

function startTimelineAnimation() {
  var btn = document.querySelector('#timeline-animate-btn');
  var field = globalState.timelineDateField;

  var validDates = allData
    .map(function(d) { return d[field]; })
    .filter(function(d) { return d; });

  if (validDates.length === 0) return;

  var minDate = d3.min(validDates);
  var maxDate = d3.max(validDates);
  var windowMs = 15 * 86400000;
  var currentStart = new Date(minDate.getTime());
  var currentEnd = new Date(currentStart.getTime() + windowMs);

  setGlobalState({ selectedDateRange: [currentStart, currentEnd], selectedPoint: null });
  showAnimationTooltip(currentStart, currentEnd);

  if (btn) {
    btn.innerHTML = '&#9632; Stop';
    btn.classList.add('playing');
  }

  animationTimer = setInterval(function() {
    currentStart = new Date(currentStart.getTime() + windowMs);
    currentEnd = new Date(currentStart.getTime() + windowMs);

    if (currentStart > maxDate) {
      stopTimelineAnimation();
      return;
    }

    setGlobalState({ selectedDateRange: [currentStart, currentEnd], selectedPoint: null });
    showAnimationTooltip(currentStart, currentEnd);
  }, 1200);
}

function stopTimelineAnimation() {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }

  // Keep the current selection so user can resize it with the brush handles
  var btn = document.querySelector('#timeline-animate-btn');
  if (btn) {
    btn.innerHTML = '&#9654; Play';
    btn.classList.remove('playing');
  }
}

function resetTimelineAnimation() {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }

  setGlobalState({ selectedDateRange: null, selectedPoint: null });
  d3.select('#tooltip').style('opacity', 0);

  var btn = document.querySelector('#timeline-animate-btn');
  if (btn) {
    btn.innerHTML = '&#9654; Play';
    btn.classList.remove('playing');
  }
}

// Establish the Global State Object
const globalState = {
  selectedType: 'ALL',
  selectedSrTypes: [],
  selectedNeighborhoods: [],
  selectedPriorities: [],
  selectedAgencies: [],
  selectedMethods: [],
  colorBy: 'timeGap',
  mapStyle: 'aerial',
  showCityHeatmap: false,
  timelineDateField: 'dateReceived',
  selectedDateRange: null,
  selectedPoint: null,
  brushedPoints: [],
  colorOverrides: {}  // { [colorBy]: { [category]: '#hexcolor' } }
};

// Central State Updater
function setGlobalState(newState) {
  Object.assign(globalState, newState);
  updateApp();
}

// Central Application Controller
function updateApp() {
  const typeFilteredData = globalState.selectedType === 'ALL'
    ? allData
    : allData.filter(d => d.srType === globalState.selectedType);

  // Helper: apply an array filter (empty array = no filter)
  const applyFilter = (data, arr, accessor) =>
    arr.length === 0 ? data : data.filter(d => arr.includes(accessor(d)));

  const getSrType = d => d.srType;
  const getNeighborhood = d => d.NEIGHBORHOOD || 'Unknown';
  const getPriority = d => d.PRIORITY || 'Unknown';
  const getAgency = d => d.DEPT_NAME || 'Unknown';
  const getMethod = d => d.METHOD_RECEIVED || 'Unknown';
  const getTimelineDate = d => d[globalState.timelineDateField];

  // Full cascade → map gets everything
  const withSrType  = applyFilter(typeFilteredData, globalState.selectedSrTypes, getSrType);
  const withNeighborhood = applyFilter(withSrType, globalState.selectedNeighborhoods, getNeighborhood);
  const withPriority = applyFilter(withNeighborhood, globalState.selectedPriorities, getPriority);
  const withAgency = applyFilter(withPriority, globalState.selectedAgencies, getAgency);
  const finalFilteredData = applyFilter(withAgency, globalState.selectedMethods, getMethod);

  // Each chart sees all active filters EXCEPT its own dimension,
  // so its elements stay visible (faded vs highlighted) rather than disappearing.
  const forSrTypeBar = applyFilter(applyFilter(applyFilter(applyFilter(typeFilteredData, globalState.selectedNeighborhoods, getNeighborhood), globalState.selectedPriorities, getPriority), globalState.selectedAgencies, getAgency), globalState.selectedMethods, getMethod);
  const forHeatmap   = applyFilter(applyFilter(applyFilter(applyFilter(typeFilteredData, globalState.selectedSrTypes, getSrType), globalState.selectedPriorities, getPriority), globalState.selectedAgencies, getAgency), globalState.selectedMethods, getMethod);
  const forPieChart  = applyFilter(applyFilter(applyFilter(applyFilter(typeFilteredData, globalState.selectedSrTypes, getSrType), globalState.selectedNeighborhoods, getNeighborhood), globalState.selectedAgencies, getAgency), globalState.selectedMethods, getMethod);
  const forAgencyBar = applyFilter(applyFilter(applyFilter(applyFilter(typeFilteredData, globalState.selectedSrTypes, getSrType), globalState.selectedNeighborhoods, getNeighborhood), globalState.selectedPriorities, getPriority), globalState.selectedMethods, getMethod);
  const forMethodBar = applyFilter(applyFilter(applyFilter(applyFilter(typeFilteredData, globalState.selectedSrTypes, getSrType), globalState.selectedNeighborhoods, getNeighborhood), globalState.selectedPriorities, getPriority), globalState.selectedAgencies, getAgency);

  // Date range filter helper — returns data unchanged when no range is selected
  const applyDateRange = (data) => {
    if (!globalState.selectedDateRange) return data;
    const [start, end] = globalState.selectedDateRange;
    return data.filter(d => getTimelineDate(d) && getTimelineDate(d) >= start && getTimelineDate(d) <= end);
  };

  // Timeline sees every filter EXCEPT date range (so the full date distribution stays visible)
  if (timelineChart) {
    timelineChart.update(finalFilteredData, globalState.selectedDateRange, globalState.timelineDateField);
  }
  const timelineSelectorEl = document.querySelector('#timeline-parameter-selector');
  if (timelineSelectorEl) {
    timelineSelectorEl.value = globalState.timelineDateField;
  }

  // All other views receive date-range-filtered data
  const dateFiltered = applyDateRange(finalFilteredData);

  leafletMap.updateState(globalState, dateFiltered, typeFilteredData);
  if (cityGridHeatmap) {
    cityGridHeatmap.updateData(dateFiltered, globalState.showCityHeatmap);
  }
  filterPanel.updateUI(globalState, dateFiltered.length, allData.length, dateFiltered, typeFilteredData);

  // When a map brush is active, charts show only the brushed subset so all views stay in sync
  const brushData = globalState.brushedPoints.length > 0 ? globalState.brushedPoints : null;

  srTypeChart.update(brushData || applyDateRange(forSrTypeBar), globalState.selectedSrTypes, typeFilteredData);
  deptChart.update(brushData || applyDateRange(forAgencyBar), globalState.selectedAgencies, typeFilteredData);
  methodChart.update(brushData || applyDateRange(forMethodBar), globalState.selectedMethods, typeFilteredData);
  neighborhoodHeatmap.updateData(brushData || applyDateRange(forHeatmap), globalState.selectedNeighborhoods, typeFilteredData);
  priorityPieChart.updateData(brushData || applyDateRange(forPieChart), globalState.selectedPriorities, typeFilteredData);
}
// Performance tracking
const appStartTime = performance.now();
console.log('🚀 Application initialization started...');

console.log('📂 Loading CSV data...');
const csvLoadStart = performance.now();

//d3.csv('data/311_sample_preprocessed_data.csv')
d3.csv('data/311_sampled_5000.csv')
  .then(data => {
    const csvLoadEnd = performance.now();
    console.log(`✅ CSV data loaded in ${(csvLoadEnd - csvLoadStart).toFixed(2)}ms`);

    console.log('🔄 Processing data...');
    const processingStart = performance.now();

    const parseDateCreated = d3.timeParse('%Y-%m-%d');
    const parseDateClosed = d3.timeParse('%m/%d/%y');
    data.forEach(d => {
      d.latitude = d.LATITUDE.trim() === '' ? NaN : +d.LATITUDE;
      d.longitude = d.LONGITUDE.trim() === '' ? NaN : +d.LONGITUDE;
      d.srType = d.SR_TYPE || 'Unknown';
      d.dateReceived = parseDateCreated(d.DATE_CREATED) || null;
      d.dateResolved = parseDateClosed(d.DATE_CLOSED) || null;
    });

    allData = data.filter(d => Number.isFinite(d.latitude) && Number.isFinite(d.longitude));
    const missingGpsCount = data.filter(d => d.MISSING_GPS === 'TRUE').length;

    const processingEnd = performance.now();
    console.log(`✅ Data processing completed in ${(processingEnd - processingStart).toFixed(2)}ms`);
    console.log('📊 Number of items: ' + allData.length);
    console.log('⚠️ Number of missing GPS items: ' + missingGpsCount);

    // Initialize Leaflet Map
    console.log('🗺️ Loading Leaflet Map...');
    const mapStart = performance.now();
    leafletMap = new LeafletMap({
      parentElement: '#my-map',
      onPointSelect: point => {
        // Toggle logic: if clicking the currently selected point, unclick it (set to null)
        if (globalState.selectedPoint && point && globalState.selectedPoint.SR_NUMBER === point.SR_NUMBER) {
          setGlobalState({ selectedPoint: null });
        } else {
          setGlobalState({ selectedPoint: point });
        }
      },
      onMapClick: () => {
        setGlobalState({ selectedPoint: null });
      }
    }, allData);
    const mapEnd = performance.now();
    console.log(`✅ Leaflet Map loaded in ${(mapEnd - mapStart).toFixed(2)}ms`);

    // Initialize city-wide grid heatmap overlay
    cityGridHeatmap = new CityGridHeatmap({
      map: leafletMap.theMap
    }, allData);

    // Initialize Neighborhood Heatmap
    console.log('🔥 Loading Neighborhood Heatmap...');
    const heatmapStart = performance.now();
    neighborhoodHeatmap = new NeighborhoodHeatmap({
      parentElement: '#chart-neighborhood .chart-body',
      legendElement: '#chart-neighborhood .chart-legend-container',
      onTileSelect: neighborhoods => {
        setGlobalState({ selectedNeighborhoods: neighborhoods, selectedPoint: null });
      }
    });
    const heatmapEnd = performance.now();
    console.log(`✅ Neighborhood Heatmap loaded in ${(heatmapEnd - heatmapStart).toFixed(2)}ms`);

    // Initialize Priority Pie Chart
    console.log('🥧 Loading Priority Pie Chart...');
    const pieStart = performance.now();
    priorityPieChart = new PriorityPieChart({
      parentElement: '#chart-priority .chart-body',
      legendElement: '#chart-priority .chart-legend-container',
      onSliceSelect: priorities => {
        setGlobalState({ selectedPriorities: priorities, selectedPoint: null });
      }
    });
    const pieEnd = performance.now();
    console.log(`✅ Priority Pie Chart loaded in ${(pieEnd - pieStart).toFixed(2)}ms`);

    // Initialize Timeline Chart
    console.log('📈 Loading Timeline Chart...');
    const timelineStart = performance.now();
    timelineChart = new TimelineChart({
      parentElement: '#chart-timeline',
      onBrushSelect: (dateRange) => {
        setGlobalState({ selectedDateRange: dateRange, selectedPoint: null });
      }
    });
    const timelineParameterSelector = document.querySelector('#timeline-parameter-selector');
    if (timelineParameterSelector) {
      timelineParameterSelector.addEventListener('change', (event) => {
        if (animationTimer) stopTimelineAnimation();
        setGlobalState({
          timelineDateField: event.target.value,
          selectedDateRange: null,
          selectedPoint: null
        });
      });
    }
    var animateBtn = document.querySelector('#timeline-animate-btn');
    if (animateBtn) {
      animateBtn.addEventListener('click', function() {
        if (animationTimer) {
          stopTimelineAnimation();
        } else {
          startTimelineAnimation();
        }
      });
    }
    var resetBtn = document.querySelector('#timeline-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        resetTimelineAnimation();
      });
    }
    const timelineEnd = performance.now();
    console.log(`✅ Timeline Chart loaded in ${(timelineEnd - timelineStart).toFixed(2)}ms`);

    // Initialize Filter Panel
    console.log('🎛️ Loading Filter Panel...');
    const filterStart = performance.now();
    filterPanel = new FilterPanel(allData, missingGpsCount, {
      onFilterChange: (newFilters) => {
        setGlobalState(newFilters);
      },
      onClearSelection: () => {
        setGlobalState({
          selectedSrTypes: [],
          selectedNeighborhoods: [],
          selectedPriorities: [],
          selectedAgencies: [],
          selectedMethods: [],
          selectedDateRange: null,
          selectedPoint: null
        });
      },
      onBrushMapToggle: () => leafletMap.toggleBrushMode(),
      onColorOverride: (colorBy, category, color) => {
        const overrides = { ...(globalState.colorOverrides || {}) };
        overrides[colorBy] = { ...(overrides[colorBy] || {}), [category]: color };
        setGlobalState({ colorOverrides: overrides });
      },
      onColorReset: (colorBy) => {
        const overrides = { ...(globalState.colorOverrides || {}) };
        delete overrides[colorBy];
        setGlobalState({ colorOverrides: overrides });
      }
    });
    const filterEnd = performance.now();
    console.log(`✅ Filter Panel loaded in ${(filterEnd - filterStart).toFixed(2)}ms`);

    // Initialize SR Type Bar Chart
    console.log('📊 Loading SR Type Bar Chart...');
    const srTypeStart = performance.now();
    srTypeChart = new BarChart({
      parentElement: '#chart-sr-type .chart-body',
      legendElement: '#chart-sr-type .chart-legend-container',
      xKey: 'srType',
      yKey: 'Requests',
      scrollable: true,
      topN: 10,
      label: 'Request Type',
      onBarSelect: srTypes => {
        setGlobalState({ selectedSrTypes: srTypes, selectedPoint: null });
      }
    }, allData);
    const srTypeEnd = performance.now();
    console.log(`✅ SR Type Bar Chart loaded in ${(srTypeEnd - srTypeStart).toFixed(2)}ms`);

    // Initialize Method Bar Chart
    console.log('📊 Loading Method Received Bar Chart...');
    const methodStart = performance.now();
    methodChart = new BarChart({
      parentElement: '#chart-method-received .chart-body',
      legendElement: '#chart-method-received .chart-legend-container',
      xKey: 'METHOD_RECEIVED',
      yKey: 'Requests',
      scrollable: true,
      margin: { top: 6, right: 32, bottom: 6, left: 52 },
      label: 'Method',
      onBarSelect: methods => {
        setGlobalState({ selectedMethods: methods, selectedPoint: null });
      }
    }, allData);
    const methodEnd = performance.now();
    console.log(`✅ Method Received Bar Chart loaded in ${(methodEnd - methodStart).toFixed(2)}ms`);

    // Initialize Agency Bar Chart
    console.log('📊 Loading Agency Bar Chart...');
    const deptStart = performance.now();
    deptChart = new BarChart({
      parentElement: '#chart-agency .chart-body',
      legendElement: '#chart-agency .chart-legend-container',
      xKey: 'DEPT_NAME',
      yKey: 'Requests',
      scrollable: true,
      label: 'Agency',
      onBarSelect: agencies => {
        setGlobalState({ selectedAgencies: agencies, selectedPoint: null });
      }
    }, allData);
    const deptEnd = performance.now();
    console.log(`✅ Agency Bar Chart loaded in ${(deptEnd - deptStart).toFixed(2)}ms`);

    // Run initial update to sync everything
    console.log('🔄 Running initial app update...');
    const updateStart = performance.now();
    updateApp();
    const updateEnd = performance.now();
    console.log(`✅ Initial app update completed in ${(updateEnd - updateStart).toFixed(2)}ms`);

    // Total time
    const appEndTime = performance.now();
    const totalLoadTime = appEndTime - appStartTime;
    console.log(`\n⏱️ ========== TOTAL LOAD TIME: ${totalLoadTime.toFixed(2)}ms ==========`);
    console.log('🎉 Application fully initialized and ready!');
  })
  .catch(error => {
    console.error('❌ Error loading application:', error);
    const appErrorTime = performance.now();
    console.log(`⏱️ Application failed after ${(appErrorTime - appStartTime).toFixed(2)}ms`);
  });