import type { SIGN_IN_EN } from './sign-in.en';

export const SIGN_IN_AR: Record<keyof typeof SIGN_IN_EN, string> = {
  'signIn.title': 'تسجيل الدخول إلى \u2068{appName}\u2069',
  'signIn.description': 'يُفتح المتصفح لتسجيل دخولك ثم يعيدك إلى هذه الشاشة.',
  'signIn.action': 'المتابعة في المتصفح',
  'signIn.actionHint': 'يفتح المتصفح لتسجيل الدخول',
  'signIn.restoring': 'جارٍ البحث عن تسجيل دخول محفوظ',
  'signIn.waiting': 'في انتظار المتصفح',
  'signIn.inProgress.title': 'أكمل تسجيل الدخول في المتصفح',
  'signIn.inProgress.description': 'تُحدَّث هذه الشاشة تلقائيًا عند عودتك.',
  'signIn.browserClosed.title': 'أغلقتَ المتصفح قبل تسجيل الدخول',
  'signIn.browserClosed.description': 'لم يتغير شيء. تابع متى كنت مستعدًا.',
  'signIn.offline.title': 'تعذر الاتصال بالخادم',
  'signIn.storageLocked.title': 'هذا الجهاز مقفل',
  'signIn.storageLocked.description':
    'افتح قفل الجهاز ليتمكن التطبيق من قراءة تسجيل الدخول المحفوظ، ثم أعد المحاولة.',
  'signIn.failed.title': 'لم يكتمل تسجيل الدخول',
  'signIn.failed.expired': 'استغرق تسجيل الدخول وقتًا أطول من المسموح. ابدأ من جديد.',
  'signIn.failed.denied': 'رُفض تسجيل الدخول.',
  'signIn.failed.disabled': 'تسجيل الدخول من هذا التطبيق معطل على الخادم.',
  'signIn.failed.throttled': 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
  'signIn.failed.sessionLimit':
    'بلغ حسابك الحد الأقصى لعدد الأجهزة المسجَّل دخولها. سجّل الخروج من جهاز آخر ثم أعد المحاولة.',
  'signIn.failed.deviceKey': 'تعذر على هذا الجهاز إثبات هويته. أعد المحاولة.',
  'signIn.failed.browser': 'تعذر فتح المتصفح.',
  'signIn.failed.storage': 'تعذَّر على التطبيق قراءة تسجيل الدخول أو حفظه على هذا الجهاز.',
  'signIn.failed.generic': 'حدث خطأ. أعد المحاولة.',
  'signIn.reauth.title': 'انتهت جلستك',
  'signIn.reauth.description': 'سجّل الدخول مجددًا للمتابعة.',
  'signIn.switchedOff.title': 'تسجيل الدخول من هذا التطبيق متوقف',
  'signIn.switchedOff.description':
    'أوقفت الخدمة تسجيل الدخول من تطبيقات الجوال مؤقتًا. أعد المحاولة لاحقًا.',
};
