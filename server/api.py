"""HTTP 层：任务创建、状态查询、SSE 事件流、静态视频、旧任务退役。"""
import asyncio
import shutil
import uuid
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config as cfg
from events import JobEvents, format_sse
from jobs import Chunk, Job
import persist
from pipeline import BroadcastPipeline
from splitter import split_chunks

HEARTBEAT_SECONDS = 15
CANCEL_WAIT_SECONDS = 10


class CreateJobRequest(BaseModel):
    text: str


class _SafeEvents(JobEvents):
    """JobEvents 外壳：事件循环已关停时丢弃事件，绝不让工作线程崩溃。

    TestClient 不进 with 时逐请求各起一个事件循环、请求结束即关闭；
    此时 call_soon_threadsafe 会抛 RuntimeError。无可投递的订阅者，
    丢弃与"无订阅者"语义一致（snapshot 负责对账）。
    """

    def publish(self, event: dict) -> None:
        try:
            super().publish(event)
        except RuntimeError as exc:
            # 唯一预期来源：events.py 的 call_soon_threadsafe 打到已关停的
            # 事件循环（CPython asyncio.base_events._check_closed 的固定文案）。
            # 消息匹配可靠，其余 RuntimeError 一律抛出，不当静默 bug 吞掉。
            if "Event loop is closed" not in str(exc):
                raise
            # 无可投递的订阅者，丢弃与"无订阅者"语义一致（snapshot 负责对账）


def create_app(tts=None, renderer=None, probe=None) -> FastAPI:
    """装配应用。tts/renderer/probe 可注入假实现供测试。"""
    from wav2lip import probe_duration, render

    app = FastAPI(title="v-mate broadcast pipeline")
    app.state.jobs = {}          # job_id -> Job
    app.state.hubs = {}          # job_id -> JobEvents
    app.state.current_id = None  # 最近一次任务（新任务到达时退役它）
    app.state.pipeline = BroadcastPipeline(
        tts, renderer or render, events_by_job=app.state.hubs,
        probe=probe or probe_duration)

    restored = persist.load_latest(cfg.JOBS_DIR)   # 恢复最近任务；孤儿目录清掉
    if restored is not None:
        app.state.jobs[restored.id] = restored
        app.state.current_id = restored.id

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/jobs", status_code=202)
    async def create_job(req: CreateJobRequest):
        text = req.text.strip()
        if not text:
            raise HTTPException(422, "文本为空")
        await _retire_current(app)
        job = _new_job(text)
        app.state.jobs[job.id] = job
        app.state.hubs[job.id] = _SafeEvents(asyncio.get_running_loop())
        app.state.current_id = job.id
        persist.save_snapshot(job)   # 文本立即持久化，TTS 期间重启也可恢复
        app.state.pipeline.submit(job)
        return {"job_id": job.id,
                "chunks": [{"index": c.index, "text": c.text}
                           for c in job.chunks]}

    @app.get("/api/jobs/current")   # 须先于 /{job_id} 声明，否则被吞成参数
    def jobs_current():
        job = (app.state.jobs.get(app.state.current_id)
               if app.state.current_id else None)
        if job is None:
            raise HTTPException(404, "暂无任务")
        return job.to_dict()

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = app.state.jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "任务不存在")
        return job.to_dict()

    @app.get("/api/jobs/{job_id}/events")
    async def job_events(job_id: str):
        job = app.state.jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "任务不存在")
        hub = app.state.hubs.get(job_id)
        if hub is None:
            # 恢复的任务没有 hub：惰性创建（终态任务发一帧 snapshot 即收流）
            hub = app.state.hubs[job_id] = _SafeEvents(asyncio.get_running_loop())
        q = hub.subscribe()

        async def stream():
            heartbeat = None
            try:
                # 首帧 snapshot：连接/重连与发布竞态的对账基准
                snapshot = job.to_dict()
                yield format_sse({"type": "snapshot", "job": snapshot})
                if snapshot["state"] in ("done", "failed"):
                    # 已终态：无后续事件，直接收流（TestClient 会阻塞到流结束）
                    return
                heartbeat = asyncio.create_task(_heartbeat(q))
                while True:
                    event = await q.get()
                    yield format_sse(event)
                    if event.get("type") == "job_done":
                        return  # 终态事件收流，SSE 连接不悬空
            finally:
                if heartbeat is not None:
                    heartbeat.cancel()
                hub.unsubscribe(q)

        return StreamingResponse(
            stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    app.mount("/media", StaticFiles(directory=cfg.JOBS_DIR), name="media")
    return app


def _new_job(text: str) -> Job:
    job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    job_dir = cfg.JOBS_DIR / job_id
    job_dir.mkdir(parents=True)
    texts = split_chunks(text, cfg.MAX_CHARS)
    return Job(id=job_id, dir=job_dir,
               chunks=[Chunk(i, t) for i, t in enumerate(texts)])


async def _retire_current(app) -> None:
    """退役当前任务：取消 → 等在跑子进程退出 → 删产物目录。"""
    old_id = app.state.current_id
    if old_id is None:
        return
    job = app.state.jobs.pop(old_id, None)
    app.state.hubs.pop(old_id, None)
    app.state.current_id = None
    if job is None:
        return
    job.mark_cancelled()
    await asyncio.to_thread(job.finished.wait, CANCEL_WAIT_SECONDS)
    await asyncio.to_thread(shutil.rmtree, job.dir, True)


async def _heartbeat(q) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        q.put_nowait({"type": "ping"})
