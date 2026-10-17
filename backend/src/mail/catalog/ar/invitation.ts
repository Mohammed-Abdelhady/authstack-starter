import type { InvitationMessages } from '../en/invitation';

export const INVITATION_AR: InvitationMessages = {
  subject: 'دعوتك لإنشاء حساب',
  title: 'قبول الدعوة',
  heading: 'لقد تلقيت دعوة',
  intro: 'لقد تلقيت دعوة لإنشاء حساب.',
  invitedBy: 'دعاك {name} لإنشاء حساب.',
  button: 'قبول الدعوة',
  expiry: 'تنتهي صلاحية هذا الرابط خلال {days}.',
  days: {
    zero: '{count} يوم',
    one: 'يوم واحد',
    two: 'يومين',
    few: '{count} أيام',
    many: '{count} يومًا',
    other: '{count} يوم',
  },
  ignore: 'إذا لم تكن تتوقع هذه الدعوة، فتجاهل هذه الرسالة.',
};
