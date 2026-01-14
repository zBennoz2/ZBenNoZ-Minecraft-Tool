import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '../config/paths';

export interface GlobalSettings {
  hytale?: {
    downloaderUrl?: string;
  };
}

const SETTINGS_FILE = 'settings.json';

export const loadGlobalSettings = async (): Promise<GlobalSettings> => {
  const settingsPath = path.join(getDataDir(), SETTINGS_FILE);
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as GlobalSettings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

export const getGlobalHytaleDownloaderUrl = async (): Promise<string | undefined> => {
  const settings = await loadGlobalSettings();
  return settings.hytale?.downloaderUrl;
};
