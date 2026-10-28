/* FranceRoueLibre – spending explorer.
   The map is rendered on the GPU with MapLibre GL (vendor/maplibre-gl.js):
   geometry is tiled in a web worker, zoom and pan run at display rate, and
   territories are coloured through feature-state instead of DOM nodes. */

const $ = id => document.getElementById(id);
const dom = {
  theme: $('themeToggle'),
  header: $('siteHeader'),
  indicator: $('indicator'),
  indicatorWrap: $('indicatorWrap'),
  indicatorNote: $('indicatorNote'),
  mapYear: $('mapYear'),
  yearWrap: $('yearWrap'),
  yearPlay: $('yearPlay'),
  modeTabs: [...document.querySelectorAll('[data-mode]')],
  metricButtons: [...document.querySelectorAll('[data-metric]')],
  search: $('search'),
  region: $('region'),
  scheme: $('scheme'),
  schemeFilter: document.querySelector('.scheme-filter'),
  reset: $('reset'),
  totalLabel: $('totalLabel'),
  totalAmount: $('totalAmount'),
  countLabel: $('countLabel'),
  projectCount: $('projectCount'),
  coverageLabel: $('coverageLabel'),
  departmentCount: $('departmentCount'),
  statsContext: $('statsContext'),
  filterTitle: $('filterTitle'),
  mapKicker: $('mapKicker'),
  mapTitle: $('mapTitle'),
  mapSubtitle: $('mapSubtitle'),
  mapUnit: $('mapUnit'),
  mapFrame: $('mapFrame'),
  map: $('map'),
  mapLoading: $('mapLoading'),
  tooltip: $('mapTooltip'),
  mapBadgeText: $('mapBadgeText'),
  detailStatus: $('detailStatus'),
  legendTitle: $('legendTitle'),
  legendLow: $('legendLow'),
  legendHigh: $('legendHigh'),
  missingLegend: $('missingLegend'),
  mapHelp: $('mapHelp'),
  inspectorKicker: $('inspectorKicker'),
  inspectorTitle: $('inspectorTitle'),
  inspectorSummary: $('inspectorSummary'),
  inspectorStats: $('inspectorStats'),
  listHeading: $('listHeading'),
  listCount: $('listCount'),
  projectList: $('projectList'),
  more: $('more'),
  clearSelection: $('clearSelection'),
  zoomIn: $('zoomIn'),
  zoomOut: $('zoomOut'),
  resetView: $('resetView'),
  dataStatus: $('dataStatus'),
  scopeText: $('scopeText')
};

const state = {
  mode: 'projects',
  communeYear: 2025,
  localYear: 2025,
  metric: 'total',
  indicator: 'depenses-totales',
  year: 2025,
  selectedGfp: '',
  region: '',
  scheme: '',
  search: '',
  selectedDepartment: '',
  selectedCommune: '',
  limit: 8
};

const data = {
  projects: [],
  communes: [],
  communeMetadata: new Map(),
  communeHistory: new Map(),
  localHistory: new Map(),
  communeCoverage: null,
  missingCommunes: [],
  departments: [],
  regions: [],
  boundaries: null,
  features: [],
  featureByCode: new Map(),
  communeByCode: new Map(),
  deptByCode: new Map(),
  regionByName: new Map(),
  regionByCode: new Map(),
  populationByDepartment: new Map(),
  projectRows: [],
  communeFeatures: null,
  communeFeatureByCode: new Map(),
  communeBBox: new Map(),
  departmentBBox: new Map(),
  activeCommuneRowsByCode: new Map(),
  currentMapDepartmentValues: new Map(),
  communeLayerKey: '',
  localIndex: null,
  localCache: new Map(),
  gfp: [],
  gfpByCode: new Map()
};
const LEGACY_INDICATOR = 'depenses-totales';
const LEGACY_YEARS = Array.from({ length: 14 }, (_, i) => 2012 + i);

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const lowerText = value => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLocaleLowerCase('fr-FR');
const matches = (value, query) => !query || lowerText(value).includes(lowerText(query));
const COMMUNE_COLOR_BUCKETS = 12;
const FRANCE_BOUNDS = [[-5.3, 41.3], [9.7, 51.15]];
const DETAIL_ZOOM = 7;
const EMPTY = { type: 'FeatureCollection', features: [] };
const normalizeDepartment = code => {
  const value = String(code ?? '');
  if (value === '67A') return '67';
  if (value === '691') return '69';
  return value;
};

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
  if (!Number.isFinite(value)) return '–';
  if (perCapita) return `${decimalFormat.format(value)} €/hab.`;
  return formatCompact(value);
}

function formatMetric(value) {
  if (state.metric === 'perCapita') return formatValue(value, true);
  if (state.metric === 'share') {
    if (!Number.isFinite(value) || !state.shareBase) return '–';
    const pct = 100 * value / state.shareBase;
    if (pct > 0 && pct < .01) return '< 0,01 %';
    return `${pct.toLocaleString('fr-FR', { maximumFractionDigits: pct < 1 ? 2 : 1 })} %`;
  }
  return formatValue(value);
}

