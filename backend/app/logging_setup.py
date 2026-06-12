"""
Centralized logging.

All backend logs go to the console AND to a rotating file at
backend/logs/app.log (5 files x 2 MB). Import and call setup_logging() once
at startup; use logging.getLogger(__name__) everywhere else.
"""
import logging
from logging.handlers import RotatingFileHandler

from app import config

LOG_DIR = config.BASE_DIR / "logs"
LOG_FILE = LOG_DIR / "app.log"

_FMT = "%(asctime)s %(levelname)-7s %(name)s : %(message)s"


def setup_logging(level: int = logging.INFO) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    if any(isinstance(h, RotatingFileHandler) for h in root.handlers):
        return  # already configured (avoid duplicate handlers on --reload)

    root.setLevel(level)
    fmt = logging.Formatter(_FMT)

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        LOG_FILE, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)

    logging.getLogger(__name__).info("Logging initialised -> %s", LOG_FILE)
