#!/usr/bin/env python3
"""
Kokoro-82M 中文/英文文本转语音 (TTS) 命令行工具。

模型 hexgrad/Kokoro-82M-v1.1-zh（82M 参数，中英双语），输出 24kHz 单声道 WAV，
可直接作为 Easy-Wav2Lip config.ini 的 vocal_file。

快速开始:
    ./venv/bin/python kokoro-tts/tts_kokoro.py "你好，欢迎使用口型同步工具。" -o voice.wav
    ./venv/bin/python kokoro-tts/tts_kokoro.py --lang en "Hello world" -o en.wav
    ./venv/bin/python kokoro-tts/tts_kokoro.py --list-voices

常用参数（--help 查看全部）:
    -f/--text-file  从 UTF-8 文本文件读入（适合配音长脚本）
    -o              输出 WAV 路径（默认 voice.wav）
    --voice         音色名（默认中文 zf_001、英文 af_maple），--list-voices 查看全部
    --lang zh|en    语言，决定默认音色与分句方式
    --speed         语速倍率，1.0 为原速
    --device        auto/cpu/cuda（auto=无 CUDA 用 CPU；MPS 因 torch 2.1 输出失真被禁用）

文件结构:
    kokoro-tts/models/               模型文件目录（首次运行自动下载，随项目整体移动不失效）
      kokoro-v1_1-zh.pth      主模型 312MB
      config.json             模型结构配置 3.2KB
      voices/<音色名>.pt       音色，按需下载每个 0.5MB

依赖: pip install "kokoro>=0.9.4" "misaki[en,zh]" soundfile
排障与设计说明见 kokoro-tts/README.md。
"""

import argparse
import importlib.util
import os
import re
import sys

# 直连 huggingface.co 不通的网络（如国内）默认走 hf-mirror 镜像；
# 如需使用官方源，先导出 HF_ENDPOINT=https://huggingface.co 即可覆盖
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

# ═══════════════════════ 1. 常量 ═══════════════════════

REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"
SAMPLE_RATE = 24000
DEFAULT_OUTPUT = "voice.wav"

# 模型文件都在项目内 kokoro-tts/models/（本脚本用 curl 直下可读路径，不依赖 HF 缓存布局）
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
MODEL_FILE = os.path.join(MODELS_DIR, "kokoro-v1_1-zh.pth")
CONFIG_FILE = os.path.join(MODELS_DIR, "config.json")
VOICES_DIR = os.path.join(MODELS_DIR, "voices")

# 该仓库只有 3 个英文音色：af_maple / af_sol / bf_vale（没有原版仓库的 af_heart）
LANG_DEFAULT_VOICE = {"zh": "zf_001", "en": "af_maple"}

# 中文按句读标点切分：库默认只按换行切，长段落会在 510 音素处被静默截断
ZH_SPLIT_PATTERN = r"[。！？!?；;…\n]+"
EN_SPLIT_PATTERN = r"\n+"

# 音色前缀 -> 语言（zf_/zm_ 中文，af_/am_/bf_/bm_ 英文）
VOICE_LANG_PREFIX = {"a": "en", "b": "en", "z": "zh"}

# 仓库全部音色清单（103 个，自 HF API 提取的静态副本，让 --list-voices 免联网）
ALL_VOICES = (
    "af_maple af_sol bf_vale "
    "zf_001 zf_002 zf_003 zf_004 zf_005 zf_006 zf_007 zf_008 zf_017 zf_018 "
    "zf_019 zf_021 zf_022 zf_023 zf_024 zf_026 zf_027 zf_028 zf_032 zf_036 "
    "zf_038 zf_039 zf_040 zf_042 zf_043 zf_044 zf_046 zf_047 zf_048 zf_049 "
    "zf_051 zf_059 zf_060 zf_067 zf_070 zf_071 zf_072 zf_073 zf_074 zf_075 "
    "zf_076 zf_077 zf_078 zf_079 zf_083 zf_084 zf_085 zf_086 zf_087 zf_088 "
    "zf_090 zf_092 zf_093 zf_094 zf_099 "
    "zm_009 zm_010 zm_011 zm_012 zm_013 zm_014 zm_015 zm_016 zm_020 zm_025 "
    "zm_029 zm_030 zm_031 zm_033 zm_034 zm_035 zm_037 zm_041 zm_045 zm_050 "
    "zm_052 zm_053 zm_054 zm_055 zm_056 zm_057 zm_058 zm_061 zm_062 zm_063 "
    "zm_064 zm_065 zm_066 zm_068 zm_069 zm_080 zm_081 zm_082 zm_089 zm_091 "
    "zm_095 zm_096 zm_097 zm_098 zm_100"
).split()

