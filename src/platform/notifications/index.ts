/** P4: presentación local. P5 recibe FCM y recupera la propuesta vigente. */
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

function notImplemented(): never {
  throw Object.assign(new Error('P4: integrar canales y presentación de avisos.'), {
    code: 'E_NOT_IMPLEMENTED',
  });
}

export const unavailableNotifications: NotificationPort = {
  async getPermission() { return 'UNAVAILABLE'; },
  async showProposal() { notImplemented(); },
  async dismissProposal() { notImplemented(); },
};
