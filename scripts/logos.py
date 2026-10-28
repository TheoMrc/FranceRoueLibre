"""The 10 logo proposals (48×48 SVG) and a preview page dist/logos.html showing each one in the header lockup.
Colours: --logo-ink (text colour), the brand gradient, and red for the downward arrow."""
import json

RED = '#e11d48'
GRAD = '<defs><linearGradient id="g{n}" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#0e7490"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs>'
ARROW = lambda x, y, s=7: f'<path d="M{x - s} {y} H{x} V{y - s}" stroke="{RED}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'

LOGOS = [
    ('Stonks inversé', 'Le graphique qui plonge, sur deux axes.',
     '<path d="M7 7v34h34" stroke="currentColor" stroke-opacity=".35" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
     f'<path d="M11 12l9 8 6-5 14 17" stroke="{RED}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' + ARROW(40, 32)),
    ('Euro en chute', 'Le symbole € qui décroche.',
     '<path d="M21 9.5a9 9 0 1 0 0 15M8 15h11M8 19.5h10" stroke="url(#g{n})" stroke-width="2.8" stroke-linecap="round"/>'
     f'<path d="M24 21l6 6 3-3 8 9" stroke="{RED}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' + ARROW(41, 33)),
    ('Barres en baisse', 'Un histogramme décroissant, la flèche par-dessus.',
     '<rect x="7" y="12" width="7" height="29" rx="2" fill="url(#g{n})" opacity=".95"/><rect x="17" y="19" width="7" height="22" rx="2" fill="url(#g{n})" opacity=".75"/>'
     '<rect x="27" y="26" width="7" height="15" rx="2" fill="url(#g{n})" opacity=".55"/><rect x="37" y="33" width="5" height="8" rx="2" fill="url(#g{n})" opacity=".35"/>'
     f'<path d="M9 7l11 8 6-3 15 13" stroke="{RED}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' + ARROW(41, 25, 6)),
    ('Roue libre', 'La roue du nom, traversée par la courbe qui descend.',
     '<circle cx="24" cy="24" r="16" stroke="url(#g{n})" stroke-width="3"/><circle cx="24" cy="24" r="3" fill="url(#g{n})"/>'
     '<path d="M24 8v13M24 27v13M8 24h13M27 24h13M12.7 12.7l9.2 9.2M26.1 26.1l9.2 9.2M35.3 12.7l-9.2 9.2M21.9 26.1l-9.2 9.2" stroke="url(#g{n})" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>'
     f'<path d="M6 13l13 10 6-4 17 18" stroke="{RED}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' + ARROW(42, 37)),
    ('Pièce qui tombe', 'Une pièce en chute libre, traits de vitesse.',
     '<path d="M14 6v8M20 4v6M26 6v8" stroke="currentColor" stroke-opacity=".35" stroke-width="2.4" stroke-linecap="round"/>'
     '<circle cx="20" cy="27" r="12" fill="url(#g{n})"/><path d="M24 22.2a5.5 5.5 0 1 0 0 9.6M14.5 25.5h7M14.5 28.5h6.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>'
     f'<path d="M38 18v20" stroke="{RED}" stroke-width="3.4" stroke-linecap="round"/><path d="M32 32l6 6 6-6" stroke="{RED}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    ('Badge', 'Un pavé dégradé, flèche blanche en zigzag : lisible même tout petit.',
     '<rect x="3" y="3" width="42" height="42" rx="12" fill="url(#g{n})"/>'
     '<path d="M11 14l9 8 6-5 12 14" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 31h8v-8" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'),
    ('Hexagone', 'L’Hexagone, avec la courbe qui plonge à l’intérieur.',
     '<path d="M24 4l17 10v20L24 44 7 34V14z" stroke="url(#g{n})" stroke-width="3" stroke-linejoin="round"/>'
     f'<path d="M14 17l7 7 5-4 9 11" stroke="{RED}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' + ARROW(35, 31, 6)),
    ('Escalier', 'Des marches qui descendent, comme un budget qui fond.',
     '<path d="M6 10h9v8h9v8h9v8h9" stroke="url(#g{n})" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'
     f'<path d="M10 16l26 22" stroke="{RED}" stroke-width="3.4" stroke-linecap="round"/>' + ARROW(37, 39, 7)),
    ('Loupe', 'L’audit : une loupe posée sur la courbe qui chute.',
     '<circle cx="20" cy="20" r="13" stroke="url(#g{n})" stroke-width="3.2"/><path d="M30 30l11 11" stroke="url(#g{n})" stroke-width="4.4" stroke-linecap="round"/>'
     f'<path d="M12 15l5 5 4-3 6 8" stroke="{RED}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 25h5v-5" stroke="{RED}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
    ('Pignon', 'Le pignon de roue libre, flèche rouge au centre.',
     '<path d="M24 5l3.2 4.6 5.4-1.6.6 5.6 5.2 2.2-2.6 5 3.4 4.4-4.8 3 .6 5.6-5.6.4-2 5.2-5-2.6L19 43l-2.4-5.1-5.6-.2.4-5.6-4.8-3 3.2-4.6L7 19.7l5.2-2.4.4-5.6 5.4 1.4z" stroke="url(#g{n})" stroke-width="2.6" stroke-linejoin="round"/>'
     f'<path d="M24 15v17" stroke="{RED}" stroke-width="3.6" stroke-linecap="round"/><path d="M18 26l6 6 6-6" stroke="{RED}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'),
]


def svg(index, size=44, cls='brand__mark'):
    name, _, body = LOGOS[index]
    n = index + 1
    return (f'<svg class="{cls}" width="{size}" height="{size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">'
            + GRAD.format(n=n) + body.replace('{n}', str(n)) + '</svg>')


def lockup(index, size=44):
    return (f'<span class="brand brand--lockup">{svg(index, size)}<span class="brand__sep" aria-hidden="true"></span>'
            '<span class="brand__name"><span>France</span><span class="gradient-text">RoueLibre</span></span></span>')


if __name__ == '__main__':
    cards = ''.join(f'''<figure class="logo-card"><div class="logo-num">{i + 1}</div><div class="logo-rows">
      <div class="logo-row" data-theme="light">{lockup(i)}</div><div class="logo-row" data-theme="dark">{lockup(i)}</div>
      <div class="logo-row logo-row--small" data-theme="light">{svg(i, 24)}{svg(i, 16)}</div></div>
      <figcaption><strong>{LOGOS[i][0]}</strong><span>{LOGOS[i][1]}</span></figcaption></figure>''' for i in range(len(LOGOS)))
    page = f'''<!doctype html><html lang="fr" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Propositions de logo — FranceRoueLibre</title><link rel="stylesheet" href="./style.css">
<style>
body {{ background: var(--c-bg); padding: 2.5rem 1.5rem; }}
h1 {{ font-size: 1.8rem; margin-bottom: .4rem; }} .intro {{ color: var(--c-muted); margin-bottom: 2rem; }}
.logo-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 1.2rem; max-width: 1200px; }}
.logo-card {{ position: relative; margin: 0; padding: 1rem; border-radius: var(--r-md); background: var(--c-surface); }}
.logo-num {{ position: absolute; top: .8rem; right: .9rem; width: 1.8rem; height: 1.8rem; border-radius: 50%; display: grid; place-items: center; background: var(--brand-gradient); color: #fff; font-weight: 700; font-family: var(--font-display); }}
.logo-rows {{ display: grid; gap: .6rem; }}
.logo-row {{ display: flex; align-items: center; gap: .8rem; padding: .9rem 1rem; border-radius: var(--r-sm); background: var(--c-bg); color: var(--c-ink); }}
.logo-row--small {{ padding: .5rem 1rem; }}
figcaption {{ display: grid; gap: .15rem; margin-top: .8rem; font-size: .85rem; color: var(--c-muted); }} figcaption strong {{ color: var(--c-ink); font-family: var(--font-display); }}
</style></head><body><h1>Propositions de logo</h1><p class="intro">Chaque logo dans le bloc-marque du site (emblème, filet vertical, « France / RoueLibre » sur deux lignes), en clair, en sombre et aux petites tailles (24 et 16 px, pour l’onglet du navigateur).</p>
<div class="logo-grid">{cards}</div></body></html>'''
    open('dist/logos.html', 'w', encoding='utf-8').write(page)
    json.dump({str(i + 1): svg(i) for i in range(len(LOGOS))}, open('dist/data/logos.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print('✓ dist/logos.html')
