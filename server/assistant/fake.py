"""A fake model for testing the assistant's interface without spending a token: `python server/assistant_api.py --fake`.

It plays a realistic conversation through the real agent loop and the real local tools (search index, accounts of
local authorities, published JSON files), with delays like a real model, but never calls Google or Anthropic: the
"web search" returns canned sources. Words in the question pick a scenario:

* « erreur »  : Gemini fails, so in « Auto » Claude takes over (the switch animation)
* « panne »   : both fail (the error state)
* « long »    : a long answer with lists and links (scrolling, writing animation)
* « commune », « ville » or « département » : the accounts tool on Rennes, or on the named place
* « web »     : a web search only
* anything else: a search in the published spending lines, a web search, then an answer built from the real figures
"""
from __future__ import annotations

import json
import random
import re
import time
from typing import List

from .providers import ModelError

LONG = """Voici une réponse **longue** pour tester le défilement et l’animation d’écriture.

Les dépenses publiques se lisent à plusieurs niveaux :

- **L’État** : le budget voté par le Parlement, mission par mission, et son exécution mois par mois ([budget de l’État](https://francerouelibre.fr/etat.html)).
- **Les collectivités** : communes, intercommunalités, départements et régions, dont les comptes sont publiés par l’OFGL ([carte](https://francerouelibre.fr/index.html#explorer)).
- **La Sécurité sociale** : premier poste de dépense, dont les comptes détaillés ne sont plus publiés en données ouvertes depuis 2010 ([Sécurité sociale](https://francerouelibre.fr/secu.html)).

Pour une question précise, le mieux est de partir d’un mot : « vidéoprotection », « photovoltaïque », « cantine »… La [recherche](https://francerouelibre.fr/recherche.html?q=cantine) retrouve toutes les lignes publiées qui le contiennent.

1. Les montants des accords-cadres sont des plafonds, pas des dépenses.
2. Un mot dans un libellé ne veut pas dire que tout le montant y est consacré.
3. Un signal n’est pas une preuve : c’est une question à poser à l’organisme.

Ceci est une réponse de démonstration : aucun modèle n’a été appelé."""


def _words(question: str) -> List[str]:
    return [w for w in re.findall(r'[A-Za-zÀ-ÿ\-]{5,}', question)]


def _last_result(contents: List[dict], name: str):
    for c in reversed(contents):
        for p in c.get('parts') or []:
            fr = p.get('functionResponse')
            if fr and fr.get('name') == name:
                return (fr.get('response') or {}).get('result') or {}
    return None


def _question(contents: List[dict]) -> str:
    for c in reversed(contents):
        if c.get('role') == 'user':
            texts = [p['text'] for p in c.get('parts') or [] if p.get('text')]
            if texts and not any('functionResponse' in p for p in c['parts']):
                return texts[-1]
    return ''


def _eur(x) -> str:
    x = float(x or 0)
    if x >= 1e9:
        return f'{x / 1e9:.1f} Md€'.replace('.', ',')
    if x >= 1e6:
        return f'{x / 1e6:.1f} M€'.replace('.', ',')
    return f'{round(x):,} €'.replace(',', ' ')


