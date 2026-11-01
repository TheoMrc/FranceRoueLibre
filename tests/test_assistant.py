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


if __name__ == '__main__':
    unittest.main()
