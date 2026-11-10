"""Tests of the AI assistant without any network call: python -m unittest tests/test_assistant.py"""
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
os.environ['ASSISTANT_ENV_FILE'] = os.devnull  # never read the real keys in tests

from assistant import budget as B  # noqa: E402
from assistant import providers as P  # noqa: E402
from assistant import settings as S  # noqa: E402
from assistant import tools as T  # noqa: E402


class BudgetTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.ledger = Path(self.dir.name) / 'spend.jsonl'

    def tearDown(self):
        self.dir.cleanup()

    def make(self, claude=1.0, gemini=1.0, until=None, daily=0):
        return B.Budget(self.ledger, {'claude': (claude, None), 'gemini': (gemini, until)}, daily)

    def test_prices(self):
        self.assertAlmostEqual(B.cost_usd('gemini', 'gemini-3.8-flash', prompt=1e6, output=1e6), 4.5)
        self.assertAlmostEqual(B.cost_usd('claude', 'claude-haiku-5-5', prompt=1e5, output=0), 0.01)
        # above 100 000 prompt tokens, Haiku 5.5 costs five times more
        self.assertAlmostEqual(B.cost_usd('claude', 'claude-haiku-5-5', prompt=200_000), 0.10)
        self.assertAlmostEqual(B.cost_usd('claude', 'claude-haiku-5-5', searches=2), 0.02)
        with self.assertRaises(B.BudgetError):
            B.cost_usd('claude', 'claude-unknown-model', prompt=1)

    def test_cap_includes_reservations_and_survives_restart(self):
        b = self.make(claude=1.0)
        r1 = b.reserve('claude', 0.6)
        with self.assertRaises(B.BudgetError):
            b.reserve('claude', 0.5)  # 0.6 in flight + 0.5 > 1.0
        b.settle('claude', r1, 0.7, model='claude-haiku-5-5')
        with self.assertRaises(B.BudgetError):
            b.reserve('claude', 0.31)
        b2 = self.make(claude=1.0)  # restart: read back from the ledger
        self.assertAlmostEqual(b2.spent['claude'], 0.7)
        self.assertIsNotNone(b2.refusal('claude', 0.31))
        self.assertIsNone(b2.refusal('gemini'))

    def test_end_date(self):
        b = self.make(until=B.today() - dt.timedelta(days=1))
        self.assertIn('période terminée', b.refusal('gemini'))
        b = self.make(until=B.today())  # the last day is included
        self.assertIsNone(b.refusal('gemini'))

    def test_daily_cap_counts_both_providers(self):
        b = self.make(claude=10, gemini=10, daily=1.0)
        b.settle('gemini', b.reserve('gemini', 0.5), 0.8)
        with self.assertRaises(B.BudgetError):
            b.reserve('claude', 0.3)

    def test_defaults_match_the_request(self):
        self.assertEqual((S.CLAUDE_BUDGET_EUR, S.GEMINI_BUDGET_EUR), (50, 100))
        self.assertEqual(S.GEMINI_UNTIL, dt.date(2026, 11, 17))


class ClaudeFormatTest(unittest.TestCase):
    def test_round_trip_of_a_tool_call(self):
        contents = [
            {'role': 'user', 'parts': [{'text': 'question'}]},
            {'role': 'model', 'parts': [{'functionCall': {'name': 'requete_sql', 'args': {'sql': 'select 1'}, 'id': 'toolu_1'}}]},
            {'role': 'user', 'parts': [{'functionResponse': {'name': 'requete_sql', 'id': 'toolu_1', 'response': {'result': {'x': 1}}}},
                                       {'text': 'Dernière étape'}]},
        ]
        msgs = P.to_messages(contents)
        self.assertEqual([m['role'] for m in msgs], ['user', 'assistant', 'user'])
        self.assertEqual(msgs[1]['content'][0]['type'], 'tool_use')
        self.assertEqual(msgs[2]['content'][0]['type'], 'tool_result')
        self.assertEqual(msgs[2]['content'][0]['tool_use_id'], 'toolu_1')
        tools = P.to_tools(T.DECLARATIONS)
        self.assertEqual(tools[0]['input_schema']['type'], 'object')
        self.assertEqual(tools[0]['input_schema']['properties']['requete']['type'], 'string')


class SqlSandboxTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        db = Path(cls.dir.name) / 's.sqlite3'
        con = sqlite3.connect(db)
        con.execute('CREATE TABLE doc (id INTEGER PRIMARY KEY, src INTEGER, year INTEGER, amount REAL, title TEXT)')
        con.execute("CREATE VIRTUAL TABLE fts USING fts5(title, content='doc', content_rowid='id')")
        con.executemany('INSERT INTO doc VALUES (?, ?, ?, ?, ?)', [(1, 2, 2024, 100.0, 'vidéoprotection mairie'),
                                                                   (2, 1, 2023, 50.0, 'association sportive')])
        con.execute("INSERT INTO fts(fts) VALUES ('rebuild')")
        con.commit()
        con.close()
        cls.old = S.SEARCH_DB
        S.SEARCH_DB = db
        T._sql_db = None

    @classmethod
    def tearDownClass(cls):
        if T._sql_db is not None:
            T._sql_db.close()
        T._sql_db = None
        S.SEARCH_DB = cls.old
        cls.dir.cleanup()

    def test_select_and_fts(self):
        r = T.requete_sql('SELECT src, sum(amount) FROM doc GROUP BY src ORDER BY src')
        self.assertEqual(r['lignes'], [[1, 50.0], [2, 100.0]])
        r = T.requete_sql("SELECT doc.title FROM fts JOIN doc ON doc.id = fts.rowid WHERE fts MATCH 'videoprot*'")
        self.assertEqual(r.get('error'), None, r)

    def test_everything_else_is_refused(self):
        for sql in ['DELETE FROM doc', 'PRAGMA table_info(doc)', "ATTACH DATABASE 'x.db' AS x",
                    'SELECT 1; DELETE FROM doc', "SELECT load_extension('x')", 'CREATE TABLE t (x)',
                    'WITH x AS (SELECT 1) DELETE FROM doc']:
            self.assertIn('error', T.requete_sql(sql), sql)
        self.assertEqual(T.requete_sql('SELECT count(*) FROM doc')['lignes'], [[2]])


class DataFilesTest(unittest.TestCase):
    def test_only_listed_files(self):
        for bad in ['../../.env', '/etc/passwd', 'search/meta.json', 'C:/Windows/win.ini', 'local/../../../.env']:
            self.assertIn('error', T.lire_donnees(bad), bad)

    def test_listed_files_exist(self):
        if not (S.DATA_DIR / 'catalog.json').is_file():
            self.skipTest('dist/data absent')
        missing = [f for f in T.FILES if not (S.DATA_DIR / f).is_file()]
        self.assertEqual(missing, [])
        r = T.lire_donnees('catalog.json', 'sources', 'insee', 0, 3)
        self.assertTrue(r['elements'])

    def test_clip(self):
        r = T.clip(list(range(10000)), 200)
        self.assertLess(len(json.dumps(r, ensure_ascii=False)), 400)



class SirenAnswerTest(unittest.TestCase):
    """« Combien d'argent public reçoit ou dépense « SIREN » ? » is answered from the published lines, without a model."""

    def ask(self, q):
        from assistant import fiche
        return fiche.answer([{'role': 'user', 'text': q}])

    def test_patterns(self):
        from assistant import fiche
        for q in ("Combien d'argent public reçoit ou dépense « 433122397 » ?", '433122397', '433 122 397', 'SIREN 433122397',
                  "Combien d’argent public reçoit « 433122397 » ?"):
            self.assertEqual(fiche.siren_of(q), '433122397', q)
        for q in ('Combien reçoit la Croix-Rouge ?', '4331223970', "Combien d'argent public reçoit ou dépense « LVMH » ?"):
            self.assertIsNone(fiche.siren_of(q), q)

    @unittest.skipUnless((S.DATA_DIR / 'search' / 'frl-search.sqlite3').is_file(), 'index de recherche absent')
    def test_answer(self):
        r = self.ask("Combien d'argent public reçoit ou dépense « 433122397 » ?")
        self.assertEqual(r['provider'], 'faq')
        self.assertIn('31\u202f156 €', r['reply'])
        self.assertIn('2023 : 7\u202f164 €', r['reply'])
        self.assertIn('2010 à 2021 et 2023', r['reply'])
        self.assertIsNone(self.ask('999999999'))  # placeholder of bodies without a SIREN: the model explains
        self.assertIsNone(self.ask('100000009'))  # nothing published: the model explains
        self.assertEqual(fiche_two_turns()['saved'], 'siren', 'a SIREN in a follow-up is answered from the data too')


