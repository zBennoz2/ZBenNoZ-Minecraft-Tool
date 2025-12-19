import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'node:path';

export interface JavaResolution {
  javaBin: string;
  javaHome?: string;
}

const JAVA_FILENAME = process.platform === 'win32' ? 'java.exe' : 'java';

const verifyJavaExecutable = (javaBin: string): boolean => {
  try {
    execFileSync(javaBin, ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

export const resolveJava = (preferredPath?: string): JavaResolution => {
  if (preferredPath && preferredPath.trim()) {
    const candidate = preferredPath.trim();
    if (fs.existsSync(candidate) && verifyJavaExecutable(candidate)) {
      console.debug(`[JavaResolver] Using Java binary from config: ${candidate}`);
      return { javaBin: candidate };
    }
  }

  const envJavaHome = process.env.JAVA_HOME?.trim();
  if (envJavaHome) {
    const javaBin = path.join(envJavaHome, 'bin', JAVA_FILENAME);
    if (fs.existsSync(javaBin) && verifyJavaExecutable(javaBin)) {
      console.debug(`[JavaResolver] Using Java from JAVA_HOME: ${javaBin}`);
      return { javaBin, javaHome: envJavaHome };
    }
  }

  const pathJava = JAVA_FILENAME;
  if (verifyJavaExecutable(pathJava)) {
    console.debug(`[JavaResolver] Using Java from PATH: ${pathJava}`);
    return { javaBin: pathJava };
  }

  if (process.platform === 'darwin') {
    try {
      const javaHome = execSync('/usr/libexec/java_home', { encoding: 'utf-8' }).trim();
      if (javaHome) {
        const javaBin = path.join(javaHome, 'bin', JAVA_FILENAME);
        if (fs.existsSync(javaBin) && verifyJavaExecutable(javaBin)) {
          console.debug(`[JavaResolver] Using Java from /usr/libexec/java_home: ${javaBin}`);
          return { javaBin, javaHome };
        }
      }
    } catch {
      // Ignore macOS fallback errors
    }
  }

  throw new Error(
    'Java runtime not found. Please install Java 17 or 21 and ensure it is on PATH or JAVA_HOME is set.'
  );
};
