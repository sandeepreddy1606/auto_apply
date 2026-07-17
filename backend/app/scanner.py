"""Career-page scanner: fetch a company's job listings and match them
against the user's profile.

Known ATS boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
Recruitee) are read through their public JSON APIs — reliable and fast.
Anything else falls back to scraping anchor tags from the page HTML, which
won't work for boards that render jobs purely with JavaScript; those get a
clear status message instead of silently showing zero jobs.
"""
import logging
import re
import threading
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests

from . import database as db

log = logging.getLogger("autoapply.scanner")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
TIMEOUT = 25
MAX_JOBS_PER_COMPANY = 400


class ScanError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat()


def _get(url):
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "*/*"},
                     timeout=TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    return r


def _first_path_seg(url: str) -> str | None:
    parts = [p for p in urlsplit(url).path.split("/") if p]
    return parts[0] if parts else None


# ---------- known ATS boards ----------

def _scan_greenhouse(url):
    token = _first_path_seg(url)
    if not token:
        raise ScanError("Couldn't read the board name from the Greenhouse URL.")
    data = _get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs").json()
    return [{"title": j.get("title") or "",
             "url": j.get("absolute_url") or "",
             "location": (j.get("location") or {}).get("name")}
            for j in data.get("jobs", [])]


def _scan_lever(url):
    token = _first_path_seg(url)
    if not token:
        raise ScanError("Couldn't read the company name from the Lever URL.")
    data = _get(f"https://api.lever.co/v0/postings/{token}?mode=json").json()
    return [{"title": j.get("text") or "",
             "url": j.get("hostedUrl") or "",
             "location": (j.get("categories") or {}).get("location")}
            for j in data]


def _scan_ashby(url):
    token = _first_path_seg(url)
    if not token:
        raise ScanError("Couldn't read the org name from the Ashby URL.")
    data = _get(f"https://api.ashbyhq.com/posting-api/job-board/{token}").json()
    return [{"title": j.get("title") or "",
             "url": j.get("jobUrl") or j.get("applyUrl") or "",
             "location": j.get("location")}
            for j in data.get("jobs", [])]


def _scan_workable(url):
    token = _first_path_seg(url)
    if not token:
        raise ScanError("Couldn't read the account name from the Workable URL.")
    data = _get(f"https://apply.workable.com/api/v1/widget/accounts/{token}").json()
    jobs = []
    for j in data.get("jobs", []):
        loc = ", ".join(x for x in (j.get("city"), j.get("country")) if x) or None
        jobs.append({"title": j.get("title") or "",
                     "url": j.get("url") or j.get("application_url") or "",
                     "location": loc})
    return jobs


def _scan_smartrecruiters(url):
    token = _first_path_seg(url)
    if not token:
        raise ScanError("Couldn't read the company name from the SmartRecruiters URL.")
    data = _get(f"https://api.smartrecruiters.com/v1/companies/{token}/postings").json()
    jobs = []
    for j in data.get("content", []):
        loc = j.get("location") or {}
        loc_s = ", ".join(x for x in (loc.get("city"), loc.get("country")) if x) or None
        jobs.append({"title": j.get("name") or "",
                     "url": f"https://jobs.smartrecruiters.com/{token}/{j.get('id')}",
                     "location": loc_s})
    return jobs


def _scan_recruitee(url):
    host = urlsplit(url).netloc
    data = _get(f"https://{host}/api/offers/").json()
    return [{"title": j.get("title") or "",
             "url": j.get("careers_url") or "",
             "location": j.get("location")}
            for j in data.get("offers", [])]


# ---------- generic HTML fallback ----------

class _LinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []  # (href, text)
        self._href = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            if self._href is not None:
                self._flush()
            self._href = dict(attrs).get("href")
            self._buf = []

    def handle_endtag(self, tag):
        if tag == "a":
            self._flush()

    def handle_data(self, data):
        if self._href is not None:
            self._buf.append(data)

    def _flush(self):
        if self._href:
            text = re.sub(r"\s+", " ", " ".join(self._buf)).strip()
            self.links.append((self._href, text))
        self._href, self._buf = None, []


