import { BulkEmailService } from './bulk-email.service';

describe('read-only campaign preview', () => {
  const queued = { id: 'recipient', deliveryLanguage: 'tr', status: 'QUEUED', customerName: 'Owner', unitNumbers: 'A2' };
  let service: BulkEmailService;
  let db: any;
  let mail: any;
  beforeEach(() => {
    db = {
      bulkEmailCampaign: { findUnique: jest.fn().mockResolvedValue({ id: 'campaign', createdAt: new Date('2026-10-16T07:00:00Z'), recipients: [queued] }) },
      bulkEmailJob: { findFirst: jest.fn().mockResolvedValue({ recipientId: 'recipient', payload: { subject: 'La Joya Perla A-2', text: 'Approved message', html: '<p>Approved message</p><img src="cid:logo">', to: 'private@example.com', actorId: 'private-id', attachments: [{ cid: 'logo', contentType: 'image/png', content: 'aW1hZ2U=' }, { filename: 'private.pdf', contentType: 'application/pdf', content: 'cHJpdmF0ZQ==' }] } }) },
      customerUnitSelectionLog: { findFirst: jest.fn() },
    };
    mail = { sendMail: jest.fn() };
    service = new BulkEmailService(db, mail);
  });
  it('shows the persisted queued email, embeds images and exposes no private payload metadata', async () => {
    const result = await service.getCampaignPreview('campaign', 'tr');
    expect(result.subject).toBe('La Joya Perla A-2');
    expect(result.html).toContain('data:image/png;base64,aW1hZ2U=');
    expect(result.source).toBe('queued');
    expect(result).not.toHaveProperty('to');
    expect(result).not.toHaveProperty('attachments');
    expect(JSON.stringify(result)).not.toContain('cHJpdmF0ZQ==');
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(db.bulkEmailJob.findFirst.mock.calls[0][0].where).toEqual({ campaignId: 'campaign', recipientId: { in: ['recipient'] }, status: { in: ['QUEUED', 'SENDING'] } });
  });
  it('does not expose another language or excluded recipient payload', async () => {
    await expect(service.getCampaignPreview('campaign', 'fa')).rejects.toThrow('No saved email content');
    expect(db.bulkEmailJob.findFirst).not.toHaveBeenCalled();
  });
  it('rejects unsupported languages', async () => {
    await expect(service.getCampaignPreview('campaign', '../../secret')).rejects.toThrow('Unsupported language');
    expect(db.bulkEmailCampaign.findUnique).not.toHaveBeenCalled();
  });
  it('uses the saved sent text instead of substituting a newer template', async () => {
    db.bulkEmailCampaign.findUnique.mockResolvedValue({ id: 'campaign', createdAt: new Date('2026-10-16T07:00:00Z'), recipients: [{ ...queued, status: 'SENT', subject: 'Original subject', email: 'owner@example.com', sentAt: new Date('2026-10-16T08:00:00Z'), unitSnapshot: [{ id: 'unit' }] }] });
    db.customerUnitSelectionLog.findFirst.mockResolvedValue({ newValue: 'Bulk email\nSubject: Original subject\nRecipient: owner@example.com\n\nOriginal content <script>' });
    const result = await service.getCampaignPreview('campaign', 'tr');
    expect(result.source).toBe('sent-record');
    expect(result.subject).toBe('Original subject');
    expect(result.text).toBe('Original content <script>');
    expect(result.html).not.toContain('<script>');
    expect(db.bulkEmailJob.findFirst).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});
