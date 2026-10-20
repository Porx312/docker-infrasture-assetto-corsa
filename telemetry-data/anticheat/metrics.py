"""In-process counters for anticheat (no external I/O)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AnticheatMetrics:
    samples_total: int = 0
    samples_disabled: int = 0
    samples_invalid: int = 0
    samples_unusable: int = 0
    samples_ok: int = 0
    anomalies_total: int = 0
    evidence_emitted: int = 0
    score_deduped: int = 0
    sink_enqueued: int = 0
    sink_dropped: int = 0
    sink_errors: int = 0
    leaves_cleared: int = 0
    by_unusable_reason: dict = field(default_factory=dict)
    by_rule_id: dict = field(default_factory=dict)

    def inc_unusable(self, reason: str) -> None:
        self.samples_unusable += 1
        self.by_unusable_reason[reason] = self.by_unusable_reason.get(reason, 0) + 1

    def inc_rule(self, rule_id: str) -> None:
        self.anomalies_total += 1
        self.by_rule_id[rule_id] = self.by_rule_id.get(rule_id, 0) + 1

    def snapshot(self) -> dict:
        return {
            "samples_total": self.samples_total,
            "samples_disabled": self.samples_disabled,
            "samples_invalid": self.samples_invalid,
            "samples_unusable": self.samples_unusable,
            "samples_ok": self.samples_ok,
            "anomalies_total": self.anomalies_total,
            "evidence_emitted": self.evidence_emitted,
            "score_deduped": self.score_deduped,
            "sink_enqueued": self.sink_enqueued,
            "sink_dropped": self.sink_dropped,
            "sink_errors": self.sink_errors,
            "leaves_cleared": self.leaves_cleared,
            "by_unusable_reason": dict(self.by_unusable_reason),
            "by_rule_id": dict(self.by_rule_id),
        }
