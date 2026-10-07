"""口播流水线的唯一配置来源（后端不读 Easy-Wav2Lip/config.ini）。"""
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVER_DIR.parent                          # v-mate/
WAV2LIP_DIR = REPO_ROOT / "Easy-Wav2Lip"
INFERENCE_PY = WAV2LIP_DIR / "inference.py"
CHECKPOINTS_DIR = WAV2LIP_DIR / "checkpoints"
KOKORO_DIR = WAV2LIP_DIR / "kokoro-tts"

JOBS_DIR = SERVER_DIR / "var" / "jobs"
TRACKING_CACHE_DIR = SERVER_DIR / "var" / "tracking"   # 按底模视频身份键控的缓存目录

FACE_VIDEO = WAV2LIP_DIR / "asset" / "video3.mp4"
VOICE = "zf_001"
SPEED = 1.4
LANG = "zh"
DEVICE = "auto"

MAX_CHARS = 48
RENDER_WORKERS = 2
RENDER_TIMEOUT = 900
RETRY = 1

# 与原 config.ini 等价的渲染参数（门面内置，不再读配置文件）
PADS = ("0", "20", "0", "0")
QUALITY = "Improved"
MASK_DILATION = "1.5"
MASK_FEATHERING = "5"      # run.py 中 feathering 3→5 的映射结果
NOSMOOTH = "True"
MOUTH_TRACKING = "True"

# 服务端日志：时间戳毫秒级 yyyy-MM-dd HH:mm:ss.SSS
LOG_FORMAT = "%(asctime)s.%(msecs)03d %(levelname)s %(name)s %(message)s"
LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"
LOG_FILE = SERVER_DIR / "var" / "log" / "backend.log"   # 固定落项目内（var/ 已 gitignore）
