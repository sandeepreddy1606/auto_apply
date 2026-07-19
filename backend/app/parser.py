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

# Lines that introduce an application link ("How to Apply:", "Apply Link -", …).
_APPLY_INTRO_RE = re.compile(
    r"\b(how\s+to\s+apply|apply\s+link|application\s+link|apply\s+here|"
    r"apply\s+now|apply\s+at|to\s+apply|register\s+(?:here|at)|apply)\b", re.IGNORECASE)

_SUBJECT_PATTERNS = [
    re.compile(r"subject\s*line\s*[:\-–]?\s*[\"“']?(.+?)[\"”']?\s*$", re.IGNORECASE),
    re.compile(r"(?:mention|use|put|write)\s+[\"“'](.+?)[\"”']\s+(?:as|in)\s+(?:the\s+)?subject", re.IGNORECASE),
    re.compile(r"subject\s*[:\-–]\s*[\"“']?(.+?)[\"”']?\s*$", re.IGNORECASE),
]


# Forwarded referral posts frequently arrive with their newlines stripped, so
# every "Label - value" runs together on one line. Re-insert a break before each
# known label (and the apply-intro phrases) so line-based extraction works.
_SPLIT_LABELS = [
    "company", "role", "batch", "stipend", "ctc", "salary", "package",
    "location", "experience", "qualifications", "qualification", "eligibility",
    "skills", "deadline", "notice period", "job type", "employment type",
    "work mode", "designation", "position", "department", "duration",
    "how to apply", "apply link", "apply here", "apply now", "jd",
    "must have", "good to have", "responsibilities", "requirements",
    "description", "about the role", "what you'll work on", "what you will",
    "who can apply", "perks", "benefits", "note", "roles and responsibilities",
]
_SPLIT_RE = re.compile(
    r"\s*(?=(?:%s)\s*[-:–])" % "|".join(re.escape(w) for w in _SPLIT_LABELS),
    re.IGNORECASE)


def _normalize_lines(text: str) -> str:
    return _SPLIT_RE.sub("\n", text)


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


def _extract_apply_url(lines: list[str]) -> str | None:
    """The URL the poster points to for applying. Prefers a link that sits on
    (or just after) a 'How to Apply' / 'Apply Link' line, so a JD/description
    link earlier in the post isn't mistaken for the application link."""
    for i, line in enumerate(lines):
        if not _APPLY_INTRO_RE.search(line):
            continue
        same = URL_RE.findall(line)
        if same:
            return same[0].rstrip(".,;:!?")
        for nxt in lines[i + 1:i + 4]:
            found = URL_RE.findall(nxt)
            if found:
                return found[0].rstrip(".,;:!?")
    return None


def split_openings(text: str) -> list[str]:
    """Split a message that lists several jobs into one chunk per opening.

    Referral posts usually repeat a leading label per role ("Company - …" or
    "Role - …"). When such a label appears 2+ times we cut the message at each
    occurrence; otherwise it's a single opening. Conservative on purpose — a
    wrong split is worse than leaving a post whole."""
    norm = _normalize_lines(text)
    lines = norm.split("\n")

    def starts(pattern):
        rx = re.compile(rf"^\s*(?:{pattern})\s*[-:–]", re.IGNORECASE)
        return [i for i, ln in enumerate(lines) if rx.match(ln)]

    company = starts("company|organi[sz]ation|employer")
    role = starts("role|position|profile|designation|opening|post")

    prefix = ""
    if len(company) >= 2:
        bounds = company
    elif len(role) >= 2:
        bounds = role
        # If the company is stated once above the first role, share it with each.
        header = "\n".join(lines[:role[0]])
        if re.search(r"^\s*(?:company|organi[sz]ation|employer)\s*[-:–]", header,
                     re.IGNORECASE | re.MULTILINE):
            prefix = header.strip() + "\n"
    else:
        return [text]

    segments = []
    for a, b in zip(bounds, bounds[1:] + [len(lines)]):
        seg = "\n".join(lines[a:b]).strip()
        if prefix:
            seg = prefix + seg
        if len(seg) >= 15:
            segments.append(seg)

    # Guard against pathological splits; fall back to the whole message.
    if not (2 <= len(segments) <= 25):
        return [text]
    return segments


def text_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def parse_message(text: str) -> dict:
    """Parse a job posting into structured fields. Pure rules, no AI."""
    normalized = _normalize_lines(text)
    lines = [l for l in normalized.splitlines() if l.strip()]

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
    apply_url_hint = _extract_apply_url(lines)

    # Priority: an auto-fillable Google Form, then an HR email, then a plain
    # external application link (company career page / Workday / MS Forms — we
    # can't auto-submit those but we surface the link so the user applies fast).
    apply_url = None
    if form_urls:
        method = "gform"
    elif emails:
        method = "email"
    elif other_urls:
        method = "link"
        apply_url = (apply_url_hint if apply_url_hint and not GFORM_RE.match(apply_url_hint)
                     else other_urls[0])
    else:
        method = "unknown"

    return {
        "method": method,
        "email_to": emails[0] if emails else None,
        "all_emails": emails,
        "form_url": form_urls[0] if form_urls else None,
        "all_form_urls": form_urls,
        "apply_url": apply_url,
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
