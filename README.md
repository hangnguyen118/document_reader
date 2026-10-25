# Folio — document reading & English learning

Ứng dụng Next.js đọc tài liệu và học từ vựng: giao diện tiếng Anh, trích xuất chữ trên thiết bị, TTS trình duyệt và dịch Anh → Việt hoàn toàn cục bộ. Flashcards và câu hỏi dùng những từ người dùng đã lưu.

## Chạy ứng dụng

Yêu cầu Node.js **22.15 trở lên** và npm. Phiên bản này hỗ trợ giải nén zstd khi chuẩn bị model Mozilla lần đầu.

```powershell
npm install
npm run dev
```

Mở **http://localhost:3001**. Để chạy production:

```bash
npm run build
npm run start
```

Install/dev/build chuẩn bị PDF worker và các tệp dịch cục bộ. Nếu tệp đã có và đúng SHA-256, bước chuẩn bị không cần mạng. Khi thiếu tệp, script tải đúng phiên bản đã khóa từ nguồn Mozilla; không tải thư viện dịch từ CDN trong lúc người dùng dịch. Triển khai phải bao gồm toàn bộ thư mục `public/translation`.

Thư viện `@hangnguyen1902/theme` dùng đúng phiên bản 0.1.0 từ npm.

## Các luồng chính

- Tên sách: nút **Edit Book Name** trên sách tải lên trong Library/Favorites và Reader; tên được cắt khoảng trắng đầu/cuối, tối đa 200 ký tự và lưu trong cùng dữ liệu sách. Tên mới được giữ khi tải lại hoặc mở lại sách; Vocabulary hiển thị và tìm kiếm theo tên sách hiện tại.
- Library/Favorites: tìm kiếm, lọc, sắp xếp, yêu thích, tiếp tục đọc và xóa tài liệu tải lên; có bốn bài mẫu. Toggle **Show default books** (mặc định bật) cho phép ẩn/hiện các sách mặc định, đồng bộ danh sách, thẻ tiếp tục đọc và số lượng hiển thị trong Library/Favorites. Lựa chọn được lưu trên thiết bị và giữ khi tải lại; việc ẩn không xóa sách, tiến độ đọc, yêu thích, ghi chú, đánh dấu hoặc từ vựng, và không ẩn sách tải lên.
- Upload: PDF, DOCX, TXT, MD; tối đa 20 MB và một triệu ký tự. PDF giữ toàn bộ các trang và không có giới hạn số trang.
- Reader: lưu vị trí đọc, chỉnh font/cỡ chữ/khoảng cách dòng, nghe, đánh dấu, ghi chú, dịch đoạn chọn và lưu từ.
- Vocabulary: tự điền nghĩa khi chọn “Save word” hoặc ngừng gõ từ mới; người dùng có thể sửa nghĩa. Kết quả về muộn không ghi đè nội dung vừa nhập. Danh sách phân trang sau khi tìm kiếm và sắp xếp, mặc định **12 từ/trang**, có thể chọn **12 / 24 / 48** qua **Words per page**. Có nút trang trước/sau, số trang, thông tin trang hiện tại/tổng số trang và chuyển trực tiếp qua **Go to page** khi có nhiều trang. Tìm kiếm hoặc đổi số từ/trang về trang đầu; thêm/xóa/sửa từ tự cập nhật số trang và giữ trang hiện tại hợp lệ. Lựa chọn từ được giữ qua các trang và kết quả tìm kiếm; Select All chọn toàn bộ bộ sưu tập, kể cả từ ở trang khác.
- Export Vocabulary: chọn từng từ hoặc **Select All**, rồi chọn **Export Vocabulary → Export All / Export Selected → Excel (.xlsx) / PDF (.pdf) → Download file**. Select All chọn toàn bộ bộ sưu tập, kể cả từ bị ẩn bởi tìm kiếm; lựa chọn được giữ khi tìm kiếm. Export All đọc lại toàn bộ vocabulary đã lưu trong IndexedDB tại thời điểm xuất. Cả hai định dạng có đúng ba cột **STT**, **Word / Phrase** (trường `term`), **Meaning** (trường `meaning`), mỗi từ một hàng; sắp xếp mới nhất trước và đánh số liên tục từ 1 trong từng file, kể cả Export Selected. Giá trị thiếu được để trống, không tự tạo nghĩa. Cột Meaning được ưu tiên độ rộng và cả hai định dạng đều tự xuống dòng khi nội dung dài. PDF nhúng font tiếng Việt, chuẩn hóa dấu tổ hợp khi hiển thị, tự phân trang và lặp tiêu đề bảng trên mỗi trang. Excel giữ nguyên Unicode gốc, xuất STT dạng số và cố định hàng tiêu đề. File được tạo trên thiết bị; trình duyệt quản lý việc lưu file. Lỗi tạo hoặc khởi tạo tải xuống được hiển thị để thử lại.

