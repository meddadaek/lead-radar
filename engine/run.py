"""Start the Lead Radar engine: python run.py  (serves http://127.0.0.1:8030)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("leadradar.server:app", host="127.0.0.1", port=8030, log_level="info")
