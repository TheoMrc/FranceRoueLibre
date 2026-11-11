"""Hard spending caps, checked before every model call.

* Three caps, all checked: one provider in all (CLAUDE_BUDGET_EUR, GEMINI_BUDGET_EUR), one provider for one day
  (CLAUDE_DAILY_EUR, GEMINI_DAILY_EUR), both providers together for one day (ASSISTANT_DAILY_EUR).
* A provider with a monthly **envelope** (Claude) has it instead of the cap in all. It follows the credits as Anthropic
  grants them: lots, each with an end date. So many euros at a start date, a new lot on each monthly day, and what is
  left of a lot is lost when it ends (the credit of the 9th ends on the 11th of the next month: two days of overlap,
  no real carry-over). The oldest lot is spent first, as Anthropic does.
* Each call first **reserves** its worst case (whole prompt at the uncached price, the full output budget, the maximum
  number of web searches). The call is refused if the money already spent, plus what other calls in flight have
  reserved, plus this worst case, would go over the cap. So even many questions at once cannot overshoot it.
* When the answer arrives, the reservation is replaced by the real cost, computed from the token counts the provider
  returns, and appended to the ledger ``spend.jsonl`` (date, provider, model, tokens, cost; never a question or a key).
  A call lost on the network is counted at its worst case, since it may have been billed.
* The totals are read back from the ledger at start-up, so a restart does not reset them.

Prices (USD per million tokens), checked on the providers' pages on 2026-10-31:
* Vertex AI, Gemini 3.8 Flash and 3.7 Flash, global endpoint, introductory rates until 2026-12-31: input 0.75, cached
  input 0.075, output (thinking included) 3.75; Grounding with Google Search 14 $ per 1 000 queries (the 5 000 free
  queries per month are ignored: safe side). https://cloud.google.com/vertex-ai/generative-ai/pricing
* Claude Haiku 5.5: input 0.10, cache write 0.125, cache read 0.01, output 0.50 up to 100 000 prompt tokens, five times
  more above; Sonnet 5.5: 2 / 2.50 / 0.10 / 10; web search 10 $ per 1 000. https://platform.claude.com/docs/en/about-claude/pricing
A model missing from this table is refused rather than counted at a guessed price.
"""
from __future__ import annotations

import datetime as dt
import json
import threading
from collections import defaultdict
from pathlib import Path
from typing import Optional

from . import settings as S

PRICES = {
    'gemini-3.8-flash': dict(input=0.75, cached=0.075, output=3.75),
    'gemini-3.7-flash': dict(input=0.75, cached=0.075, output=3.75),
    'claude-haiku-5-5': dict(input=0.10, cache_write=0.125, cached=0.01, output=0.50, long_above=100_000,
                             long=dict(input=0.50, cache_write=0.625, cached=0.05, output=2.50)),
    'claude-sonnet-5-5': dict(input=2.0, cache_write=2.50, cached=0.10, output=10.0),
}
SEARCH_USD = {'gemini': 14 / 1000, 'claude': 10 / 1000}
PROVIDERS = ('gemini', 'claude')

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo('Europe/Paris')
except Exception:  # Windows without the tzdata package: winter time, one hour behind summer time at worst
    PARIS = dt.timezone(dt.timedelta(hours=1))


class BudgetError(RuntimeError):
    """The call would go over a cap, the date is past, or the model has no known price."""


def today() -> dt.date:
    return dt.datetime.now(PARIS).date()


def now() -> dt.datetime:
    """Paris time without zone, like the day and time written in the ledger."""
    return dt.datetime.now(PARIS).replace(tzinfo=None)


def monthly_days(after: dt.datetime, until: dt.datetime, day: int) -> tuple:
    """(the monthly days after ``after`` and up to ``until``, the next one after ``until``), at 0:00."""
    found, y, m = [], after.year, after.month
    while True:
        d = dt.datetime(y, m, day)
        if d > until:
            return found, d
        if d > after:
            found.append(d)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


