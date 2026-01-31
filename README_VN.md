# Tool Tự Động Làm Trắc Nghiệm Canvas (Thử/Sai - Vét Cạn)

[🇺🇸 English Guide](./README.md)

Đây là Userscript giúp tự động làm bài tập trắc nghiệm trên Canvas bằng phương pháp "Thử và Sai" (Brute-Force). Tool **không cần API Key** của AI (như Gemini/ChatGPT), mà thay vào đó sẽ "học thuộc lòng" đáp án đúng và tránh đáp án sai thông qua các lần làm bài.

## 🚀 Tính năng

*   **Không cần cấu hình**: Cài đặt là chạy, không cần mua API Key.
*   **Hệ thống trí nhớ**: Tự động lưu lại câu trả lời đúng và các câu sai để né.
*   **Chọn ngẫu nhiên (Random)**: Khi gặp câu hỏi mới (chưa biết đáp án), tool sẽ chọn bừa một đáp án (đã loại trừ các đáp án biết là sai).
*   **Harvest (Thu hoạch)**: Quét trang kết quả (Review) để học từ lỗi sai.
*   **Tự động nộp bài (Auto-Submit)**: Khi trả lời xong hết các câu, tool tự bấm nộp.
*   **Ổn định**: Hoạt động tốt ngay cả khi tải lại trang hoặc mạng lag.

## 📥 Cài đặt

1.  Cài tiện ích quản lý Userscript trên trình duyệt:
    *   [Tampermonkey](https://www.tampermonkey.net/) (Khuyên dùng)
    *   Violentmonkey
2.  Tạo một script mới (Create a new script).
3.  Copy toàn bộ nội dung trong file `main.js`.
4.  Dán vào trình soạn thảo của Tampermonkey và Lưu lại (Ctrl+S).

## 🎮 Cách sử dụng

### Giai đoạn 1: Làm bài (Quiz)
1.  Mở bài Quiz trên Canvas.
2.  Bạn sẽ thấy một bảng điều khiển ở góc dưới bên phải màn hình.
3.  **#Q**: Nhập tổng số câu hỏi cần làm.
4.  **Delay(s)**: Nhập thời gian nghỉ giữa mỗi câu (nên để 2-4 giây để tránh bị lỗi hoặc bị phát hiện).
5.  Bấm nút **"🤖 Start Loop"**.
6.  Tool sẽ tự động:
    *   Chọn đáp án đúng (nếu đã thuộc).
    *   Chọn ngẫu nhiên (nếu chưa thuộc, nhưng sẽ né các đáp án sai đã biết).
    *   Chuyển sang câu tiếp theo.
    *   **Tự động nộp bài** khi xong.

### Giai đoạn 2: Học thuộc (Harvest) - Quan trọng!
1.  Sau khi nộp bài xong, hãy vào trang **Xem lại kết quả** (Review / Submission Details), nơi hiện đáp án đúng/sai.
2.  Bấm nút **"📥 Harvest Q/A"** trên bảng điều khiển.
3.  Tool sẽ "đọc" toàn bộ đề và lưu vào bộ nhớ:
    *   **Đáp án đúng**: Lần sau gặp lại sẽ chọn ngay (độ chính xác 100%).
    *   **Đáp án sai**: Lần sau gặp lại sẽ KHÔNG BAO GIỜ chọn nữa.
4.  Làm lại bài Quiz! Điểm số sẽ tăng dần sau mỗi lần làm cho đến khi đạt 100%.

## ⚙️ Các nút chức năng

*   **Start Loop**: Bắt đầu chạy tool.
*   **Stop**: Tạm dừng.
*   **Harvest Q/A**: Bấm nút này ở trang Review để học thuộc đáp án.
*   **Delete data**: Xoá sạch trí nhớ của tool (Reset từ đầu).

## ⚠️ Lưu ý
*   Đây là phương pháp "Thử và Sai". Những lần làm bài đầu tiên điểm sẽ thấp (do chọn bừa).
*   Hãy kiên nhẫn bấm "Harvest" sau mỗi lần nộp bài. Tool càng làm nhiều càng thông minh.