def fiche_two_turns():
    from assistant import fiche
    return fiche.answer([{'role': 'user', 'text': 'Bonjour'}, {'role': 'assistant', 'text': 'Bonjour'},
                         {'role': 'user', 'text': '433122397'}])


class FakeAndFallbackTest(unittest.TestCase):
    """The fake models (assistant_api.py --fake) go through the real loop; in « Auto » a failing model hands over."""
    def setUp(self):
        from assistant import agent, fake, providers
        self.saved = dict(providers.CLIENTS)
        fake.install()
        fake.FakeClient._wait = lambda self, lo=0, hi=0: None
        self.agent = agent
        self.dir = tempfile.TemporaryDirectory()
        B._budget = B.Budget(Path(self.dir.name) / 'spend.jsonl', {'claude': (1, None), 'gemini': (1, None)}, 0)

    def tearDown(self):
        from assistant import providers
        providers.CLIENTS.update(self.saved)
        B._budget = None
        self.dir.cleanup()

    def ask(self, q, provider=None):
        events = []
        return self.agent.answer([{'role': 'user', 'text': q}], provider, on_event=events.append), events

    def test_switch_to_the_next_model(self):
        from assistant import settings as S_
        keep, S_.ORDER = S_.ORDER, ['gemini', 'claude']   # the fake Gemini fails, Claude takes over
        try:
            r, events = self.ask('test erreur')
        finally:
            S_.ORDER = keep
        self.assertEqual(r.get('provider'), 'claude', r)
        self.assertTrue(r.get('reply'))
        self.assertIn('switch', [e['type'] for e in events])

    def test_chosen_model_does_not_hand_over(self):
        r, events = self.ask('test erreur', 'gemini')
        self.assertIn('error', r)
        self.assertNotIn('switch', [e['type'] for e in events])

    def test_both_down(self):
        r, _ = self.ask('panne totale')
        self.assertIn('error', r)
        self.assertNotIn('retry', r)

    def test_web_scenario(self):
        r, events = self.ask('recherche web sur la dette')
        self.assertTrue(r['sources'])
        self.assertIn('tool_start', [e['type'] for e in events])


class QueueTest(unittest.TestCase):
    """Waiting line, shedding and the no-credits answer of assistant_api.py (no model is called)."""

    def setUp(self):
        import assistant_api as A
        self.A = A
        self.saved = (S.QUEUE_MAX, S.QUEUE_WAIT, S.ABANDON, S.MAX_JOBS, A.run_job, A.credits_info)
        A.JOBS.clear(); A.QUEUE.clear(); A.HITS.clear(); A.DAY.update(day='', n=0)
        self.gate = __import__('threading').Event()
        self.ran = []

        def fake_run(job, messages, provider, form=None):
            self.ran.append(messages[-1]['text'])
            self.gate.wait(5)
            job.update(result={'reply': 'ok'}, done=True)
        A.run_job = fake_run

    def tearDown(self):
        self.gate.set()
        S.QUEUE_MAX, S.QUEUE_WAIT, S.ABANDON, S.MAX_JOBS, self.A.run_job, self.A.credits_info = self.saved
        self.A.QUEUE.clear()

    def ask(self, text, ip):
        return self.A.enqueue(ip, [{'role': 'user', 'text': text}], None)

    def wait_until(self, cond):
        import time
        for _ in range(200):
            if cond():
                return True
            time.sleep(0.01)
        return False

    def test_places_and_shedding(self):
        A = self.A
        S.MAX_JOBS, S.QUEUE_MAX = max(len(A.WORKERS), 1), 2
        busy = [self.ask(f'q{i}', f'10.0.0.{i}') for i in range(len(A.WORKERS) or 1)]
        self.assertTrue(self.wait_until(lambda: len(self.ran) == len(busy)))
        a, b = self.ask('a', '10.1.0.1'), self.ask('b', '10.1.0.2')
        self.assertEqual((A.place(a), A.place(b)), (1, 2))
        self.assertEqual(A.admit('10.1.0.3'), A.BUSY)          # queue full: refused at once
        A.QUEUE.pop()                                          # a place frees up
        self.assertIsNone(A.admit('10.1.0.4'))
        self.gate.set()
        self.assertTrue(self.wait_until(lambda: A.JOBS[a]['done']))

    def test_abandoned_and_stale_jobs_are_dropped(self):
        A = self.A
        S.MAX_JOBS = max(len(A.WORKERS), 1)
        self.gate.set()
        old = self.ask('gone', '10.2.0.1')
        A.JOBS[old]['seen'] -= S.ABANDON + 1
        self.assertTrue(self.wait_until(lambda: A.JOBS[old]['done']))
        self.assertNotIn('gone', self.ran)
        late = self.ask('late', '10.2.0.2')
        A.JOBS[late].update(t=A.JOBS[late]['t'] - S.QUEUE_WAIT - 1)
        self.assertTrue(self.wait_until(lambda: A.JOBS[late]['done']))
        self.assertTrue(A.JOBS[late]['result'].get('busy'))

    def test_no_credits(self):
        A = self.A
        A.credits_info = lambda: {'credits': False, 'error': 'plus de crédits', 'donate': S.DONATE_URL}
        st = A.status()
        self.assertFalse(st['credits'])
        self.assertEqual(st['credits_message'], 'plus de crédits')
        self.assertIn('tipeee', st['donate'])

if __name__ == '__main__':
    unittest.main()


class FraudAndNichesTest(unittest.TestCase):
    """dist/data/fraude.json (scripts/fraude-data.py) and the niches sorted by amount and by target."""

    def test_fraud_file_adds_up(self):
        d = json.loads((ROOT / 'dist' / 'data' / 'fraude.json').read_text(encoding='utf-8'))
        c = d['controle']
        for i in range(len(c['annees'])):
            self.assertAlmostEqual(c['droits_rectifies'][i] + c['penalites_interets'][i], c['resultats_totaux'][i], delta=.03)
        v = d['ecart_tva_commission']
        self.assertEqual(len(v['annees']), len(v['ecart_meur']))
        self.assertTrue(all(e['avis_cour'] for e in d['estimations_ecart_global']))

    def test_niches_by_amount_and_target(self):
        from assistant import outils as O
        r = O.chercher_fiche('niches', '', tri='montant', cible='entreprises')
        costs = [x['cout_meur']['2026'] or 0 for x in r['resultats']]
        self.assertEqual(costs, sorted(costs, reverse=True))
        self.assertTrue(all(x['cible'] == 'entreprises' for x in r['resultats']))
        self.assertIn('total_meur', r)
        self.assertIn('recherche', r['resultats'][0]['mesure'].lower(), 'the research tax credit is the largest')


class DirectoryTest(unittest.TestCase):
    def test_closest_name_first(self):
        """FRL-2026-0001 went to the « Conseil départemental d'accès au droit » instead of the département."""
        from assistant import demandes as D
        keep = D.get_json
        D.get_json = lambda url, timeout=15: (200, {'results': [
            {'nom': "Conseil départemental d'accès au droit de Gironde", 'adresse_courriel': 'a@example.org'},
            {'nom': 'Conseil départemental de la Gironde', 'adresse_courriel': 'b@example.org'}]}, None)
        try:
            self.assertEqual(D.annuaire(nom='Conseil départemental de Gironde')[0]['nom'], 'Conseil départemental de la Gironde')
        finally:
            D.get_json = keep

    def test_body_before_its_local_offices(self):
        """The Vaulx-en-Velin canteen request went to « Maison de la Métropole de Lyon - Limonest », a local office."""
        from assistant import demandes as D
        keep = D.get_json
        office = lambda town: {'nom': f'Maison de la Métropole de Lyon - {town}', 'adresse_courriel': 'mdm@example.org',
                               'pivot': '[{"type_service_local": "mda"}]'}
        D.get_json = lambda url, timeout=15: (200, {'results': [office('Limonest'), office('Bron'), {
            'nom': 'Métropole de Lyon - Rhône', 'formulaire_contact': 'https://example.org/contact',
            'pivot': '[{"type_service_local": "epci"}]'}]}, None)
        try:
            self.assertEqual(D.annuaire(nom='Métropole de Lyon')[0]['nom'], 'Métropole de Lyon - Rhône')
            r = D.prepare('Métropole de Lyon', objet='coût de la restauration des collèges', documents='budget')
            self.assertEqual(r['demande']['destinataire'], 'Métropole de Lyon - Rhône', 'not an office that has an e-mail')
            self.assertEqual(r['demande']['formulaire'], 'https://example.org/contact')
        finally:
            D.get_json = keep


