export const fakeVpsDockerfile = `
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV container=docker

RUN apt-get update \\
	&& apt-get install -y --no-install-recommends \\
		systemd \\
		systemd-sysv \\
		dbus \\
		openssh-server \\
		sudo \\
		rsync \\
		curl \\
		ca-certificates \\
		gnupg \\
		iproute2 \\
	&& rm -rf /var/lib/apt/lists/*

# SSH as root on port 22 mirrors a fresh droplet created with --ssh-keys.
ARG SSH_PUBLIC_KEY
RUN mkdir -p /root/.ssh \\
	&& chmod 700 /root/.ssh \\
	&& printf '%s\\n' "$SSH_PUBLIC_KEY" > /root/.ssh/authorized_keys \\
	&& chmod 600 /root/.ssh/authorized_keys

# systemd is PID 1; SIGRTMIN+3 is the signal it treats as a clean shutdown.
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
`.trim();
