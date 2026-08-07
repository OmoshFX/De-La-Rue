import { Bot } from 'lucide-react';
import { ComingSoon } from '@/components/custom/coming-soon';

export default function TradingBotsPage() {
  return (
    <ComingSoon
      title="Trading Bots"
      description="Ready-made strategies you can start without building anything."
      icon={Bot}
    />
  );
}
