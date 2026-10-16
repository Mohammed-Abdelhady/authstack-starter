import { AuthLayout } from '@/modules/auth/components/AuthLayout';
import { AcceptInvitationPanel } from '@/modules/invitations';

export default function InvitationPage() {
  return (
    <AuthLayout>
      <AcceptInvitationPanel />
    </AuthLayout>
  );
}
