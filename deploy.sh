#!/bin/bash
# 独立日记 - 服务器部署脚本
# 用法: bash deploy.sh
set -e

DEPLOY_DIR="$HOME/diary"
BACKUP_DIR="$HOME/diary_backup_$(date +%Y%m%d_%H%M%S)"
NODE_VERSION_REQUIRED="22"

echo "=== 独立日记部署脚本 ==="

# 检查 Node 版本
NODE_MAJOR=$(node -v | cut -d. -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt "$NODE_VERSION_REQUIRED" ]; then
  echo "[错误] 需要 Node.js $NODE_VERSION_REQUIRED+，当前 $(node -v)"
  echo "请安装: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
echo "[OK] Node.js $(node -v)"

# 备份旧版本
if [ -d "$DEPLOY_DIR" ]; then
  echo "[备份] 旧版本 -> $BACKUP_DIR"
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
fi

# 创建部署目录
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# 解压部署包（假设 diary-deploy.tar.gz 在 ~/ 下）
if [ -f "$HOME/diary-deploy.tar.gz" ]; then
  echo "[解压] $HOME/diary-deploy.tar.gz"
  tar -xzf "$HOME/diary-deploy.tar.gz" -C "$DEPLOY_DIR"
else
  echo "[错误] 未找到 $HOME/diary-deploy.tar.gz"
  exit 1
fi

# 安装依赖
echo "[安装] API 依赖..."
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3

# 创建 vault 目录
VAULT_DIR="${OBSIDIAN_DIR:-$HOME/obsidian-vault}"
mkdir -p "$VAULT_DIR/00_INPUT-输入池/每日记录"
mkdir -p "$VAULT_DIR/01_UNDERSTAND-理解层/周复盘/独立日记"
mkdir -p "$VAULT_DIR/02_CONTENT-内容引擎/素材库/独立日记"
mkdir -p "$VAULT_DIR/07_SYSTEM-系统/独立日记"
echo "[OK] Vault 目录: $VAULT_DIR"

# 配置 .env
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "[配置] 生成 .env"
  cat > "$DEPLOY_DIR/.env" <<EOF
HOST=0.0.0.0
PORT=4319
OBSIDIAN_DIR=$VAULT_DIR
DIARY_TIMEZONE=Asia/Shanghai
AI_API_URL=https://apihub.agnes-ai.com/v1
AI_API_KEY=
AI_MODEL=agnes-2.5-flash
AI_AUTO_SUMMARY=false
AI_PROXY=
EOF
  echo "[提示] 请编辑 $DEPLOY_DIR/.env 配置 AI_API_KEY"
else
  echo "[跳过] .env 已存在"
fi

# 安装 pm2（如果没有）
if ! command -v pm2 &> /dev/null; then
  echo "[安装] pm2..."
  sudo npm install -g pm2 2>/dev/null || npm install -g pm2
fi

# 停止旧进程
pm2 delete diary 2>/dev/null || true

# 启动 API
echo "[启动] API 服务..."
cd "$DEPLOY_DIR"
pm2 start apps/api/dist/index.js --name diary --cwd "$DEPLOY_DIR"
pm2 save

echo ""
echo "=== 部署完成 ==="
echo "API 地址: http://127.0.0.1:4319"
echo ""
echo "下一步：配置 Nginx 反向代理"
echo "  sudo cp $DEPLOY_DIR/nginx.conf /etc/nginx/sites-available/diary"
echo "  sudo ln -sf /etc/nginx/sites-available/diary /etc/nginx/sites-enabled/"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "设置登录密码:"
echo "  sudo htpasswd -c /etc/nginx/.diary_htpasswd <用户名>"
echo ""
echo "查看日志: pm2 logs diary"
