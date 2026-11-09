"""Answers without a model to the usual questions about one commune, asked in a sentence: its debt, its financial
health, how it compares with communes of the same size, its staff costs, running costs, investment, revenue, local
taxes, its mayor and the indemnities of its elected officials, the associations of the place funded by the State, the
public contracts it signed, the projects the State helped. Built from the same tools as the Loupe's
(tools.dossier_commune, outils.comparer, the search index), so the figures are the ones the model would read.

A question is answered here only when the place is certain (one commune, or homonyms told apart by a postal code, a
département or the conversation) and every significant word of the question is understood: « Quelle est la dette de
Laz ? », « Comment Franconville se compare-t-elle aux communes de même taille ? », « et Vallauris ? » after a question
about debt. Anything more precise (« la dette de Laz pour la piscine », « les feux d'artifice à Alès ») returns None and
goes to the model, which can search further.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from . import outils as O
from . import places
from . import settings as S
from . import tools as T

# Intents, in the order they win when a question names several (« les élus et la dette » → élus)
INTENTS = [
    ('elus', r'\b(elus?|maires?|adjoints?|indemnites?|conseil municipal|conseillers?|equipe municipale|edile)\b'),
    ('associations', r'\b(associations?|assos?|associatif|associative)\b'),
    ('marches', r'\b(marches? publics?|marches?|commande publique|appels? d offres?|contrats?|prestataires?|fournisseurs?)\b'),
    ('projets', r'\b(projets?|detr|dsil|dpv|subventions? d investissement)\b'),
    ('dette', r'\b(dettes?|endette\w*|emprunts?|desendettement|rembourse\w*)\b'),
    ('sante', r'\b(sante financiere|situation financiere|finances?|financiere?s?|geree?s?|gestion|faillite|equilibre)\b'),
    ('personnel', r'\b(personnel|salaires?|salaries|agents?|fonctionnaires?|masse salariale|effectifs?|employes?)\b'),
    ('fonctionnement', r'\b(fonctionnement)\b'),
    ('equipement', r'\b(equipements?|investissements?|investit|investi|travaux)\b'),
    ('recettes', r'\b(recettes?|ressources|revenus|rentrees)\b'),
    ('impots', r'\b(impots?|fiscalite|fiscales?|taxes?)\b'),
    ('dgf', r'\b(dgf|dotations?)\b'),
    ('depenses', r'\b(budgets?|depense\w*|coute\w*|couts?|argent|comptes?|chiffres|donnees|informations?|dossier|bilan)\b'),
]
COMPARE = r'\b(meme taille|meme strate|compar\w*|situe\w*|se place|par rapport|moyenne|mediane|classement|rang|autres communes|similaires?|equivalentes?)\b'
# Words that carry no meaning of their own here; anything else unknown sends the question to the model
STOP = set('''a ai au aux avec c ca ce ces cet cette chaque comment combien d dans de des du elle elles en entre est et etre
eu ete fait faire il ils j je l la le les leur leurs lui m ma me mes moi mon n ne nos notre nous on ou par pas pour qu que quel
quelle quelles quels qui quoi s sa se ses si son sont sur t ta te tes ton tu un une vos votre vous y depuis
donne donner donnez dis dire dites montre montrer montrez liste lister listez peux pouvez peut voudrais voudrait veux veut
savoir connaitre voir afficher affiche indique indiquer indiquez explique expliquer expliquez detail details detaille
detailler detaillee detailles precise preciser resume resumer analyse analyser presente presenter parle parler
total totale totaux montant montants niveau niveaux evolution evolue evoluer evolues annee annees an ans actuel actuelle
actuellement aujourd hui maintenant derniere dernier dernieres derniers recent recente recents recemment plus moins tres trop
beaucoup peu bien mal eleve elevee elevees eleves haut haute bas basse gros grosse grosses grand grande grands grandes
principal principale principaux principales premier premiers premieres premiere top bon bonne cher chere chers cheres
habitant habitants hab euro euros eur commune communes ville villes mairie mairies municipalite municipal municipale
municipaux collectivite village cite localite notre ma mon nos
recoit recoivent recu recus recue recues touche touchent toucher percoit percoivent percu percus verse versee verses versees
paye payes payee paie paient payer payent gagne gagnent gagner coute coutent couter ont avait avaient sera seront serait
passe passes passee passees signe signes finance financee finances
financees aide aides aidee aidees subvention subventions subventionne subventionnees subventionnes etat public publics
publique publiques quelles quel combien enfin aussi alors donc encore deja toujours vraiment exactement environ
mandat mandats ls frais charges elle-meme sont-ils est-elle a-t-elle t-elle t-il oui non merci svp stp please bonjour
'''.split())
# Words of a national question: « le budget de l'État par habitant » is not about the commune of the conversation
NATIONAL_WORDS = set('etat france francais francaise national nationale nationaux pays gouvernement ministere ministeres '
                     'ministre ministres depute deputes senat senateur senateurs president'.split())
YEAR = re.compile(r'^(19[89]\d|20[0-3]\d)$')
SOURCES = [{'title': 'OFGL, comptes des collectivités locales', 'url': 'https://data.ofgl.fr/'}]
ARTICLES = ('la ', 'le ', 'les ', "l ")


def norm(text: str) -> str:
    return places.norm(str(text or '').replace('-', ' '))


def intents_of(text: str) -> List[str]:
    q = norm(text)
    return [i for i, p in INTENTS if re.search(p, q)]


def compares(text: str) -> bool:
    return bool(re.search(COMPARE, norm(text)))


def _leftover(q: str, place_words: set) -> List[str]:
    """Significant words of the question that no intent, stop word or place name explains."""
    for _, p in INTENTS:
        q = re.sub(p, ' ', q)
    q = re.sub(COMPARE, ' ', q)
    return [w for w in q.split() if w not in STOP and w not in place_words and not YEAR.match(w)
            and not re.fullmatch(r'\d{1,3}', w) and not (re.fullmatch(r'\d{5}', w))]


# ======================================================================================= which commune is meant
def _place_words(c: dict) -> set:
    words = set(norm(c['nom']).split()) | set(c.get('codes_postaux') or []) | {c['dep'].lower()}
    words |= set(norm(c.get('dep_nom', '')).split())
    return words | {'saint', 'sainte', 'st', 'ste', 'sur', 'sous', 'les', 'en'}


def resolve(text: str, context: Optional[str] = None) -> Tuple[Optional[dict], str]:
    """(commune, how) for a sentence that names one commune; (None, 'homonymes') with the candidates in .homonyms when
    the name is shared and nothing tells them apart; (None, '') when no commune is named."""
    places.load(S.DATA_DIR / 'web' / 'communes-lookup.json')
    q = norm(text)
    found = places.find(text)
    kind, communes = found['type'], found['communes']
    if kind == 'dans_la_phrase' and communes and _is_word(communes[0]['nom']):
        # « le maire d'Annecy » names Annecy, not Mairé: the words of the question are taken out, then the place read again
        rest = ' '.join(w for w in q.split() if not _is_word(w))
        found = places.find(rest) if rest else {'type': '', 'communes': []}
        kind, communes = found['type'], found['communes']
    if kind in ('', 'debut', 'approchant', 'departement', 'region') or not communes:
        return None, ''
    if kind in ('nom', 'code_postal', 'dans_la_phrase', 'ancienne_commune', 'arrondissement'):
        names = {c['nom'] for c in communes}
        if len(communes) == 1:
            return communes[0], kind
        if len(names) == 1 or kind == 'code_postal':
            words = set(q.split())
            told = [c for c in communes if c['dep'].lower() in words or words & set(c.get('codes_postaux') or [])
                    or set(norm(c['dep_nom']).split()) <= words]
            if len(told) == 1:
                return told[0], kind
            if context and any(c['insee'] == context for c in communes):
                return next(c for c in communes if c['insee'] == context), kind
            resolve.homonyms = communes
            return None, 'homonymes'
    return None, ''


resolve.homonyms = []


def _is_word(name: str) -> bool:
    """A commune named like a word of the questions (Mairé, Budget…), read as that word inside a sentence."""
    n = norm(name)
    return n in STOP or any(re.fullmatch(p, n) for _, p in INTENTS) or bool(re.fullmatch(COMPARE, n))


def context_place(messages: list) -> Optional[str]:
    """Insee code of the commune the conversation is about: the latest user message that names one commune for sure."""
    from . import fiche
    for m in reversed(messages[:-1]):
        if m.get('role') != 'user':
            continue
        text = str(m.get('text') or '')
        asked = fiche.place_of(text) if fiche.ASKED.match(text) else None
        try:
            c, how = resolve(asked or text)
        except Exception:  # noqa: BLE001
            return None
        if c:
            return c['insee']
        if fiche.siren_of(text) or fiche.level_of(text):
            return None   # the conversation moved to a body or a level: no commune to carry over
    return None


# ======================================================================================= formatting
def eur(v: float) -> str:
    from .fiche import eur as e
    return e(v)


def num(v: float) -> str:
    return f'{v:,.0f}'.replace(',', ' ')


def dec(v: float) -> str:
    return f'{v:.1f}'.replace('.', ',')


def pct(v: float) -> str:
    return f'{"+" if v >= 0 else "−"}{abs(v):.0f} %'


def series(values: dict) -> str:
    ys = sorted(values, key=int)
    return ' · '.join(f'{y} : {eur(values[y])}' for y in ys if values[y] is not None)


def _cmp(code: str, agregat: str, label: str) -> Optional[str]:
    r = O.comparer(code, agregat)
    if not r.get('mediane_par_habitant_eur') and r.get('mediane_par_habitant_eur') != 0:
        return None
    if r.get('par_habitant_eur') is None:
        return None
    med, mine = r['mediane_par_habitant_eur'], r['par_habitant_eur']
    where = 'au niveau de' if med and abs(mine / med - 1) < 0.03 else 'au-dessus de' if mine > med else 'en dessous de'
    rank = re.match(r'(\d+)e sur (\d+)', r['rang'])
    rank_text = f' ; {rank.group(1)}e plus élevé sur {num(int(rank.group(2)))}' if rank else ''
    return (f'{label} : {num(mine)} € par habitant en {r["annee"]}, {where} la médiane des {r["groupe"]} '
            f'({num(med)} €{rank_text}).')


# ======================================================================================= answers
AGG = {  # intent -> (row of comptes, aggregate of comparer, label)
    'personnel': ('Frais de personnel', 'frais-de-personnel', 'Frais de personnel'),
    'fonctionnement': ('Dépenses de fonctionnement', 'depenses-de-fonctionnement', 'Dépenses de fonctionnement'),
    'equipement': ("Dépenses d'équipement", 'depenses-d-equipement', 'Dépenses d’équipement (investissements)'),
    'recettes': ('Recettes totales', 'recettes-totales', 'Recettes totales'),
    'impots': ('Impôts locaux', 'impots-locaux', 'Impôts locaux'),
    'dgf': ('Dotation globale de fonctionnement', 'dotation-globale-de-fonctionnement', 'Dotation globale de fonctionnement (DGF)'),
    'depenses': ('Dépenses totales', 'depenses-totales', 'Dépenses totales'),
    'dette': ('Encours de dette', 'encours-de-dette', 'Dette'),
}
NOTES = {
    'personnel': 'Les frais de personnel comptent les salaires et cotisations des agents de la commune (budgets principal '
                 'et annexes). Le nombre d’agents n’est pas publié commune par commune dans ces données. Une commune qui '
                 'confie un service (cantine, crèche, eau) à son intercommunalité ou à un prestataire a moins de personnel.',
    'impots': 'Impôts locaux : surtout les taxes foncières et la taxe d’habitation sur les résidences secondaires. Le taux '
              'et le montant de chaque taxe ne sont pas dans ces données.',
    'dgf': 'La DGF est la principale dotation de l’État aux collectivités.',
    'equipement': 'Dépenses d’équipement : travaux, bâtiments, voirie, matériel. Elles varient beaucoup d’une année à '
                  'l’autre, au rythme des chantiers.',
}


def _head(d: dict) -> Tuple[str, dict, dict, int]:
    c = d['commune']
    rows, pop = d['comptes']['montants_eur'], d['comptes']['population']
    last = max(int(y) for y in pop)
    lieu = re.sub(r'\s*\((\w+)\)\s*$', r', \1', c['lieu'])
    return f'{c["nom"]} ({lieu} · {num(pop.get(str(last), pop.get(last, 0)) or 0)} habitants en {last})', rows, pop, last


def _get(series_: dict, year: int):
    return series_.get(str(year), series_.get(year))


def _first_last(values: dict) -> Tuple[int, int]:
    ys = sorted(int(y) for y, v in values.items() if v is not None)
    return ys[0], ys[-1]


def _aggregate(d: dict, intent: str, compare: bool) -> List[str]:
    row, key, label = AGG[intent]
    head, rows, pop, last = _head(d)
    values = rows.get(row) or {}
    if not values:
        return []
    first, last = _first_last(values)
    v, p = _get(values, last), _get(pop, last) or 0
    out = [f'**{label} de {head}** : **{eur(v)}** en {last}' + (f', soit **{num(v / p)} € par habitant**.' if p else '.'), '']
    if first != last and _get(values, first):
        change = 100 * (v / _get(values, first) - 1)
        from .fiche import prices
        out.append(f'- Évolution : {series(values)} ({pct(change)} de {first} à {last}, quand les prix ont augmenté de '
                   f'{prices(first, last):.0f} %).')
    line = _cmp(d['commune']['code'], key, 'Comparaison')
    if line:
        out.append(f'- {line}')
    if intent == 'personnel':
        r = O.comparer(d['commune']['code'], 'frais-de-personnel', rapport_a='depenses-de-fonctionnement')
        if r.get('part_pct') is not None:
            out.append(f'- Part dans les dépenses de fonctionnement : {r["part_pct"]:.0f} % en {r["annee"]} (médiane des '
                       f'{r["groupe"]} : {r["mediane_pct"]:.0f} %).')
    if intent in NOTES:
        out += ['', NOTES[intent]]
    return out


def _debt(d: dict, compare: bool) -> List[str]:
    head, rows, pop, last = _head(d)
    debt = rows.get('Encours de dette') or {}
    if not debt:
        return []
    first, last = _first_last(debt)
    v, p = _get(debt, last), _get(pop, last) or 0
    if not v:
        out = [f'**{head}** n’a **aucune dette** fin {last} (budget principal et budgets annexes).', '']
    else:
        out = [f'**Dette de {head}** : **{eur(v)}** fin {last}' + (f', soit **{num(v / p)} € par habitant**.' if p else '.'), '']
    out.append(f'- Évolution : {series(debt)}.')
    line = _cmp(d['commune']['code'], 'encours-de-dette', 'Comparaison')
    if line:
        out.append(f'- {line}')
    saving = _get(rows.get('Epargne brute') or {}, last)
    if v and saving is not None:
        if saving > 0:
            out.append(f'- Capacité de désendettement : {dec(v / saving)} année{"s" if v / saving >= 2 else ""} '
                       f'd’épargne brute ({eur(saving)} en {last}) pour rembourser toute la dette, si la commune y consacrait '
                       f'tout son excédent de fonctionnement.')
        else:
            out.append(f'- Épargne brute négative en {last} ({eur(saving)}) : les recettes de fonctionnement ne couvrent '
                       f'pas les dépenses de fonctionnement, rien ne reste pour rembourser la dette.')
    out += ['', 'Dette consolidée (budget principal et budgets annexes), au 31 décembre. Le détail des emprunts (prêteurs, '
                'taux, durée) est dans le compte administratif de la commune, pas dans ces données.']
    return out


def _health(d: dict) -> List[str]:
    head, rows, pop, last = _head(d)
    code = d['commune']['code']
    get = lambda r: _get(rows.get(r) or {}, last)
    spend, income, saving, debt = get('Dépenses totales'), get('Recettes totales'), get('Epargne brute'), get('Encours de dette')
    p = _get(pop, last) or 0
    out = [f'**Finances de {head}**, en {last} :', '']
    if spend is not None:
        out.append(f'- Dépenses totales : {eur(spend)}' + (f' ({num(spend / p)} € par habitant)' if p else '') + '.')
    if income is not None:
        out.append(f'- Recettes totales : {eur(income)}' + (f' ({num(income / p)} € par habitant)' if p else '') +
                   ('. L’écart avec les dépenses est couvert par l’emprunt ou la trésorerie.' if spend and income < spend else '.'))
    if saving is not None:
        out.append(f'- Épargne brute (excédent de fonctionnement) : {eur(saving)}' +
                   (', négative : la commune ne dégage pas d’excédent pour investir ou rembourser.' if saving < 0 else '.'))
    if debt is not None:
        out.append(f'- Dette : {eur(debt)} fin {last}' + (f', soit {num(debt / p)} € par habitant' if p else '') +
                   (f', {dec(debt / saving)} années d’épargne brute' if debt and saving and saving > 0 else '') + '.')
    out += ['', '**Par rapport aux communes de même taille :**']
    for key, label in (('depenses-totales', 'Dépenses totales'), ('frais-de-personnel', 'Frais de personnel'),
                       ('depenses-d-equipement', 'Dépenses d’équipement'), ('encours-de-dette', 'Dette')):
        line = _cmp(code, key, label)
        if line:
            out.append(f'- {line}')
    sig = d.get('signaux')
    if isinstance(sig, list) and sig:
        out.append('- Signal du site : ' + '; '.join(s['signal'].split(' : ')[0] for s in sig) + '. À vérifier auprès de la commune.')
    out += ['', 'Ces repères ne disent pas à eux seuls si l’argent est bien dépensé : une commune qui gère elle-même un '
                'service (cantine, piscine, crèche) dépense plus qu’une commune qui le confie à son intercommunalité.']
    return out


def _compare_all(d: dict) -> List[str]:
    head, rows, pop, last = _head(d)
    code = d['commune']['code']
    out = [f'**{head}** comparée aux communes de même taille :', '']
    for key, label in (('depenses-totales', 'Dépenses totales'), ('depenses-de-fonctionnement', 'Dépenses de fonctionnement'),
                       ('frais-de-personnel', 'Frais de personnel'), ('depenses-d-equipement', 'Dépenses d’équipement'),
                       ('impots-locaux', 'Impôts locaux'), ('encours-de-dette', 'Dette')):
        line = _cmp(code, key, label)
        if line:
            out.append(f'- {line}')
    out += ['', 'La médiane est la valeur du milieu : la moitié des communes du groupe sont au-dessus. Une commune qui gère '
                'elle-même un service (cantine, piscine, crèche) dépense plus qu’une commune qui le confie à son '
                'intercommunalité : un écart n’est pas en soi une anomalie.']
    return out


def _elected(d: dict, text: str) -> List[str]:
    head, rows, pop, last = _head(d)
    e = d.get('elus_et_personnel') or {}
    code = d['commune']['code']
    out = [f'**Élus de {head}**', '']
    mayor = None
    try:
        from . import personnes
        mayor = personnes.mayor_of(code)
    except Exception:  # noqa: BLE001 - the names are a plus
        mayor = None
    if mayor:
        since = f', en fonction depuis le {mayor["depuis"]}' if mayor.get('depuis') else ''
        out.append(f'- Maire : **{mayor["nom"]}**{since} (Répertoire national des élus, {mayor["source_date"]}).')
    if e.get('conseillers_municipaux'):
        out.append(f'- Conseil municipal : {e["conseillers_municipaux"]} élus en fonction, dont {e.get("adjoints", 0)} adjoints '
                   f'(Répertoire national des élus, {e.get("annee")}).')
    paid = e.get('indemnites_elus_payees_eur')
    if paid is not None:
        p = _get(pop, last) or 0
        out.append(f'- Indemnités de fonction versées à l’ensemble des élus : **{eur(paid)}** en {e.get("annee")}'
                   + (f', soit {num(paid / p)} € par habitant' if p else '')
                   + (f' ({eur(e["indemnites_elus_payees_2019_eur"])} en 2019)' if e.get('indemnites_elus_payees_2019_eur') else '') + '.')
    if e.get('indemnites_cotisations_et_frais_eur'):
        out.append(f'- Avec les cotisations, la formation et les frais de mission : {eur(e["indemnites_cotisations_et_frais_eur"])}.')
    if e.get('plafond_de_base_indemnites_eur'):
        out.append(f'- Plafond légal de base (maire et adjoints au taux maximal) : {eur(e["plafond_de_base_indemnites_eur"])} par an.')
    try:
        from . import personnes
        cap = personnes.mayor_cap(_get(pop, last) or 0)
    except Exception:  # noqa: BLE001
        cap = None
    if cap:
        out.append(f'- Indemnité maximale d’un maire de commune de cette taille : {num(cap["mensuel_brut"])} € brut par mois '
                   f'({cap["taux"]} % de l’indice brut terminal de la fonction publique, {cap["texte"]}), hors majorations.')
    out += ['', 'Le montant versé à chaque élu n’est pas publié : seul le total de la commune l’est (comptes de la DGFiP). '
                'Le plafond de base ne compte ni les majorations légales (chef-lieu, station de tourisme…) ni les '
                'conseillers délégués : le dépasser n’est pas en soi une irrégularité.']
    return out


def _associations(d: dict) -> List[str]:
    head, _, _, _ = _head(d)
    a = d.get('subventions_etat_associations_du_lieu')
    if not a or isinstance(a, str):
        return [f'Aucune subvention de l’État n’est publiée pour une association dont le siège est à **{head}**.', '',
                'Ces données ne couvrent que les subventions de l’État (annexes « jaunes » des lois de finances) : les '
                'subventions de la commune, du département ou de la région à ses associations n’y figurent pas.']
    out = [f'**Associations de {head} subventionnées par l’État** : **{eur(a["total_eur"])}** publiés au total, pour '
           f'{a["associations"]} association{"s" if a["associations"] > 1 else ""} ({a["lignes"]} lignes).', '']
    for x in a.get('principales') or []:
        out.append(f'- {x["nom"]} : {eur(x["total_eur"])}' + (f' (SIREN {x["siren"]})' if x.get('siren') and len(set(x['siren'])) > 1 else ''))
    years = a.get('par_annee_eur') or {}
    if years:
        out += ['', f'Par année de versement : {series(years)}.']
    out += ['', 'Seules les subventions de l’État sont publiées ici (annexes « jaunes » des lois de finances, années '
                'publiées seulement). Les subventions que la commune verse elle-même à ses associations sont dans son '
                'compte administratif. Une association nationale est comptée tout entière dans la commune de son siège.']
    return out


def _projects(d: dict) -> List[str]:
    head, _, _, _ = _head(d)
    p = d.get('projets_aides_etat') or {}
    if not p.get('nombre'):
        return [f'Aucun projet de **{head}** aidé par l’État (DETR, DSIL, DPV, DSID) n’est publié depuis 2018.']
    out = [f'**Projets de {head} aidés par l’État** : **{eur(p["total_eur"])}** pour {p["nombre"]} projet'
           f'{"s" if p["nombre"] > 1 else ""} depuis {min(p["par_annee_eur"])}.', '',
           f'- Par année : {series(p["par_annee_eur"])}.']
    if p.get('par_dispositif_eur'):
        out.append('- Par dispositif : ' + ' · '.join(f'{k} : {eur(v)}' for k, v in sorted(p['par_dispositif_eur'].items(), key=lambda kv: -kv[1])) + '.')
    for x in (p.get('plus_gros') or [])[:5]:
        out.append(f'- {x["annee"]} · {x["dispositif"]} : « {str(x["objet"]).rstrip(".")} » ({eur(x["montant_eur"])})')
    return out


def _siren_prefix(code: str) -> str:
    """The SIREN of a commune is 21, the first two digits of its Insee code, one digit (0, or the last digit of an
    overseas département), the last three digits and a check digit: 217803113 is Houilles (78311), 219711207
    Pointe-à-Pitre (97120), 212000400 a commune of Corsica (2A004 → 20)."""
    dep = '20' if code[:2] in ('2A', '2B') else code[:2]
    middle = code[2] if code.startswith('97') else '0'
    return f'21{dep}{middle}{code[2:]}'


def _contracts(d: dict) -> List[str]:
    head, _, _, _ = _head(d)
    code = d['commune']['code']
    prefix = _siren_prefix(code)
    with T._sql_lock:
        db = T._sql_connection()
        rows = db.execute('SELECT year, amount, fw, title, extra FROM doc WHERE src = 2 AND siren LIKE ? ',
                          [prefix + '_']).fetchall()
    if not rows:
        return [f'Aucun marché public n’est publié sous le SIREN de la commune de **{head}** dans les données essentielles '
                f'de la commande publique.', '',
                'Les marchés peuvent avoir été passés par l’intercommunalité, un syndicat ou une société publique locale, '
                'ou ne pas avoir été publiés (petits montants).']
    firm = [r for r in rows if not r[2]]
    frames = [r for r in rows if r[2]]
    by_year = {}
    for y, a, *_ in firm:
        by_year[y] = by_year.get(y, 0) + (a or 0)
    out = [f'**Marchés publics de {head}** : {num(len(rows))} marché{"s" if len(rows) > 1 else ""} publiés de '
           f'{min(r[0] for r in rows)} à {max(r[0] for r in rows)}, dont **{eur(sum(by_year.values()))}** de marchés à montant '
           f'ferme' + (f' et {num(len(frames))} accord{"s" if len(frames) > 1 else ""}-cadre{"s" if len(frames) > 1 else ""} '
                       f'(montant maximal, pas forcément dépensé)' if frames else '') + '.', '']
    if by_year:
        out.append(f'- Par année de publication (montants fermes) : {series(by_year)}.')
    out.append('- Les plus gros :')
    for y, a, fw, title, extra in sorted(rows, key=lambda r: -(r[1] or 0))[:6]:
        out.append(f'  - {y} · {eur(a or 0)}{" (plafond d’accord-cadre)" if fw else ""} : « {str(title).strip()[:110]} »'
                   + (f' ({extra})' if extra else ''))
    out += ['', 'Source : données essentielles de la commande publique (DECP), marchés publiés sous le SIREN de la commune. '
                'Un marché pluriannuel est compté en entier l’année de sa publication.',
            f'Tous les marchés : [recherche « {d["commune"]["nom"]} »]({S.SITE_URL}/recherche.html?q={_siren_full(prefix, rows)}).']
    return out


def _siren_full(prefix: str, rows) -> str:
    with T._sql_lock:
        db = T._sql_connection()
        hit = db.execute('SELECT siren FROM doc WHERE src = 2 AND siren LIKE ? LIMIT 1', [prefix + '_']).fetchone()
    return hit[0] if hit else prefix


BUILD = {'dette': lambda d, t, c: _debt(d, c), 'sante': lambda d, t, c: _health(d), 'elus': lambda d, t, c: _elected(d, t),
         'associations': lambda d, t, c: _associations(d), 'projets': lambda d, t, c: _projects(d),
         'marches': lambda d, t, c: _contracts(d)}
LABELS = {'dette': 'Dette', 'sante': 'Finances', 'elus': 'Élus et indemnités', 'associations': 'Associations aidées par l’État',
          'projets': 'Projets aidés par l’État', 'marches': 'Marchés publics', 'compare': 'Comparaison'}
MORE = {'dette': 'Quelle est la dette de {n} ?', 'sante': 'Quelle est la santé financière de {n} ?',
        'compare': 'Comment {n} se compare-t-elle aux communes de même taille ?', 'elus': 'Combien coûtent les élus de {n} ?',
        'associations': 'Quelles associations de {n} reçoivent des subventions de l’État ?',
        'marches': 'Quels marchés publics {n} a-t-elle passés ?', 'personnel': 'Combien {n} dépense-t-elle en personnel ?'}


def build(code: str, intent: str, text: str = '', compare: bool = False) -> Optional[dict]:
    d = T.dossier_commune(f'insee:{code}')
    if not d.get('commune'):
        return None
    if compare and intent in ('depenses', 'sante') and not re.search(r'sante|situation|finances', norm(text)):
        lines, intent = _compare_all(d), 'compare'
    elif intent in BUILD:
        lines = BUILD[intent](d, text, compare)
    elif intent in AGG:
        lines = _aggregate(d, intent, compare)
    else:
        return None
    if not lines:
        return None
    name = d['commune']['nom']
    more = [MORE[k].format(n=name) for k in ('sante', 'compare', 'dette', 'elus', 'associations', 'marches') if k != intent][:3]
    lines += ['', 'Pour aller plus loin :'] + [f'- {m}' for m in more]
    sources = list(SOURCES)
    if intent == 'elus':
        sources.append({'title': 'Répertoire national des élus', 'url': 'https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1/'})
    if intent == 'associations':
        sources.append({'title': 'Annexes « jaunes » : l’effort financier de l’État en faveur des associations',
                        'url': 'https://www.budget.gouv.fr/documentation/documents-budgetaires'})
    if intent == 'marches':
        sources.append({'title': 'Données essentielles de la commande publique', 'url': 'https://data.economie.gouv.fr/explore/dataset/decp-v3-marches-valides/'})
    if intent == 'projets':
        sources.append({'title': 'DGCL, subventions d’investissement aux collectivités', 'url': 'https://www.collectivites-locales.gouv.fr/'})
    events = [{'type': 'tool_done', 'name': 'dossier_collectivite', 'label': f'Dossier de « {name} »', 'ok': True,
               'summary': LABELS.get(intent, AGG.get(intent, ('', '', intent))[2]), 's': 0}]
    if intent in ('dette', 'compare', 'sante') or intent in AGG:
        events.append({'type': 'tool_done', 'name': 'comparer', 'label': f'Comparaison de « {name} » avec les communes de même taille',
                       'ok': True, 'summary': 'médiane et rang', 's': 0})
    return {'reply': '\n'.join(lines), 'sources': sources, 'liens': {'commune': name, 'liens': T._links(code, '')},
            'events': events, 'searches': [], 'provider': 'faq', 'label': 'Réponse sourcée automatique',
            'saved': f'commune-{intent}'}


def answer(messages: list) -> Optional[dict]:
    """A question about one commune that this module understands entirely, else None."""
    text = str(messages[-1].get('text') or '')
    if len(text) > 220:
        return None
    q = norm(text)
    found = intents_of(text)
    compare = compares(text)
    if not found and not compare:
        return None
    intent = found[0] if found else 'depenses'
    if compare and intent == 'depenses' and len(found) > 1:
        intent = found[1]
    words_q = q.split()
    if re.search(r'\b(quelles? (villes?|communes?)|quelle est la (ville|commune)|qui (est|sont)|lesquelles?)\b', q):
        return None   # « quelle ville n'est pas endettée ? »: a ranking of communes, not one commune
    if intent == 'depenses' and re.search(r'\b(plus (grande?s?|grosses?|gros|cher|chere|important\w*)|liste\w*|detail\w*|ventil\w*|reparti\w*)\b', q):
        return None   # « la plus grande dépense », « liste des dépenses »: the overview does not answer it
    users = [m for m in messages if m.get('role') == 'user']
    context = context_place(messages) if len(users) > 1 else None
    commune, how = resolve(text, context)
    if how == 'homonymes':
        return None
    if commune:
        words = _place_words(commune)
    elif context and len(users) > 1 and len(words_q) <= 6 and not set(words_q) & NATIONAL_WORDS:
        code = context
        c = places.by_insee(code)
        words = _place_words(c) if c else set()
        commune = c
    else:
        return None
    if not commune or _leftover(q, words):
        return None
    try:
        return build(commune['insee'], intent, text, compare)
    except Exception:  # noqa: BLE001 - any trouble: the model answers instead
        return None


FOLLOW = re.compile(r'^\s*(?:et|et pour|et a|et à|et sur|pour|a|à|meme chose pour|même chose pour|meme question pour|même question pour|'
                    r'pareil pour|idem pour|meme analyse pour|même analyse pour|meme analyse mais pour|même analyse mais pour|'
                    r'maintenant|et maintenant|et la ville de|et la commune de|la ville de|la commune de|ville de|commune de|mairie de)?\s+'
                    r'(.+?)\s*(?:maintenant)?\s*[?.!]*\s*$', re.I)


def follow_up(messages: list) -> Optional[dict]:
    """« et Vallauris ? », « même chose pour Orange », « 94450 », « Tarbes » in a conversation: the same question, or
    the commune's dossier, for the new commune, when the new place is certain and the message says nothing else."""
    from . import fiche
    text = str(messages[-1].get('text') or '').strip()
    if len(text) > 80 or len(text.split()) > 8:
        return None
    m = FOLLOW.match(' ' + text)
    name = (m.group(1) if m else text).strip()
    if not name or re.fullmatch(r'\d{1,3}', name):      # « 25 »: an answer to a question, not a département
        return None
    places.load(S.DATA_DIR / 'web' / 'communes-lookup.json')
    found = places.find(name)
    kind, communes = found['type'], found['communes']
    if kind not in ('nom', 'code_postal', 'ancienne_commune', 'arrondissement'):
        if kind == 'region' or (kind == 'departement' and not re.fullmatch(r'\w{1,3}', norm(name))):
            return None   # a département or a region named in full: fiche.answer gives its accounts on a first question only
        return None
    if norm(name) in STOP or len(norm(name)) < 3:
        return None
    # what was asked before: the same intent for the new commune (« Quelle est la dette de Laz ? » then « et Mauron ? »)
    previous = next((str(x.get('text') or '') for x in reversed(messages[:-1]) if x.get('role') == 'user'), '')
    asked = intents_of(previous) if previous and not fiche.ASKED.match(previous) else []
    compare = compares(previous) if previous else False
    if len(communes) > 1 and len({c['nom'] for c in communes}) == 1 and kind != 'code_postal':
        return None   # homonyms: fiche.answer lists them on a first question; here the model reads the conversation
    if len(communes) != 1:
        return None
    code = communes[0]['insee']
    if (asked or compare) and m and m.group(0) and re.match(r'^\s*(et|pour|meme|même|pareil|idem|a |à )', text, re.I):
        intent = asked[0] if asked else 'depenses'
        if compare and intent == 'depenses' and len(asked) > 1:
            intent = asked[1]
        try:
            res = build(code, intent, previous, compare)
        except Exception:  # noqa: BLE001
            res = None
        if res:
            return res
    return None
