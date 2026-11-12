"""Paramètres de l'horloge de la dette publique (horloge-de-la-dette-publique.com), pour le chiffre en direct que la
Loupe cite dans son mot sur les dons (dist/assistant.js, donNote).

Ce site n'affiche pas une mesure : son compteur va en ligne droite d'une valeur de début d'année à une valeur
projetée pour la fin d'année (ses « projections dynamiques », recalées sur l'Insee à chaque publication trimestrielle).
On télécharge sa page d'accueil, on y lit ces quatre paramètres dans le script du compteur de la dette, et la page
de la Loupe refait le même calcul à l'instant de l'affichage. C'est donc une estimation de ce site tiers, citée
comme telle, jamais un chiffre officiel : la dette mesurée par l'Insee est dans les données du site (indicateur dette).

    C:\\Python\\Python310\\python.exe scripts\\dette-horloge.py     -> dist/data/horloge-dette.json

Rien n'est écrit si la page a changé de forme ou si les valeurs sortent des bornes plausibles.
"""
import datetime as dt
import json
import re
import sys
import urllib.request
from pathlib import Path

URL = 'https://horloge-de-la-dette-publique.com/'
OUT = Path(__file__).resolve().parents[1] / 'dist' / 'data' / 'horloge-dette.json'


def main():
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 (FranceRoueLibre ; scripts/dette-horloge.py)'})
    with urllib.request.urlopen(req, timeout=40) as r:
        html = r.read().decode('utf-8', 'replace')
    # the counter of the debt itself: updateCounter_dette_<year>_<id>, not the interest (chargedette) nor the ratio (dette_pub_pib)
    m = re.search(r'function updateCounter_dette_(\d{4})_\w+\(\)\s*\{(.*?)\}\s*updateCounter_dette_\d{4}_', html, re.S)
    if not m:
        sys.exit('Compteur de la dette introuvable : la page a changé de forme, rien n’est écrit.')
    body = m.group(2)

    def var(name, pattern):
        v = re.search(rf'var {name}\s*=\s*{pattern}', body)
        if not v:
            sys.exit(f'Paramètre {name} introuvable : rien n’est écrit.')
        return v.group(1)
    start, end = var('startDate', r'new Date\("([\d-]+)"\)'), var('endDate', r'new Date\("([\d-]+)"\)')
    v0, v1 = float(var('startValue', r'([\d.]+)')), float(var('endValue', r'([\d.]+)'))
    d0, d1 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if not (2.5e12 < v0 < v1 < 6e12 and d0 < d1 and (d1 - d0).days <= 800 and (v1 - v0) / v0 < .2):
        sys.exit(f'Valeurs hors bornes ({start} {v0:.0f} → {end} {v1:.0f}) : rien n’est écrit.')
    data = {'source': 'Horloge de la dette publique', 'url': URL, 'telecharge': dt.date.today().isoformat(),
            'debut': start, 'fin': end, 'valeur_debut_eur': v0, 'valeur_fin_eur': v1,
            'note': 'Estimation de ce site : droite entre la dette au début de la période et sa projection pour la fin, '
                    'recalée sur l’Insee à chaque publication. Pas un chiffre officiel.'}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    per_s = (v1 - v0) / ((d1 - d0).total_seconds())
    print(f'{OUT.name} : {v0 / 1e9:,.1f} Md€ le {start} → {v1 / 1e9:,.1f} Md€ le {end}, soit {per_s:,.0f} € par seconde'.replace(',', ' '))


if __name__ == '__main__':
    main()
