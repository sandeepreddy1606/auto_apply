"""Google Form automation without any AI.

Google Forms embed their full question schema in the public viewform HTML as a
JS variable `FB_PUBLIC_LOAD_DATA_`. We parse that JSON, map each question to a
profile field via keyword heuristics, and POST the answers to /formResponse —
the same request the browser makes.

Limitations (surfaced to the UI instead of failing silently):
- Forms that require Google sign-in cannot be submitted programmatically.
- File-upload questions (resume upload) require sign-in; we flag them.
- Grid questions are unsupported and flagged.
"""
import json
import re

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# A minimal UA makes Google return 401 to some public forms as if we were a bot;
# a full browser-like header set gets the same 200 a real Chrome would. Forms
# that genuinely require sign-in still redirect to accounts.google.com (handled).
BROWSER_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

TYPE_NAMES = {
    0: "short_answer",
    1: "paragraph",
    2: "multiple_choice",
    3: "dropdown",
    4: "checkboxes",
    5: "linear_scale",
    7: "grid",
    9: "date",
    10: "time",
    13: "file_upload",
}

# Ordered: first matching rule wins. (patterns are regexes tested on the
# lowercased question title)
FIELD_RULES = [
    (r"first\s*name", "first_name"),
    (r"last\s*name|surname", "last_name"),
    (r"(company|college|institute|university|father|mother|referr?er).{0,12}name", None),
    (r"full\s*name|candidate\s*name|your\s*name|^name\b|\bname\s*[:?]?$", "full_name"),
    (r"e-?mail|mail\s*id", "email"),
    (r"phone|mobile|contact\s*(no|num)|whats\s*app", "phone"),
    (r"resume|\bcv\b|curriculum", "resume_url"),
    (r"linked\s*in", "linkedin"),
    (r"git\s*hub", "github"),
    (r"portfolio|personal\s*website", "portfolio"),
    (r"notice\s*period|how\s*soon.*join|joining", "notice_period"),
    (r"(total|overall|relevant|years?\s*of)\s*.*experience|experience|\byoe\b|\bexp\b", "experience_years"),
    (r"current\s*(ctc|salary|compensation|package)", "current_ctc"),
    (r"expected\s*(ctc|salary|compensation|package)|salary\s*expectation", "expected_ctc"),
    (r"\bctc\b|salary|compensation|package|stipend", "expected_ctc"),
    (r"current\s*(company|organi[sz]ation|employer)|company|organi[sz]ation|employer", "current_company"),
    (r"designation|current\s*(role|position)|job\s*title", "current_role"),
    (r"preferred\s*location", "preferred_location"),
    (r"location|city|based\s*(in|out)", "current_location"),
    (r"relocat", "willing_to_relocate"),
    (r"gender|\bsex\b", "gender"),
    (r"college|university|institute|school", "college"),
    (r"degree|qualification|education", "degree"),
    (r"graduat|passing\s*year|pass\s*out|batch|year\s*of\s*(pass|complet)", "graduation_year"),
    (r"skill|tech\s*stack|technolog", "skills"),
    (r"date\s*of\s*birth|\bdob\b", "date_of_birth"),
    (r"why|cover\s*letter|about\s*(yourself|you)|tell\s*us|describe|motivation|anything\s*else", "cover_note"),
]


class GFormError(Exception):
    pass


def _extract_load_data(html: str):
    m = re.search(r"FB_PUBLIC_LOAD_DATA_\s*=\s*(.*?);\s*</script>", html, re.DOTALL)
    if not m:
        raise GFormError("Could not find form data in the page (form may be closed or require sign-in).")
    return json.loads(m.group(1))


def fetch_form(url: str, timeout: int = 30) -> dict:
    """Fetch and parse a Google Form's public schema."""
    session = requests.Session()
    session.headers.update(BROWSER_HEADERS)
    try:
        resp = session.get(url, timeout=timeout, allow_redirects=True)
    except requests.RequestException as e:
        raise GFormError(f"Could not fetch form: {e}") from e

    final_url = resp.url
    if "accounts.google.com" in final_url:
        raise GFormError("This form requires Google sign-in, so it can't be auto-filled. Open it and apply manually.")
    if resp.status_code in (401, 403):
        raise GFormError("This form is restricted (Google sign-in / organization-only), so it can't be auto-filled. Open it and apply manually.")
    if resp.status_code != 200:
        raise GFormError(f"Form page returned HTTP {resp.status_code}.")
    html = resp.text
    if "This form is no longer accepting responses" in html or "no longer accepting responses" in html:
        raise GFormError("This form is no longer accepting responses.")

    data = _extract_load_data(html)

    try:
        form_block = data[1]
        items = form_block[1] or []
        description = form_block[0] or ""
        title = form_block[8] if len(form_block) > 8 and form_block[8] else (data[3] or "Google Form")
    except (IndexError, TypeError) as e:
        raise GFormError(f"Unexpected form data layout: {e}") from e

    fields = []
    page_count = 1
    for item in items:
        try:
            item_id, q_title, q_desc, q_type = item[0], item[1], item[2], item[3]
        except (IndexError, TypeError):
            continue
        if q_type == 8:  # section break => new page
            page_count += 1
            continue
        entries = item[4] if len(item) > 4 else None
        if not entries:  # text/image/video blocks
            continue
        for entry in entries:
            try:
                entry_id = entry[0]
                options_raw = entry[1]
                required = bool(entry[2]) if len(entry) > 2 else False
            except (IndexError, TypeError):
                continue
            options = []
            if options_raw:
                for opt in options_raw:
                    if isinstance(opt, list) and opt and isinstance(opt[0], str):
                        options.append(opt[0])
            fields.append({
                "item_id": item_id,
                "entry_id": entry_id,
                "title": (q_title or "").strip(),
                "description": (q_desc or "").strip() if q_desc else "",
                "type_code": q_type,
                "type": TYPE_NAMES.get(q_type, f"type_{q_type}"),
                "required": required,
                "options": options,
                "supported": q_type in (0, 1, 2, 3, 4, 5, 9),
            })

    fbzx = None
    m = re.search(r'name="fbzx"\s+value="([^"]+)"', html)
    if m:
        fbzx = m.group(1)

    collects_email = 'name="emailAddress"' in html

    submit_url = re.sub(r"/viewform.*$", "/formResponse", final_url.split("?")[0])
    if not submit_url.endswith("/formResponse"):
        submit_url = final_url.split("?")[0].rstrip("/") + "/formResponse"

    return {
        "title": title,
        "description": description,
        "url": final_url,
        "submit_url": submit_url,
        "fbzx": fbzx,
        "collects_email": collects_email,
        "page_count": page_count,
        "fields": fields,
    }


