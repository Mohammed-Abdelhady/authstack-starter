import type { PasskeyResetMessages } from '../en/passkey-reset';

export const PASSKEY_RESET_AR: PasskeyResetMessages = {
  subject: 'إعداد مفتاح مرور جديد',
  title: 'تسجيل مفتاح مرور جديد',
  heading: 'إعداد مفتاح مرور جديد',
  intro: 'استخدم هذا الرابط لتسجيل مفتاح مرور جديد لحسابك.',
  button: 'إعداد مفتاح مرور',
  expiry: 'تنتهي صلاحية هذا الرابط خلال {days}.',
  days: {
    zero: '{count} يوم',
    one: 'يوم واحد',
    two: 'يومين',
    few: '{count} أيام',
    many: '{count} يومًا',
    other: '{count} يوم',
  },
  contact: 'إذا لم تكن تتوقع هذا الرابط، فتواصل مع المسؤولين.',
};
