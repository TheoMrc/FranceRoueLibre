const dom = {
  theme: document.getElementById('themeToggle'),
  modeTabs: [...document.querySelectorAll('[data-mode]')],
  metricButtons: [...document.querySelectorAll('[data-metric]')],
  search: document.getElementById('search'),
  region: document.getElementById('region'),
  scheme: document.getElementById('scheme'),
  schemeFilter: document.querySelector('.scheme-filter'),
  reset: document.getElementById('reset'),
  totalLabel: document.getElementById('totalLabel'),
  totalAmount: document.getElementById('totalAmount'),
  countLabel: document.getElementById('countLabel'),
  projectCount: document.getElementById('projectCount'),
  coverageLabel: document.getElementById('coverageLabel'),
  departmentCount: document.getElementById('departmentCount'),
  statsContext: document.getElementById('statsContext'),
  filterTitle: document.getElementById('filterTitle'),
  mapKicker: document.getElementById('mapKicker'),
  mapTitle: document.getElementById('mapTitle'),
  mapSubtitle: document.getElementById('mapSubtitle'),
  mapUnit: document.getElementById('mapUnit'),
  mapFrame: document.getElementById('mapFrame'),
  map: document.getElementById('map'),
  mapScene: document.getElementById('mapScene'),
  mapLayer: document.getElementById('mapLayer'),
  communeLayer: document.getElementById('communeLayer'),
  mapPoints: document.getElementById('mapPoints'),
  mapLabels: document.getElementById('mapLabels'),
  tooltip: document.getElementById('mapTooltip'),
  mapBadgeText: document.getElementById('mapBadgeText'),
  legendTitle: document.getElementById('legendTitle'),
  legendLow: document.getElementById('legendLow'),
  legendHigh: document.getElementById('legendHigh'),
  mapHelp: document.getElementById('mapHelp'),
  inspectorCard: document.querySelector('.inspector-card'),
  inspectorKicker: document.getElementById('inspectorKicker'),
  inspectorTitle: document.getElementById('inspectorTitle'),
  inspectorSummary: document.getElementById('inspectorSummary'),
  inspectorStats: document.getElementById('inspectorStats'),
  listHeading: document.getElementById('listHeading'),
  listCount: document.getElementById('listCount'),
  projectList: document.getElementById('projectList'),
  more: document.getElementById('more'),
  clearSelection: document.getElementById('clearSelection'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  resetView: document.getElementById('resetView'),
  dataStatus: document.getElementById('dataStatus'),
  scopeText: document.getElementById('scopeText')
};

const state = {
  mode: 'projects',
  metric: 'total',
  region: '',
  scheme: '',
  search: '',
  selectedDepartment: '',
  selectedCommune: '',
  zoomDelta: 0,
  limit: 8
};

const data = {
  projects: [],
  communes: [],
  departments: [],
  regions: [],
  features: [],
  featureByCode: new Map(),
  communeByCode: new Map(),
  deptByCode: new Map(),
  regionByName: new Map(),
  regionByCode: new Map(),
  populationByDepartment: new Map(),
  communeTotalsByDepartment: new Map(),
  communePopByDepartment: new Map(),
  projectRows: [],
  projectTotalsByDepartment: new Map(),
  projectionBounds: null,
  regionPaths: new Map(),
  regionPathElements: new Map(),
  communeBoundaries: null,
  communeFeatures: [],
  communeFeatureByCode: new Map(),
  communePathByCode: new Map(),
  communePath2DByCode: new Map(),
  communeHitGrid: new Map(),
  departmentPath2DByCode: new Map(),
  departmentHitGrid: new Map(),
  hitContext: null,
  activeCommuneRowsByCode: new Map(),
  communeHoverElement: null,
  currentMapDepartmentValues: new Map(),
  communeLayerKey: '',
  performance: { communeLayerRenderMs: 0, communeSvgElements: 0 }
};

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const lowerText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr-FR');
const matches = (value, query) => !query || lowerText(value).includes(lowerText(query));
const COMMUNE_COLOR_BUCKETS = 12;
const HIT_GRID_SIZE = 12;
const mapMotion = {
  current: null,
  from: null,
  target: null,
  startedAt: 0,
  duration: 0,
  frame: 0,
  frameCount: 0
};
const normalizeDepartment = code => {
  const value = String(code ?? '');
  if (value === '67A') return '67';
  if (value === '691') return '69';
  return value;
};
const isOverseasCode = code => String(code ?? '').length > 2;

function formatCount(value) {
  return numberFormat.format(Math.round(value || 0));
}

function formatCompact(value) {
  const number = Math.abs(value || 0);
  if (number >= 1e9) return `${(value / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Md€`;
  if (number >= 1e6) return `${(value / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (number >= 1e3) return `${(value / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k€`;
  return `${numberFormat.format(value || 0)} €`;
}

function formatValue(value, perCapita = false) {
  if (!Number.isFinite(value)) return '—';
  if (perCapita) return `${decimalFormat.format(value)} €/hab.`;
  return formatCompact(value);
}

function formatLongValue(value, perCapita = false) {
  if (!Number.isFinite(value)) return '—';
  return perCapita ? `${decimalFormat.format(value)} €/habitant` : `${numberFormat.format(Math.round(value))} €`;
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + (Number(getter(row)) || 0), 0);
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setText(node, value) {
  if (node) node.textContent = value;
}

function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function walkCoordinates(coords, callback) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') callback(coords);
  else coords.forEach(item => walkCoordinates(item, callback));
}

function projectPoint(coords) {
  const [lon, lat] = coords || [];
  const bounds = data.projectionBounds;
  if (!bounds || !Number.isFinite(lon) || !Number.isFinite(lat)) return { x: 450, y: 310 };
  // Correct longitude for the latitude of France so the country keeps its geographic proportions.
  const x = bounds.offsetX + (lon - bounds.centerLon) * bounds.cosLat * bounds.scale;
  const y = bounds.offsetY - (lat - bounds.centerLat) * bounds.scale;
  return { x, y };
}

function featurePath(feature) {
  const geometry = feature.geometry;
  if (!geometry) return '';
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates || [];
  return polygons.map(polygon => polygon.map((ring, ringIndex) => {
    const line = ring.map((coords, pointIndex) => {
      const point = projectPoint(coords);
      return `${pointIndex ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    }).join(' ');
    return `${line} Z`;
  }).join(' ')).join(' ');
}

function projectedFeatureBounds(feature) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  walkCoordinates(feature.geometry?.coordinates, coords => {
    const point = projectPoint(coords);
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  });
  if (!Number.isFinite(minX)) return { minX: 450, maxX: 450, minY: 310, maxY: 310 };
  return { minX, maxX, minY, maxY };
}

function hitGridKey(x, y) {
  return Math.floor(x / HIT_GRID_SIZE) + ',' + Math.floor(y / HIT_GRID_SIZE);
}

function registerHitFeature(feature, code, pathData, pathMap, grid) {
  if (!pathData || typeof Path2D !== 'function') return;
  pathMap.set(code, new Path2D(pathData));
  const bounds = projectedFeatureBounds(feature);
  const minCellX = Math.floor(bounds.minX / HIT_GRID_SIZE);
  const maxCellX = Math.floor(bounds.maxX / HIT_GRID_SIZE);
  const minCellY = Math.floor(bounds.minY / HIT_GRID_SIZE);
  const maxCellY = Math.floor(bounds.maxY / HIT_GRID_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const key = cellX + ',' + cellY;
      const bucket = grid.get(key) || [];
      bucket.push(code);
      grid.set(key, bucket);
    }
  }
}

