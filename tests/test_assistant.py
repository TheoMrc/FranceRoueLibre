"""Tests of the AI assistant without any network call: python -m unittest tests/test_assistant.py"""
import datetime as dt
import json
import os
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

        def fake_run(job, messages, provider):
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

    def test_not_a_place(self):
        for q in ('La', 'mise en place', 'cantine scolaire'):
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
        self.assertIsNone(self.F.answer([{'role': 'user', 'text': 'Audenge'}, {'role': 'assistant', 'text': '…'},
                                         {'role': 'user', 'text': 'Audenge'}]), 'a follow-up goes to the model')