JOB_PATH_RE = re.compile(
    r"/(job|jobs|career|careers|position|positions|opening|openings|vacanc|"
    r"opportunit|role|roles)(/|-|\b)|gh_jid=|greenhouse\.io|lever\.co|"
    r"ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com", re.I)
TITLE_WORD_RE = re.compile(
    r"\b(engineer|developer|scientist|analyst|manager|designer|architect|"
    r"consultant|intern|devops|sre|administrator|specialist|executive|"
    r"associate|programmer|tester|qa|recruiter|accountant|marketer)\b", re.I)
GENERIC_TEXT = {
    "apply", "apply now", "learn more", "view job", "view jobs", "view all",
    "see all", "see all jobs", "careers", "career", "jobs", "read more",
    "details", "more", "view details", "know more", "open positions",
    "all jobs", "join us", "view opening", "explore",
}


def _scan_html(url):
    resp = _get(url)
    if "text/html" not in (resp.headers.get("Content-Type") or "text/html"):
        raise ScanError("URL didn't return an HTML page.")
    parser = _LinkParser()
    parser.feed(resp.text)
    jobs = []
    for href, text in parser.links:
        if not href or href.startswith(("mailto:", "javascript:", "tel:", "#")):
            continue
        text_clean = text.strip()
        if len(text_clean) < 4 or len(text_clean) > 90:
            continue
        if text_clean.lower() in GENERIC_TEXT:
            continue
        href_abs = urljoin(url, href)
        looks_like_job = bool(JOB_PATH_RE.search(href_abs)) or bool(TITLE_WORD_RE.search(text_clean))
        if not looks_like_job:
            continue
        # Nav links back to the listing page itself aren't postings.
        if href_abs.rstrip("/") == url.rstrip("/"):
            continue
        jobs.append({"title": text_clean, "url": href_abs, "location": None})
    return jobs


def _extract_jobs(url):
    host = urlsplit(url).netloc.lower()
    if "greenhouse.io" in host:
        return _scan_greenhouse(url)
    if "lever.co" in host:
        return _scan_lever(url)
    if "ashbyhq.com" in host:
        return _scan_ashby(url)
    if "workable.com" in host:
        return _scan_workable(url)
    if "smartrecruiters.com" in host:
        return _scan_smartrecruiters(url)
    if "recruitee.com" in host:
        return _scan_recruitee(url)
    return _scan_html(url)


def _norm_url(u: str) -> str | None:
    """Canonical form for dedupe: drop fragments and tracking params."""
    if not u:
        return None
    try:
        parts = urlsplit(u)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query)
                       if not k.lower().startswith("utm_") and k.lower() != "ref"])
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), query, ""))


# ---------- matching against the profile ----------

STOPWORDS = {"and", "the", "for", "with", "etc", "using", "good", "strong",
             "knowledge", "experience", "years", "skills"}
SHORT_OK = {"go", "qa", "ml", "ai", "ui", "ux", "js", "ts", "c#", "c", "r",
            "bi", "db", "os"}
SENIOR_RE = re.compile(
    r"\b(senior|sr\.?|staff|principal|lead|director|head|vp|vice president|"
    r"architect|distinguished)\b", re.I)
JUNIOR_RE = re.compile(
    r"\b(intern(ship)?|trainee|fresher|junior|jr\.?|graduate|apprentice|"
    r"entry[- ]level)\b", re.I)


def build_keywords(profile: dict, extra_keywords: str = "") -> set[str]:
    raw = []
    raw += re.split(r"[,;/|\n]", profile.get("skills") or "")
    raw += re.split(r"[,;/|\n]", extra_keywords or "")
    role = (profile.get("current_role") or "").strip()
    if role:
        raw.append(role)          # full phrase, e.g. "frontend developer"
        raw += role.split()       # plus its words, e.g. "frontend"
    kws = set()
    for k in raw:
        k = k.strip().lower().strip(".")
        if not k or k in STOPWORDS:
            continue
        if len(k) < 3 and k not in SHORT_OK:
            continue
        kws.add(k)
    return kws


