#!/usr/bin/env python3
"""
Tạo câu ví dụ + từ loại + chủ đề cho các từ CVDICT bằng Ollama chạy trên máy bạn.

Cách dùng (chạy trong thư mục gốc của repo):
    ollama pull qwen2.5:7b
    python3 tools/gen_examples.py                      # chạy toàn bộ, tiếp tục từ chỗ dừng
    python3 tools/gen_examples.py --limit 2000         # chỉ làm 2000 từ thông dụng nhất tiếp theo
    python3 tools/gen_examples.py --model qwen2.5:14b  # model khác (chậm hơn, tốt hơn)
    python3 tools/export_examples.py                   # xuất ra data/ để trang web đọc

Kết quả thô lưu ở tools/out/examples.jsonl (mỗi dòng một từ). Có thể dừng (Ctrl+C) và chạy lại bất cứ lúc nào.
Chỉ dùng thư viện chuẩn của Python 3.8+.
"""
import argparse, json, math, os, re, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'cvdict.js')
SKIP = os.path.join(ROOT, 'tools', 'curated_keys.txt')
OUT_DIR = os.path.join(ROOT, 'tools', 'out')
OUT = os.path.join(OUT_DIR, 'examples.jsonl')

POS = ['n', 'v', 'adj', 'adv', 'pron', 'num', 'mw', 'time', 'loc', 'prep', 'conj', 'part', 'aux', 'intj', 'phr']
TOPICS = ['chao', 'nguoi', 'nghe', 'than', 'an', 'nha', 'truong', 'cv', 'mua', 'gt', 'dl', 'dd', 'tg', 'tt', 'dv', 'mota', 'cx',
          'st', 'cn', 'hd', 'so', 'np', 'kb', 'kt', 'pl', 'yh', 'kh', 'vh', 'ls', 'ct', 'tg2', 'qs', 'tt2', 'khac']
TOPIC_HELP = ('chao=chào hỏi; nguoi=con người, gia đình; nghe=nghề nghiệp; than=cơ thể, sức khỏe; an=ăn uống; nha=nhà cửa; '
              'truong=học tập; cv=công việc; mua=mua sắm, tiền; gt=giao thông; dl=du lịch, địa danh; dd=vị trí; tg=thời gian; '
              'tt=thời tiết, thiên nhiên; dv=động/thực vật; mota=mô tả, màu sắc; cx=cảm xúc, tính cách; st=sở thích, thể thao; '
              'cn=công nghệ, internet; hd=hoạt động thường ngày; so=số, đơn vị; np=từ hư ngữ pháp; kt=kinh tế, tài chính; '
              'pl=pháp luật; yh=y học; kh=khoa học, kỹ thuật; vh=văn hóa, nghệ thuật; ls=lịch sử; ct=chính trị, xã hội; '
              'tg2=tôn giáo, triết học; qs=quân sự; tt2=thành ngữ, tục ngữ; khac=khác')

PROMPT = """Bạn là biên tập viên từ điển Trung–Việt cho người Việt học tiếng Trung (ưu tiên tiếng Trung Đài Loan).
Với MỖI từ dưới đây, hãy trả về:
- "pos": từ loại, một trong: {pos}
- "topic": chủ đề, một trong: {topics}
- "t": MỘT câu ví dụ ngắn (6–16 chữ), tự nhiên, dùng đúng nghĩa đã cho, viết bằng chữ PHỒN THỂ và PHẢI chứa nguyên văn từ "{{word}}"
- "s": đúng câu đó viết bằng chữ GIẢN THỂ
- "p": pinyin có dấu thanh của câu, viết theo từ, chữ cái đầu viết hoa
- "v": bản dịch tiếng Việt tự nhiên, chính xác của câu
Giải thích mã chủ đề: {topic_help}

Danh sách từ (id | phồn thể | giản thể | pinyin | nghĩa):
{items}

Chỉ trả về JSON dạng {{"items":[{{"id":..., "pos":"...", "topic":"...", "t":"...", "s":"...", "p":"...", "v":"..."}}, ...]}}, đủ {n} phần tử, cùng thứ tự id."""


def load_cvdict():
    raw = open(DATA, encoding='utf-8').read()
    start = raw.index('CVDICT_DATA=') + len('CVDICT_DATA=')
    data = json.loads(raw[start:raw.rindex(';')])
    rows = []
    for i, line in enumerate(data.split('\n')):
        t, s, py, d = line.split('\t')
        rows.append({'i': i, 't': t, 's': s or t, 'py': py, 'd': d})
    return rows


