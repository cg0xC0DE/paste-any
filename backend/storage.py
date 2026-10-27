"""
Storage module for Paste-Any
Handles jsonl file storage and codes index
"""

import json
import os
import random
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict

# 配置
DATA_DIR = Path(__file__).parent / "data"
PASTES_FILE = DATA_DIR / "pastes.jsonl"
CODES_FILE = DATA_DIR / "codes.json"
EXPIRE_SECONDS = 180  # 提取码有效期


def ensure_data_dir():
    """确保数据目录存在"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not CODES_FILE.exists():
        with open(CODES_FILE, 'w', encoding='utf-8') as f:
            json.dump({}, f)


def generate_code(length: int = 4) -> str:
    """生成随机提取码（字母+数字混合）"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length))


def load_codes() -> Dict[str, str]:
    """加载 codes 索引"""
    ensure_data_dir()
    if not CODES_FILE.exists():
        return {}
    try:
        with open(CODES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {}


def save_codes(codes: Dict[str, str]):
    """保存 codes 索引"""
    with open(CODES_FILE, 'w', encoding='utf-8') as f:
        json.dump(codes, f, indent=2, ensure_ascii=False)


def save_paste(content: str) -> Dict:
    """保存文本，返回提取码信息"""
    ensure_data_dir()

    # 生成提取码
    code = generate_code(4)
    codes = load_codes()

    # 确保提取码不重复
    while code in codes:
        code = generate_code(4)

    # 设置过期时间
    expire_at = datetime.now(timezone.utc).timestamp() + EXPIRE_SECONDS
    expire_at_str = datetime.fromtimestamp(expire_at, tz=timezone.utc).isoformat()

    # 保存到 codes 索引
    codes[code] = expire_at_str
    save_codes(codes)

    # 保存到 jsonl
    record = {
        "code": code,
        "content": content,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expire_at": expire_at_str
    }

    with open(PASTES_FILE, 'a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')

    return {
        "code": code,
        "expires_at": expire_at_str,
        "message": "提取码已生成，180秒内有效"
    }


def get_paste(code: str) -> Optional[Dict]:
    """
    获取文本
    1. 检查 codes.json - code 是否存在且未过期
    2. 从 pastes.jsonl 末尾向前查找
    3. 找到后删除 codes.json 中的记录
    """
    ensure_data_dir()

    codes = load_codes()

    # 检查提取码是否存在
    if code not in codes:
        return None

    # 检查是否过期
    expire_at_str = codes[code]
    try:
        expire_at = datetime.fromisoformat(expire_at_str.replace('+00:00', 'Z')).timestamp()
    except ValueError:
        expire_at = 0

    if datetime.now(timezone.utc).timestamp() > expire_at:
        # 已过期，删除
        del codes[code]
        save_codes(codes)
        return None

    # 从 pastes.jsonl 末尾向前查找
    if not PASTES_FILE.exists():
        return None

    result = None

    try:
        with open(PASTES_FILE, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # 从末尾向前遍历
        for line in reversed(lines):
            try:
                record = json.loads(line.strip())
                if record.get('code') == code:
                    result = {
                        "content": record.get('content', ''),
                        "created_at": record.get('created_at', '')
                    }
                    break
            except json.JSONDecodeError:
                continue
    except FileNotFoundError:
        pass

    # 无论是否找到，都删除 codes.json 中的记录（使用一次后失效）
    if code in codes:
        del codes[code]
        save_codes(codes)

    return result


def cleanup_expired():
    """清理过期的提取码"""
    codes = load_codes()
    now = datetime.now(timezone.utc).timestamp()

    expired = [code for code, expire_at_str in codes.items()
               if datetime.fromisoformat(expire_at_str.replace('+00:00', 'Z')).timestamp() < now]

    for code in expired:
        del codes[code]

    if expired:
        save_codes(codes)

    return len(expired)
