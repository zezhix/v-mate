"""每个 Job 一个事件中心：工作线程发布，SSE 协程订阅。"""
import asyncio
import json


class JobEvents:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._subs: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, event: dict) -> None:
        """任意线程可调用；事件只投递给当前订阅者，历史事件靠 snapshot 对账。"""
        self._loop.call_soon_threadsafe(self._broadcast, event)

    def _broadcast(self, event: dict) -> None:
        for q in list(self._subs):
            q.put_nowait(event)


def format_sse(event: dict) -> str:
    if event.get("type") == "ping":
        return ": ping\n\n"
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
