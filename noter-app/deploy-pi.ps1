Write-Host "Deploying to Raspberry Pi..."
Write-Host "Connect to 192.168.50.16..."

$HOST_IP = "192.168.50.16"
$USER = "realdini"
$REMOTE_PATH = "/srv/projects/noter"

# Command to execute on the Pi
$CMD = "cd $REMOTE_PATH && git pull && docker compose up -d --build --remove-orphans"

Write-Host "Executing: $CMD"
Write-Host "Please enter the password (12345678) if prompted."

ssh -t $USER@$HOST_IP $CMD

Write-Host "Deployment command finished."