class SignatureTest(unittest.TestCase):
    def test_signed_letter_has_logo_and_one_signature(self):
        from assistant import demandes as D
        subject, body = D.letter('Mairie', {'objet': 'x', 'documents': 'a', 'contexte': ''}, 'FRL-2026-0009')
        m = D._message('a@example.org', subject, body + '\n\nFranceRoueLibre\nstonks@francerouelibre.fr', 'FRL-2026-0009', signed=True)
        types = [p.get_content_type() for p in m.walk()]
        self.assertEqual(types, ['multipart/alternative', 'text/plain', 'multipart/related', 'text/html', 'image/png'])
        plain = m.get_body(('plain',)).get_content()
        self.assertEqual(plain.count('stonks@francerouelibre.fr'), 1, 'the old typed signature is not repeated')
        self.assertIn('cid:', m.get_body(('html',)).get_content())


class CompareShareTest(unittest.TestCase):
    def test_share_against_same_size_communes(self):
        """« 65,8 % de frais de personnel, est-ce beaucoup ? » (journal du 3 novembre) : la part, sa médiane, son rang."""
        from assistant import outils as O
        r = O.comparer('Meaux', 'frais-de-personnel', 'communes', 'depenses-de-fonctionnement')
        self.assertIn('part_pct', r)
        self.assertTrue(0 < r['mediane_pct'] < 100 and r['quartiles_pct'][0] <= r['mediane_pct'] <= r['quartiles_pct'][1])

    def test_several_paths_in_one_read(self):
        from assistant import tools as T
        r = T.lire_donnees('fraude.json', 'recouvre, moyens')
        self.assertEqual(sorted(r['parties']), ['moyens', 'recouvre'])


class SavedAnswersTest(unittest.TestCase):
    """faq.json (scripts/loupe-faq.py): frequent questions answered without a model call."""

    def test_le_maire_debt_question_is_saved(self):
        from assistant import faq
        hit = faq.find([{'role': 'user', 'text': 'De combien a augmenté la dette sous le mandat de Bruno Le Maire ?'}])
        self.assertIsNotNone(hit)
        res = faq.result(hit)
        self.assertEqual(res['provider'], 'faq')
        self.assertIn('Md€', res['reply'])
        self.assertTrue(all(s['url'].startswith('https://www.insee.fr/') for s in res['sources']))
        d = hit['data']
        self.assertGreater(d['debt'][1], d['debt'][0])

    def test_variants_and_non_matches(self):
        from assistant import faq
        ask = lambda t: faq.find([{'role': 'user', 'text': t}])
        self.assertIsNotNone(ask('dette publique pendant que Lemaire était à Bercy, la hausse ?'))
        self.assertIsNotNone(ask('Combien nous a coûté Bruno Le Maire ?'), 'example question of the Loupe panel')
        self.assertIsNone(ask('Combien coûte la mairie de Lyon ?'))
        self.assertIsNone(ask('Bruno Le Maire, quel salaire ?'))
        # a narrower question than the saved answer goes to the model (journal of 2026-11-03)
        self.assertIsNone(ask('Quel est le budget des associations finances par l education nationale ?'))
        self.assertIsNone(ask('Toutes les subventions reçues par l association "article 1 " depuis 2017'))
        self.assertIsNone(ask('Subventions de l association Article 1'))
        self.assertIsNotNone(ask('Quelles sont les associations les plus financées par l’État'))
        follow = [{'role': 'user', 'text': 'Bonjour'}, {'role': 'assistant', 'text': '…'},
                  {'role': 'user', 'text': 'Et la dette sous Bruno Le Maire, combien ?'}]
        self.assertIsNone(faq.find(follow), 'a follow-up goes to the model, which has the context')


class JournalTest(unittest.TestCase):
    """Journal of the answers (server/assistant/journal.py) and its review (scripts/loupe-review.py)."""

    def setUp(self):
        import tempfile
        self.dir = Path(tempfile.mkdtemp())

    def test_answer_and_vote_lines_without_ip(self):
        from assistant import journal
        who = journal.reader('203.0.113.9')
        self.assertEqual(who, journal.reader('203.0.113.9'), 'same reader, same day, same value')
        self.assertNotIn('203.0.113', who)
        events = [{'type': 'tool_start', 'name': 'rechercher_depenses', 'label': 'Recherche « piscine »'},
                  {'type': 'tool_done', 'name': 'rechercher_depenses', 'label': 'Recherche « piscine »', 'ok': True, 'summary': '12 ligne(s)', 's': .4}]
        entry = journal.answer_entry('JOBID123456789', who, [{'role': 'user', 'text': 'Combien coûtent les piscines ?'}], events,
                                     {'reply': 'Environ…', 'provider': 'gemini', 'model': 'm', 'cost_eur': .002}, 3.2)
        journal.write(self.dir, entry)
        journal.write(self.dir, journal.vote_entry('JOBID123456789', who, -1))
        rows = [json.loads(l) for l in (self.dir / 'journal').glob('*.jsonl').__next__().read_text().splitlines()]
        self.assertEqual([r['type'] for r in rows], ['answer', 'vote'])
        self.assertEqual(rows[0]['tools'][0]['summary'], '12 ligne(s)')
        self.assertNotIn('203.0.113.9', json.dumps(rows))

    def test_sweep_gzips_and_deletes(self):
        import datetime as dt, gzip
        from assistant import journal
        d = self.dir / 'journal'; d.mkdir()
        today = dt.date.today()
        (d / f'{today - dt.timedelta(days=1)}.jsonl').write_text('{"type":"answer"}\n')
        (d / f'{today - dt.timedelta(days=journal.RETENTION_DAYS + 2)}.jsonl.gz').write_bytes(gzip.compress(b'{}\n'))
        journal.sweep(self.dir, today)
        names = sorted(p.name for p in d.iterdir())
        self.assertEqual(names, [f'{today - dt.timedelta(days=1)}.jsonl.gz'])

    def test_review_groups_questions(self):
        import importlib.util
        from assistant import journal
        for i, q in enumerate(['Combien coûtent les fonctionnaires ?', 'les fonctionnaires coûtent combien', 'Prix des piscines']):
            journal.write(self.dir, journal.answer_entry(f'J{i:011d}', 'r', [{'role': 'user', 'text': q}], [], {'reply': 'x', 'cost_eur': .01}, 1))
        spec = importlib.util.spec_from_file_location('review', ROOT / 'scripts' / 'loupe-review.py')
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        r = mod.review(self.dir / 'journal')
        self.assertEqual(len(r['top'][0]), 2, 'same words in another order: one group')
        self.assertIn('fonctionnaires', mod.report(r))


class ExamplesAreSavedTest(unittest.TestCase):
    """Every example question shown in the Loupe panel is answered from faq.json, without spending credits."""

    def test_examples_match_a_saved_answer(self):
        import re
        from assistant import faq
        js = (ROOT / 'dist' / 'assistant.js').read_text(encoding='utf-8')
        examples = re.findall(r"^    '([^']+)',", re.search(r'const EXAMPLES = \[(.*?)\];', js, re.S).group(1), re.M)
        self.assertGreaterEqual(len(examples), 3)
        for q in examples:
            self.assertIsNotNone(faq.find([{'role': 'user', 'text': q}]), q)


class CommuneDossierTest(unittest.TestCase):
    """dossier_commune: accounts, State-aided projects, elected officials, signals and mentions in one call."""

    def setUp(self):
        if not (S.DATA_DIR / 'web' / 'projects-2024.json').is_file():
            self.skipTest('dist/data absent')

    def test_by_name_and_code(self):
        r = T.dossier_commune('Hautmont')
        self.assertEqual(r['commune']['code'], '59291')
        self.assertGreater(r['projets_aides_etat']['nombre'], 0)
        self.assertTrue(r['comptes']['montants_eur'])
        self.assertIn('conseillers_municipaux', r['elus_et_personnel'])
        self.assertIn('mentions_dans_les_depenses', r)   # an error message when the index is absent, never an exception
        self.assertEqual(T.dossier_commune('59291')['commune']['nom'], 'Hautmont')
        self.assertEqual(T.dossier_commune('l arbresle')['commune']['code'], '69010')

    def test_homonyms_and_unknown(self):
        self.assertGreater(len(T.dossier_commune('Saint-Denis')['plusieurs']), 1)
        self.assertIn('error', T.dossier_commune('Zzyzx-sur-Rien'))


