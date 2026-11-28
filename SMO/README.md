# Sổ Lớp Offline: quản lý lớp học, điểm danh & thi

Ứng dụng web **chạy hoàn toàn trong trình duyệt**, không cần máy chủ, không cần cài Python, không cần Internet.
Chỉ cần mở link GitHub Pages (hoặc mở file `index.html`) là dùng được ngay.

👉 **Dùng thử:** `https://<tên-github-của-bạn>.github.io/<tên-repo>/`

## Tài khoản mẫu
Mật khẩu của các tài khoản mẫu đều là `123`.

| Vai trò | Tài khoản |
|---|---|
| Quản trị | `admin` |
| Giáo viên | `gv1` |
| Học sinh | `hs1`, `hs2` |

> 💡 Mỗi tab trình duyệt là một phiên đăng nhập riêng. Mở 1 tab đăng nhập giáo viên và 1 tab đăng nhập học sinh để thử điểm danh PIN và chat: các tab tự cập nhật cho nhau ngay lập tức.

## Tính năng
**Quản trị viên**
- Tạo, khóa/mở khóa tài khoản và đặt lại mật khẩu; nhập hàng loạt từ Excel/CSV (xem `sample_users.csv`).
- Tạo lớp và phân công giáo viên, lịch nhắc sự kiện, nhật ký hệ thống.
- **Sao lưu / khôi phục** toàn bộ dữ liệu ra file `.json` (kể cả tài liệu đã tải lên).

**Giáo viên** (chỉ quản lý lớp của mình)
- Điểm danh bằng mã PIN 6 số (tự hết hạn sau 15 phút) hoặc điểm danh thủ công (Có mặt / Đi muộn / Vắng có phép / Vắng không phép).
- Tạo đề thi trắc nghiệm/tự luận bằng JSON, đặt thời gian và mật khẩu phòng thi; xem chi tiết bài làm.
- Tải tài liệu cho lớp, xem số học sinh đã học, chat với lớp.
- Xuất bảng điểm và bảng điểm danh ra Excel.

**Học sinh**
- Điểm danh bằng PIN (1 lần/lớp/ngày), đánh dấu đã học tài liệu, chat.
- Làm bài thi có chống gian lận: toàn màn hình, cảnh báo khi chuyển tab (3 lần thì tự nộp bài), webcam giám sát, chặn copy/chuột phải.
- Bài làm tự lưu nên tải lại trang không mất bài; đồng hồ không bị reset; mỗi đề chỉ nộp 1 lần.
- Xem điểm, lịch sử chuyên cần, lịch sự kiện.

## Đăng lên GitHub Pages
1. Tạo repository mới trên GitHub và đưa toàn bộ file trong thư mục này lên (file `index.html` phải nằm ở thư mục gốc):
   ```bash
   git init
   git add .
   git commit -m "LMS Offline"
   git branch -M main
   git remote add origin https://github.com/<tên-github>/<tên-repo>.git
   git push -u origin main
   ```
2. Vào **Settings → Pages**, mục *Source* chọn **Deploy from a branch**, chọn nhánh `main` và thư mục `/ (root)`, rồi bấm **Save**.
3. Đợi khoảng 1 phút, trang sẽ có tại `https://<tên-github>.github.io/<tên-repo>/`.

**Chạy không cần Internet:**
- Sau lần mở đầu tiên, trình duyệt đã lưu sẵn ứng dụng nên vẫn mở được khi mất mạng. Trên điện thoại/Chrome có thể chọn "Cài đặt ứng dụng" / "Thêm vào màn hình chính".
- Hoặc tải repo về (Code → Download ZIP), giải nén rồi nhấp đúp `index.html`.

## ⚠️ Cần biết: dữ liệu lưu ở đâu?
- Mọi dữ liệu (tài khoản, điểm danh, điểm thi, tài liệu) **chỉ lưu trong trình duyệt của máy đang dùng** (localStorage + IndexedDB). Không có máy chủ nào nhận dữ liệu.
- Mỗi máy / mỗi trình duyệt có **dữ liệu riêng**. Học sinh làm trên máy của mình thì giáo viên ở máy khác **không thấy**. Phù hợp khi cả lớp dùng chung một máy (VD: máy giáo viên đặt ở cửa lớp để học sinh điểm danh, phòng máy dùng chung), hoặc để demo/học tập.
- Muốn chuyển dữ liệu sang máy khác: Admin bấm **Tải file sao lưu**, rồi **Khôi phục** trên máy kia.
- Xóa dữ liệu duyệt web hoặc dùng chế độ ẩn danh sẽ làm mất dữ liệu, nên hãy sao lưu thường xuyên.
- Vì chạy hoàn toàn phía trình duyệt, người rành kỹ thuật có thể sửa dữ liệu bằng công cụ DevTools. Mật khẩu được băm (SHA-256 + salt), nhưng không nên dùng hệ thống này cho kỳ thi quan trọng.

## Định dạng đề thi (JSON)
```json
[
  {"id": 1, "level": "Dễ", "type": "mc", "question": "2 + 2 bằng mấy?", "options": ["3", "4", "5"], "answer": "4"},
  {"id": 2, "level": "Khó", "type": "essay", "question": "Trình bày ứng dụng của tích phân."}
]
```
- `type`: `mc` (trắc nghiệm, bắt buộc có `options` và `answer` trùng một lựa chọn) hoặc `essay` (tự luận).
- Điểm tự động (thang 10) chỉ tính phần trắc nghiệm; giáo viên xem phần tự luận qua nút **Xem bài**.

## Cấu trúc thư mục
```
├── index.html          # Trang chính (mở file này là chạy)
├── js/store.js         # Lưu trữ dữ liệu, băm mật khẩu, dữ liệu mẫu
├── js/app.js           # Giao diện & toàn bộ chức năng
├── css/style.css       # Giao diện "vở ô ly & bảng xanh" (ghi đè Bootstrap 5)
├── vendor/             # Bootstrap, SheetJS (Excel), font Be Vietnam Pro: lưu sẵn để chạy offline
├── sw.js, manifest.json  # Cho phép dùng offline / cài như ứng dụng
├── sample_users.csv    # File mẫu nhập tài khoản
└── .nojekyll           # Để GitHub Pages phục vụ file nguyên trạng
```
