import paramiko
import time
import sys

host = "192.168.50.16"
user = "realdini"
password = "12345678"
project_path = "/srv/projects/noter"
repo_url = "git@github.com:francisco-gaddr/noter.git"

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

def execute_sudo_command(ssh, command, password):
    # Use -S to read password from stdin
    # We pipe the password into sudo
    # Note: We need to be careful with shell escaping if command is complex
    # A safer way is to use exec_command and write to stdin
    
    print(f"Executing (sudo): {command}")
    stdin, stdout, stderr = ssh.exec_command(f"sudo -S -p '' {command}")
    
    stdin.write(f"{password}\n")
    stdin.flush()
    
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
    
    sys.stdout.write(stdout.read().decode('utf-8'))
    sys.stderr.write(stderr.read().decode('utf-8'))
    
    exit_status = stdout.channel.recv_exit_status()
    print(f"\nCommand finished with exit status: {exit_status}")
    return exit_status

def capture_command(ssh, command):
    """Run a command and return its trimmed stdout (for git rev-parse etc.)."""
    _stdin, stdout, _stderr = ssh.exec_command(command)
    return stdout.read().decode('utf-8').strip()


def health_gate(ssh):
    """Poll the backend's auth-free /api/health on the Pi until it answers 200, or give up.
    20 tries x 4s ~= 80s — longer than the container HEALTHCHECK start-period so a slow boot
    (Mongo connect + migrations) isn't mistaken for a failure. Returns True when healthy."""
    cmd = (
        "for i in $(seq 1 20); do "
        "if curl -fsS -m 3 http://localhost:3001/api/health >/dev/null 2>&1; then echo HEALTHY; exit 0; fi; "
        "echo \"waiting for backend health ($i/20)...\"; sleep 4; "
        "done; echo UNHEALTHY; exit 1"
    )
    return execute_command(ssh, cmd) == 0


def rollback(ssh, old_sha, project_path, docker_path, git_env):
    """Restore the previous git revision and rebuild — the site goes back to the last good version
    instead of staying down on a broken deploy. Returns True if the rolled-back stack is healthy."""
    if not old_sha:
        print("No previous revision recorded (fresh clone) — cannot auto-roll back.")
        return False
    print(f"Rolling back to previous revision {old_sha[:12]} ...")
    execute_command(ssh, f"cd {project_path} && {git_env} git reset --hard {old_sha}")
    execute_command(ssh, f"cd {docker_path} && docker compose up -d --build --remove-orphans")
    return health_gate(ssh)


