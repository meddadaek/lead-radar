"""One shared headless Chromium for sources that block plain HTTP (Google Maps, Meta Ad Library, Trustpilot...).

Playwright's sync API must stay on the thread that started it, so every job is
sent to a single worker thread and the caller waits for its result.
"""
import queue
import threading
from concurrent.futures import Future

from ..config import BROWSER_UA


class _Browser:
    def __init__(self):
        self.jobs: queue.Queue = queue.Queue()
        self.thread: threading.Thread | None = None
        self.lock = threading.Lock()

    def _loop(self):
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
                context = browser.new_context(user_agent=BROWSER_UA, locale="en-US",
                                              viewport={"width": 1280, "height": 900})
                while True:
                    fn, fut = self.jobs.get()
                    page = context.new_page()
                    try:
                        fut.set_result(fn(page))
                    except Exception as e:  # noqa: BLE001 - hand every failure back to the caller
                        fut.set_exception(e)
                    finally:
                        try:
                            page.close()
                        except Exception:  # noqa: BLE001
                            pass
        except Exception as e:  # noqa: BLE001 - browser failed to start: fail queued jobs
            while not self.jobs.empty():
                _, fut = self.jobs.get_nowait()
                fut.set_exception(e)

    def run(self, fn, timeout: float = 120):
        with self.lock:
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._loop, name="browser", daemon=True)
                self.thread.start()
        fut: Future = Future()
        self.jobs.put((fn, fut))
        return fut.result(timeout=timeout)


browser = _Browser()