PDF hỗ trợ các ký tự có trong Noto Sans đi kèm, gồm tiếng Anh và tiếng Việt. Với ký tự ngoài font (ví dụ chữ Hán hoặc emoji), ứng dụng báo lỗi và hướng dẫn chọn Excel để giữ nguyên nội dung, tránh tạo PDF thiếu chữ.
- Practice: flashcards và trắc nghiệm với tối đa bốn đáp án từ bộ từ đang học; cần ít nhất hai nghĩa khác nhau cho trắc nghiệm.
- Settings: theme, font, TTS và chế độ dịch Automatic / Browser translator / Downloaded model.

PDF được đọc dưới dạng chữ, không giữ layout/ảnh và không có OCR; PDF scan hoặc khóa mật khẩu được báo lỗi. Markdown được hiển thị an toàn như chữ. PDF worker được copy từ `pdfjs-dist` và phục vụ cùng website.

## Dịch hoàn toàn trên thiết bị

Không cần tài khoản cloud, API key hoặc subscription. Adapter Google Cloud/Azure và route `/api/translate` đã được loại bỏ. Các thiết lập Google/Microsoft cũ tự chuyển sang Automatic khi đọc/lưu preferences; từ vựng và dữ liệu đọc được giữ nguyên. Cache cloud cũ không được dùng lại cho dịch cục bộ.

### Các tầng dịch

1. Cache IndexedDB theo engine, phiên bản và văn bản Anh → Việt.
2. Với **Automatic**, thử `window.Translator` khi khả dụng; nếu khởi tạo/dịch lỗi hoặc trình duyệt không hỗ trợ, chuyển sang model cục bộ. **Browser translator** chỉ dùng engine trình duyệt và báo lỗi rõ khi không hỗ trợ.
3. **Downloaded model** dùng Mozilla/Bergamot WebAssembly SIMD trong Web Worker. JS, WASM, model, vocabulary và shortlist đều được phục vụ từ chính website. Văn bản không rời thiết bị. Không có fallback sang dịch vụ dịch cloud.

Native Translator hiện được Chrome/Edge desktop hỗ trợ; Firefox, Safari và mobile sử dụng tầng model cục bộ. Kiểm tra API và cặp `en → vi` lúc chạy, không dựa riêng vào tên trình duyệt. Gói ngôn ngữ native do trình duyệt tải/quản lý. Khởi tạo từ thao tác người dùng để đáp ứng yêu cầu kích hoạt khi cần tải model.

Tầng Mozilla khóa model Anh → Việt Release `base-memory`, khoảng 31,6 MB trọng số; tổng tài nguyên dịch khoảng **42 MB chưa nén**, gồm runtime và các tệp phụ trợ. Cần tải lần đầu; các lần sau dùng cache trình duyệt. Dung lượng RAM và tốc độ tùy thiết bị. WebAssembly SIMD là bắt buộc cho engine này; máy không hỗ trợ nhận thông báo lỗi và vẫn có thể nhập nghĩa bằng tay.

Giao diện có tiến trình tải, trạng thái chuẩn bị/dịch, hủy và thử lại. Lỗi cache không làm mất bản dịch thành công. Đóng dialog hoặc đổi từ sẽ bỏ kết quả cũ; hủy tác vụ cục bộ đang chạy sẽ dừng worker. Lỗi dịch không ngăn lưu nghĩa nhập tay. Giới hạn đầu vào 5.000 ký tự; không tự động cắt mất phần cuối.

