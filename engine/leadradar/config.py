import os
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
ROOT = ENGINE.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
DB_PATH = DATA / "leadradar.db"

# Past campaigns: used only as an exclusion list, never shown as leads.
ARCHIVE = Path(r"D:\claudexx\hotel-prospector")
IMPORTER = ROOT / "importer" / "import_existing.py"

BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
TOOL_UA = "LeadRadar/0.1 (local prospecting tool)"

# Everything heavy lives on D: (the C: drive is full).
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", r"D:\ms-playwright")


def secret(name: str) -> str:
    """Read a key from the environment or engine/.env (which the user fills in themselves)."""
    if os.environ.get(name):
        return os.environ[name]
    env = ENGINE / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if k.strip() == name:
                    return v.strip().strip('"').strip("'")
    return ""