try:
    print(f"Connecting to {host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, password=password)
    print("Connected successfully.")

    old_sha = None  # the revision before this deploy — populated on pull, used for rollback

    # Prepare git command
    git_env = "GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no'"

    # Check if directory exists
    check_dir_cmd = f"test -d {project_path} && echo 'exists'"
    stdin, stdout, stderr = ssh.exec_command(check_dir_cmd)
    
    if 'exists' not in stdout.read().decode('utf-8'):
        print(f"Directory {project_path} does not exist. Cloning...")
        
        # Ensure parent dir exists using sudo
        parent_dir = "/srv/projects"
        mk_cmd = f"mkdir -p {parent_dir}"
        
        # Try sudo mkdir
        exit_code = execute_sudo_command(ssh, mk_cmd, password)
        if exit_code != 0:
            print("Failed to create directory with sudo.")
            ssh.close()
            exit(1)
            
        # Change ownership of /srv/projects to realdini so we can clone without sudo
        chown_cmd = f"chown -R {user}:{user} {parent_dir}"
        exit_code = execute_sudo_command(ssh, chown_cmd, password)
        if exit_code != 0:
            print("Failed to chown directory.")
            ssh.close()
            exit(1)
        
        # Clone (now we should have permission)
        clone_cmd = f"cd {parent_dir} && {git_env} git clone {repo_url} noter"
        exit_code = execute_command(ssh, clone_cmd)
        if exit_code != 0:
            print("Clone failed.")
            ssh.close()
            exit(1)
    else:
        print(f"Directory {project_path} exists. Checking git status...")
        
        # Check permissions first
        chown_cmd = f"chown -R {user}:{user} {project_path}"
        execute_sudo_command(ssh, chown_cmd, password)

        # Check if it is a valid git repo
        check_git_cmd = f"cd {project_path} && test -d .git && echo 'is_git'"
        stdin, stdout, stderr = ssh.exec_command(check_git_cmd)
        
        if 'is_git' not in stdout.read().decode('utf-8'):
            print(f"Directory {project_path} exists but is not a git repository. Re-cloning...")
            # Remove directory
            rm_cmd = f"rm -rf {project_path}"
            execute_sudo_command(ssh, rm_cmd, password)
            
            # Re-clone
            clone_cmd = f"cd {parent_dir} && {git_env} git clone {repo_url} noter"
            exit_code = execute_command(ssh, clone_cmd)
            if exit_code != 0:
                print("Re-clone failed.")
                ssh.close()
                exit(1)
        else:
            print("Git repository valid. Pulling changes...")
            # Record the current revision FIRST so we can roll back to it if the new build is unhealthy.
            old_sha = capture_command(ssh, f"cd {project_path} && git rev-parse HEAD")
            if old_sha:
                print(f"Current revision (rollback target): {old_sha[:12]}")
            pull_cmd = f"cd {project_path} && {git_env} git reset --hard && {git_env} git pull"
            exit_code = execute_command(ssh, pull_cmd)
            if exit_code != 0:
                print("Pull failed.")
                ssh.close()
                exit(1)

    # Docker compose up
    docker_path = f"{project_path}/noter-app"
    
    print("Stopping existing containers...")
    # Force stop and remove any existing noter containers to free up ports
    stop_cmd = "docker ps -aq --filter 'name=noter' | xargs -r docker rm -f"
    execute_sudo_command(ssh, stop_cmd, password)
    
    print("Building and starting containers...")
    
    # Try docker without sudo first
    docker_cmd = f"cd {docker_path} && docker compose up -d --build --remove-orphans"
    exit_code = execute_command(ssh, docker_cmd)
    
    if exit_code != 0:
        print("Docker command failed. Trying with sudo...")
        # If it failed, maybe need sudo?
        # But 'cd' is shell builtin, so 'sudo cd' doesn't work.
        # We need to run the whole thing in a shell or use explicit path
        
        # Correct way to sudo a chain: sudo sh -c '...'
        sudo_docker_cmd = f"sh -c 'cd {docker_path} && docker compose up -d --build --remove-orphans'"
        exit_code = execute_sudo_command(ssh, sudo_docker_cmd, password)
        
        if exit_code != 0:
            print("Docker deployment with sudo failed.")
            # A failed BUILD/up leaves the old containers gone — try to restore the last good rev.
            if rollback(ssh, old_sha, project_path, docker_path, git_env):
                print("Build failed, but rolled back to the previous healthy version.")
            ssh.close()
            exit(1)

    # Health gate: don't call a deploy "successful" until the backend actually answers. A build can
    # succeed yet the app crash-loop (bad migration, missing env, runtime error). If it never gets
    # healthy, roll back to the previous revision so the site comes back up instead of staying down.
    print("Containers up — health-gating the new deployment...")
    if health_gate(ssh):
        print("Deployment successful and HEALTHY.")
    else:
        print("ERROR: the new deployment did not become healthy.")
        if rollback(ssh, old_sha, project_path, docker_path, git_env):
            print("Rolled back to the previous healthy version. Investigate the failed build before redeploying.")
        else:
            print("CRITICAL: rollback unavailable or also unhealthy — manual intervention needed on the Pi.")
        ssh.close()
        exit(1)
    ssh.close()

except Exception as e:
    print(f"An error occurred: {e}")
    exit(1)
