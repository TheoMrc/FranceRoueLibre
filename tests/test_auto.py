"""Answers without a model (fiche.py, intents.py, personnes.py): the questions readers asked on the evening of
2026-11-09, when a one-hour video sent a crowd to the site. Follow-ups that name a new commune, a postal code or a SIREN
are answered from the data; questions about one commune that the data covers entirely too; anything more precise goes
to the model."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))

from assistant import settings as S  # noqa: E402

HAS_DATA = (S.DATA_DIR / 'web' / 'communes-lookup.json').is_file()
HAS_INDEX = (S.DATA_DIR / 'search' / 'frl-search.sqlite3').is_file()
HAS_ELUS = (S.DATA_DIR / 'elus' / 'personnes.json').is_file()


def convo(*texts):
    """A conversation: user, assistant, user, … ending with the user's last message."""
    out = []
    for i, t in enumerate(texts):
        out.append({'role': 'user' if i % 2 == 0 else 'assistant', 'text': t})
    return out


@unittest.skipUnless(HAS_DATA and HAS_INDEX, 'dist/data absent')
class FollowUpTest(unittest.TestCase):
    """A new commune, postal code or SIREN in a conversation: the data answers, not the model."""

    def setUp(self):
        from assistant import fiche
        self.F = fiche

    def ask(self, *texts):
        return self.F.answer(convo(*texts))

    def test_new_place_alone(self):
        before = ('Quelles sont les informations disponibles sur les dépenses de Pau (64) ?', '**Pau** · …')
        for q, name in (('Tarbes', 'Tarbes'), ('94450', 'Limeil-Brévannes'), ('Evreux', 'Évreux'), ('gros morne', 'Gros-Morne'),
                        ('saint amour 39160', 'Saint-Amour'), ('Argent public a Sauville 88140', None), ('et montbeliard', 'Montbéliard'),
                        ('la ville de Carquefou', 'Carquefou')):
            r = self.ask(*before, q)
            if name is None:
                continue
            self.assertIsNotNone(r, q)
            self.assertEqual(r['provider'], 'faq', q)
            self.assertIn(name, r['reply'], q)

    def test_not_a_place(self):
        before = ('Quelles sont les informations disponibles sur les dépenses d’Angers (49) ?', '**Angers** · …')
        for q in ('culture', 'Direction', 'oui', '25', 'la carte ne fonctionne plus', 'Fourcassier', 'De mon8',
                  'assiciation', 'je comprend pas que ca coute aussi chere', 'Combien coute le minitre éducation'):
            self.assertIsNone(self.ask(*before, q), q)

    def test_a_word_of_the_accounts_about_the_commune_of_the_conversation(self):
        r = self.ask('Quelles sont les informations disponibles sur les dépenses d’Angers (49) ?', '**Angers** · …', 'recette')
        self.assertEqual(r['saved'], 'commune-recettes')
        self.assertIn('Angers', r['reply'])

    def test_same_question_for_another_commune(self):
        r = self.ask('Quelle est la dette de la commune de Cannes ?', '…', 'et vallauris?')
        self.assertEqual(r['saved'], 'commune-dette')
        self.assertIn('Vallauris', r['reply'])
        r = self.ask('Combien la Ville de Dijon a-t-elle dépensé en frais de personnel depuis 2018 ?', '…', 'Et Orléans ?')
        self.assertEqual(r['saved'], 'commune-personnel')
        self.assertIn('Orléans', r['reply'])

    def test_siren_any_turn(self):
        r = self.ask('Bonjour', 'Bonjour', '433122397')
        self.assertEqual(r['saved'], 'siren')

    def test_saved_answer_when_the_follow_up_stands_alone(self):
        r = self.ask('Combien coûte Lyon ?', '…', 'Combien nous a coûté Bruno Le Maire ?')
        self.assertEqual(r['saved'], 'dette-le-maire')
        self.assertIsNone(self.ask('Bonjour', '…', 'Et la dette sous Bruno Le Maire, combien ?'), 'refers to the conversation')
        r = self.ask('Quelles sont les informations disponibles sur les dépenses de Chelles (77) ?', '…',
                     'quelles aides  aux associations spoerrtives')
        self.assertTrue(r is None or r.get('saved') != 'associations', 'not the national list for a question about Chelles')

    def test_national_or_ranking_questions_keep_away_from_the_commune_of_the_conversation(self):
        before = ('Quelles sont les informations disponibles sur les dépenses de Houilles (78) ?', '…')
        for q in ("quelle ville n'est pas endettée?", 'Combien coûte le budget de l’État par habitant en 2024 ?',
                  'Même question pour les ministres', 'Qu’est ce qui coute le plus cher dans la commune',
                  'Quels sont les marchés publics obtenus par Le Pont ?'):
            r = self.ask(*before, q)
            self.assertTrue(r is None or not str(r.get('saved', '')).startswith(('commune-', 'lieu')), q)

    def test_context_commune_for_a_question_without_place(self):
        r = self.ask('Quelles sont les informations disponibles sur les dépenses de Houilles (78) ?', '…', 'Dette par habitant')
        self.assertEqual(r['saved'], 'commune-dette')
        self.assertIn('Houilles', r['reply'])


