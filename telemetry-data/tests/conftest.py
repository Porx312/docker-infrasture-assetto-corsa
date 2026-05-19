import os
import sys

# Ensure telemetry-data package root is on sys.path when running pytest from repo root.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