def _match_option(options: list[str], value: str) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    for opt in options:
        if opt.strip().lower() == v:
            return opt
    for opt in options:
        o = opt.strip().lower()
        if v in o or o in v:
            return opt
    return None


def _profile_value(profile: dict, key: str) -> str:
    if key == "first_name":
        return (profile.get("full_name") or "").split(" ")[0]
    if key == "last_name":
        parts = (profile.get("full_name") or "").split(" ")
        return parts[-1] if len(parts) > 1 else ""
    return str(profile.get(key) or "")


def map_field_to_profile(title: str) -> str | None:
    low = (title or "").lower()
    for pattern, key in FIELD_RULES:
        if re.search(pattern, low):
            return key  # may be None (explicit "don't map" rule)
    return None


def suggest_answers(form: dict, profile: dict) -> dict:
    """Heuristically prefill answers. Returns {entry_key: value}."""
    answers: dict[str, object] = {}
    if form.get("collects_email"):
        answers["emailAddress"] = profile.get("email") or ""

    for f in form["fields"]:
        key = f"entry.{f['entry_id']}"
        mapped = map_field_to_profile(f["title"])
        if not mapped:
            continue
        value = _profile_value(profile, mapped)
        if not value:
            continue

        if f["type_code"] in (0, 1):
            answers[key] = value
        elif f["type_code"] in (2, 3):
            match = _match_option(f["options"], value)
            if match:
                answers[key] = match
        elif f["type_code"] == 4:
            picked = []
            for part in re.split(r"[,/;]| and ", value):
                match = _match_option(f["options"], part.strip())
                if match and match not in picked:
                    picked.append(match)
            if picked:
                answers[key] = picked
        elif f["type_code"] == 5:
            match = _match_option([str(o) for o in f["options"]], value)
            if match:
                answers[key] = match
        elif f["type_code"] == 9 and mapped == "date_of_birth":
            m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", value)
            if m:
                answers[key] = {"year": m.group(1), "month": m.group(2), "day": m.group(3)}
    return answers


def unanswered_required(form: dict, answers: dict) -> list[dict]:
    missing = []
    for f in form["fields"]:
        if not f["required"]:
            continue
        key = f"entry.{f['entry_id']}"
        val = answers.get(key)
        if val in (None, "", []):
            missing.append({"title": f["title"], "type": f["type"],
                            "supported": f["supported"]})
    return missing


def submit_form(form: dict, answers: dict, timeout: int = 30) -> None:
    """POST answers to the form. Raises GFormError on failure."""
    payload: list[tuple[str, str]] = []
    field_by_key = {f"entry.{f['entry_id']}": f for f in form["fields"]}

    for key, value in answers.items():
        if value in (None, "", []):
            continue
        if key == "emailAddress":
            payload.append(("emailAddress", str(value)))
            continue
        field = field_by_key.get(key)
        if field and field["type_code"] == 9 and isinstance(value, dict):
            payload.append((f"{key}_year", str(value.get("year", ""))))
            payload.append((f"{key}_month", str(value.get("month", ""))))
            payload.append((f"{key}_day", str(value.get("day", ""))))
        elif isinstance(value, list):
            for v in value:
                payload.append((key, str(v)))
        else:
            payload.append((key, str(value)))

    pages = form.get("page_count") or 1
    payload.append(("pageHistory", ",".join(str(i) for i in range(pages))))
    payload.append(("fvv", "1"))
    payload.append(("draftResponse", "[]"))
    if form.get("fbzx"):
        payload.append(("fbzx", form["fbzx"]))
        payload.append(("partialResponse", json.dumps([None, None, form["fbzx"]])))

    headers = {
        **BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": form["url"],
    }
    try:
        resp = requests.post(form["submit_url"], data=payload, headers=headers,
                             timeout=timeout, allow_redirects=True)
    except requests.RequestException as e:
        raise GFormError(f"Form submission request failed: {e}") from e

    if resp.status_code != 200:
        raise GFormError(f"Form submission returned HTTP {resp.status_code}.")
    # A successful submit shows the confirmation page; a validation failure
    # re-renders the form itself (which contains FB_PUBLIC_LOAD_DATA_).
    if "FB_PUBLIC_LOAD_DATA_" in resp.text:
        raise GFormError("Google rejected the submission (missing/invalid required answers). Review the answers and retry.")
