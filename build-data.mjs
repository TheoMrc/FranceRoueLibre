import fs from 'node:fs';

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

const dgclRows = readCsvObjects('sources/dgcl-2025.csv');
const records = dgclRows.map((source, index) => ({
  id: index + 1,
  year: Number(source.exercice),
  scheme: source.dispositif,
  programme: source.programme,
  beneficiaryType: source.beneficiaire_type,
  siren: source.beneficiaire_siren,
  department: source.beneficiaire_dep === '67A' && /^6[78]\d{3}$/.test(source.beneficiaire_code_insee)
    ? source.beneficiaire_code_insee.slice(0, 2)
    : source.beneficiaire_dep.replace(/^0(?=\d\d$)/, '').replace(/^20(?=[AB]$)/, '2'),
  beneficiary: source.beneficiaire_nom,
  commune: source.beneficiaire_code_insee,
  title: source.intitule.trim().replace(/\s+/g, ' '),
  cost: amount(source.cout_ht),
  amount: amount(source.subvention)
})).filter(record => record.amount > 0);

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

for (const record of records) {
  if (!deptMeta[record.department] && !deptMeta[normalizeDepartment(record.department)]) {
    throw new Error(`Unknown department: ${record.department}`);
  }
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
fs.writeFileSync('dist/data/projects-2025.json', JSON.stringify(records));
fs.writeFileSync('dist/data/departments.geojson', JSON.stringify(boundaries));
fs.writeFileSync('dist/data/communes.geojson', JSON.stringify(communeBoundaries));
fs.writeFileSync('dist/data/budgets-2025.json', JSON.stringify({ communes, departments, regions }));
console.log(`${records.length} DGCL projects, ${boundaries.features.length} departmental contours, ${communes.length} commune budgets, ${departments.length} department budgets, ${regions.length} region budgets`);
