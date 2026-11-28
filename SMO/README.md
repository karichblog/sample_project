# Hệ Thống Quản Lý Lớp Học, Điểm Danh & Thi Trực Tuyến Offline (LMS Offline)

Hệ thống web chạy **100% Offline trên mạng nội bộ (LAN)** sử dụng Python Flask, SQLite và WebSocket. Phù hợp triển khai tại trường học, phòng máy tính mà không cần kết nối Internet (Bootstrap và Socket.IO đã được lưu sẵn trong `static/vendor/`).

## Tính năng chính
1. **Quản trị viên (Admin):**
   - Quản lý người dùng & phân quyền (Admin, Giáo viên, Học sinh), khóa/mở khóa, đặt lại mật khẩu.
   - Nhập danh sách tài khoản hàng loạt từ file Excel/CSV (xem `sample_users.csv`).
   - Tạo môn học, phân công giáo viên, tạo lịch nhắc sự kiện và theo dõi nhật ký hệ thống (Audit Log).
2. **Giáo viên (Teacher):** (chỉ thấy và quản lý các lớp mình phụ trách)
   - Điểm danh bằng mã PIN động (tự hết hạn sau 15 phút) hoặc điểm danh thủ công (Có mặt / Đi muộn / Vắng có phép / Vắng không phép).
   - Tạo đề thi trắc nghiệm/tự luận, thiết lập thời gian & mật khẩu phòng thi; xem chi tiết bài làm (kể cả phần tự luận).
   - Tải tài liệu tham khảo cho lớp, xem số học sinh đã học, trao đổi trong phòng chat lớp học.
   - Xuất bảng điểm và bảng điểm danh ra file Excel.
3. **Học sinh (Student):**
   - Điểm danh nhanh bằng mã PIN (mỗi lớp 1 lần/ngày).
   - Đánh dấu tiến độ học tập trên từng tài liệu/bài giảng.
   - Tham gia phòng thi với cơ chế chống gian lận (Fullscreen, cảnh báo chuyển tab, giám sát Webcam, tự động lưu bài vào trình duyệt khi rớt mạng, đồng hồ đếm ngược do máy chủ tính nên tải lại trang không reset thời gian). Mỗi đề chỉ được nộp 1 lần.
   - Tra cứu điểm số, lịch sử chuyên cần và lịch sự kiện.

## Cấu trúc thư mục
```
├── app.py                  # Toàn bộ backend Flask + Socket.IO
├── requirements.txt
├── sample_users.csv        # File mẫu nhập tài khoản hàng loạt
├── templates/              # Giao diện Jinja2
├── static/
│   ├── css/style.css
│   ├── js/exam_anti_cheat.js
│   └── vendor/             # Bootstrap + Socket.IO client (chạy offline)
├── uploads/                # Tài liệu tải lên (không đẩy lên GitHub)
└── instance/               # Tự tạo khi chạy: database.db + secret_key (không đẩy lên GitHub)
```

## Hướng dẫn cài đặt & Chạy Offline

Yêu cầu: **Python 3.10 trở lên**.

### Bước 1: Cài đặt thư viện (cần Internet lần đầu)
```bash
python -m venv venv
# Windows: venv\Scripts\activate    |  macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
```
> Để cài trên máy không có Internet: trên máy có mạng chạy `pip download -r requirements.txt -d wheels`, chép thư mục `wheels` sang rồi chạy `pip install --no-index --find-links wheels -r requirements.txt`.

### Bước 2: Khởi động hệ thống
```bash
python app.py
```
Cơ sở dữ liệu và tài khoản mẫu được tạo tự động ở lần chạy đầu tiên.
Có thể đổi cổng bằng biến môi trường: `PORT=8080 python app.py`.

### Bước 3: Truy cập trên mạng LAN
- Trên máy chủ: Truy cập `http://127.0.0.1:5000`
- Trên các máy học sinh/giáo viên cùng mạng Wi-Fi/LAN: Truy cập `http://<IP_MAY_CHU>:5000` (Ví dụ: `http://192.168.1.100:5000`). Nhớ mở cổng 5000 trên tường lửa của máy chủ.

## Tài khoản mặc định
- **Admin:** `admin` / Mật khẩu: `123`
- **Giáo viên:** `gv1` / Mật khẩu: `123`
- **Học sinh:** `hs1` / Mật khẩu: `123`

> ⚠️ Hãy đổi mật khẩu các tài khoản mặc định (nút **Đổi MK** trong trang Admin) trước khi dùng thật.

## Định dạng đề thi (JSON)
```json
[
  {"id": 1, "level": "Dễ", "type": "mc", "question": "2 + 2 bằng mấy?", "options": ["3", "4", "5"], "answer": "4"},
  {"id": 2, "level": "Khó", "type": "essay", "question": "Trình bày ứng dụng của tích phân."}
]
```
- `type`: `mc` (trắc nghiệm, bắt buộc có `options` và `answer` trùng một lựa chọn) hoặc `essay` (tự luận).
- Điểm tự động (thang 10) chỉ tính phần trắc nghiệm; giáo viên xem phần tự luận qua nút **Xem bài**.

## Bảo mật & lưu ý
- Mật khẩu được băm (hash) bằng `werkzeug.security`; CSDL bản cũ lưu mật khẩu dạng chữ thường sẽ tự được nâng cấp khi người dùng đăng nhập.
- Có chống CSRF cho mọi form/POST, chống XSS trong phòng chat, tên file tải lên được đổi ngẫu nhiên để tránh ghi đè/path traversal.
- `SECRET_KEY` tự sinh và lưu trong `instance/secret_key`; có thể đặt qua biến môi trường `SECRET_KEY`.
- **Webcam:** trình duyệt chỉ cho phép webcam trên `localhost` hoặc HTTPS. Khi học sinh truy cập qua `http://192.168.x.x`, webcam sẽ bị chặn (các cơ chế chống gian lận khác vẫn hoạt động). Muốn dùng webcam qua LAN cần cấu hình HTTPS (ví dụ đặt sau Nginx với chứng chỉ tự ký).
- Server tích hợp phù hợp cho quy mô một trường/phòng máy trong mạng LAN. Hệ thống hiện chưa có chức năng ghi danh học sinh vào từng lớp: mọi học sinh đều thấy mọi lớp.
