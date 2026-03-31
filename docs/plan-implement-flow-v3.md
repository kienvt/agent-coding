# Kế hoạch: Implement Flow v3 (Advanced)

**Priority**: Implement sau khi v2 stable và đã demo
**Dependency**: `plan-implement-flow-v2.md` phải hoàn thành trước

Các tính năng ở đây bị loại khỏi v2 vì độ phức tạp cao, nhiều edge case,
cần v2 chạy ổn định trước mới có đủ context để implement đúng.

---

## 1 — Parallel task execution

**Lý do hoãn**: Race conditions trên GitLab API rate limit, state conflict
khi nhiều agents cùng update repo state, khó debug.

**Khi implement**: Thêm `max_parallel_tasks` vào config. Sửa
`startImplementationLoop` dùng `Promise.allSettled`. Thêm
`syncMainBranch()` sau mỗi MR merge để unblock dependent tasks.

---

## 2 — Dependency graph + Topological sort

**Lý do hoãn**: Cần định nghĩa format dependency trong issue description,
cycle detection, và test kỹ trước khi tin tưởng thứ tự chạy.

**Khi implement**: Parse `## Dependencies\n- #N` từ issue description.
Kahn's algorithm cho topological sort. Priority weighting trong tie-break.
Thay thế simple priority sort của v2.

---

## 3 — Change request auto-classification

**Lý do hoãn**: LLM misclassify dẫn đến sai flow (tạo new issue thay vì
reopen, hoặc ngược lại). Cần nhiều test cases thực tế trước.

**Khi implement**: Thêm classify step trước khi handle ISSUE_COMMENT trên
DONE issue. 3 nhánh: bug fix (reopen) / enhancement (new issue) / question
(reply only). Cần prompt engineering cẩn thận.

---

## 4 — Review cycle iteration guard

**Lý do hoãn**: Cần đủ data thực tế về số lần review trung bình trước khi
chọn threshold hợp lý.

**Khi implement**: Thêm `reviewCycles: number` vào CheckpointData. Tăng
mỗi lần `handleMRReviewEvent` xử lý changes_requested. Sau N lần (đề xuất
5) post comment escalation và dừng auto-handle.

---

## 5 — Pending comments buffer khi IN_PROGRESS

**Lý do hoãn**: Cần đảm bảo checkpoint mechanism của v2 ổn định trước khi
thêm pending comments vào cùng data structure.

**Khi implement**: Thêm `pendingComments[]` vào CheckpointData. ISSUE_COMMENT
khi IN_PROGRESS → append vào buffer thay vì ignore. Inject vào system prompt
của lần run tiếp theo.

---

## 6 — Branch conflict resolution (rebase strategy)

**Lý do hoãn**: Tự động resolve merge conflict sai còn tệ hơn không resolve.
Cần test kỹ các scenarios.

**Khi implement**: Trước mỗi push, check `git log origin/main..HEAD`. Nếu
outdated → rebase. Conflict strategy: main wins cho infra files
(go.mod, package.json, migrations), feature branch wins cho business logic.
Nếu không tự resolve được → post comment, dừng, chờ manual.

---

## 7 — Startup orphan worktree recovery

**Lý do hoãn**: Edge case hiếm, có thể handle manually trong giai đoạn đầu.

**Khi implement**: Khi server start, scan tất cả checkpoints có `worktreePath`.
Verify còn valid bằng `git worktree list`. Nếu không valid → xóa khỏi state,
mark issue INTERRUPTED để retry.

---

## 8 — Image attachments

Xem `plan-image-attachments.md`