function buildGeometryHitIndexes() {
  const canvas = document.createElement('canvas');
  data.hitContext = canvas.getContext('2d');
  data.communePath2DByCode.clear();
  data.communeHitGrid.clear();
  data.departmentPath2DByCode.clear();
  data.departmentHitGrid.clear();
  if (!data.hitContext) return;
  data.communeFeatures.forEach(feature => {
    const code = String(feature.properties?.code || '');
    registerHitFeature(feature, code, data.communePathByCode.get(code), data.communePath2DByCode, data.communeHitGrid);
  });
  data.features.forEach(feature => {
    const code = String(feature.properties?.code || '');
    registerHitFeature(feature, code, featurePath(feature), data.departmentPath2DByCode, data.departmentHitGrid);
  });
}

function scenePointFromEvent(event) {
  const matrix = dom.mapScene.getScreenCTM();
  if (!matrix) return null;
  const point = dom.map.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

function codeAtScenePoint(point, grid, pathMap, activeCodes) {
  if (!point || !data.hitContext) return '';
  const candidates = grid.get(hitGridKey(point.x, point.y)) || [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const code = candidates[index];
    if (activeCodes && !activeCodes.has(code)) continue;
    const path = pathMap.get(code);
    if (path && data.hitContext.isPointInPath(path, point.x, point.y, 'evenodd')) return code;
  }
  return '';
}

function communeCodeAtScenePoint(x, y) {
  return codeAtScenePoint({ x, y }, data.communeHitGrid, data.communePath2DByCode, data.activeCommuneRowsByCode);
}

function departmentCodeAtScenePoint(x, y) {
  return codeAtScenePoint({ x, y }, data.departmentHitGrid, data.departmentPath2DByCode);
}

function updateCommuneHover(code) {
  const path = data.communeHoverElement;
  if (!path || !code || !data.activeCommuneRowsByCode.has(code)) {
    if (path) path.style.display = 'none';
    return;
  }
  path.setAttribute('d', data.communePathByCode.get(code) || '');
  path.style.display = '';
}

function featureRegionName(feature) {
  return data.regionByCode.get(String(feature.properties?.region ?? ''))?.name || '';
}

function regionForDepartment(code) {
  const normalized = normalizeDepartment(code);
  const department = data.deptByCode.get(normalized);
  if (department?.regionName) return department.regionName;
  const feature = data.featureByCode.get(normalized);
  return feature ? (featureRegionName(feature) || feature.properties?.nom || '') : '';
}

function populationForDepartment(code) {
  return data.populationByDepartment.get(normalizeDepartment(code)) || 0;
}

function populationForProject(row) {
  return row.communeData?.population || populationForDepartment(row.department);
}

function projectMetric(row) {
  if (state.metric === 'total') return row.amount;
  const population = populationForProject(row);
  return population ? row.amount / population : 0;
}

function valueForBudget(row) {
  return state.metric === 'total' ? row.total : row.perCapita;
}

function aggregateRows(rows, options = {}) {
  const total = sum(rows, row => options.getTotal ? options.getTotal(row) : row.total ?? row.amount);
  const population = sum(rows, row => options.getPopulation ? options.getPopulation(row) : row.population);
  return { total, population, perCapita: population ? total / population : 0 };
}

function projectRowsForScope(rows) {
  if (!state.selectedDepartment && !state.selectedCommune) return rows;
  return rows.filter(row => {
    if (state.selectedCommune && row.commune !== state.selectedCommune) return false;
    if (state.selectedDepartment && normalizeDepartment(row.department) !== normalizeDepartment(state.selectedDepartment)) return false;
    return true;
  });
}

function filteredProjects() {
  const rows = data.projectRows.filter(row => {
    if (state.region && row.regionName !== state.region) return false;
    if (state.scheme && row.scheme !== state.scheme) return false;
    if (state.selectedDepartment && normalizeDepartment(row.department) !== normalizeDepartment(state.selectedDepartment)) return false;
    if (state.selectedCommune && row.commune !== state.selectedCommune) return false;
    if (!state.search) return true;
    return [row.title, row.beneficiary, row.scheme, row.communeData?.name, row.departmentName].some(value => matches(value, state.search));
  });
  return rows;
}

function filteredCommunes() {
  return data.communes.filter(row => {
    if (state.region && row.regionName !== state.region) return false;
    if (state.selectedDepartment && normalizeDepartment(row.department) !== normalizeDepartment(state.selectedDepartment)) return false;
    if (state.selectedCommune && row.code !== state.selectedCommune) return false;
    if (!state.search) return true;
    return [row.name, row.code, row.departmentName, row.regionName].some(value => matches(value, state.search));
  });
}

function filteredDepartments() {
  return data.departments.filter(row => {
    if (state.region && row.regionName !== state.region) return false;
    if (state.selectedDepartment && normalizeDepartment(row.code) !== normalizeDepartment(state.selectedDepartment)) return false;
    if (!state.search) return true;
    return [row.name, row.code, row.regionName].some(value => matches(value, state.search));
  });
}

function filteredRegions() {
  return data.regions.filter(row => {
    if (state.region && row.name !== state.region) return false;
    if (!state.search) return true;
    return [row.name, row.code].some(value => matches(value, state.search));
  });
}

function currentRows() {
  if (state.mode === 'communes') return filteredCommunes();
  if (state.mode === 'departments') return filteredDepartments();
  if (state.mode === 'regions') return filteredRegions();
  return filteredProjects();
}

function setupProjection() {
  const points = [];
  data.features.filter(feature => !isOverseasCode(feature.properties?.code)).forEach(feature => walkCoordinates(feature.geometry?.coordinates, coords => points.push(coords)));
  const lons = points.map(point => point[0]);
  const lats = points.map(point => point[1]);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const centerLon = (minLon + maxLon) / 2; const centerLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const projectedWidth = (maxLon - minLon) * cosLat;
  const projectedHeight = maxLat - minLat;
  const scale = Math.min(790 / (projectedWidth || 1), 540 / (projectedHeight || 1));
  data.projectionBounds = { minLon, maxLon, minLat, maxLat, centerLon, centerLat, cosLat, scale, offsetX: 450, offsetY: 310 };
}

function coordinateKey(coords) {
  return Number(coords[0]).toFixed(5) + ',' + Number(coords[1]).toFixed(5);
}

function regionNameForCode(regionCode) {
  const known = data.regionByCode.get(String(regionCode));
  if (known?.name) return known.name;
  const feature = data.features.find(item => String(item.properties?.region || '') === String(regionCode));
  return feature?.properties?.nom || String(regionCode);
}

function addRegionSegment(segments, a, b) {
  const aKey = coordinateKey(a);
  const bKey = coordinateKey(b);
  if (aKey === bKey) return;
  const key = [aKey, bKey].sort().join('|');
  const existing = segments.get(key);
  if (existing) existing.count += 1;
  else segments.set(key, { aKey, bKey, a, b, count: 1 });
}

function buildRegionPaths() {
  data.regionPaths.clear();
  const grouped = new Map();
  data.features.forEach(feature => {
    const regionCode = String(feature.properties?.region || '');
    if (!regionCode) return;
    if (!grouped.has(regionCode)) grouped.set(regionCode, new Map());
    const segments = grouped.get(regionCode);
    const polygons = feature.geometry?.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry?.coordinates || [];
    polygons.forEach(polygon => polygon.forEach(ring => {
      if (!Array.isArray(ring) || ring.length < 2) return;
      for (let index = 0; index < ring.length - 1; index++) addRegionSegment(segments, ring[index], ring[index + 1]);
      if (coordinateKey(ring[0]) !== coordinateKey(ring[ring.length - 1])) addRegionSegment(segments, ring[ring.length - 1], ring[0]);
    }));
  });
  grouped.forEach((segments, regionCode) => {
    const boundary = [...segments.values()].filter(segment => segment.count === 1);
    const adjacency = new Map();
    const coordinates = new Map();
    boundary.forEach((segment, index) => {
      segment.index = index;
      coordinates.set(segment.aKey, segment.a);
      coordinates.set(segment.bKey, segment.b);
      if (!adjacency.has(segment.aKey)) adjacency.set(segment.aKey, []);
      if (!adjacency.has(segment.bKey)) adjacency.set(segment.bKey, []);
      adjacency.get(segment.aKey).push({ index, key: segment.bKey });
      adjacency.get(segment.bKey).push({ index, key: segment.aKey });
    });
    const visited = new Set();
    const paths = [];
    boundary.forEach(segment => {
      if (visited.has(segment.index)) return;
      const keys = [segment.aKey];
      let current = segment.aKey;
      let previous = '';
      let guard = 0;
      while (guard++ < boundary.length + 4) {
        const candidates = adjacency.get(current) || [];
        const next = candidates.find(candidate => !visited.has(candidate.index) && candidate.key !== previous) || candidates.find(candidate => !visited.has(candidate.index));
        if (!next) break;
        visited.add(next.index);
        previous = current;
        current = next.key;
        keys.push(current);
        if (current === keys[0]) break;
      }
      if (keys.length >= 4) {
        const projected = keys.map(key => projectPoint(coordinates.get(key)));
        paths.push('M' + projected.map(point => point.x.toFixed(2) + ',' + point.y.toFixed(2)).join(' L') + ' Z');
      }
    });
    data.regionPaths.set(regionCode, paths.join(' '));
  });
}
function setupDerivedData() {
  data.features = data.boundaries.features || [];
  data.features.forEach(feature => data.featureByCode.set(String(feature.properties?.code || ''), feature));
  data.communes.forEach(row => data.communeByCode.set(row.code, row));
  data.departments.forEach(row => data.deptByCode.set(normalizeDepartment(row.code), row));
  data.regions.forEach(row => { data.regionByCode.set(String(row.code), row); data.regionByName.set(row.name, row); });

  data.communes.forEach(row => {
    const department = normalizeDepartment(row.department);
    data.populationByDepartment.set(department, (data.populationByDepartment.get(department) || 0) + (row.population || 0));
    data.communeTotalsByDepartment.set(department, (data.communeTotalsByDepartment.get(department) || 0) + row.total);
    data.communePopByDepartment.set(department, (data.communePopByDepartment.get(department) || 0) + (row.population || 0));
  });

  data.projectRows = data.projects.map(row => {
    const communeData = data.communeByCode.get(row.commune);
    const department = normalizeDepartment(row.department);
    return {
      ...row,
      department,
      departmentName: data.deptByCode.get(department)?.name || data.featureByCode.get(department)?.properties?.nom || row.department,
      regionName: regionForDepartment(department),
      communeData
    };
  });
  data.projectRows.forEach(row => {
    const bucket = data.projectTotalsByDepartment.get(row.department) || { total: 0 };
    bucket.total += row.amount;
    data.projectTotalsByDepartment.set(row.department, bucket);
  });
  setupProjection();
  buildRegionPaths();
  data.communeFeatures = data.communeBoundaries?.features || [];
  data.communeFeatureByCode.clear();
  data.communePathByCode.clear();
  data.communeFeatures.forEach(feature => {
    const code = String(feature.properties?.code || '');
    data.communeFeatureByCode.set(code, feature);
    data.communePathByCode.set(code, featurePath(feature));
  });
  const hitIndexStarted = performance.now();
  buildGeometryHitIndexes();
  data.performance.hitIndexBuildMs = performance.now() - hitIndexStarted;
  document.documentElement.dataset.hitIndexBuildMs = data.performance.hitIndexBuildMs.toFixed(2);
}

function setupFilters() {
  const projectRegionNames = data.projectRows.map(row => row.regionName).filter(Boolean);
  const regionNames = [...new Set([...data.regions.map(row => row.name), ...projectRegionNames].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  regionNames.forEach(name => addOption(dom.region, name, name));
  const schemes = [...new Set(data.projects.map(row => row.scheme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  schemes.forEach(scheme => addOption(dom.scheme, scheme, scheme));
}

function setupMap() {
  clearChildren(dom.mapLayer);
  data.features.forEach((feature, index) => {
    const code = String(feature.properties?.code || '');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', featurePath(feature));
    path.setAttribute('class', 'department');
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'button');
    path.dataset.code = code;
    path.style.setProperty('--i', index);
    path.addEventListener('click', event => { event.stopPropagation(); state.mode === 'regions' ? selectRegion(regionNameForCode(feature.properties?.region)) : selectDepartment(normalizeDepartment(code)); });
    path.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.mode === 'regions' ? selectRegion(regionNameForCode(feature.properties?.region)) : selectDepartment(normalizeDepartment(code)); } });
    path.addEventListener('pointermove', event => showTooltip(event, path.getAttribute('aria-label') || feature.properties?.nom || code));
    path.addEventListener('pointerleave', hideTooltip);
    dom.mapLayer.appendChild(path);
  });
  data.regionPathElements.clear();
  data.regionPaths.forEach((pathData, regionCode) => {
    if (!pathData || !data.regionByCode.has(String(regionCode))) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('class', 'region-outline');
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'button');
    path.dataset.regionCode = regionCode;
    const label = regionNameForCode(regionCode);
    path.setAttribute('aria-label', 'R\u00e9gion ' + label);
    path.addEventListener('click', event => { event.stopPropagation(); selectRegion(label); });
    path.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRegion(label); } });
    path.addEventListener('pointermove', event => showTooltip(event, path.getAttribute('aria-label')));
    path.addEventListener('pointerleave', hideTooltip);
    dom.mapLayer.appendChild(path);
    data.regionPathElements.set(regionCode, path);
  });
}

