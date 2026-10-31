"""Settings of the assistant, read from the environment and, locally, from the repo's .env (same keys as RevoFlow).

On the VPS the keys come from /etc/francerouelibre/assistant.env (systemd EnvironmentFile, readable by root only);
there is no .env in the repo there.
"""
from __future__ import annotations

import datetime as dt
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # the repo


def _load_dotenv(path: Path) -> None:
    """KEY=VALUE lines, without overriding variables already set (python-dotenv is not needed)."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(Path(os.environ.get('ASSISTANT_ENV_FILE') or ROOT / '.env'))


def _str(name: str, default: str = '') -> str:
    return os.environ.get(name, '').strip() or default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, '').strip() or default)
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, '').strip() or default)
    except ValueError:
        return default


def _date(name: str, default: str):
    value = _str(name, default)
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise SystemExit(f'{name}={value} : date attendue au format AAAA-MM-JJ')


# ---------------------------------------------------------------- Gemini (Vertex AI, billed to the Cloud credits)
GOOGLE_CLOUD_PROJECT = _str('GOOGLE_CLOUD_PROJECT')
GOOGLE_CLOUD_LOCATION = _str('GOOGLE_CLOUD_LOCATION', 'global')
GEMINI_BILLING_ACCOUNT = _str('GEMINI_BILLING_ACCOUNT').replace('billingAccounts/', '')
_gp = _str('GEMINI_PROVIDER')
GEMINI_PROVIDER = _gp if _gp in ('vertex', 'gemini-api') else ('vertex' if GOOGLE_CLOUD_PROJECT else 'gemini-api')
GEMINI_API_KEY = _str('GEMINI_API_KEY')
GEMINI_MODEL = _str('GEMINI_MODEL', 'gemini-3.8-flash')
GEMINI_FALLBACK_MODEL = _str('GEMINI_FALLBACK_MODEL')
GEMINI_THINKING = _str('GEMINI_THINKING_LEVEL', 'low')

# ---------------------------------------------------------------- Claude (Anthropic API)
ANTHROPIC_API_KEY = _str('ANTHROPIC_API_KEY')
CLAUDE_MODEL = _str('CLAUDE_MODEL', 'claude-haiku-5-5')
CLAUDE_FALLBACK_MODEL = _str('CLAUDE_FALLBACK_MODEL')
CLAUDE_EFFORT = _str('CLAUDE_EFFORT').lower()

# ---------------------------------------------------------------- hard spending caps (euros, see budget.py)
# Claude: 50 € in all. Gemini: 100 € in all, and nothing after GEMINI_UNTIL (included, Paris time).
CLAUDE_BUDGET_EUR = _float('CLAUDE_BUDGET_EUR', 50)
CLAUDE_UNTIL = _date('CLAUDE_UNTIL', '')
GEMINI_BUDGET_EUR = _float('GEMINI_BUDGET_EUR', 100)
GEMINI_UNTIL = _date('GEMINI_UNTIL', '2026-11-17')
# Cap on the two providers together for one day, so that a burst of abuse cannot burn the whole budget at once.
DAILY_BUDGET_EUR = _float('ASSISTANT_DAILY_EUR', 10)
# Prices are in US dollars; 1.0 counts one dollar as one euro, which overestimates the spending (safe side).
USD_EUR = _float('ASSISTANT_USD_EUR', 1.0)
# Which provider answers first; the next one takes over when a cap or the date stops it.
ORDER = [p for p in _str('ASSISTANT_ORDER', 'gemini,claude').lower().replace(' ', '').split(',') if p in ('gemini', 'claude')]

# ---------------------------------------------------------------- limits of one conversation and of the public
MAX_STEPS = _int('ASSISTANT_MAX_STEPS', 8)                 # model calls for one question
MAX_OUTPUT_TOKENS = _int('ASSISTANT_MAX_OUTPUT_TOKENS', 4000)
MAX_QUESTION_CHARS = _int('ASSISTANT_MAX_QUESTION_CHARS', 1500)
MAX_HISTORY = _int('ASSISTANT_MAX_HISTORY', 10)            # previous messages kept (text only)
PER_IP_HOUR = _int('ASSISTANT_PER_IP_HOUR', 15)
PER_IP_DAY = _int('ASSISTANT_PER_IP_DAY', 40)
DAILY_QUESTIONS = _int('ASSISTANT_DAILY_QUESTIONS', 500)   # all visitors together
MAX_JOBS = _int('ASSISTANT_MAX_JOBS', 4)                   # questions answered at the same time
ALLOWED_ORIGINS = [o for o in _str('ASSISTANT_ALLOWED_ORIGINS', 'https://francerouelibre.fr,https://www.francerouelibre.fr,'
                                   'http://127.0.0.1:4173,http://localhost:4173').split(',') if o]

# ---------------------------------------------------------------- where things are
DATA_DIR = Path(_str('ASSISTANT_DATA_DIR', str(ROOT / 'dist' / 'data')))
SEARCH_DB = Path(_str('ASSISTANT_SEARCH_DB', str(ROOT / 'dist' / 'data' / 'search' / 'frl-search.sqlite3')))
SEARCH_API = _str('ASSISTANT_SEARCH_API', 'http://127.0.0.1:8017')
# Spending ledger and counters. systemd sets STATE_DIRECTORY on the VPS.
STATE_DIR = Path(_str('ASSISTANT_STATE_DIR', os.environ.get('STATE_DIRECTORY', '') or str(ROOT / '.assistant')))
SITE_URL = _str('ASSISTANT_SITE_URL', 'https://francerouelibre.fr')
