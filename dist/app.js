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
  mapPoints: document.getElementById('mapPoints'),
  mapLabels: document.getElementById('mapLabels'),
  tooltip: document.getElementById('mapTooltip'),
  mapBadgeText: document.getElementById('mapBadgeText'),
  legendTitle: document.getElementById('legendTitle'),
  legendLow: document.getElementById('legendLow'),
  legendHigh: document.getElementById('legendHigh'),
  mapHelp: document.getElementById('mapHelp'),
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
  limit: 12
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
  projectionBounds: null
};

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const lowerText = value => String(value ?? '').toLocaleLowerCase('fr-FR');
const matches = (value, query) => !query || lowerText(value).includes(lowerText(query));
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
  const x = 24 + ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon || 1)) * 852;
  const y = 22 + ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 1)) * 576;
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
  const points = [];
  walkCoordinates(feature.geometry?.coordinates, coords => points.push(projectPoint(coords)));
  if (!points.length) return { minX: 450, maxX: 450, minY: 310, maxY: 310 };
  return {
    minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y))
  };
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
  data.projectionBounds = { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
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
    path.addEventListener('click', event => { event.stopPropagation(); selectDepartment(normalizeDepartment(code)); });
    path.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectDepartment(normalizeDepartment(code)); } });
    path.addEventListener('pointermove', event => showTooltip(event, path.getAttribute('aria-label') || feature.properties?.nom || code));
    path.addEventListener('pointerleave', hideTooltip);
    dom.mapLayer.appendChild(path);
  });
}

function setupListeners() {
  dom.modeTabs.forEach(button => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    state.selectedCommune = '';
    state.limit = 12;
    render();
  }));
  dom.metricButtons.forEach(button => button.addEventListener('click', () => { state.metric = button.dataset.metric; render(); }));
  dom.search.addEventListener('input', event => { state.search = event.target.value.trim(); state.limit = 12; render(); });
  dom.region.addEventListener('change', event => { state.region = event.target.value; state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; state.limit = 12; render(); });
  dom.scheme.addEventListener('change', event => { state.scheme = event.target.value; state.limit = 12; render(); });
  dom.reset.addEventListener('click', resetAll);
  dom.clearSelection.addEventListener('click', () => { state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; render(); });
  dom.resetView.addEventListener('click', () => { state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; render(); });
  dom.zoomIn.addEventListener('click', () => { state.zoomDelta = Math.min(5, state.zoomDelta + .35); applyTransform(); });
  dom.zoomOut.addEventListener('click', () => { state.zoomDelta = Math.max(-.7, state.zoomDelta - .35); applyTransform(); });
  dom.map.addEventListener('click', event => { if (event.target === dom.map) { state.selectedCommune = ''; state.selectedDepartment = ''; state.zoomDelta = 0; render(); } });
}

function resetAll() {
  state.region = ''; state.scheme = ''; state.search = ''; state.selectedDepartment = ''; state.selectedCommune = ''; state.zoomDelta = 0; state.limit = 12;
  dom.search.value = ''; dom.region.value = ''; dom.scheme.value = '';
  render();
}

function selectDepartment(code) {
  state.selectedDepartment = normalizeDepartment(code);
  state.selectedCommune = '';
  state.zoomDelta = 0;
  render();
}

function selectCommune(code) {
  const commune = data.communeByCode.get(code);
  if (!commune) return;
  state.selectedCommune = code;
  state.selectedDepartment = normalizeDepartment(commune.department);
  state.zoomDelta = 0;
  render();
}

function showTooltip(event, text) {
  if (!text) return;
  const frameRect = dom.mapFrame.getBoundingClientRect();
  dom.tooltip.textContent = text;
  dom.tooltip.hidden = false;
  dom.tooltip.style.left = `${event.clientX - frameRect.left}px`;
  dom.tooltip.style.top = `${event.clientY - frameRect.top}px`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
}

function metricLabel() {
  return state.metric === 'perCapita' ? 'par habitant' : 'total';
}

