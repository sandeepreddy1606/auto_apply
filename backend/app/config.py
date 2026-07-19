"""Loads environment from a repo-root .env (no external dependency) and exposes
app configuration. Imported early so DATABASE_URL is available before the
database module decides which backend to use."""
import os

from .paths import ROOT_DIR

_ENV_PATH = os.path.join(ROOT_DIR, ".env")


def _load_env() -> None:
    if not os.path.exists(_ENV_PATH):
        return
    try:
        # utf-8-sig strips a leading BOM (e.g. from Notepad / "UTF-8 with BOM"),
        # which would otherwise corrupt the first key name and disable DATABASE_URL.
        with open(_ENV_PATH, "r", encoding="utf-8-sig") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                # Real environment variables take precedence over the file.
                if key and key not in os.environ:
                    os.environ[key] = val
    except OSError:
        pass


_load_env()

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