function inferSearchMode(query) {
  const needle = lowerText(query).trim();
  if (needle.length < 2) return '';
  const exactCommune = data.communes.some(row => lowerText(row.name) === needle || lowerText(row.code) === needle);
  const exactDepartment = data.departments.some(row => lowerText(row.name) === needle || lowerText(row.code) === needle);
  const exactRegion = data.regions.some(row => lowerText(row.name) === needle || lowerText(row.code) === needle);
  let projectMatchCount = 0;
  for (const row of data.projectRows) {
    if ([row.title, row.beneficiary, row.scheme].some(value => matches(value, needle))) projectMatchCount += 1;
    if (projectMatchCount >= 8) break;
  }
  if (projectMatchCount >= 8) return 'projects';
  if (exactCommune) return 'communes';
  if (exactDepartment) return 'departments';
  if (exactRegion) return 'regions';
  if (projectMatchCount) return 'projects';
  if (data.communes.some(row => [row.name, row.code].some(value => matches(value, needle)))) return 'communes';
  if (data.departments.some(row => [row.name, row.code].some(value => matches(value, needle)))) return 'departments';
  if (data.regions.some(row => [row.name, row.code].some(value => matches(value, needle)))) return 'regions';
  return '';
}

function setupListeners() {
  dom.modeTabs.forEach(button => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    state.selectedCommune = '';
    state.selectedDepartment = '';
    state.zoomDelta = 0;
    state.limit = 8;
    render();
  }));
  dom.metricButtons.forEach(button => button.addEventListener('click', () => { state.metric = button.dataset.metric; render(); }));
  let searchTimer = 0;
  dom.search.addEventListener('input', event => {
    state.search = event.target.value.trim();
    state.limit = 8;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const inferredMode = inferSearchMode(state.search);
      if (inferredMode && inferredMode !== state.mode) {
        state.mode = inferredMode;
        state.selectedDepartment = '';
        state.selectedCommune = '';
        state.zoomDelta = 0;
      }
      render();
    }, 120);
  });
  dom.region.addEventListener('change', event => { state.region = event.target.value; state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; state.limit = 8; render(); });
  dom.scheme.addEventListener('change', event => { state.scheme = event.target.value; state.limit = 8; render(); });
  dom.reset.addEventListener('click', resetAll);
  dom.clearSelection.addEventListener('click', () => { state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; render(); });
  dom.resetView.addEventListener('click', () => { state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; render(); });
  dom.zoomIn.addEventListener('click', () => { state.zoomDelta = Math.min(5, state.zoomDelta + .35); applyTransform(240); });
  dom.zoomOut.addEventListener('click', () => { state.zoomDelta = Math.max(-.7, state.zoomDelta - .35); applyTransform(240); });

  function handleMapWheel(event) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 480 : 1;
    const delta = event.deltaY * unit;
    if (!Number.isFinite(delta) || delta === 0) return;
    state.zoomDelta = Math.max(-.7, Math.min(5, state.zoomDelta - delta / 190));
    applyTransform(150);
  }

  let mapHoverFrame = 0;
  let pendingMapPointer = null;

  function processMapPointer() {
    mapHoverFrame = 0;
    const pointer = pendingMapPointer;
    pendingMapPointer = null;
    if (!pointer || (state.mode !== 'projects' && state.mode !== 'communes')) return;
    const hoverStarted = performance.now();
    const point = scenePointFromEvent(pointer);
    if (!point) { dom.map.dataset.hoverProcessMs = (performance.now() - hoverStarted).toFixed(3); return; }
    const communeCode = communeCodeAtScenePoint(point.x, point.y);
    if (communeCode) {
      const row = data.activeCommuneRowsByCode.get(communeCode);
      updateCommuneHover(communeCode);
      showTooltip(pointer, row.name + ' : ' + formatValue(communeShapeValue(row), state.metric === 'perCapita'));
      dom.map.dataset.hoverProcessMs = (performance.now() - hoverStarted).toFixed(3);
      return;
    }
    updateCommuneHover('');
    const departmentCode = departmentCodeAtScenePoint(point.x, point.y);
    if (departmentCode) {
      const feature = data.featureByCode.get(departmentCode);
      const value = data.currentMapDepartmentValues.get(normalizeDepartment(departmentCode)) || data.currentMapDepartmentValues.get(departmentCode) || 0;
      showTooltip(pointer, (feature?.properties?.nom || departmentCode) + ' : ' + formatValue(value, state.metric === 'perCapita'));
    } else hideTooltip();
    dom.map.dataset.hoverProcessMs = (performance.now() - hoverStarted).toFixed(3);
  }

  dom.map.addEventListener('pointermove', event => {
    if (state.mode !== 'projects' && state.mode !== 'communes') return;
    pendingMapPointer = { clientX: event.clientX, clientY: event.clientY };
    if (!mapHoverFrame) mapHoverFrame = window.requestAnimationFrame(processMapPointer);
  });
  dom.map.addEventListener('pointerleave', () => {
    pendingMapPointer = null;
    if (mapHoverFrame) window.cancelAnimationFrame(mapHoverFrame);
    mapHoverFrame = 0;
    updateCommuneHover('');
    hideTooltip();
  });
  dom.map.addEventListener('click', event => {
    if (state.mode === 'projects' || state.mode === 'communes') {
      const point = scenePointFromEvent(event);
      const communeCode = point ? communeCodeAtScenePoint(point.x, point.y) : '';
      if (communeCode) { selectCommune(communeCode); return; }
      const departmentCode = point ? departmentCodeAtScenePoint(point.x, point.y) : '';
      if (departmentCode) { selectDepartment(departmentCode); return; }
    }
    if (event.target === dom.map) { state.selectedCommune = ''; state.selectedDepartment = ''; state.zoomDelta = 0; render(); }
  });
  dom.mapFrame.addEventListener('wheel', handleMapWheel, { passive: false });
}

