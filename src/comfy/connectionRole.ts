import type { ComfyConnectionRole, ConnectionPreset } from '../types';

type ComfyRoleSource = Pick<ConnectionPreset, 'kind' | 'comfyRole'>;

// A ComfyUI preset without a chosen role is still in the image/voice picker step.
export function comfyConnectionRole(connection: ComfyRoleSource): ComfyConnectionRole | null {
  if (connection.kind !== 'comfyui') {
    return null;
  }
  return connection.comfyRole === 'voice' || connection.comfyRole === 'image'
    ? connection.comfyRole
    : null;
}

export function isComfyImageConnection(connection: ComfyRoleSource): boolean {
  return comfyConnectionRole(connection) === 'image';
}

export function isComfyVoiceConnection(connection: ComfyRoleSource): boolean {
  return comfyConnectionRole(connection) === 'voice';
}