class Envelope:
    """Credits as lots [end or None, euros granted, euros left]. Events must come in time order (the ledger is)."""

    def __init__(self, start: dt.datetime, eur: float, expires: Optional[dt.datetime], monthly: float, day: int,
                 expire_day: int = 0):
        self.start, self.monthly, self.day, self.expire_day = start, monthly, day, expire_day
        self.lots = [[expires, eur, eur]]
        self.cursor = start        # the monthly credits up to here are in the lots
        self.debt = 0.0            # spent beyond the lots (a call that cost more than reserved): taken from the next credit

    def _end(self, granted: dt.datetime) -> Optional[dt.datetime]:
        """A monthly credit ends on expire_day of the next month (0: never)."""
        if not self.expire_day:
            return None
        y, m = (granted.year + 1, 1) if granted.month == 12 else (granted.year, granted.month + 1)
        return dt.datetime(y, m, self.expire_day)

    def advance(self, t: dt.datetime) -> None:
        if t > self.cursor:
            for d in monthly_days(self.cursor, t, self.day)[0]:
                paid = min(self.debt, self.monthly)
                self.debt -= paid
                self.lots.append([self._end(d), self.monthly, self.monthly - paid])
            self.cursor = t
        self.lots = [lot for lot in self.lots if lot[0] is None or lot[0] > t]

    def spend(self, eur: float, t: dt.datetime) -> None:
        if t < self.start:
            return
        self.advance(t)
        for lot in sorted(self.lots, key=lambda lot: (lot[0] is None, lot[0] or dt.datetime.max)):
            take = min(lot[2], eur)
            lot[2] -= take
            eur -= take
        self.debt += max(0.0, eur)

    def left(self, t: dt.datetime) -> float:
        self.advance(t)
        return sum(lot[2] for lot in self.lots) - self.debt

    def next_credit(self, t: dt.datetime) -> dt.date:
        return monthly_days(t, t, self.day)[1].date()


def price(model: str) -> Optional[dict]:
    m = (model or '').lower()
    for key in sorted(PRICES, key=len, reverse=True):
        if m == key or m.startswith(key + '-') or m.startswith(key + '@'):
            return PRICES[key]
    return None


def cost_usd(provider: str, model: str, *, prompt: float = 0, cached: float = 0, cache_write: float = 0,
             output: float = 0, searches: int = 0) -> float:
    """``prompt`` is the uncached input; ``cached`` the input read from the cache; ``cache_write`` the input written to it."""
    p = price(model)
    if p is None:
        raise BudgetError(f'Prix inconnu pour le modèle « {model} » : ajoute-le dans server/assistant/budget.py.')
    if p.get('long') and prompt + cached + cache_write > p['long_above']:
        p = {**p, **p['long']}
    usd = (prompt * p['input'] + cached * p['cached'] + cache_write * p.get('cache_write', p['input'])
           + output * p['output']) / 1e6
    return usd + searches * SEARCH_USD[provider]


def worst_case_eur(provider: str, model: str, body_chars: int, max_output: int, searches: int = 0) -> float:
    """Upper bound of one call: about 2.5 characters per token (JSON and French text are closer to 3.5), all uncached."""
    return cost_usd(provider, model, prompt=body_chars / 2.5 + 500, output=max_output, searches=searches) * S.USD_EUR


