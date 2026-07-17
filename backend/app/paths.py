import os

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "auto_apply.db")
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")
TELEGRAM_SESSION = os.path.join(DATA_DIR, "telegram")
FRONTEND_DIST = os.path.join(ROOT_DIR, "frontend", "dist")

os.makedirs(DATA_DIR, exist_ok=True)
