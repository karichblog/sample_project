# Công Cụ Quy Đổi & Tính Toán Hệ Cơ Số

Ứng dụng web hỗ trợ quy đổi và tính toán giữa các hệ cơ số **Nhị phân (2), Bát phân (8), Thập phân (10), Thập lục phân (16)**, tích hợp biểu diễn số nguyên âm **Bù 2 (Two's Complement)** và chuẩn dấu phẩy động **IEEE 754 (32-bit & 64-bit)**.

## 1. Chạy trực tiếp trên GitHub Pages (Không cần cài đặt)
1. Upload toàn bộ file trong thư mục này lên Repository GitHub của bạn (đảm bảo `index.html` nằm ở thư mục gốc).
2. Vào **Settings -> Pages** trên GitHub.
3. Ở mục **Branch**, chọn `main` và thư mục `/ (root)`, sau đó nhấn **Save**.
4. Truy cập đường link GitHub Pages được cấp để sử dụng ngay.

## 2. Chạy trên máy tính cá nhân với Python (Flask)
```bash
pip install -r requirements.txt
python app.py
```
Sau đó mở trình duyệt tại địa chỉ `http://127.0.0.1:5000`.
