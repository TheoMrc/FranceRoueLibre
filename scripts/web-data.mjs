// Compact, browser-ready data files written next to the regular build outputs.
// Geometry is stored as integer deltas (lossless at the source precision), which
// is roughly three times smaller than GeoJSON and trivial to decode in the page.
import fs from 'node:fs';

function encodeRing(ring, scale) {
  const out = [];
  let px = 0, py = 0;
  for (const [lon, lat] of ring) {
    const x = Math.round(lon * scale), y = Math.round(lat * scale);
    out.push(x - px, y - py);
    px = x; py = y;
  }
  return out;
}

function encodeGeometry(geometry, scale) {
  if (!geometry) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map(polygon => polygon.map(ring => encodeRing(ring, scale)));
}

export function encodeFeatures(features, scale, describe) {
  return { scale, features: features.map(feature => [...describe(feature.properties || {}), encodeGeometry(feature.geometry, scale)]) };
}

export function writeWebData({ projects, communes, communeBoundaries, detailGroups, departmentDetail, regionDetail, outDir = 'dist/data/web' }) {
  fs.mkdirSync(`${outDir}/communes-detail`, { recursive: true });
  const write = (name, value) => fs.writeFileSync(`${outDir}/${name}`, JSON.stringify(value));

  const schemes = [...new Set(projects.map(row => row.scheme))].sort();
  write('projects-2025.json', {
    schemes,
    rows: projects.map(row => [schemes.indexOf(row.scheme), row.department, row.beneficiary, row.commune, row.title, row.amount])
  });

  const departments = {};
  for (const row of communes) if (!departments[row.department]) departments[row.department] = [row.departmentName, row.regionName];
  write('communes-meta.json', { departments, rows: communes.map(row => [row.code, row.name, row.department, row.lon, row.lat]) });

  const communeProps = props => [String(props.code), props.nom || '', String(props.departement || '')];
  write('communes.json', encodeFeatures(communeBoundaries.features, 1e3, communeProps));
  for (const [code, features] of detailGroups) write(`communes-detail/${code}.json`, encodeFeatures(features, 1e5, communeProps));
  write('departements-detail.json', encodeFeatures(departmentDetail.features, 1e4, props => [String(props.code), props.nom || '', String(props.region || '')]));
  write('regions-detail.json', encodeFeatures(regionDetail.features, 1e4, props => [String(props.code), props.nom || '', '']));
}