REQUIRED_MODULES = ["torch", "kokoro", "misaki", "pypinyin", "soundfile"]
INSTALL_HINT = 'pip install "kokoro>=0.9.4" "misaki[en,zh]" soundfile'

# ═══════════════════════ 2. 基础工具 ═══════════════════════


def error(msg: str) -> None:
    print(f"[错误] {msg}", file=sys.stderr)
    sys.exit(1)


def warn(msg: str) -> None:
    print(f"[提示] {msg}", file=sys.stderr)


# ═══════════════════ 3. 参数解析与输入校验 ═══════════════════


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="使用 Kokoro-82M (v1.1-zh) 生成中文/英文语音",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("快速开始:", 1)[1],
    )
    parser.add_argument("text", nargs="?", help="要合成的文本（与 --text-file 二选一）")
    parser.add_argument("-f", "--text-file", help="从 UTF-8 文本文件读入，与位置参数 text 互斥")
    parser.add_argument("-o", "--output", default=DEFAULT_OUTPUT,
                        help=f"输出 WAV 路径（默认 {DEFAULT_OUTPUT}）")
    parser.add_argument("--voice", help="音色名，如 zf_001 / zm_099 / af_maple"
                                        f"（默认：中文 {LANG_DEFAULT_VOICE['zh']}，英文 {LANG_DEFAULT_VOICE['en']}）")
    parser.add_argument("--lang", choices=["zh", "en"], default="zh",
                        help="语言，决定默认音色和文本切分方式（默认 zh）")
    parser.add_argument("--speed", type=float, default=1.0, help="语速倍率，1.0 为原速（默认 1.0）")
    parser.add_argument("--device", default="auto",
                        help="推理设备：auto / cpu / cuda（默认 auto。注：torch 2.1.0 的 "
                             "MPS 后端输出失真已实测验证，指定 mps 会自动回退 cpu）")
    parser.add_argument("--split-pattern", default=None,
                        help="分句正则（默认中文按 。！？； 等标点切，英文按换行切）")
    parser.add_argument("--list-voices", action="store_true", help="列出模型可用音色后退出")
    return parser.parse_args(argv)


def require_deps() -> None:
    missing = [m for m in REQUIRED_MODULES if importlib.util.find_spec(m) is None]
    if missing:
        error(f"缺少依赖: {', '.join(missing)}\n请先安装: {INSTALL_HINT}")


