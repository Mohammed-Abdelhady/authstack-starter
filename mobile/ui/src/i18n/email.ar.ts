import type { EMAIL_EN } from './email.en';

export const EMAIL_AR: Record<keyof typeof EMAIL_EN, string> = {
  'email.staffConfirm.open': 'تأكيد تغيير البريد الإلكتروني',
  'email.staffConfirm.title': 'تأكيد عنوانك الجديد',
  'email.staffConfirm.description':
    'إذا أرسل فريق الإدارة رمز تأكيد إلى عنوانك الجديد، فأدخل العنوان والرمز هنا.',
  'email.staffConfirm.done': 'تم تأكيد عنوانك الجديد',
  'email.staffConfirm.signIn': 'سجّل الدخول مجددًا باستخدام عنوان بريدك الإلكتروني الجديد.',
  'email.title': 'عنوان البريد الإلكتروني',
  'email.description': 'تصل الرموز وتنبيهات الأمان الخاصة بحسابك إلى هذا العنوان.',
  'email.current': 'العنوان الحالي',
  'email.pending': 'في انتظار التأكيد',
  'email.loading': 'جارٍ تحميل عنوان بريدك الإلكتروني',
  'email.loadFailed': 'تعذَّر تحميل عنوان بريدك الإلكتروني',
  'email.change': 'تغيير عنوان البريد الإلكتروني',
  'email.newAddress': 'عنوان البريد الإلكتروني الجديد',
  'email.newAddressHint': 'يُرسَل رمز إلى هذا العنوان، وتنبيه إلى عنوانك الحالي',
  'email.send': 'إرسال الرمز',
  'email.code': 'الرمز الوارد في الرسالة',
  'email.codeHint': 'الأرقام الستة المرسَلة إلى {address}',
  'email.confirm': 'تأكيد العنوان الجديد',
  'email.keepCurrent': 'الإبقاء على العنوان الحالي',
  'email.otherAddress': 'استخدام عنوان آخر',
  'email.outcome.sent.title': 'تحقَّق من صندوق الوارد الجديد',
  'email.outcome.sent.description':
    'إذا كان العنوان {address} صالحًا للاستخدام، فالرمز في طريقه إليه. أدخله هنا لإتمام التغيير.',
  'email.outcome.changed.title': 'تغيَّر عنوان بريدك الإلكتروني',
  'email.outcome.changed.description':
    'سُجِّل الخروج من الأجهزة الأخرى، ويبقى هذا الجهاز مسجَّل الدخول.',
  'email.outcome.cancelled.title': 'يبقى عنوانك كما هو',
  'email.outcome.signInAgain.title': 'سجّل الدخول مجددًا أولًا',
  'email.outcome.signInAgain.description':
    'حفاظًا على أمانك، سجّل الخروج ثم سجّل الدخول مجددًا، وغيّر عنوانك خلال خمس دقائق.',
  'email.outcome.invalidAddress.title': 'تحقَّق من العنوان',
  'email.outcome.invalidAddress.description':
    'أدخل عنوان بريد إلكتروني كاملًا يختلف عن عنوانك الحالي.',
  'email.outcome.limitReached.title': 'رموز كثيرة جدًا',
  'email.outcome.limitReached.description': 'انتظر بعض الوقت قبل أن تطلب رمزًا آخر لهذا العنوان.',
  'email.outcome.codeRefused.title': 'لم يُقبَل هذا الرمز',
  'email.outcome.codeRefused.description':
    'تحقَّق من أحدث رسالة وأعد المحاولة، أو استخدم عنوانًا آخر للحصول على رمز جديد.',
  'email.outcome.failed.title': 'لم يتغيَّر عنوانك',
};
