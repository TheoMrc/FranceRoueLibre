"""Official PDF reports (Cour des comptes, Sénat, Assemblée, ministères, Insee...), read on our side.

Why: the providers' page readers load a whole PDF into the prompt, whatever the cap asked (measured on 2026-11-10: a
Cour des comptes report = 430 000 to 540 000 tokens, 0.22 to 0.28 € with Claude Haiku, often for an empty answer). Here
the PDF is downloaded once, its text extracted, and only the pages closest to the question go to the model: about
12 000 tokens, 0.002 €.

This is the only place where our server fetches a document from the web, so it is narrow on purpose:
* https only, and only the hosts of HOSTS (public bodies) or their subdomains; a redirect is followed only to such a host;
* the host must resolve to public addresses (no local network, no loopback);
* MAX_BYTES at most, the file must start with %PDF, nothing is executed, nothing is written to disk;
* any other address goes to the provider's own reader (providers.py), never through here.
"""
from __future__ import annotations

import io
import ipaddress
import math
import re
import socket
import threading
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from typing import List, Optional, Tuple

from . import settings as S

HOSTS = ('gouv.fr', 'ccomptes.fr', 'senat.fr', 'assemblee-nationale.fr', 'insee.fr', 'vie-publique.fr', 'hatvp.fr',
         'banque-france.fr', 'conseil-constitutionnel.fr', 'conseil-etat.fr', 'hcfp.fr', 'cor-retraites.fr',
         'securite-sociale.fr', 'ameli.fr', 'assurance-maladie.fr', 'urssaf.org', 'urssaf.fr', 'unedic.org', 'francetravail.org',
         'caf.fr', 'cnsa.fr', 'has-sante.fr', 'santepubliquefrance.fr', 'ademe.fr', 'caissedesdepots.fr', 'afd.fr',
         'ieom.fr', 'iedom.fr', 'ofgl.fr', 'cada.fr', 'cnil.fr', 'defenseurdesdroits.fr', 'europa.eu', 'oecd.org',
         'imf.org', 'ugap.fr') + tuple(S.PDF_HOSTS)
MAX_BYTES = S.PDF_MAX_MB * 1024 * 1024
AGENT = 'FranceRoueLibre/1.0 (+https://francerouelibre.fr ; lecture de rapports publics)'
STOP = set('le la les un une des du de d l et ou a au aux en dans sur pour par avec sans que qui quoi dont est sont ete etre '
           'ce cet cette ces son sa ses leur leurs il elle ils elles on y ne pas plus moins tres quel quelle quels quelles '
           'combien comment pourquoi chaque tout tous toute toutes entre depuis selon ainsi aussi faut trouver chiffres '
           'chiffre montant montants annee annees page document rapport'.split())
_lock = threading.Lock()          # pdfium is not thread-safe; one extraction at a time also bounds memory
_cache: 'OrderedDict[str, List[str]]' = OrderedDict()   # url -> pages, the last few documents (memory only)


class PdfError(RuntimeError):
    """Told to the model as the tool's error: it then answers with what the search gave."""


def official(url: str) -> bool:
    """https address on a public body's host (or a subdomain of one)."""
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (u.hostname or '').lower().rstrip('.')
    return u.scheme == 'https' and u.port in (None, 443) and not u.username and any(
        host == h or host.endswith('.' + h) for h in HOSTS)


def looks_pdf(url: str) -> bool:
    return urllib.parse.urlsplit(url).path.lower().endswith('.pdf')


def _public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):   # redirects are followed by hand, each one checked
        return None


def download(url: str, timeout: float = 25) -> Optional[bytes]:
    """The PDF behind an official address, or None when the address is not a PDF (a web page: the provider reads it)."""
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(4):
        if not official(url):
            raise PdfError('adresse hors des sites publics lisibles ici')
        if not _public(urllib.parse.urlsplit(url).hostname or ''):
            raise PdfError('adresse refusée')
        req = urllib.request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'application/pdf,*/*;q=0.5'})
        try:
            with opener.open(req, timeout=timeout) as r:
                head = r.read(5)
                if head != b'%PDF-':
                    return None
                data = head + r.read(MAX_BYTES + 1 - len(head))
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get('Location'):
                url = urllib.parse.urljoin(url, e.headers['Location'])
                continue
            raise PdfError(f'le site a répondu {e.code}') from e
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as e:
            raise PdfError('document injoignable') from e
        if len(data) > MAX_BYTES:
            raise PdfError(f'document de plus de {S.PDF_MAX_MB} Mo')
        return data
    raise PdfError('trop de redirections')