class SeriesByYearTest(unittest.TestCase):
    def test_lists_aligned_with_years_are_keyed_by_year(self):
        if not (S.DATA_DIR / 'national-functions.json').is_file():
            self.skipTest('dist/data absent')
        r = T.lire_donnees('national-functions.json', 'data.TE.GF1002')
        self.assertIn('2024', r['valeur'])
        r = T.lire_donnees('national-functions.json', 'data.D62')
        self.assertIn('2024', r['valeur']['GF1002'])

    def test_pensions_saved_answer(self):
        from assistant import faq
        hit = faq.find([{'role': 'user', 'text': 'Combien coûtent les retraites ?'}])
        self.assertEqual(hit and hit['id'], 'retraites')
        self.assertIsNone(faq.find([{'role': 'user', 'text': 'Combien de retraités en France ?'}]))
        self.assertNotIn('—', hit['reply'])


class SearchJournalTest(unittest.TestCase):
    """Journal of the searched words (nginx, deploy/vps.sh) and its review (scripts/search-review.py)."""

    def test_review_drops_typing_and_finds_empty_searches(self):
        import importlib.util
        d = Path(tempfile.mkdtemp())
        day = dt.date.today().isoformat()
        rows = [('10:00:00', 'vid', '5'), ('10:00:03', 'vid%C3%A9oprotection', '812'), ('11:00:00', 'Vid%C3%A9oprotection', '812'),
                ('12:00:00', 'zzqx', '0')]
        (d / f'{day}.jsonl').write_text(''.join(json.dumps({'t': f'{day}T{t}+00:00', 'q': q, 'status': 200, 'lines': n}) + '\n'
                                                for t, q, n in rows))
        spec = importlib.util.spec_from_file_location('sreview', ROOT / 'scripts' / 'search-review.py')
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        r = mod.review(d)
        self.assertEqual(r['searches'], 3)
        self.assertEqual(len(r['top'][0]), 2)
        self.assertEqual(r['empty'], [('zzqx', 1)])

    def test_api_sweep(self):
        import gzip
        import search_api
        d = Path(tempfile.mkdtemp())
        today = dt.date.today()
        (d / f'{today - dt.timedelta(days=1)}.jsonl').write_text('{}\n')
        (d / f'{today}.jsonl').write_text('{}\n')
        (d / f'{today - dt.timedelta(days=search_api.JOURNAL_DAYS + 1)}.jsonl.gz').write_bytes(gzip.compress(b'{}\n'))
        search_api.sweep_journal(d, today)
        self.assertEqual(sorted(p.name for p in d.iterdir()), [f'{today - dt.timedelta(days=1)}.jsonl.gz', f'{today}.jsonl'])


class RequestsTest(unittest.TestCase):
    """Requests to public bodies (assistant/demandes.py): official address, fixed polite letter, validation, publication."""

    def setUp(self):
        from assistant import demandes as D
        self.D = D
        self.dir = tempfile.TemporaryDirectory()
        self.old = (S.STATE_DIR, S.MAIL_CONFIGURED, S.MAIL_AUTO_SEND, D.annuaire, D.notify, D.send)
        S.STATE_DIR = Path(self.dir.name)
        self.sent = []
        D.annuaire = lambda code_insee='', nom='': [{'nom': 'Mairie - Hautmont', 'email': 'mairie@mairie-hautmont.fr',
                                                    'formulaire': None, 'site': None, 'fiche': 'https://lannuaire.service-public.gouv.fr/x', 'siret': None}]
        D.notify = lambda subject, body: self.sent.append(subject)

    def tearDown(self):
        S.STATE_DIR, S.MAIL_CONFIGURED, S.MAIL_AUTO_SEND, self.D.annuaire, self.D.notify, self.D.send = self.old
        self.dir.cleanup()

    def draft(self, **kw):
        args = dict(organisme='Mairie de Hautmont', code_insee='59291', objet='coût de la cantine scolaire 2024',
                    documents='Le compte administratif 2024\nLe contrat de restauration scolaire en vigueur',
                    contexte='Les comptes publiés ne détaillent pas la restauration scolaire.')
        args.update(kw)
        return self.D.prepare(**args)

    def test_letter_is_polite_and_addressed_officially(self):
        r = self.draft()
        d = r['demande']
        self.assertEqual(d['email'], 'mairie@mairie-hautmont.fr')
        self.assertIn('L. 300-1', d['texte'])
        self.assertIn('[Votre nom]', d['texte'], 'the reader signs the copy he sends himself')
        self.assertNotIn('—', d['texte'])

    def test_rude_or_shouting_fields_are_refused(self):
        self.assertIn('error', self.draft(contexte='Ces voleurs gaspillent notre argent'))
        self.assertIn('error', self.draft(objet='RÉPONDEZ ENFIN À NOS QUESTIONS'))
        cleaned = self.D.clean('Voir https://x.fr ou écrire à a@b.fr, 06 12 34 56 78 !!!', 200)
        self.assertNotIn('http', cleaned); self.assertNotIn('@', cleaned); self.assertNotIn('06 12', cleaned)

    def test_form_only_body_is_deposited_by_hand(self):
        """Vaulx-en-Velin: the Métropole de Lyon has no address, only a contact form. The reader can still have the
        site deal with it: the team pastes the letter in the form, then marks it deposited, and it is published."""
        S.MAIL_CONFIGURED, S.MAIL_AUTO_SEND = True, True
        self.D.annuaire = lambda code_insee='', nom='': [{'nom': 'Métropole de Lyon - Rhône', 'email': None,
            'formulaire': 'https://www.grandlyon.com/contact', 'site': None, 'fiche': None, 'siret': None}]
        d = self.draft(organisme='Métropole de Lyon', code_insee='')['demande']
        self.assertTrue(d['envoi_par_le_site'] and d['depot_formulaire'])
        r = self.D.request_send(d['id'], 'lecteur')
        self.assertEqual((r['status'], r['mode']), ('a_valider', 'formulaire'), 'never e-mailed, even with auto send')
        self.assertTrue(any('formulaire' in x for x in self.sent), 'the team is told to paste it')
        self.assertIn('error', self.D.send(r['ref']))
        self.assertEqual(self.D.admin('deposee', r['ref'])['status'], 'envoyee')
        self.assertEqual(self.D.published()[0]['canal'], 'formulaire')

    def mail(self, frm, subject, body='Bonjour,\n\nVoici les documents.', **headers):
        from email.message import EmailMessage
        m = EmailMessage(); m['From'] = frm; m['Subject'] = subject
        for k, v in headers.items():
            m[k.replace('_', '-')] = v
        m.set_content(body)
        return m

    def test_own_copies_auto_replies_and_bounces_are_not_replies(self):
        """Gironde and Reims: the Bcc copy of each letter, then the [Loupe] notification quoting it, landed in the
        same mailbox with the reference in the subject and were published as « the administration replied »."""
        S.MAIL_CONFIGURED, S.MAIL_AUTO_SEND = True, False
        D = self.D
        ref = D.request_send(self.draft()['demande']['id'], 'lecteur')['ref']
        D.admin('deposee', ref, 'https://www.hautmont.fr/contact')
        subj = f'Demande de communication de documents administratifs [{ref}]'
        self.assertEqual(D.classify(self.mail(S.MAIL_FROM, subj)), 'own')
        self.assertEqual(D.classify(self.mail('autre@x.fr', f'[Loupe] Réponse à {ref}')), 'own')
        self.assertEqual(D.classify(self.mail('accueil@reims-contact.fr', 'RE: ' + subj, Auto_Submitted='auto-replied')), 'automatique')
        self.assertEqual(D.classify(self.mail('accueil@reims-contact.fr', 'Accusé de réception : ' + subj)), 'automatique')
        self.assertEqual(D.classify(self.mail('noreply@blois.fr', 'RE: ' + subj)), 'automatique')
        self.assertEqual(D.classify(self.mail('MAILER-DAEMON@ovh.net', 'Undelivered Mail: ' + subj)), 'rejet')
        self.assertEqual(D.classify(self.mail('Jeanne Agent <j.agent@hautmont.fr>', 'RE: ' + subj)), 'reponse')
        d = D.load(ref)
        self.assertFalse(D.ingest(d, self.mail(S.MAIL_FROM, subj), 'own'))
        D.ingest(d, self.mail('accueil@hautmont.fr', 'Accusé de réception'), 'automatique')
        d = D.load(ref)
        self.assertEqual((d['status'], len(d['accuses'])), ('envoyee', 1), 'an acknowledgement leaves it waiting')
        self.assertTrue(D.published()[0]['accuse'])
        D.ingest(d, self.mail('j.agent@hautmont.fr', 'RE: ' + subj), 'reponse')
        self.assertEqual(D.load(ref)['status'], 'repondue')

    def test_old_copies_taken_for_replies_are_removed(self):
        S.MAIL_CONFIGURED, S.MAIL_AUTO_SEND = True, False
        D = self.D
        ref = D.request_send(self.draft()['demande']['id'], 'lecteur')['ref']
        D.admin('deposee', ref, 'https://www.hautmont.fr/contact')
        d = D.load(ref)
        d['status'] = 'repondue'
        d['replies'] = [{'date': '2026-11-04T00:09:48', 'from_domain': S.MAIL_FROM.split('@')[-1], 'text': 'Madame, Monsieur,',
                         'files': [], 'public_text': None}]
        D.save(d)
        self.assertEqual(D.repair_own_replies(), 1)
        d = D.load(ref)
        self.assertEqual((d['status'], d['replies']), ('envoyee', []))
        self.assertEqual(D.repair_own_replies(), 0, 'done once')

    def test_request_sent_by_hand_through_a_form_is_followed_with_its_link(self):
        """Lycée Jacques Cartier: the Région Bretagne has no address in the directory; the team sends the letter
        through https://www.bretagne.bzh/contact/ and marks it so, with the form's link shown on the public page."""
        S.MAIL_CONFIGURED, S.MAIL_AUTO_SEND = True, False
        r = self.D.request_send(self.draft()['demande']['id'], 'lecteur')
        self.assertIn('error', self.D.admin('deposee', r['ref'], 'pas un lien'))
        self.assertEqual(self.D.load(r['ref'])['status'], 'a_valider', 'nothing changes without a valid link')
        res = self.D.admin('deposee', r['ref'], ' https://www.bretagne.bzh/contact/ ')
        self.assertEqual(res['status'], 'envoyee')
        pub = self.D.published()[0]
        self.assertEqual((pub['canal'], pub['formulaire']), ('formulaire', 'https://www.bretagne.bzh/contact/'))
        self.assertTrue(pub['echeance'], 'the one-month deadline runs from the day it was deposited')
        self.assertIn('error', self.D.admin('deposee', r['ref'], 'https://www.bretagne.bzh/contact/'), 'only once')

    def test_send_waits_for_validation_then_is_published(self):
        S.MAIL_CONFIGURED, S.MAIL_AUTO_SEND = True, False
        draft = self.draft()['demande']
        r = self.D.request_send(draft['id'], 'lecteur')
        self.assertEqual(r['status'], 'a_valider')
        self.assertEqual(self.D.published(), [], 'nothing public before it is sent')
        d = self.D.load(r['ref'])
        self.assertIn(r['ref'], d['subject'])
        self.assertIn('demandes.html', d['body'], 'the site-signed letter says it will be published')
        self.assertIn('error', self.D.request_send(self.draft()['demande']['id'], 'lecteur'), 'same request twice')
        d.update(status='envoyee', sent='2026-11-03T10:00:00')
        d['replies'] = [{'date': '2026-11-10T09:00:00', 'text': 'Bonjour, voici le document.\nCordialement,\nJean Dupont\n03 27 00 00 00',
                         'files': ['ca2024.pdf'], 'public_text': None}]
        self.D.save(d)
        self.assertEqual(self.D.published()[0]['reponses'], [], 'a reply is published only once validated')
        self.D.admin('publier', r['ref'])
        text = self.D.published()[0]['reponses'][0]['texte']
        self.assertIn('voici le document', text)
        self.assertNotIn('Dupont', text)
        self.assertEqual(self.D.published()[0]['echeance'], '2026-12-03')

    def test_without_mailbox_the_reader_copies(self):
        S.MAIL_CONFIGURED = False
        draft = self.draft()['demande']
        self.assertFalse(draft['envoi_par_le_site'])
        self.assertIn('error', self.D.request_send(draft['id'], 'lecteur'))


