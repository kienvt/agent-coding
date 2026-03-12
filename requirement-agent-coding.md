# AI agent coding for gitlab

## 1. Mục tiêu
Integrate workflow AI agent coding for gitlab. AI sẽ tự lên kế hoạch và đẩy lên issue của gitlab. Sau khi AI agent đẩy plan là các issue lên gitlab, Agent sẽ tiến hành implement và tracking từng issue trên gitlab, nếu user có comment AI agent sẽ update issue và tiếp tục thực hiện. Sau khi hoàn thành tất cả các issue, AI agent sẽ tạo một merge request để gộp các thay đổi.

## 2. Workflow

### 1.Init
- Từ file requirement AI agent sẽ tự động generate các documents cần thiết như:
    - Architecture
    - Database schema
    - API documentation
    - Test cases
    - Plan
- Sau khi generate các documents, AI agent sẽ tạo các issue trên gitlab và đẩy các documents vào issue đó.
- User sẽ review các documents và issue, nếu có thay đổi thì AI agent sẽ update các documents và issue.

### 2.Implement
- AI agent sẽ tiến hành implement từng issue trên gitlab.
- AI agent sẽ update issue khi hoàn thành.
- Nếu user có comment AI agent sẽ update issue và tiếp tục thực hiện.

### 3.Review
- Sau khi hoàn thành tất cả các issue, AI agent sẽ tạo một merge request để gộp các thay đổi.
- User sẽ review merge request, nếu có thay đổi thì AI agent sẽ update merge request.

### 4.Done
- Sau khi merge request được merge, AI agent sẽ đóng tất cả các issue.

## 3. Tech stack
- AI agent: Claude code
- Gitlab: self-hosted gitlab
