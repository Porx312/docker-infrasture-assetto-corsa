import os
import sys

# CI / local pytest: do not require repo-root .env.local during collection.
os.environ.setdefault("SKIP_ASSETTO_ENV_LOAD", "1")

# Ensure telemetry-data package root is on sys.path when running pytest from repo root.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