@unittest.skipUnless(HAS_DATA and HAS_INDEX, 'dist/data absent')
class CommuneIntentTest(unittest.TestCase):
    """« Quelle est la dette de Laz ? », « Comment Pau se compare-t-elle… » : answered from the data when every word is
    understood; « les feux d'artifice à Nancy » goes to the model."""

    def setUp(self):
        from assistant import fiche
        self.F = fiche

    def ask(self, q):
        return self.F.answer([{'role': 'user', 'text': q}])

    def test_answered(self):
        cases = {
            'Quelle est la dette de la commune de laz': ('commune-dette', 'Laz'),
            'EST CE QUE LA VILLE DE NANCY EST ENDETTEE ?': ('commune-dette', 'Nancy'),
            'endettement de la ville de rennes': ('commune-dette', 'Rennes'),
            'cout de la dette publique à Gordes 84 220 par habitant': ('commune-dette', 'Gordes'),
            'Quelle est la santé financière de Pau ?': ('commune-sante', 'Pau'),
            'Indique moi ls finances de saint renan': ('commune-sante', 'Saint-Renan'),
            'Combien la Ville de Dijon a-t-elle dépensé en frais de personnel depuis 2018 ?': ('commune-personnel', 'Dijon'),
            'Quels marchés publics la commune de Houilles a-t-elle passés ?': ('commune-marches', 'Houilles'),
            'Quelles associations de Montigny-Le-Bretonneux reçoivent le plus de subventions de l’État ?': ('commune-associations', 'Montigny'),
            "combien coute le maire d'annecy": ('commune-elus', 'Annecy'),
            'Comment la commune de Houilles se compare-t-elle aux communes de même taille ?': ('commune-compare', 'Houilles'),
        }
        for q, (saved, name) in cases.items():
            r = self.ask(q)
            self.assertIsNotNone(r, q)
            self.assertEqual(r['saved'], saved, q)
            self.assertIn(name, r['reply'], q)
            self.assertEqual(r['provider'], 'faq')
            self.assertNotIn('—', r['reply'])

    def test_a_place_alone_still_answered(self):
        for q in ('bréhat', 'Tarbes', '33980'):
            self.assertEqual(self.ask(q)['saved'], 'lieu', q)

    def test_more_precise_goes_to_the_model(self):
        for q in ("Combien la mairie de Saint amarin dépense-t-elle dans l'enlèvement des ordures",
                  'quel budget pour la communication de la mairie de Dijon depuis 10 ans', "COUT DES FEUX D'ARTIFICE A NANCY ,",
                  'Combien coûte la cantine à Audenge ?', 'Combien nous a coûté Bruno Le Maire ?',
                  "quel est la plus grande dépense d'orléans en 2026", 'Quels sont les marchés publics obtenus par Le Pont ?',
                  'Comment la commune de Franconville se compare-t-elle aux communes de même taille ?'):   # two Franconville
            r = self.ask(q)
            self.assertTrue(r is None or not str(r.get('saved', '')).startswith('commune-'), q)

    def test_contracts_siren_of_a_commune(self):
        from assistant import intents
        self.assertEqual(intents._siren_prefix('78311'), '21780311')
        self.assertEqual(intents._siren_prefix('29019'), '21290019')
        self.assertEqual(intents._siren_prefix('97120'), '21971120')
        self.assertEqual(intents._siren_prefix('97209'), '21972209')
        self.assertEqual(intents._siren_prefix('2A004'), '21200004')

    def test_saved_answer_not_hijacked_by_a_mayor(self):
        from assistant import faq
        self.assertIsNone(faq.find([{'role': 'user', 'text': "combien coute le maire d'annecy"}]))
        self.assertIsNotNone(faq.find([{'role': 'user', 'text': 'Combien nous a coûté Bruno Le Maire ?'}]))


@unittest.skipUnless(HAS_ELUS and HAS_DATA, 'dist/data/elus absent (scripts/elus-data.py)')
class PersonTest(unittest.TestCase):
    """Public figures: who they are and what the law sets for their functions; never a guess."""

    def setUp(self):
        from assistant import personnes
        self.P = personnes

    def test_answered(self):
        r = self.P.answer('Combien nous coute Gérard Larcher')
        self.assertIsNotNone(r)
        self.assertIn('Sénateur', r['reply'])
        self.assertIn('ne suit pas les revenus', r['reply'])
        r = self.P.answer('Salaire Gérard larche')   # typo
        self.assertIn('Gérard Larcher', r['reply'])
        r = self.P.answer('Combien gagne le maire stéphane roudaut à brest')
        self.assertIn('Brest', r['reply'])
        self.assertIn('brut par mois', r['reply'])
        r = self.P.answer("Combien d'argent public reçoit ou dépense « Yael braun pivet » ?")
        self.assertIn('Braun-Pivet', r['reply'])

    def test_a_typo_is_not_another_person(self):
        r = self.P.answer('combien nous a coûté Emmanuel Macron')
        self.assertTrue(r is None or 'Macron' in r['reply'], 'never another Emmanuel (Mandon)')
        self.assertFalse(self.P._close('emmanuel mandon', 'emmanuel macron'))
        self.assertTrue(self.P._close('gerard larcher', 'gerard larche'))
        self.assertTrue(self.P._close('yael braun pivet', 'yaelle braun pivet'))
        self.assertTrue(self.P._close('laurent nunez', 'laurent nune'))

    def test_mayor_in_the_commune_dossier(self):
        from assistant import tools as T
        d = T.dossier_commune('insee:97220')     # Rivière-Pilote: the Loupe once named the wrong mayor
        self.assertIn('Beaunol', d['elus_et_personnel']['maire'])

    def test_not_answered(self):
        for q in ('montant retraite dominique de villepin', 'nagui salaire', 'Que ne déclare pas les députés',
                  'combien coute le maire', 'Combien coûte la cantine du Sénat ?'):
            self.assertIsNone(self.P.answer(q), q)

    def test_cards(self):
        cards = self.P.cards('gérard larcher')
        self.assertEqual(cards[0]['nom'], 'Gérard Larcher')
        self.assertEqual(self.P.cards('croix rouge'), [])


if __name__ == '__main__':
    unittest.main()