function resetAll() {
  state.region = ''; state.scheme = ''; state.search = ''; state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; state.limit = 8;
  dom.search.value = ''; dom.region.value = ''; dom.scheme.value = '';
  render();
}

function selectRegion(name) {
  if (!name) return;
  state.region = name;
  state.search = '';
  dom.search.value = '';
  dom.region.value = name;
  state.selectedDepartment = '';
  state.selectedCommune = '';
  state.zoomDelta = 0;
  render();
}
function selectDepartment(code) {
  state.search = '';
  dom.search.value = '';
  state.selectedDepartment = normalizeDepartment(code);
  state.selectedCommune = '';
  state.zoomDelta = 0;
  render();
}

function selectCommune(code) {
  const commune = data.communeByCode.get(code);
  const feature = data.communeFeatureByCode.get(code);
  if (!commune && !feature) return;
  if (state.selectedCommune === code) {
    state.selectedCommune = '';
    state.selectedDepartment = '';
    state.zoomDelta = 0;
    render();
    return;
  }
  state.search = '';
  dom.search.value = '';
  state.selectedCommune = code;
  state.selectedDepartment = normalizeDepartment(commune?.department || feature?.properties?.departement || '');
  state.zoomDelta = 0;
  render();
}

function showTooltip(event, text) {
  if (!text) return;
  const frameRect = dom.mapFrame.getBoundingClientRect();
  if (dom.tooltip.textContent !== text) dom.tooltip.textContent = text;
  dom.tooltip.hidden = false;
  dom.tooltip.style.left = '0';
  dom.tooltip.style.top = '0';
  dom.tooltip.style.transform = `translate3d(${event.clientX - frameRect.left + 12}px, ${event.clientY - frameRect.top + 12}px, 0)`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
}

function metricLabel() {
  return state.metric === 'perCapita' ? 'par habitant' : 'total';
}

function modeCopy() {
  const copy = {
    projects: { filter: 'Explorer les projets', kicker: 'PROJETS FINANCÉS PAR L’ÉTAT', title: 'Subventions par département', unit: 'Subventions accordées', count: 'Projets', coverage: 'Départements touchés', help: 'Cliquez sur une commune ou un département pour inspecter les projets.', context: 'Source DGCL 2025 · engagements de subventions d’investissement.' },
    communes: { filter: 'Explorer les budgets communaux', kicker: 'COMPTES LOCAUX \u00b7 OFGL', title: 'D\u00e9penses par commune', unit: 'D\u00e9penses communales', count: 'Communes', coverage: 'D\u00e9partements couverts', help: 'Cliquez sur une commune pour inspecter son budget et zoomer.', context: 'Source OFGL 2025 \u00b7 d\u00e9penses totales des communes, avec montant par habitant.' },
    departments: { filter: 'Explorer les budgets départementaux', kicker: 'COMPTES LOCAUX · OFGL', title: 'Dépenses par département', unit: 'Dépenses départementales', count: 'Départements', coverage: 'Régions couvertes', help: 'Cliquez sur un département pour isoler son budget et ses communes.', context: 'Source OFGL 2025 · dépenses totales des départements, avec montant par habitant.' },
    regions: { filter: 'Explorer les budgets régionaux', kicker: 'COMPTES LOCAUX · OFGL', title: 'Dépenses par région', unit: 'Dépenses régionales', count: 'Régions', coverage: 'Régions affichées', help: 'Filtrez une région ou cliquez dans la liste pour recentrer la lecture.', context: 'Source OFGL 2025 · dépenses totales des régions, avec montant par habitant.' }
  };
  return copy[state.mode];
}

function valuesForColor(values) {
  const positives = values.filter(value => Number.isFinite(value) && value > 0);
  if (!positives.length) return { min: 0, max: 1 };
  return { min: Math.min(...positives), max: Math.max(...positives) };
}

function colorRatio(value, scale) {
  if (!value || value <= 0) return 0;
  const low = Math.log1p(scale.min);
  const high = Math.log1p(scale.max);
  return Math.max(0, Math.min(1, high === low ? .72 : (Math.log1p(value) - low) / (high - low)));
}

function colorForRatio(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const hue = 205 - clamped * 48;
  const lightness = 35 + clamped * 17;
  return `hsl(${hue.toFixed(1)} 70% ${lightness.toFixed(1)}%)`;
}

function colorFor(value, scale) {
  if (!value || value <= 0) return 'rgba(22, 64, 84, .42)';
  return colorForRatio(colorRatio(value, scale));
}

