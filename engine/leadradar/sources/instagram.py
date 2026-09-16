"""Public Instagram profile data through instaloader (no login): followers, posts, bio, website, category.

Instagram throttles anonymous access quickly, so a refusal is reported as Blocked
and the caller can fall back to follower counts parsed from a search snippet.
"""
import re
import threading

from ..http import Blocked

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,24}")
_lock = threading.Lock()
_loader = None


def username_from(url: str) -> str | None:
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", url or "")
    if m and m.group(1).lower() not in ("p", "reel", "reels", "explore", "stories", "accounts"):
        return m.group(1)
    return None


def profile(url_or_user: str) -> dict | None:
    global _loader
    import instaloader

    user = username_from(url_or_user) or url_or_user.strip("@/ ")
    with _lock:
        if _loader is None:
            _loader = instaloader.Instaloader(quiet=True, download_pictures=False, download_videos=False,
                                              save_metadata=False, max_connection_attempts=1, request_timeout=20)
        try:
            p = instaloader.Profile.from_username(_loader.context, user)
        except instaloader.exceptions.ProfileNotExistsException:
            return None
        except instaloader.exceptions.InstaloaderException as e:
            raise Blocked(f"Instagram refused anonymous access ({type(e).__name__})") from e
    bio = p.biography or ""
    return {"username": p.username, "url": f"https://www.instagram.com/{p.username}/", "full_name": p.full_name,
            "followers": p.followers, "following": p.followees, "posts": p.mediacount, "bio": bio[:300],
            "external_url": p.external_url, "business": p.is_business_account, "category": p.business_category_name,
            "emails": sorted({e.lower() for e in EMAIL.findall(bio)})}


def _number(raw: str) -> int:
    raw = raw.strip().replace(" ", "").replace(" ", "")
    mult = 1
    if raw[-1:].lower() in ("k", "m"):
        mult = 1000 if raw[-1:].lower() == "k" else 1_000_000
        raw = raw[:-1]
    raw = raw.replace(",", ".") if mult > 1 else re.sub(r"[.,]", "", raw)
    try:
        return int(float(raw) * mult)
    except ValueError:
        return 0


def stats_from_snippet(text: str) -> dict:
    """'73K followers, 1,366 following, 986 posts' (also seguidores / abonnés / publications)."""
    out = {}
    m = re.search(r"([\d.,\s]+[KkMm]?)\s*(?:followers|seguidores|abonnés|follower)", text or "")
    if m:
        out["followers"] = _number(m.group(1))
    m = re.search(r"([\d.,\s]+[KkMm]?)\s*(?:posts|publicaciones|publications)", text or "")
    if m:
        out["posts"] = _number(m.group(1))
    return out
