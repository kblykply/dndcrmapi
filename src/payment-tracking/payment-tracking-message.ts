import { BadRequestException } from '@nestjs/common';
import type {
  PaymentMessage,
  PaymentTrackingAction,
} from './payment-tracking.types';

export function isMessageAction(type: string): boolean {
  return type === 'message_draft' || type === 'message_sent';
}

export function validateMessageAction(
  input: PaymentTrackingAction,
): PaymentMessage | null {
  const invalid = (): never => {
    throw new BadRequestException('Mesaj kaydı geçersiz.');
  };
  if (
    !input.messageId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      input.messageId,
    )
  )
    invalid();
  if (input.type === 'message_sent') {
    if (
      input.body ||
      input.recipient !== undefined ||
      input.subject !== undefined ||
      input.channel !== undefined
    )
      invalid();
    return null;
  }
  const { recipient, subject, channel, body } = input;
  if (
    typeof recipient !== 'string' ||
    !recipient ||
    recipient.length > 320 ||
    /[\r\n]/.test(recipient)
  )
    invalid();
  if (
    typeof subject !== 'string' ||
    subject.length > 200 ||
    /[\r\n]/.test(subject)
  )
    invalid();
  if (
    typeof body !== 'string' ||
    !body.trim() ||
    body.length > 4000 ||
    [...body].some(
      (character) =>
        character.charCodeAt(0) < 32 &&
        ![9, 10, 13].includes(character.charCodeAt(0)),
    )
  )
    invalid();
  if (channel === 'email') {
    if (!/^[^\s@,;?&#]+@[^\s@,;?&#]+\.[^\s@,;?&#]+$/.test(recipient!))
      invalid();
  } else if (channel === 'whatsapp') {
    const digits = recipient!.replace(/\D/g, '');
    const international = recipient!.startsWith('00')
      ? digits.slice(2)
      : digits;
    if (
      !/^\+?[\d ().-]+$/.test(recipient!) ||
      !/^[1-9]\d{7,14}$/.test(international)
    )
      invalid();
  } else invalid();
  return { id: input.messageId!, recipient: recipient!, subject: subject! };
}

export function readPaymentMessage(value: unknown): PaymentMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  return typeof data.id === 'string' &&
    typeof data.recipient === 'string' &&
    typeof data.subject === 'string'
    ? { id: data.id, recipient: data.recipient, subject: data.subject }
    : null;
}
