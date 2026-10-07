"""Job/Chunk 数据模型与状态机：纯逻辑、无 IO，事件与管线都依赖它。"""
import threading
from dataclasses import dataclass, field
from pathlib import Path

_ALLOWED = {
    "pending": {"tts", "failed"},
    "tts": {"rendering", "failed"},
    "rendering": {"ready", "failed"},
    "ready": set(),
    "failed": set(),
}


class InvalidTransition(Exception):
    pass


@dataclass
class Chunk:
    index: int
    text: str
    state: str = "pending"
    duration: float | None = None
    error: str | None = None

    def transition(self, to: str) -> None:
        if to not in _ALLOWED:
            raise InvalidTransition(f"未知状态: {to}")
        if to not in _ALLOWED[self.state]:
            raise InvalidTransition(f"chunk {self.index}: {self.state} -> {to}")
        self.state = to


@dataclass
class Job:
    id: str
    dir: Path
    chunks: list[Chunk]
    state: str = "running"                    # running | done | failed
    cancelled: bool = False
    finished: threading.Event = field(default_factory=threading.Event)
    _popens: list = field(default_factory=list, repr=False)

    def register_popen(self, popen) -> None:
        self._popens.append(popen)

    def mark_cancelled(self) -> None:
        self.cancelled = True
        for p in list(self._popens):
            try:
                p.terminate()
            except Exception:
                pass

    def ready_count(self) -> int:
        return sum(1 for c in self.chunks if c.state == "ready")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "chunks": [
                {
                    "index": c.index,
                    "text": c.text,
                    "state": c.state,
                    "duration": c.duration,
                    "url": f"/media/{self.id}/seg_{c.index:03d}.mp4"
                    if c.state == "ready"
                    else None,
                }
                for c in self.chunks
            ],
        }
