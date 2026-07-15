# v0.4.1 - CLI reliability and lightweight UX

## English

ContextPilot `0.4.1` focuses on making the CLI feel more dependable in real repos, especially when
a project has a local install, when status checks need to be fast, and when small technical tasks
do not need the full orchestration overhead.

### Highlights

- Added `contextpilot start` for one-command readiness checks
- Added `contextpilot status --fast` for lightweight, reliable status output
- Added `contextpilot sync --preview` to inspect changes before writing
- Added a light default profile for small teams and small tasks
- Added safe SRS drift auto-ingest for `status`, `context --inject`, and `sync`
- Improved CLI resolution and fallback guidance for local installs
- Reduced noisy sync rewrites when generated output is unchanged

### What changed

- ContextPilot now resolves the best command to run in the current repo by preferring:
  project-local install -> current dev checkout -> `npx --no-install contextpilot`
- Error and help messaging now surfaces the exact command users or agents should run next
- `status` now records per-stage diagnostics and can return partial results more gracefully
- `doctor` includes CLI resolution and better next-step guidance
- Sync output now distinguishes `written`, `unchanged`, and `skipped` files
- Generated agent files now default to a stub protocol plus knowledge-index pointers instead of
  repeating long global SRS summaries everywhere
- Hook infrastructure failures such as an uninitialized project warn-open in the light profile,
  while real gate denials still block
- README and CLI UX coverage were updated to reflect the new lightweight workflow

### Recommended lightweight flow

```bash
contextpilot start
contextpilot status --fast
contextpilot sync --preview
```

### Upgrade notes

- No migration is required beyond updating to `0.4.1`
- Existing `orchestrate start` behavior is unchanged when invoked directly
- Set `"profile": "strict"` to keep stricter, more prescriptive team defaults
- `start` is a new top-level readiness command and does not replace orchestration

## Tiếng Việt

ContextPilot `0.4.1` tập trung vào việc làm cho CLI đáng tin cậy hơn trong repo thực tế, đặc biệt
khi dự án dùng local install, khi cần kiểm tra trạng thái nhanh, và khi các tác vụ kỹ thuật nhỏ
không cần toàn bộ overhead của orchestration.

### Điểm nổi bật

- Thêm `contextpilot start` để kiểm tra mức độ sẵn sàng chỉ với một lệnh
- Thêm `contextpilot status --fast` để lấy trạng thái nhẹ và ổn định hơn
- Thêm `contextpilot sync --preview` để xem trước thay đổi trước khi ghi file
- Cải thiện cách resolve CLI và hướng dẫn fallback khi dùng local install
- Giảm việc sync ghi đè không cần thiết khi output generated không đổi

### Thay đổi chính

- ContextPilot giờ tự chọn cách chạy lệnh phù hợp nhất trong repo theo thứ tự ưu tiên:
  project-local install -> dev checkout hiện tại -> `npx --no-install contextpilot`
- Thông báo lỗi và help giờ chỉ rõ chính xác lệnh tiếp theo mà người dùng hoặc agent nên chạy
- `status` giờ có diagnostics theo từng stage và xử lý partial result mềm hơn
- `doctor` có thêm thông tin CLI resolution và gợi ý bước tiếp theo rõ hơn
- Output của sync giờ phân biệt `written`, `unchanged`, và `skipped`
- README và test cho CLI UX đã được cập nhật để phản ánh workflow lightweight mới

### Workflow gợi ý cho tác vụ nhẹ

```bash
contextpilot start
contextpilot status --fast
contextpilot sync --preview
```

### Ghi chú nâng cấp

- Không cần migration riêng ngoài việc cập nhật lên `0.4.1`
- Hành vi hiện tại của `orchestrate start` không thay đổi
- `start` là lệnh readiness mới ở top-level, không thay thế orchestration
