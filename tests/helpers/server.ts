import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerInstance {
  process: ChildProcess;
  port: number;
  logs: string[];
  stop: () => Promise<void>;
}

export const startServer = async (
  port: number,
  workDir: string,
  onLog?: (log: string) => void,
  packageDir?: string,
  configDir?: string
): Promise<ServerInstance> => {
  const projectRoot = path.resolve(__dirname, '../..');
  const cliPath = path.join(projectRoot, 'dist', 'cli.js');
  
  const args = [cliPath, '-p', port.toString()];
  if (packageDir) {
    args.push('-d', packageDir);
  }
  if (configDir) {
    args.push('-c', configDir);
  }
  
  const serverProcess = spawn('node', args, {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' }
  });

  const logs: string[] = [];
  
  if (serverProcess.stdout) {
    serverProcess.stdout.on('data', (data) => {
      const logLine = data.toString().trim();
      if (logLine) {
        logs.push(logLine);
        if (onLog) {
          onLog(logLine);
        }
      }
    });
  }

  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (data) => {
      const logLine = `ERROR: ${data.toString().trim()}`;
      if (logLine) {
        logs.push(logLine);
        if (onLog) {
          onLog(logLine);
        }
      }
    });
  }

  // Wait for server to start and auth service to initialize
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Server startup timeout'));
    }, 15000); // Increased timeout for auth initialization

    const checkStartup = () => {
      const hasStarted = logs.some(log => 
        log.includes(`Listening on port ${port}`));
      
      // Also check for auth service initialization completion
      const authInitialized = logs.some(log => 
        log.includes('Auth service initialization completed') ||
        log.includes('authentication: enabled') ||
        log.includes('authentication: disabled'));
      
      if (hasStarted && authInitialized) {
        clearTimeout(timeout);
        // Add small additional delay to ensure full initialization
        setTimeout(resolve, 100);
      } else {
        setTimeout(checkStartup, 100);
      }
    };

    serverProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    checkStartup();
  });

  const stop = async (): Promise<void> => {
    return new Promise((resolve) => {
      if (serverProcess.killed) {
        resolve();
        return;
      }

      serverProcess.on('exit', () => {
        resolve();
      });

      serverProcess.kill('SIGTERM');
      
      // Force kill after 5 seconds
      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  };

  return {
    process: serverProcess,
    port,
    logs,
    stop
  };
};