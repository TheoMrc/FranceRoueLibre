import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { writeWebData } from './scripts/web-data.mjs';
import { writeTaxesData } from './scripts/taxes-data.mjs';

function parseCsv(source) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function readCsvObjects(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const [fields, ...lines] = parseCsv(source);
  return lines.map(line => Object.fromEntries(fields.map((name, index) => [name, line[index] ?? ''])));
}

function amount(value) {
  return Number(String(value ?? '').replace(',', '.')) || 0;
}

// DGCL investment grants, one file per year (sources/dgcl-YYYY.csv, 2018 onwards; same columns every year).
// Old commune codes (merged communes) are moved to the 2025 commune that succeeds them, so the map can place them;
// a commune named only by its SIREN (21 + INSEE code + key) gets its INSEE code back from it.
const successors = JSON.parse(fs.readFileSync('sources/communes-successeurs-2025.json', 'utf8')).map;
const dgclYears = fs.readdirSync('sources').map(name => /^dgcl-(\d{4})\.csv$/.exec(name)?.[1]).filter(Boolean).map(Number).sort();
function dgclDepartment(source, commune) {
  const raw = source.beneficiaire_dep.trim().replace(/-$/, '');   // 2020 has a few « 41- »
  if (raw === '67A' && /^6[78]\d{3}$/.test(commune)) return commune.slice(0, 2);
  if (raw === '67A') return raw;
  if (/^0?2?0?[AB]$/.test(raw) && /[AB]$/.test(raw)) return `2${raw.slice(-1)}`;   // 20A, 02A, 2A
  if (/^\d{2,3}$/.test(raw)) return raw.replace(/^0(?=\d\d$)/, '');
  if (/^\d{5}$|^2[AB]\d{3}$/.test(commune)) return /^97/.test(commune) ? commune.slice(0, 3) : commune.slice(0, 2);
  return '';
}
const projectsByYear = new Map(dgclYears.map(year => {
  const rows = readCsvObjects(`sources/dgcl-${year}.csv`).map(source => {
    let commune = source.beneficiaire_code_insee.trim();
    const siren = source.beneficiaire_siren.trim();
    if (!commune && /^21(\d{5}|2[AB]\d{3})\d$/.test(siren)) commune = siren.slice(2, 7);
    commune = successors[commune] || commune;
    return {
      year,
      scheme: source.dispositif.trim(),
      programme: source.programme,
      beneficiaryType: source.beneficiaire_type,
      siren,
      department: dgclDepartment(source, commune),
      beneficiary: source.beneficiaire_nom.trim(),
      commune,
      title: /^0?$/.test(source.intitule.trim()) ? 'Intitulé non publié' : source.intitule.trim().replace(/\s+/g, ' '),   // 2021: « 0 » on ~580 lines
      cost: amount(source.cout_ht),
      amount: amount(source.subvention)
    };
  }).filter(record => record.amount > 0);
  return [year, rows];
}));

const boundaries = JSON.parse(fs.readFileSync('sources/departements-1000m.geojson', 'utf8'));
const communeBoundaries = JSON.parse(fs.readFileSync('sources/communes-1000m.geojson', 'utf8'));
const deptMeta = Object.fromEntries(boundaries.features.map(feature => [feature.properties.code, { name: feature.properties.nom, region: feature.properties.region }]));
deptMeta['67A'] = { name: 'Alsace (non réparti)', region: '44' };
deptMeta['691'] = { name: 'Métropole de Lyon', region: '84' };

function normalizeDepartment(code) {
  if (code === '67A') return '67';
  if (code === '691') return '69';
  return code;
}

for (const [year, rows] of projectsByYear) {
  const unknown = rows.filter(record => !deptMeta[record.department] && !deptMeta[normalizeDepartment(record.department)]);
  // a few lines name no department at all (« nan ») or a collectivity without a contour: kept out of the map, reported
  if (unknown.length > rows.length * 0.01) throw new Error(`DGCL ${year}: ${unknown.length} lines with an unknown department (${[...new Set(unknown.map(r => r.department))].join(', ')})`);
  if (unknown.length) console.warn(`DGCL ${year}: ${unknown.length} lines left out, unknown department ${[...new Set(unknown.map(r => r.department || '?'))].join(', ')}`);
  projectsByYear.set(year, rows.filter(record => !unknown.includes(record)));
}

