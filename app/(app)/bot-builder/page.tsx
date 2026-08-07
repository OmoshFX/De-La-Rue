import { Settings2 } from 'lucide-react';
import { ComingSoon } from '@/components/custom/coming-soon';

export default function BotBuilderPage() {
  return (
    <ComingSoon
      title="Bot Builder"
      description="Assemble trading strategies from blocks and save them to run later."
      icon={Settings2}
    />
  );
}
