"""后端入口：./venv/bin/python server/main.py"""
import logging
import threading

import uvicorn

from api import create_app


def setup_logging() -> None:
    """stderr 双写：终端/harness 可见 + 固定落项目内 LOG_FILE（自动建目录）。"""
    from config import LOG_DATEFMT, LOG_FORMAT, LOG_FILE

    logging.basicConfig(format=LOG_FORMAT, datefmt=LOG_DATEFMT, level=logging.INFO)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=LOG_DATEFMT))
    logging.getLogger().addHandler(file_handler)


def main() -> None:
    from tts import TTSSession
    from config import DEVICE, LANG, SPEED, VOICE

    setup_logging()
    tts = TTSSession(voice=VOICE, speed=SPEED, lang=LANG, device=DEVICE)
    threading.Thread(target=tts.warmup, daemon=True).start()   # 预热不阻塞启动
    uvicorn.run(create_app(tts=tts), host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