Chất lượng dịch máy cần được kiểm tra trên tài liệu thực, đặc biệt từ đa nghĩa và thuật ngữ. Bản dịch là gợi ý có thể sửa. Miễn phí API/suy luận không đồng nghĩa băng thông hosting luôn miễn phí ở mọi quy mô. Dịch offline sau khi tải model yêu cầu trang ứng dụng vẫn đang mở/tải được; ứng dụng chưa phải PWA có thể khởi động hoàn toàn offline.

### Nguồn, phiên bản và giấy phép

- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api), [Edge Translator API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/translator-api).
- [Mozilla translations](https://github.com/mozilla/translations) và [registry model](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json).
- Phiên bản, URL nguồn và SHA-256 nằm trong `scripts/translation-assets.lock.json`. Tệp JS và WASM được ghép theo cùng phiên bản Mozilla, không dùng wrapper npm cũ.
- Model/runtime Mozilla theo MPL 2.0; giấy phép và nguồn tương ứng được giữ trong `public/translation`. Xem các thông báo bên thứ ba đi kèm trước khi phân phối bản sửa đổi.

```bash
npm run prepare:translation
node scripts/prepare-translation.mjs --verify
```

Không thay model chỉ bằng cách đổi URL. Cập nhật lock và phiên bản cache cùng runtime/glue tương ứng; chạy lại smoke test dịch thật, kiểm tra lỗi và đánh giá chất lượng trước khi phát hành.

## Dữ liệu trên thiết bị

IndexedDB `folio-reading`, schema version 1:

| Store | Nội dung |
| --- | --- |
| `documents` | Chữ theo trang, metadata, favorite, vị trí đọc |
| `highlights` | Tài liệu/trang, offset, text, màu |
| `notes` | Tài liệu/trang, trích dẫn, nội dung |
| `vocabulary` | Từ, nghĩa, ngữ cảnh, nguồn |
| `settings` | Preferences tại key `preferences` |
| `translations` | Cache bản dịch theo engine/phiên bản/văn bản |

Theme được lưu riêng trong localStorage tại `folio-theme`. Dữ liệu chỉ được khôi phục trong cùng trình duyệt/origin; không có cloud sync. Xóa site data sẽ xóa dữ liệu; trình duyệt cũng có thể thu hồi cache khi thiếu dung lượng. App chỉ báo lưu thành công sau khi IndexedDB hoàn tất.

TTS dùng Web Speech API với giọng của thiết bị. Một số system voice cần mạng; tính cục bộ hoàn toàn ở trên áp dụng cho **dịch thuật**. [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).

## Kiểm thử

```bash
npm run test
npm run typecheck
npm run build
npx playwright install chromium
npx playwright test
```

E2E chạy production build tại port **3101**. Bộ test thường mô phỏng native Translator để kiểm tra UI, hủy, cache, chuyển tầng, tự điền và giữ chỉnh sửa thủ công. Test suy luận thật là opt-in để không tải/chạy model cho mọi lượt CI:

```powershell
$env:FOLIO_REAL_TRANSLATION = '1'
npx playwright test tests/e2e/translation.spec.ts --grep 'real downloaded model'
npx playwright install firefox webkit
npx playwright test --config playwright.model.config.ts
```

Sau khi thay model/runtime, cần chạy thêm Chromium/Firefox/WebKit và thiết bị Android/iOS thực; WebKit desktop không thay thế kiểm thử trên iPhone. Không suy ra chất lượng/tương thích trên mọi máy từ một smoke test.

## Cấu trúc

```text
app/                     App Router pages và CSS
components/              Library, Reader, Vocabulary, Notes, Practice, Settings
hooks/                   Speech và vòng đời yêu cầu dịch
lib/translation.ts       Native translator, fallback, cache và lỗi
lib/local-translation.ts Worker client cho model Mozilla
public/translation/      Worker, runtime, model và giấy phép
scripts/                 Chuẩn bị/xác minh PDF worker và translation assets
tests/unit/              Logic, persistence và dịch
tests/e2e/               Browser flows và smoke test model thật
```

Các bài đọc mẫu là nội dung viết riêng cho demo.
