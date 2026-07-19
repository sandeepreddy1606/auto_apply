import os

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
# AUTO_APPLY_DATA_DIR lets you run an isolated instance (e.g. for testing)
# without touching your real settings, database or login.
DATA_DIR = os.environ.get("AUTO_APPLY_DATA_DIR") or os.path.join(ROOT_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "auto_apply.db")
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")
AUTH_PATH = os.path.join(DATA_DIR, "auth.json")
RESUMES_DIR = os.path.join(DATA_DIR, "resumes")
TELEGRAM_SESSION = os.path.join(DATA_DIR, "telegram")
FRONTEND_DIST = os.path.join(ROOT_DIR, "frontend", "dist")

os.makedirs(DATA_DIR, exist_ok=True)
