"""kokoro TTS 进程内封装：模型单例只加载一次，按段合成写 wav。"""
import sys
from pathlib import Path

import config as cfg

sys.path.insert(0, str(cfg.KOKORO_DIR))
import tts_kokoro as tk  # noqa: E402


class TTSError(RuntimeError):
    pass


class TTSSession:
    def __init__(self, voice: str = cfg.VOICE, speed: float = cfg.SPEED,
                 lang: str = cfg.LANG, device: str = cfg.DEVICE,
                 pipeline_factory=None) -> None:
        self.voice, self.speed, self.lang, self.device = voice, speed, lang, device
        self._factory = pipeline_factory or self._load_pipeline
        self._pipeline = None

    def _load_pipeline(self):
        from kokoro import KModel, KPipeline

        tk.ensure_files(self.voice)
        device = tk.resolve_device(self.device)   # 延迟到真实加载时才 import torch
        model = KModel(repo_id=tk.REPO_ID, config=tk.CONFIG_FILE,
                       model=tk.MODEL_FILE).to(device).eval()
        lang_code = "z" if self.lang == "zh" else "a"
        return KPipeline(lang_code=lang_code, repo_id=tk.REPO_ID,
                         model=model, device=device,
                         en_callable=tk.make_en_callable())

    def warmup(self) -> None:
        if self._pipeline is None:
            self._pipeline = self._factory()

    def synthesize(self, text: str, out: Path) -> Path:
        import numpy as np
        import soundfile as sf

        voice_path = str(Path(tk.VOICES_DIR) / f"{self.voice}.pt")
        parts = []
        try:
            self.warmup()
            for result in self._pipeline(text, voice=voice_path, speed=self.speed,
                                         split_pattern=tk.ZH_SPLIT_PATTERN):
                if result.audio is None:
                    continue
                audio = result.audio
                if hasattr(audio, "cpu"):
                    audio = audio.cpu().numpy()
                parts.append(np.asarray(audio, dtype=np.float32).reshape(-1))
        except Exception as exc:
            raise TTSError(f"合成失败 {text[:30]!r}: {exc}") from exc
        if not parts:
            raise TTSError(f"未生成任何音频: {text[:30]!r}")
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            sf.write(out, np.concatenate(parts), tk.SAMPLE_RATE)
        except Exception as exc:
            raise TTSError(f"写盘失败 {out}: {exc}") from exc
        return out
