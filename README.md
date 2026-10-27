# Paste-Any

跨设备快速文本/图片传输服务。

## 结构

```
backend/
  app.py          # FastAPI 应用（入口）
  storage.py      # jsonl 存储 + 提取码索引
  requirements.txt
  data/           # 运行时数据（pastes.jsonl / codes.json）
frontend/
  index.html
  app.js
  style.css
  loadbalancer.js # 客户端 ngrok 端点负载均衡
  debug.html
```

## 本地运行（macOS）

```bash
cd ~/Project/paste-any
python3.11 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
cd backend && uvicorn app:app --host 0.0.0.0 --port 8000
```

后端默认端口 8000（nginx `servers/moltbook.conf` 中 `location /paste-api/` 代理到此）。
`app.py` 里的 `__main__` 段用 54123，那是 Windows 本地开发用的，**不要用**。

## 部署（nginx + ngrok）

nginx 已配置（`/opt/homebrew/etc/nginx/servers/moltbook.conf`）：

| 路径 | 作用 |
|---|---|
| `/paste/` | 前端静态文件 → `~/Project/paste-any/frontend/` |
| `/paste-api/` | API 代理 → `http://127.0.0.1:8000/api/` |
| `/paste/debug.html` | 剪贴板调试页 |

```bash
ngrok http 8080
```

ngrok 免费域名会轮换，`frontend/loadbalancer.js` 里的 `ENDPOINTS` 需同步更新，
且**新域名必须回写 MEMORY.md**。

## API

- `GET  /api/health` → `{"status":"ok","service":"paste-any"}`
- `POST /api/pastes`  body `{"content": "..."}` → `{"code":"XXXX","expires_at":"...","message":"..."}`
- `GET  /api/pastes/{code}` → `{"content":"...","created_at":"..."}`
- `POST /api/cleanup` → `{"cleaned": N}`

提取码 4 位、大写字母+数字，180 秒有效，**使用一次后立即失效**。

## 已知修复记录

- `ngrok-skip-browser-warning: true` header（绕过 ngrok 浏览器警告页）
- Safari `env(safe-area-inset-*)` 安全区适配
- `100dvh` 替代 `vh`（动态视口高度）
