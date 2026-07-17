"""Rule-based (regex + heuristics) parser for job-posting messages.

No AI/LLM involved: extraction relies on label patterns ("Role:", "CTC:"...),
keyword heuristics for job titles, and regexes for emails / Google Form links.
"""
import hashlib
import re

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
GFORM_RE = re.compile(
    r"https?://(?:docs\.google\.com/forms/[^\s\)\]>\"'<]+|forms\.gle/[^\s\)\]>\"'<]+)",
    re.IGNORECASE,
)
URL_RE = re.compile(r"https?://[^\s\)\]>\"'<]+")

# Symbols/emoji commonly decorating telegram job posts.
_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E6-\U0001F1FF"
    "⬀-⯿←-⇿"
    "️‍•▪●✅❗⭐"
    "]+"
)

ROLE_KEYWORDS = [
    "developer", "engineer", "intern", "internship", "analyst", "designer",
    "manager", "tester", "qa", "sde", "architect", "consultant", "scientist",
    "administrator", "devops", "full stack", "fullstack", "frontend",
    "front end", "backend", "back end", "programmer", "lead", "executive",
    "specialist", "associate", "trainee", "recruiter", "support",
]

# label -> list of line-prefix labels ("Label : value")
FIELD_LABELS = {
    "job_title": ["job role", "job title", "role", "position", "profile",
                  "designation", "post", "opening", "hiring for", "title", "job profile"],
    "company": ["company name", "company", "organization", "organisation",
                "firm", "employer", "client"],
    "location": ["work location", "job location", "location", "city", "place",
                 "base location"],
    "experience": ["experience required", "experience", "exp", "yoe",
                   "years of experience"],
    "salary": ["salary", "ctc", "package", "stipend", "compensation", "pay",
               "budget", "salary range"],
    "batch": ["batch", "passout year", "pass out", "eligible batch"],
    "qualification": ["qualification", "education", "eligibility", "degree"],
    "skills": ["skills required", "skill set", "skills", "tech stack",
               "technologies", "must have"],
    "notice_period": ["notice period", "joining", "np"],
    "job_type": ["job type", "employment type", "work mode", "mode", "type"],
    "deadline": ["last date", "deadline", "apply by", "apply before"],
}

_SUBJECT_PATTERNS = [
    re.compile(r"subject\s*line\s*[:\-–]?\s*[\"“']?(.+?)[\"”']?\s*$", re.IGNORECASE),
    re.compile(r"(?:mention|use|put|write)\s+[\"“'](.+?)[\"”']\s+(?:as|in)\s+(?:the\s+)?subject", re.IGNORECASE),
    re.compile(r"subject\s*[:\-–]\s*[\"“']?(.+?)[\"”']?\s*$", re.IGNORECASE),
]


def _clean(text: str) -> str:
    text = _EMOJI_RE.sub(" ", text)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return re.sub(r"\s{2,}", " ", text).strip(" \t*#->:•|–-")


def _clean_value(value: str) -> str:
    value = _clean(value)
    return value.strip(" .;,")[:300]


def _extract_labeled_fields(lines: list[str]) -> dict:
    found: dict[str, str] = {}
    for line in lines:
        stripped = _clean(line)
        if not stripped or ":" not in line and "-" not in line and "–" not in line:
            continue
        m = re.match(r"^\s*([^:\-–]{1,40}?)\s*[:\-–]\s+?(.+)$", stripped) or \
            re.match(r"^\s*([^:]{1,40}?)\s*:\s*(.+)$", stripped)
        if not m:
            continue
        label = m.group(1).strip().lower()
        value = m.group(2).strip()
        if not value:
            continue
        for field, labels in FIELD_LABELS.items():
            if field in found:
                continue
            if any(label == lab or label.endswith(" " + lab) or label.startswith(lab + " ")
                   or label == lab.rstrip("s") for lab in labels):
                found[field] = _clean_value(value)
                break
    return found


def _guess_job_title(lines: list[str]) -> str | None:
    # Patterns like "Hiring for X", "We are hiring X", "X required/needed/wanted"
    joined = "\n".join(lines)
    for pat in [
        r"(?:hiring\s+for|we\s+are\s+hiring|urgently\s+hiring|opening\s+for|"
        r"looking\s+for|requirement\s+for|vacancy\s+for)\s*[:\-–]?\s*(?:an?\s+)?([^\n,.!]{3,80})",
        r"([^\n,.!]{3,80}?)\s+(?:required|needed|wanted|vacancy|opening)\b",
    ]:
        m = re.search(pat, joined, re.IGNORECASE)
        if m:
            candidate = _clean_value(m.group(1))
            if candidate and any(k in candidate.lower() for k in ROLE_KEYWORDS):
                return candidate

    # Otherwise: earliest short-ish line containing a role keyword.
    for line in lines[:10]:
        cleaned = _clean(line)
        low = cleaned.lower()
        if not cleaned or len(cleaned) > 80 or "@" in cleaned or "http" in low:
            continue
        if any(k in low for k in ROLE_KEYWORDS):
            cleaned = re.sub(
                r"^(?:urgent(?:ly)?\s*|hiring\s*|we\s*are\s*hiring\s*|job\s*alert\s*|"
                r"new\s*opening\s*|vacancy\s*)[:\-–]?\s*",
                "", cleaned, flags=re.IGNORECASE)
            return _clean_value(cleaned)
    return None


def _extract_subject_hint(lines: list[str]) -> str | None:
    for line in lines:
        cleaned = _clean(line)
        if "subject" not in cleaned.lower():
            continue
        for pat in _SUBJECT_PATTERNS:
            m = pat.search(cleaned)
            if m:
                subject = m.group(1).strip(" \"'“”.")
                if 2 < len(subject) <= 150:
                    return subject
    return None


def text_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def parse_message(text: str) -> dict:
    """Parse a job posting into structured fields. Pure rules, no AI."""
    lines = [l for l in text.splitlines() if l.strip()]

    emails = []
    for e in EMAIL_RE.findall(text):
        e = e.strip(".,;:")
        if e.lower() not in [x.lower() for x in emails]:
            emails.append(e)

    form_urls = []
    for u in GFORM_RE.findall(text):
        u = u.rstrip(".,;:!?")
        if u not in form_urls:
            form_urls.append(u)

    other_urls = [u.rstrip(".,;:!?") for u in URL_RE.findall(text)
                  if not GFORM_RE.match(u)]

    fields = _extract_labeled_fields(lines)
    if "job_title" not in fields:
        guess = _guess_job_title(lines)
        if guess:
            fields["job_title"] = guess

    subject_hint = _extract_subject_hint(lines)

    if form_urls:
        method = "gform"
    elif emails:
        method = "email"
    else:
        method = "unknown"

    return {
        "method": method,
        "email_to": emails[0] if emails else None,
        "all_emails": emails,
        "form_url": form_urls[0] if form_urls else None,
        "all_form_urls": form_urls,
        "other_urls": other_urls[:10],
        "job_title": fields.get("job_title"),
        "company": fields.get("company"),
        "location": fields.get("location"),
        "experience": fields.get("experience"),
        "salary": fields.get("salary"),
        "subject_hint": subject_hint,
        "extra": {k: v for k, v in fields.items()
                  if k in ("batch", "qualification", "skills", "notice_period",
                           "job_type", "deadline")},
    }
