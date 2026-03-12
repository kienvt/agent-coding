# T07 — Agent Runner (Claude Agent SDK)

> **Phụ thuộc:** T02, T03
> **Output:** `src/agent/runner.ts`

---

## Mục tiêu

Wrapper quanh `@anthropic-ai/claude-code` SDK's `query()` function. Cung cấp interface đơn giản để các phase coordinators invoke agent với prompt + working directory.

---

## Key Types / Interfaces

```typescript
interface AgentRunOptions {
  prompt: string
  cwd: string                    // absolute path của repo đang làm việc
  allowedTools?: string[]        // default: ['Read','Write','Edit','Bash','Glob','Grep']
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default'
  maxTurns?: number              // default: từ config
  systemPrompt?: string          // context bổ sung (repo type, conventions...)
  onProgress?: (message: string) => void  // callback log progress
}

interface AgentRunResult {
  success: boolean
  output: string           // text output cuối cùng từ agent
  cost?: number            // USD cost (từ ResultMessage)
  durationMs?: number
  turns: number
}
```

---

## Các bước

### Bước 1: Import và setup
- Import `query` từ `@anthropic-ai/claude-code`
- Agent runner cần `ANTHROPIC_API_KEY` env var
- Default allowed tools: `['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']`

### Bước 2: AgentRunner class

**Method `run(options): Promise<AgentRunResult>`:**
1. Build full prompt với system context (cwd, repo info) ghép vào `systemPrompt`
2. Gọi `query({ prompt, options: { cwd, allowedTools, permissionMode, maxTurns } })`
3. Iterate async generator nhận về messages:
   - `AssistantMessage`: extract text blocks → append vào output, gọi `onProgress`
   - `ResultMessage`: lưu cost, duration, kết thúc loop
4. Return `AgentRunResult`

**Error handling:**
- Wrap trong try/catch, throw `AgentError` với context
- Log start/end với duration và cost

### Bước 3: Default system context
Mỗi lần chạy, agent nhận system context:
```
Working directory: {cwd}
Available tools: glab (GitLab CLI), git, standard Unix tools
GitLab instance: {gitlab.url}
Bot username: {GITLAB_BOT_USERNAME}
```

### Bước 4: Permission mode
- Dev/testing: `acceptEdits` (tự động accept file edits)
- Production: `bypassPermissions` (agent tự quyết)

### Bước 5: Singleton export
- Export `agentRunner = new AgentRunner()`

---

## Notes về glab trong agent

Khi agent chạy, nó có thể dùng Bash skill để gọi `glab`. Cần đảm bảo trong container:
- `glab` được cài (`apk add glab` hoặc download binary)
- `glab auth login` được thực hiện khi startup dùng `GITLAB_TOKEN` env var
- `glab config set host {GITLAB_URL}` đã được set

---

## Acceptance Criteria

- [ ] `agentRunner.run({ prompt, cwd })` chạy agent và return kết quả
- [ ] `onProgress` callback được gọi với mỗi text block từ assistant
- [ ] `ResultMessage` cost và duration được capture và log
- [ ] Agent error → throw `AgentError` với message rõ ràng
- [ ] Mọi agent run đều log `{ cwd, turns, cost, duration }` khi kết thúc
