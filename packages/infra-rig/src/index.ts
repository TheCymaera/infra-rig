export { shell, sh, CommandError, type CommandResult, type SpawnOptions } from "./primitives/shell.js";
export { rsync, type RsyncEndpoint, type RsyncOptions } from "./primitives/rsync.js";
export { files, type FileOptions } from "./primitives/files.js";
export { isReachable, waitReachable, type WaitReachableOptions } from "./primitives/reachability.js";
export { ui, type Confirmation } from "./primitives/ui.js";

export { run, capture, tryRun, type ExecOptions, type Transport } from "./transports/transport.js";
export { LocalTransport, type LocalTarget } from "./transports/local.js";
export { SshTransport, type SshTarget } from "./transports/ssh.js";
export { DockerTransport, type DockerTarget } from "./transports/docker.js";

export { apt } from "./recipes/apt.js";
export { bun } from "./recipes/bun.js";
export { caddy } from "./recipes/caddy.js";
export { netplan, type NetplanOptions } from "./recipes/netplan.js";
export { harden, type HardenOptions } from "./recipes/harden.js";
export { node, type NodeVersion } from "./recipes/node.js";
export { pm2, type Pm2App } from "./recipes/pm2.js";
export { pnpm } from "./recipes/pnpm.js";
export { systemd, type SystemdUnit } from "./recipes/systemd.js";
export { digitalOcean, type DropletConfig } from "./recipes/digitalOcean.js";
export { docker, type DockerBuild, type DockerConfig } from "./recipes/docker.js";

