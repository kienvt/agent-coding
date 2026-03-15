# Demo Script — AI Agent Coding System

> Thời gian: 30–40 phút | Ngày: 2026-03-16

---

## Chuẩn bị tối trước demo

### 1. GitLab repo

Tạo một repo mới trống trên GitLab, ví dụ `demo-todo-api`.
Lấy **Project ID** (hiển thị trong Settings → General).

### 2. Webhook

Trong GitLab repo → Settings → Webhooks:

```
URL:     http://{server-ip}:3000/webhook/gitlab
Secret:  (giá trị WEBHOOK_SECRET trong .env)
Triggers: ✅ Push events  ✅ Comments  ✅ Merge request events
SSL verification: tắt nếu dùng self-signed cert
```

### 3. `.env` thực tế

```env
GITLAB_URL=https://your-gitlab.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_BOT_USERNAME=ai-agent
WEBHOOK_SECRET=demo-secret-2026
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
REDIS_URL=redis://redis:6379
WORKSPACE_PATH=/workspace
PORT=3000
LOG_LEVEL=info
NODE_ENV=production
```

### 4. config.yaml

```yaml
gitlab:
  url: "${GITLAB_URL}"
  token: "${GITLAB_TOKEN}"
  webhook_secret: "${WEBHOOK_SECRET}"

repositories:
  - name: "demo-todo-api"
    gitlab_project_id: {PROJECT_ID}   # ← thay số thực
    local_path: "./demo-todo-api"
    type: "backend"
    tags: ["nodejs", "typescript"]

agent:
  model: "claude-sonnet-4-6"
  max_retries: 3
  timeout_seconds: 300
  mockup:
    enabled: true
    output_dir: "docs/mockup"
    framework: "vanilla"

workflow:
  auto_merge: false
  require_tests: true
  target_branch: "main"
  branch_prefix: "feature/"
  labels:
    init: ["phase:init", "ai-generated"]
    implement: ["phase:implement"]
    review: ["phase:review"]
    done: ["phase:done"]

notifications:
  enabled: true
  channels: ["gitlab-comment"]
```

### 5. Clone repo vào workspace

```bash
mkdir -p ./workspace
cd ./workspace
git clone https://your-gitlab.com/demo-todo-api.git
```

### 6. Requirements file chuẩn bị sẵn

Tạo file `requirement.md` (giữ ở ngoài workspace, copy vào lúc demo):

```markdown
# TODO API

## Mô tả
Xây dựng REST API quản lý công việc (TODO list) với Node.js + TypeScript.

## Tính năng
- Tạo, xem, cập nhật, xóa task (CRUD)
- Mỗi task có: title, description, status (todo/doing/done), priority (low/medium/high)
- Filter tasks theo status và priority
- Đánh dấu task complete/incomplete

## Yêu cầu kỹ thuật
- Node.js + TypeScript + Hono framework
- SQLite với better-sqlite3
- Validation với Zod
- Unit tests với Vitest
- Không cần authentication
```

### 7. Khởi động hệ thống

```bash
docker compose up --build -d
docker compose logs -f   # kiểm tra không có lỗi
```

### 8. Chạy thử một lần tối nay

Push `requirement.md` vào repo, quan sát Phase 1 hoạt động đến bước tạo issues.
Nếu OK → reset state để sáng demo lại từ đầu:

```bash
curl -X DELETE http://localhost:3000/api/projects/{PROJECT_ID}/state
curl -X DELETE http://localhost:3000/api/projects/{PROJECT_ID}/logs
```

---

## Kịch bản demo

### Phần 1 — Giới thiệu hệ thống (5 phút)

Mở browser tại `http://localhost:3000`, show **Dashboard**.

**Nói:**
> "Đây là AI Agent Coding System — một orchestrator tự động hóa toàn bộ vòng đời phát triển phần mềm.
> Thay vì developer phải code từng feature, họ chỉ cần viết requirements.
> AI sẽ tự phân tích, lên kế hoạch, viết code, tạo MR, và xử lý review."

