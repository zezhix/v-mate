"""按句切分并贪心合并到每段不超过 max_chars 字。"""
import re

_SENTENCE_END = re.compile(r"(?<=[。！？；!?;…])|\n+")


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_END.split(text)]
    return [p for p in parts if p]


def split_chunks(text: str, max_chars: int = 48) -> list[str]:
    chunks: list[str] = []
    current = ""
    for sentence in split_sentences(text):
        while len(sentence) > max_chars:        # 超长单句按字硬切
            if current:
                chunks.append(current)
                current = ""
            chunks.append(sentence[:max_chars])
            sentence = sentence[max_chars:]
        if current and len(current) + len(sentence) > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current += sentence
    if current:
        chunks.append(current)
    return chunks