class Budget:
    def __init__(self, ledger: Path, limits: dict, daily_eur: float, daily_by: Optional[dict] = None,
                 envelopes: Optional[dict] = None):
        self.ledger = ledger
        self.limits = limits            # provider -> (euros, last day or None)
        self.daily_eur = daily_eur      # both providers together, for one day
        self.daily_by = daily_by or {}  # provider -> euros for one day (0 or absent: no cap of its own)
        self.lock = threading.Lock()
        self.spent = defaultdict(float)     # provider -> euros since the start
        self.by_day = defaultdict(float)    # 'YYYY-MM-DD' -> euros, both providers
        self.by_day_of = defaultdict(float)  # ('YYYY-MM-DD', provider) -> euros
        # provider -> Envelope, from {'start', 'eur', 'expires', 'monthly', 'day', 'expire_day'} (monthly 0: no envelope)
        self.envelopes = {p: Envelope(e['start'], e['eur'], e.get('expires'), e['monthly'], e['day'], e.get('expire_day') or 0)
                          for p, e in (envelopes or {}).items() if e and e.get('monthly', 0) > 0}
        self.reserved = defaultdict(float)  # provider -> euros of the calls in flight
        self._load()

    def _load(self) -> None:
        if not self.ledger.is_file():
            return
        with self.ledger.open(encoding='utf-8') as f:
            for line in f:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                eur = float(row.get('eur') or 0)
                self.spent[row.get('provider', '?')] += eur
                self.by_day[row.get('day', '')] += eur
                self.by_day_of[(row.get('day', ''), row.get('provider', '?'))] += eur
                env = self.envelopes.get(row.get('provider'))
                try:
                    if env:
                        env.spend(eur, dt.datetime.fromisoformat(f'{row.get("day")}T{row.get("time") or "00:00:00"}'))
                except ValueError:
                    pass

    def _refusal(self, provider: str, extra: float = 0.0) -> Optional[str]:
        limit, until = self.limits.get(provider, (0.0, None))
        env = self.envelopes.get(provider)
        if limit <= 0 and not env:
            return 'désactivé (budget nul)'
        if until and today() > until:
            return f'période terminée (jusqu’au {until.strftime("%d/%m/%Y")})'
        if env:
            if self.reserved[provider] + extra > env.left(now()):
                return f'budget du mois épuisé (prochain crédit le {env.next_credit(now()).strftime("%d/%m/%Y")})'
        elif self.spent[provider] + self.reserved[provider] + extra > limit:
            return f'budget épuisé ({limit:g} €)'
        day = today().isoformat()
        own = self.daily_by.get(provider) or 0
        if own and self.by_day_of[(day, provider)] + self.reserved[provider] + extra > own:
            return 'plafond du jour atteint, réessayez demain'
        if self.daily_eur and self.by_day[day] + sum(self.reserved.values()) + extra > self.daily_eur:
            return 'plafond du jour atteint, réessayez demain'
        return None

    def refusal(self, provider: str, margin: float = 0.02) -> Optional[str]:
        """Why this provider cannot start a new question now (None if it can)."""
        with self.lock:
            return self._refusal(provider, margin)

    def reserve(self, provider: str, eur: float) -> float:
        with self.lock:
            why = self._refusal(provider, eur)
            if why:
                raise BudgetError(f'{"Gemini" if provider == "gemini" else "Claude"} : {why}.')
            self.reserved[provider] += eur
            return eur

    def settle(self, provider: str, reserved: float, eur: float, **entry) -> None:
        now = dt.datetime.now(PARIS)
        row = {'day': now.date().isoformat(), 'time': now.strftime('%H:%M:%S'), 'provider': provider,
               'eur': round(eur, 6), **entry}
        with self.lock:
            self.reserved[provider] = max(0.0, self.reserved[provider] - reserved)
            self.spent[provider] += eur
            self.by_day[row['day']] += eur
            self.by_day_of[(row['day'], provider)] += eur
            if provider in self.envelopes:
                self.envelopes[provider].spend(eur, now.replace(tzinfo=None))
            try:
                self.ledger.parent.mkdir(parents=True, exist_ok=True)
                with self.ledger.open('a', encoding='utf-8') as f:
                    f.write(json.dumps(row, ensure_ascii=False) + '\n')
            except OSError:
                pass  # the totals in memory still hold until the next restart

    def summary(self) -> dict:
        with self.lock:
            out = {}
            for p in PROVIDERS:
                limit, until = self.limits.get(p, (0.0, None))
                env = self.envelopes.get(p)
                if env:   # the gauge of the envelope: what is spent of the lots still alive
                    left = env.left(now())
                    granted = sum(lot[1] for lot in env.lots)
                    out[p] = {'spent_eur': round(granted - left, 4), 'limit_eur': round(granted, 2),
                              'envelope': {'left_eur': round(left, 4), 'monthly_eur': env.monthly, 'day': env.day,
                                           'expire_day': env.expire_day, 'next': env.next_credit(now()).isoformat(),
                                           'since': env.start.isoformat(timespec='minutes'),
                                           'lots': [{'eur': lot[1], 'left': round(lot[2], 4),
                                                     'expires': lot[0].date().isoformat() if lot[0] else None}
                                                    for lot in sorted(env.lots, key=lambda lot: (lot[0] is None, lot[0] or dt.datetime.max))],
                                           'total_spent_eur': round(self.spent[p], 4)}}
                else:
                    out[p] = {'spent_eur': round(self.spent[p], 4), 'limit_eur': limit}
                out[p] |= {
                          'today_eur': round(self.by_day_of[(today().isoformat(), p)], 4),
                          'daily_limit_eur': self.daily_by.get(p) or 0,
                          'until': until.isoformat() if until else None,
                          'refusal': self._refusal(p, 0.02)}
            out['today_eur'] = round(self.by_day[today().isoformat()], 4)
            out['daily_limit_eur'] = self.daily_eur
            return out


_budget: Optional[Budget] = None


def budget() -> Budget:
    global _budget
    if _budget is None:
        _budget = Budget(S.STATE_DIR / 'spend.jsonl',
                         {'claude': (S.CLAUDE_BUDGET_EUR, S.CLAUDE_UNTIL), 'gemini': (S.GEMINI_BUDGET_EUR, S.GEMINI_UNTIL)},
                         S.DAILY_BUDGET_EUR, {'claude': S.CLAUDE_DAILY_EUR, 'gemini': S.GEMINI_DAILY_EUR},
                         {'claude': {'start': S.CLAUDE_ENVELOPE_START, 'eur': S.CLAUDE_ENVELOPE_EUR,
                                     'expires': S.CLAUDE_ENVELOPE_EXPIRES, 'monthly': S.CLAUDE_MONTHLY_EUR,
                                     'day': S.CLAUDE_MONTH_DAY, 'expire_day': S.CLAUDE_EXPIRE_DAY}})
    return _budget