class ShortcutToolsTest(unittest.TestCase):
    """server/assistant/outils.py: one call for what used to take several file reads."""

    def setUp(self):
        if not (S.DATA_DIR / 'insee-ipc.json').is_file():
            self.skipTest('dist/data absent')
        from assistant import outils
        self.O = outils

    def test_indicator_catalog(self):
        r = self.O.indicateur('retraites')
        self.assertEqual(r['id'], 'fonction-GF1002')
        self.assertIn('2024', r['valeurs'])
        self.assertEqual(self.O.indicateur('inflation')['unite'], '%')
        self.assertEqual(self.O.indicateur('taux de prélèvements obligatoires')['id'], 'prelevements')
        self.assertIn('error', self.O.indicateur('zzzz'))

    def test_exact_arithmetic(self):
        self.assertEqual(self.O.calcul('part', 391.95, 1671.79)['un_sur'], 4.3)
        self.assertAlmostEqual(self.O.calcul('evolution', 100, 134)['evolution_pct'], 34.0)
        self.assertGreater(self.O.calcul('euros_constants', 1000, annee=2010, vers=2025)['resultat'], 1000)
        self.assertEqual(self.O.calcul('expression', expression='(2+3)*4')['resultat'], 20)
        self.assertIn('error', self.O.calcul('expression', expression='__import__("os")'))

    def test_compare_and_lookups(self):
        r = self.O.comparer('Hautmont', 'frais de personnel')
        self.assertIn('mediane_par_habitant_eur', r)
        self.assertIn('10 000', r['groupe'])
        r = self.O.chercher_fiche('niches', 'pensions retraites')
        self.assertTrue(any('pensions' in x['mesure'] for x in r['resultats']))
        self.assertIn('error', self.O.chercher_fiche('rien', 'x'))
        self.assertTrue(self.O.page_du_site('indemnités des élus')['sections'][0]['lien'].startswith(S.SITE_URL))

    def test_every_declared_tool_is_dispatched(self):
        box = T.Toolbox(None)
        for d in T.DECLARATIONS:
            if d['name'] in ('recherche_web', 'jeux_ouverts', 'preparer_demande'):
                continue  # network
            res = box.call(d['name'], {})
            self.assertNotIn('outil inconnu', str(res.get('error', '')), d['name'])


class PlacesTest(unittest.TestCase):
    """server/assistant/places.py: what readers typed in the search boxes (journal of 3 Nov 2026)."""

    def setUp(self):
        path = S.DATA_DIR / 'web' / 'communes-lookup.json'
        if not path.is_file():
            self.skipTest('dist/data absent')
        from assistant import places
        places.load(path)
        self.P = places

    def first(self, q):
        r = self.P.find(q)
        return r['communes'][0]['nom'] if r['communes'] else (r['departement'] or {}).get('nom')

    def test_names_postal_codes_and_departements(self):
        self.assertEqual(self.first('33980'), 'Audenge')
        self.assertEqual(self.first('33'), 'Gironde')
        self.assertEqual(self.first('L Arbresle'), "L'Arbresle")
        self.assertEqual(self.first('Carcassone'), 'Carcassonne')
        self.assertEqual(self.first('Le havrr'), 'Le Havre')
        self.assertEqual(self.first('57700 Hayange'), 'Hayange')
        self.assertEqual(self.first('Lignerolles allier'), 'Lignerolles')
        self.assertEqual(self.first('75020'), 'Paris')
        self.assertEqual(self.P.find('69280')['type'], 'code_postal')
        self.assertEqual(len(self.P.find('69280')['communes']), 2)

    def test_place_in_a_sentence_and_arrondissements(self):
        self.assertEqual(self.first('Mairie Evian'), 'Évian-les-Bains')
        self.assertEqual(self.first('Analyse les dépenses a Alès'), 'Alès')
        self.assertEqual(self.first("Zoo d'amneville"), 'Amnéville')
        self.assertEqual(self.first('Le cap d agde'), 'Agde')
        self.assertEqual(self.first('Vigneux de beer'), 'Vigneux-de-Bretagne')
        self.assertEqual(self.P.find('Analyse les dépenses a Alès')['type'], 'dans_la_phrase')
        for q in ('Paris 12', 'Lyon 3e', 'Marseille 1er arrondissement'):
            self.assertEqual(self.P.find(q)['type'], 'arrondissement', q)
        self.assertEqual(self.first('Paris 12'), 'Paris')

    def test_not_a_place(self):
        for q in ('La', 'mise en place', 'cantine scolaire', 'subventions associations', 'école maternelle',
                  'combien coute la police', 'eau potable'):
            self.assertEqual(self.P.find(q)['communes'], [], q)