Show sơ đồ flow trên màn hình:

```
Developer push requirement.md
         ↓
[Phase 1] AI phân tích → docs + UI mockup + GitLab issues   (~5 phút)
         ↓
Developer review và comment "approve"
         ↓
[Phase 2] AI implement từng issue → branch → code → test → commit  (~10-20 phút)
         ↓
[Phase 3] AI tạo MR → Developer review → comment feedback
         ↓
[Phase 4] Approved → AI merge → đóng issues → cleanup
```

**Nói:**
> "Hệ thống gồm một Hono webhook server, Redis queue, SQLite để lưu trạng thái,
> và Claude Agent SDK để chạy AI agent trực tiếp trên codebase."

---

### Phần 2 — Phase 1: Phân tích và lên kế hoạch (10 phút)

**Bước 1 — Push requirements:**

```bash
cp requirement.md ./workspace/demo-todo-api/
cd ./workspace/demo-todo-api
git add requirement.md
git commit -m "add: project requirements"
git push origin main
```

**Bước 2 — Show logs realtime trên Web UI:**

Click vào project `demo-todo-api` → tab **Logs**.
Chờ và show từng dòng log xuất hiện:

```
[INFO]  Phase transition: IDLE → ANALYZING
[AGENT] Reading requirement file at /workspace/demo-todo-api/requirement.md
[AGENT] Identified core features: CRUD tasks, filtering, priority management
[AGENT] Creating branch docs/init-plan from origin/main
[AGENT] Writing docs/architecture.md...
[AGENT] Writing docs/database-schema.md...
[AGENT] Writing docs/api-documentation.md...
[AGENT] Writing docs/implementation-plan.md...
[AGENT] Generating UI mockups in docs/mockup/...
[AGENT] Creating GitLab issue #1: Project setup and configuration
[AGENT] Creating GitLab issue #2: Database schema and migrations
[AGENT] Creating GitLab issue #3: CRUD API endpoints
[AGENT] Creating GitLab issue #4: Filtering and query features
[AGENT] Creating GitLab issue #5: Tests and documentation
[AGENT] Pushing branch docs/init-plan...
[INFO]  Phase transition: ANALYZING → AWAITING_REVIEW
```

**Bước 3 — Mở GitLab, show kết quả:**

- **Branch `docs/init-plan`** → folder `docs/` với 5 files
- Mở `docs/architecture.md` — có Mermaid diagram
- Mở `docs/mockup/index.html` trực tiếp trên browser — show UI mockup đã generate
- Mở **Issues** → show 5 issues với description và acceptance criteria chi tiết

**Nói:**
> "Từ 20 dòng requirements, AI đã tạo ra toàn bộ tài liệu kỹ thuật,
> UI mockup để confirm design, và chia nhỏ thành issues với acceptance criteria rõ ràng.
> Tất cả mà không cần developer phải làm bất kỳ thao tác nào."

---

### Phần 3 — Phase 2: Implement (10 phút)

**Bước 4 — Developer approve:**

Mở GitLab Issue #1 → Add comment:
```
approve
```

**Bước 5 — Show logs Phase 2:**

Quay lại Web UI → **Logs** tab, show real-time:

```
[INFO]  Phase transition: AWAITING_REVIEW → IMPLEMENTING
[AGENT] Fetching issue #1: Project setup and configuration
[AGENT] git checkout -b feature/issue-1-project-setup origin/main
[AGENT] Reading docs/architecture.md for context...
[AGENT] Creating package.json with dependencies...
[AGENT] Writing tsconfig.json...
[AGENT] Writing src/index.ts...
[AGENT] Writing src/db/index.ts...
[AGENT] Writing tests/setup.test.ts...
[AGENT] git commit "feat: implement #1 - project setup and configuration"
[AGENT] git push origin feature/issue-1-project-setup
[INFO]  Issue #1 status: DONE
[AGENT] Starting issue #2: Database schema and migrations
...
```

**Bước 6 — Show trên GitLab:**

