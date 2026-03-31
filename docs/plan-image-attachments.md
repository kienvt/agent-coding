# Kế hoạch: Xử lý Image Attachments từ GitLab Comments

**Priority**: Low — implement sau các phần core flow
**Dependency**: Cần hoàn thành plan-implement-flow-v2.md trước

## Vấn đề

GitLab comment chứa ảnh dưới dạng markdown URL:
```
Please update layout like this:
![mockup](https://gitlab.example.com/group/project/uploads/abc123/mockup.png)
```

Webhook chỉ gửi text body — agent chỉ thấy URL string, không thấy ảnh thật.

## Giải pháp

Thêm bước **attachment resolver** trước khi enqueue event:
1. Detect GitLab upload URLs trong comment body
2. Download ảnh với auth token
3. Lưu vào temp file
4. Thay URL bằng local path trong feedbackBody
5. Agent dùng `Read` tool đọc ảnh → multimodal processing
6. Cleanup temp files sau khi agent run xong

## Chi tiết thiết kế

### URL patterns cần detect

```typescript
// Project uploads
https://{host}/{group}/{project}/uploads/{hash}/{filename}.{ext}

// Personal/system uploads
https://{host}/uploads/-/system/.../{filename}.{ext}

// Regex
/!\[.*?\]\((https?:\/\/[^\)]+\.(?:png|jpg|jpeg|gif|webp|pdf))\)/g
```

### File mới: `src/webhook/attachments.ts`

```typescript
export interface AttachmentResult {
  resolvedBody: string       // body với GitLab URLs thay bằng local paths
  attachmentPaths: string[]  // paths để cleanup sau
}

export async function resolveAttachments(
  body: string,
  gitlabUrl: string,
  token: string,
  noteId: number,
): Promise<AttachmentResult>
```

Logic:
- Chỉ download URL thuộc cùng `gitlabUrl` (tránh download external URLs)
- Giới hạn file size ≤ 10MB
- Chỉ xử lý: png, jpg, jpeg, gif, webp (skip PDF và binary khác)
- Temp dir: `{DATA_DIR}/attachments/{noteId}/`
- Timeout download: 10s

### Tích hợp vào `note.ts`

```typescript
// Trong handleNoteEvent, trước khi enqueue:
const { resolvedBody, attachmentPaths } = await resolveAttachments(
  commentBody,
  config.gitlab.url,
  config.gitlab.token,
  noteId,
)

await eventQueue.enqueue({
  ...
  body: resolvedBody,
  attachmentPaths,   // thêm field mới vào IssueCommentEvent / MRReviewEvent
})
```

### Cleanup trong `agentRunner.ts`

```typescript
// Sau khi agent run xong (success hoặc fail):
if (options.attachmentPaths?.length) {
  for (const p of options.attachmentPaths) {
    fs.rmSync(p, { recursive: true, force: true })
  }
}
```

## Thay đổi cần làm

| File | Thay đổi |
|------|---------|
| `src/webhook/attachments.ts` | **Tạo mới** — download + resolve logic |
| `src/webhook/handlers/note.ts` | Gọi `resolveAttachments` trước enqueue |
| `src/queue/types.ts` | Thêm `attachmentPaths?: string[]` vào `IssueCommentEvent`, `MRReviewEvent` |
| `src/agent/runner.ts` | Nhận `attachmentPaths`, cleanup sau run |
| `src/orchestrator/phase1-init.ts` | Pass `attachmentPaths` khi gọi `agentRunner.run` trong `handlePlanFeedback` |
| `src/orchestrator/phase2-implement.ts` | Pass `attachmentPaths` khi gọi `agentRunner.run` trong `handleIssueCommentDuringImplementation` |

## Rủi ro

| Rủi ro | Xử lý |
|--------|-------|
| Download fail (network, 404) | Skip attachment, giữ nguyên URL trong body, log warn |
| File quá lớn | Bỏ qua, thêm note vào body: `[Image too large to process: {filename}]` |
| External URL (không phải GitLab) | Không download, giữ nguyên URL |
| Temp file tích tụ nếu crash | Thêm cleanup job khi server start: xóa files cũ hơn 24h trong `attachments/` |