function mapRows() {
  if (state.mode === 'projects') {
    return data.projectRows.filter(row => {
      if (state.scheme && row.scheme !== state.scheme) return false;
      if (!state.search) return true;
      return [row.title, row.beneficiary, row.scheme, row.communeData?.name, row.departmentName, row.regionName].some(value => matches(value, state.search));
    });
  }
  if (state.mode === 'communes') {
    return data.communes.filter(row => !state.search || [row.name, row.code, row.departmentName, row.regionName].some(value => matches(value, state.search)));
  }
  if (state.mode === 'departments') {
    return data.departments.filter(row => !state.search || [row.name, row.code, row.regionName].some(value => matches(value, state.search)));
  }
  return data.regions.filter(row => !state.search || [row.name, row.code].some(value => matches(value, state.search)));
}

function mapDepartmentValues() {
  const values = new Map();
  const rows = mapRows();
  if (state.mode === 'projects') {
    const totals = new Map();
    rows.forEach(row => totals.set(row.department, (totals.get(row.department) || 0) + row.amount));
    totals.forEach((total, code) => values.set(code, state.metric === 'total' ? total : (populationForDepartment(code) ? total / populationForDepartment(code) : 0)));
  } else if (state.mode === 'communes') {
    const totals = new Map(); const populations = new Map();
    rows.forEach(row => { const code = normalizeDepartment(row.department); totals.set(code, (totals.get(code) || 0) + row.total); populations.set(code, (populations.get(code) || 0) + row.population); });
    totals.forEach((total, code) => values.set(code, state.metric === 'total' ? total : (populations.get(code) ? total / populations.get(code) : 0)));
  } else if (state.mode === 'departments') {
    rows.forEach(row => values.set(normalizeDepartment(row.code), valueForBudget(row)));
  } else {
    const byRegion = new Map(rows.map(row => [String(row.code), valueForBudget(row)]));
    data.features.forEach(feature => { const region = String(feature.properties?.region || ''); if (byRegion.has(region)) values.set(String(feature.properties.code), byRegion.get(region)); });
  }
  return values;
}

function pointRows() {
  if (state.mode === 'regions' || state.mode === 'departments') return [];
  const rows = currentRows();
  if (state.mode === 'communes') return rows.map(row => ({ code: row.code, name: row.name, department: row.department, total: row.total, population: row.population, value: valueForBudget(row), lon: row.lon, lat: row.lat }));
  const grouped = new Map();
  rows.forEach(row => {
    if (!row.communeData?.lon && row.communeData?.lon !== 0) return;
    const code = row.commune;
    const item = grouped.get(code) || { code, name: row.communeData.name, department: row.department, total: 0, population: row.communeData.population || 0, lon: row.communeData.lon, lat: row.communeData.lat };
    item.total += row.amount;
    grouped.set(code, item);
  });
  return [...grouped.values()].map(row => ({ ...row, value: state.metric === 'total' ? row.total : (row.population ? row.total / row.population : 0) }));
}

function communeShapeRows() {
  const keepOnMap = row => {
    const department = normalizeDepartment(row.department || data.communeByCode.get(row.code)?.department || '');
    if (!isOverseasCode(department)) return true;
    return Boolean(state.search || state.region || normalizeDepartment(state.selectedDepartment) === department || state.selectedCommune === row.code);
  };
  if (state.mode === 'communes') return mapRows().filter(keepOnMap);
  if (state.mode === 'projects') {
    const grouped = new Map();
    mapRows().filter(keepOnMap).forEach(row => {
      if (!row.commune) return;
      const code = String(row.commune);
      const feature = data.communeFeatureByCode.get(code);
      const item = grouped.get(code) || { code, name: row.communeData?.name || feature?.properties?.nom || code, department: row.department, total: 0, population: row.communeData?.population || 0 };
      item.total += row.amount;
      if (!item.population && row.communeData?.population) item.population = row.communeData.population;
      grouped.set(code, item);
    });
    return [...grouped.values()].map(row => ({ ...row, perCapita: row.population ? row.total / row.population : 0 }));
  }
  return [];
}

function communeShapeValue(row) {
  return state.mode === 'projects' ? (state.metric === 'total' ? row.total : row.perCapita) : valueForBudget(row);
}

function renderCommuneLayer() {
  if (!dom.communeLayer) return;
  const renderStarted = performance.now();
  const visible = state.mode === 'communes' || state.mode === 'projects';
  dom.communeLayer.style.display = visible ? '' : 'none';
  dom.map.classList.toggle('commune-interaction', visible);
  if (!visible) {
    clearChildren(dom.communeLayer);
    data.activeCommuneRowsByCode.clear();
    data.communeHoverElement = null;
    data.communeLayerKey = '';
    data.performance.communeLayerRenderMs = performance.now() - renderStarted;
    data.performance.communeSvgElements = 0;
    return;
  }
  const layerKey = [state.mode, state.metric, state.search, state.scheme, state.region].join('|');
  if (data.communeLayerKey === layerKey && data.communeHoverElement) {
    let selectedPath = dom.communeLayer.querySelector('.commune-selection-shape');
    if (state.selectedCommune && data.activeCommuneRowsByCode.has(state.selectedCommune)) {
      if (!selectedPath) {
        selectedPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        selectedPath.setAttribute('class', 'commune-selection-shape');
        selectedPath.setAttribute('aria-hidden', 'true');
        dom.communeLayer.insertBefore(selectedPath, data.communeHoverElement);
      }
      selectedPath.setAttribute('d', data.communePathByCode.get(state.selectedCommune) || '');
    } else if (selectedPath) selectedPath.remove();
    data.performance.communeLayerRenderMs = performance.now() - renderStarted;
    data.performance.communeSvgElements = dom.communeLayer.childElementCount;
    dom.communeLayer.dataset.svgElements = String(data.performance.communeSvgElements);
    dom.communeLayer.dataset.renderMs = data.performance.communeLayerRenderMs.toFixed(2);
    return;
  }
  clearChildren(dom.communeLayer);
  data.activeCommuneRowsByCode.clear();
  data.communeHoverElement = null;
  data.communeLayerKey = layerKey;
  let rows = communeShapeRows().filter(row => data.communeFeatureByCode.has(row.code));
  rows.sort((a, b) => communeShapeValue(b) - communeShapeValue(a));
  const cap = 35000;
  if (rows.length > cap) rows = rows.slice(0, cap);
  const scale = valuesForColor(rows.map(communeShapeValue));
  const buckets = Array.from({ length: COMMUNE_COLOR_BUCKETS }, () => []);
  rows.forEach(row => {
    data.activeCommuneRowsByCode.set(row.code, row);
    const ratio = colorRatio(communeShapeValue(row), scale);
    const bucketIndex = Math.min(COMMUNE_COLOR_BUCKETS - 1, Math.floor(ratio * COMMUNE_COLOR_BUCKETS));
    buckets[bucketIndex].push(data.communePathByCode.get(row.code));
  });
  buckets.forEach((paths, index) => {
    if (!paths.length) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths.join(' '));
    path.setAttribute('class', 'commune-bucket');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('aria-hidden', 'true');
    path.style.fill = colorForRatio((index + .5) / COMMUNE_COLOR_BUCKETS);
    dom.communeLayer.appendChild(path);
  });
  if (state.selectedCommune && data.activeCommuneRowsByCode.has(state.selectedCommune)) {
    const selectedPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    selectedPath.setAttribute('d', data.communePathByCode.get(state.selectedCommune) || '');
    selectedPath.setAttribute('class', 'commune-selection-shape');
    selectedPath.setAttribute('aria-hidden', 'true');
    dom.communeLayer.appendChild(selectedPath);
  }
  const hoverPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hoverPath.setAttribute('class', 'commune-hover-shape');
  hoverPath.setAttribute('aria-hidden', 'true');
  hoverPath.style.display = 'none';
  dom.communeLayer.appendChild(hoverPath);
  data.communeHoverElement = hoverPath;
  data.performance.communeLayerRenderMs = performance.now() - renderStarted;
  data.performance.communeSvgElements = dom.communeLayer.childElementCount;
  dom.communeLayer.dataset.activeCommunes = String(data.activeCommuneRowsByCode.size);
  dom.communeLayer.dataset.svgElements = String(data.performance.communeSvgElements);
  dom.communeLayer.dataset.renderMs = data.performance.communeLayerRenderMs.toFixed(2);
  window.__frlMapPerformance = {
    activeCommunes: data.activeCommuneRowsByCode.size,
    communeSvgElements: data.performance.communeSvgElements,
    communeLayerRenderMs: Number(data.performance.communeLayerRenderMs.toFixed(2))
  };
}
function renderPoints() {
  clearChildren(dom.mapPoints); clearChildren(dom.mapLabels);
  if (state.mode === 'communes' || state.mode === 'projects') return;
  let points = pointRows().filter(row => Number.isFinite(row.lon) && Number.isFinite(row.lat));
  points.sort((a, b) => b.value - a.value);
  const nationalCap = state.mode === 'communes' ? 1150 : 950;
  if (!state.selectedDepartment && points.length > nationalCap) points = points.slice(0, nationalCap);
  const scale = valuesForColor(points.map(point => point.value));
  points.forEach(point => {
    const projected = projectPoint([point.lon, point.lat]);
    const ratio = scale.max > 0 ? Math.max(0, Math.min(1, (Math.log1p(point.value) - Math.log1p(scale.min || 1)) / ((Math.log1p(scale.max) - Math.log1p(scale.min || 1)) || 1))) : 0;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', projected.x.toFixed(2)); circle.setAttribute('cy', projected.y.toFixed(2));
    circle.setAttribute('r', (0.45 + ratio * 1.55).toFixed(2));
    circle.setAttribute('fill', colorFor(point.value, scale)); circle.setAttribute('class', 'map-point');
    circle.setAttribute('tabindex', '0'); circle.setAttribute('role', 'button'); circle.dataset.code = point.code;
    circle.setAttribute('aria-label', `${point.name} : ${formatValue(point.value, state.metric === 'perCapita')}`);
    if (point.code === state.selectedCommune) circle.classList.add('selected');
    circle.addEventListener('click', event => { event.stopPropagation(); selectCommune(point.code); });
    circle.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCommune(point.code); } });
    circle.addEventListener('pointermove', event => showTooltip(event, `${point.name} · ${formatValue(point.value, state.metric === 'perCapita')}`));
    circle.addEventListener('pointerleave', hideTooltip);
    dom.mapPoints.appendChild(circle);
    if (point.code === state.selectedCommune) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', (projected.x + 10).toFixed(2)); label.setAttribute('y', (projected.y - 10).toFixed(2)); label.setAttribute('class', 'map-label'); label.textContent = point.name;
      dom.mapLabels.appendChild(label);
    }
  });
  if (state.mode === 'communes' && !state.selectedDepartment && points.length < currentRows().length) setText(dom.mapHelp, `Les ${formatCount(points.length)} communes les plus dépensières sont affichées. Sélectionnez un département pour voir ses communes.`);
}

