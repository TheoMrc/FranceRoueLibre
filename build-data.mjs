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

const csv = fs.readFileSync('sources/dgcl-2025.csv', 'utf8').replace(/^\uFEFF/, '');
const [header, ...rows] = parseCsv(csv);
const records = rows.map((row, index) => {
  const source = Object.fromEntries(header.map((name, i) => [name, row[i] ?? '']));
  return {
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
    cost: Number(source.cout_ht.replace(',', '.')) || 0,
    amount: Number(source.subvention.replace(',', '.')) || 0
  };
}).filter(record => record.amount > 0);

const boundaries = JSON.parse(fs.readFileSync('sources/departements-1000m.geojson', 'utf8'));
const deptMeta = Object.fromEntries(boundaries.features.map(feature => [feature.properties.code, { name: feature.properties.nom, region: feature.properties.region }]));
deptMeta['67A'] = { name: 'Alsace (non réparti)', region: '44' };
deptMeta['691'] = { name: 'Métropole de Lyon', region: '84' };
for (const record of records) {
  if (!deptMeta[record.department]) throw new Error(`Unknown department: ${record.department}`);
}
fs.mkdirSync('dist/data', { recursive: true });
fs.writeFileSync('dist/data/projects-2025.json', JSON.stringify(records));
fs.writeFileSync('dist/data/departments.geojson', JSON.stringify(boundaries));
console.log(`${records.length} DGCL projects, ${boundaries.features.length} departmental contours`);
