# T08 — Custom Claude Code Skills

> **Phụ thuộc:** T07
> **Output:** `.claude/skills/` directory với các skill files

---

## Mục tiêu

Định nghĩa custom `/skills` cho Claude Code agent để encapsulate các workflow phức tạp. Agent sẽ gọi các skills này khi orchestrator invoke agent với prompt tham chiếu đến skill.

---

## Cấu trúc

```
.claude/
├── CLAUDE.md             # Project context cho agent (conventions, glab config info)
└── skills/
    ├── commit.md         # /commit — stage + commit với proper message
    ├── create-issues.md  # /create-issues — tạo issues từ plan document
    ├── create-mr.md      # /create-mr — tạo MR với proper description
    └── review-comments.md # /review-comments — xử lý MR review comments
```

---

## Các bước

### Bước 1: `.claude/CLAUDE.md` — Project context

Nội dung cần có:
- GitLab instance URL và cách dùng `glab`
- Convention đặt tên branch: `feature/issue-{iid}-{slug}`
- Convention commit message: `feat: implement #{iid} - {title}`
- Cách check glab auth: `glab auth status`
- Reminder: luôn dùng absolute paths khi làm việc với files

### Bước 2: `/commit` skill (`.claude/skills/commit.md`)

Skill này:
1. Check `git status` xem có gì để commit không
2. Nếu không có file thay đổi → thông báo, không tạo commit trống
3. `git add -A`
4. Format commit message theo convention
5. `git commit -m "..."` (không dùng --no-verify)
6. Thông báo SHA commit

Input từ prompt: issue number, description

### Bước 3: `/create-issues` skill (`.claude/skills/create-issues.md`)

Skill này:
1. Đọc implementation plan (từ file path được cung cấp)
2. Parse danh sách features/tasks
3. Với mỗi issue, chạy:
   ```
   glab issue create \
     --title "..." \
     --description "..." \
     --label "phase:implement,priority:high" \
     --assignee "@me"
   ```
4. Collect IIDs từ output của glab
5. Return danh sách IIDs đã tạo

Input từ prompt: path đến plan file, repo context, GitLab project ID

### Bước 4: `/create-mr` skill (`.claude/skills/create-mr.md`)

Skill này:
1. Đọc danh sách issues đã implement (IIDs)
2. Build MR description với:
   - Summary các thay đổi
   - `Closes #N` cho từng issue
   - Testing checklist
3. Chạy:
   ```
   glab mr create \
     --source-branch "..." \
     --target-branch "main" \
     --title "feat: ..." \
     --description "..." \
     --label "phase:review"
   ```
4. Return MR IID và URL

Input từ prompt: source branch, list of issue IIDs, repo context

### Bước 5: `/review-comments` skill (`.claude/skills/review-comments.md`)

Skill này:
1. Fetch tất cả MR comments:
   ```
   glab mr note list {mrIid}
   ```
2. Filter bỏ bot comments và system notes
3. Group comments theo file/context
4. Cho mỗi nhóm comment: phân tích → implement fix → ghi file
5. Sau khi fix hết: commit all changes
6. Reply tổng hợp:
   ```
   glab mr note {mrIid} --message "..."
   ```

Input từ prompt: MR IID, branch name, repo context

---

## Notes về glab commands

Các glab commands hay dùng (agent sẽ gọi qua Bash skill):

```bash
# Issues
glab issue create --title "..." --description "..." --label "..."
glab issue note {iid} --message "..."
glab issue update {iid} --label "status:in-progress"
glab issue close {iid}
glab issue list --label "phase:implement" --state opened

# MR
glab mr create --source-branch "..." --target-branch "main" --title "..."
glab mr note {iid} --message "..."
glab mr list --state opened
glab mr view {iid}

# Auth
glab auth status
glab config get host
```

---

## Acceptance Criteria

- [ ] `.claude/CLAUDE.md` có đủ context để agent biết conventions
- [ ] `/commit` skill không tạo commit trống
- [ ] `/create-issues` skill tạo đúng số issues với labels và descriptions
- [ ] `/create-mr` skill tạo MR với `Closes #N` cho tất cả issues
- [ ] `/review-comments` skill filter đúng (bỏ bot comments)
- [ ] Tất cả skills dùng `glab` qua Bash, không hardcode API calls
