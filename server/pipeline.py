"""流水线编排：TTS 单线程顺序合成，与 N 个渲染线程并行（两层并发）。

顺序保证在源头：chunk.index 在切分时定死，事件永远携带 index，
与哪个 worker 先完成无关。
"""
import logging
import queue
import threading
import time
from pathlib import Path

import config as cfg
import persist
from wav2lip import probe_duration as _default_probe

log = logging.getLogger("vmate.pipeline")


class BroadcastPipeline:
    def __init__(self, tts, renderer, events_by_job: dict, *,
                 workers: int = cfg.RENDER_WORKERS, retry: int = cfg.RETRY,
                 timeout: int = cfg.RENDER_TIMEOUT, probe=None) -> None:
        self.tts = tts
        self.renderer = renderer
        self.events = events_by_job
        self.workers, self.retry, self.timeout = workers, retry, timeout
        self.probe = probe or _default_probe

    def submit(self, job) -> None:
        """立即返回；监督线程负责起线程、收尾、置 job.finished。"""
        threading.Thread(target=self._run, args=(job,), daemon=True).start()

    # ── 内部 ────────────────────────────────────────────────

    def _run(self, job) -> None:
        try:
            if job.cancelled:
                return
            self._orchestrate(job)
            if not job.cancelled:
                # 有段终态失败 → 任务标 failed；job_done 仍表示"整体跑完"
                job.state = ("failed"
                             if any(c.state == "failed" for c in job.chunks)
                             else "done")
                self._publish(job, {"type": "job_done", "total": len(job.chunks)})
        finally:
            job.finished.set()

    def _orchestrate(self, job) -> None:
        audio_q: queue.Queue = queue.Queue()

        def tts_loop() -> None:
            try:
                for chunk in job.chunks:
                    if job.cancelled:
                        break
                    if self._tts_with_retry(job, chunk):
                        audio_q.put(chunk)
            finally:
                for _ in range(self.workers):     # 哨兵必然入队，渲染线程才能退出
                    audio_q.put(None)

        def render_loop() -> None:
            while True:
                item = audio_q.get()
                if item is None:
                    return
                if job.cancelled:
                    continue
                self._render_with_retry(job, item)

        renderers = [threading.Thread(target=render_loop, daemon=True)
                     for _ in range(self.workers)]
        tts_thread = threading.Thread(target=tts_loop, daemon=True)
        for t in renderers:
            t.start()
        tts_thread.start()
        for t in [tts_thread, *renderers]:
            t.join()

    def _tts_with_retry(self, job, chunk) -> bool:
        chunk.transition("tts")
        out = job.dir / f"seg_{chunk.index:03d}.wav"
        last = None
        for attempt in range(1, 2 + self.retry):
            if job.cancelled:
                return False
            t0 = time.monotonic()
            log.info("job %s seg_%03d TTS 开始（第%d次尝试）", job.id, chunk.index, attempt)
            try:
                self.tts.synthesize(chunk.text, out)
                log.info("job %s seg_%03d TTS 完成 %.1fs（第%d次尝试）",
                         job.id, chunk.index, time.monotonic() - t0, attempt)
                return True
            except Exception as exc:              # TTSError 及意外异常统一按失败处理
                log.warning("job %s seg_%03d TTS 失败 %.1fs（第%d次尝试）: %s",
                            job.id, chunk.index, time.monotonic() - t0, attempt, exc)
                last = exc
        chunk.error = str(last)
        chunk.transition("failed")
        self._publish(job, {"type": "job_error", "index": chunk.index,
                            "message": str(last)})
        return False

    def _render_with_retry(self, job, chunk) -> None:
        chunk.transition("rendering")
        wav = job.dir / f"seg_{chunk.index:03d}.wav"
        out = job.dir / f"seg_{chunk.index:03d}.mp4"
        last = None
        for attempt in range(1, 2 + self.retry):
            if job.cancelled:
                return
            t0 = time.monotonic()
            log.info("job %s seg_%03d 渲染开始（第%d次尝试）", job.id, chunk.index, attempt)
            try:
                self.renderer(face_video=cfg.FACE_VIDEO, audio=wav, out=out,
                              timeout=self.timeout,
                              tracking_cache=cfg.TRACKING_CACHE_DIR,
                              on_spawn=job.register_popen)
                log.info("job %s seg_%03d 渲染完成 %.1fs（第%d次尝试）",
                         job.id, chunk.index, time.monotonic() - t0, attempt)
                chunk.duration = float(self.probe(out))
                chunk.transition("ready")
                self._publish(job, {
                    "type": "chunk_ready", "index": chunk.index,
                    "url": f"/media/{job.id}/{out.name}",
                    "duration": chunk.duration, "text": chunk.text,
                })
                self._publish(job, {"type": "progress",
                                    "ready": job.ready_count(),
                                    "total": len(job.chunks)})
                return
            except Exception as exc:
                log.warning("job %s seg_%03d 渲染失败 %.1fs（第%d次尝试）: %s",
                            job.id, chunk.index, time.monotonic() - t0, attempt, exc)
                last = exc
                Path(out).unlink(missing_ok=True)
        chunk.error = str(last)
        chunk.transition("failed")
        self._publish(job, {"type": "job_error", "index": chunk.index,
                            "message": str(last)})

    def _publish(self, job, event: dict) -> None:
        if job.cancelled:
            return
        persist.save_snapshot(job)   # 状态已变更：先落盘再广播，重启可恢复
        # 任务可能已被新任务退役（hubs 中的条目被弹出），此时静默丢弃
        hub = self.events.get(job.id)
        if hub is not None:
            hub.publish(event)