function focusBounds() {
  if (state.selectedCommune) {
    const commune = data.communeByCode.get(state.selectedCommune);
    const feature = data.communeFeatureByCode.get(state.selectedCommune);
    if (feature) return fitProjectedBounds(projectedFeatureBounds(feature), 12);
    if (commune) { const point = projectPoint([commune.lon, commune.lat]); return { centerX: point.x, centerY: point.y, scale: 5.6 }; }
  }
  if (state.selectedDepartment) {
    const feature = data.featureByCode.get(normalizeDepartment(state.selectedDepartment));
    if (feature) return fitProjectedBounds(projectedFeatureBounds(feature));
  }
  if (state.region) {
    const features = data.features.filter(feature => featureRegionName(feature) === state.region);
    if (features.length) {
      const bounds = features.map(projectedFeatureBounds).reduce((acc, item) => ({ minX: Math.min(acc.minX, item.minX), maxX: Math.max(acc.maxX, item.maxX), minY: Math.min(acc.minY, item.minY), maxY: Math.max(acc.maxY, item.maxY) }));
      return fitProjectedBounds(bounds);
    }
  }
  return { centerX: 450, centerY: 310, scale: 1 };
}

function fitProjectedBounds(bounds, maxScale = 7) {
  const width = Math.max(18, bounds.maxX - bounds.minX); const height = Math.max(18, bounds.maxY - bounds.minY);
  const scale = Math.max(1.12, Math.min(maxScale, Math.min(800 / (width + 70), 540 / (height + 70))));
  return { centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2, scale };
}

function targetMapTransform() {
  const focus = focusBounds();
  const scale = Math.max(.78, Math.min(12, focus.scale * Math.pow(1.24, state.zoomDelta)));
  const focused = Boolean(state.selectedCommune || state.selectedDepartment || state.region);
  const compactViewport = window.innerWidth <= 760;
  const viewportX = focused && !compactViewport ? 360 : 450;
  const viewportY = focused && compactViewport ? 185 : 310;
  const tx = viewportX - focus.centerX * scale; const ty = viewportY - focus.centerY * scale;
  return { tx, ty, scale };
}

function writeMapTransform(transform) {
  dom.mapScene.removeAttribute('transform');
  dom.mapScene.style.transform = 'none';
  const width = dom.mapFrame.clientWidth || 900;
  const height = dom.mapFrame.clientHeight || 620;
  const unitScale = Math.min(width / 900, height / 620);
  const offsetX = (width - 900 * unitScale) / 2;
  const offsetY = (height - 620 * unitScale) / 2;
  const cssX = (1 - transform.scale) * offsetX + transform.tx * unitScale;
  const cssY = (1 - transform.scale) * offsetY + transform.ty * unitScale;
  dom.map.style.transform = `matrix(${transform.scale.toFixed(4)}, 0, 0, ${transform.scale.toFixed(4)}, ${cssX.toFixed(2)}, ${cssY.toFixed(2)})`;
}

function stepMapMotion(now) {
  const elapsed = now - mapMotion.startedAt;
  const progress = mapMotion.duration ? Math.min(1, elapsed / mapMotion.duration) : 1;
  const eased = 1 - Math.pow(1 - progress, 4);
  mapMotion.current = {
    tx: mapMotion.from.tx + (mapMotion.target.tx - mapMotion.from.tx) * eased,
    ty: mapMotion.from.ty + (mapMotion.target.ty - mapMotion.from.ty) * eased,
    scale: mapMotion.from.scale + (mapMotion.target.scale - mapMotion.from.scale) * eased
  };
  writeMapTransform(mapMotion.current);
  mapMotion.frameCount += 1;
  if (progress < 1) {
    mapMotion.frame = window.requestAnimationFrame(stepMapMotion);
    return;
  }
  mapMotion.frame = 0;
  const seconds = Math.max(.001, elapsed / 1000);
  dom.map.dataset.zoomAnimationFps = (mapMotion.frameCount / seconds).toFixed(1);
}

function applyTransform(duration = 480) {
  const target = targetMapTransform();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!mapMotion.current || reducedMotion || duration <= 0) {
    mapMotion.current = target;
    mapMotion.target = target;
    writeMapTransform(target);
    return;
  }
  mapMotion.from = { ...mapMotion.current };
  mapMotion.target = target;
  mapMotion.startedAt = performance.now();
  mapMotion.duration = duration;
  mapMotion.frameCount = 0;
  if (!mapMotion.frame) mapMotion.frame = window.requestAnimationFrame(stepMapMotion);
}