def extract(data: bytes) -> List[str]:
    """Text of each page (pypdfium2, else pypdf). Raises PdfError when no reader is installed or the file is unreadable."""
    pages: List[str] = []
    with _lock:
        try:
            import pypdfium2 as pdfium
        except ImportError:
            pdfium = None
        try:
            if pdfium is not None:
                doc = pdfium.PdfDocument(data)
                try:
                    for i in range(min(len(doc), S.PDF_MAX_PAGES)):
                        page = doc[i]
                        tp = page.get_textpage()
                        pages.append(tp.get_text_range() or '')
                        tp.close()
                        page.close()
                finally:
                    doc.close()
            else:
                try:
                    from pypdf import PdfReader
                except ImportError as e:
                    raise PdfError('lecteur de PDF non installé sur le serveur') from e
                reader = PdfReader(io.BytesIO(data))
                for i, page in enumerate(reader.pages):
                    if i >= S.PDF_MAX_PAGES:
                        break
                    pages.append(page.extract_text() or '')
        except PdfError:
            raise
        except Exception as e:  # noqa: BLE001 - a broken or protected file
            raise PdfError('PDF illisible (protégé ou abîmé)') from e
    pages = [re.sub(r'[ \t\r\f\v]+', ' ', re.sub(r'\s*\n\s*', '\n', p)).strip() for p in pages]
    if sum(len(p) for p in pages) < 400:
        raise PdfError('PDF sans texte (pages scannées)')
    return pages


def _norm(text: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if unicodedata.category(c) != 'Mn')


def _words(text: str) -> List[str]:
    return [w for w in re.findall(r'[a-z0-9]+', _norm(text)) if (len(w) >= 3 or w.isdigit()) and w not in STOP]


def select(pages: List[str], question: str, budget: int = 0) -> List[Tuple[int, str]]:
    """The pages closest to the question, in reading order, within ``budget`` characters: [(page number, text)].
    Score: the question's words found in the page (rare words weigh more, a word counts three times at most), a bonus
    for pages with amounts; the summary pages at the start break ties. Without any match: the first pages."""
    budget = budget or S.PDF_EXTRACT_CHARS
    words = list(dict.fromkeys(_words(question)))
    normed = [_norm(p) for p in pages]
    scores = [0.0] * len(pages)
    for w in words:
        stem = w[:-1] if len(w) > 4 and w.endswith('s') else w
        counts = [len(re.findall(r'\b' + re.escape(stem), n)) for n in normed]
        df = sum(1 for c in counts if c)
        if not df:
            continue
        idf = math.log(1 + len(pages) / df)
        for i, c in enumerate(counts):
            scores[i] += min(c, 3) * idf
    for i, n in enumerate(normed):
        if scores[i] and re.search(r'\d\s?(md|m|k)?\s?€|milliards? d|millions? d|\d\s?%', n):
            scores[i] *= 1.2
    order = sorted(range(len(pages)), key=lambda i: (-scores[i], i)) if any(scores) else list(range(len(pages)))
    kept, used = [], 0
    for i in order:
        text = pages[i][:7000]
        if len(text) < 80 or (any(scores) and not scores[i]):
            continue
        if used + len(text) > budget:
            if used:
                break
            text = text[:budget]
        kept.append((i + 1, text))
        used += len(text)
    return sorted(kept)


def extracts(url: str, question: str) -> Optional[dict]:
    """{'pages': total, 'lues': [numbers], 'texte': the chosen pages} for a PDF on an official host; None when the
    address is a web page (not a PDF). PdfError when it cannot be read."""
    pages = _cache.get(url)
    if pages is None:
        data = download(url)
        if data is None:
            return None
        pages = extract(data)
        _cache[url] = pages
        while len(_cache) > 6:
            _cache.popitem(last=False)
    else:
        _cache.move_to_end(url)
    chosen = select(pages, question)
    if not chosen:
        raise PdfError('PDF sans texte exploitable')
    return {'pages': len(pages), 'lues': [n for n, _ in chosen],
            'texte': '\n\n'.join(f'--- page {n} ---\n{t}' for n, t in chosen)}
