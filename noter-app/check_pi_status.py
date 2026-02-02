import paramiko
import time
import sys

host = "192.168.50.16"
user = "realdini"
password = "12345678"

def execute_command(ssh, command):
    print(f"Executing: {command}")
    stdin, stdout, stderr = ssh.exec_command(command)
    
    # Stream output
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            output = stdout.channel.recv(1024).decode('utf-8')
            sys.stdout.write(output)
            sys.stdout.flush()
        if stderr.channel.recv_ready():
            err = stderr.channel.recv(1024).decode('utf-8')
            sys.stderr.write(err)
            sys.stderr.flush()
        time.sleep(0.1)
    
    # Print remaining output
    sys.stdout.write(stdout.read().decode('utf-8'))
    sys.stderr.write(stderr.read().decode('utf-8'))
    
    exit_status = stdout.channel.recv_exit_status()
    print(f"\nCommand finished with exit status: {exit_status}")
    return exit_status

try:
    print(f"Connecting to {host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, password=password)
    print("Connected successfully.")

    print("Checking all containers (docker ps -a)...")
    execute_command(ssh, "docker ps -a")
    
    print("\nFetching logs for backend...")
    execute_command(ssh, "docker compose -f /srv/projects/noter/noter-app/docker-compose.yml logs backend --tail 50")

    print("\nFetching logs for web...")
    execute_command(ssh, "docker compose -f /srv/projects/noter/noter-app/docker-compose.yml logs web --tail 50")

    ssh.close()

except Exception as e:
    print(f"An error occurred: {e}")
    exit(1)