def commonness(rows):
    """Proxy for frequency: how many other entries contain this word (same idea as the web page)."""
    words = {r['t'] for r in rows}
    cnt = dict.fromkeys(words, 0)
    for r in rows:
        w = r['t']; L = len(w)
        if L < 2:
            continue
        for a in range(L):
            for b in range(a + 1, min(L, a + 4) + 1):
                if b - a == L:
                    continue
                sub = w[a:b]
                if sub in cnt:
                    cnt[sub] += 1
    for r in rows:
        c = cnt.get(r['t'], 0)
        r['f'] = math.log2(1 + c) * (2.2 if len(r['t']) > 1 else 1.4)
        r['name'] = bool(re.match(r'^[A-ZĀÁǍÀĒÉĚÈŌÓǑÒ]', r['py']))
        r['variant'] = bool(re.match(r'^(biến thể|dạng cổ|dị thể)', r['d'], re.I))
    return rows


def ask(url, model, batch, timeout):
    items = '\n'.join(f"{r['i']} | {r['t']} | {r['s']} | {r['py']} | {'; '.join(r['d'].split('/')[:4])}" for r in batch)
    prompt = PROMPT.format(pos=', '.join(POS), topics=', '.join(TOPICS), topic_help=TOPIC_HELP, items=items, n=len(batch))
    body = json.dumps({'model': model, 'prompt': prompt, 'format': 'json', 'stream': False,
                       'options': {'temperature': 0.3, 'num_ctx': 4096}}).encode()
    req = urllib.request.Request(url.rstrip('/') + '/api/generate', data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read().decode('utf-8'))
    return json.loads(resp.get('response', '{}')).get('items', [])


def valid(r, it):
    try:
        ok = (it.get('pos') in POS and it.get('topic') in TOPICS and r['t'] in it['t'] and r['s'] in it['s']
              and 4 <= len(it['t']) <= 40 and it['p'].strip() and it['v'].strip())
        return ok
    except (KeyError, TypeError, AttributeError):
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='qwen2.5:7b')
    ap.add_argument('--url', default='http://localhost:11434')
    ap.add_argument('--batch', type=int, default=6, help='số từ mỗi lần hỏi model')
    ap.add_argument('--limit', type=int, default=0, help='0 = không giới hạn')
    ap.add_argument('--include-names', action='store_true', help='tạo cả cho tên riêng và dạng biến thể')
    ap.add_argument('--timeout', type=int, default=300)
    a = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    rows = commonness(load_cvdict())
    skip = set()
    if os.path.exists(SKIP):
        skip = {l.strip() for l in open(SKIP, encoding='utf-8') if l.strip()}
    done = set()
    if os.path.exists(OUT):
        for l in open(OUT, encoding='utf-8'):
            try:
                done.add(json.loads(l)['i'])
            except Exception:
                pass
    todo = [r for r in rows if r['i'] not in done and (r['t'] + '|' + r['s']) not in skip
            and (a.include_names or not (r['name'] or r['variant']))]
    todo.sort(key=lambda r: (-r['f'], len(r['t']), r['i']))
    if a.limit:
        todo = todo[:a.limit]
    print(f'Đã có {len(done):,} từ. Cần làm {len(todo):,} từ với model {a.model}.', flush=True)

    t0 = time.time(); made = 0; fails = 0
    with open(OUT, 'a', encoding='utf-8') as out:
        k = 0
        while k < len(todo):
            batch = todo[k:k + a.batch]
            try:
                res = ask(a.url, a.model, batch, a.timeout)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as e:
                fails += 1
                print(f'  lỗi gọi model ({e}); thử lại sau 5 giây…', flush=True)
                time.sleep(5)
                if fails > 20:
                    print('Quá nhiều lỗi liên tiếp, dừng lại. Kiểm tra Ollama đang chạy chưa.'); break
                continue
            fails = 0
            by_id = {}
            for it in res if isinstance(res, list) else []:
                try:
                    by_id[int(it.get('id'))] = it
                except (TypeError, ValueError):
                    pass
            retry = []
            for r in batch:
                it = by_id.get(r['i'])
                if it and valid(r, it):
                    out.write(json.dumps({'i': r['i'], 'pos': it['pos'], 'topic': it['topic'], 't': it['t'].strip(),
                                          's': it['s'].strip(), 'p': it['p'].strip(), 'v': it['v'].strip()}, ensure_ascii=False) + '\n')
                    made += 1
                else:
                    retry.append(r)
            out.flush()
            # words the model got wrong are retried once on their own, then skipped
            for r in retry:
                if r.get('_retried'):
                    continue
                r['_retried'] = True
                todo.append(r)
            k += a.batch
            if (k // a.batch) % 10 == 0:
                el = time.time() - t0; rate = made / el if el else 0
                left = (len(todo) - k) / rate / 3600 if rate else 0
                print(f'  {made:,} từ xong · {rate*60:.0f} từ/phút · còn khoảng {left:.1f} giờ', flush=True)
    print(f'Xong đợt này: thêm {made:,} từ. Chạy tools/export_examples.py để cập nhật trang.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nĐã dừng. Chạy lại lệnh cũ để tiếp tục.')
