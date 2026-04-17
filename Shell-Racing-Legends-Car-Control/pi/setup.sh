#!/usr/bin/env bash
set -euo pipefail

# Phase 1 setup script for Raspberry Pi Zero 2 W
# Run this on the Pi after initial OS setup and SSH access.

echo "=== Phase 1: Camera streaming setup ==="

# 1. Update system
echo "[1/4] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Ensure camera tools are available (should be pre-installed on Bookworm)
echo "[2/4] Checking rpicam-vid..."
if ! command -v rpicam-vid &>/dev/null; then
  echo "rpicam-vid not found. Installing libcamera tools..."
  sudo apt install -y rpicam-apps-lite
fi

# 3. Download go2rtc
echo "[3/4] Installing go2rtc..."
GO2RTC_VERSION="v1.9.8"
ARCH="arm64"  # Pi Zero 2 W with 64-bit OS
GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}/go2rtc_linux_${ARCH}"

sudo mkdir -p /opt/go2rtc
sudo curl -L -o /opt/go2rtc/go2rtc "$GO2RTC_URL"
sudo chmod +x /opt/go2rtc/go2rtc

# 4. Copy config
echo "[4/4] Installing config..."
sudo cp "$(dirname "$0")/go2rtc.yaml" /opt/go2rtc/go2rtc.yaml

# 5. Create systemd service
echo "Creating systemd service..."
sudo tee /etc/systemd/system/go2rtc.service > /dev/null <<EOF
[Unit]
Description=go2rtc camera streamer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/go2rtc
ExecStart=/opt/go2rtc/go2rtc -config /opt/go2rtc/go2rtc.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable go2rtc
sudo systemctl start go2rtc

echo ""
echo "=== Done! ==="
PI_IP=$(hostname -I | awk '{print $1}')
echo "go2rtc is running. Open your frontend and enter:"
echo "  http://${PI_IP}:1984"
echo ""
echo "go2rtc dashboard: http://${PI_IP}:1984"
echo "Stream preview:   http://${PI_IP}:1984/stream.html?src=camera"