function renderMap() {
  const copy = modeCopy();
  const values = mapDepartmentValues();
  data.currentMapDepartmentValues = values;
  const scale = valuesForColor([...values.values()]);
  const selected = normalizeDepartment(state.selectedDepartment);
  dom.mapLayer.querySelectorAll('.department').forEach(path => {
    const code = String(path.dataset.code || '');
    const value = values.get(normalizeDepartment(code)) || values.get(code) || 0;
    path.style.fill = colorFor(value, scale);
    path.style.stroke = state.mode === 'regions' || state.mode === 'communes' ? 'transparent' : '';
    path.classList.toggle('selected', Boolean(state.mode !== 'regions' && selected && normalizeDepartment(code) === selected));
    path.style.opacity = state.mode === 'communes' ? '.16' : (isOverseasCode(code) && !selected && !state.region ? '.25' : '1');
    path.style.pointerEvents = state.mode === 'projects' || state.mode === 'communes' ? 'none' : '';
    path.style.display = isOverseasCode(code) && !state.region && !state.search && selected !== normalizeDepartment(code) ? 'none' : '';
    const name = data.featureByCode.get(code)?.properties?.nom || code;
    path.setAttribute('aria-label', name + ' : ' + formatValue(value, state.metric === 'perCapita'));
  });
  data.regionPathElements.forEach((path, regionCode) => {
    const region = data.regionByCode.get(String(regionCode));
    const value = region ? valueForBudget(region) : 0;
    const label = regionNameForCode(regionCode);
    const regionDepartments = data.features.filter(feature => String(feature.properties?.region || '') === String(regionCode));
    const overseasRegion = regionDepartments.length > 0 && regionDepartments.every(feature => isOverseasCode(feature.properties?.code));
    path.style.display = state.mode === 'regions' && (!overseasRegion || state.region === label || state.search) ? 'inline' : 'none';
    path.classList.toggle('selected', Boolean(state.mode === 'regions' && state.region && label === state.region));
    path.setAttribute('aria-label', 'R\u00e9gion ' + label + ' : ' + formatValue(value, state.metric === 'perCapita'));
  });
  const communeMapCount = communeShapeRows().filter(row => data.communeFeatureByCode.has(row.code)).length;
  setText(dom.mapBadgeText, state.mode === 'regions' ? data.regions.length + ' r\u00e9gions' : state.mode === 'communes' ? formatCount(communeMapCount) + ' communes' : state.mode === 'projects' ? formatCount(communeMapCount) + ' communes avec projets' : data.features.length + ' contours administratifs');
  const shownValues = [...values.values()].filter(value => value > 0);
  setText(dom.legendLow, shownValues.length ? formatValue(Math.min(...shownValues), state.metric === 'perCapita') : 'Faible');
  setText(dom.legendHigh, shownValues.length ? formatValue(Math.max(...shownValues), state.metric === 'perCapita') : 'Élevé');
  setText(dom.legendTitle, state.metric === 'perCapita' ? 'Dépense par habitant' : 'Montant par territoire');
  setText(dom.mapTitle, copy.title);
  setText(dom.mapUnit, copy.unit);
  setText(dom.mapKicker, copy.kicker);
  setText(dom.mapHelp, copy.help + ' Molette ou pavé tactile sur la carte pour zoomer.');
  setText(dom.mapSubtitle, state.selectedCommune ? 'Commune sélectionnée · zoom animé' : state.selectedDepartment ? 'D\u00e9partement s\u00e9lectionn\u00e9 \u00b7 cliquez sur une commune pour descendre au niveau communal' : 'Survolez un territoire, puis cliquez pour zoomer.');
  renderPoints();
  renderCommuneLayer();
  requestAnimationFrame(() => applyTransform(520));
}

function scopeRows() {
  return currentRows();
}

function scopeSummary(rows) {
  if (state.mode === 'projects') {
    const scoped = projectRowsForScope(rows);
    const total = sum(scoped, row => row.amount);
    const uniqueCommunes = new Set(scoped.map(row => row.commune).filter(Boolean));
    const uniqueDepartments = new Set(scoped.map(row => normalizeDepartment(row.department)).filter(Boolean));
    const population = state.selectedCommune
      ? (data.communeByCode.get(state.selectedCommune)?.population || 0)
      : state.selectedDepartment
        ? populationForDepartment(state.selectedDepartment)
        : [...uniqueCommunes].reduce((value, code) => value + (data.communeByCode.get(code)?.population || 0), 0) || [...uniqueDepartments].reduce((value, code) => value + populationForDepartment(code), 0);
    const aggregate = { total, population, perCapita: population ? total / population : 0 };
    return { ...aggregate, count: scoped.length, coverage: new Set(scoped.map(row => row.department)).size };
  }
  if (state.mode === 'communes') {
    const aggregate = aggregateRows(rows, { getTotal: row => row.total, getPopulation: row => row.population });
    return { ...aggregate, count: rows.length, coverage: new Set(rows.map(row => normalizeDepartment(row.department))).size };
  }
  if (state.mode === 'departments') {
    const aggregate = aggregateRows(rows, { getTotal: row => row.total, getPopulation: row => row.perCapita ? row.total / row.perCapita : 0 });
    return { ...aggregate, count: rows.length, coverage: new Set(rows.map(row => row.regionName)).size };
  }
  const aggregate = aggregateRows(rows, { getTotal: row => row.total, getPopulation: row => row.perCapita ? row.total / row.perCapita : 0 });
  return { ...aggregate, count: rows.length, coverage: rows.length };
}

function renderStats() {
  const copy = modeCopy();
  const rows = scopeRows(); const summary = scopeSummary(rows);
  setText(dom.totalLabel, state.metric === 'perCapita' ? 'Dépense par habitant' : (state.mode === 'projects' ? 'Subventions affichées' : 'Dépenses affichées'));
  setText(dom.totalAmount, formatValue(state.metric === 'perCapita' ? summary.perCapita : summary.total, state.metric === 'perCapita'));
  setText(dom.countLabel, copy.count); setText(dom.projectCount, formatCount(summary.count));
  setText(dom.coverageLabel, copy.coverage); setText(dom.departmentCount, formatCount(summary.coverage));
  setText(dom.statsContext, copy.context);
  setText(dom.filterTitle, copy.filter);
}

function selectedContext() {
  if (state.selectedCommune) {
    const commune = data.communeByCode.get(state.selectedCommune);
    const feature = data.communeFeatureByCode.get(state.selectedCommune);
    if (commune || feature) {
      const name = commune?.name || feature?.properties?.nom || state.selectedCommune;
      return { title: name, kicker: `COMMUNE · ${state.selectedCommune}`, name };
    }
  }
  if (state.selectedDepartment) {
    const code = normalizeDepartment(state.selectedDepartment); const department = data.deptByCode.get(code); const feature = data.featureByCode.get(code);
    return { title: department?.name || feature?.properties?.nom || code, kicker: `DÉPARTEMENT · ${code}`, name: department?.name || feature?.properties?.nom || code };
  }
  if (state.region) return { title: state.region, kicker: 'RÉGION SÉLECTIONNÉE', name: state.region };
  return { title: 'France entière', kicker: 'VUE NATIONALE', name: 'France entière' };
}

function renderInspectorStats(summary, rows) {
  clearChildren(dom.inspectorStats);
  const cards = [
    [state.metric === 'perCapita' ? 'Par habitant' : 'Dépense totale', formatValue(state.metric === 'perCapita' ? summary.perCapita : summary.total, state.metric === 'perCapita')],
    [modeCopy().count, formatCount(summary.count)],
    [state.mode === 'projects' ? 'Territoires' : 'Population estimée', state.mode === 'projects' ? formatCount(summary.coverage) : (summary.population ? `${formatCount(summary.population)} hab.` : '—')]
  ];
  cards.forEach(([label, value]) => {
    const card = document.createElement('div'); card.className = 'inspector-stat';
    const labelNode = document.createElement('span'); labelNode.textContent = label;
    const valueNode = document.createElement('strong'); valueNode.textContent = value;
    card.append(labelNode, valueNode); dom.inspectorStats.appendChild(card);
  });
}