function shareBaseForMode() {
  if (state.mode === 'projects') return sum(data.projectRows, row => row.amount);
  if (state.mode === 'communes') return sum(data.communes, row => row.total);
  if (state.mode === 'departments') return sum(data.departments, row => row.total);
  if (state.mode === 'gfp') return sum(data.gfp, row => row.total);
  return sum(data.regions, row => row.total);
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + (Number(getter(row)) || 0), 0);
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} indisponible`);
  return response.json();
}

/* ---------- Geometry ---------- */

function walkCoordinates(coords, callback) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') callback(coords);
  else coords.forEach(item => walkCoordinates(item, callback));
}

function bboxOfGeometry(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  walkCoordinates(geometry?.coordinates, ([x, y]) => {
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  });
  return Number.isFinite(box[0]) ? box : null;
}

function unionBBox(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((acc, box) => [Math.min(acc[0], box[0]), Math.min(acc[1], box[1]), Math.max(acc[2], box[2]), Math.max(acc[3], box[3])]);
}

/* Decode the compact geometry written by scripts/web-data.mjs (integer deltas). */
function decodeFeatures(payload, propertyNames, bboxes) {
  const scale = payload.scale;
  return {
    type: 'FeatureCollection',
    features: payload.features.map(entry => {
      const polygons = entry[entry.length - 1];
      const properties = {};
      propertyNames.forEach((name, index) => { properties[name] = entry[index]; });
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const coordinates = polygons.map(polygon => polygon.map(ring => {
        const points = new Array(ring.length / 2);
        let x = 0, y = 0;
        for (let i = 0, j = 0; i < ring.length; i += 2, j++) {
          x += ring[i]; y += ring[i + 1];
          const lon = x / scale, lat = y / scale;
          points[j] = [lon, lat];
          if (lon < minX) minX = lon; if (lon > maxX) maxX = lon;
          if (lat < minY) minY = lat; if (lat > maxY) maxY = lat;
        }
        return points;
      }));
      if (bboxes && Number.isFinite(minX)) bboxes.set(properties.code, [minX, minY, maxX, maxY]);
      return {
        type: 'Feature',
        properties,
        geometry: coordinates.length === 1 ? { type: 'Polygon', coordinates: coordinates[0] } : { type: 'MultiPolygon', coordinates }
      };
    })
  };
}

/* ---------- Data helpers ---------- */

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

function regionNameForCode(regionCode) {
  const known = data.regionByCode.get(String(regionCode));
  if (known?.name) return known.name;
  const feature = data.features.find(item => String(item.properties?.region || '') === String(regionCode));
  return feature?.properties?.nom || String(regionCode);
}

function regionCodeForName(name) {
  return data.regionByName.get(name)?.code ?? data.regions.find(row => row.name === name)?.code ?? '';
}

function populationForDepartment(code) {
  return data.populationByDepartment.get(normalizeDepartment(code)) || 0;
}

function populationForProject(row) {
  return row.communeData?.population || populationForDepartment(row.department);
}

function projectMetric(row) {
  if (state.metric !== 'perCapita') return row.amount;
  const population = populationForProject(row);
  return population ? row.amount / population : 0;
}

function valueForBudget(row) {
  return state.metric !== 'perCapita' ? row.total : row.perCapita;
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
  return data.projectRows.filter(row => {
    if (state.region && row.regionName !== state.region) return false;
    if (state.scheme && row.scheme !== state.scheme) return false;
    if (state.selectedDepartment && normalizeDepartment(row.department) !== normalizeDepartment(state.selectedDepartment)) return false;
    if (state.selectedCommune && row.commune !== state.selectedCommune) return false;
    if (!state.search) return true;
    return [row.title, row.beneficiary, row.scheme, row.communeData?.name, row.departmentName].some(value => matches(value, state.search));
  });
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
    if (state.selectedDepartment && !(row.code === '67A' && ['67', '68'].includes(normalizeDepartment(state.selectedDepartment))) && normalizeDepartment(row.code) !== normalizeDepartment(state.selectedDepartment)) return false;
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
  if (state.mode === 'gfp') return filteredGfp();
  return filteredProjects();
}

function filteredMissingCommunes() {
  return data.missingCommunes.filter(row => {
    if (state.region && row.regionName !== state.region) return false;
    if (state.selectedDepartment && normalizeDepartment(row.department) !== normalizeDepartment(state.selectedDepartment)) return false;
    if (state.selectedCommune && row.code !== state.selectedCommune) return false;
    return !state.search || [row.name, row.code, row.departmentName, row.regionName].some(value => matches(value, state.search));
  });
}

function setupDerivedData() {
  data.features = data.boundaries.features || [];
  data.features.forEach(feature => {
    const code = String(feature.properties?.code || '');
    data.featureByCode.set(code, feature);
    data.departmentBBox.set(code, bboxOfGeometry(feature.geometry));
  });
  data.communes.forEach(row => data.communeByCode.set(row.code, row));
  data.departments.forEach(row => { const code = normalizeDepartment(row.code); if (!data.deptByCode.has(code) || row.code === code) data.deptByCode.set(code, row); });
  data.regions.forEach(row => { data.regionByCode.set(String(row.code), row); data.regionByName.set(row.name, row); });
  data.communes.forEach(row => {
    const department = normalizeDepartment(row.department);
    data.populationByDepartment.set(department, (data.populationByDepartment.get(department) || 0) + (row.population || 0));
  });
  data.projectRows = data.projects.map(row => {
    const communeData = data.communeByCode.get(row.commune) || data.communeMetadata.get(row.commune);
    const department = normalizeDepartment(row.department);
    return {
      ...row,
      department,
      departmentName: data.deptByCode.get(department)?.name || data.featureByCode.get(department)?.properties?.nom || row.department,
      regionName: regionForDepartment(department),
      communeData
    };
  });
}

function setupFilters() {
  const projectRegionNames = data.projectRows.map(row => row.regionName).filter(Boolean);
  const regionNames = [...new Set([...data.regions.map(row => row.name), ...projectRegionNames].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  regionNames.forEach(name => addOption(dom.region, name, name));
  const schemes = [...new Set(data.projects.map(row => row.scheme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  schemes.forEach(scheme => addOption(dom.scheme, scheme, scheme));
}

function inferSearchMode(query) {
  const needle = lowerText(query).trim();
  if (needle.length < 2) return '';
  const exactCommune = [...data.communeMetadata.values()].some(row => lowerText(row.name) === needle || lowerText(row.code) === needle);
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
  if ([...data.communeMetadata.values()].some(row => [row.name, row.code].some(value => matches(value, needle)))) return 'communes';
  if (data.departments.some(row => [row.name, row.code].some(value => matches(value, needle)))) return 'departments';
  if (data.regions.some(row => [row.name, row.code].some(value => matches(value, needle)))) return 'regions';
  return '';
}

/* ---------- Indicators (OFGL aggregates) by level and year ---------- */

const levelOf = mode => mode === 'departments' ? 'departements' : mode;

function indicatorLabel() {
  return data.localIndex?.aggregates?.[state.indicator]?.label || 'Dépenses totales';
}

function yearsFor(mode = state.mode, indicator = state.indicator) {
  if (mode === 'projects') return [2025];
  if (indicator === LEGACY_INDICATOR && mode !== 'gfp') return LEGACY_YEARS;
  return data.localIndex?.levels?.[levelOf(mode)]?.years || [];
}

function getLocal(level, name) {
  const key = `${level}/${name}`;
  if (!data.localCache.has(key)) {
    const promise = fetchJson(`./data/local/${key}.json`);
    promise.catch(() => data.localCache.delete(key));
    data.localCache.set(key, promise);
  }
  return data.localCache.get(key);
}

function availableIndicator(mode) {
  if (mode === 'projects') return state.indicator;
  const aggregates = data.localIndex?.aggregates || {};
  if (state.indicator === LEGACY_INDICATOR && mode !== 'gfp') return state.indicator;
  if (aggregates[state.indicator]?.levels.includes(levelOf(mode))) return state.indicator;
  if (mode !== 'gfp') return LEGACY_INDICATOR;
  return aggregates[LEGACY_INDICATOR]?.levels.includes('gfp') ? LEGACY_INDICATOR : Object.keys(aggregates).find(slug => aggregates[slug].levels.includes('gfp'));
}

/* Loads the rows of the current mode × indicator × year into data.communes / departments / regions / gfp. */
async function loadModeData() {
  const mode = state.mode;
  if (mode === 'projects') return;
  state.indicator = availableIndicator(mode);
  const years = yearsFor();
  if (!years.includes(state.year)) state.year = years[years.length - 1];
  const year = state.year, indicator = state.indicator;
  const localYears = data.localIndex?.levels?.communes?.years || [];
  if (indicator === LEGACY_INDICATOR && mode === 'communes' && !(localYears.includes(year) && data.localIndex?.aggregates?.[LEGACY_INDICATOR]?.levels.includes('communes'))) { await setCommuneYear(year); return; }
  if (indicator === LEGACY_INDICATOR && (mode === 'departments' || mode === 'regions')) { await setLocalYear(year); return; }
  const level = levelOf(mode);
  const [values, population, entities, members] = await Promise.all([
    getLocal(level, indicator), getLocal(level, '_pop'), level === 'communes' ? null : getLocal(level, '_entities'), level === 'gfp' ? getLocal('gfp', '_communes').catch(() => null) : null
  ]);
  const yi = values.years.indexOf(year), pi = population.years.indexOf(year);
  const valueAt = i => values.values[yi]?.[i] ?? null;
  const popAt = i => population.values[pi]?.[i] || 0;
  if (level === 'communes') {
    const rows = [], missing = [];
    [...data.communeMetadata.values()].forEach((meta, i) => {
      const value = valueAt(i);
      if (value == null) { missing.push({ ...meta, total: null, perCapita: null, population: null, missing: true }); return; }
      const people = popAt(i);
      rows.push({ ...meta, total: value, population: people, perCapita: people ? value / people : 0 });
    });
    data.communes = rows; data.missingCommunes = missing; data.communeCoverage = null; state.communeYear = year;
    return;
  }
  const rows = entities.codes.map((code, i) => {
    const value = valueAt(i);
    if (value == null) return null;
    const people = popAt(i);
    return { code, name: entities.names?.[i] || code, total: value, population: people, perCapita: people ? value / people : 0 };
  }).filter(Boolean);
  if (level === 'departements') {
    rows.forEach(row => { row.regionName = regionForDepartment(row.code); });
    data.departments = rows; state.localYear = year;
  } else if (level === 'regions') {
    data.regions = rows; state.localYear = year;
  } else {
    const codes = [...data.communeMetadata.keys()];
    rows.forEach(row => {
      row.communes = (members?.members?.[row.code] || []).map(index => codes[index]);
      const first = data.communeMetadata.get(row.communes[0]);
      row.regionName = first?.regionName || '';
      row.department = first?.department || '';
    });
    data.gfp = rows;
    data.gfpByCode = new Map(rows.map(row => [row.code, row]));
  }
}

function filteredGfp() {
  return data.gfp.filter(row => {
    if (state.region && row.regionName !== state.region) return false;
    if (state.selectedGfp && row.code !== state.selectedGfp) return false;
    if (!state.search) return true;
    return [row.name, row.code].some(value => matches(value, state.search));
  });
}

function setupIndicators() {
  const index = data.localIndex;
  const gfpTab = document.querySelector('[data-mode="gfp"]');
  if (gfpTab) gfpTab.hidden = !index?.levels?.gfp;
  if (!index) return;
  clearChildren(dom.indicator);
  const groups = new Map();
  Object.entries(index.aggregates).forEach(([slug, item]) => {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push([slug, item.label]);
  });
  ['Dépenses', 'Recettes', 'Dette et équilibre', 'Autres'].forEach(group => {
    const items = groups.get(group);
    if (!items) return;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group;
    items.sort((a, b) => a[1].localeCompare(b[1], 'fr')).forEach(([slug, label]) => addOption(optgroup, slug, label));
    dom.indicator.appendChild(optgroup);
  });
  dom.indicator.value = state.indicator;
}

function syncYearControl() {
  const years = yearsFor();
  const signature = years.join(',');
  if (dom.mapYear.dataset.years !== signature) {
    clearChildren(dom.mapYear);
    [...years].reverse().forEach(year => addOption(dom.mapYear, String(year), String(year)));
    dom.mapYear.dataset.years = signature;
  }
  dom.mapYear.value = String(state.year);
  dom.yearPlay.disabled = years.length < 2;
}

let yearTimer = 0, yearBusy = false;
function stopYearPlay() {
  window.clearInterval(yearTimer); yearTimer = 0;
  dom.yearPlay.classList.remove('is-playing');
  dom.yearPlay.setAttribute('aria-label', 'Animer les années');
}

function toggleYearPlay() {
  if (yearTimer) { stopYearPlay(); return; }
  const years = yearsFor();
  let index = years.indexOf(state.year);
  if (index >= years.length - 1) index = -1;
  dom.yearPlay.classList.add('is-playing');
  dom.yearPlay.setAttribute('aria-label', 'Mettre en pause');
  const step = async () => {
    if (yearBusy) return;
    index += 1;
    if (index >= years.length) { stopYearPlay(); return; }
    yearBusy = true;
    try { state.year = years[index]; await loadModeData(); render(); }
    finally { yearBusy = false; }
  };
  step();
  yearTimer = window.setInterval(step, 1100);
}

async function changeView(update) {
  stopYearPlay();
  update();
  setText(dom.statsContext, 'Chargement…');
  try { await loadModeData(); }
  catch (error) { console.error(error); setText(dom.statsContext, 'Impossible de charger ces données. Réessayez.'); return; }
  render();
}

/* ---------- Colours ---------- */

const RAMPS = {
  light: ['#d7eef3', '#8fd0de', '#22a5c0', '#0e7490', '#2563eb', '#1e3a8a'],
  dark: ['#143246', '#135a73', '#0e86a8', '#2b8fdb', '#5b8ef7', '#c7dcff']
};
const MAP_THEME = {
  light: { background: '#eef4f8', empty: '#dde7ee', line: 'rgba(13, 27, 42, .32)', communeLine: 'rgba(255, 255, 255, .7)', hover: '#0d1b2a', selection: '#f59e0b', missing: '#a58bb0' },
  dark: { background: '#0c1925', empty: '#16283a', line: 'rgba(214, 232, 245, .38)', communeLine: 'rgba(10, 21, 32, .55)', hover: '#ffffff', selection: '#fbbf24', missing: '#7d6390' }
};
/* One duration for the whole theme switch, read from the CSS token so the map crossfade matches the page. */
const themeDuration = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-transition-duration')) || 700;
const currentTheme = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function colorForRatio(ratio) {
  const ramp = RAMPS[currentTheme()];
  const position = Math.max(0, Math.min(1, ratio)) * (ramp.length - 1);
  const index = Math.min(ramp.length - 2, Math.floor(position));
  const t = position - index;
  const a = hexToRgb(ramp[index]), b = hexToRgb(ramp[index + 1]);
  return `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * t)).join(',')})`;
}

function valuesForColor(values) {
  let min = Infinity, max = -Infinity;
  for (const value of values) if (Number.isFinite(value) && value > 0) { if (value < min) min = value; if (value > max) max = value; }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 1 };
}

function colorRatio(value, scale) {
  if (!value || value <= 0) return 0;
  const low = Math.log1p(scale.min);
  const high = Math.log1p(scale.max);
  return Math.max(0, Math.min(1, high === low ? .72 : (Math.log1p(value) - low) / (high - low)));
}

function colorFor(value, scale) {
  if (!value || value <= 0) return MAP_THEME[currentTheme()].empty;
  return colorForRatio(colorRatio(value, scale));
}

/* ---------- Map values ---------- */

function metricLabel() {
  return state.metric === 'perCapita' ? 'par habitant' : 'total';
}

function modeCopy() {
  const label = indicatorLabel();
  const legacy = state.indicator === LEGACY_INDICATOR;
  const localContext = `Source OFGL ${state.year} · ${label}, comptes consolidés (budgets principaux et annexes). Montants nets : une valeur négative est possible (atténuations, restitutions).`;
  const copy = {
    projects: { filter: 'Explorer les projets', kicker: 'Projets financés par l’État', title: 'Subventions par commune', unit: 'Subventions accordées', count: 'Projets', coverage: 'Départements touchés', help: 'Cliquez sur une commune ou un département pour inspecter les projets.', context: 'Source DGCL 2025 · engagements de subventions d’investissement.' },
    communes: { filter: 'Explorer les budgets communaux', kicker: `Communes · OFGL ${state.year}`, title: `${label} par commune`, unit: label, count: 'Communes', coverage: 'Départements couverts', help: 'Cliquez sur une commune pour inspecter son budget et zoomer.', context: legacy ? 'Source OFGL · dépenses totales des communes, avec montant par habitant.' : localContext },
    gfp: { filter: 'Explorer les intercommunalités', kicker: `Intercommunalités · OFGL ${state.year}`, title: `${label} par intercommunalité`, unit: label, count: 'Intercommunalités', coverage: 'Communes membres', help: 'Cliquez sur une intercommunalité pour l’inspecter.', context: `${localContext} Périmètres ${data.localIndex?.levels?.gfp?.membershipYear || ''}; les comptes antérieurs sont rattachés à l’intercommunalité de 2025 qui leur succède.` },
    departments: { filter: 'Explorer les budgets départementaux', kicker: `Départements · OFGL ${state.year}`, title: `${label} par département`, unit: label, count: 'Départements', coverage: 'Régions couvertes', help: 'Cliquez sur un département pour isoler son budget.', context: legacy ? 'Source OFGL · dépenses totales des départements, avec montant par habitant.' : localContext },
    regions: { filter: 'Explorer les budgets régionaux', kicker: `Régions · OFGL ${state.year}`, title: `${label} par région`, unit: label, count: 'Régions', coverage: 'Régions affichées', help: 'Cliquez sur une région pour recentrer la lecture.', context: legacy ? 'Source OFGL · dépenses totales des régions, avec montant par habitant.' : localContext }
  };
  return copy[state.mode];
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
  if (state.mode === 'gfp') return data.gfp.filter(row => !state.search || [row.name, row.code].some(value => matches(value, state.search)));
  return data.regions.filter(row => !state.search || [row.name, row.code].some(value => matches(value, state.search)));
}

function mapDepartmentValues(rows) {
  const values = new Map();
  if (state.mode === 'projects') {
    const totals = new Map();
    rows.forEach(row => totals.set(row.department, (totals.get(row.department) || 0) + row.amount));
    totals.forEach((total, code) => values.set(code, state.metric !== 'perCapita' ? total : (populationForDepartment(code) ? total / populationForDepartment(code) : 0)));
  } else if (state.mode === 'communes') {
    const totals = new Map(); const populations = new Map();
    rows.forEach(row => { const code = normalizeDepartment(row.department); totals.set(code, (totals.get(code) || 0) + row.total); populations.set(code, (populations.get(code) || 0) + (row.population || 0)); });
    totals.forEach((total, code) => values.set(code, state.metric !== 'perCapita' ? total : (populations.get(code) ? total / populations.get(code) : 0)));
  } else if (state.mode === 'departments') {
    const grouped = new Map();
    rows.forEach(row => {
      const codes = row.code === '67A' ? ['67', '68'] : [normalizeDepartment(row.code)];
      codes.forEach(code => {
        const item = grouped.get(code) || { total: 0, population: 0 };
        item.total += row.total; item.population += row.population;
        grouped.set(code, item);
      });
    });
    grouped.forEach((item, code) => values.set(code, state.metric !== 'perCapita' ? item.total : item.total / item.population));
  } else if (state.mode === 'regions') {
    const byRegion = new Map(rows.map(row => [String(row.code), valueForBudget(row)]));
    data.features.forEach(feature => { const region = String(feature.properties?.region || ''); if (byRegion.has(region)) values.set(String(feature.properties.code), byRegion.get(region)); });
  }
  return values;
}

function communeShapeRows(rows) {
  if (state.mode === 'gfp') {
    const shapes = [];
    rows.forEach(row => row.communes.forEach(code => shapes.push({ code, name: row.name, total: row.total, perCapita: row.perCapita, population: row.population, gfp: row.code })));
    return shapes;
  }
  if (state.mode === 'communes') {
    const missing = data.missingCommunes.filter(row => !state.search || [row.name, row.code, row.departmentName, row.regionName].some(value => matches(value, state.search)));
    return [...rows, ...missing];
  }
  if (state.mode === 'projects') {
    const grouped = new Map();
    rows.forEach(row => {
      if (!row.commune) return;
      const code = String(row.commune);
      const item = grouped.get(code) || { code, name: row.communeData?.name || data.communeFeatureByCode.get(code)?.properties?.nom || code, department: row.department, total: 0, population: row.communeData?.population || 0 };
      item.total += row.amount;
      if (!item.population && row.communeData?.population) item.population = row.communeData.population;
      grouped.set(code, item);
    });
    return [...grouped.values()].map(row => ({ ...row, perCapita: row.population ? row.total / row.population : 0 }));
  }
  return [];
}

function communeShapeValue(row) {
  return state.mode === 'projects' ? (state.metric !== 'perCapita' ? row.total : row.perCapita) : valueForBudget(row);
}

/* ---------- Map (MapLibre GL) ---------- */

const mapState = {
  map: null,
  ready: false,
  cameraKey: '',
  hoverCommune: '',
  hoverDepartment: '',
  hoverRegion: '',
  communeStateCodes: new Set(),
  communeColors: new Map(),
  departmentColors: new Map(),
  detailedDepartments: new Set(),
  detailFeatures: [],
  detailLoading: false,
  largeDetail: null,
  regionsLoaded: null,
  regionFeatures: []
};

const fillColorFromState = fallback => ['to-color', ['coalesce', ['feature-state', 'c'], fallback]];
const hasColor = ['to-boolean', ['feature-state', 'c']];
const isHover = ['boolean', ['feature-state', 'hover'], false];

function mapPadding() {
  const width = dom.map.clientWidth;
  const base = width < 600 ? 28 : 56;
  return { top: base + (width < 600 ? 40 : 30), bottom: base + (width < 600 ? 50 : 70), left: base, right: base };
}

function buildMapStyle() {
  const theme = MAP_THEME[currentTheme()];
  return {
    version: 8,
    transition: { duration: 0, delay: 0 }, // theme changes are crossfaded by applyMapTheme instead
    sources: {
      departments: { type: 'geojson', data: data.boundaries, promoteId: 'code', tolerance: .3 },
      communes: { type: 'geojson', data: data.communeFeatures, promoteId: 'code', maxzoom: 10, tolerance: .45 },
      'communes-detail': { type: 'geojson', data: EMPTY, promoteId: 'code', maxzoom: 13 },
      regions: { type: 'geojson', data: EMPTY, promoteId: 'code' },
      selection: { type: 'geojson', data: EMPTY }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': theme.background } },
      { id: 'dept-fill', type: 'fill', source: 'departments', paint: { 'fill-color': fillColorFromState(theme.empty), 'fill-opacity': 1 } },
      { id: 'commune-fill', type: 'fill', source: 'communes', paint: { 'fill-color': fillColorFromState('rgba(0,0,0,0)'), 'fill-opacity': ['case', hasColor, 1, 0] } },
      { id: 'commune-line', type: 'line', source: 'communes', paint: { 'line-color': theme.communeLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, .1, 7, .45], 'line-opacity': ['case', hasColor, 1, 0] } },
      { id: 'commune-detail-fill', type: 'fill', source: 'communes-detail', paint: { 'fill-color': fillColorFromState('rgba(0,0,0,0)'), 'fill-opacity': ['case', hasColor, 1, 0] } },
      { id: 'commune-detail-line', type: 'line', source: 'communes-detail', paint: { 'line-color': theme.communeLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, .1, 7, .45, 12, 1.2], 'line-opacity': ['case', hasColor, 1, 0] } },
      { id: 'dept-line', type: 'line', source: 'departments', paint: { 'line-color': theme.line, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, .5, 9, 1.4] } },
      { id: 'region-line', type: 'line', source: 'regions', layout: { visibility: 'none' }, paint: { 'line-color': theme.hover, 'line-opacity': ['case', isHover, 1, .65], 'line-width': ['case', isHover, 2.6, 1.6] } },
      { id: 'dept-hover', type: 'line', source: 'departments', paint: { 'line-color': theme.hover, 'line-width': 2.2, 'line-opacity': ['case', isHover, 1, 0] } },
      { id: 'commune-hover', type: 'line', source: 'communes', paint: { 'line-color': theme.hover, 'line-width': 1.8, 'line-opacity': ['case', isHover, 1, 0] } },
      { id: 'commune-detail-hover', type: 'line', source: 'communes-detail', paint: { 'line-color': theme.hover, 'line-width': 2, 'line-opacity': ['case', isHover, 1, 0] } },
      { id: 'selection-glow', type: 'line', source: 'selection', paint: { 'line-color': theme.selection, 'line-width': 7, 'line-opacity': .25, 'line-blur': 3 } },
      { id: 'selection-line', type: 'line', source: 'selection', paint: { 'line-color': theme.selection, 'line-width': 2.4 } }
    ]
  };
}

function applyMapTheme() {
  const map = mapState.map;
  if (!map || !mapState.ready) return;
  // The WebGL map cannot interpolate its feature colours: freeze the current frame in a 2D canvas laid over it,
  // switch the map to the new theme underneath, then fade the snapshot out with the page's duration and easing.
  const canvas = map.getCanvas();
  let snapshot = null;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && canvas.width && canvas.height) {
    try {
      map.redraw();
      snapshot = document.createElement('canvas');
      snapshot.width = canvas.width; snapshot.height = canvas.height;
      snapshot.className = 'map-theme-snapshot';
      snapshot.getContext('2d').drawImage(canvas, 0, 0);
      document.querySelectorAll('.map-theme-snapshot').forEach(node => node.remove());
      canvas.parentNode.appendChild(snapshot);
    } catch (error) { snapshot?.remove(); snapshot = null; }
  }
  const theme = MAP_THEME[currentTheme()];
  map.setPaintProperty('background', 'background-color', theme.background);
  map.setPaintProperty('commune-line', 'line-color', theme.communeLine);
  map.setPaintProperty('commune-detail-line', 'line-color', theme.communeLine);
  map.setPaintProperty('dept-line', 'line-color', theme.line);
  ['region-line', 'dept-hover', 'commune-hover', 'commune-detail-hover'].forEach(id => map.setPaintProperty(id, 'line-color', theme.hover));
  ['selection-glow', 'selection-line'].forEach(id => map.setPaintProperty(id, 'line-color', theme.selection));
  data.communeLayerKey = '';
  renderMap();
  if (snapshot) {
    map.redraw();
    requestAnimationFrame(() => requestAnimationFrame(() => { snapshot.style.opacity = '0'; }));
    setTimeout(() => snapshot.remove(), themeDuration() + 100);
  }
}

function setHover(source, previous, next) {
  const map = mapState.map;
  if (previous === next) return;
  const sources = source === 'communes' ? ['communes', 'communes-detail'] : [source];
  for (const id of sources) {
    if (previous) map.setFeatureState({ source: id, id: previous }, { hover: false });
    if (next) map.setFeatureState({ source: id, id: next }, { hover: true });
  }
}

function hitTest(point) {
  const map = mapState.map;
  if (['communes', 'projects', 'gfp'].includes(state.mode)) {
    const communeHits = map.queryRenderedFeatures(point, { layers: ['commune-detail-fill', 'commune-fill'] });
    for (const feature of communeHits) {
      const code = String(feature.properties.code);
      if (data.activeCommuneRowsByCode.has(code)) return { type: 'commune', code };
    }
  }
  const departmentHit = map.queryRenderedFeatures(point, { layers: ['dept-fill'] })[0];
  if (departmentHit) return { type: 'department', code: String(departmentHit.properties.code), region: String(departmentHit.properties.region || '') };
  return null;
}

function tooltipHtml(title, value) {
  const span = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = title;
  const detail = document.createElement('span'); detail.textContent = value;
  span.append(strong, detail);
  return span;
}

function showTooltip(point, title, value) {
  dom.tooltip.replaceChildren(tooltipHtml(title, value));
  dom.tooltip.hidden = false;
  const width = dom.mapFrame.clientWidth;
  const flip = point.x > width - 240;
  dom.tooltip.style.transform = `translate3d(${Math.round(flip ? point.x - dom.tooltip.offsetWidth - 14 : point.x + 14)}px, ${Math.round(point.y + 14)}px, 0)`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
}

function handleHover(point) {
  const hit = hitTest(point);
  const perCapita = state.metric === 'perCapita';
  const communeCode = hit?.type === 'commune' ? hit.code : '';
  const departmentCode = hit?.type === 'department' && state.mode !== 'regions' ? hit.code : '';
  const regionCode = hit?.type === 'department' && state.mode === 'regions' ? hit.region : '';
  setHover('communes', mapState.hoverCommune, communeCode); mapState.hoverCommune = communeCode;
  setHover('departments', mapState.hoverDepartment, departmentCode); mapState.hoverDepartment = departmentCode;
  setHover('regions', mapState.hoverRegion, regionCode); mapState.hoverRegion = regionCode;
  dom.map.style.cursor = hit ? 'pointer' : '';
  if (!hit) { hideTooltip(); return; }
  if (communeCode) {
    const row = data.activeCommuneRowsByCode.get(communeCode);
    const text = row.missing ? (row.ambiguous ? 'Plusieurs comptes sur ce code : données exclues' : 'Aucun compte correspondant pour cet exercice') : formatMetric(communeShapeValue(row));
    showTooltip(point, row.name, text);
  } else if (regionCode) {
    const region = data.regions.find(item => String(item.code) === regionCode);
    showTooltip(point, regionNameForCode(regionCode), formatMetric(region ? valueForBudget(region) : NaN));
  } else {
    const feature = data.featureByCode.get(departmentCode);
    const value = data.currentMapDepartmentValues.get(normalizeDepartment(departmentCode)) || data.currentMapDepartmentValues.get(departmentCode) || 0;
    showTooltip(point, departmentLabel(departmentCode, feature?.properties?.nom || departmentCode), formatMetric(value));
  }
}

function departmentLabel(code, fallback) {
  if (state.mode !== 'departments') return fallback;
  if (['67', '68'].includes(code) && data.departments.some(row => row.code === '67A')) return 'Alsace (compte commun 67 / 68)';
  if (code === '69') {
    const institutions = data.departments.filter(row => ['69', '691'].includes(row.code));
    if (institutions.length > 1) return 'Rhône et Métropole de Lyon';
  }
  return fallback;
}

function handleClick(point) {
  const hit = hitTest(point);
  if (!hit) {
    if (state.selectedCommune || state.selectedDepartment || state.region) clearSelection();
    return;
  }
  if (hit.type === 'commune' && state.mode === 'gfp') selectGfp(data.activeCommuneRowsByCode.get(hit.code)?.gfp);
  else if (hit.type === 'commune') selectCommune(hit.code);
  else if (state.mode === 'regions') selectRegion(regionNameForCode(hit.region));
  else selectDepartment(hit.code);
}

function initMap() {
  if (!window.maplibregl) throw new Error('MapLibre GL indisponible');
  const map = new maplibregl.Map({
    container: dom.map,
    style: buildMapStyle(),
    bounds: FRANCE_BOUNDS,
    fitBoundsOptions: { padding: mapPadding() },
    minZoom: 1.5,
    maxZoom: 13.5,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    attributionControl: false,
    fadeDuration: 0
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Contours Etalab · DGCL · OFGL' }), 'bottom-right');
  mapState.map = map;
  window.__map = map;

  let hoverFrame = 0, pendingPoint = null;
  map.on('mousemove', event => {
    pendingPoint = event.point;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; if (mapState.ready && pendingPoint) handleHover(pendingPoint); });
  });
  map.on('mouseout', () => {
    pendingPoint = null;
    if (!mapState.ready) return;
    setHover('communes', mapState.hoverCommune, ''); mapState.hoverCommune = '';
    setHover('departments', mapState.hoverDepartment, ''); mapState.hoverDepartment = '';
    setHover('regions', mapState.hoverRegion, ''); mapState.hoverRegion = '';
    hideTooltip();
  });
  map.on('movestart', hideTooltip);
  map.on('click', event => { if (mapState.ready) handleClick(event.point); });
  map.on('moveend', () => { if (mapState.ready) loadVisibleDetail(); });
  return new Promise(resolve => map.once('load', () => { mapState.ready = true; resolve(map); }));
}

/* Colour communes via feature-state; only re-run when the data view changes. */
function renderCommuneColors(rows) {
  const map = mapState.map;
  const visible = ['communes', 'projects', 'gfp'].includes(state.mode);
  const layerKey = visible ? [state.mode, state.indicator, state.year, state.metric, state.search, state.scheme, currentTheme()].join('|') : 'off';
  if (data.communeLayerKey === layerKey) return;
  data.communeLayerKey = layerKey;
  const started = performance.now();
  for (const code of mapState.communeStateCodes) {
    map.removeFeatureState({ source: 'communes', id: code }, 'c');
    map.removeFeatureState({ source: 'communes-detail', id: code }, 'c');
  }
  mapState.communeStateCodes.clear();
  mapState.communeColors.clear();
  data.activeCommuneRowsByCode.clear();
  if (!visible) return;
  const shapes = communeShapeRows(rows).filter(row => data.communeFeatureByCode.has(row.code));
  const scale = valuesForColor(shapes.filter(row => !row.missing).map(communeShapeValue));
  const bucketColors = Array.from({ length: COMMUNE_COLOR_BUCKETS }, (_, index) => colorForRatio((index + .5) / COMMUNE_COLOR_BUCKETS));
  const missingColor = MAP_THEME[currentTheme()].missing;
  for (const row of shapes) {
    data.activeCommuneRowsByCode.set(row.code, row);
    let color = missingColor;
    if (!row.missing) {
      const ratio = colorRatio(communeShapeValue(row), scale);
      color = bucketColors[Math.min(COMMUNE_COLOR_BUCKETS - 1, Math.floor(ratio * COMMUNE_COLOR_BUCKETS))];
    }
    map.setFeatureState({ source: 'communes', id: row.code }, { c: color });
    map.setFeatureState({ source: 'communes-detail', id: row.code }, { c: color });
    mapState.communeColors.set(row.code, color);
    mapState.communeStateCodes.add(row.code);
  }
  window.__frlMapPerformance = { activeCommunes: shapes.length, colourUpdateMs: Number((performance.now() - started).toFixed(1)) };
}

function renderSelection() {
  const map = mapState.map;
  let feature = null;
  if (state.mode === 'gfp' && state.selectedGfp) {
    const row = data.gfpByCode.get(state.selectedGfp);
    const features = (row?.communes || []).map(code => mapState.detailFeatures.find(item => item.properties.code === code) || data.communeFeatureByCode.get(code)).filter(Boolean);
    map.getSource('selection').setData({ type: 'FeatureCollection', features });
    return;
  }
  if (state.selectedCommune) feature = mapState.detailFeatures.find(item => item.properties.code === state.selectedCommune) || data.communeFeatureByCode.get(state.selectedCommune);
  else if (state.selectedDepartment && state.mode !== 'regions') feature = data.featureByCode.get(normalizeDepartment(state.selectedDepartment));
  else if (state.region && state.mode === 'regions') {
    const code = String(regionCodeForName(state.region));
    feature = mapState.regionFeatures.find(item => String(item.properties.code) === code) || null;
  }
  map.getSource('selection').setData(feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY);
}

function focusBounds() {
  if (state.mode === 'gfp' && state.selectedGfp) {
    const box = unionBBox((data.gfpByCode.get(state.selectedGfp)?.communes || []).map(code => data.communeBBox.get(code)));
    if (box) return { box, maxZoom: 10.5 };
  }
  if (state.selectedCommune) {
    const box = data.communeBBox.get(state.selectedCommune);
    if (box) return { box, maxZoom: 11.5 };
    const commune = data.communeMetadata.get(state.selectedCommune);
    if (commune) return { box: [commune.lon - .05, commune.lat - .04, commune.lon + .05, commune.lat + .04], maxZoom: 11.5 };
  }
  if (state.selectedDepartment) {
    const box = data.departmentBBox.get(normalizeDepartment(state.selectedDepartment));
    if (box) return { box, maxZoom: 9.5 };
  }
  if (state.region) {
    const box = unionBBox(data.features.filter(feature => featureRegionName(feature) === state.region).map(feature => data.departmentBBox.get(String(feature.properties.code))));
    if (box) return { box, maxZoom: 9 };
  }
  return { box: [FRANCE_BOUNDS[0][0], FRANCE_BOUNDS[0][1], FRANCE_BOUNDS[1][0], FRANCE_BOUNDS[1][1]], maxZoom: 7 };
}

function updateCamera(force = false) {
  const key = [state.mode, state.selectedCommune, state.selectedDepartment, state.region, state.selectedGfp].join('|');
  if (!force && key === mapState.cameraKey) return;
  mapState.cameraKey = key;
  const { box, maxZoom } = focusBounds();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  mapState.map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: mapPadding(), maxZoom, duration: reduced ? 0 : 900, essential: true });
}

function setSourceData(sourceId, collection, afterLoad) {
  const map = mapState.map;
  const onData = event => {
    if (event.sourceId !== sourceId || !event.isSourceLoaded) return;
    map.off('sourcedata', onData);
    afterLoad?.();
  };
  map.on('sourcedata', onData);
  map.getSource(sourceId).setData(collection);
}

async function ensureRegions() {
  if (!mapState.regionsLoaded) {
    mapState.regionsLoaded = fetchJson('./data/web/regions-detail.json').then(payload => {
      const collection = decodeFeatures(payload, ['code', 'nom', 'unused']);
      mapState.regionFeatures = collection.features;
      mapState.map.getSource('regions').setData(collection);
      renderSelection();
    }).catch(error => { mapState.regionsLoaded = null; console.warn(error); });
  }
  return mapState.regionsLoaded;
}

async function ensureLargeDetail() {
  if (!mapState.largeDetail) {
    mapState.largeDetail = fetchJson('./data/web/departements-detail.json').then(payload => {
      const collection = decodeFeatures(payload, ['code', 'nom', 'region']);
      collection.features.forEach(feature => data.featureByCode.set(String(feature.properties.code), feature));
      setSourceData('departments', collection, () => {
        mapState.departmentColors.forEach((color, code) => mapState.map.setFeatureState({ source: 'departments', id: code }, { c: color }));
      });
      renderSelection();
    }).catch(error => { mapState.largeDetail = null; console.warn(error); });
  }
  return mapState.largeDetail;
}

let detailTimer = 0;
function loadVisibleDetail() {
  window.clearTimeout(detailTimer);
  detailTimer = window.setTimeout(loadVisibleDetailNow, 120);
}

async function loadVisibleDetailNow() {
  const map = mapState.map;
  const zoom = map.getZoom();
  if (zoom >= 6.5) ensureLargeDetail();
  if (zoom < DETAIL_ZOOM - .5 || mapState.detailLoading || !['communes', 'projects', 'gfp'].includes(state.mode)) {
    setText(dom.detailStatus, mapState.detailedDepartments.size && zoom >= DETAIL_ZOOM ? 'Contours 50 m' : 'Contours 1 km');
    return;
  }
  const bounds = map.getBounds();
  const view = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  const codes = [...data.departmentBBox].filter(([code, box]) => box && !mapState.detailedDepartments.has(code) && box[2] >= view[0] && box[0] <= view[2] && box[3] >= view[1] && box[1] <= view[3]).map(([code]) => code);
  if (!codes.length) { setText(dom.detailStatus, 'Contours 50 m'); return; }
  mapState.detailLoading = true;
  setText(dom.detailStatus, 'Chargement des contours détaillés…');
  try {
    const results = await Promise.all(codes.map(code => fetchJson(`./data/web/communes-detail/${encodeURIComponent(code)}.json`).then(payload => ({ code, payload })).catch(error => { console.warn(error); return { code, payload: null }; })));
    for (const { code, payload } of results) {
      mapState.detailedDepartments.add(code);
      if (!payload) continue;
      const collection = decodeFeatures(payload, ['code', 'nom', 'departement']);
      for (const feature of collection.features) if (data.communeFeatureByCode.has(feature.properties.code)) mapState.detailFeatures.push(feature);
    }
    setSourceData('communes-detail', { type: 'FeatureCollection', features: mapState.detailFeatures }, () => {
      // Feature-state does not survive a GeoJSON data swap: re-colour the detailed shapes.
      mapState.communeColors.forEach((color, code) => map.setFeatureState({ source: 'communes-detail', id: code }, { c: color }));
    });
    // Coarse 1 km shapes are hidden wherever the 50 m shapes now exist.
    const hideCoarse = ['!', ['in', ['get', 'departement'], ['literal', [...mapState.detailedDepartments]]]];
    ['commune-fill', 'commune-line', 'commune-hover'].forEach(id => map.setFilter(id, hideCoarse));
    if (state.selectedCommune) renderSelection();
    setText(dom.detailStatus, 'Contours 50 m');
  } finally {
    mapState.detailLoading = false;
  }
  loadVisibleDetail();
}

function renderMap() {
  const copy = modeCopy();
  setText(dom.mapTitle, copy.title);
  setText(dom.mapUnit, copy.unit);
  setText(dom.mapKicker, copy.kicker);
  setText(dom.mapHelp, copy.help);
  setText(dom.legendTitle, state.metric === 'perCapita' ? 'Montant par habitant' : state.metric === 'share' ? 'Part du total national' : 'Montant par territoire');
  if (!mapState.ready) return;
  const map = mapState.map;
  const rows = mapRows();
  const values = mapDepartmentValues(rows);
  data.currentMapDepartmentValues = values;
  const scale = valuesForColor(values.values());
  data.features.forEach(feature => {
    const code = String(feature.properties.code);
    const value = values.get(normalizeDepartment(code)) || values.get(code) || 0;
    const color = colorFor(value, scale);
    mapState.departmentColors.set(code, color);
    map.setFeatureState({ source: 'departments', id: code }, { c: color });
  });
  const communesVisible = ['communes', 'projects', 'gfp'].includes(state.mode);
  // Behind commune colours, departments stay neutral so the communes read clearly.
  map.setPaintProperty('dept-fill', 'fill-color', communesVisible ? MAP_THEME[currentTheme()].empty : fillColorFromState(MAP_THEME[currentTheme()].empty));
  map.setLayoutProperty('region-line', 'visibility', state.mode === 'regions' ? 'visible' : 'none');
  map.setPaintProperty('dept-line', 'line-opacity', state.mode === 'regions' ? .18 : state.mode === 'communes' ? .55 : 1);
  ['commune-fill', 'commune-line', 'commune-detail-fill', 'commune-detail-line', 'commune-hover', 'commune-detail-hover'].forEach(id => map.setLayoutProperty(id, 'visibility', communesVisible ? 'visible' : 'none'));
  if (state.mode === 'regions') ensureRegions();
  renderCommuneColors(rows);
  renderSelection();

  const shownValues = communesVisible
    ? [...data.activeCommuneRowsByCode.values()].filter(row => !row.missing).map(communeShapeValue).filter(value => value > 0)
    : [...values.values()].filter(value => value > 0);
  let low = Infinity, high = -Infinity;
  for (const value of shownValues) { if (value < low) low = value; if (value > high) high = value; }
  setText(dom.legendLow, shownValues.length ? formatMetric(low) : 'Faible');
  setText(dom.legendHigh, shownValues.length ? formatMetric(high) : 'Élevé');
  const communeMapCount = [...data.activeCommuneRowsByCode.values()].filter(row => !row.missing).length;
  setText(dom.mapBadgeText, state.mode === 'regions' ? `${data.regions.length} régions` : state.mode === 'communes' ? `${formatCount(communeMapCount)} communes` : state.mode === 'projects' ? `${formatCount(communeMapCount)} communes avec projets` : state.mode === 'gfp' ? `${formatCount(data.gfp.length)} intercommunalités` : `${data.features.length} départements`);
  updateCamera();
  loadVisibleDetail();
}

/* ---------- Stats & inspector ---------- */

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
    return { total, population, perCapita: population ? total / population : 0, count: scoped.length, coverage: new Set(scoped.map(row => row.department)).size };
  }
  if (state.mode === 'communes') {
    const aggregate = aggregateRows(rows, { getTotal: row => row.total, getPopulation: row => row.population });
    return { ...aggregate, count: rows.length, coverage: new Set(rows.map(row => normalizeDepartment(row.department))).size };
  }
  if (state.mode === 'gfp') {
    const aggregate = aggregateRows(rows, { getTotal: row => row.total, getPopulation: row => row.population });
    return { ...aggregate, count: rows.length, coverage: sum(rows, row => row.communes.length) };
  }
  const aggregate = aggregateRows(rows, { getTotal: row => row.total, getPopulation: row => row.perCapita ? row.total / row.perCapita : 0 });
  if (state.mode === 'departments') return { ...aggregate, count: rows.length, coverage: new Set(rows.map(row => row.regionName)).size };
  return { ...aggregate, count: rows.length, coverage: rows.length };
}

function renderStats(rows, summary) {
  const copy = modeCopy();
  setText(dom.totalLabel, state.metric === 'perCapita' ? 'Par habitant' : state.metric === 'share' ? 'Part du total national' : (state.mode === 'projects' ? 'Subventions affichées' : indicatorLabel()));
  const noMatchedAccount = state.mode === 'communes' && !rows.length && filteredMissingCommunes().length > 0;
  setText(dom.totalAmount, noMatchedAccount ? '–' : formatMetric(state.metric === 'perCapita' ? summary.perCapita : summary.total));
  setText(dom.countLabel, state.mode === 'communes' ? 'Comptes disponibles' : copy.count); setText(dom.projectCount, formatCount(summary.count));
  setText(dom.coverageLabel, copy.coverage); setText(dom.departmentCount, formatCount(summary.coverage));
  const localContext = `OFGL ${state.localYear} · comptes consolidés par collectivité. Rhône : département et Métropole de Lyon réunis sur la carte. Depuis 2021, l’Alsace est affichée sur ses deux contours avec le même montant non réparti. Paris et les collectivités uniques ont des compétences élargies. Avant 2016, les anciennes régions sont regroupées sur les contours actuels sans consolidation entre elles.`;
  setText(dom.statsContext, state.mode === 'communes' && data.communeCoverage ? `OFGL ${state.communeYear} · ${formatCount(filteredMissingCommunes().length)} contours sans compte apparié dans la sélection · ${formatCount(data.communeCoverage.unmatched)} lignes historiques sans contour 2025 et ${formatCount(data.communeCoverage.ambiguousRecords || 0)} lignes à code ambigu exclues. Données manquantes ≠ zéro.` : (state.mode === 'departments' || state.mode === 'regions') && state.indicator === LEGACY_INDICATOR ? localContext : copy.context);
  setText(dom.filterTitle, copy.filter);
}

function selectedContext() {
  if (state.mode === 'gfp' && state.selectedGfp) {
    const row = data.gfpByCode.get(state.selectedGfp);
    if (row) return { title: row.name, kicker: `Intercommunalité · ${row.code}`, name: row.name };
  }
  if (state.selectedCommune) {
    const commune = data.communeByCode.get(state.selectedCommune) || data.communeMetadata.get(state.selectedCommune);
    const feature = data.communeFeatureByCode.get(state.selectedCommune);
    if (commune || feature) {
      const name = commune?.name || feature?.properties?.nom || state.selectedCommune;
      return { title: name, kicker: `Commune · ${state.selectedCommune}`, name };
    }
  }
  if (state.selectedDepartment) {
    const code = normalizeDepartment(state.selectedDepartment);
    if (state.mode === 'departments' && ['67', '68'].includes(code) && data.departments.some(row => row.code === '67A')) return { title: 'Alsace', kicker: 'Collectivité · 67 / 68', name: 'Alsace' };
    const department = data.deptByCode.get(code); const feature = data.featureByCode.get(code);
    return { title: department?.name || feature?.properties?.nom || code, kicker: `Département · ${code}`, name: department?.name || feature?.properties?.nom || code };
  }
  if (state.region) return { title: state.region, kicker: 'Région sélectionnée', name: state.region };
  return { title: 'France entière', kicker: 'Vue nationale', name: 'France entière' };
}

function renderInspectorStats(summary, rows) {
  clearChildren(dom.inspectorStats);
  const noMatchedAccount = state.mode === 'communes' && !rows.length && filteredMissingCommunes().length > 0;
  const cards = [
    [state.metric === 'perCapita' ? 'Par habitant' : state.metric === 'share' ? 'Part nationale' : state.mode === 'projects' ? 'Subventions' : 'Montant', noMatchedAccount ? '–' : formatMetric(state.metric === 'perCapita' ? summary.perCapita : summary.total)],
    [modeCopy().count, formatCount(summary.count)],
    [state.mode === 'projects' ? 'Territoires' : 'Population', state.mode === 'projects' ? formatCount(summary.coverage) : (summary.population ? `${formatCount(summary.population)} hab.` : '–')]
  ];
  cards.forEach(([label, value]) => {
    const card = document.createElement('div'); card.className = 'inspector-stat';
    const labelNode = document.createElement('span'); labelNode.textContent = label;
    const valueNode = document.createElement('strong'); valueNode.textContent = value; valueNode.title = value;
    card.append(labelNode, valueNode); dom.inspectorStats.appendChild(card);
  });
}

function listItem(onSelect, title, meta, amount) {
  const item = document.createElement('article'); item.className = 'project-item clickable'; item.tabIndex = 0; item.setAttribute('role', 'button');
  item.addEventListener('click', onSelect);
  item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } });
  const copy = document.createElement('div');
  const name = document.createElement('p'); name.className = 'project-name'; name.textContent = title;
  const metaNode = document.createElement('p'); metaNode.className = 'project-meta'; metaNode.textContent = meta;
  copy.append(name, metaNode);
  const amountNode = document.createElement('div'); amountNode.className = 'project-amount'; amountNode.textContent = amount;
  item.append(copy, amountNode);
  return item;
}

function projectItem(row) {
  return listItem(() => row.commune && (data.communeFeatureByCode.has(row.commune) || data.communeByCode.has(row.commune)) ? selectCommune(row.commune) : selectDepartment(row.department),
    row.title || row.beneficiary || 'Projet sans intitulé',
    [row.communeData?.name, row.departmentName, row.scheme].filter(Boolean).join(' · '),
    formatMetric(projectMetric(row)));
}

function budgetItem(row, level) {
  if (level === 'gfp') return listItem(() => selectGfp(row.code), row.name, `${formatCount(row.communes.length)} communes · ${row.population ? formatCount(row.population) + ' hab.' : ''}`, formatMetric(valueForBudget(row)));
  const detail = level === 'commune' ? `${row.departmentName || row.department} · ${row.population ? formatCount(row.population) + ' hab.' : 'population non renseignée'}` : level === 'department' ? `${row.code} · ${row.regionName}` : `${row.code} · comptes consolidés`;
  const amount = row.missing ? (row.ambiguous ? 'Code ambigu' : 'Non apparié') : formatMetric(valueForBudget(row));
  return listItem(() => level === 'commune' ? selectCommune(row.code) : level === 'department' ? selectDepartment(row.code) : selectRegion(row.name), row.name, detail, amount);
}

function renderInspector(rows, summary) {
  const context = selectedContext();
  setText(dom.inspectorKicker, context.kicker); setText(dom.inspectorTitle, context.title);
  dom.clearSelection.hidden = !(state.selectedDepartment || state.selectedCommune || state.region || state.selectedGfp);
  const metricText = state.metric === 'perCapita' ? 'par habitant' : state.metric === 'share' ? 'en part du total national' : 'au total';
  const scopeText = state.mode === 'gfp' && state.selectedGfp ? `Comptes consolidés de ${context.name}.` : state.selectedCommune ? `Budget et données disponibles pour ${context.name}.` : state.selectedDepartment ? `${formatCount(summary.count)} lignes rattachées au département ${context.name}.` : state.region ? `${formatCount(summary.count)} lignes dans la région ${context.name}.` : `${formatCount(summary.count)} lignes dans la vue actuelle.`;
  const missing = state.mode === 'communes' ? filteredMissingCommunes() : [];
  setText(dom.inspectorSummary, missing.length && state.selectedCommune ? (missing[0].ambiguous ? `Plusieurs comptes partagent ce code en ${state.communeYear} : ils sont exclus pour éviter un double compte.` : `Aucun compte correspondant pour ${context.name} en ${state.communeYear}. Une absence ne signifie pas zéro.`) : `${scopeText} Lecture ${metricText}.`);
  renderInspectorStats(summary, rows);
  let items = []; let heading = 'À la une'; let countLabel = '';
  if (state.mode === 'projects') { items = [...projectRowsForScope(rows)].sort((a, b) => projectMetric(b) - projectMetric(a)); heading = state.selectedCommune ? 'Projets de la commune' : 'Projets les plus financés'; countLabel = `${formatCount(rows.length)} projets`; }
  else if (state.mode === 'communes') { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); if (state.search || state.selectedCommune) items.push(...missing); heading = state.selectedCommune ? 'Commune sélectionnée' : state.selectedDepartment ? 'Communes du département' : 'Communes les plus dépensières'; countLabel = `${formatCount(rows.length)} comptes${missing.length ? ` · ${formatCount(missing.length)} non apparié${missing.length > 1 ? 's' : ''}` : ''}`; }
  else if (state.mode === 'departments') { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); heading = 'Départements'; countLabel = `${formatCount(rows.length)} départements`; }
  else if (state.mode === 'gfp') { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); heading = 'Intercommunalités'; countLabel = `${formatCount(rows.length)} intercommunalités`; }
  else { items = [...rows].sort((a, b) => valueForBudget(b) - valueForBudget(a)); heading = 'Régions'; countLabel = `${formatCount(rows.length)} régions`; }
  setText(dom.listHeading, heading); setText(dom.listCount, countLabel); clearChildren(dom.projectList);
  const fragment = document.createDocumentFragment();
  items.slice(0, state.limit).forEach(row => fragment.appendChild(state.mode === 'projects' ? projectItem(row) : budgetItem(row, state.mode === 'communes' ? 'commune' : state.mode === 'departments' ? 'department' : state.mode === 'gfp' ? 'gfp' : 'region')));
  dom.projectList.appendChild(fragment);
  dom.more.hidden = items.length <= state.limit;
  dom.more.textContent = `Afficher davantage (${formatCount(items.length - state.limit)} restant${items.length - state.limit > 1 ? 's' : ''})`;
}

function renderTabs() {
  dom.modeTabs.forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  dom.metricButtons.forEach(button => button.classList.toggle('active', button.dataset.metric === state.metric));
  dom.yearWrap.hidden = state.mode === 'projects';
  dom.indicatorWrap.hidden = state.mode === 'projects' || !data.localIndex;
  if (!dom.indicatorWrap.hidden) {
    dom.indicator.querySelectorAll('option').forEach(option => { option.disabled = option.value !== LEGACY_INDICATOR && !data.localIndex.aggregates[option.value]?.levels.includes(levelOf(state.mode)); });
    dom.indicator.value = state.indicator;
  }
  if (state.mode !== 'projects') syncYearControl();
  dom.missingLegend.hidden = state.mode !== 'communes';
  dom.schemeFilter.hidden = state.mode !== 'projects';
  dom.scheme.disabled = state.mode !== 'projects';
  dom.search.placeholder = state.mode === 'projects' ? 'Projet, bénéficiaire, commune…' : state.mode === 'communes' ? 'Commune, code INSEE, département…' : 'Territoire, code…';
}

function render() {
  state.shareBase = shareBaseForMode();
  renderTabs();
  const rows = currentRows();
  const summary = scopeSummary(rows);
  renderStats(rows, summary);
  renderMap();
  renderInspector(rows, summary);
}

/* ---------- Interaction ---------- */

function selectGfp(code) {
  if (!code) return;
  state.search = ''; dom.search.value = '';
  state.selectedGfp = state.selectedGfp === code ? '' : code;
  state.selectedCommune = ''; state.selectedDepartment = ''; state.limit = 8;
  render();
}

function clearSelection() {
  state.selectedDepartment = ''; state.selectedCommune = ''; state.region = ''; state.selectedGfp = ''; dom.region.value = '';
  render();
}

function resetAll() {
  state.region = ''; state.scheme = ''; state.search = ''; state.selectedDepartment = ''; state.selectedCommune = ''; state.selectedGfp = ''; state.limit = 8;
  dom.search.value = ''; dom.region.value = ''; dom.scheme.value = '';
  render();
  if (mapState.ready) updateCamera(true);
}

function selectRegion(name) {
  if (!name) return;
  state.region = name; state.search = ''; dom.search.value = ''; dom.region.value = name;
  state.selectedDepartment = ''; state.selectedCommune = ''; state.limit = 8;
  render();
}

function selectDepartment(code) {
  state.search = ''; dom.search.value = '';
  state.selectedDepartment = normalizeDepartment(code);
  state.selectedCommune = ''; state.limit = 8;
  render();
}

function selectCommune(code) {
  const commune = data.communeByCode.get(code) || data.communeMetadata.get(code);
  const feature = data.communeFeatureByCode.get(code);
  if (!commune && !feature) return;
  if (state.selectedCommune === code) { state.selectedCommune = ''; state.selectedDepartment = ''; render(); return; }
  state.search = ''; dom.search.value = '';
  state.selectedCommune = code;
  state.selectedDepartment = normalizeDepartment(commune?.department || feature?.properties?.departement || '');
  state.limit = 8;
  render();
}

function setupListeners() {
  dom.modeTabs.forEach(button => button.addEventListener('click', () => {
    if (state.mode === button.dataset.mode) return;
    changeView(() => { state.mode = button.dataset.mode; state.selectedCommune = ''; state.selectedDepartment = ''; state.selectedGfp = ''; state.limit = 8; });
  }));
  dom.indicator.addEventListener('change', () => changeView(() => { state.indicator = dom.indicator.value; state.limit = 8; }));
  dom.mapYear.addEventListener('change', () => changeView(() => { state.year = Number(dom.mapYear.value); }));
  dom.yearPlay.addEventListener('click', toggleYearPlay);
  dom.metricButtons.forEach(button => button.addEventListener('click', () => { state.metric = button.dataset.metric; render(); }));
  let searchTimer = 0;
  dom.search.addEventListener('input', event => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = event.target.value.trim();
      state.limit = 8;
      const inferredMode = inferSearchMode(state.search);
      if (inferredMode && inferredMode !== state.mode && state.mode !== 'gfp') { changeView(() => { state.mode = inferredMode; state.selectedDepartment = ''; state.selectedCommune = ''; }); return; }
      render();
    }, 180);
  });
  dom.region.addEventListener('change', event => { state.region = event.target.value; state.selectedDepartment = ''; state.selectedCommune = ''; state.limit = 8; render(); });
  dom.scheme.addEventListener('change', event => { state.scheme = event.target.value; state.limit = 8; render(); });
  dom.reset.addEventListener('click', resetAll);
  dom.clearSelection.addEventListener('click', clearSelection);
  dom.resetView.addEventListener('click', () => { state.selectedDepartment = ''; state.selectedCommune = ''; state.selectedGfp = ''; state.region = ''; dom.region.value = ''; render(); if (mapState.ready) updateCamera(true); });
  dom.zoomIn.addEventListener('click', () => mapState.map?.zoomIn({ duration: 300 }));
  dom.zoomOut.addEventListener('click', () => mapState.map?.zoomOut({ duration: 300 }));
  dom.more.addEventListener('click', () => { state.limit += 8; render(); });
  window.addEventListener('frl-theme', applyMapTheme);
}

/* ---------- Theme & header ---------- */

class ThemeManager {
  constructor() {
    this.toggleBtn = dom.theme;
    this.timer = 0;
    this.toggleBtn?.addEventListener('click', () => this.apply(currentTheme() === 'dark' ? 'light' : 'dark'));
  }
  apply(theme) {
    const root = document.documentElement;
    root.classList.add('theme-transitioning');
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('frl-theme', theme); } catch (error) { /* storage may be unavailable */ }
    window.dispatchEvent(new Event('frl-theme'));
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => root.classList.remove('theme-transitioning'), themeDuration() + 50);
  }
}

function setupHeader() {
  const update = () => dom.header?.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', update, { passive: true });
  update();
  // The map fills the viewport below the sticky toolbar, whatever its wrapped height.
  const bar = document.querySelector('.explorer__bar');
  if (bar && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`)).observe(bar);
  }
}

