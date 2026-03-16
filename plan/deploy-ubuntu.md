# Deploy lên Ubuntu Server qua SSH

> Hướng dẫn từng bước để deploy AI Agent Orchestrator lên server Ubuntu mới.

---

## Yêu cầu server

- Ubuntu 22.04 / 24.04
- RAM: tối thiểu 2GB (khuyến nghị 4GB — Claude Code ngốn memory)
- Disk: 20GB+ (workspace repos + Docker images)
- Port 3000 mở (hoặc dùng Nginx reverse proxy)
- SSH access với quyền sudo

---

## Bước 1 — Kết nối SSH vào server

```bash
ssh user@your-server-ip
```

---

## Bước 2 — Cài Docker

```bash
# Cài dependencies
sudo apt update
sudo apt install -y ca-certificates curl gnupg

# Thêm Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Thêm Docker repo
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Cài Docker Engine + Compose
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Cho phép user hiện tại chạy docker không cần sudo
sudo usermod -aG docker $USER
newgrp docker

# Kiểm tra
docker --version
docker compose version
```

---

## Bước 3 — Cài Claude Code CLI (để authen subscription)

> Bỏ qua bước này nếu dùng `ANTHROPIC_API_KEY`. Nếu dùng subscription (Claude Max), làm bước này.

```bash
# Cài Node.js 20+ nếu chưa có
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Cài Claude Code CLI
sudo npm install -g @anthropic-ai/claude-code

# Authen subscription — CLI sẽ in ra một URL
claude auth login
# Output: Open this URL in your browser: https://claude.ai/auth?code=xxx...
```

Copy URL đó, mở trên **máy local** (laptop/PC của bạn), đăng nhập tài khoản Claude → Authorize.

```bash
# Kiểm tra authen thành công
claude --version
# Phải không hiện lỗi auth
```

Credentials được lưu tại `~/.claude/` trên server — Docker sẽ mount vào container.

---

## Bước 4 — Copy project lên server

**Cách A — Git clone (khuyến nghị nếu có repo):**

```bash
git clone https://github.com/your-org/ai-agent-coding.git /opt/ai-agent
cd /opt/ai-agent
```

**Cách B — rsync từ máy local:**

```bash
# Chạy trên máy LOCAL
rsync -avz --exclude node_modules --exclude .git \
  /Volumes/Data/Projects/BSSD/AI-agent-coding/ \
  user@your-server-ip:/opt/ai-agent/
```

---

## Bước 5 — Tạo file `.env`

```bash
cd /opt/ai-agent
cp .env.example .env   # nếu có, hoặc tạo mới
nano .env
```

Nội dung — chỉ 3 dòng bắt buộc:

```env
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_BOT_USERNAME=ai-agent
WEBHOOK_SECRET=your-strong-random-secret
```

> **Claude auth:** Nếu đã `claude auth login` ở Bước 3 (subscription), không cần thêm gì.
> Nếu muốn dùng API key thay subscription, thêm: `ANTHROPIC_API_KEY=sk-ant-...`

Tạo secret ngẫu nhiên cho `WEBHOOK_SECRET`:

```bash
openssl rand -hex 32
```

---

## Bước 6 — Tạo workspace directory

```bash
mkdir -p /opt/ai-agent/workspace
```

---

## Bước 7 — Build và khởi động

```bash
cd /opt/ai-agent
docker compose up --build -d

# Theo dõi logs
docker compose logs -f
```

Chờ đến khi thấy:
```
[main] Webhook server started  port=3000
[main] Configuration loaded
[main] Redis connected
[main] AI Agent Orchestrator is running
```

Kiểm tra health:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

---

## Bước 8 — Cấu hình qua Web UI

Mở `http://your-server-ip:3000` trong browser.

Vào **Settings**:
1. **GitLab URL** → `https://your-gitlab.com` → Save
2. **Repositories** → Add repository → điền thông tin → Save
   - Hệ thống tự clone repo vào `/opt/ai-agent/workspace/`

---

## Bước 9 — Config GitLab Webhook

Trong GitLab repo → Settings → Webhooks → Add new webhook:

```
URL:     http://your-server-ip:3000/webhook/gitlab
Secret:  (giá trị WEBHOOK_SECRET trong .env)
Triggers: ✅ Push events  ✅ Comments  ✅ Merge request events
```

Test webhook → phải thấy `200 OK`.

---

## (Tuỳ chọn) Bước 10 — Nginx reverse proxy + domain

Nếu muốn dùng domain thay vì IP:port:

```bash
sudo apt install -y nginx

sudo tee /etc/nginx/sites-available/ai-agent << 'EOF'
server {
    listen 80;
    server_name ai-agent.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # SSE support (log streaming)
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/ai-agent /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS với Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ai-agent.your-domain.com
```

---

## Maintenance

### Cập nhật code

```bash
cd /opt/ai-agent
git pull
docker compose up --build -d
```

### Xem logs

```bash
docker compose logs -f orchestrator      # tất cả logs
docker compose logs -f --tail=100 orchestrator  # 100 dòng gần nhất
```

### Restart

```bash
docker compose restart orchestrator
```

### Xem state hiện tại của tất cả projects

```bash
curl http://localhost:3000/api/projects | jq
```

### Reset state một project

```bash
curl -X DELETE http://localhost:3000/api/projects/{PROJECT_ID}/state
```

### Backup SQLite

```bash
# SQLite nằm trong Docker volume sqlite-data
docker run --rm -v ai-agent_sqlite-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/sqlite-backup-$(date +%Y%m%d).tar.gz /data
```

---

## Troubleshooting

### Container không start

```bash
docker compose logs orchestrator
```

### Claude auth lỗi trong container

```bash
# Kiểm tra credentials đã mount vào container chưa
docker exec ai-agent-orchestrator ls /root/.claude/

# Nếu rỗng → cần authen trên host trước
claude auth login
```

### Git clone lỗi (permission denied)

Kiểm tra `GITLAB_TOKEN` có quyền `read_repository`:

```bash
curl https://your-gitlab.com/api/v4/projects/{ID} \
  -H "PRIVATE-TOKEN: $GITLAB_TOKEN"
```

### Port 3000 bị chặn bởi firewall

```bash
sudo ufw allow 3000/tcp
# hoặc nếu dùng nginx:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```
