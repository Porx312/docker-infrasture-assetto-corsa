"""Bounded evidence queue — no network/Redis I/O in the hot path."""

from __future__ import annotations

import logging
import queue
import threading
from typing import Callable, List, Optional

from anticheat.types import EvidenceEvent

log = logging.getLogger("anticheat.sink")


class BoundedEvidenceSink:
    """Thread-safe bounded queue. On saturation: drop newest + increment drop counter.

    Optional background worker drains to a consumer callback (e.g. structured log).
    Detectores never call this; only the engine enqueues after scoring.
    """

    def __init__(
        self,
        maxsize: int = 256,
        *,
        consumer: Optional[Callable[[EvidenceEvent], None]] = None,
        drop_log_every: int = 50,
        start_worker: bool = False,
    ) -> None:
        self._q: queue.Queue = queue.Queue(maxsize=max(1, int(maxsize)))
        self._consumer = consumer or _default_log_consumer
        self._drop_log_every = max(1, int(drop_log_every))
        self.dropped = 0
        self.enqueued = 0
        self.errors = 0
        self._stop = threading.Event()
        self._worker: Optional[threading.Thread] = None
        if start_worker:
            self.start_worker()

    def start_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._stop.clear()
        self._worker = threading.Thread(
            target=self._run_worker,
            name="anticheat-sink",
            daemon=True,
        )
        self._worker.start()

    def stop(self, *, drain: bool = True, timeout_sec: float = 1.0) -> None:
        if drain:
            self.drain_sync(max_items=self._q.maxsize)
        self._stop.set()
        # Unblock worker waiting on get
        try:
            self._q.put_nowait(None)  # type: ignore[arg-type]
        except queue.Full:
            pass
        if self._worker is not None:
            self._worker.join(timeout=timeout_sec)
            self._worker = None

    def enqueue(self, event: EvidenceEvent) -> bool:
        """Non-blocking enqueue. Returns False if dropped due to saturation."""
        try:
            self._q.put_nowait(event)
            self.enqueued += 1
            return True
        except queue.Full:
            self.dropped += 1
            if self.dropped % self._drop_log_every == 1:
                log.warning(
                    "anticheat sink saturated; dropped=%s queue_max=%s",
                    self.dropped,
                    self._q.maxsize,
                )
            return False

    def drain_sync(self, max_items: Optional[int] = None) -> List[EvidenceEvent]:
        """Synchronously drain up to max_items (for tests / shutdown)."""
        out: List[EvidenceEvent] = []
        limit = max_items if max_items is not None else self._q.qsize() + 8
        for _ in range(max(0, limit)):
            try:
                item = self._q.get_nowait()
            except queue.Empty:
                break
            if item is None:
                continue
            out.append(item)
            try:
                self._consumer(item)
            except Exception:
                self.errors += 1
                log.exception("anticheat sink consumer error")
        return out

    def qsize(self) -> int:
        return self._q.qsize()

    def _run_worker(self) -> None:
        while not self._stop.is_set():
            try:
                item = self._q.get(timeout=0.2)
            except queue.Empty:
                continue
            if item is None:
                if self._stop.is_set():
                    break
                continue
            try:
                self._consumer(item)
            except Exception:
                self.errors += 1
                log.exception("anticheat sink consumer error")


def _default_log_consumer(event: EvidenceEvent) -> None:
    log.info(
        "anticheat_evidence steamId=%s carId=%s serverKey=%s ruleId=%s "
        "type=%s severity=%s score=%.2f sampleId=%s reason=%s",
        event.steam_id,
        event.car_id,
        event.server_key,
        event.rule_id,
        event.anomaly_type,
        event.severity.value,
        event.risk_score,
        event.sample_id,
        event.reason,
    )


class CollectingSink(BoundedEvidenceSink):
    """Test helper: keeps all successfully consumed events in memory."""

    def __init__(self, maxsize: int = 256) -> None:
        self.events: List[EvidenceEvent] = []

        def _collect(ev: EvidenceEvent) -> None:
            self.events.append(ev)

        super().__init__(maxsize=maxsize, consumer=_collect, start_worker=False)


class FailingSink(BoundedEvidenceSink):
    """Test helper: consumer always raises."""

    def __init__(self, maxsize: int = 256) -> None:
        def _boom(_ev: EvidenceEvent) -> None:
            raise RuntimeError("sink failure injected")

        super().__init__(maxsize=maxsize, consumer=_boom, start_worker=False)