/* ---------- Data loading ---------- */

async function setCommuneYear(year) {
  if (!data.communeHistory.has(year)) {
    const payload = await fetchJson(`./data/commune-spending-${year}.json`);
    if (payload.year !== year || !Array.isArray(payload.rows)) throw new Error('Exercice communal invalide');
    data.communeHistory.set(year, payload);
  }
  const payload = data.communeHistory.get(year);
  data.communes = payload.rows.filter(row => data.communeMetadata.has(row[0])).map(([code, total, population, perCapita]) => ({
    ...data.communeMetadata.get(code), total, population, perCapita
  }));
  const present = new Set(payload.rows.map(row => row[0]));
  const ambiguous = new Set(payload.ambiguousCodes || []);
  data.missingCommunes = [...data.communeMetadata.values()].filter(row => !present.has(row.code)).map(row => ({ ...row, total: null, perCapita: null, population: null, missing: true, ambiguous: ambiguous.has(row.code) }));
  data.communeCoverage = payload;
  state.communeYear = year;
}

async function setLocalYear(year) {
  if (!data.localHistory.has(year)) {
    const payload = await fetchJson(`./data/local-spending-${year}.json`);
    if (payload.year !== year || !Array.isArray(payload.departments) || !Array.isArray(payload.regions)) throw new Error('Exercice local invalide');
    data.localHistory.set(year, payload);
  }
  const payload = data.localHistory.get(year);
  data.departments = payload.departments;
  data.regions = payload.regions;
  state.localYear = year;
}