- **Branches** → show `feature/issue-1-...` branch đã có commits thực
- Click vào commit → show code được viết: `package.json`, `src/index.ts`, tests
- Show issue #1 đã được update label `status:done` và có comment từ AI

**Nói:**
> "AI tự tạo branch theo đúng convention, đọc architecture docs để hiểu context,
> viết code theo đúng pattern, viết tests, commit với message chuẩn.
> Xong issue này chuyển sang issue tiếp theo không cần can thiệp."

---

### Phần 4 — Web UI Control Panel (5 phút)

Show các tính năng của Web UI:

**Dashboard:**
- Phase badge (IMPLEMENTING) + progress bar issues
- Button "Trigger" → manual trigger phase nếu cần
- Button "Reset" → reset về IDLE

**Queue page:**
- Số event đang chờ xử lý
- Dead letter queue nếu có event lỗi

**Settings page:**
- Hiện toàn bộ config (token bị che `***`)
- Có thể sửa trực tiếp và save — config.yaml trên disk được cập nhật

**Nói:**
> "Mọi thứ có thể quan sát và điều khiển từ web UI này.
> Không cần SSH vào server hay đọc logs file."

---

### Phần 5 — Kết và Q&A (5 phút)

**So sánh:**

| | Truyền thống | AI Agent |
|---|---|---|
| Từ requirements đến issues | 2-4 giờ | ~5 phút |
| Implement 1 feature | 1-3 ngày | ~15-30 phút |
| Tạo docs + mockup | Thường bỏ qua | Tự động |
| Review feedback | Fix thủ công | AI tự address |

**Trả lời các câu hỏi thường gặp:**

- *"AI viết code sai thì sao?"*
  → Comment vào issue hoặc MR → AI đọc feedback và tự fix. Đây là vòng lặp review như với developer thật.

- *"Chi phí API bao nhiêu?"*
  → Khoảng $2–8 USD cho dự án 5–10 issues với Claude Sonnet 4.6.
  Có thể dùng subscription (Claude Max) thay API key.

- *"Có scale lên project lớn được không?"*
  → Chia requirements thành nhiều file nhỏ, mỗi file một trigger.
  Hệ thống có thể quản lý nhiều repo song song (xem config.yaml).

- *"Security như thế nào?"*
  → Agent chạy trong Docker container isolated. GitLab token chỉ có quyền
  write vào repo được chỉ định. Webhook có secret validation.

---

## Fallback nếu demo gặp sự cố

### Agent chạy quá chậm
Pre-run Phase 1 tối nay. Sáng chỉ cần approve → show Phase 2 logs.
Nếu Phase 2 cũng chậm: show kết quả của run đã xong, focus vào GitLab artifacts.

### Webhook không fire
Kiểm tra: `docker compose logs orchestrator | grep webhook`
Fallback: trigger thủ công qua API:
```bash
curl -X POST http://localhost:3000/api/projects/{ID}/trigger \
  -H "Content-Type: application/json" \
  -d '{"phase":"init"}'
```

### Redis/SQLite lỗi
```bash
docker compose restart orchestrator
```
State trong SQLite vẫn còn, orchestrator sẽ tiếp tục từ phase hiện tại.

### Lỗi glab auth
Kiểm tra GITLAB_TOKEN còn hạn và có đủ quyền (api, write_repository).

---

## Checklist trước khi demo

- [ ] `docker compose up` chạy không lỗi
- [ ] `curl http://localhost:3000/health` trả `{"status":"ok"}`
- [ ] Web UI load được tại `http://localhost:3000`
- [ ] Webhook đã config trên GitLab repo
- [ ] GitLab token có quyền: `api`, `write_repository`, `read_user`
- [ ] Workspace `/workspace/demo-todo-api` đã clone
- [ ] File `requirement.md` đã chuẩn bị sẵn
- [ ] Test push webhook một lần và thấy log trong UI
- [ ] Reset state sau khi test: `DELETE /api/projects/{ID}/state`
- [ ] Browser mở sẵn: Web UI + GitLab repo + GitLab Issues
