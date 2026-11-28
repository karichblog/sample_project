#!/usr/bin/env python3
"""
Xuất tools/out/examples.jsonl (do gen_examples.py tạo) thành các file trang web đọc được:
    data/ai-tags.js      – từ loại + chủ đề của mọi từ đã xử lý (để lọc)
    data/ex/000.js …     – câu ví dụ, chia theo nhóm 1000 từ, trang chỉ tải nhóm cần dùng
Chạy lại mỗi khi muốn cập nhật lên GitHub.
"""
import json, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'out', 'examples.jsonl')
EX_DIR = os.path.join(ROOT, 'data', 'ex')
POS = ['n', 'v', 'adj', 'adv', 'pron', 'num', 'mw', 'time', 'loc', 'prep', 'conj', 'part', 'aux', 'intj', 'phr']
TOPICS = ['chao', 'nguoi', 'nghe', 'than', 'an', 'nha', 'truong', 'cv', 'mua', 'gt', 'dl', 'dd', 'tg', 'tt', 'dv', 'mota', 'cx',
          'st', 'cn', 'hd', 'so', 'np', 'kb', 'kt', 'pl', 'yh', 'kh', 'vh', 'ls', 'ct', 'tg2', 'qs', 'tt2', 'khac']
CODE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
SHARD = 1000

rows = {}
for line in open(SRC, encoding='utf-8'):
    try:
        r = json.loads(line)
        rows[r['i']] = r            # later lines win (lets you fix a word by appending a corrected line)
    except Exception:
        pass
if not rows:
    raise SystemExit('Chưa có dữ liệu trong tools/out/examples.jsonl')

n = max(rows) + 1
tags = ['--'] * n
for i, r in rows.items():
    if r['pos'] in POS and r['topic'] in TOPICS:
        tags[i] = CODE[POS.index(r['pos'])] + CODE[TOPICS.index(r['topic'])]
os.makedirs(EX_DIR, exist_ok=True)
for f in glob.glob(os.path.join(EX_DIR, '*.js')):
    os.remove(f)
with open(os.path.join(ROOT, 'data', 'ai-tags.js'), 'w', encoding='utf-8') as f:
    f.write('/* AI-generated part of speech + topic per CVDICT row (2 chars each). Unreviewed. */\n')
    f.write('window.AI_TAGS=' + json.dumps(''.join(tags)) + ';\n')
shards = {}
for i, r in rows.items():
    shards.setdefault(i // SHARD, {})[i] = [r['t'], r['s'], r['p'], r['v']]
for k, d in shards.items():
    with open(os.path.join(EX_DIR, f'{k:03d}.js'), 'w', encoding='utf-8') as f:
        f.write(f'window.__EX&&__EX({k},' + json.dumps({str(i): v for i, v in d.items()}, ensure_ascii=False, separators=(',', ':')) + ');\n')
print(f'Đã xuất {len(rows):,} từ vào data/ai-tags.js và {len(shards)} file trong data/ex/.')