const centers = new Map(JSON.parse(fs.readFileSync('sources/communes-centres.json', 'utf8')).map(item => [item.code, item.centre?.coordinates]));
const communeRows = readCsvObjects('sources/ofgl-communes-2025.csv');
const communesByCode = new Map();
for (const source of communeRows) {
  const code = source.insee;
  const coordinates = centers.get(code);
  const perCapita = amount(source.m_hab_2025);
  const total = amount(source.m_2025);
  const department = /^97/.test(code) ? code.slice(0, 3) : code.slice(0, 2);
  if (!coordinates || communesByCode.has(code)) continue;
  communesByCode.set(code, {
    code,
    name: source.nom,
    department,
    departmentName: source.nom_dep,
    regionName: source.nom_reg,
    total,
    perCapita,
    cumulative: amount(source.mc_2025),
    cumulativePerCapita: amount(source.mc_hab_2025),
    population: perCapita ? Math.round(total / perCapita) : 0,
    lon: coordinates[0],
    lat: coordinates[1]
  });
}
const communes = [...communesByCode.values()];

const departments = readCsvObjects('sources/ofgl-departements-2025.csv').map(source => ({
  code: source.insee,
  name: source.nom,
  regionName: source.nom_reg,
  total: amount(source.m_2025),
  perCapita: amount(source.m_hab_2025),
  cumulative: amount(source.mc_2025),
  cumulativePerCapita: amount(source.mc_hab_2025)
}));

const regions = readCsvObjects('sources/ofgl-regions-2025.csv').map(source => ({
  code: source.insee,
  name: source.nom,
  total: amount(source.m_2025),
  perCapita: amount(source.m_hab_2025),
  cumulative: amount(source.mc_2025),
  cumulativePerCapita: amount(source.mc_hab_2025)
}));

fs.mkdirSync('dist/data', { recursive: true });
fs.copyFileSync('sources/national-ratios-insee.json', 'dist/data/national-ratios-insee.json');
fs.copyFileSync('sources/national-taxes-insee.json', 'dist/data/national-taxes-insee.json');
fs.copyFileSync('sources/national-accounts-3201.json', 'dist/data/national-accounts-3201.json');
fs.copyFileSync('sources/national-sectors-3215.json', 'dist/data/national-sectors-3215.json');
fs.copyFileSync('sources/national-debt.json', 'dist/data/national-debt.json');
fs.copyFileSync('sources/insee-population.json', 'dist/data/insee-population.json');
writeTaxesData();
fs.writeFileSync('dist/data/departments.geojson', JSON.stringify(boundaries));
// Higher-resolution geometry is split by department and loaded only on close zoom.
const detailCommunes = JSON.parse(gunzipSync(fs.readFileSync('sources/communes-50m.geojson.gz')));
const detailGroups = new Map();
for (const feature of detailCommunes.features) {
  const code = String(feature.properties?.departement || '');
  if (!/^(?:\d{2}|2[AB]|97\d|98\d)$/.test(code)) continue;
  if (!detailGroups.has(code)) detailGroups.set(code, []);
  detailGroups.get(code).push(feature);
}
const [departmentDetail, regionDetail] = ['departements', 'regions'].map(name => JSON.parse(gunzipSync(fs.readFileSync(`sources/${name}-100m.geojson.gz`))));
fs.writeFileSync('dist/data/budgets-2025.json', JSON.stringify({ communes, departments, regions }));
// The site itself only loads the compact files in dist/data/web/.
writeWebData({ projectsByYear, communes, communeBoundaries, detailGroups, departmentDetail, regionDetail });
// Keep exact historical INSEE codes; never redistribute changed codes to modern communes.
const boundaryCodes = new Set(communeBoundaries.features.map(feature => String(feature.properties.code)));
const history = new Map();
const historicalSources = Array.from({ length: 6 }, (_, i) => `sources/ofgl-communes-depenses-${2012 + i}.csv`);
const historyRows = [...historicalSources.flatMap(readCsvObjects), ...readCsvObjects('sources/ofgl-communes-depenses-2018-2025.csv')];
const codeCounts = new Map();
for (const row of historyRows) { const key = `${row.exer}|${row.insee}`; codeCounts.set(key, (codeCounts.get(key) || 0) + 1); }
for (const source of historyRows) {
  const year = Number(source.exer), code = source.insee;
  if (!Number.isInteger(year) || year < 2012 || year > 2025) throw new Error('Invalid OFGL exercise');
  if (!history.has(year)) history.set(year, { rows: [], sourceRecords: 0, unmatched: 0, missingValues: 0, ambiguousRecords: 0, ambiguousCodes: new Set(), seen: new Set() });
  const group = history.get(year); group.sourceRecords++;
  if (!communesByCode.has(code) || !boundaryCodes.has(code)) { group.unmatched++; continue; }
  if (codeCounts.get(`${year}|${code}`) > 1) { group.ambiguousRecords++; group.ambiguousCodes.add(code); continue; }
  if (source.montant === '' || !Number.isFinite(Number(source.montant))) { group.missingValues++; continue; }
  if (group.seen.has(code)) throw new Error(`Duplicate OFGL historical code: ${year} / ${code}`);
  group.seen.add(code);
  group.rows.push([code, Number(source.montant), source.ptot === '' ? null : Number(source.ptot), source.euros_par_habitant === '' ? null : Number(source.euros_par_habitant)]);
}
for (const [year, group] of history) {
  group.rows.sort((a, b) => a[0].localeCompare(b[0]));
  fs.writeFileSync(`dist/data/commune-spending-${year}.json`, JSON.stringify({ year, sourceRecords: group.sourceRecords, unmatched: group.unmatched, missingValues: group.missingValues, ambiguousRecords: group.ambiguousRecords, ambiguousCodes: [...group.ambiguousCodes].sort(), rows: group.rows }));
}
if (history.size !== 14) throw new Error('Expected all OFGL years from 2012 through 2025');


