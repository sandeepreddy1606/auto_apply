"""SMTP email sending with template rendering and resume attachment."""
import mimetypes
import os
import re
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

_PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")


def render_template(template: str, context: dict) -> str:
    """Replace {key} placeholders; unknown keys become empty strings."""
    def sub(m):
        return str(context.get(m.group(1), "") or "")

    rendered = _PLACEHOLDER_RE.sub(sub, template or "")
    # Drop lines like "LinkedIn:" / "- Notice period:" whose value came out empty.
    kept = []
    for line in rendered.splitlines():
        if re.match(r"^\s*[-•]?\s*[A-Za-z ]{2,30}:\s*$", line):
            continue
        kept.append(line)
    rendered = "\n".join(kept)
    return re.sub(r"\n{3,}", "\n\n", rendered).strip()


def build_context(profile: dict, application: dict) -> dict:
    ctx = dict(profile or {})
    ctx.update({
        "job_title": application.get("job_title") or "the advertised position",
        "company": application.get("company") or "",
        "location": application.get("location") or "",
        "experience": application.get("experience") or "",
    })
    return ctx


def send_email(smtp_cfg: dict, to_addr: str, subject: str, body: str,
               attachment_path: str | None = None) -> None:
    host = (smtp_cfg.get("host") or "").strip()
    port = int(smtp_cfg.get("port") or 587)
    username = (smtp_cfg.get("username") or "").strip()
    password = smtp_cfg.get("password") or ""
    from_name = (smtp_cfg.get("from_name") or "").strip()

    if not host or not username or not password:
        raise ValueError("SMTP is not configured. Set host/username/password in Settings.")
    if not to_addr:
        raise ValueError("No recipient email address.")

    msg = EmailMessage()
    msg["From"] = formataddr((from_name, username)) if from_name else username
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    if attachment_path:
        path = attachment_path.strip().strip('"')
        if not os.path.isfile(path):
            raise ValueError(f"Resume file not found: {path}")
        ctype, _ = mimetypes.guess_type(path)
        maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
        with open(path, "rb") as f:
            msg.add_attachment(f.read(), maintype=maintype, subtype=subtype,
                               filename=os.path.basename(path))

    if smtp_cfg.get("use_ssl") or port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=30) as server:
            server.login(username, password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.login(username, password)
            server.send_message(msg)
