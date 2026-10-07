"""wav2Lip 门面：不经 run.py/config.ini，隔离 cwd 直接编排 inference.py。

run.py 的共享可变状态（temp/、last_file.txt、config.ini、输出命名）全部
由此处规避：每段一个独立工作目录（cwd）。追踪缓存是按底模视频身份键控的
目录，仅“完整覆盖底模帧数”的缓存才会 copy-in / copy-out。
"""
import logging
import os
import pickle
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

import config as cfg

log = logging.getLogger("vmate.wav2lip")

# inference.py 的两条互斥 stdout 标志：用于事后佐证子进程到底用了缓存还是重新检测
_DETECTOR_HIT = "Using face detection data from last input"
_DETECTOR_RUN = "detecting face in every frame"


class RenderError(RuntimeError):
    pass


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def probe_height(path: Path) -> int:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return int(out.stdout.strip())


def probe_frames(path: Path) -> int | None:
    """ffprobe 视频流 nb_frames；任何失败或非整数（如 N/A）返回 None，绝不抛出。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=nb_frames", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, check=True)
        return int(out.stdout.strip())
    except Exception:
        return None


def _cache_file(face_video: Path, cache_dir: Path) -> Path | None:
    """缓存文件路径：身份键 = stem+size+mtime_ns；stat 失败返回 None（本次渲染禁用缓存）。"""
    try:
        st = face_video.stat()
    except OSError:
        return None
    return cache_dir / f"{face_video.stem}_{st.st_size}_{st.st_mtime_ns}.pkl"


# tqdm 迭代快照：" 60/121 [00:40<00:41, 1.50it/s]"；text 模式下 \r 已变 \n，逐条可解析
_RATE_RE = re.compile(r"(\d+)/(\d+)\s+\[[^\]]*?,\s*([\d.]+)\s*it/s\]")


def _rate_summary(output: str) -> str:
    """从 tqdm 全量快照历史提取迭代速率样本，观察子进程内部是否越跑越慢。"""
    samples = [float(m.group(3))
               for m in _RATE_RE.finditer(output.replace("\r", "\n"))]
    if not samples:
        return ""
    return (f"首={samples[0]:.2f}it/s 中={samples[len(samples) // 2]:.2f}it/s "
            f"末={samples[-1]:.2f}it/s（样本={len(samples)}）")


def _child_evidence(output: str) -> str:
    """按子进程 stdout 判断人脸检测实际走的路径（子进程不回传结构化状态）。"""
    if _DETECTOR_HIT in output:
        return "命中缓存"
    if _DETECTOR_RUN in output:
        return "全量检测"
    return "无法判定"


def _build_cmd(face_video: Path, audio: Path, out: Path, height: int) -> list[str]:
    return [
        sys.executable, str(cfg.INFERENCE_PY),
        "--face", str(face_video),
        "--audio", str(audio),
        "--outfile", str(out),
        "--checkpoint_path", str(cfg.CHECKPOINTS_DIR / "Wav2Lip_GAN.pth"),
        "--segmentation_path", str(cfg.CHECKPOINTS_DIR / "face_segmentation.pth"),
        "--pads", *cfg.PADS,
        "--out_height", str(height), "--fullres", "1",
        "--quality", cfg.QUALITY,
        "--mask_dilation", cfg.MASK_DILATION,
        "--mask_feathering", cfg.MASK_FEATHERING,
        "--nosmooth", cfg.NOSMOOTH,
        "--debug_mask", "False",
        "--preview_settings", "False",
        "--mouth_tracking", cfg.MOUTH_TRACKING,
    ]


def render(*, face_video: Path, audio: Path, out: Path, timeout: int,
           tracking_cache: Path | None = None,
           on_spawn: Callable | None = None) -> Path:
    """在 out.parent/work/<out.stem> 的隔离 cwd 中渲染一段，成功返回 out。

    tracking_cache 为追踪缓存目录（非单文件）：仅复制完整覆盖底模视频帧数的
    缓存进 cwd，且仅在本地结果完整时按身份键原子落盘；缓存异常一律不影响渲染。
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    work = out.parent / "work" / out.stem
    frames = probe_frames(face_video)
    cache_file = (_cache_file(face_video, tracking_cache)
                  if tracking_cache else None)
    t0 = time.monotonic()
    child_out, child_started, child_done = "", None, None
    try:
        shutil.rmtree(work, ignore_errors=True)
        (work / "temp").mkdir(parents=True)
        # inference.py 模块级按 cwd 读 checkpoints/*.pkl、face_segmentation、mobilenet
        (work / "checkpoints").symlink_to(cfg.CHECKPOINTS_DIR, target_is_directory=True)
        if tracking_cache and frames is None:
            log.info("tracking 缓存禁用：probe_frames(%s) 失败", face_video.name)
        elif tracking_cache and cache_file is None:
            log.info("tracking 缓存禁用：stat(%s) 失败", face_video.name)
        elif tracking_cache:
            try:                        # copy-in：仅完整覆盖的缓存；失败回退到全新检测
                if cache_file.exists():
                    entries = pickle.loads(cache_file.read_bytes())
                    if len(entries) >= frames:
                        log.info("tracking 缓存命中 copy-in %s（entries=%d ≥ frames=%d）",
                                 cache_file.name, len(entries), frames)
                        shutil.copy(cache_file, work / "last_detected_face.pkl")
                    else:
                        log.info("tracking 缓存未采用 %s（entries=%d < frames=%d），"
                                 "本段全量检测", cache_file.name, len(entries), frames)
                else:
                    log.info("tracking 缓存不存在 %s，本段全量检测", cache_file.name)
            except Exception:           # 损坏/读取失败：回退到全新检测，不阻断渲染
                log.info("tracking 缓存不可读 %s，本段全量检测", cache_file.name)

        try:
            height = probe_height(face_video)
        except Exception as exc:
            raise RenderError(
                f"探测视频高度失败 {face_video.name}: {exc}") from exc
        cmd = _build_cmd(face_video, audio, out, height)
        env = {**os.environ, "V_MATE_HEADLESS": "1"}
        proc = subprocess.Popen(cmd, cwd=work, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True)
        child_started = time.monotonic()
        if on_spawn:
            try:
                on_spawn(proc)
            except BaseException:
                proc.kill()              # 钩子出错也绝不孤儿化进程
                proc.communicate()
                raise
        try:
            output, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            raise RenderError(f"渲染超时（>{timeout}s）: {audio.name}") from None
        child_out, child_done = output or "", time.monotonic()
        if proc.returncode != 0 or not out.exists():
            tail = (output or "")[-800:]
            raise RenderError(
                f"渲染失败 exit={proc.returncode} outfile_exists={out.exists()}: {tail}")
        return out
    finally:
        if tracking_cache and frames is not None and cache_file is not None:
            try:                        # copy-out 先于删除；出错不阻断清理
                local = work / "last_detected_face.pkl"
                if (local.exists()
                        and len(pickle.loads(local.read_bytes())) >= frames):
                    cache_file.parent.mkdir(parents=True, exist_ok=True)
                    tmp = cache_file.with_name(
                        f"{cache_file.name}.tmp-{os.getpid()}")
                    shutil.copy(local, tmp)
                    os.replace(tmp, cache_file)
            except Exception:           # 清理阶段任何异常都不得影响渲染结果
                pass
        shutil.rmtree(work, ignore_errors=True)
        try:
            work.parent.rmdir()          # 清掉空的 work/，其他并行段仍在时忽略
        except OSError:
            pass
        now = time.monotonic()
        setup_end = child_started if child_started is not None else now
        child = ((child_done - child_started)
                 if child_started is not None and child_done is not None else 0.0)
        finish_end = child_done if child_done is not None else setup_end
        rates = _rate_summary(child_out)
        if rates:
            log.info("%s 迭代速率 %s", out.name, rates)
        log.info("%s 阶段耗时 setup=%.1fs 子进程=%.1fs 收尾=%.1fs｜人脸检测: %s",
                 out.name, setup_end - t0, child, now - finish_end,
                 _child_evidence(child_out))