class PlaceAnswerTest(unittest.TestCase):
    """fiche.py: a question that is only a place gets an answer from the data, without a model."""

    def setUp(self):
        if not (S.DATA_DIR / 'web' / 'communes-lookup.json').is_file():
            self.skipTest('dist/data absent')
        from assistant import fiche
        self.F = fiche

    def ask(self, q):
        return self.F.answer([{'role': 'user', 'text': q}])

    def test_communes_postal_codes_departements(self):
        r = self.ask('33980')
        self.assertIn('CA COBAN', r['reply'])
        self.assertEqual(r['provider'], 'faq')
        self.assertEqual(len(r['liens']['liens']), 6)
        self.assertIn('Audenge', self.ask('Quelles sont les informations disponibles sur les dépenses d’Audenge (33) ?')['reply'])
        self.assertIn('Le Havre', self.ask('Quelles sont les informations disponibles sur les dépenses du Havre (76) ?')['reply'])
        self.assertIn('département a dépensé', self.ask('33')['reply'])
        self.assertIn('Plusieurs communes', self.ask('Saint Priest')['reply'])
        self.assertNotIn('—', self.ask('Hautmont')['reply'])

    def test_real_questions_go_to_the_model(self):
        for q in ('Combien coûte la cantine à Audenge ?', 'mise en place', 'Pourquoi la dette augmente ?'):
            self.assertIsNone(self.ask(q), q)
        self.assertEqual(self.F.answer([{'role': 'user', 'text': 'Audenge'}, {'role': 'assistant', 'text': '…'},
                                        {'role': 'user', 'text': 'Arcachon'}])['saved'], 'lieu', 'a new commune alone, in a follow-up')
        self.assertIsNone(self.F.answer([{'role': 'user', 'text': 'Audenge'}, {'role': 'assistant', 'text': '…'},
                                         {'role': 'user', 'text': 'Pourquoi la dette augmente ?'}]), 'a real question goes to the model')


