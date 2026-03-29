#!/usr/bin/env bash
#
# Setup script for deploying EarlyPost as a systemd service.
# Run as root on the target server.
#
set -euo pipefail

APP_DIR="/opt/earlypost"
SERVICE_NAME="earlypost"
USER="earlypost"
NODE_BIN="/usr/bin/node"

echo "==> EarlyPost deployment setup"

# 1. Create service user (no login shell, home is app dir)
if ! id -u "$USER" &>/dev/null; then
    echo "Creating system user '$USER'..."
    useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" --create-home "$USER"
else
    echo "User '$USER' already exists, skipping."
fi

# 2. Ensure app directory exists with correct ownership
echo "Setting up application directory at $APP_DIR..."
mkdir -p "$APP_DIR/data"
chown -R "$USER":"$USER" "$APP_DIR"

# 3. Copy application files (if running from project checkout)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
    echo "Copying application files from $SCRIPT_DIR..."
    cp -r "$SCRIPT_DIR/dist" "$APP_DIR/" 2>/dev/null || echo "WARNING: dist/ not found — run 'npm run build' first."
    cp -r "$SCRIPT_DIR/public" "$APP_DIR/"
    cp -r "$SCRIPT_DIR/drizzle" "$APP_DIR/"
    cp -r "$SCRIPT_DIR/node_modules" "$APP_DIR/"
    cp "$SCRIPT_DIR/package.json" "$APP_DIR/"
    chown -R "$USER":"$USER" "$APP_DIR"
else
    echo "NOT running from project checkout — deploy files manually to $APP_DIR."
fi

# 4. Install systemd service unit
echo "Installing systemd service..."
cp "$SCRIPT_DIR/deploy/earlypost.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
echo "Service enabled. Start it with: systemctl start $SERVICE_NAME"

echo ""
echo "==> Setup complete."
echo "    App directory : $APP_DIR"
echo "    Service       : $SERVICE_NAME"
echo "    Default port  : 3000"
echo ""
echo "Next steps:"
echo "  1. Review /etc/systemd/system/${SERVICE_NAME}.service (adjust PORT, HOST if needed)"
echo "  2. systemctl start $SERVICE_NAME"
echo "  3. journalctl -u $SERVICE_NAME -f   (to watch logs)"