// Annual consolidated accounts retain distinct institutions and their current territorial codes.
const localRows = { departments: readCsvObjects('sources/ofgl-departements-depenses-2012-2025.csv'), regions: readCsvObjects('sources/ofgl-regions-depenses-2012-2025.csv') };
for (let year = 2012; year <= 2025; year++) {
  const normalize = (source, kind) => {
    let code = kind === 'departments' ? source.dep_code : source.reg_code;
    // OFGL associates pre-merger Bas-Rhin/Haut-Rhin with the present-day Alsace code.
    if (kind === 'departments' && year < 2021 && code === '67A') {
      code = ({ '226700011': '67', '226800019': '68' })[source.siren];
      if (!code) throw new Error('Unknown historical Alsace institution');
    }
    const total = Number(source.montant), population = Number(source.ptot);
    if (!code || !source.montant || !Number.isFinite(total) || !Number.isFinite(population) || population <= 0) throw new Error(`Invalid ${kind} account in ${year}`);
    return { code, name: kind === 'departments' ? (code === '67' ? 'Bas-Rhin' : code === '68' ? 'Haut-Rhin' : source.dep_name) : source.reg_name, regionName: source.reg_name, category: source.categ, siren: source.siren, total, population, perCapita: total / population };
  };
  const result = Object.fromEntries(Object.entries(localRows).map(([kind, rows]) => [kind, rows.filter(row => Number(row.exer) === year).map(row => normalize(row, kind))]));
  if (year < 2016) {
    const grouped = new Map();
    for (const row of result.regions) {
      const item = grouped.get(row.code) || { ...row, total: 0, population: 0, siren: 'group-' + row.code, institutions: 0 };
      item.total += row.total; item.population += row.population; item.institutions++;
      grouped.set(row.code, item);
    }
    result.regions = [...grouped.values()].map(row => ({ ...row, perCapita: row.total / row.population, category: 'REG_GROUPEE' }));
  }
  for (const [kind, rows] of Object.entries(result)) if (new Set(rows.map(row => row.siren)).size !== rows.length) throw new Error(`Duplicate ${kind} institution in ${year}`);
  fs.writeFileSync(`dist/data/local-spending-${year}.json`, JSON.stringify({ year, ...result }));
}

console.log(`${[...projectsByYear].map(([y, r]) => `${r.length} DGCL projects in ${y}`).join(', ')}, ${boundaries.features.length} departmental contours, ${communes.length} commune budgets, ${departments.length} department budgets, ${regions.length} region budgets`);
