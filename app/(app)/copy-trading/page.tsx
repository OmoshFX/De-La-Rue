import { Copy } from 'lucide-react';
import { ComingSoon } from '@/components/custom/coming-soon';

export default function CopyTradingPage() {
  return (
    <ComingSoon
      title="Copy Trading"
      description="Mirror the trades of another account automatically."
      icon={Copy}
    />
  );
}
