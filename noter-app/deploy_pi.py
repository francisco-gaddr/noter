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

try:
    print(f"Connecting to {host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, password=password)
    print("Connected successfully.")

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
        print(f"Directory {project_path} exists. Pulling changes...")
        
        # Check permissions? If owned by root, git pull might fail.
        # Let's ensure ownership just in case
        chown_cmd = f"chown -R {user}:{user} {project_path}"
        execute_sudo_command(ssh, chown_cmd, password)
        
        pull_cmd = f"cd {project_path} && {git_env} git reset --hard && {git_env} git pull"
        exit_code = execute_command(ssh, pull_cmd)
        if exit_code != 0:
            print("Pull failed.")
            ssh.close()
            exit(1)

    # Docker compose up
    docker_path = f"{project_path}/noter-app"
    
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
            exit(1)
    
    print("Deployment successful.")
    ssh.close()

except Exception as e:
    print(f"An error occurred: {e}")
    exit(1)
