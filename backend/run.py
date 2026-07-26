import os

import uvicorn

if __name__ == "__main__":
    # Hosts inject the port via PORT; locally we default to 8787. Bind to
    # 0.0.0.0 so the app is reachable when deployed (behind the host's HTTPS),
    # or set AUTO_APPLY_HOST=127.0.0.1 to keep it laptop-only.
    try:
        port = int(os.environ.get("PORT") or os.environ.get("AUTO_APPLY_PORT") or "8787")
    except ValueError:
        port = 8787
    host = os.environ.get("AUTO_APPLY_HOST", "0.0.0.0")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
