import type { PasskeyResetMessages } from '../en/passkey-reset';

export const PASSKEY_RESET_AR: PasskeyResetMessages = {
  subject: 'إعداد مفتاح مرور جديد',
  title: 'أُعيد ضبط مفاتيح المرور الخاصة بك',
  heading: 'إعداد مفتاح مرور جديد',
  intro:
    'أعاد أحد المسؤولين ضبط مفاتيح المرور الخاصة بك وأنهى جلساتك. استخدم هذا الرابط لتسجيل مفتاح مرور جديد.',
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
  contact: 'إذا لم تكن تتوقع إعادة الضبط هذه، فتواصل مع المسؤولين.',
};
