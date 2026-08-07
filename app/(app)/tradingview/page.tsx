import { Eye } from 'lucide-react';
import { ComingSoon } from '@/components/custom/coming-soon';

export default function TradingViewPage() {
  return (
    <ComingSoon
      title="TradingView"
      description="TradingView charts embedded alongside your positions."
      icon={Eye}
    />
  );
}