function modeCopy() {
  const copy = {
    projects: { filter: 'Explorer les projets', kicker: 'PROJETS FINANCÉS PAR L’ÉTAT', title: 'Subventions par département', unit: 'Subventions accordées', count: 'Projets', coverage: 'Départements touchés', help: 'Cliquez sur un département pour afficher ses projets et ses communes.', context: 'Source DGCL 2025 · engagements de subventions d’investissement.' },
    communes: { filter: 'Explorer les budgets communaux', kicker: 'COMPTES LOCAUX · OFGL', title: 'Dépenses par département', unit: 'Dépenses communales', count: 'Communes', coverage: 'Départements couverts', help: 'Cliquez sur un point pour zoomer jusqu’à la commune et inspecter son budget.', context: 'Source OFGL 2025 · dépenses totales des communes, avec montant par habitant.' },
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

function colorFor(value, scale) {
  if (!value || value <= 0) return 'rgba(22, 64, 84, .42)';
  const low = Math.log1p(scale.min);
  const high = Math.log1p(scale.max);
  const ratio = high === low ? .72 : (Math.log1p(value) - low) / (high - low);
  const clamped = Math.max(0, Math.min(1, ratio));
  const hue = 205 - clamped * 48;
  const lightness = 35 + clamped * 17;
  return `hsl(${hue.toFixed(1)} 70% ${lightness.toFixed(1)}%)`;
}

function mapDepartmentValues() {
  const values = new Map();
  const rows = currentRows();
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

function renderPoints() {
  clearChildren(dom.mapPoints); clearChildren(dom.mapLabels);
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
    circle.setAttribute('r', (3.2 + ratio * 9.4).toFixed(2));
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

function fitProjectedBounds(bounds) {
  const width = Math.max(18, bounds.maxX - bounds.minX); const height = Math.max(18, bounds.maxY - bounds.minY);
  const scale = Math.max(1.12, Math.min(7, Math.min(800 / (width + 70), 540 / (height + 70))));
  return { centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2, scale };
}

function applyTransform() {
  const focus = focusBounds();
  const scale = Math.max(.78, Math.min(12, focus.scale * Math.pow(1.24, state.zoomDelta)));
  const tx = 450 - focus.centerX * scale; const ty = 310 - focus.centerY * scale;
  dom.mapScene.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(3)})`);
}

function renderMap() {
  const copy = modeCopy();
  const values = mapDepartmentValues();
  const scale = valuesForColor([...values.values()]);
  const selected = normalizeDepartment(state.selectedDepartment);
  [...dom.mapLayer.children].forEach(path => {
    const code = String(path.dataset.code || '');
    const value = values.get(normalizeDepartment(code)) || values.get(code) || 0;
    path.style.fill = colorFor(value, scale);
    path.classList.toggle('selected', Boolean(selected && normalizeDepartment(code) === selected));
    path.style.opacity = isOverseasCode(code) && !selected && !state.region ? '.25' : '1';
    const name = data.featureByCode.get(code)?.properties?.nom || code;
    path.setAttribute('aria-label', `${name} : ${formatValue(value, state.metric === 'perCapita')}`);
  });
  setText(dom.mapBadgeText, state.mode === 'communes' ? `${formatCount(pointRows().length)} points communaux` : `${data.features.length} contours administratifs`);
  const shownValues = [...values.values()].filter(value => value > 0);
  setText(dom.legendLow, shownValues.length ? formatValue(Math.min(...shownValues), state.metric === 'perCapita') : 'Faible');
  setText(dom.legendHigh, shownValues.length ? formatValue(Math.max(...shownValues), state.metric === 'perCapita') : 'Élevé');
  setText(dom.legendTitle, state.metric === 'perCapita' ? 'Dépense par habitant' : 'Montant dans la sélection');
  setText(dom.mapTitle, copy.title);
  setText(dom.mapUnit, copy.unit);
  setText(dom.mapKicker, copy.kicker);
  setText(dom.mapHelp, copy.help);
  setText(dom.mapSubtitle, state.selectedCommune ? 'Commune sélectionnée · zoom animé' : state.selectedDepartment ? 'Département sélectionné · cliquez sur un point pour descendre au niveau communal' : 'Survolez un territoire, puis cliquez pour zoomer.');
  renderPoints();
  requestAnimationFrame(applyTransform);
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
    if (commune) return { title: commune.name, kicker: `COMMUNE · ${commune.code}`, name: commune.name };
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
  setText(dom.inspectorKicker, context.kicker); setText(dom.inspectorTitle, context.title);
  dom.clearSelection.hidden = !(state.selectedDepartment || state.selectedCommune || state.region);
  const metricText = state.metric === 'perCapita' ? 'par habitant' : 'au total';
  const scopeText = state.selectedCommune ? `Budget et données disponibles pour ${context.name}.` : state.selectedDepartment ? `${formatCount(summary.count)} lignes rattachées au département ${context.name}.` : state.region ? `${formatCount(summary.count)} lignes dans la région ${context.name}.` : `${formatCount(summary.count)} lignes dans la vue actuelle.`;
  setText(dom.inspectorSummary, `${scopeText} Lecture ${metricText}.`);
  renderInspectorStats(summary, rows);
  let items = []; let heading = 'À la une'; let countLabel = '';
  if (state.mode === 'projects') { items = [...projectRowsForScope(rows)].sort((a, b) => projectMetric(b) - projectMetric(a)); heading = state.selectedCommune ? 'Projets de la commune' : 'Projets les plus financés'; countLabel = `${formatCount(rows.length)} projets`; }
  else if (state.mode === 'communes') { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); heading = state.selectedDepartment ? 'Communes du département' : 'Communes les plus dépensières'; countLabel = `${formatCount(rows.length)} communes`; }
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
    const [projectsResponse, boundariesResponse, budgetsResponse] = await Promise.all([
      fetch('./data/projects-2025.json'), fetch('./data/departments.geojson'), fetch('./data/budgets-2025.json')
    ]);
    if (!projectsResponse.ok || !boundariesResponse.ok || !budgetsResponse.ok) throw new Error('Un fichier de données est indisponible.');
    data.projects = await projectsResponse.json(); data.boundaries = await boundariesResponse.json();
    const budgets = await budgetsResponse.json(); data.communes = budgets.communes || []; data.departments = budgets.departments || []; data.regions = budgets.regions || [];
    setupDerivedData(); setupFilters(); setupMap(); setupListeners();
    setText(dom.dataStatus, `${formatCount(data.projects.length)} projets · ${formatCount(data.communes.length)} communes`);
    setText(dom.scopeText, 'DGCL · OFGL · contours Etalab · données 2025');
    render();
  } catch (error) {
    console.error(error); setText(dom.dataStatus, 'Données indisponibles'); setText(dom.scopeText, 'Rechargez la page pour réessayer.'); setText(dom.inspectorSummary, 'Impossible de charger les données locales.');
  }
}

dom.more.addEventListener('click', () => { state.limit += 12; renderInspector(); });
init();
