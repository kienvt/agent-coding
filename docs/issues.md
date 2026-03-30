1. cần dùng slash command theo chuẩn từ document:
https://platform.claude.com/docs/en/agent-sdk/slash-commands
không đọc file và truyền Arguments như chuẩn tài liệu
2. Cần dùng đúng skill theo tài liệu:
https://platform.claude.com/docs/en/agent-sdk/skills
cần thêm allow tool "skill" khi gọi agent
3. Xem xét lại vụ invokeSkill nếu làm theo đúng tài liệu thì có cần cái này không
4. Agent sẽ gọi slash command và truyền arguments vào, sau đó command sẽ sử dụng skill để agent tự động work theo workflow mà skill mô tả