class FakeClient:
    provider = 'gemini'
    label = 'Gemini'
    model = 'démo (aucun appel)'

    def __init__(self):
        self.calls = 0
        self.eur = 0.0
        self.step = 0

    @staticmethod
    def configured() -> bool:
        return True

    def _wait(self, lo=0.9, hi=2.2):
        time.sleep(random.uniform(lo, hi))

    def generate(self, contents: List[dict], system: str, tools: List[dict]) -> dict:
        self.calls += 1
        self.step += 1
        q = _question(contents)
        low = q.lower()
        self._wait()
        if 'panne' in low or ('erreur' in low and self.provider == 'gemini'):
            raise ModelError(f'{self.label} (démo) : erreur simulée pour tester l’affichage.')
        if 'long' in low:
            return {'role': 'model', 'parts': [{'text': LONG}]}
        call = lambda name, args: {'role': 'model', 'parts': [{'functionCall': {'name': name, 'args': args,
                                                                               'id': f'toolu_demo{self.step}'}}]}
        if any(w in low for w in ('commune', 'ville', 'département', 'departement')):
            res = _last_result(contents, 'comptes_collectivite')
            if res is None:
                names = [w for w in re.findall(r'\b[A-ZÉÈ][a-zéèêëàâîïôöûüç\-]{3,}', q) if w not in ('Combien', 'Quelle', 'Quelles', 'Quel')]
                level = 'departements' if 'départ' in low or 'depart' in low else 'communes'
                return call('comptes_collectivite', {'nom': names[-1] if names else 'Rennes', 'niveau': level})
            if res.get('error') or res.get('plusieurs'):
                return {'role': 'model', 'parts': [{'text': 'Je n’ai pas trouvé une seule collectivité à ce nom '
                                                             '(démo). Précisez le département ou le code Insee.'}]}
            e = res['entite']
            rows = res.get('montants_eur') or {}
            last = max((y for v in rows.values() for y in v), default='')
            lines = '\n'.join(f'- **{k}** : {_eur(v.get(last))}' for k, v in list(rows.items())[:5])
            per = res.get(f'par_habitant_eur_{last}') or {}
            first = next(iter(per.items()), None)
            return {'role': 'model', 'parts': [{'text': (
                f'En {last}, **{e["nom"]}** ({e["lieu"] or e["niveau"]}) :\n\n{lines}\n\n'
                + (f'Soit {first[1]:,} € par habitant pour « {first[0]} ». '.replace(',', ' ') if first else '')
                + f'Source : OFGL, [carte des comptes locaux]({res.get("page")}).\n\n'
                  '*Réponse de démonstration construite avec les vraies données du site, sans appel à un modèle.*')}]}
        if 'web' in low and _last_result(contents, 'recherche_web') is None:
            return call('recherche_web', {'question': q[:200]})
        search = _last_result(contents, 'rechercher_depenses')
        if search is None and 'web' not in low:
            words = _words(q)
            return call('rechercher_depenses', {'requete': max(words, key=len) if words else 'cantine'})
        web = _last_result(contents, 'recherche_web')
        if web is None:
            return call('recherche_web', {'question': q[:200]})
        parts = []
        if search:
            if search.get('lignes'):
                top = (search.get('beneficiaires_ou_acheteurs') or [{}])[0]
                src = ', '.join(f'{s["source"]} ({_eur(s["montant_eur"])})' for s in search.get('par_source', [])[:3])
                parts.append(f'J’ai trouvé **{search["lignes"]:,} lignes** de dépenses publiées qui contiennent ce mot : {src}.'
                             .replace(',', ' ', 1))
                if top.get('nom'):
                    parts.append(f'- Premier bénéficiaire ou acheteur : **{top["nom"]}** ({_eur(top.get("montant_eur"))})')
                parts.append(f'- Le détail ligne par ligne : [recherche sur le site]({search.get("page")})')
            else:
                parts.append('Aucune ligne publiée ne contient ce mot.')
        parts.append(f'Sur le web : {web.get("answer", "")}')
        parts.append('*Réponse de démonstration : les chiffres viennent des vraies données du site, le texte et la '
                     'recherche web sont simulés.*')
        return {'role': 'model', 'parts': [{'text': '\n\n'.join(parts)}]}

    def web_search(self, question: str) -> dict:
        self._wait(1.5, 2.8)
        return {'answer': 'résultat simulé, aucune page n’a été consultée.',
                'sources': [{'title': 'ccomptes.fr', 'url': 'https://www.ccomptes.fr/'},
                            {'title': 'insee.fr', 'url': 'https://www.insee.fr/'}],
                'requetes': [question[:80]] if self.provider == 'gemini' else []}


class FakeGemini(FakeClient):
    provider, label = 'gemini', 'Gemini'


class FakeClaude(FakeClient):
    provider, label = 'claude', 'Claude'


FAKE_CLIENTS = {'gemini': FakeGemini, 'claude': FakeClaude}


def install() -> None:
    """Replaces the real providers by the fake ones in this process (the API's --fake flag)."""
    from . import providers
    providers.CLIENTS.update(FAKE_CLIENTS)


def _demo() -> None:  # python -m assistant.fake "question" (from server/)
    import sys
    from .agent import answer
    install()
    print(json.dumps(answer([{'role': 'user', 'text': ' '.join(sys.argv[1:]) or 'vidéoprotection'}],
                            on_event=print), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    _demo()
