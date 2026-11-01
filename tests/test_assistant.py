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
        r, events = self.ask('test erreur')
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
