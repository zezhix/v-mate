"""job.json 快照持久化：状态变更落盘 + 启动恢复最近任务。

快照格式 = Job.to_dict()（与 SSE snapshot 完全一致），视频与台词同源恢复，
天然保持滚动歌词与画面一致。jobs.py 保持纯逻辑无 IO，IO 全部收在这里。
"""
import json
import logging
import shutil
import uuid
from pathlib import Path

from jobs import Chunk, Job

log = logging.getLogger("vmate.persist")

SNAPSHOT = "job.json"
_INTERRUPTED = {"pending", "tts", "rendering"}   # 重启时被中断的非终态


def save_snapshot(job) -> None:
    """原子写 job.dir/job.json。取消/任何失败一律忽略，绝不影响渲染。

    每次调用独占临时名（进程+线程+随机），多渲染线程并发写为 last-writer-wins。
    """
    if job.cancelled:
        return
    try:
        job.dir.mkdir(parents=True, exist_ok=True)
        tmp = job.dir / f"{SNAPSHOT}.{uuid.uuid4().hex[:8]}.tmp"
        tmp.write_text(json.dumps(job.to_dict(), ensure_ascii=False),
                       encoding="utf-8")
        tmp.replace(job.dir / SNAPSHOT)
    except Exception as exc:
        log.warning("job %s 快照落盘失败（忽略）: %s", job.id, exc)


def load_latest(jobs_dir) -> Job | None:
    """启动恢复：只保留最近一个含快照的目录，其余（含孤儿）删除。

    中断段按方案 A 修补：pending/tts/rendering → failed；ready 但文件缺失
    → failed。恢复的任务必为终态（有失败段 failed，否则 done）。
    """
    root = Path(jobs_dir)
    root.mkdir(parents=True, exist_ok=True)
    dirs = sorted((d for d in root.iterdir() if d.is_dir()),
                  key=lambda d: d.name)
    latest = next((d for d in reversed(dirs) if (d / SNAPSHOT).exists()), None)
    for d in dirs:
        if d is not latest:
            shutil.rmtree(d, ignore_errors=True)
    if latest is None:
        return None
    return _build(latest)


def _build(d: Path) -> Job | None:
    """从快照重建 Job；快照损坏视为孤儿删除。"""
    try:
        data = json.loads((d / SNAPSHOT).read_text("utf-8"))
        raw = data["chunks"]
    except Exception as exc:
        log.warning("任务目录 %s 快照损坏，按孤儿删除: %s", d.name, exc)
        shutil.rmtree(d, ignore_errors=True)
        return None

    chunks: list[Chunk] = []
    for c in raw:
        state = c.get("state", "pending")
        index = int(c.get("index", len(chunks)))
        duration = c.get("duration")
        error = None
        if state == "ready" and not (d / f"seg_{index:03d}.mp4").exists():
            state, duration = "failed", None       # 死链接降级，绝不给出 404 视频
            error = "视频文件缺失"
        elif state in _INTERRUPTED:
            state, duration = "failed", None       # 中断段不悬置（方案 A）
            error = "服务重启中断"
        chunks.append(Chunk(index=index, text=c.get("text", ""),
                            state=state, duration=duration, error=error))

    job = Job(id=d.name, dir=d, chunks=chunks,
              state="failed" if any(c.state == "failed" for c in chunks)
              else "done")
    job.finished.set()          # 终态任务：退役时无须等待子进程
    return job
