import type { ACCOUNT_EN } from './account.en';

export const ACCOUNT_AR: Record<keyof typeof ACCOUNT_EN, string> = {
  'account.title': 'الحساب',
  'account.description': 'البيانات التي يحتفظ بها الخادم عنك.',
  'account.name': 'الاسم',
  'account.email': 'البريد الإلكتروني',
  'account.role': 'الدور',
  'account.loading': 'جارٍ تحميل حسابك',
  'account.error.title': 'تعذر تحميل حسابك',
  'account.storageWarning.title': 'لم يُحفظ تسجيل دخولك على هذا الجهاز بعد',
  'account.storageWarning.description': 'قد تحتاج إلى تسجيل الدخول مجددًا بعد إغلاق التطبيق.',
  'account.sessions.title': 'الأجهزة المسجَّل دخولها',
  'account.sessions.description':
    'اطّلع على الأجهزة المسجَّل دخول حسابك عليها وسجّل الخروج من الأجهزة التي لا تستخدمها.',
  'account.sessions.action': 'إدارة الأجهزة',
  'account.signOut': 'تسجيل الخروج',
  'account.signOutHint': 'يسجّل خروجك من هذا الجهاز',
  'account.signOutFailed.title': 'ما زلت مسجَّل الدخول',
  'account.signOutFailed.description': 'تعذَّر تسجيل الخروج من هذا الجهاز. أعد المحاولة.',
};