def profile_years(profile: dict) -> float | None:
    m = re.search(r"\d+(\.\d+)?", profile.get("experience_years") or "")
    return float(m.group()) if m else None


def match_title(title: str, keywords: set[str], years: float | None):
    """Returns (matched, reason). Keyword hit first, then a seniority sanity check."""
    t = (title or "").lower()
    hits = []
    for k in keywords:
        if " " in k or len(k) > 14:
            if k in t:
                hits.append(k)
        elif re.search(rf"(?<![a-z0-9+#.]){re.escape(k)}(?![a-z0-9+#])", t):
            hits.append(k)
    if not hits:
        return False, None
    if years is not None:
        if years < 4 and SENIOR_RE.search(title) and not JUNIOR_RE.search(title):
            return False, "seniority above your experience"
        if years >= 3 and JUNIOR_RE.search(title):
            return False, "below your experience level"
    return True, ", ".join(sorted(hits)[:6])


# ---------- orchestration ----------

_in_progress: set[int] = set()
_progress_lock = threading.Lock()


def scan_company(company: dict, settings: dict) -> dict:
    """Fetch a company's career page, match jobs, sync to the DB.
    Always records the outcome on the company row, even on failure."""
    cid = company["id"]
    with _progress_lock:
        if cid in _in_progress:
            raise ScanError("A scan for this company is already running.")
        _in_progress.add(cid)
    try:
        return _scan_company_inner(company, settings)
    finally:
        with _progress_lock:
            _in_progress.discard(cid)


def _scan_company_inner(company: dict, settings: dict) -> dict:
    profile = settings.get("profile", {})
    cfg = settings.get("companies", {})
    keywords = build_keywords(profile, cfg.get("match_keywords") or "")
    years = profile_years(profile)

    try:
        raw_jobs = _extract_jobs(company["career_url"])
    except ScanError as e:
        db.update_company(company["id"], {
            "last_scanned_at": _now(), "last_status": "error",
            "last_error": str(e)[:300]})
        raise
    except requests.RequestException as e:
        msg = f"Couldn't reach the page: {e.__class__.__name__}: {e}"
        db.update_company(company["id"], {
            "last_scanned_at": _now(), "last_status": "error",
            "last_error": msg[:300]})
        raise ScanError(msg)
    except ValueError as e:  # bad JSON from an ATS API
        msg = f"Unexpected response from the job board: {e}"
        db.update_company(company["id"], {
            "last_scanned_at": _now(), "last_status": "error",
            "last_error": msg[:300]})
        raise ScanError(msg)

    seen, clean = set(), []
    for j in raw_jobs:
        url = _norm_url(j.get("url"))
        title = re.sub(r"\s+", " ", j.get("title") or "").strip()
        if not url or not title or url in seen:
            continue
        seen.add(url)
        matched, reason = match_title(title, keywords, years)
        clean.append({"title": title[:200], "url": url,
                      "location": (j.get("location") or None),
                      "matched": matched, "match_reason": reason})
        if len(clean) >= MAX_JOBS_PER_COMPANY:
            break

    result = db.sync_company_jobs(company["id"], clean)
    status, error = "ok", None
    if not clean:
        status = "empty"
        error = ("No job links found — the page may load jobs with JavaScript. "
                 "If the company uses Greenhouse/Lever/Workable etc., paste that "
                 "board URL instead.")
    db.update_company(company["id"], {
        "last_scanned_at": _now(), "last_status": status,
        "last_error": error, "jobs_found": len(clean)})
    result["keywords_used"] = len(keywords)
    log.info("Scanned %s: %s found, %s new, %s matched",
             company["name"], result["found"], result["new"], result["matched"])
    return result
