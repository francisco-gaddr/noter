#!/usr/bin/env bash
#
# Opt-in server hardening for the Raspberry Pi / VPS host. SAFE to re-run
# (idempotent). Run it deliberately — it is NOT called by setup.sh, because the
# SSH changes can lock you out if you have no working key.
#
#   sudo bash infra/pi/harden.sh
#
# Covers: SSH (key-only, no root), UFW firewall, fail2ban, unattended security
# upgrades. Docker hardening lives in docker-compose.yml (non-root datastores,
# internal-only Mongo/Redis, cap_drop, no-new-privileges).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo)."; exit 1; fi

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }

# --- SSH hardening (guarded against lock-out) -------------------------------
SSHD=/etc/ssh/sshd_config.d/99-noter-hardening.conf
INVOKING_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
KEYFILE="/home/${INVOKING_USER}/.ssh/authorized_keys"
[[ "$INVOKING_USER" == "root" ]] && KEYFILE="/root/.ssh/authorized_keys"

log "SSH hardening"
if [[ -s "$KEYFILE" ]]; then
  cat > "$SSHD" <<'EOF'
# Managed by infra/pi/harden.sh
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 300
ClientAliveCountMax 2
AllowAgentForwarding no
EOF
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    echo "SSH: key-only auth enabled for '$INVOKING_USER', root login disabled."
  else
    echo "sshd config test FAILED — reverting."; rm -f "$SSHD"
  fi
else
  echo "!! No authorized_keys for '$INVOKING_USER' ($KEYFILE)."
  echo "!! Skipping password-auth disable so you are not locked out."
  echo "!! Add your public key with 'ssh-copy-id ${INVOKING_USER}@<host>' then re-run."
fi

# --- Firewall (UFW) ---------------------------------------------------------
log "Firewall (UFW)"
if ! command -v ufw >/dev/null; then apt-get update -y && apt-get install -y ufw; fi
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
# Mongo/Redis are NOT opened — they're internal to the Docker network only.
ufw --force enable
ufw status verbose

# --- fail2ban (brute-force protection) --------------------------------------
log "fail2ban"
if ! command -v fail2ban-client >/dev/null; then apt-get install -y fail2ban; fi
cat > /etc/fail2ban/jail.d/noter-sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 4
findtime = 600
bantime = 3600
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# --- Unattended security upgrades -------------------------------------------
log "Unattended security upgrades"
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades || true

log "Done. Verify you can still open a NEW SSH session before closing this one."
