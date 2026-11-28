# Tạo ví dụ, từ loại, chủ đề cho từ điển CVDICT bằng AI chạy trên máy bạn

Trang web hiện có **1.990 từ chọn lọc** (soạn tay, có ví dụ) và **~120.000 từ CVDICT** (chỉ có nghĩa).
Các script trong thư mục này dùng **Ollama** trên máy bạn để tạo cho từng từ CVDICT:
một câu ví dụ (phồn thể + giản thể + pinyin + tiếng Việt), từ loại và chủ đề.
Trên trang, các ví dụ này được ghi rõ **"Ví dụ do AI tạo · chưa kiểm duyệt"**.

## 1. Chuẩn bị (một lần)

```bash
# cài Ollama: https://ollama.com  rồi tải model
ollama pull qwen2.5:7b          # cân bằng tốc độ/chất lượng, chạy tốt trên Mac mini M1 16GB
# hoặc: ollama pull qwen2.5:14b # tốt hơn nhưng chậm gấp ~2 lần
```

Cần Python 3.8+ (không cần cài thêm thư viện).

## 2. Chạy (trong thư mục gốc của repo, nơi có `data/cvdict.js`)

```bash
# thử 100 từ thông dụng nhất trước để xem chất lượng
python3 tools/gen_examples.py --limit 100
python3 tools/export_examples.py
# mở trang, chọn bộ lọc Nguồn = "CVDICT có ví dụ AI" để xem kết quả

# hài lòng thì chạy tiếp (có thể dừng bằng Ctrl+C và chạy lại bất cứ lúc nào, sẽ làm tiếp)
python3 tools/gen_examples.py --limit 20000     # 20.000 từ thông dụng tiếp theo
python3 tools/gen_examples.py                   # hoặc toàn bộ
```

- Thứ tự xử lý: từ **thông dụng trước** (ước lượng theo số từ ghép chứa từ đó), bỏ qua tên riêng và dạng biến thể
  (thêm `--include-names` nếu muốn làm cả những từ này), bỏ qua 1.990 từ đã soạn tay (`tools/curated_keys.txt`).
- Script tự kiểm tra kết quả: câu ví dụ phải chứa đúng từ (phồn và giản), từ loại/chủ đề phải hợp lệ.
  Câu không đạt được hỏi lại một lần, vẫn sai thì bỏ qua (lần chạy sau sẽ thử lại).
- Kết quả thô nằm ở `tools/out/examples.jsonl` – hãy commit file này để không mất công.
- Thời gian **ước tính** (chưa đo trên máy bạn): khoảng 5–8 giây/từ với qwen2.5:7b trên Mac mini M1
  → 20.000 từ ≈ 1–2 ngày chạy liên tục; toàn bộ ~95.000 từ phổ thông ≈ 1 tuần.
  Script in tốc độ thực tế sau mỗi 10 lượt.

## 3. Đưa lên GitHub

```bash
python3 tools/export_examples.py     # tạo data/ai-tags.js và data/ex/*.js
git add data/ tools/out/examples.jsonl
git commit -m "Thêm ví dụ AI cho CVDICT"
git push
```

Trang tự nhận dữ liệu mới: bộ lọc **Từ loại / Chủ đề** sẽ áp dụng cả cho các từ CVDICT đã có nhãn AI,
và thẻ từ hiện ví dụ (chỉ tải nhóm 1.000 từ cần dùng, nên trang vẫn nhẹ).

## 4. Sửa một ví dụ sai

Thêm một dòng mới vào cuối `tools/out/examples.jsonl` với cùng `"i"` (số thứ tự của từ trong `data/cvdict.js`)
và nội dung đã sửa, rồi chạy lại `export_examples.py`. Dòng sau luôn ghi đè dòng trước.

## Giấy phép

Dữ liệu từ điển gốc là CVDICT (CC BY-SA 4.0, xem `data/LICENSE-CVDICT.md`).
Ví dụ do AI tạo dựa trên dữ liệu đó nên cũng nên chia sẻ theo CC BY-SA 4.0.