def get_text(args: argparse.Namespace) -> str:
    if args.text and args.text_file:
        error("位置参数 text 和 --text-file 只能二选一")
    if args.text_file:
        try:
            with open(args.text_file, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            error(f"无法读取文本文件 {args.text_file}: {exc}")
    else:
        text = args.text or ""
    text = text.strip()
    if not text:
        error("文本为空，请提供要合成的文字（位置参数或 --text-file）")
    return text


def check_voice_lang(voice: str, args: argparse.Namespace) -> str:
    lang = VOICE_LANG_PREFIX.get(voice[0])
    if lang is None:
        error(f"不支持的音色前缀 {voice!r}，本工具支持 a/b（英文）、z（中文）前缀，"
              "用 --list-voices 查看可用音色")
    if voice not in ALL_VOICES:
        error(f"音色 {voice} 不在内置清单中，用 --list-voices 查看全部 "
              f"{len(ALL_VOICES)} 个音色")
    if args.voice is None:
        return lang  # 用的是 --lang 对应的默认音色，必然一致
    if lang != args.lang:
        warn(f"音色 {voice} 属于{lang}语言，忽略 --lang {args.lang}，按{lang}处理")
    return lang


def resolve_device(spec: str) -> str:
    import torch
    # 实测（同文本同音色 A/B 对照）：torch 2.1.0 的 MPS 后端输出失真——峰值爆表
    # 1.000 且有削波，与 CPU 参考波形相关度仅 0.27（CPU+STFT补丁对照为 0.99，
    # 排除补丁因素），听感嘈杂不可懂。项目锁 torch 2.1.0 不能升级，故本工具
    # 只用 cuda（如有）或 cpu。详见 README 排障表。
    if spec == "mps":
        warn("torch 2.1.0 的 MPS 后端对本模型输出失真（已实测验证），自动回退到 cpu")
        return "cpu"
    if spec == "auto":
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"
    if spec == "cuda" and not torch.cuda.is_available():
        error("--device cuda 指定，但当前环境没有可用的 CUDA GPU")
    if spec not in ("cpu", "cuda"):
        error(f"未知设备 {spec!r}，可选：auto / cpu / cuda")
    return spec


# ═══════════════════ 4. 模型文件下载 ═══════════════════


def _download(repo_rel: str, dest: str) -> None:
    """用 curl 从镜像下载仓库文件到本地可读路径（大小 + sha256 校验）。

    不用 huggingface_hub 的原因：hf-mirror 对 python(httpx) 客户端返回不带
    元数据头（x-repo-commit 等）的 308，hub 会报 FileMetadataError；而 curl
    请求同一 URL 可正常拿到元数据头并下载数据（镜像到 CDN 实测约 13MB/s）。
    """
    import hashlib
    import subprocess
    import tempfile

    endpoint = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com").rstrip("/")
    url = f"{endpoint}/{REPO_ID}/resolve/main/{repo_rel}"

    try:
        head = subprocess.run(["curl", "-sI", "-m", "60", url],
                              capture_output=True, text=True, check=True)
    except FileNotFoundError:
        error(f"未找到 curl 命令，无法自动下载 {repo_rel}，请手动下载 {url} "
              f"保存为 {dest}")
    except subprocess.CalledProcessError as exc:
        error(f"curl 请求失败（{url}）: {exc.stderr.strip()}")

    lines = head.stdout.splitlines()
    if not lines:
        error(f"curl 无响应（{url}）")
    if "404" in lines[0]:
        error(f"仓库中不存在文件: {REPO_ID}/{repo_rel}")

    headers = {}
    for line in lines[1:]:
        key, sep, value = line.partition(":")
        if sep:
            headers[key.strip().lower()] = value.strip()
    etag = (headers.get("x-linked-etag") or headers.get("etag") or "").strip('"')
    if not etag:
        error(f"无法获取文件元数据（{lines[0].strip()}），请手动下载 {url} 保存为 {dest}")

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(dest), suffix=".part")
    os.close(fd)
    print(f"正在下载 {repo_rel}（{endpoint}）...", file=sys.stderr)
    try:
        subprocess.run(["curl", "-sL", "--retry", "3", "-m", "900",
                        "--progress-bar", "-o", tmp_path, url], check=True)
    except subprocess.CalledProcessError as exc:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        error(f"下载失败（{url}）: curl 退出码 {exc.returncode}")

    actual = os.path.getsize(tmp_path)
    try:
        expected = int(headers.get("x-linked-size")
                       or headers.get("content-length") or 0)
    except ValueError:
        expected = 0
    if expected and actual != expected:
        os.remove(tmp_path)
        error(f"下载不完整（{actual}/{expected} 字节），重新运行本命令即可续传")
    if len(etag) == 64:  # LFS 文件（.pth/.pt）校验 sha256
        sha = hashlib.sha256()
        with open(tmp_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                sha.update(chunk)
        if sha.hexdigest() != etag:
            os.remove(tmp_path)
            error("下载文件 sha256 校验失败，请重新运行本命令重试")
    os.replace(tmp_path, dest)
    print(f"{os.path.basename(dest)} 下载完成（{actual / 1e6:.1f} MB）", file=sys.stderr)


def ensure_files(voice: str) -> None:
    """首次使用时把缺失的模型/配置/音色下载到 kokoro-tts/models/（已存在则跳过）。"""
    if not os.path.isfile(CONFIG_FILE):
        _download("config.json", CONFIG_FILE)
    if not os.path.isfile(MODEL_FILE):
        _download("kokoro-v1_1-zh.pth", MODEL_FILE)
    voice_path = os.path.join(VOICES_DIR, f"{voice}.pt")
    if not os.path.isfile(voice_path):
        _download(f"voices/{voice}.pt", voice_path)


def make_en_callable():
    """返回中文管线的 en_callable：把句中英文单词注音成英文 IPA。

    不传时 misaki 的 ZHG2P 把英文段换成占位符 '❓'，而模型词表里没有 '❓'
    （KModel.forward 会把查不到的字符过滤掉），英文单词因此被静默丢掉。
    英文 G2P 与 kokoro 英文管线同构造（含 espeak 兜底），生僻词也不丢。
    """
    from misaki import en, espeak

    try:
        fallback = espeak.EspeakFallback(british=False)
    except Exception:
        fallback = None
    g2p = en.G2P(trf=False, british=False, fallback=fallback, unk="")
    return lambda text: g2p(text)[0]


def list_voices() -> None:
    """列出内置音色清单（103 个，免联网），✓ 标记本地已下载的。"""
    groups = {}
    for v in ALL_VOICES:
        groups.setdefault(v[:2], []).append(v)
    print(f"{REPO_ID} 音色清单（共 {len(ALL_VOICES)} 个，✓=已下载到 kokoro-tts/models/voices/）：")
    for prefix in sorted(groups):
        names = []
        for v in groups[prefix]:
            local = os.path.isfile(os.path.join(VOICES_DIR, f"{v}.pt"))
            names.append(v + ("✓" if local else ""))
        print(f"  {prefix}_* ({len(groups[prefix])}): {' '.join(names)}")


# ═══════════════════ 5. 合成与输出 ═══════════════════


def synthesize(text: str, voice: str, speed: float, lang: str,
               device: str, split_pattern: str):
    import numpy as np
    from kokoro import KModel, KPipeline

    print(f"加载模型 {MODEL_FILE} ...", file=sys.stderr)
    model = KModel(repo_id=REPO_ID, config=CONFIG_FILE,
                   model=MODEL_FILE).to(device).eval()
    pipeline = KPipeline(lang_code="z" if lang == "zh" else "a",
                         repo_id=REPO_ID, model=model, device=device,
                         en_callable=make_en_callable())
    # 音色以 .pt 路径传入：kokoro 的 load_single_voice 对后缀 .pt 的参数直接
    # torch.load，不会走它的 hf_hub_download（其镜像兼容性问题见 _download 注释）
    voice_path = os.path.join(VOICES_DIR, f"{voice}.pt")

    parts = []
    for i, result in enumerate(pipeline(text, voice=voice_path, speed=speed,
                                        split_pattern=split_pattern)):
        if result.audio is None:
            warn(f"第 {i + 1} 段未生成音频（文本无法注音），已跳过")
            continue
        audio = result.audio
        if hasattr(audio, "cpu"):
            audio = audio.cpu().numpy()
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        parts.append(audio)
        preview = re.sub(r"\s+", " ", result.graphemes)[:30]
        print(f"  段 {i + 1}: {len(audio) / SAMPLE_RATE:.2f}s  {preview}", file=sys.stderr)

    if not parts:
        error("没有生成任何音频，请检查输入文本")
    return np.concatenate(parts)


def main(argv=None) -> None:
    args = parse_args(argv)
    require_deps()
    if args.list_voices:
        list_voices()
        return
    if args.speed <= 0:
        error("--speed 必须大于 0")

    text = get_text(args)
    voice = args.voice or LANG_DEFAULT_VOICE[args.lang]
    lang = check_voice_lang(voice, args)

    if lang == "en" and re.search(r"[一-鿿]", text):
        warn("检测到中文字符，但当前按英文处理，建议加 --lang zh")
    elif lang == "zh" and not re.search(r"[一-鿿]", text):
        warn("未检测到中文字符，如需纯英文语音建议加 --lang en")

    device = resolve_device(args.device)
    ensure_files(voice)
    split_pattern = args.split_pattern or (ZH_SPLIT_PATTERN if lang == "zh" else EN_SPLIT_PATTERN)
    audio = synthesize(text, voice, args.speed, lang, device, split_pattern)

    import soundfile as sf
    out_dir = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(out_dir, exist_ok=True)
    sf.write(args.output, audio, SAMPLE_RATE)
    print(f"完成: {args.output} | 时长 {len(audio) / SAMPLE_RATE:.2f}s | "
          f"采样率 {SAMPLE_RATE}Hz | 音色 {voice} | 设备 {device}")


if __name__ == "__main__":
    main()
