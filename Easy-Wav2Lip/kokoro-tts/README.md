# kokoro-tts/ — Kokoro-82M 文本转语音（Easy-Wav2Lip 配音）

为 Easy-Wav2Lip 提供配音音频：输入文本 → 生成 24kHz WAV → 直接作 `config.ini` 的 `vocal_file`。

## 快速上手

```bash
# 中文（默认音色 zf_001）
./venv/bin/python kokoro-tts/tts_kokoro.py "你好，欢迎使用口型同步工具。" -o voice.wav

# 英文（默认音色 af_maple）
./venv/bin/python kokoro-tts/tts_kokoro.py --lang en "Hello world" -o en.wav

# 长脚本配音（按句自动分段，防截断）
./venv/bin/python kokoro-tts/tts_kokoro.py -f script.txt --speed 1.1 -o voice.wav

# 查看全部 103 个音色（免联网，✓ 表示已下载）
./venv/bin/python kokoro-tts/tts_kokoro.py --list-voices
```

完整参数见 `--help`。生成后按常规流程跑口型同步：`config.ini` 里 `vocal_file = voice.wav`，然后 `./venv/bin/python run.py`。

## 目录结构

```
kokoro-tts/
├── README.md              本文档
├── tts_kokoro.py          CLI 脚本（单文件，分区注释见文件内 ═══ 分节）
└── models/                模型文件（首次运行自动下载；已 gitignore，随项目整体移动不失效）
    ├── kokoro-v1_1-zh.pth 主模型 312MB（中英双语，82M 参数）
    ├── config.json        模型结构配置 3.2KB
    └── voices/
        ├── zf_001.pt      中文女声（默认）0.5MB
        └── af_maple.pt    英文女声（默认）0.5MB
```

**音色按需下载**：`--voice zf_060` 第一次用时自动下 `voices/zf_060.pt`（0.5MB）。

## 依赖

```bash
pip install "kokoro>=0.9.4" "misaki[en,zh]" soundfile   # 已装进 ./venv
brew install espeak-ng                                    # 英文未知词回退，已装
```

说明：
- 首次 `--lang en` 时 misaki 会自动 pip 安装 spaCy 的 `en_core_web_sm`（12.8MB，已装）
- 中文注音走 jieba + pypinyin（本地词典，无联网）

## 常见问题排障（根因均经实测取证）

| 症状 | 根因 | 对策 |
|---|---|---|
| 生成的声音嘈杂听不懂 | torch 2.1.0 MPS 后端数值失真（A/B 实测：峰值爆表 1.0 + 削波，与 CPU 波形相关度仅 0.27） | 永远用 CPU 推理，`--device mps` 会自动回退 cpu（项目锁 torch 2.1.0 不能升级） |
| 下载卡住/连不上 | 直连 huggingface.co 被墙 | 默认走 `hf-mirror.com`（`HF_ENDPOINT` 环境变量可覆盖） |
| `FileMetadataError` 下载失败 | hf-mirror 对 python(httpx) 客户端返回不带元数据头的 308 | 用 curl 下载（脚本已内置，见 `_download()`） |
| 英文合成报 404 | 该仓库没有原版的 `af_heart` 音色 | 英文默认用 `af_maple`（仓库共 3 个英文音色） |
| 长文本后半截没声音 | kokoro 单段上限 510 音素，中文按换行切分会整段截断 | 按中文标点分句（已内置，`ZH_SPLIT_PATTERN`） |
| Windows/无 curl 环境 | 下载依赖 curl 命令 | 手动下载文件放到 `kokoro-tts/models/` 对应路径（`--help` 里有 URL 结构） |

## 踩坑背景（维护者须知）

1. **为什么不用 `hf_hub_download`**：镜像对 python 客户端的 308 响应缺 `x-repo-commit` 等头，hub 必报错；curl 一切正常。所以模型加载改为 `KModel(config=路径, model=路径)` 本地直载，音色传 `.pt` 路径，彻底绕开 HF 缓存布局（blobs/snapshots 哈希结构对人不友好，已弃用）。
2. **为什么禁用 MPS**：同文本同音色 A/B 对照，MPS 版与 CPU 版波形相关度 0.27 且削波；"CPU+STFT补丁 vs CPU"相关度 0.99 排除了补丁嫌疑，锅在 torch 2.1.0 的 MPS 内核。CUDA 不受影响。
3. **音色清单是静态副本**：`ALL_VOICES`（103 个）取自 HF API，仓库已冻结不再变动；若上游真加了音色，改这一个常量即可。

## 验证命令

```bash
# 语法与参数
./venv/bin/python -m py_compile kokoro-tts/tts_kokoro.py && ./venv/bin/python kokoro-tts/tts_kokoro.py --help

# 单句冒烟测试（应输出：完成: xxx | 时长 x.xx | 采样率 24000Hz）
./venv/bin/python kokoro-tts/tts_kokoro.py "测试音频" -o temp/smoke.wav

# 离线验证（应仍能生成，证明全部文件来自本地 kokoro-tts/models/）
HF_ENDPOINT=http://127.0.0.1:1 ./venv/bin/python kokoro-tts/tts_kokoro.py "离线测试" -o temp/off.wav
```
