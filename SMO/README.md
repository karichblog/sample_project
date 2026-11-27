# Hệ Thống Quản Lý Lớp Học, Điểm Danh & Thi Trực Tuyến Offline (LMS Offline)

Hệ thống web chạy **100% Offline trên mạng nội bộ (LAN)** sử dụng Python Flask, SQLite và WebSocket. Phù hợp triển khai tại trường học, phòng máy tính mà không cần kết nối Internet.

## Tính năng chính
1. **Quản trị viên (Admin):**
   - Quản lý người dùng & phân quyền (Admin, Giáo viên, Học sinh).
   - Nhập danh sách tài khoản hàng loạt từ file Excel/CSV.
   - Tạo môn học, phân công giáo viên, tạo lịch nhắc sự kiện và theo dõi nhật ký hệ thống (Audit Log).
2. **Giáo viên (Teacher):**
   - Điểm danh lớp học theo thời gian thực bằng mã PIN động hoặc thủ công.
   - Tạo đề thi trắc nghiệm/tự luận, thiết lập thời gian & mật khẩu phòng thi.
   - Tải tài liệu tham khảo cho lớp và trao đổi trực tiếp trong phòng chat lớp học.
   - Xuất báo cáo điểm thi ra file Excel.
3. **Học sinh (Student):**
   - Điểm danh nhanh bằng mã PIN.
   - Đánh dấu tiến độ học tập trên từng tài liệu/bài giảng.
   - Tham gia phòng thi với cơ chế chống gian lận (bắt buộc Fullscreen, cảnh báo chuyển tab, giám sát Webcam, tự động lưu bài vào trình duyệt khi rớt mạng).
   - Tra cứu điểm số, lịch sử chuyên cần và lịch sự kiện.

## Hướng dẫn cài đặt & Chạy Offline

### Bước 1: Cài đặt thư viện
Mở Terminal / CMD tại thư mục dự án và chạy lệnh:
```bash
pip install -r requirements.txt
```

### Bước 2: Khởi động hệ thống
```bash
python app.py
```

### Bước 3: Truy cập trên mạng LAN
- Trên máy chủ: Truy cập `http://127.0.0.1:5000`
- Trên các máy học sinh/giáo viên cùng mạng Wi-Fi/LAN: Truy cập `http://<IP_MAY_CHU>:5000` (Ví dụ: `http://192.168.1.100:5000`)

## Tài khoản mặc định
- **Admin:** `admin` / Mật khẩu: `123`
- **Giáo viên:** `gv1` / Mật khẩu: `123`
- **Học sinh:** `hs1` / Mật khẩu: `123`
