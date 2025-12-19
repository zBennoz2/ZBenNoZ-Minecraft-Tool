import { ChildProcess, SpawnOptions, spawn } from 'child_process';

export class ProcessManager {
  private processes = new Map<string, ChildProcess>();
  private forcedStops = new Set<string>();

  start(id: string, command: string, args: string[], options?: SpawnOptions): ChildProcess {
    if (this.isRunning(id)) {
      throw new Error(`Process for instance ${id} is already running`);
    }

    const child = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.processes.set(id, child);

    const cleanup = () => {
      this.processes.delete(id);
    };

    child.once('exit', cleanup);
    child.once('error', cleanup);

    return child;
  }

  async stop(id: string): Promise<boolean> {
    const child = this.processes.get(id);
    if (!child) {
      return false;
    }

    if (child.exitCode !== null) {
      this.processes.delete(id);
      return false;
    }

    return new Promise((resolve) => {
      let resolved = false;

      const settle = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        this.processes.delete(id);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        if (process.platform !== 'win32') {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore kill errors
          }
        }
      }, 5000);

      child.once('exit', () => {
        clearTimeout(timeout);
        settle(true);
      });

      try {
        child.kill('SIGTERM');
      } catch (error) {
        clearTimeout(timeout);
        settle(false);
      }
    });
  }

  isRunning(id: string): boolean {
    const child = this.processes.get(id);
    if (!child) return false;
    return child.exitCode === null && !child.killed;
  }

  getPid(id: string): number | null {
    const child = this.processes.get(id);
    if (!child || child.killed || child.exitCode !== null) return null;
    return child.pid ?? null;
  }

  sendCommand(id: string, command: string): boolean {
    const child = this.processes.get(id);
    if (!child || !child.stdin || child.stdin.destroyed || !child.stdin.writable) {
      return false;
    }

    try {
      child.stdin.write(`${command}\n`, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  async stopGracefully(id: string, timeoutMs = 10000): Promise<boolean> {
    const child = this.processes.get(id);
    if (!child) {
      return false;
    }

    const sent = this.sendCommand(id, 'stop');
    if (!sent) {
      this.forcedStops.add(id);
      return this.stop(id);
    }

    return new Promise((resolve) => {
      let settled = false;
      let usedFallback = false;

      const settle = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const onExit = () => settle(true);
      child.once('exit', onExit);
      child.once('close', onExit);

      const timeout = setTimeout(async () => {
        child.removeListener('exit', onExit);
        child.removeListener('close', onExit);
        usedFallback = true;
        const forced = await this.stop(id);
        settle(forced);
      }, timeoutMs);

      child.once('exit', () => clearTimeout(timeout));
      child.once('close', () => clearTimeout(timeout));

      child.once('exit', () => {
        if (usedFallback) {
          this.forcedStops.add(id);
        }
      });
      child.once('close', () => {
        if (usedFallback) {
          this.forcedStops.add(id);
        }
      });
    });
  }

  wasForceKilled(id: string): boolean {
    const had = this.forcedStops.has(id);
    this.forcedStops.delete(id);
    return had;
  }
}
