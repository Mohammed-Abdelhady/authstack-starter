import type { DELETION_EN } from './deletion.en';

export const DELETION_AR: Record<keyof typeof DELETION_EN, string> = {
  'deletion.proofRequired': 'يتطلب حذف الحساب إكمال التحقق من الهوية.',
  'deletion.proofSent': 'أدخل الرمز المرسل إلى عنوان البريد الإلكتروني لحسابك.',
  'deletion.proofRefused': 'تعذر التحقق من الرمز. حاول مجددًا أو أرسل رمزًا جديدًا.',
  'deletion.proofResend': 'إرسال رمز جديد',
  'deletion.title': 'حذف الحساب',
  'deletion.description': 'احذف حسابك وأنهِ جميع جلسات تسجيل الدخول.',
  'deletion.delete': 'حذف الحساب',
  'deletion.confirmTitle': 'هل تريد حذف حسابك؟',
  'deletion.confirmMessage':
    'يحذف هذا الإجراء حسابك ويسجّل خروجك من جميع الأجهزة. لا يمكنك التراجع عنه هنا.',
  'deletion.checking': 'جارٍ التحقق من حذف الحساب',
  'deletion.checkAgain': 'التحقق مجددًا',
  'deletion.deleted': 'حُذف حسابك',
  'deletion.eraseAfter': 'ستُمحى بيانات حسابك بعد {date}.',
  'deletion.notDeleted': 'لم يُحذف حسابك. يمكنك محاولة حذفه مجددًا.',
  'deletion.unknown': 'تعذر تأكيد الحذف.',
  'deletion.pending': 'لم تُعرف النتيجة بعد. تحقق مجددًا عند الاتصال بالإنترنت.',
  'deletion.storageFailed': 'تعذر حفظ سجل الحذف أو قراءته. أعد المحاولة.',
  'deletion.admin': 'لا يمكن لآخر مسؤول حذف حسابه.',
  'deletion.invalid': 'رُفض مفتاح الحذف. أعد المحاولة.',
  'deletion.conflict': 'مفتاح الحذف مستخدم بالفعل. أعد المحاولة.',
  'deletion.refused': 'رفض الخادم الحذف. لم يُحذف حسابك.',
  'deletion.failed': 'تعذر بدء الحذف. أعد المحاولة.',
};