function projectItem(row) {
  const item = document.createElement('article'); item.className = 'project-item clickable'; item.tabIndex = 0; item.setAttribute('role', 'button');
  item.addEventListener('click', () => row.commune ? selectCommune(row.commune) : selectDepartment(row.department));
  item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); } });
  const copy = document.createElement('div'); const name = document.createElement('p'); name.className = 'project-name'; name.textContent = row.title || row.beneficiary || 'Projet sans intitulé';
  const meta = document.createElement('p'); meta.className = 'project-meta'; meta.textContent = [row.communeData?.name, row.departmentName, row.scheme].filter(Boolean).join(' · ');
  copy.append(name, meta);
  const amount = document.createElement('div'); amount.className = 'project-amount'; amount.textContent = formatValue(projectMetric(row), state.metric === 'perCapita');
  item.append(copy, amount); return item;
}

function budgetItem(row, level) {
  const item = document.createElement('article'); item.className = 'project-item clickable'; item.tabIndex = 0; item.setAttribute('role', 'button');
  item.addEventListener('click', () => {
    if (level === 'commune') selectCommune(row.code);
    else if (level === 'department') selectDepartment(row.code);
    else { state.region = row.name; dom.region.value = row.name; state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; render(); }
  });
  item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); } });
  const copy = document.createElement('div'); const name = document.createElement('p'); name.className = 'project-name'; name.textContent = row.name;
  const detail = level === 'commune' ? `${row.departmentName || row.department} · ${row.population ? formatCount(row.population) + ' hab.' : 'population non renseignée'}` : level === 'department' ? `${row.code} · ${row.regionName}` : `${row.code} · comptes consolidés`;
  const meta = document.createElement('p'); meta.className = 'project-meta'; meta.textContent = detail; copy.append(name, meta);
  const amount = document.createElement('div'); amount.className = 'project-amount'; amount.textContent = formatValue(valueForBudget(row), state.metric === 'perCapita'); item.append(copy, amount); return item;
}

function renderInspector() {
  const context = selectedContext(); const rows = scopeRows(); const summary = scopeSummary(rows);
  const inspectorOpen = Boolean(state.selectedCommune || state.selectedDepartment || state.region || state.search);
  dom.inspectorCard?.classList.toggle('is-open', inspectorOpen);
  dom.inspectorCard?.setAttribute('aria-hidden', String(!inspectorOpen));
  if (dom.inspectorCard) dom.inspectorCard.scrollLeft = 0;
  setText(dom.inspectorKicker, context.kicker); setText(dom.inspectorTitle, context.title);
  dom.clearSelection.hidden = !(state.selectedDepartment || state.selectedCommune || state.region);
  const metricText = state.metric === 'perCapita' ? 'par habitant' : 'au total';
  const scopeText = state.selectedCommune ? `Budget et données disponibles pour ${context.name}.` : state.selectedDepartment ? `${formatCount(summary.count)} lignes rattachées au département ${context.name}.` : state.region ? `${formatCount(summary.count)} lignes dans la région ${context.name}.` : `${formatCount(summary.count)} lignes dans la vue actuelle.`;
  setText(dom.inspectorSummary, `${scopeText} Lecture ${metricText}.`);
  renderInspectorStats(summary, rows);
  let items = []; let heading = 'À la une'; let countLabel = '';
  if (state.mode === 'projects') { items = [...projectRowsForScope(rows)].sort((a, b) => projectMetric(b) - projectMetric(a)); heading = state.selectedCommune ? 'Projets de la commune' : 'Projets les plus financés'; countLabel = `${formatCount(rows.length)} projets`; }
  else if (state.mode === 'communes') { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); heading = state.selectedCommune ? 'Commune sélectionnée' : state.selectedDepartment ? 'Communes du département' : 'Communes les plus dépensières'; countLabel = `${formatCount(rows.length)} communes`; }
  else if (state.mode === 'departments') { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); heading = 'Départements'; countLabel = `${formatCount(rows.length)} départements`; }
  else { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); heading = 'Régions'; countLabel = `${formatCount(rows.length)} régions`; }
  setText(dom.listHeading, heading); setText(dom.listCount, countLabel); clearChildren(dom.projectList);
  const visible = items.slice(0, state.limit);
  visible.forEach(row => dom.projectList.appendChild(state.mode === 'projects' ? projectItem(row) : budgetItem(row, state.mode === 'communes' ? 'commune' : state.mode === 'departments' ? 'department' : 'region')));
  dom.more.hidden = items.length <= state.limit;
  dom.more.textContent = `Afficher davantage (${formatCount(items.length - state.limit)} restant${items.length - state.limit > 1 ? 's' : ''})`;
}

function renderTabs() {
  dom.modeTabs.forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  dom.metricButtons.forEach(button => button.classList.toggle('active', button.dataset.metric === state.metric));
  dom.schemeFilter.hidden = state.mode !== 'projects';
  dom.scheme.disabled = state.mode !== 'projects';
  dom.search.placeholder = state.mode === 'projects' ? 'Projet, bénéficiaire, commune…' : state.mode === 'communes' ? 'Commune, code INSEE, département…' : 'Territoire, code…';
}

function render() {
  renderTabs(); renderStats(); renderMap(); renderInspector();
}

class ThemeManager {
  constructor() {
    this.themeTransitionMs = 800;
    this.transitionTimer = null;
    this.toggleBtn = dom.theme;
    let saved = '';
    try { saved = localStorage.getItem('thefishwebsite_theme') || ''; } catch (error) { saved = ''; }
    this.currentTheme = saved || document.documentElement.getAttribute('data-theme') || 'dark';
    this.init();
  }
  init() {
    this.applyTheme(this.currentTheme, false);
    if (this.toggleBtn) {
      this.toggleBtn.dataset.themeBound = 'true';
      this.toggleBtn.addEventListener('click', () => this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark', true));
    }
  }
  applyTheme(theme, animate = false) {
    this.currentTheme = theme;
    const root = document.documentElement;
    if (!animate) { root.setAttribute('data-theme', theme); try { localStorage.setItem('thefishwebsite_theme', theme); } catch (error) { /* storage may be unavailable */ } return; }
    root.classList.add('theme-transitioning'); root.setAttribute('data-theme', theme);
    try { localStorage.setItem('thefishwebsite_theme', theme); } catch (error) { /* storage may be unavailable */ }
    window.clearTimeout(this.transitionTimer); this.transitionTimer = window.setTimeout(() => root.classList.remove('theme-transitioning'), this.themeTransitionMs);
  }
}

async function init() {
  new ThemeManager();
  try {
    const [projectsResponse, boundariesResponse, budgetsResponse, communeBoundariesResponse] = await Promise.all([
      fetch('./data/projects-2025.json'), fetch('./data/departments.geojson'), fetch('./data/budgets-2025.json'), fetch('./data/communes.geojson')
    ]);
    if (!projectsResponse.ok || !boundariesResponse.ok || !budgetsResponse.ok || !communeBoundariesResponse.ok) throw new Error('Un fichier de données est indisponible.');
    data.projects = await projectsResponse.json(); data.boundaries = await boundariesResponse.json(); data.communeBoundaries = await communeBoundariesResponse.json();
    const budgets = await budgetsResponse.json(); data.communes = budgets.communes || []; data.departments = budgets.departments || []; data.regions = budgets.regions || [];
    setupDerivedData(); setupFilters(); setupMap(); setupListeners();
    setText(dom.dataStatus, `${formatCount(data.projects.length)} projets · ${formatCount(data.communes.length)} communes`);
    setText(dom.scopeText, 'DGCL · OFGL · contours Etalab · données 2025');
    render();
  } catch (error) {
    console.error(error); setText(dom.dataStatus, 'Données indisponibles'); setText(dom.scopeText, 'Rechargez la page pour réessayer.'); setText(dom.inspectorSummary, 'Impossible de charger les données locales.');
  }
}

dom.more.addEventListener('click', () => { state.limit += 8; renderInspector(); });
init();
