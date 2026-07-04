#!/bin/bash

echo "🚀 Starting Bergman TerraMaster Tunnel Setup..."

# ===== CONFIG =====
TUNNEL_NAME="bergman-app"
DOMAIN="tnas.bergmantri.com"
LOCAL_URL="https://192.168.0.131:474"
CREDENTIALS_PATH="$HOME/.cloudflared"

# ===== STEP 1: Ensure cloudflared installed =====
if ! command -v cloudflared &> /dev/null
then
    echo "❌ cloudflared not installed"
    echo "Install using: brew install cloudflared"
    exit 1
fi

# ===== STEP 2: Login (only first time) =====
if [ ! -f "$CREDENTIALS_PATH/cert.pem" ]; then
    echo "🔐 Logging into Cloudflare..."
    cloudflared tunnel login
fi

# ===== STEP 3: Create tunnel if not exists =====
if ! cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
    echo "🆕 Creating tunnel..."
    cloudflared tunnel create $TUNNEL_NAME
else
    echo "✅ Tunnel already exists"
fi

# ===== STEP 4: Get tunnel ID =====
TUNNEL_ID=$(cloudflared tunnel list | grep $TUNNEL_NAME | awk '{print $1}')

echo "🔑 Tunnel ID: $TUNNEL_ID"

# ===== STEP 5: Create config file =====
CONFIG_FILE="$CREDENTIALS_PATH/config.yml"

echo "⚙️ Creating config file..."

cat > $CONFIG_FILE <<EOF
tunnel: $TUNNEL_ID
credentials-file: $CREDENTIALS_PATH/$TUNNEL_ID.json

ingress:
  - hostname: $DOMAIN
    service: $LOCAL_URL
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF

echo "✅ Config created at $CONFIG_FILE"

# ===== STEP 6: Route DNS =====
echo "🌐 Mapping domain..."

cloudflared tunnel route dns $TUNNEL_NAME $DOMAIN

# ===== STEP 7: Start tunnel =====
echo "🚀 Running tunnel..."

cloudflared tunnel run $TUNNEL_NAME
