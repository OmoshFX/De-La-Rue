import { LineChart } from 'lucide-react';
import { ComingSoon } from '@/components/custom/coming-soon';

export default function ChartsPage() {
  return (
    <ComingSoon
      title="Charts"
      description="Full price charts with indicators and drawing tools."
      icon={LineChart}
    />
  );
}
