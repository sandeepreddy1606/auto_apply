import os

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("AUTO_APPLY_PORT", "8787"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=False)