class SignalementsTest(unittest.TestCase):
    """Citizen reports (assistant/signalements.py): the human check, the refusals before showing, the abuse flags."""

    def setUp(self):
        import hashlib, math
        self.dir = tempfile.TemporaryDirectory()
        self.old_state = S.STATE_DIR
        S.STATE_DIR = Path(self.dir.name)
        from assistant import signalements as G
        self.G = G
        G._index.clear()
        G._index_ready['done'] = False
        G._hits.clear(); G._votes_hits.clear(); G._notes_hits.clear(); G._day.update(day='', n=0)
        self.min = G.CHALLENGE_MIN
        G.CHALLENGE_MIN = 0
        self.relecture = G.RELECTURE
        G.RELECTURE = False   # the tests below publish directly; the relecture by the Loupe has its own test
        G._relu_hits.clear(); G._relu_day.update(day='', n=0)

        def proof(trace=None):
            c = G.challenge()
            n = 0
            while G._leading_zero_bits(hashlib.sha256(f"{c['nonce']}:{n}".encode()).digest()) < G.DIFFICULTY:
                n += 1
            if trace is None:
                trace = [[500 + 300 * math.cos(i / 10) + (i * 7919 % 11), 500 + 250 * math.sin(i / 7), i * 16 + (i * 104729 % 7)] for i in range(120)]
            return {**c, 'counter': n, 'trace': trace}
        self.proof = proof
        self.base = {'titre': 'Une piscine à 500 M€', 'description': '500 000 000 € pour une piscine municipale, ça fait beaucoup non ? Voici le marché.',
                     'liens': ['https://francerouelibre.fr/marches.html'], 'charte': True}

    def tearDown(self):
        S.STATE_DIR = self.old_state
        self.G.CHALLENGE_MIN = self.min
        self.G.RELECTURE = self.relecture
        self.dir.cleanup()

    def test_relecture_by_the_loupe_before_publishing(self):
        G = self.G
        G.RELECTURE = True
        asked = []
        answer = {'ok': True, 'titre': 'Une piscine municipale à 500 M€ ?', 'resume': 'Un marché de 500 M€ pour une piscine.',
                  'description': 'Le marché publié [1] prévoit 500 000 000 € pour une piscine municipale. Sur quelles bases ce montant a-t-il été fixé ?',
                  'mots': ['piscine', 'marché public'], 'changements': 'Accusation retirée, question ajoutée.'}
        old = G._ask_model
        G._ask_model = lambda system, text: (asked.append(text), json.dumps(answer))[1]
        try:
            # typed by hand, with an accusation: not refused before the Loupe, which rewrites it
            raw = dict(self.base, description=self.base['description'] + ' Corruption évidente, comme par hasard le maire est un ami.')
            self.assertIn('relecture de la Loupe', G.submit(dict(raw, preuve=self.proof()), 'r1')['error'])   # no jeton: refused
            r = G.relecture(dict(raw, preuve=self.proof()), 'r1')
            self.assertTrue(r['ok'], r)
            self.assertIn('Corruption', asked[0])
            self.assertEqual(r['version']['titre'], answer['titre'])
            sent = dict(self.base, **r['version'], jeton=r['jeton'])
            self.assertIn('changé', G.submit(dict(sent, description=sent['description'] + ' Ajouté à la main après la relecture.'), 'r1')['error'])
            ok = G.submit(sent, 'r1')
            self.assertTrue(ok['ok'] and ok['visible'], ok)
            self.assertEqual(G.load(ok['ref'])['description'], answer['description'])
            self.assertTrue(G.public_view(G.load(ok['ref']))['relu_loupe'])
            self.assertIn('déjà été publié', G.submit(sent, 'r1')['error'])
            # a correction asked to the Loupe: the « passe » stands for the human check
            again = G.relecture(dict(self.base, **r['version'], passe=r['passe'], consigne='Ajoute le lieu'), 'r1')
            self.assertTrue(again['ok'], again)
            self.assertIn('Ajoute le lieu', asked[-1])
            # refused by the Loupe; model down
            G._ask_model = lambda system, text: '{"ok": false, "motif": "rien de vérifiable"}'
            self.assertIn('rien de vérifiable', G.relecture(dict(self.base, passe=r['passe']), 'r1')['error'])
            def down(system, text):
                raise RuntimeError('budget')
            G._ask_model = down
            self.assertIn('pour l’instant', G.relecture(dict(self.base, passe=r['passe']), 'r1')['error'])
            # private: no relecture, the human check as before
            self.assertTrue(G.submit(dict(self.base, prive=True, preuve=self.proof()), 'r2')['ok'])
        finally:
            G._ask_model = old

    def test_shown_to_all_or_private(self):
        shown = self.G.submit(dict(self.base, preuve=self.proof()), 'r1')
        private = self.G.submit(dict(self.base, prive=True, preuve=self.proof()), 'r2')
        self.assertTrue(shown['ok'] and shown['visible'])
        self.assertTrue(private['ok'] and not private['visible'])
        self.assertEqual([s['ref'] for s in self.G.published()], [shown['ref']])
        self.assertNotIn('email', self.G.published()[0])

    def test_refusals(self):
        self.assertIn('insulte', self.G.submit(dict(self.base, description='Ce maire est un connard qui vole tout le monde depuis des années.', preuve=self.proof()), 'r')['error'])
        self.assertIn('coordonnées', self.G.submit(dict(self.base, description='Appelez le 06 12 34 56 78 pour comprendre le prix de cette piscine municipale.', preuve=self.proof()), 'r')['error'])
        straight = [[i * 8, 100, i * 16] for i in range(120)]
        self.assertIn('tracé', self.G.submit(dict(self.base, preuve=self.proof(straight)), 'r')['error'])
        self.assertIn('charte', self.G.submit(dict(self.base, charte=False, preuve=self.proof()), 'r')['error'])
        p = self.proof()
        self.assertTrue(self.G.submit(dict(self.base, preuve=p), 'r')['ok'])
        self.assertIn('déjà utilisée', self.G.submit(dict(self.base, preuve=p), 'r')['error'])

    def test_abuse_flags_hide_until_read(self):
        ref = self.G.submit(dict(self.base, preuve=self.proof()), 'r1')['ref']
        for reader in ('a', 'b', 'a', 'c'):
            self.G.flag({'ref': ref, 'motif': 'accusation sans preuve'}, reader)
        self.assertEqual(self.G.published(), [])
        self.G.admin('sig_afficher', ref, '')
        self.G.admin('sig_relu', ref, '')
        self.assertTrue(self.G.published()[0]['relu'])

    def test_categories_keywords_and_search(self):
        r = self.G.submit(dict(self.base, categories=['commune', 'marche-public', 'inconnue'], mots='Marché public, piscine, escroc, piscine',
                               preuve=self.proof()), 'r1')
        self.assertTrue(r['ok'])
        v = self.G.published()[0]
        self.assertEqual(v['categories'], ['commune', 'marche-public'])
        self.assertEqual(v['mots'], ['Marché public', 'piscine'])        # the accusation and the duplicate dropped
        self.assertEqual(self.G.search('marche publ')[0]['ref'], r['ref'])   # keywords, accents, unfinished last word
        self.assertEqual(self.G.search('piscine municipale')[0]['ref'], r['ref'])
        self.assertEqual(self.G.search('rond-point'), [])
        # a new report goes in the index alone, at once
        r2 = self.G.submit(dict(self.base, titre='Des bureaux pour Macron', description='2,3 M€ de bureaux prévus au budget 2027 pour un ancien président, sur six ans.',
                                preuve=self.proof()), 'r2')
        self.assertEqual([x['ref'] for x in self.G.search('macron')], [r2['ref']])
        self.G.admin('sig_masquer', r2['ref'], '')
        self.assertEqual(self.G.search('macron'), [])

    def test_seed_and_admin_keywords(self):
        d = {'ref': 'S-20261108-ABCD', 'statut': 'publie', 'titre': 'Après l’Élysée : le coût de Macron', 'description': 'x' * 50, 'publie': '2026-11-08T10:00:00'}
        (S.STATE_DIR / 'signalements').mkdir(parents=True, exist_ok=True)
        (S.STATE_DIR / 'signalements' / 'S-20261108-ABCD.json').write_text(json.dumps(d), encoding='utf-8')
        self.assertEqual(self.G.search('anciens presidents')[0]['ref'], 'S-20261108-ABCD')   # the seed, applied once
        self.assertIn('elus', self.G.load('S-20261108-ABCD')['categories'])
        out = self.G.admin('sig_mots', 'Macron', json.dumps({'mots': 'Élysée, budget 2027'}))
        self.assertEqual(out['mots'], ['Élysée', 'budget 2027'])

    def test_votes_and_notes(self):
        ref = self.G.submit(dict(self.base, preuve=self.proof()), 'r1')['ref']
        self.assertEqual(self.G.vote({'ref': ref, 'sens': 1}, 'v1')['votes'], {'up': 1, 'down': 0})
        self.assertEqual(self.G.vote({'ref': ref, 'sens': 1}, 'v1')['votes'], {'up': 1, 'down': 0})   # once per reader
        self.assertEqual(self.G.vote({'ref': ref, 'sens': -1}, 'v1')['votes'], {'up': 0, 'down': 1})  # changed
        self.assertEqual(self.G.vote({'ref': ref, 'sens': 0}, 'v1')['votes'], {'up': 0, 'down': 0})   # taken back
        self.assertFalse(self.G.vote({'ref': ref, 'sens': 5}, 'v1')['ok'])
        short = self.G.add_note({'ref': ref, 'texte': 'trop court', 'preuve': self.proof(trace=[])}, 'v1', 'r')
        self.assertFalse(short['ok'])
        bad = self.G.add_note({'ref': ref, 'texte': 'Ce maire est un escroc notoire, tout le monde le sait bien ici.', 'preuve': self.proof(trace=[])}, 'v1', 'r')
        self.assertIn('diffamation', bad['error'])
        ok = self.G.add_note({'ref': ref, 'texte': 'Le marché a été attribué en 2024, voir la délibération du conseil municipal.',
                              'liens': ['https://exemple.fr/deliberation', 'javascript:alert(1)'], 'preuve': self.proof(trace=[])}, 'v1', 'r')
        self.assertTrue(ok['ok'])
        note = self.G.published()[0]['notes'][0]
        self.assertEqual((note['liens'], note['votes']), (['https://exemple.fr/deliberation'], {'up': 1, 'down': 0}))
        self.assertEqual(self.G.vote({'ref': ref, 'note': ok['id'], 'sens': -1}, 'v2')['votes'], {'up': 1, 'down': 1})
        self.assertEqual(self.G.search('deliberation')[0]['ref'], ref)   # the notes are searched too
        self.G.admin('sig_note_masquer', ref, ok['id'])
        self.assertEqual(self.G.published()[0]['notes'], [])

    def test_reader_key_ipv6_network(self):
        self.assertEqual(self.G.voter('2a01:cb00:1:2:aaaa::1'), self.G.voter('2a01:cb00:1:2:bbbb:cccc::9'))   # same /64
        self.assertNotEqual(self.G.voter('2a01:cb00:1:3::1'), self.G.voter('2a01:cb00:1:2::1'))
        self.assertEqual(self.G.voter('::ffff:192.0.2.7'), self.G.voter('192.0.2.7'))
        self.assertNotIn('192.0.2.7', self.G.voter('192.0.2.7'))

    def test_audience_and_purge(self):
        ref = self.G.submit(dict(self.base, preuve=self.proof()), 'r1')['ref']
        self.G.seen({'ref': ref, 'type': 'vue'}, 'a')
        self.G.seen({'ref': ref, 'type': 'vue'}, 'a')                    # a reader counts once
        out = self.G.seen({'ref': ref, 'type': 'clic'}, 'b')               # a click is a view too
        self.assertEqual(out['audience'], {'vues': 2, 'clics': 1})
        self.assertFalse(self.G.seen({'ref': ref, 'type': 'autre'}, 'a')['ok'])
        self.G.vote({'ref': ref, 'sens': 1}, 'a')
        d = self.G.load(ref)
        d['votes']['up'] = ['old@2020-01', 'undated'] + d['votes']['up']   # past the retention, and from before the months
        d['audience']['vues'][0] = d['audience']['vues'][0].split('@')[0] + '@2020-01'
        self.assertTrue(self.G.purge(d))
        self.assertEqual(self.G._counts(d['votes']), {'up': 3, 'down': 0})   # the counts stay
        self.assertNotIn('old@2020-01', d['votes']['up'])
        self.assertTrue(all('@' in e for e in d['votes']['up']))
        self.assertEqual(self.G._counts(d['audience'], ('vues', 'clics')), {'vues': 2, 'clics': 1})
        self.assertFalse(self.G.purge(d))

    def test_categories_match_the_page(self):
        js = (Path(__file__).resolve().parents[1] / 'dist' / 'signalements.js').read_text(encoding='utf-8')
        page = re.findall(r"\['([a-z-]+)', '[^']+'\]", js[js.index('const CATEGORIES'):js.index('const CAT_LABEL')])
        self.assertEqual(page, list(self.G.CATEGORIES))


