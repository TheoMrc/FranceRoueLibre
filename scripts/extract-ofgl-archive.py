"""Filter a historical OFGL consolidated commune archive without expanding it on disk."""
import csv, hashlib, io, json, sys, zipfile
from pathlib import Path

archive = Path(sys.argv[1]); year = int(sys.argv[2]); out = Path(sys.argv[3])
sha = hashlib.sha256()
with archive.open('rb') as raw:
    for chunk in iter(lambda: raw.read(1024 * 1024), b''): sha.update(chunk)
fields = ['exer', 'insee', 'com_code', 'montant', 'ptot', 'euros_par_habitant', 'presence_budget']
count = 0
with zipfile.ZipFile(archive) as z:
    files = [item for item in z.infolist() if item.filename.lower().endswith('.csv')]
    if len(files) != 1: raise ValueError('Expected exactly one CSV in the archive')
    with z.open(files[0]) as stream, out.open('w', encoding='utf-8', newline='') as target:
        reader = csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig', newline=''), delimiter=';')
        writer = csv.DictWriter(target, fieldnames=fields, delimiter=';', lineterminator='\n'); writer.writeheader()
        for row in reader:
            if row['Agrégat'] != 'Dépenses totales': continue
            if int(row['Exercice']) != year: raise ValueError('Unexpected year')
            writer.writerow({'exer': year, 'insee': row['Code Insee Collectivité'], 'com_code': row['Code Insee 2025 Commune'], 'montant': row['Montant'].replace(',', '.'), 'ptot': row['Population totale'], 'euros_par_habitant': row['Montant en € par habitant'].replace(',', '.'), 'presence_budget': row['Compte 2025 Disponible']})
            count += 1
manifest = {'year': year, 'url': f'https://data.ofgl.fr/api/v2/catalog/datasets/ofgl-base-communes-consolidee/attachments/ofgl_base_communes_{year}_consolidee_pj_zip', 'archive_sha256': sha.hexdigest(), 'archive_bytes': archive.stat().st_size, 'archive_member': files[0].filename, 'selected_records': count, 'filter': 'Agrégat = Dépenses totales', 'retrieved': '2026-10-27'}
out.with_suffix('.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(year, count, sha.hexdigest())