async function init() {
  new ThemeManager();
  setupHeader();
  try {
    const [meta, projects, boundaries, communeGeometry, localIndex] = await Promise.all([
      fetchJson('./data/web/communes-meta.json'),
      fetchJson('./data/web/projects-2025.json'),
      fetchJson('./data/departments.geojson'),
      fetchJson('./data/web/communes.json'),
      fetchJson('./data/local/index.json').catch(() => null)
    ]);
    data.localIndex = localIndex;
    meta.rows.forEach(([code, name, department, lon, lat]) => {
      const [departmentName, regionName] = meta.departments[department] || ['', ''];
      data.communeMetadata.set(code, { code, name, department, departmentName, regionName, lon, lat });
    });
    data.projects = projects.rows.map(([scheme, department, beneficiary, commune, title, amount]) => ({ scheme: projects.schemes[scheme], department, beneficiary, commune, title, amount }));
    data.boundaries = boundaries;
    data.communeFeatures = decodeFeatures(communeGeometry, ['code', 'nom', 'departement'], data.communeBBox);
    data.communeFeatures.features.forEach(feature => data.communeFeatureByCode.set(feature.properties.code, feature));
    await Promise.all([setCommuneYear(2025), setLocalYear(2025)]);
    setupDerivedData();
    setupFilters();
    setupIndicators();
    setupListeners();
    setText(dom.dataStatus, `${formatCount(data.projects.length)} projets · ${formatCount(data.communes.length)} communes`);
    setText(dom.scopeText, 'DGCL · OFGL · contours Etalab · 2012–2025');
    render();
    await initMap();
    render();
    dom.mapLoading.classList.add('is-done');
  } catch (error) {
    console.error(error);
    setText(dom.dataStatus, 'Données indisponibles');
    setText(dom.scopeText, 'Rechargez la page pour réessayer.');
    setText(dom.inspectorSummary, 'Impossible de charger les données locales.');
    dom.mapLoading.textContent = 'Impossible de charger la carte.';
  }
}

init();
