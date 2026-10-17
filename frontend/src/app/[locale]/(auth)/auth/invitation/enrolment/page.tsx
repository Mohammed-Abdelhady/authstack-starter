import { AuthLayout } from '@/modules/auth/components/AuthLayout';
import { EnrolmentPanel } from '@/modules/invitations/components/EnrolmentPanel';

export default function EnrolmentPage() {
  return (
    <AuthLayout>
      <EnrolmentPanel />
    </AuthLayout>
  );
}