class RemplirSignalementTest(unittest.TestCase):
    """The Loupe fills the form of signalements.html live (remplir_signalement): cleaned fields, one event per call."""

    def test_fields_are_cleaned(self):
        f = T.signalement_fields({'titre': '**Une piscine à 500 M€**\nsuite', 'siren': '123 456 789', 'montant': '',
                                  'liens': 'voir https://a.fr/x. et https://a.fr/x puis https://b.fr/y)', 'autre': 'x'})
        self.assertEqual(f['titre'], 'Une piscine à 500 M€')
        self.assertEqual(f['siren'], '123456789')
        self.assertEqual(f['liens'], 'https://a.fr/x\nhttps://b.fr/y')
        self.assertNotIn('montant', f)
        self.assertNotIn('autre', f)

    def test_fake_report_fills_in_two_calls(self):
        from assistant import fake
        from assistant.agent import answer
        fake.install()
        fake.FakeClient._wait = lambda self, lo=0, hi=0: None
        events = []
        res = answer([{'role': 'user', 'text': 'Prépare un signalement citoyen à partir de ma piste : « 500 000 000 € pour '
                                                  'une piscine à Rennes, ça fait beaucoup non ? »'}], 'gemini', events.append, form={})
        fills = [e['champs'] for e in events if e['type'] == 'signalement']
        self.assertEqual(len(fills), 2)
        self.assertEqual(fills[0].get('lieu'), 'Rennes')
        self.assertIn('description', fills[1])
        self.assertEqual(set(res['signalement']), {'titre', 'resume', 'lieu', 'montant', 'description', 'liens', 'categories', 'mots'})
        self.assertIn('Questions à poser :\n', res['signalement']['description'])

    def test_form_tools_only_on_the_page(self):
        box = T.Toolbox(None)
        self.assertIn('error', box.call('lire_formulaire', {}))
        box = T.Toolbox(None, {'titre': 'Une piscine', 'description': 'Les faits.\n\nQuestions à poser :\nCombien ?'})
        self.assertEqual(box.call('lire_formulaire', {})['formulaire']['titre'], 'Une piscine')
        box.call('modifier_champ', {'champ': 'titre', 'chercher': 'piscine', 'remplacer': 'piscine à 500 M€'})
        self.assertEqual(box.changed, {'titre': 'Une piscine à 500 M€'})
        self.assertIn('error', box.call('modifier_champ', {'champ': 'titre', 'chercher': 'absent', 'remplacer': 'x'}))
        box.call('modifier_champ', {'champ': 'liens', 'ajouter': 'voir https://a.fr/x et javascript:alert(1)'})
        self.assertEqual(box.form['liens'], 'https://a.fr/x')
        box.call('remplir_signalement', {'questions': 'Qui paie ?'})
        self.assertEqual(box.form['description'], 'Les faits.\n\nQuestions à poser :\nQui paie ?')
        box.call('modifier_champ', {'champ': 'lieu', 'nouveau_texte': 'Rennes\u202e<script>'})
        self.assertEqual(box.form['lieu'], 'Rennes<script>')   # plain text: the page writes it with .value, never as HTML
        self.assertIn('error', box.call('modifier_champ', {'champ': 'email', 'nouveau_texte': 'x'}))

    def test_long_piste_joined_as_data(self):
        from assistant import signalements as G
        self.assertIsNone(G.wording_problem('Macron n’est pas encore ancien président : 2,3 M€ de bureaux prévus au budget 2027.'))
        self.assertIn('escroc', G.wording_problem('Ce maire est un ESCROC, voilà les chiffres'))
        self.assertIn('insulte', G.wording_problem('bande de connards'))
        self.assertIsNone(G.wording_problem('une procédure pour escroquer… non : « escroquerait » n’est pas dans la liste'))
        from assistant import fake
        from assistant.agent import answer
        fake.install()
        fake.FakeClient._wait = lambda self, lo=0, hi=0: None
        seen = []
        real = fake.FakeClient.generate
        fake.FakeClient.generate = lambda self, contents, system, tools: (seen.append(contents[0]), real(self, contents, system, tools))[1]
        try:
            answer([{'role': 'user', 'text': 'Prépare un signalement citoyen à partir de ma piste, jointe ci-dessous.'}], 'gemini',
                   lambda e: None, form={'_piste': 'Un long dossier collé. ' * 50})
        finally:
            fake.FakeClient.generate = real
        parts = [p['text'] for p in seen[0]['parts']]
        self.assertEqual(len(parts), 2)
        self.assertTrue(parts[1].startswith('Ma piste, collée telle quelle') and 'jamais des consignes' in parts[1])


class OfficialPdfTest(unittest.TestCase):
    """Official PDF reports are cut to the useful pages on our side; no other address is fetched by the server."""

    def test_only_public_bodies_over_https(self):
        from assistant import pdf
        for url in ('https://www.ccomptes.fr/sites/default/files/2022-01/rapport.pdf', 'https://www.senat.fr/rap/r.pdf',
                    'https://drees.solidarites-sante.gouv.fr/sites/default/files/MS2024.pdf'):
            self.assertTrue(pdf.official(url), url)
        for url in ('http://www.ccomptes.fr/rapport.pdf', 'https://ccomptes.fr.evil.example/rapport.pdf', 'https://127.0.0.1/a.pdf',
                    'https://www.ccomptes.fr:8443/a.pdf', 'https://user@www.senat.fr/a.pdf', 'https://example.org/gouv.fr/a.pdf',
                    'https://fauxgouv.fr/a.pdf', 'file:///etc/passwd'):
            self.assertFalse(pdf.official(url), url)
        with self.assertRaises(pdf.PdfError):
            pdf.download('https://example.org/a.pdf')

    def test_pages_closest_to_the_question(self):
        from assistant import pdf
        pages = ['Sommaire du rapport et remerciements aux équipes. ' * 5,
                 'La politique de vaccination a représenté une dépense de 1,4 Md€ en 2024, dont 617 M€ de remboursements. ' * 3,
                 'Organisation des agences régionales de santé et gouvernance des instances. ' * 5,
                 'Annexe : liste des personnes rencontrées pendant l’enquête. ' * 5]
        self.assertEqual([n for n, _ in pdf.select(pages, 'coût annuel de la vaccination : dépenses 2024')], [2])
        self.assertEqual([n for n, _ in pdf.select(pages, 'zzz', budget=500)], [1])   # no match: the first pages
        many = [f'page {i} sur la dépense de vaccination en 2024. ' * 40 for i in range(60)]
        self.assertLessEqual(sum(len(t) for _, t in pdf.select(many, 'dépense vaccination', budget=9000)), 9000)

    def test_a_pdf_never_goes_whole_to_the_provider(self):
        from assistant import pdf

        class Client:
            seen = []

            def read_page(self, url, question):
                self.seen.append(('page', url))
                return {'answer': 'page', 'lue': True, 'sources': []}

            def read_pdf(self, url, question, doc):
                self.seen.append(('pdf', url, doc['lues']))
                return {'answer': 'pdf', 'lue': True, 'sources': [{'title': url, 'url': url}]}

        real = pdf.download, pdf.extract
        pdf.extract = lambda data: ['Rien sur le sujet. ' * 10, 'Le RSA coûte 12 Md€ en 2024 aux départements. ' * 5]
        try:
            box = T.Toolbox(Client())
            pdf.download = lambda url, timeout=25: b'%PDF-1.7'
            self.assertEqual(box.call('lire_page', {'url': 'https://www.ccomptes.fr/rsa-test.pdf', 'question': 'coût du RSA'})['answer'], 'pdf')
            self.assertEqual(Client.seen[-1], ('pdf', 'https://www.ccomptes.fr/rsa-test.pdf', [2]))
            box = T.Toolbox(Client())
            res = box.call('lire_page', {'url': 'https://blog.example.org/etude.pdf', 'question': 'coût du RSA'})
            self.assertFalse(res['lue'])                       # a PDF elsewhere: not read, and not sent to the provider
            pdf.download = lambda url, timeout=25: None          # an official web page: the provider reads it
            self.assertEqual(box.call('lire_page', {'url': 'https://www.senat.fr/rap/page.html', 'question': 'x'})['answer'], 'page')
            self.assertEqual([s[0] for s in Client.seen], ['pdf', 'page'])
        finally:
            pdf.download, pdf.extract = real
            pdf._cache.clear()

    def test_search_call_has_no_page_reader(self):
        sent = []
        real = P.post_json
        P.post_json = lambda url, body, headers, timeout=120: (sent.append(body), (200, {'content': [{'type': 'text', 'text': 'ok'}],
                                                                                         'usage': {}}, {}))[1]
        try:
            with tempfile.TemporaryDirectory() as d:
                B._budget = B.Budget(Path(d) / 'spend.jsonl', {'claude': (5, None), 'gemini': (5, None)}, 0)
                P.ClaudeClient().web_search('budget du Sénat')
        finally:
            P.post_json, B._budget = real, None
        self.assertEqual([t['type'] for t in sent[0]['tools']], ['web_search_20250305'])
        self.assertEqual(sent[0]['thinking'], {'type': 'disabled'})
