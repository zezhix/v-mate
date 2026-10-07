#!/usr/bin/env python3
"""批量音色合成：同一文本 × 多个音色，模型只加载一次。

逐个调用 tts_kokoro.py 会重复加载 312MB 主模型（每音色一次），本脚本把
模型/Pipeline 的加载提到循环外，音色 .pt 按需下载（复用 tts_kokoro._download）。

用法:
    # 默认：全部中文女声 zf_*，合成到当前目录 zf_*.wav
    ./venv/bin/python kokoro-tts/batch_voices.py "你好，打个招呼吧"

    # 指定音色子集 / 输出目录 / 语速
    ./venv/bin/python kokoro-tts/batch_voices.py "你好" --voices zf_001 zf_002 -o temp/ --speed 1.1
"""

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tts_kokoro as tk  # noqa: E402


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="同一文本批量合成多个音色（模型只加载一次）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("用法:", 1)[1],
    )
    parser.add_argument("text", help="要合成的文本")
    parser.add_argument("--voices", nargs="+",
                        default=[v for v in tk.ALL_VOICES if v.startswith("zf_")],
                        help="音色名列表（默认：全部 55 个中文女声 zf_*）")
    parser.add_argument("-o", "--out-dir", default=".",
                        help="输出目录（默认当前目录，文件名 <音色>.wav）")
    parser.add_argument("--speed", type=float, default=1.0, help="语速倍率（默认 1.0）")
    parser.add_argument("--device", default="auto",
                        help="推理设备 auto/cpu/cuda（默认 auto；MPS 已被禁用）")
    return parser.parse_args(argv)


def build_pipeline(device: str):
    from kokoro import KModel, KPipeline

    print(f"加载模型 {tk.MODEL_FILE} ...", file=sys.stderr)
    model = KModel(repo_id=tk.REPO_ID, config=tk.CONFIG_FILE,
                   model=tk.MODEL_FILE).to(device).eval()
    return KPipeline(lang_code="z", repo_id=tk.REPO_ID, model=model,
                     device=device, en_callable=tk.make_en_callable())


def run(pipeline, text: str, voice: str, speed: float, split_pattern: str):
    import numpy as np

    voice_path = os.path.join(tk.VOICES_DIR, f"{voice}.pt")
    parts = []
    for i, result in enumerate(pipeline(text, voice=voice_path, speed=speed,
                                        split_pattern=split_pattern)):
        if result.audio is None:
            tk.warn(f"{voice} 第 {i + 1} 段未生成音频（文本无法注音），已跳过")
            continue
        audio = result.audio
        if hasattr(audio, "cpu"):
            audio = audio.cpu().numpy()
        parts.append(np.asarray(audio, dtype=np.float32).reshape(-1))
    if not parts:
        tk.error(f"{voice} 没有生成任何音频")
    return np.concatenate(parts)


def main(argv=None) -> None:
    args = parse_args(argv)
    tk.require_deps()
    if args.speed <= 0:
        tk.error("--speed 必须大于 0")

    unknown = [v for v in args.voices if v not in tk.ALL_VOICES]
    if unknown:
        tk.error(f"音色不在内置清单中: {' '.join(unknown)}（--list-voices 查看全部）")

    device = tk.resolve_device(args.device)
    split_pattern = tk.ZH_SPLIT_PATTERN

    import soundfile as sf

    os.makedirs(args.out_dir, exist_ok=True)
    total = len(args.voices)
    for n, voice in enumerate(args.voices, 1):
        tk.ensure_files(voice)  # 缺失的 model/config/voice 自动下载
        if n == 1:
            pipeline = build_pipeline(device)
        audio = run(pipeline, args.text, voice, args.speed, split_pattern)
        out = os.path.join(args.out_dir, f"{voice}.wav")
        sf.write(out, audio, tk.SAMPLE_RATE)
        print(f"[{n}/{total}] {out} | 时长 {len(audio) / tk.SAMPLE_RATE:.2f}s")

    print(f"完成: 共 {total} 个音色 → {args.out_dir}/<音色>.wav")


if __name__ == "__main__":
    main()
