/** P4 owns local presentation. P5 alone receives remote hints and syncs server state. */
export interface ProposalNotification {
  groupId: string;
  requestId: string;
  requestVersion: number;
  title: string;
}

export interface NotificationPort {
  getPermission(): Promise<'GRANTED' | 'DENIED' | 'UNDETERMINED' | 'UNAVAILABLE'>;
  showProposal(proposal: ProposalNotification): Promise<void>;
  dismissProposal(requestId: string): Promise<void>;
}

export interface NotificationControls extends NotificationPort {
  requestPermission(): Promise<boolean>;
  openSettings(): Promise<boolean>;
}

export const unavailableNotifications: NotificationControls = {
  async getPermission() { return 'UNAVAILABLE'; },
  async requestPermission() { return false; },
  async openSettings() { return false; },
  async showProposal() { throw Object.assign(new Error('Notificaciones no disponibles en esta plataforma.'), { code: 'E_UNAVAILABLE' }); },
  async dismissProposal() { throw Object.assign(new Error('Notificaciones no disponibles en esta plataforma.'), { code: 'E_UNAVAILABLE' }); },
};
