import { InstanceConfig } from '../types';
import { HytaleAdapter } from './HytaleAdapter';

export const getAdapterForInstance = (instance: InstanceConfig) => {
  if (instance.serverType === 'hytale') {
    return HytaleAdapter;
  }
  return null;
};
